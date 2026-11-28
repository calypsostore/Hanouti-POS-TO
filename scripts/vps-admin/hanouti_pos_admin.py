#!/usr/bin/python3
"""Root-owned, allowlisted Hanouti POS VPS operations."""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ADMIN_LOG = Path("/var/log/hanouti-pos-admin.log")
COMPOSE_DIR = Path("/opt/supabase-vps/deployment")
COMPOSE_FILE = COMPOSE_DIR / "docker-compose.yml"
ENV_FILE = COMPOSE_DIR / ".env"
FRONTEND_DIR = Path("/srv/www/hanouti-pos")
CERTIFICATE = Path("/etc/letsencrypt/live/hanouti-pos.tn/fullchain.pem")
PROJECT = "hanouti-supabase"
MAX_REQUEST_BYTES = 256

DOCKER = "/usr/bin/docker"
SYSTEMCTL = "/usr/bin/systemctl"
NGINX = "/usr/sbin/nginx"
OPENSSL = "/usr/bin/openssl"
SS = "/usr/bin/ss"
CURL = "/usr/bin/curl"

CONTAINERS = {
    "db": "hanouti-supabase-db",
    "auth": "hanouti-supabase-auth",
    "rest": "hanouti-supabase-rest",
    "realtime": "hanouti-supabase-realtime",
    "storage": "hanouti-supabase-storage",
    "imgproxy": "hanouti-supabase-imgproxy",
    "functions": "hanouti-supabase-functions",
    "meta": "hanouti-supabase-meta",
    "studio": "hanouti-supabase-studio",
    "kong": "hanouti-supabase-kong",
    "supavisor": "hanouti-supabase-pooler",
}

IMAGES = {
    "db": "supabase/postgres:17.6.1.136",
    "auth": "supabase/gotrue:v2.199.0",
    "rest": "postgrest/postgrest:v14.18",
    "realtime": "supabase/realtime:v2.177.1",
    "storage": "supabase/storage-api:v1.98.7",
    "imgproxy": "ghcr.io/imgproxy/imgproxy:v4.0.25",
    "functions": "supabase/edge-runtime:v1.79.2",
    "meta": "supabase/postgres-meta:v0.100.1",
    "studio": "supabase/studio:2026.11.23-sha-4a73166",
    "kong": "kong/kong:3.9.5",
    "supavisor": "supabase/supavisor:2.10.2",
}

VOLUMES = {
    "db-data": "hanouti-pos-db-data",
    "db-config": "hanouti-pos-db-config",
    "storage-data": "hanouti-pos-storage-data",
    "deno-cache": "hanouti-pos-deno-cache",
}
NETWORK_NAME = "hanouti-supabase"
VOLUME_MOUNTS = {
    "db": {
        "/var/lib/postgresql/data": ("db-data", True),
        "/etc/postgresql-custom": ("db-config", True),
    },
    "storage": {"/var/lib/storage": ("storage-data", True)},
    "imgproxy": {"/var/lib/storage": ("storage-data", False)},
    "functions": {"/root/.cache/deno": ("deno-cache", True)},
}
BIND_MOUNTS = {
    "db": {
        "volumes/db/realtime.sql": "/docker-entrypoint-initdb.d/migrations/99-realtime.sql",
        "volumes/db/_supabase.sql": "/docker-entrypoint-initdb.d/migrations/97-_supabase.sql",
        "volumes/db/logs.sql": "/docker-entrypoint-initdb.d/migrations/99-logs.sql",
        "volumes/db/pooler.sql": "/docker-entrypoint-initdb.d/migrations/99-pooler.sql",
        "volumes/db/webhooks.sql": "/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql",
        "volumes/db/roles.sql": "/docker-entrypoint-initdb.d/init-scripts/99-roles.sql",
        "volumes/db/jwt.sql": "/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql",
    },
    "realtime": {"volumes/realtime/docker-entrypoint.sh": "/docker-entrypoint.sh"},
    "functions": {
        "volumes/functions/current": "/home/deno/functions",
        "volumes/functions/current/src/i18n/locales": "/home/src/i18n/locales",
    },
    "kong": {
        "volumes/api/kong.yml": "/home/kong/temp.yml",
        "volumes/api/kong-entrypoint.sh": "/home/kong/kong-entrypoint.sh",
    },
    "supavisor": {"volumes/pooler/pooler.exs": "/etc/pooler/pooler.exs"},
}
PUBLISHED_PORTS = {
    "studio": {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3003"}]},
    "kong": {"8000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8000"}]},
}
FUNCTION_RELEASE_REQUIRED_FILES = {
    *(f"{name}/index.ts" for name in (
        "device-login",
        "device-session",
        "device-staff-pin",
        "login",
        "manage-devices",
        "provision-account",
        "send-push",
        "verify-password",
    )),
    "main/index.ts",
    "main/events/index.ts",
    "src/i18n/locales/ar/notifications.ts",
    "src/i18n/locales/en/notifications.ts",
    "src/i18n/locales/fr/notifications.ts",
}
ALLOWED_ACTIONS = {
    "host-status",
    "paths",
    "compose-validate",
    "compose-preflight",
    "compose-status",
    "compose-health",
    "compose-log-summary",
    "compose-pull",
    "compose-up",
    "compose-stop",
    "compose-restart",
    "database-ready",
    "endpoint-health",
    "frontend-status",
    "nginx-test",
    "certificate-status",
}
SERVICE_ACTIONS = {"compose-restart", "compose-log-summary"}
SENSITIVE_OR_OTHER_PROJECT = re.compile(
    r"hanouti-stores|hanoutistores|stores\.tn", re.IGNORECASE
)


