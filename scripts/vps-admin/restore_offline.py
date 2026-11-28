#!/usr/bin/env python3
"""Verify and restore a signed, encrypted POS backup into local recovery only."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


BACKUP_ID_PATTERN = re.compile(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}")
RECOVERY_DATABASE_PATTERN = re.compile(r"hanouti_recovery_[a-z0-9_]{1,48}")
SIGNER_ID = "hanouti-pos-backup"
SIGNATURE_NAMESPACE = "hanouti-pos-backup-manifest"
MAX_BACKUP_BYTES = 64 * 1024 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024


class RestoreError(Exception):
    """A safe-to-display offline recovery failure."""


def _read_bundle(
    bundle_path: Path, work_dir: Path
) -> tuple[Path, bytes, bytes, dict[str, object]]:
    try:
        with tarfile.open(bundle_path, "r:*") as archive:
            members = archive.getmembers()
            if len(members) != 3:
                raise RestoreError("backup bundle must contain exactly three files")
            entries: dict[str, tarfile.TarInfo] = {}
            for member in members:
                name = PurePosixPath(member.name)
                if (
                    name.is_absolute()
                    or len(name.parts) != 1
                    or "\\" in member.name
                    or not member.isfile()
                    or member.size < 0
                    or member.size > MAX_BACKUP_BYTES
                    or member.name in entries
                ):
                    raise RestoreError("backup bundle contains an unsafe entry")
                entries[member.name] = member
    except RestoreError:
        raise
    except (OSError, tarfile.TarError):
        raise RestoreError("backup bundle could not be read") from None

    manifest_names = [name for name in entries if name.endswith(".json")]
    signature_names = [name for name in entries if name.endswith(".json.sig")]
    archive_names = [name for name in entries if name.endswith(".gpg")]
    if len(manifest_names) != 1 or len(signature_names) != 1 or len(archive_names) != 1:
        raise RestoreError("backup bundle entries do not match the required format")
    manifest_name = manifest_names[0]
    archive_name = archive_names[0]
    if signature_names[0] != f"{manifest_name}.sig":
        raise RestoreError("backup manifest signature filename is invalid")
    backup_id = manifest_name.removesuffix(".json")
    if (
        not BACKUP_ID_PATTERN.fullmatch(backup_id)
        or archive_name != f"{backup_id}.gpg"
        or entries[manifest_name].size > MAX_MANIFEST_BYTES
        or entries[signature_names[0]].size > MAX_MANIFEST_BYTES
    ):
        raise RestoreError("backup bundle ID or manifest size is invalid")
    metadata_bytes = {}
    archive_path = work_dir / archive_name
    digest = hashlib.sha256()
    copied = 0
    try:
        with tarfile.open(bundle_path, "r:*") as archive:
            for member_name, member in entries.items():
                source = archive.extractfile(member)
                if source is None:
                    raise RestoreError("backup bundle is incomplete")
                if member_name == archive_name:
                    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
                    try:
                        descriptor = os.open(archive_path, flags, 0o600)
                    except OSError:
                        source.close()
                        raise RestoreError("encrypted archive could not be staged safely") from None
                    with source, os.fdopen(descriptor, "wb") as target:
                        for block in iter(lambda: source.read(1024 * 1024), b""):
                            copied += len(block)
                            if copied > MAX_BACKUP_BYTES:
                                raise RestoreError("encrypted backup exceeds the supported size")
                            digest.update(block)
                            target.write(block)
                        target.flush()
                        os.fsync(target.fileno())
                else:
                    with source:
                        value = source.read(member.size + 1)
                    if len(value) != member.size:
                        raise RestoreError("backup bundle entry size is invalid")
                    metadata_bytes[member_name] = value
    except RestoreError:
        raise
    except (OSError, tarfile.TarError):
        raise RestoreError("backup bundle could not be extracted safely") from None
    if copied != entries[archive_name].size:
        raise RestoreError("backup bundle archive size is invalid")
    manifest_bytes = metadata_bytes[manifest_name]
    signature_bytes = metadata_bytes[signature_names[0]]
    try:
        manifest = json.loads(manifest_bytes.decode("ascii"))
    except (UnicodeDecodeError, ValueError):
        raise RestoreError("backup manifest is invalid") from None
    if (
        not isinstance(manifest, dict)
        or set(manifest) != {"backup_id", "database", "encrypted_bytes", "sha256", "created_at"}
        or manifest["backup_id"] != backup_id
        or manifest["database"] != "postgres"
        or manifest["encrypted_bytes"] != copied
        or not isinstance(manifest["sha256"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", manifest["sha256"])
        or digest.hexdigest() != manifest["sha256"]
    ):
        raise RestoreError("backup archive integrity verification failed")
    return archive_path, manifest_bytes, signature_bytes, manifest


def _verify_signature(
    manifest: bytes,
    signature: bytes,
    trusted_signers: Path,
    work_dir: Path,
    ssh_keygen: str,
) -> None:
    signature_path = work_dir / "backup-manifest.json.sig"
    signature_path.write_bytes(signature)
    try:
        result = subprocess.run(
            [
                ssh_keygen,
                "-Y",
                "verify",
                "-f",
                str(trusted_signers),
                "-I",
                SIGNER_ID,
                "-n",
                SIGNATURE_NAMESPACE,
                "-s",
                str(signature_path),
            ],
            input=manifest,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise RestoreError("backup manifest signature verification could not complete") from None
    if result.returncode != 0:
        raise RestoreError("backup manifest signature is invalid")


def _gpg_path_argument(value: str | Path, executable: str) -> str:
    if os.name != "nt":
        return str(value)
    resolved_executable = shutil.which(executable) or executable
    cygpath = Path(resolved_executable).parent / "cygpath.exe"
    if not cygpath.is_file():
        return str(value)
    drive, tail = os.path.splitdrive(str(Path(value).resolve()))
    if not drive or not tail.startswith(("\\", "/")):
        raise RestoreError("a Windows GPG path could not be converted safely")
    return f"/{drive[0].lower()}{tail.replace(chr(92), '/')}"


def _resolve_gpg(executable: str) -> str:
    resolved = shutil.which(executable)
    if resolved:
        return resolved
    if os.name == "nt":
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        candidates = [
            Path(program_files) / "Git" / "usr" / "bin" / "gpg.exe",
        ]
        program_files_x86 = os.environ.get("ProgramFiles(x86)")
        if program_files_x86:
            candidates.append(Path(program_files_x86) / "Git" / "usr" / "bin" / "gpg.exe")
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
    return executable


def _stream_restore(
    archive_path: Path,
    *,
    gpg: str,
    pg_restore: str,
    environment: dict[str, str],
) -> None:
    decrypt = None
    restore = None
    gpg = _resolve_gpg(gpg)
    gpg_environment = dict(environment)
    gpg_home = gpg_environment.get("GNUPGHOME")
    if gpg_home:
        gpg_home = _gpg_path_argument(gpg_home, gpg)
        gpg_environment["GNUPGHOME"] = gpg_home
    archive_argument = _gpg_path_argument(archive_path, gpg)
    decrypt_command = [gpg, "--no-options", "--batch"]
    if gpg_home:
        decrypt_command.extend(["--homedir", gpg_home])
    decrypt_command.extend(
        ["--decrypt", "--output", "-", archive_argument]
    )
    try:
        decrypt = subprocess.Popen(
            decrypt_command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=gpg_environment,
        )
        if decrypt.stdout is None:
            raise RestoreError("encrypted backup could not be streamed")
        restore = subprocess.Popen(
            [
                pg_restore,
                "--format=custom",
                "--exit-on-error",
                "--no-owner",
                "--no-acl",
                "--dbname",
                environment["PGDATABASE"],
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=environment,
        )
        if restore.stdin is None:
            raise RestoreError("recovery database stream could not be opened")
        with decrypt.stdout:
            shutil.copyfileobj(decrypt.stdout, restore.stdin, length=1024 * 1024)
        restore.stdin.close()
        restore_code = restore.wait(timeout=3600)
        decrypt_code = decrypt.wait(timeout=3600)
    except (OSError, subprocess.TimeoutExpired):
        for process in (restore, decrypt):
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
        raise RestoreError("offline PostgreSQL restore did not complete") from None
    finally:
        for stream in (
            decrypt.stdout if decrypt is not None else None,
            restore.stdin if restore is not None else None,
        ):
            if stream is not None and not stream.closed:
                stream.close()
    if restore_code != 0 or decrypt_code != 0:
        raise RestoreError("offline PostgreSQL restore failed; recovery database may be incomplete")


def restore(
    bundle_path: Path,
    trusted_signers: Path,
    confirmation: str,
    *,
    gpg_home: Path | None = None,
    gpg: str = "gpg",
    pg_restore: str = "pg_restore",
    ssh_keygen: str = "ssh-keygen",
    environment: dict[str, str] | None = None,
) -> str:
    supplied_environment = dict(os.environ if environment is None else environment)
    database = supplied_environment.get("PGDATABASE", "")
    host = supplied_environment.get("PGHOST", "")
    try:
        host_is_loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        host_is_loopback = False
    if (
        not RECOVERY_DATABASE_PATTERN.fullmatch(database)
        or confirmation != database
        or not host_is_loopback
    ):
        raise RestoreError(
            "restore requires a loopback PGHOST, hanouti_recovery_* PGDATABASE, and exact confirmation"
        )
    if not bundle_path.is_file() or bundle_path.is_symlink():
        raise RestoreError("encrypted backup bundle is missing or unsafe")
    if not trusted_signers.is_file() or trusted_signers.is_symlink():
        raise RestoreError("the independently trusted backup signer file is missing or unsafe")
    selected_gpg_home = gpg_home
    if selected_gpg_home is None and supplied_environment.get("GNUPGHOME"):
        selected_gpg_home = Path(supplied_environment["GNUPGHOME"])
    if selected_gpg_home is not None:
        if selected_gpg_home.is_symlink() or not selected_gpg_home.is_dir():
            raise RestoreError("the configured OpenPGP key home is missing or unsafe")
        selected_gpg_home = selected_gpg_home.resolve(strict=True)
    source_environment = {
        "PATH": supplied_environment.get("PATH", os.defpath),
        "HOME": supplied_environment.get("HOME", str(Path.home())),
        "LANG": supplied_environment.get("LANG", "C.UTF-8"),
        "PGHOST": host,
        "PGDATABASE": database,
    }
    if selected_gpg_home is not None:
        source_environment["GNUPGHOME"] = str(selected_gpg_home)
    for name in ("PGPORT", "PGUSER", "PGPASSWORD", "PGSSLMODE"):
        if name in supplied_environment:
            source_environment[name] = supplied_environment[name]
    with tempfile.TemporaryDirectory(prefix="hanouti-pos-restore-") as directory:
        work_dir = Path(directory)
        archive, manifest, signature, metadata = _read_bundle(bundle_path, work_dir)
        _verify_signature(manifest, signature, trusted_signers, work_dir, ssh_keygen)
        _stream_restore(
            archive,
            gpg=gpg,
            pg_restore=pg_restore,
            environment=source_environment,
        )
    return str(metadata["backup_id"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--trusted-signers", type=Path, required=True)
    parser.add_argument("--confirm-database", required=True)
    parser.add_argument("--gpg-home", type=Path)
    args = parser.parse_args()
    try:
        backup_id = restore(
            args.bundle,
            args.trusted_signers,
            args.confirm_database,
            gpg_home=args.gpg_home,
        )
    except RestoreError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"offline-restore=completed backup_id={backup_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
