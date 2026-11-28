#!/usr/bin/python3
"""Versioned, fixed-scope Hanouti POS administration entry point."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import tarfile
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any


CORE_PATH = Path(__file__).with_name("hanouti_pos_admin.py")
CORE_SPEC = importlib.util.spec_from_file_location("hanouti_pos_admin_v2_core", CORE_PATH)
if CORE_SPEC is None or CORE_SPEC.loader is None:
    raise RuntimeError("the fixed Hanouti POS core module is unavailable")
CORE = importlib.util.module_from_spec(CORE_SPEC)
CORE_SPEC.loader.exec_module(CORE)

ADMIN_LOG = Path("/var/log/hanouti-pos-admin-v3.log")
CORE.ADMIN_LOG = ADMIN_LOG
BACKUP_DIR = Path("/var/backups/hanouti-pos")
BACKUP_RECIPIENT = Path("/etc/hanouti-pos-admin-v3/backup-recipient.asc")
BACKUP_FINGERPRINT = Path("/etc/hanouti-pos-admin-v3/backup-recipient-fingerprint")
RUN_DIR = Path("/run/hanouti-pos-admin-v3")
GPG = "/usr/bin/gpg"
SSH_KEYGEN = "/usr/bin/ssh-keygen"
DOCKER = CORE.DOCKER
DB_CONTAINER = CORE.CONTAINERS["db"]
SOURCE_DATABASE = "postgres"
MAX_REQUEST_BYTES = 512
BACKUP_ID_PATTERN = re.compile(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}")
BACKUP_TIMESTAMP_PATTERN = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\+00:00"
)
BACKUP_SIGNING_KEY = Path("/etc/hanouti-pos-admin-v3/backup-manifest-signing")
BACKUP_SIGNERS = Path("/etc/hanouti-pos-admin-v3/backup-manifest.allowed_signers")
BACKUP_SIGNER_ID = "hanouti-pos-backup"
BACKUP_SIGNATURE_NAMESPACE = "hanouti-pos-backup-manifest"
FUNCTIONS_SIGNERS = Path("/etc/hanouti-pos-admin-v3/functions.allowed_signers")
FUNCTIONS_SIGNER_ID = "hanouti-pos-functions"
FUNCTIONS_SIGNATURE_NAMESPACE = "hanouti-pos-edge-functions"
FUNCTIONS_RELEASE_ROOT = CORE.COMPOSE_DIR / "volumes/functions/releases"
FUNCTIONS_CURRENT = CORE.COMPOSE_DIR / "volumes/functions/current"
FUNCTIONS_PREVIOUS = CORE.COMPOSE_DIR / "volumes/functions/previous"
STACK_RELEASE_ROOT = CORE.COMPOSE_DIR / "releases"
STACK_STATE_DIR = Path("/var/lib/hanouti-pos-admin-v3")
STACK_STATE_FILE = STACK_STATE_DIR / "stack-state.json"
STACK_SIGNER_ID = "hanouti-pos-functions"
STACK_SIGNATURE_NAMESPACE = "hanouti-pos-supabase-stack"
DEFAULT_STACK_IMAGES = dict(CORE.IMAGES)
DEPLOYMENT_ID_PATTERN = re.compile(r"[a-f0-9]{40}-[0-9]{1,20}-[0-9]{1,4}")
STACK_RELEASE_ID_PATTERN = re.compile(
    r"(?:[a-f0-9]{40}-[0-9]{1,20}-[0-9]{1,4}|baseline-[a-f0-9]{12})"
)

READ_ONLY_ACTIONS = {
    "host-status",
    "paths",
    "compose-validate",
    "compose-preflight",
    "compose-status",
    "compose-health",
    "compose-log-summary",
    "database-ready",
    "endpoint-health",
    "frontend-status",
    "nginx-test",
    "certificate-status",
    "database-backup-list",
}
SERVICE_ACTIONS = {"compose-log-summary"}
BACKUP_ID_ACTIONS = {"database-backup-verify", "database-backup-export"}
RELEASE_ID_ACTIONS = {"functions-deploy", "stack-deploy"}
ALLOWED_ACTIONS = (
    READ_ONLY_ACTIONS
    | {"database-backup", "functions-rollback", "stack-rollback", "backup-signer"}
    | BACKUP_ID_ACTIONS
    | RELEASE_ID_ACTIONS
)


AdminError = CORE.AdminError


@contextmanager
def _operation_lock(name: str):
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", name):
        raise AdminError("administrative operation lock name is invalid")
    _owned_directory(RUN_DIR, 0o700)
    lock_path = RUN_DIR / f"{name}.lock"
    flags = os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    descriptor: int | None = None
    try:
        descriptor = os.open(lock_path, flags, 0o600)
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_nlink != 1
        ):
            raise AdminError("the administrative operation lock is unsafe")
        import fcntl

        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except AdminError:
        if descriptor is not None:
            os.close(descriptor)
        raise
    except OSError:
        if descriptor is not None:
            os.close(descriptor)
        raise AdminError("the administrative operation could not acquire its lock") from None
    try:
        yield
    finally:
        try:
            import fcntl

            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


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

    action = request.get("action")
    if not isinstance(action, str) or action not in ALLOWED_ACTIONS:
        raise ValueError("unknown action")
    if action in SERVICE_ACTIONS:
        if set(request) != {"action", "service"}:
            raise ValueError("the action requires exactly one allowlisted service")
        service = request["service"]
        if not isinstance(service, str) or service not in CORE.CONTAINERS:
            raise ValueError("service is not allowlisted")
    elif action in BACKUP_ID_ACTIONS:
        if set(request) != {"action", "backup_id"}:
            raise ValueError("the action requires exactly one backup ID")
        backup_id = request["backup_id"]
        if not isinstance(backup_id, str) or not BACKUP_ID_PATTERN.fullmatch(backup_id):
            raise ValueError("backup ID is invalid")
    elif action in RELEASE_ID_ACTIONS:
        expected_fields = (
            {"action", "release_id", "backup_id"}
            if action == "stack-deploy"
            else {"action", "release_id"}
        )
        if set(request) != expected_fields:
            raise ValueError("the action requires its exact release metadata")
        release_id = request["release_id"]
        if not isinstance(release_id, str) or not DEPLOYMENT_ID_PATTERN.fullmatch(release_id):
            raise ValueError("release ID is invalid")
        if action == "stack-deploy":
            backup_id = request["backup_id"]
            if not isinstance(backup_id, str) or not BACKUP_ID_PATTERN.fullmatch(backup_id):
                raise ValueError("stack deployment requires a verified backup ID")
    elif set(request) != {"action"}:
        raise ValueError("unexpected request fields")
    return request


def _safe_environment() -> dict[str, str]:
    return {
        "HOME": "/root",
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    }


def _run(
    command: list[str], *, timeout: int = 30, stdin: Any = subprocess.DEVNULL
) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            command,
            stdin=stdin,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=_safe_environment(),
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise AdminError("the fixed administrative command could not complete") from None


def _run_input(command: list[str], data: bytes, *, timeout: int = 30) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            command,
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=_safe_environment(),
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise AdminError("the fixed administrative command could not complete") from None


def _sign_backup_manifest(path: Path) -> Path:
    _owned_file(BACKUP_SIGNING_KEY)
    if stat.S_IMODE(BACKUP_SIGNING_KEY.lstat().st_mode) != 0o600:
        raise AdminError("the POS backup signing key has unsafe permissions")
    result = _run(
        [
            SSH_KEYGEN,
            "-Y",
            "sign",
            "-f",
            str(BACKUP_SIGNING_KEY),
            "-n",
            BACKUP_SIGNATURE_NAMESPACE,
            str(path),
        ]
    )
    signature = Path(f"{path}.sig")
    if result.returncode != 0:
        raise AdminError("the POS backup manifest could not be signed")
    try:
        os.chmod(signature, 0o600)
    except OSError:
        raise AdminError("the POS backup manifest signature could not be secured") from None
    _owned_file(signature)
    return signature


def _verify_backup_manifest(manifest: bytes, signature: bytes) -> None:
    signers = _owned_file(BACKUP_SIGNERS, private=False)
    if not signature or len(signature) > 1024 * 1024:
        raise AdminError("the POS backup signature is invalid")
    with tempfile.NamedTemporaryFile(prefix="manifest-signature-", dir=RUN_DIR) as source:
        source.write(signature)
        source.flush()
        result = _run_input(
            [
                SSH_KEYGEN,
                "-Y",
                "verify",
                "-f",
                str(BACKUP_SIGNERS),
                "-I",
                BACKUP_SIGNER_ID,
                "-n",
                BACKUP_SIGNATURE_NAMESPACE,
                "-s",
                source.name,
            ],
            manifest,
        )
    if result.returncode != 0:
        raise AdminError("the POS backup manifest signature is invalid")


def _owned_directory(path: Path, mode: int) -> None:
    try:
        info = path.lstat()
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError):
        raise AdminError("a required POS backup directory is unavailable") from None
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != 0
        or stat.S_IMODE(info.st_mode) != mode
        or resolved != path
    ):
        raise AdminError("a POS backup directory has unsafe ownership or permissions")


def _owned_file(path: Path, *, private: bool = True) -> bytes:
    try:
        info = path.lstat()
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or info.st_nlink != 1
            or info.st_size > 1024 * 1024
            or info.st_mode & 0o022
            or (private and info.st_mode & 0o077)
        ):
            raise AdminError("a POS backup configuration file is unsafe")
        return path.read_bytes()
    except AdminError:
        raise
    except OSError:
        raise AdminError("a required POS backup configuration file is unavailable") from None


def _owned_regular_file(path: Path, *, private: bool = True) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError:
        raise AdminError("a required POS backup file is unavailable") from None
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_nlink != 1
        or info.st_mode & 0o022
        or (private and info.st_mode & 0o077)
    ):
        raise AdminError("a POS backup file has unsafe ownership or permissions")
    return info


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
    except OSError:
        raise AdminError("a POS backup file could not be verified") from None
    return digest.hexdigest()


def _require_pos_database() -> None:
    CORE._load_compose_document()
    containers = dict(CORE._existing_pos_containers())
    if containers.get("db") != DB_CONTAINER:
        raise AdminError("the verified Hanouti POS database container is unavailable")
    CORE._verify_resource_ownership()


def _backup_key_fingerprint(home: Path) -> str:
    try:
        fingerprint_bytes = _owned_file(BACKUP_FINGERPRINT)
        fingerprint = fingerprint_bytes.decode("ascii", errors="strict").strip()
    except UnicodeDecodeError:
        raise AdminError("the configured POS backup recipient fingerprint is invalid") from None
    if not re.fullmatch(r"[A-F0-9]{40,64}", fingerprint):
        raise AdminError("the configured POS backup recipient fingerprint is invalid")
    recipient_data = _owned_file(BACKUP_RECIPIENT, private=False)
    key_path = home / "recipient.asc"
    key_path.write_bytes(recipient_data)
    os.chmod(key_path, 0o600)
    result = _run(
        [
            GPG,
            "--no-options",
            "--batch",
            "--homedir",
            str(home),
            "--with-colons",
            "--import-options",
            "show-only",
            "--import",
            str(key_path),
        ]
    )
    if result.returncode != 0:
        raise AdminError("the POS backup recipient key could not be validated")
    records = [
        line.split(":")
        for line in result.stdout.decode("utf-8", errors="replace").splitlines()
    ]
    primary_count = sum(1 for fields in records if fields[0] == "pub")
    primary_fingerprints: list[str] = []
    primary_pending = False
    has_encryption_key = False
    for fields in records:
        if fields[0] == "pub":
            primary_pending = True
            has_encryption_key = has_encryption_key or (
                len(fields) > 11 and "e" in fields[11].lower()
            )
        elif fields[0] == "sub":
            primary_pending = False
            has_encryption_key = has_encryption_key or (
                len(fields) > 11 and "e" in fields[11].lower()
            )
        elif fields[0] == "fpr" and primary_pending and len(fields) > 9:
            primary_fingerprints.append(fields[9])
            primary_pending = False
    if primary_count != 1 or primary_fingerprints != [fingerprint] or not has_encryption_key:
        raise AdminError("the POS backup key does not match its pinned fingerprint")
    imported = _run(
        [GPG, "--no-options", "--batch", "--homedir", str(home), "--import", str(key_path)]
    )
    if imported.returncode != 0:
        raise AdminError("the POS backup recipient key could not be loaded")
    return fingerprint


def _new_backup_id() -> str:
    import secrets

    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4)


def _write_exclusive(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    created = False
    try:
        descriptor = os.open(path, flags, 0o600)
        created = True
        with os.fdopen(descriptor, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
    except OSError:
        if created:
            path.unlink(missing_ok=True)
        raise AdminError("a POS backup file could not be created without overwrite") from None


def _create_backup() -> None:
    _require_pos_database()
    _owned_directory(BACKUP_DIR, 0o700)
    _owned_directory(RUN_DIR, 0o700)
    backup_id = _new_backup_id()
    archive_path = BACKUP_DIR / f"{backup_id}.gpg"
    manifest_path = BACKUP_DIR / f"{backup_id}.json"
    temp_archive = BACKUP_DIR / f".{backup_id}.gpg.tmp"

    with tempfile.TemporaryDirectory(prefix="backup-", dir=RUN_DIR) as gpg_home_text:
        gpg_home = Path(gpg_home_text)
        os.chmod(gpg_home, 0o700)
        fingerprint = _backup_key_fingerprint(gpg_home)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(temp_archive, flags, 0o600)
        except OSError:
            raise AdminError("a temporary POS backup file could not be created") from None
        try:
            with os.fdopen(descriptor, "wb") as encrypted:
                dump = None
                encrypt = None
                try:
                    dump = subprocess.Popen(
                        [
                            DOCKER,
                            "exec",
                            DB_CONTAINER,
                            "pg_dump",
                            "--format=custom",
                            "--username=postgres",
                            f"--dbname={SOURCE_DATABASE}",
                        ],
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.DEVNULL,
                        env=_safe_environment(),
                    )
                    if dump.stdout is None:
                        raise AdminError("the POS database dump could not be streamed")
                    encrypt = subprocess.Popen(
                        [
                            GPG,
                            "--no-options",
                            "--batch",
                            "--trust-model",
                            "always",
                            "--homedir",
                            str(gpg_home),
                            "--output",
                            "-",
                            "--encrypt",
                            "--recipient",
                            fingerprint,
                        ],
                        stdin=dump.stdout,
                        stdout=encrypted,
                        stderr=subprocess.DEVNULL,
                        env=_safe_environment(),
                    )
                    dump.stdout.close()
                    try:
                        encrypt.wait(timeout=3600)
                        dump.wait(timeout=3600)
                    except subprocess.TimeoutExpired:
                        encrypt.kill()
                        dump.kill()
                        encrypt.wait()
                        dump.wait()
                        raise
                except (OSError, subprocess.TimeoutExpired):
                    for process in (encrypt, dump):
                        if process is not None and process.poll() is None:
                            process.kill()
                            process.wait()
                    raise AdminError("the encrypted POS database backup did not complete") from None
                if dump.returncode != 0 or encrypt.returncode != 0:
                    raise AdminError("the encrypted POS database backup did not complete")
                encrypted.flush()
                os.fsync(encrypted.fileno())
        except Exception:
            temp_archive.unlink(missing_ok=True)
            raise

    digest = _sha256_file(temp_archive)
    byte_count = temp_archive.stat().st_size
    manifest = json.dumps(
        {
            "backup_id": backup_id,
            "database": SOURCE_DATABASE,
            "encrypted_bytes": byte_count,
            "sha256": digest,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("ascii") + b"\n"
    manifest_temp = BACKUP_DIR / f".{backup_id}.json.tmp"
    signature_temp = Path(f"{manifest_temp}.sig")
    manifest_temp_created = False
    archive_finalized = False
    manifest_finalized = False
    signature_finalized = False
    try:
        os.link(temp_archive, archive_path, follow_symlinks=False)
        archive_finalized = True
        _write_exclusive(manifest_temp, manifest)
        manifest_temp_created = True
        signature_temp = _sign_backup_manifest(manifest_temp)
        os.link(manifest_temp, manifest_path, follow_symlinks=False)
        manifest_finalized = True
        os.link(signature_temp, Path(f"{manifest_path}.sig"), follow_symlinks=False)
        signature_finalized = True
    except (OSError, AdminError):
        if signature_finalized:
            Path(f"{manifest_path}.sig").unlink(missing_ok=True)
        if manifest_finalized:
            manifest_path.unlink(missing_ok=True)
        if archive_finalized:
            archive_path.unlink(missing_ok=True)
        raise AdminError("the POS backup could not be finalized safely") from None
    finally:
        temp_archive.unlink(missing_ok=True)
        if manifest_temp_created:
            manifest_temp.unlink(missing_ok=True)
        signature_temp.unlink(missing_ok=True)
    print(f"database-backup=completed backup_id={backup_id} bytes={byte_count} sha256={digest}")


def _verified_backup_metadata(backup_id: str) -> tuple[Path, dict[str, Any]]:
    if not BACKUP_ID_PATTERN.fullmatch(backup_id):
        raise AdminError("backup ID is invalid")
    _owned_directory(BACKUP_DIR, 0o700)
    archive = BACKUP_DIR / f"{backup_id}.gpg"
    manifest_path = BACKUP_DIR / f"{backup_id}.json"
    signature_path = Path(f"{manifest_path}.sig")
    archive_info = _owned_regular_file(archive)
    manifest_bytes = _owned_file(manifest_path)
    _owned_regular_file(signature_path)
    signature = _owned_file(signature_path)
    _owned_directory(RUN_DIR, 0o700)
    _verify_backup_manifest(manifest_bytes, signature)
    try:
        manifest = json.loads(manifest_bytes.decode("ascii"))
    except (UnicodeDecodeError, ValueError):
        raise AdminError("the POS backup manifest is invalid") from None
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"backup_id", "database", "encrypted_bytes", "sha256", "created_at"}
        or manifest["backup_id"] != backup_id
        or manifest["database"] != SOURCE_DATABASE
        or manifest["encrypted_bytes"] != archive_info.st_size
        or not isinstance(manifest["sha256"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", manifest["sha256"])
        or _sha256_file(archive) != manifest["sha256"]
    ):
        raise AdminError("the POS backup integrity check failed")
    created_at = manifest["created_at"]
    if not isinstance(created_at, str) or not BACKUP_TIMESTAMP_PATTERN.fullmatch(created_at):
        raise AdminError("the POS backup manifest timestamp is invalid")
    try:
        timestamp = datetime.fromisoformat(created_at)
    except ValueError:
        raise AdminError("the POS backup manifest timestamp is invalid") from None
    if (
        timestamp.utcoffset() != timezone.utc.utcoffset(timestamp)
        or timestamp.isoformat(timespec="seconds") != created_at
    ):
        raise AdminError("the POS backup manifest timestamp is invalid")
    return archive, manifest


def _verified_backup(backup_id: str) -> Path:
    archive, _ = _verified_backup_metadata(backup_id)
    return archive


def _list_backups() -> None:
    _owned_directory(BACKUP_DIR, 0o700)
    candidates: set[str] = set()
    try:
        with os.scandir(BACKUP_DIR) as entries:
            for entry in entries:
                for suffix in (".json.sig", ".json", ".gpg"):
                    if not entry.name.endswith(suffix):
                        continue
                    backup_id = entry.name[: -len(suffix)]
                    if BACKUP_ID_PATTERN.fullmatch(backup_id):
                        candidates.add(backup_id)
                    break
    except OSError:
        raise AdminError("the POS backup directory could not be inspected") from None

    verified: list[tuple[str, str]] = []
    for backup_id in sorted(candidates):
        _, manifest = _verified_backup_metadata(backup_id)
        verified.append((backup_id, manifest["created_at"]))

    print(f"database-backup-list=completed count={len(verified)}")
    for backup_id, created_at in verified:
        print(f"backup_id={backup_id} created_at={created_at} status=verified")


def _export_backup(backup_id: str) -> None:
    archive = _verified_backup(backup_id)
    manifest = BACKUP_DIR / f"{backup_id}.json"
    signature = Path(f"{manifest}.sig")
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as bundle:
        for path in (archive, manifest, signature):
            info = tarfile.TarInfo(path.name)
            info.size = path.stat().st_size
            info.mode = 0o600
            info.mtime = 0
            with path.open("rb") as source:
                bundle.addfile(info, source)


def _copy_staged_file(source: Path, target: Path, deploy_uid: int) -> None:
    try:
        info = source.lstat()
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != deploy_uid
            or info.st_nlink != 1
            or info.st_mode & 0o077
            or info.st_size > 536870912
        ):
            raise AdminError("a staged Edge Function release file is unsafe")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        source_fd = os.open(source, flags)
        opened = os.fstat(source_fd)
        if (opened.st_dev, opened.st_ino) != (info.st_dev, info.st_ino):
            os.close(source_fd)
            raise AdminError("a staged Edge Function release file changed during validation")
        target_fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(source_fd, "rb") as input_file, os.fdopen(target_fd, "wb") as output_file:
            shutil.copyfileobj(input_file, output_file, length=1024 * 1024)
            output_file.flush()
            os.fsync(output_file.fileno())
    except AdminError:
        raise
    except OSError:
        raise AdminError("a staged Edge Function release file could not be copied safely") from None


def _verify_signed_artifact(
    archive: Path,
    signature: Path,
    namespace: str,
    description: str,
) -> None:
    _owned_file(FUNCTIONS_SIGNERS, private=False)
    _owned_regular_file(signature)
    try:
        with archive.open("rb") as signed_data:
            result = _run(
                [
                    SSH_KEYGEN,
                    "-Y",
                    "verify",
                    "-f",
                    str(FUNCTIONS_SIGNERS),
                    "-I",
                    FUNCTIONS_SIGNER_ID,
                    "-n",
                    namespace,
                    "-s",
                    str(signature),
                ],
                stdin=signed_data,
            )
    except OSError:
        raise AdminError(f"the signed {description} package could not be verified") from None
    if result.returncode != 0:
        raise AdminError(f"the {description} package signature is invalid")


def _verify_functions_signature(archive: Path, signature: Path) -> None:
    _verify_signed_artifact(
        archive,
        signature,
        FUNCTIONS_SIGNATURE_NAMESPACE,
        "Edge Function",
    )


def _verify_stack_signature(archive: Path, signature: Path) -> None:
    _verify_signed_artifact(
        archive,
        signature,
        STACK_SIGNATURE_NAMESPACE,
        "Supabase stack",
    )


def _extract_functions_archive(archive_path: Path, target: Path) -> None:
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            members = archive.getmembers()
            if not members or len(members) > 20000:
                raise AdminError("the Edge Function release archive has an unsafe entry count")
            seen: set[str] = set()
            discovered: set[str] = set()
            total_size = 0
            for member in members:
                name = PurePosixPath(member.name)
                normalized = name.as_posix().rstrip("/")
                if (
                    not normalized
                    or name.is_absolute()
                    or ".." in name.parts
                    or "\\" in member.name
                    or normalized in seen
                    or not (member.isdir() or member.isfile())
                ):
                    raise AdminError("the Edge Function release archive contains an unsafe path")
                seen.add(normalized)
                output_path = target.joinpath(*name.parts)
                if member.isdir():
                    output_path.mkdir(parents=True, exist_ok=True, mode=0o755)
                    continue
                total_size += member.size
                if member.size < 0 or total_size > 536870912:
                    raise AdminError("the Edge Function release exceeds safe size limits")
                source = archive.extractfile(member)
                if source is None:
                    raise AdminError("the Edge Function release archive is incomplete")
                output_path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                descriptor = os.open(
                    output_path,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                    0o644,
                )
                with source, os.fdopen(descriptor, "wb") as output:
                    copied = 0
                    while True:
                        block = source.read(1024 * 1024)
                        if not block:
                            break
                        copied += len(block)
                        if copied > member.size:
                            raise AdminError("an Edge Function archive entry exceeded its declared size")
                        output.write(block)
                    if copied != member.size:
                        raise AdminError("an Edge Function archive entry was truncated")
                    output.flush()
                    os.fsync(output.fileno())
                discovered.add(output_path.relative_to(target).as_posix())
        if not CORE.FUNCTION_RELEASE_REQUIRED_FILES <= discovered:
            raise AdminError("the Edge Function release is incomplete")
        for current, directories, files in os.walk(target, followlinks=False):
            for name in directories:
                os.chmod(Path(current) / name, 0o755)
            for name in files:
                os.chmod(Path(current) / name, 0o644)
        os.chmod(target, 0o755)
    except AdminError:
        raise
    except (OSError, tarfile.TarError):
        raise AdminError("the Edge Function release archive could not be extracted safely") from None


def _switch_functions_pointer(pointer: Path, target: Path, release_id: str) -> None:
    temporary = pointer.with_name(f".{pointer.name}-{release_id}.tmp")
    if temporary.exists() or temporary.is_symlink():
        raise AdminError("a temporary Edge Function release pointer already exists")
    try:
        os.symlink(target, temporary)
        os.replace(temporary, pointer)
    except OSError:
        temporary.unlink(missing_ok=True)
        raise AdminError("the Edge Function release pointer could not be switched atomically") from None


def _functions_release_target(pointer: Path) -> Path | None:
    try:
        info = pointer.lstat()
    except FileNotFoundError:
        return None
    except OSError:
        raise AdminError("an Edge Function release pointer could not be inspected") from None
    if not stat.S_ISLNK(info.st_mode) or info.st_uid != 0:
        raise AdminError("an Edge Function release pointer is unsafe")
    try:
        target = pointer.resolve(strict=True)
        target.relative_to(FUNCTIONS_RELEASE_ROOT)
        target_info = target.stat()
    except (OSError, ValueError):
        raise AdminError("an Edge Function release pointer escapes its release directory") from None
    if (
        target.parent != FUNCTIONS_RELEASE_ROOT
        or not stat.S_ISDIR(target_info.st_mode)
        or target_info.st_uid != 0
    ):
        raise AdminError("an Edge Function release pointer targets an unsafe directory")
    CORE._validate_functions_release_tree(target)
    return target


def _restart_functions() -> None:
    CORE._load_compose_document()
    CORE._verify_resource_ownership()
    result = CORE._run(
        CORE.compose_prefix() + ["up", "-d", "--no-deps", "functions"],
        timeout=120,
    )
    if result.returncode != 0:
        raise AdminError("the POS Edge Functions service could not be restarted")
    for _ in range(90):
        state = CORE._run(
            [
                DOCKER,
                "inspect",
                "--format",
                "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
                CORE.CONTAINERS["functions"],
            ]
        )
        if state.returncode == 0:
            status, separator, health = state.stdout.decode("utf-8", errors="replace").strip().partition("|")
            if separator and status == "running" and health in {"healthy", "none"}:
                return
            if health == "unhealthy" or status in {"exited", "dead"}:
                break
        time.sleep(1)
    raise AdminError("the POS Edge Functions service did not become healthy")


def _deploy_functions_locked(release_id: str) -> None:
    if not DEPLOYMENT_ID_PATTERN.fullmatch(release_id):
        raise AdminError("release ID is invalid")
    _require_pos_database()
    _owned_directory(FUNCTIONS_RELEASE_ROOT, 0o755)
    _owned_directory(RUN_DIR, 0o700)
    deploy_uid = CORE.pwd.getpwnam("hanouti-deploy").pw_uid
    staging_parent = Path(CORE.pwd.getpwnam("hanouti-deploy").pw_dir) / "staging/supabase-edge-functions"
    staging_dir = staging_parent / release_id
    try:
        parent_info = staging_parent.lstat()
        staging_info = staging_dir.lstat()
        if (
            not stat.S_ISDIR(parent_info.st_mode)
            or parent_info.st_uid != deploy_uid
            or stat.S_IMODE(parent_info.st_mode) != 0o700
            or not stat.S_ISDIR(staging_info.st_mode)
            or staging_info.st_uid != deploy_uid
            or stat.S_IMODE(staging_info.st_mode) != 0o700
            or staging_parent.resolve(strict=True) != staging_parent
            or staging_dir.resolve(strict=True) != staging_dir
        ):
            raise AdminError("the staged Edge Function release directory is unsafe")
    except (OSError, RuntimeError):
        raise AdminError("the staged Edge Function release directory is unavailable") from None

    archive_name = f"supabase-edge-functions-{release_id}.tar.gz"
    with tempfile.TemporaryDirectory(prefix="functions-", dir=RUN_DIR) as temporary_text:
        temporary = Path(temporary_text)
        archive = temporary / archive_name
        signature = temporary / f"{archive_name}.sig"
        checksum = temporary / f"{archive_name}.sha256"
        _copy_staged_file(staging_dir / archive_name, archive, deploy_uid)
        _copy_staged_file(staging_dir / f"{archive_name}.sig", signature, deploy_uid)
        _copy_staged_file(staging_dir / f"{archive_name}.sha256", checksum, deploy_uid)
        if signature.stat().st_size > 1024 * 1024 or checksum.stat().st_size > 1024:
            raise AdminError("the staged Edge Function signature or checksum is too large")
        checksum_text = checksum.read_text(encoding="ascii")
        expected_line = f"{_sha256_file(archive)}  {archive_name}\n"
        if checksum_text != expected_line:
            raise AdminError("the staged Edge Function checksum is invalid")
        _verify_functions_signature(archive, signature)

        release_path = FUNCTIONS_RELEASE_ROOT / release_id
        if release_path.exists() or release_path.is_symlink():
            raise AdminError("the requested Edge Function release already exists")
        extraction = Path(tempfile.mkdtemp(prefix=f".{release_id}-", dir=FUNCTIONS_RELEASE_ROOT))
        try:
            _extract_functions_archive(archive, extraction)
            os.rename(extraction, release_path)
        except Exception:
            shutil.rmtree(extraction, ignore_errors=True)
            raise

    previous = _functions_release_target(FUNCTIONS_CURRENT)
    current_previous = _functions_release_target(FUNCTIONS_PREVIOUS)
    try:
        if previous is not None:
            _switch_functions_pointer(FUNCTIONS_PREVIOUS, previous, release_id)
        _switch_functions_pointer(FUNCTIONS_CURRENT, release_path, release_id)
        _restart_functions()
    except AdminError:
        try:
            if previous is None:
                FUNCTIONS_CURRENT.unlink(missing_ok=True)
            else:
                _switch_functions_pointer(FUNCTIONS_CURRENT, previous, f"rollback-{release_id}")
            if current_previous is None:
                FUNCTIONS_PREVIOUS.unlink(missing_ok=True)
            else:
                _switch_functions_pointer(FUNCTIONS_PREVIOUS, current_previous, f"rollback-prev-{release_id}")
            _restart_functions()
        except AdminError:
            raise AdminError("Edge Function deployment failed and automatic rollback requires operator attention") from None
        raise
    print(f"functions-deploy=completed release_id={release_id}")


def _deploy_functions(release_id: str) -> None:
    with _operation_lock("functions"):
        _deploy_functions_locked(release_id)


def _rollback_functions_locked() -> None:
    current = _functions_release_target(FUNCTIONS_CURRENT)
    previous = _functions_release_target(FUNCTIONS_PREVIOUS)
    if current is None or previous is None or current == previous:
        raise AdminError("a verified prior Edge Function release is not available")
    suffix = f"rollback-{int(time.time())}"
    try:
        _switch_functions_pointer(FUNCTIONS_PREVIOUS, current, suffix)
        _switch_functions_pointer(FUNCTIONS_CURRENT, previous, suffix)
        _restart_functions()
    except AdminError:
        try:
            _switch_functions_pointer(FUNCTIONS_CURRENT, current, f"restore-{suffix}")
            _switch_functions_pointer(FUNCTIONS_PREVIOUS, previous, f"restore-prev-{suffix}")
            _restart_functions()
        except AdminError:
            raise AdminError("Edge Function rollback failed and requires operator attention") from None
        raise
    print(f"functions-rollback=completed release_id={previous.name}")


def _rollback_functions() -> None:
    with _operation_lock("functions"):
        _rollback_functions_locked()


def _validate_stack_images(images: Any) -> dict[str, str]:
    if not isinstance(images, dict) or set(images) != set(DEFAULT_STACK_IMAGES):
        raise AdminError("the Supabase stack release image set is invalid")
    validated: dict[str, str] = {}
    for service, image in images.items():
        if not isinstance(image, str) or ":" not in image:
            raise AdminError("the Supabase stack release contains an invalid image")
        repository, separator, tag = image.rpartition(":")
        expected_repository = DEFAULT_STACK_IMAGES[service].rpartition(":")[0]
        if (
            not separator
            or repository != expected_repository
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}", tag)
            or tag.casefold() == "latest"
        ):
            raise AdminError("the Supabase stack release contains an unapproved image reference")
        validated[service] = image
    return validated


def _stack_release_files(release_id: str) -> tuple[Path, dict[str, str]]:
    if not STACK_RELEASE_ID_PATTERN.fullmatch(release_id):
        raise AdminError("the Supabase stack release ID is invalid")
    release_dir = STACK_RELEASE_ROOT / release_id
    try:
        info = release_dir.lstat()
    except OSError:
        raise AdminError("the requested Supabase stack release is unavailable") from None
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != 0
        or stat.S_IMODE(info.st_mode) != 0o755
        or release_dir.resolve(strict=True) != release_dir
    ):
        raise AdminError("the Supabase stack release directory is unsafe")
    try:
        if set(os.listdir(release_dir)) != {"docker-compose.yml", "release.json"}:
            raise AdminError("the Supabase stack release contains unexpected files")
    except OSError:
        raise AdminError("the Supabase stack release could not be inspected") from None
    compose_path = release_dir / "docker-compose.yml"
    manifest_path = release_dir / "release.json"
    compose_bytes = _owned_file(compose_path, private=False)
    if len(compose_bytes) > 4 * 1024 * 1024:
        raise AdminError("the Supabase stack Compose file exceeds the safe size limit")
    manifest_bytes = _owned_file(manifest_path, private=False)
    try:
        manifest = json.loads(manifest_bytes.decode("ascii"))
    except (UnicodeDecodeError, ValueError):
        raise AdminError("the Supabase stack release manifest is invalid") from None
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"release_id", "images"}
        or manifest["release_id"] != release_id
    ):
        raise AdminError("the Supabase stack release manifest is invalid")
    return compose_path, _validate_stack_images(manifest["images"])


def _validate_stack_release(release_id: str) -> dict[str, str]:
    compose_path, images = _stack_release_files(release_id)
    original_compose = CORE.COMPOSE_FILE
    original_images = CORE.IMAGES
    try:
        CORE.COMPOSE_FILE = compose_path
        CORE.IMAGES = images
        CORE._load_compose_document()
    finally:
        CORE.COMPOSE_FILE = original_compose
        CORE.IMAGES = original_images
    return images


def _stack_state() -> dict[str, str | None] | None:
    try:
        info = STACK_STATE_FILE.lstat()
    except FileNotFoundError:
        return None
    except OSError:
        raise AdminError("the Supabase stack release state is unavailable") from None
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_nlink != 1
        or stat.S_IMODE(info.st_mode) != 0o600
    ):
        raise AdminError("the Supabase stack release state is unsafe")
    try:
        state = json.loads(STACK_STATE_FILE.read_text(encoding="ascii"))
    except (OSError, UnicodeDecodeError, ValueError):
        raise AdminError("the Supabase stack release state is invalid") from None
    if (
        not isinstance(state, dict)
        or set(state) != {"active", "previous"}
        or not isinstance(state["active"], str)
        or not STACK_RELEASE_ID_PATTERN.fullmatch(state["active"])
        or (
            state["previous"] is not None
            and (
                not isinstance(state["previous"], str)
                or not STACK_RELEASE_ID_PATTERN.fullmatch(state["previous"])
            )
        )
    ):
        raise AdminError("the Supabase stack release state is invalid")
    return state


def _write_stack_state(active: str, previous: str | None) -> None:
    if not STACK_RELEASE_ID_PATTERN.fullmatch(active) or (
        previous is not None and not STACK_RELEASE_ID_PATTERN.fullmatch(previous)
    ):
        raise AdminError("the Supabase stack release state is invalid")
    _owned_directory(STACK_STATE_DIR, 0o700)
    temporary = STACK_STATE_DIR / f".stack-state-{os.getpid()}.tmp"
    data = json.dumps(
        {"active": active, "previous": previous},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("ascii") + b"\n"
    try:
        _write_exclusive(temporary, data)
        os.replace(temporary, STACK_STATE_FILE)
    except (OSError, AdminError):
        temporary.unlink(missing_ok=True)
        raise AdminError("the Supabase stack release state could not be written safely") from None


def _initialize_stack_state() -> dict[str, str | None]:
    state = _stack_state()
    if state is not None:
        return state
    _owned_directory(STACK_RELEASE_ROOT, 0o755)
    _owned_directory(STACK_STATE_DIR, 0o700)
    CORE._load_compose_document()
    active_bytes = _owned_file(CORE.COMPOSE_FILE, private=False)
    baseline_id = "baseline-" + hashlib.sha256(active_bytes).hexdigest()[:12]
    baseline_dir = STACK_RELEASE_ROOT / baseline_id
    if not baseline_dir.exists():
        baseline_dir.mkdir(mode=0o755)
        try:
            _write_exclusive(baseline_dir / "docker-compose.yml", active_bytes)
            _write_exclusive(
                baseline_dir / "release.json",
                json.dumps(
                    {"release_id": baseline_id, "images": DEFAULT_STACK_IMAGES},
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("ascii")
                + b"\n",
            )
            os.chmod(baseline_dir / "docker-compose.yml", 0o644)
            os.chmod(baseline_dir / "release.json", 0o644)
        except Exception:
            shutil.rmtree(baseline_dir, ignore_errors=True)
            raise
    _write_stack_state(baseline_id, None)
    return {"active": baseline_id, "previous": None}


def _ensure_stack_context() -> None:
    state = _stack_state()
    if state is None:
        CORE.IMAGES = DEFAULT_STACK_IMAGES
        return
    images = _validate_stack_release(state["active"])
    compose_path, _ = _stack_release_files(state["active"])
    try:
        active_hash = _sha256_file(CORE.COMPOSE_FILE)
        release_hash = _sha256_file(compose_path)
    except AdminError:
        raise AdminError("the active Supabase stack configuration could not be verified") from None
    if active_hash != release_hash:
        raise AdminError("the active Supabase stack configuration differs from its release")
    CORE.IMAGES = images


def _install_stack_compose(release_id: str) -> None:
    compose_path, _ = _stack_release_files(release_id)
    temporary = CORE.COMPOSE_DIR / f".docker-compose-{release_id}.tmp"
    if temporary.exists() or temporary.is_symlink():
        raise AdminError("a temporary Supabase stack configuration already exists")
    try:
        data = _owned_file(compose_path, private=False)
        _write_exclusive(temporary, data)
        os.chmod(temporary, 0o644)
        os.replace(temporary, CORE.COMPOSE_FILE)
    except (OSError, AdminError):
        temporary.unlink(missing_ok=True)
        raise AdminError("the active Supabase stack configuration could not be switched safely") from None


def _stack_health_check(images: dict[str, str]) -> None:
    CORE.IMAGES = images
    containers = dict(CORE._existing_pos_containers())
    if set(containers) != set(CORE.CONTAINERS):
        raise AdminError("not all approved Supabase services are present after deployment")
    for _ in range(300):
        all_healthy = True
        for service, container in CORE.CONTAINERS.items():
            result = CORE._run(
                [
                    DOCKER,
                    "inspect",
                    "--format",
                    "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
                    container,
                ]
            )
            if result.returncode != 0:
                all_healthy = False
                break
            status, separator, health = result.stdout.decode("utf-8", errors="replace").strip().partition("|")
            if not separator or status != "running" or health not in {"healthy", "none"}:
                all_healthy = False
                if health == "unhealthy" or status in {"exited", "dead"}:
                    raise AdminError("a Supabase service did not pass its container health check")
                break
        if all_healthy:
            return
        time.sleep(1)
    raise AdminError("the Supabase stack did not become healthy before timeout")


def _run_stack_compose(images: dict[str, str]) -> None:
    CORE.IMAGES = images
    CORE._load_compose_document()
    result = CORE._run(CORE.compose_prefix() + ["up", "-d"], timeout=3600)
    if result.returncode != 0:
        raise AdminError("the versioned Supabase stack could not be activated")
    CORE._verify_resource_ownership()
    _stack_health_check(images)


def _extract_stack_release(archive_path: Path, release_id: str) -> Path:
    if not DEPLOYMENT_ID_PATTERN.fullmatch(release_id):
        raise AdminError("release ID is invalid")
    release_dir = STACK_RELEASE_ROOT / release_id
    if release_dir.exists() or release_dir.is_symlink():
        raise AdminError("the requested Supabase stack release already exists")
    release_dir.mkdir(mode=0o700)
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            members = archive.getmembers()
            if len(members) != 2:
                raise AdminError("the Supabase stack package must contain exactly two files")
            discovered: set[str] = set()
            for member in members:
                if (
                    member.name not in {"docker-compose.yml", "release.json"}
                    or not member.isfile()
                    or member.size < 0
                    or member.size > 4 * 1024 * 1024
                    or member.name in discovered
                ):
                    raise AdminError("the Supabase stack package contains an unsafe entry")
                source = archive.extractfile(member)
                if source is None:
                    raise AdminError("the Supabase stack package is incomplete")
                target = release_dir / member.name
                descriptor = os.open(
                    target,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                    0o644,
                )
                with source, os.fdopen(descriptor, "wb") as output:
                    data = source.read(member.size + 1)
                    if len(data) != member.size:
                        raise AdminError("a Supabase stack package file is truncated")
                    output.write(data)
                    output.flush()
                    os.fsync(output.fileno())
                discovered.add(member.name)
        if discovered != {"docker-compose.yml", "release.json"}:
            raise AdminError("the Supabase stack package is incomplete")
        os.chmod(release_dir, 0o755)
        _stack_release_files(release_id)
        return release_dir
    except Exception:
        shutil.rmtree(release_dir, ignore_errors=True)
        raise


def _deploy_stack_locked(release_id: str, backup_id: str) -> None:
    if not DEPLOYMENT_ID_PATTERN.fullmatch(release_id):
        raise AdminError("release ID is invalid")
    _verified_backup(backup_id)
    _owned_directory(RUN_DIR, 0o700)
    _owned_directory(STACK_RELEASE_ROOT, 0o755)
    _owned_directory(STACK_STATE_DIR, 0o700)
    staging_parent = Path(CORE.pwd.getpwnam("hanouti-deploy").pw_dir) / "staging/supabase-stack"
    staging_dir = staging_parent / release_id
    deploy_uid = CORE.pwd.getpwnam("hanouti-deploy").pw_uid
    try:
        parent_info = staging_parent.lstat()
        stage_info = staging_dir.lstat()
        if (
            not stat.S_ISDIR(parent_info.st_mode)
            or parent_info.st_uid != deploy_uid
            or stat.S_IMODE(parent_info.st_mode) != 0o700
            or not stat.S_ISDIR(stage_info.st_mode)
            or stage_info.st_uid != deploy_uid
            or stat.S_IMODE(stage_info.st_mode) != 0o700
            or staging_parent.resolve(strict=True) != staging_parent
            or staging_dir.resolve(strict=True) != staging_dir
        ):
            raise AdminError("the staged Supabase stack release directory is unsafe")
    except (OSError, RuntimeError):
        raise AdminError("the staged Supabase stack release directory is unavailable") from None

    archive_name = f"supabase-stack-{release_id}.tar.gz"
    with tempfile.TemporaryDirectory(prefix="stack-", dir=RUN_DIR) as temporary_text:
        temporary = Path(temporary_text)
        archive = temporary / archive_name
        signature = temporary / f"{archive_name}.sig"
        checksum = temporary / f"{archive_name}.sha256"
        _copy_staged_file(staging_dir / archive_name, archive, deploy_uid)
        _copy_staged_file(staging_dir / f"{archive_name}.sig", signature, deploy_uid)
        _copy_staged_file(staging_dir / f"{archive_name}.sha256", checksum, deploy_uid)
        if signature.stat().st_size > 1024 * 1024 or checksum.stat().st_size > 1024:
            raise AdminError("the staged Supabase stack signature or checksum is too large")
        if checksum.read_text(encoding="ascii") != f"{_sha256_file(archive)}  {archive_name}\n":
            raise AdminError("the staged Supabase stack checksum is invalid")
        _verify_stack_signature(archive, signature)
        release_dir = _extract_stack_release(archive, release_id)
    state = _initialize_stack_state()
    _ensure_stack_context()
    previous_id = state["active"]
    previous_images = _validate_stack_release(previous_id)
    CORE._verify_resource_ownership()
    new_images = _validate_stack_release(release_id)
    release_compose, _ = _stack_release_files(release_id)
    original_compose = CORE.COMPOSE_FILE
    original_images = CORE.IMAGES
    try:
        CORE.COMPOSE_FILE = release_compose
        CORE.IMAGES = new_images
        CORE._load_compose_document()
        pulled = CORE._run(CORE.compose_prefix() + ["pull"], timeout=3600)
        if pulled.returncode != 0:
            raise AdminError("the versioned Supabase stack images could not be pulled")
    finally:
        CORE.COMPOSE_FILE = original_compose
        CORE.IMAGES = original_images

    try:
        _install_stack_compose(release_id)
        _run_stack_compose(new_images)
        _write_stack_state(release_id, previous_id)
    except AdminError:
        try:
            _install_stack_compose(previous_id)
            _run_stack_compose(previous_images)
            _write_stack_state(previous_id, state["previous"])
        except AdminError:
            raise AdminError("Supabase stack deployment failed and safe rollback requires operator attention") from None
        raise
    print(f"stack-deploy=completed release_id={release_id}")


def _deploy_stack(release_id: str, backup_id: str) -> None:
    with _operation_lock("stack"):
        _deploy_stack_locked(release_id, backup_id)


def _rollback_stack_locked() -> None:
    _owned_directory(STACK_STATE_DIR, 0o700)
    state = _initialize_stack_state()
    if state["previous"] is None or state["active"] == state["previous"]:
        raise AdminError("a verified prior Supabase stack release is not available")
    active_id = state["active"]
    previous_id = state["previous"]
    active_images = _validate_stack_release(active_id)
    previous_images = _validate_stack_release(previous_id)
    _ensure_stack_context()
    CORE._verify_resource_ownership()
    try:
        _install_stack_compose(previous_id)
        _run_stack_compose(previous_images)
        _write_stack_state(previous_id, active_id)
    except AdminError:
        try:
            _install_stack_compose(active_id)
            _run_stack_compose(active_images)
            _write_stack_state(active_id, previous_id)
        except AdminError:
            raise AdminError("Supabase stack rollback failed and requires operator attention") from None
        raise
    print(f"stack-rollback=completed release_id={previous_id}")


def _rollback_stack() -> None:
    with _operation_lock("stack"):
        _rollback_stack_locked()


def _run_action(request: dict[str, str]) -> None:
    action = request["action"]
    if action not in {
        "stack-deploy",
        "stack-rollback",
        "backup-signer",
        "database-backup-list",
    }:
        _ensure_stack_context()
    if action == "database-backup-list":
        _list_backups()
    elif action in READ_ONLY_ACTIONS:
        CORE._run_action(request)
    elif action == "database-backup":
        _create_backup()
    elif action == "database-backup-verify":
        _verified_backup(request["backup_id"])
        print(f"database-backup-verify=passed backup_id={request['backup_id']}")
    elif action == "database-backup-export":
        _export_backup(request["backup_id"])
    elif action == "functions-deploy":
        _deploy_functions(request["release_id"])
    elif action == "functions-rollback":
        _rollback_functions()
    elif action == "stack-deploy":
        _deploy_stack(request["release_id"], request["backup_id"])
    elif action == "stack-rollback":
        _rollback_stack()
    elif action == "backup-signer":
        signer_data = _owned_file(BACKUP_SIGNERS, private=False)
        sys.stdout.buffer.write(signer_data)
        sys.stdout.buffer.flush()
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
            CORE._audit("invalid", actor, "failed")
        except AdminError:
            pass
        print("request rejected", file=sys.stderr)
        return 64

    action = request["action"]
    service = request.get("service")
    try:
        CORE._audit(action, actor, "started", service)
        _run_action(request)
        CORE._audit(action, actor, "succeeded", service)
        return 0
    except AdminError as error:
        try:
            CORE._audit(action, actor, "failed", service)
        except AdminError:
            pass
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