class AdminError(Exception):
    """A safe-to-display administrative operation failure."""


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate request field")
        result[key] = value
    return result


def parse_request(data: bytes) -> dict[str, str]:
    if not data or len(data) > MAX_REQUEST_BYTES or not data.endswith(b"\n"):
        raise ValueError("invalid request size or framing")
    if data.count(b"\n") != 1:
        raise ValueError("exactly one request is required")
    try:
        request = json.loads(
            data[:-1].decode("utf-8").rstrip("\r"),
            object_pairs_hook=_unique_object,
        )
    except (UnicodeDecodeError, ValueError):
        raise ValueError("request must be one JSON object") from None
    if not isinstance(request, dict):
        raise ValueError("request must be an object")
    if set(request) not in ({"action"}, {"action", "service"}):
        raise ValueError("unexpected request fields")
    action = request.get("action")
    service = request.get("service")
    if not isinstance(action, str) or action not in ALLOWED_ACTIONS:
        raise ValueError("unknown action")
    if action in SERVICE_ACTIONS:
        if not isinstance(service, str) or service not in CONTAINERS:
            raise ValueError(f"{action} requires an allowlisted service")
    elif "service" in request:
        raise ValueError("service is not accepted for this action")
    return request


def compose_prefix() -> list[str]:
    return [
        DOCKER,
        "compose",
        "--project-name",
        PROJECT,
        "--project-directory",
        str(COMPOSE_DIR),
        "--env-file",
        str(ENV_FILE),
        "--file",
        str(COMPOSE_FILE),
    ]


def _safe_environment() -> dict[str, str]:
    return {
        "HOME": "/root",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    }


