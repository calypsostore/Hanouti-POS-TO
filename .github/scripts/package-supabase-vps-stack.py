#!/usr/bin/env python3
"""Package a versioned Compose file and its image inventory for VPS deployment."""

from __future__ import annotations

import argparse
import io
import json
import re
import tarfile
from pathlib import Path


EXPECTED_SERVICES = {
    "db",
    "auth",
    "rest",
    "realtime",
    "storage",
    "imgproxy",
    "functions",
    "meta",
    "studio",
    "kong",
    "supavisor",
}
EXPECTED_REPOSITORIES = {
    "db": "supabase/postgres",
    "auth": "supabase/gotrue",
    "rest": "postgrest/postgrest",
    "realtime": "supabase/realtime",
    "storage": "supabase/storage-api",
    "imgproxy": "ghcr.io/imgproxy/imgproxy",
    "functions": "supabase/edge-runtime",
    "meta": "supabase/postgres-meta",
    "studio": "supabase/studio",
    "kong": "kong/kong",
    "supavisor": "supabase/supavisor",
}
RELEASE_ID_PATTERN = re.compile(r"[a-f0-9]{40}-[0-9]{1,20}-[0-9]{1,4}")


def image_inventory(compose_text: str) -> dict[str, str]:
    services: dict[str, str] = {}
    starts = list(re.finditer(r"(?m)^  ([A-Za-z0-9_-]+):\s*$", compose_text))
    for index, start in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(compose_text)
        block = compose_text[start.end() : end]
        image = re.search(r"(?m)^    image:\s*([^\s#]+)\s*$", block)
        if image is not None:
            service = start.group(1)
            if service in services:
                raise ValueError("duplicate service in Compose file")
            services[service] = image.group(1)
    if set(services) != EXPECTED_SERVICES:
        raise ValueError("Compose file does not contain the exact approved service image set")
    for service, image in services.items():
        repository, separator, tag = image.rpartition(":")
        if (
            not separator
            or repository != EXPECTED_REPOSITORIES[service]
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}", tag)
            or tag.casefold() == "latest"
        ):
            raise ValueError(f"Compose uses an unapproved or unpinned image for {service}")
    return services


def package(compose_path: Path, release_id: str, output: Path) -> None:
    if not RELEASE_ID_PATTERN.fullmatch(release_id):
        raise ValueError("invalid stack release ID")
    compose = compose_path.read_text(encoding="utf-8")
    images = image_inventory(compose)
    manifest = json.dumps(
        {"release_id": release_id, "images": images},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("ascii") + b"\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for name, data in (
            ("docker-compose.yml", compose.encode("utf-8")),
            ("release.json", manifest),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            archive.addfile(info, io.BytesIO(data))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose", type=Path, required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    package(args.compose, args.release_id, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