def _run(
    command: list[str], *, timeout: int = 20
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=_safe_environment(),
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise AdminError("the fixed administrative command could not complete") from None


def _must_be_root_owned(path: Path, *, private: bool = False) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError:
        raise AdminError("required POS configuration is unavailable") from None
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0:
        raise AdminError("POS configuration must be a root-owned regular file")
    if info.st_mode & 0o022:
        raise AdminError("POS configuration is writable by group or other users")
    if private and info.st_mode & 0o077:
        raise AdminError("the POS environment file must be accessible only to root")
    return info


def _validate_functions_pointer(path: Path) -> None:
    try:
        info = path.lstat()
    except OSError:
        raise AdminError("the Edge Functions current pointer cannot be inspected") from None
    if not stat.S_ISLNK(info.st_mode) or info.st_uid != 0:
        raise AdminError("the Edge Functions current pointer must be a root-owned symlink")
    release_root = COMPOSE_DIR / "volumes/functions/releases"
    try:
        target = path.resolve(strict=True)
        target.relative_to(release_root)
        target_info = target.stat()
    except (OSError, ValueError):
        raise AdminError("the Edge Functions pointer is outside its release tree") from None
    if (
        target.parent != release_root
        or not stat.S_ISDIR(target_info.st_mode)
        or target_info.st_uid != 0
        or target_info.st_mode & 0o022
    ):
        raise AdminError("the Edge Functions release must be safely root-owned")
    _validate_functions_release_tree(target)


def _validate_functions_release_tree(target: Path) -> None:
    discovered_files: set[str] = set()
    file_count = 0
    total_size = 0

    def walk_error(error: OSError) -> None:
        raise error

    try:
        for current, directories, files in os.walk(
            target, followlinks=False, onerror=walk_error
        ):
            current_path = Path(current)
            for name in directories:
                path = current_path / name
                info = path.lstat()
                if (
                    not stat.S_ISDIR(info.st_mode)
                    or info.st_uid != 0
                    or info.st_mode & 0o022
                ):
                    raise AdminError("the Edge Functions release contains an unsafe directory")
            for name in files:
                path = current_path / name
                info = path.lstat()
                if (
                    not stat.S_ISREG(info.st_mode)
                    or info.st_uid != 0
                    or info.st_mode & 0o022
                ):
                    raise AdminError("the Edge Functions release contains an unsafe file")
                discovered_files.add(path.relative_to(target).as_posix())
                file_count += 1
                total_size += info.st_size
                if file_count > 20000 or total_size > 536870912:
                    raise AdminError("the Edge Functions release exceeds safe size limits")
    except OSError:
        raise AdminError("the Edge Functions release tree could not be inspected") from None
    if not FUNCTION_RELEASE_REQUIRED_FILES <= discovered_files:
        raise AdminError("the Edge Functions release is incomplete")


def _check_pos_tree() -> None:
    try:
        root_info = COMPOSE_DIR.lstat()
        resolved_root = COMPOSE_DIR.resolve(strict=True)
    except OSError:
        raise AdminError("the POS Supabase configuration directory is missing") from None
    except RuntimeError:
        raise AdminError("the POS Supabase configuration directory is not safely resolvable") from None
    if (
        not stat.S_ISDIR(root_info.st_mode)
        or root_info.st_uid != 0
        or root_info.st_mode & 0o022
        or resolved_root != COMPOSE_DIR
    ):
        raise AdminError("the POS Supabase configuration directory is not safely owned")

    required = (
        COMPOSE_FILE,
        ENV_FILE,
        COMPOSE_DIR / "volumes/api/kong.yml",
        COMPOSE_DIR / "volumes/api/kong-entrypoint.sh",
        COMPOSE_DIR / "volumes/pooler/pooler.exs",
        COMPOSE_DIR / "volumes/realtime/docker-entrypoint.sh",
    )
    for path in required:
        _must_be_root_owned(path, private=path == ENV_FILE)

    def walk_error(error: OSError) -> None:
        raise error

    try:
        for current, directories, files in os.walk(
            COMPOSE_DIR, followlinks=False, onerror=walk_error
        ):
            current_path = Path(current)
            for name in directories:
                path = current_path / name
                info = path.lstat()
                if path.relative_to(COMPOSE_DIR).as_posix() in {
                    "volumes/functions/current",
                    "volumes/functions/previous",
                }:
                    _validate_functions_pointer(path)
                    continue
                if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                    raise AdminError("unexpected link in the POS configuration tree")
                if info.st_uid != 0 or info.st_mode & 0o022:
                    raise AdminError("POS configuration directories must be root-owned")
            for name in files:
                path = current_path / name
                info = path.lstat()
                if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                    raise AdminError("POS configuration files must be root-owned regular files")
                if path == ENV_FILE and info.st_mode & 0o077:
                    raise AdminError("the POS environment file must be accessible only to root")
    except OSError:
        raise AdminError("the POS configuration tree could not be inspected") from None


def validate_compose_document(document: Any) -> None:
    if (
        not isinstance(document, dict)
        or set(document) != {"name", "services", "volumes", "networks"}
        or document.get("name") != PROJECT
    ):
        raise AdminError("Compose project name is not the approved Hanouti POS project")
    services = document.get("services")
    if not isinstance(services, dict) or set(services) != set(CONTAINERS):
        raise AdminError("Compose contains an unapproved service set")

    expected_ports = {
        "kong": {("127.0.0.1", "8000", 8000, "tcp")},
        "studio": {("127.0.0.1", "3003", 3000, "tcp")},
    }
    for service_name, service in services.items():
        if not isinstance(service, dict):
            raise AdminError("Compose service definition is invalid")
        if service.get("container_name") != CONTAINERS[service_name]:
            raise AdminError("Compose contains an unapproved container name")
        if service.get("image") != IMAGES[service_name]:
            raise AdminError("Compose contains an unapproved image")
        host_integration_fields = {
            "network_mode",
            "pid",
            "ipc",
            "uts",
            "userns_mode",
            "devices",
            "device_cgroup_rules",
            "volumes_from",
            "build",
            "env_file",
            "cap_add",
            "security_opt",
            "configs",
            "secrets",
            "use_api_socket",
            "runtime",
            "provider",
            "credential_spec",
            "cgroup",
            "cgroup_parent",
        }
        if (
            service.get("privileged")
            or host_integration_fields.intersection(service)
        ):
            raise AdminError("Compose contains a host-level or unapproved execution feature")
        networks = service.get("networks", {})
        if not isinstance(networks, dict) or set(networks) != {"supabase"}:
            raise AdminError("Compose service uses an unapproved network")

        actual_ports: set[tuple[str, str, int, str]] = set()
        for port in service.get("ports", []):
            if not isinstance(port, dict):
                raise AdminError("Compose port mapping is invalid")
            try:
                actual_ports.add(
                    (
                        str(port.get("host_ip", "")),
                        str(port.get("published", "")),
                        int(port.get("target", 0)),
                        str(port.get("protocol", "tcp")),
                    )
                )
            except (TypeError, ValueError):
                raise AdminError("Compose port mapping is invalid") from None
        if actual_ports != expected_ports.get(service_name, set()):
            raise AdminError("Compose publishes an unapproved host port")

        actual_volume_mounts: dict[str, tuple[str, bool]] = {}
        actual_bind_mounts: dict[str, tuple[Path, bool]] = {}
        for mount in service.get("volumes", []):
            if not isinstance(mount, dict):
                raise AdminError("Compose mount is invalid")
            source = mount.get("source")
            target = mount.get("target")
            read_only = mount.get("read_only", False)
            if not isinstance(target, str) or not isinstance(read_only, bool):
                raise AdminError("Compose mount is invalid")
            if mount.get("type") == "volume":
                if not isinstance(source, str) or source not in VOLUMES:
                    raise AdminError("Compose references an unapproved persistent volume")
                if target in actual_volume_mounts:
                    raise AdminError("Compose contains a duplicate POS mount target")
                actual_volume_mounts[target] = (source, read_only)
            elif mount.get("type") == "bind":
                if not isinstance(source, str):
                    raise AdminError("Compose bind mount is invalid")
                if target in actual_bind_mounts:
                    raise AdminError("Compose contains a duplicate POS mount target")
                source_path = Path(str(source))
                try:
                    resolved = source_path.resolve(strict=True)
                    resolved.relative_to(COMPOSE_DIR)
                except (OSError, ValueError):
                    raise AdminError("Compose bind mount escapes the POS configuration directory") from None
                actual_bind_mounts[target] = (resolved, read_only)
            else:
                raise AdminError("Compose uses an unapproved mount type")

        expected_volumes = {
            target: (key, not read_write)
            for target, (key, read_write) in VOLUME_MOUNTS.get(service_name, {}).items()
        }
        expected_binds = {
            target: ((COMPOSE_DIR / source).resolve(strict=True), True)
            for source, target in BIND_MOUNTS.get(service_name, {}).items()
        }
        if actual_volume_mounts != expected_volumes or actual_bind_mounts != expected_binds:
            raise AdminError("Compose contains an unapproved POS mount set")

    volumes = document.get("volumes")
    if not isinstance(volumes, dict) or set(volumes) != set(VOLUMES):
        raise AdminError("Compose contains an unapproved persistent-volume set")
    for key, expected_name in VOLUMES.items():
        volume = volumes.get(key)
        if (
            not isinstance(volume, dict)
            or volume.get("name") != expected_name
            or volume.get("external")
            or volume.get("driver", "local") != "local"
            or volume.get("driver_opts")
        ):
            raise AdminError("Compose persistent volume does not have the approved POS name")

    networks = document.get("networks")
    network = networks.get("supabase") if isinstance(networks, dict) else None
    if (
        not isinstance(network, dict)
        or network.get("name") != NETWORK_NAME
        or network.get("external")
        or network.get("driver", "bridge") != "bridge"
        or network.get("driver_opts")
        or network.get("ipam")
    ):
        raise AdminError("Compose network is not the approved private POS network")


def _load_compose_document() -> dict[str, Any]:
    _check_pos_tree()
    try:
        raw = COMPOSE_FILE.read_text(encoding="utf-8")
    except OSError:
        raise AdminError("the POS Compose file cannot be read") from None
    if SENSITIVE_OR_OTHER_PROJECT.search(raw):
        raise AdminError("Compose refers to a protected or unrelated project")
    result = _run(compose_prefix() + ["config", "--format", "json"], timeout=45)
    if result.returncode != 0:
        raise AdminError("POS Compose validation failed; details withheld")
    try:
        document = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise AdminError("POS Compose returned invalid normalized configuration") from None
    if SENSITIVE_OR_OTHER_PROJECT.search(json.dumps(document, sort_keys=True)):
        raise AdminError("normalized Compose refers to a protected or unrelated project")
    validate_compose_document(document)
    return document


def _docker_ready() -> None:
    result = _run([DOCKER, "info", "--format", "{{.ServerVersion}}"])
    if result.returncode != 0:
        raise AdminError("Docker daemon is unavailable to the POS administrator")


def _inspect_labels(command: list[str], *, missing_ok: bool) -> dict[str, str] | None:
    result = _run(command)
    if result.returncode != 0:
        message = result.stderr.casefold()
        if missing_ok and any(
            missing in message
            for missing in ("no such object", "no such volume", "no such network")
        ):
            return None
        raise AdminError("a required Hanouti POS Docker resource is unavailable")
    try:
        labels = json.loads(result.stdout.strip() or "{}")
    except json.JSONDecodeError:
        raise AdminError("Docker returned invalid resource metadata") from None
    return labels if isinstance(labels, dict) else {}


def _existing_pos_containers() -> list[tuple[str, str]]:
    _docker_ready()
    result = _run(
        [
            DOCKER,
            "ps",
            "--all",
            "--filter",
            f"label=com.docker.compose.project={PROJECT}",
            "--format",
            '{{.Names}}|{{.Label "com.docker.compose.service"}}',
        ]
    )
    if result.returncode != 0:
        raise AdminError("POS container inventory is unavailable")
    containers: list[tuple[str, str]] = []
    for line in result.stdout.splitlines():
        name, separator, service = line.partition("|")
        if not separator or service not in CONTAINERS or CONTAINERS[service] != name:
            raise AdminError("an unrecognized container uses the POS Compose project label")
        _verify_existing_container(service, name)
        containers.append((service, name))
    for volume_name in VOLUMES.values():
        _verify_volume_resource(volume_name)
    _verify_network_resource()
    return containers


def _verify_existing_container(service: str, name: str) -> None:
    result = _run([DOCKER, "inspect", name])
    if result.returncode != 0:
        raise AdminError("a Hanouti POS container could not be verified")
    try:
        containers = json.loads(result.stdout)
        container = containers[0] if isinstance(containers, list) and len(containers) == 1 else None
    except (json.JSONDecodeError, IndexError):
        container = None
    if not isinstance(container, dict):
        raise AdminError("Docker returned invalid Hanouti POS container metadata")

    config = container.get("Config")
    host = container.get("HostConfig")
    mounts = container.get("Mounts")
    networks = container.get("NetworkSettings", {}).get("Networks")
    labels = config.get("Labels") if isinstance(config, dict) else None
    if (
        container.get("Name") != f"/{name}"
        or not isinstance(config, dict)
        or config.get("Image") != IMAGES[service]
        or not isinstance(labels, dict)
        or labels.get("com.docker.compose.project") != PROJECT
        or labels.get("com.docker.compose.service") != service
        or not isinstance(host, dict)
        or host.get("Privileged")
        or host.get("NetworkMode") != NETWORK_NAME
        or host.get("PidMode") == "host"
        or host.get("IpcMode") == "host"
        or host.get("UTSMode") == "host"
        or host.get("Devices")
        or host.get("CapAdd")
        or not isinstance(mounts, list)
        or not isinstance(networks, dict)
        or set(networks) != {NETWORK_NAME}
    ):
        raise AdminError("a POS container has an unapproved image or host integration")

    actual_volume_mounts: dict[str, tuple[str, bool]] = {}
    actual_bind_mounts: dict[str, tuple[Path, bool]] = {}
    for mount in mounts:
        if not isinstance(mount, dict):
            raise AdminError("a POS container mount is invalid")
        destination = mount.get("Destination")
        read_write = mount.get("RW")
        if not isinstance(destination, str) or not isinstance(read_write, bool):
            raise AdminError("a POS container mount is invalid")
        if mount.get("Type") == "volume":
            volume_name = mount.get("Name")
            if not isinstance(volume_name, str) or destination in actual_volume_mounts:
                raise AdminError("a POS container volume is invalid")
            actual_volume_mounts[destination] = (volume_name, read_write)
        elif mount.get("Type") == "bind":
            source = mount.get("Source")
            if not isinstance(source, str) or destination in actual_bind_mounts:
                raise AdminError("a POS container bind mount is invalid")
            actual_bind_mounts[destination] = (Path(source), read_write)
        else:
            raise AdminError("a POS container uses an unapproved mount type")

    expected_volumes = {
        target: (VOLUMES[key], read_write)
        for target, (key, read_write) in VOLUME_MOUNTS.get(service, {}).items()
    }
    if actual_volume_mounts != expected_volumes:
        raise AdminError("a POS container uses an unapproved persistent volume")
    expected_binds = {
        target: (COMPOSE_DIR / source, False)
        for source, target in BIND_MOUNTS.get(service, {}).items()
    }
    if set(actual_bind_mounts) != set(expected_binds):
        raise AdminError("a POS container uses an unapproved bind mount")
    for target, (expected_source, expected_read_write) in expected_binds.items():
        actual_source, actual_read_write = actual_bind_mounts[target]
        try:
            actual_resolved = actual_source.resolve(strict=True)
            expected_resolved = expected_source.resolve(strict=True)
            actual_resolved.relative_to(COMPOSE_DIR)
        except (OSError, ValueError):
            raise AdminError("a POS container bind mount escapes its configuration tree") from None
        if actual_resolved != expected_resolved or actual_read_write != expected_read_write:
            raise AdminError("a POS container uses an unapproved bind mount")

    bindings = host.get("PortBindings") or {}
    expected_bindings = PUBLISHED_PORTS.get(service, {})
    if bindings != expected_bindings:
        raise AdminError("a POS container publishes an unapproved host port")


def _verify_resource_ownership() -> set[str]:
    existing: set[str] = set()
    for service, name in CONTAINERS.items():
        labels = _inspect_labels(
            [DOCKER, "inspect", "--format", "{{json .Config.Labels}}", name],
            missing_ok=True,
        )
        if labels is None:
            continue
        if (
            labels.get("com.docker.compose.project") != PROJECT
            or labels.get("com.docker.compose.service") != service
        ):
            raise AdminError("a container name is owned by another or unknown project")
        _verify_existing_container(service, CONTAINERS[service])
        existing.add(service)

    for name in VOLUMES.values():
        _verify_volume_resource(name)
    _verify_network_resource()
    return existing


def _verify_volume_resource(name: str) -> None:
    result = _run([DOCKER, "volume", "inspect", name])
    if result.returncode != 0:
        message = result.stderr.casefold()
        if "no such volume" in message or ("volume" in message and "not found" in message):
            return
        raise AdminError("a required Hanouti POS volume is unavailable")
    try:
        volumes = json.loads(result.stdout)
        volume = volumes[0] if isinstance(volumes, list) and len(volumes) == 1 else None
    except (json.JSONDecodeError, IndexError):
        volume = None
    labels = volume.get("Labels") if isinstance(volume, dict) else None
    options = volume.get("Options") if isinstance(volume, dict) else None
    if (
        not isinstance(volume, dict)
        or volume.get("Name") != name
        or volume.get("Driver") != "local"
        or options not in (None, {})
        or not isinstance(labels, dict)
        or labels.get("com.docker.compose.project") != PROJECT
    ):
        raise AdminError("a persistent-volume name is owned by another or unknown project")


def _verify_network_resource() -> None:
    result = _run([DOCKER, "network", "inspect", NETWORK_NAME])
    if result.returncode != 0:
        message = result.stderr.casefold()
        if "no such network" in message or ("network" in message and "not found" in message):
            return
        raise AdminError("the Hanouti POS network is unavailable")
    try:
        networks = json.loads(result.stdout)
        network = networks[0] if isinstance(networks, list) and len(networks) == 1 else None
    except (json.JSONDecodeError, IndexError):
        network = None
    labels = network.get("Labels") if isinstance(network, dict) else None
    if (
        not isinstance(network, dict)
        or network.get("Name") != NETWORK_NAME
        or network.get("Driver") != "bridge"
        or network.get("Scope") != "local"
        or network.get("Internal")
        or network.get("Options") not in (None, {})
        or not isinstance(labels, dict)
        or labels.get("com.docker.compose.project") != PROJECT
    ):
        raise AdminError("the POS network is owned by another or unknown project")


def _check_host_port_collisions(existing: set[str]) -> None:
    result = _run([SS, "-H", "-ltn"])
    if result.returncode != 0:
        raise AdminError("host listener inventory is unavailable; refusing Compose up")
    expected = {8000: "kong", 3003: "studio"}
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) < 4:
            continue
        try:
            port = int(fields[3].rsplit(":", 1)[1])
        except (IndexError, ValueError):
            continue
        service = expected.get(port)
        if service and service not in existing:
            raise AdminError("a POS host port is occupied by an unverified listener")


def _audit(action: str, actor: str, result: str, service: str | None = None) -> None:
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", action):
        action = "invalid"
    if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", actor):
        actor = "unknown"
    if result not in {"started", "succeeded", "failed"}:
        result = "failed"
    if service not in CONTAINERS:
        service = "none"
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    line = (
        f"{timestamp} actor={actor} action={action} service={service} result={result}\n"
    ).encode("ascii")
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(ADMIN_LOG, flags, 0o600)
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_nlink != 1
        ):
            os.close(descriptor)
            raise AdminError("the privileged audit log is not safely owned")
        try:
            written = 0
            while written < len(line):
                written += os.write(descriptor, line[written:])
        finally:
            os.close(descriptor)
    except OSError:
        raise AdminError("the privileged audit log is unavailable") from None


def _service_state(name: str) -> str:
    result = _run([SYSTEMCTL, "is-active", name])
    state = result.stdout.strip()
    return state if state in {"active", "inactive", "failed", "activating", "deactivating"} else "unknown"


def _report_host_status() -> None:
    try:
        usage = shutil.disk_usage("/")
    except OSError:
        raise AdminError("root filesystem usage is unavailable") from None
    try:
        memory: dict[str, int] = {}
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            key, _, value = line.partition(":")
            if key in {"MemTotal", "MemAvailable"}:
                memory[key] = int(value.strip().split()[0]) * 1024
    except (OSError, ValueError, IndexError):
        raise AdminError("host memory information is unavailable") from None
    if not {"MemTotal", "MemAvailable"} <= memory.keys():
        raise AdminError("host memory information is incomplete")
    print(f"docker={_service_state('docker')} nginx={_service_state('nginx')}")
    print(f"disk_root_available_bytes={usage.free}")
    print(f"memory_total_bytes={memory['MemTotal']} memory_available_bytes={memory['MemAvailable']}")
    for label, path in (("supabase", COMPOSE_DIR), ("frontend", FRONTEND_DIR)):
        try:
            path_info = path.lstat()
        except FileNotFoundError:
            print(f"disk_{label}=missing")
            continue
        except OSError:
            raise AdminError(f"the POS {label} path could not be inspected") from None
        try:
            resolved_path = path.resolve(strict=True)
        except (OSError, RuntimeError):
            raise AdminError(f"the POS {label} path could not be resolved safely") from None
        if not stat.S_ISDIR(path_info.st_mode) or resolved_path != path:
            raise AdminError(f"the POS {label} path is not a real project directory")
        try:
            path_usage = shutil.disk_usage(path)
        except OSError:
            raise AdminError(f"disk usage for the POS {label} path is unavailable") from None
        print(f"disk_{label}_available_bytes={path_usage.free}")


def _report_paths() -> None:
    paths = {
        "supabase_root": COMPOSE_DIR,
        "frontend_root": FRONTEND_DIR,
        "frontend_releases": FRONTEND_DIR / "releases",
        "frontend_current": FRONTEND_DIR / "current",
    }
    for label, path in paths.items():
        try:
            info = path.lstat()
        except FileNotFoundError:
            print(f"{label}=missing")
            continue
        except OSError:
            raise AdminError("a fixed Hanouti POS path could not be inspected") from None
        kind = "symlink" if stat.S_ISLNK(info.st_mode) else "directory" if stat.S_ISDIR(info.st_mode) else "file"
        print(f"{label}=present type={kind} owner_uid={info.st_uid} mode={stat.S_IMODE(info.st_mode):04o}")


def _report_compose_status() -> None:
    containers = _existing_pos_containers()
    if not containers:
        print("hanouti-supabase=not-running")
        return
    for service, name in containers:
        result = _run(
            [
                DOCKER,
                "inspect",
                "--format",
                "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
                name,
            ]
        )
        if result.returncode != 0:
            raise AdminError("POS container state could not be read")
        state, separator, health = result.stdout.strip().partition("|")
        if not separator:
            raise AdminError("Docker returned invalid POS health information")
        if state not in {"created", "restarting", "running", "removing", "paused", "exited", "dead"}:
            state = "unknown"
        if health not in {"none", "starting", "healthy", "unhealthy"}:
            health = "unknown"
        details = f"{service}={state} health={health}"
        if state == "running":
            stats = _run(
                [
                    DOCKER,
                    "stats",
                    "--no-stream",
                    "--format",
                    "{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}",
                    name,
                ],
                timeout=30,
            )
            cpu, separator, usage_and_limit = stats.stdout.strip().partition("|")
            memory, separator2, memory_percent = usage_and_limit.partition("|")
            if (
                stats.returncode != 0
                or not separator
                or not separator2
                or not re.fullmatch(r"\d+(?:\.\d+)?%", cpu)
                or not re.fullmatch(
                    r"\d+(?:\.\d+)?[A-Za-z]+ / \d+(?:\.\d+)?[A-Za-z]+",
                    memory,
                )
                or not re.fullmatch(r"\d+(?:\.\d+)?%", memory_percent)
            ):
                raise AdminError("POS container resource information is unavailable")
            details += f" cpu={cpu} memory={memory} memory_percent={memory_percent}"
        print(details)


def _report_log_summary(service: str) -> None:
    containers = dict(_existing_pos_containers())
    name = containers.get(service)
    if not name:
        raise AdminError("the requested Hanouti POS service is not present")
    result = _run([DOCKER, "logs", "--tail", "300", "--timestamps", name], timeout=30)
    if result.returncode != 0:
        raise AdminError("POS log summary could not be generated; details withheld")
    lines = result.stdout.splitlines()
    errors = sum(bool(re.search(r"\b(error|fatal|panic|exception)\b", line, re.I)) for line in lines)
    warnings = sum(bool(re.search(r"\b(warn|warning)\b", line, re.I)) for line in lines)
    print(f"{service}_log_lines={len(lines)} errors={errors} warnings={warnings}")


def _frontend_layout() -> tuple[Path, Path, int]:
    try:
        import pwd

        root_info = FRONTEND_DIR.lstat()
        releases_info = (FRONTEND_DIR / "releases").lstat()
        deploy_uid = pwd.getpwnam("hanouti-deploy").pw_uid
    except (OSError, KeyError, RuntimeError):
        raise AdminError("the Hanouti POS frontend release layout is unavailable") from None
    releases = FRONTEND_DIR / "releases"
    try:
        root_resolved = FRONTEND_DIR.resolve(strict=True)
        releases_resolved = releases.resolve(strict=True)
    except (OSError, RuntimeError):
        raise AdminError("the Hanouti POS frontend release layout is not safely resolvable") from None
    if (
        not stat.S_ISDIR(root_info.st_mode)
        or root_info.st_uid != deploy_uid
        or root_info.st_mode & 0o022
        or root_resolved != FRONTEND_DIR
        or not stat.S_ISDIR(releases_info.st_mode)
        or releases_info.st_uid != deploy_uid
        or releases_info.st_mode & 0o022
        or releases_resolved != releases
    ):
        raise AdminError("the Hanouti POS frontend release layout is not safely owned")
    return FRONTEND_DIR, releases, deploy_uid


def _frontend_target(pointer: Path, releases: Path, deploy_uid: int) -> Path:
    try:
        link_info = pointer.lstat()
        target = pointer.resolve(strict=True)
        target_info = target.stat()
        target.relative_to(releases)
        index_info = (target / "index.html").lstat()
        version_info = (target / "version.json").lstat()
    except (OSError, ValueError, RuntimeError):
        raise AdminError("a Hanouti POS frontend release pointer is missing or unsafe") from None
    if (
        not stat.S_ISLNK(link_info.st_mode)
        or link_info.st_uid != deploy_uid
        or target.parent != releases
        or not stat.S_ISDIR(target_info.st_mode)
        or target_info.st_uid != deploy_uid
        or target_info.st_mode & 0o022
        or not stat.S_ISREG(index_info.st_mode)
        or not stat.S_ISREG(version_info.st_mode)
        or index_info.st_size == 0
        or version_info.st_size == 0
    ):
        raise AdminError("a Hanouti POS frontend release pointer is not a verified release")
    return target


def _report_frontend_status() -> None:
    root, releases, deploy_uid = _frontend_layout()
    for label in ("current", "previous"):
        pointer = root / label
        try:
            present = pointer.exists() or pointer.is_symlink()
        except OSError:
            raise AdminError("a fixed frontend release pointer could not be inspected") from None
        if not present:
            print(f"frontend_{label}=missing")
            continue
        target = _frontend_target(pointer, releases, deploy_uid)
        print(f"frontend_{label}={target.name}")


def _check_endpoints() -> None:
    endpoints = (
        ("frontend", "https://hanouti-pos.tn/"),
        ("frontend_version", "https://hanouti-pos.tn/version.json"),
        ("auth_health", "https://hanouti-pos.tn/auth/v1/health"),
    )
    failures: list[str] = []
    for label, url in endpoints:
        result = _run(
            [
                CURL,
                "--silent",
                "--show-error",
                "--proto",
                "=https",
                "--tlsv1.2",
                "--connect-timeout",
                "5",
                "--max-time",
                "15",
                "--output",
                os.devnull,
                "--write-out",
                "%{http_code}",
                url,
            ],
            timeout=20,
        )
        status = result.stdout.strip()
        if result.returncode != 0 or not re.fullmatch(r"[1-5][0-9]{2}", status):
            print(f"{label}=unreachable")
            failures.append(label)
            continue
        print(f"{label}=http-{status}")
        if status != "200":
            failures.append(label)
    if failures:
        raise AdminError("one or more fixed Hanouti POS HTTPS health checks failed")


def _report_certificate() -> None:
    result = _run(
        [
            OPENSSL,
            "x509",
            "-in",
            str(CERTIFICATE),
            "-noout",
            "-dates",
            "-ext",
            "subjectAltName",
        ]
    )
    if result.returncode != 0:
        raise AdminError("the Hanouti POS certificate is missing or unreadable")
    lines = result.stdout.splitlines()
    sans_line = " ".join(line.strip() for line in lines if "DNS:" in line)
    if not re.search(r"(^|[\s,])DNS:hanouti-pos\.tn($|[\s,])", sans_line):
        raise AdminError("the certificate does not cover hanouti-pos.tn")
    for line in lines:
        if line.startswith("notBefore=") or line.startswith("notAfter="):
            print(line)
    expiry = _run(
        [OPENSSL, "x509", "-in", str(CERTIFICATE), "-checkend", "0", "-noout"]
    )
    print(f"certificate={'valid' if expiry.returncode == 0 else 'expired'}")
    renew_soon = _run(
        [OPENSSL, "x509", "-in", str(CERTIFICATE), "-checkend", "2592000", "-noout"]
    )
    print(f"renewal_due_within_30_days={'no' if renew_soon.returncode == 0 else 'yes'}")
    print("san=hanouti-pos.tn")


def _run_action(request: dict[str, str]) -> None:
    action = request["action"]
    if action == "host-status":
        _report_host_status()
    elif action == "paths":
        _report_paths()
    elif action == "compose-validate":
        _load_compose_document()
        print("compose-validation=passed")
    elif action == "compose-preflight":
        _load_compose_document()
        existing = _verify_resource_ownership()
        _check_host_port_collisions(existing)
        print("compose-preflight=passed")
    elif action == "compose-status":
        _report_compose_status()
    elif action == "compose-health":
        _report_compose_status()
    elif action == "compose-log-summary":
        _report_log_summary(request["service"])
    elif action == "compose-pull":
        _load_compose_document()
        _verify_resource_ownership()
        result = _run(compose_prefix() + ["pull"], timeout=900)
        if result.returncode != 0:
            raise AdminError("Hanouti POS image preparation failed; details withheld")
        print("compose-pull=completed")
    elif action == "compose-up":
        _load_compose_document()
        existing = _verify_resource_ownership()
        _check_host_port_collisions(existing)
        result = _run(compose_prefix() + ["up", "--detach"], timeout=900)
        if result.returncode != 0:
            raise AdminError("Hanouti POS Compose up failed; details withheld")
        print("compose-up=completed")
    elif action == "compose-stop":
        containers = _existing_pos_containers()
        if not containers:
            print("compose-stop=no-running-pos-containers")
            return
        result = _run([DOCKER, "stop", *[name for _, name in containers]], timeout=120)
        if result.returncode != 0:
            raise AdminError("Hanouti POS Compose stop failed; details withheld")
        print("compose-stop=completed")
    elif action == "compose-restart":
        service = request["service"]
        containers = dict((item_service, name) for item_service, name in _existing_pos_containers())
        name = containers.get(service)
        if not name:
            raise AdminError("the requested Hanouti POS service is not present")
        result = _run([DOCKER, "restart", name], timeout=120)
        if result.returncode != 0:
            raise AdminError("Hanouti POS service restart failed; details withheld")
        print(f"{service}=restarted")
    elif action == "database-ready":
        containers = dict((item_service, name) for item_service, name in _existing_pos_containers())
        name = containers.get("db")
        if not name:
            raise AdminError("the Hanouti POS database container is not present")
        result = _run(
            [DOCKER, "exec", name, "pg_isready", "-U", "postgres", "-h", "127.0.0.1", "-p", "5432"]
        )
        if result.returncode != 0:
            raise AdminError("the Hanouti POS database is not accepting connections")
        print("database-ready=yes")
    elif action == "endpoint-health":
        _check_endpoints()
    elif action == "frontend-status":
        _report_frontend_status()
    elif action == "nginx-test":
        result = _run([NGINX, "-t"], timeout=30)
        if result.returncode != 0:
            raise AdminError("Nginx configuration test failed; details withheld")
        print("nginx-configuration=valid")
    elif action == "certificate-status":
        _report_certificate()
    else:
        raise AdminError("unknown administrative action")


def main() -> int:
    if len(sys.argv) != 1:
        print("arguments are not accepted", file=sys.stderr)
        return 64
    if os.geteuid() != 0:
        print("this interface requires its exact sudo authorization", file=sys.stderr)
        return 77

    actor = os.environ.get("SUDO_USER", "unknown")
    try:
        raw = sys.stdin.buffer.readline(MAX_REQUEST_BYTES + 2)
        if len(raw) > MAX_REQUEST_BYTES or sys.stdin.buffer.read(1):
            raise ValueError("invalid request framing")
        request = parse_request(raw)
    except ValueError:
        try:
            _audit("invalid", actor, "failed")
        except AdminError:
            pass
        print("request rejected", file=sys.stderr)
        return 64

    action = request["action"]
    try:
        service = request.get("service")
        _audit(action, actor, "started", service)
        _run_action(request)
        _audit(action, actor, "succeeded", service)
        return 0
    except AdminError as error:
        try:
            _audit(action, actor, "failed", request.get("service"))
        except AdminError:
            pass
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
