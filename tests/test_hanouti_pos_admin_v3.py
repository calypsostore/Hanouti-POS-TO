import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
import tarfile
import io
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import call, patch


MODULE_PATH = (
    Path(__file__).parents[1]
    / "scripts"
    / "vps-admin"
    / "hanouti_pos_admin_v3.py"
)
SPEC = importlib.util.spec_from_file_location("hanouti_pos_admin_v3", MODULE_PATH)
ADMIN = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(ADMIN)

RESTORE_PATH = MODULE_PATH.with_name("restore_offline.py")
RESTORE_SPEC = importlib.util.spec_from_file_location("restore_offline", RESTORE_PATH)
RESTORE = importlib.util.module_from_spec(RESTORE_SPEC)
assert RESTORE_SPEC and RESTORE_SPEC.loader
RESTORE_SPEC.loader.exec_module(RESTORE)
STACK_PACKAGE_PATH = (
    Path(__file__).parents[1] / ".github" / "scripts" / "package-supabase-vps-stack.py"
)
STACK_PACKAGE_SPEC = importlib.util.spec_from_file_location(
    "package_supabase_vps_stack", STACK_PACKAGE_PATH
)
STACK_PACKAGE = importlib.util.module_from_spec(STACK_PACKAGE_SPEC)
assert STACK_PACKAGE_SPEC and STACK_PACKAGE_SPEC.loader
STACK_PACKAGE_SPEC.loader.exec_module(STACK_PACKAGE)


class RequestValidationTests(unittest.TestCase):
    def parse(self, request):
        return ADMIN.parse_request(json.dumps(request).encode("ascii") + b"\n")

    def test_accepts_fixed_read_only_and_backup_actions(self):
        self.assertEqual(self.parse({"action": "host-status"})["action"], "host-status")
        self.assertEqual(
            self.parse({"action": "compose-log-summary", "service": "auth"})["service"],
            "auth",
        )
        self.assertEqual(
            self.parse({"action": "database-backup"})["action"],
            "database-backup",
        )
        self.assertEqual(
            self.parse(
                {
                    "action": "database-backup-export",
                    "backup_id": "20260305T120000Z-a1b2c3d4",
                }
            )["action"],
            "database-backup-export",
        )
        self.assertEqual(
            self.parse(
                {
                    "action": "database-backup-verify",
                    "backup_id": "20260305T120000Z-a1b2c3d4",
                }
            )["backup_id"],
            "20260305T120000Z-a1b2c3d4",
        )
        self.assertEqual(
            self.parse(
                {
                    "action": "functions-deploy",
                    "release_id": "a" * 40 + "-123456789-1",
                }
            )["release_id"],
            "a" * 40 + "-123456789-1",
        )
        self.assertEqual(self.parse({"action": "functions-rollback"})["action"], "functions-rollback")
        self.assertEqual(
            self.parse(
                {
                    "action": "stack-deploy",
                    "release_id": "b" * 40 + "-42-1",
                    "backup_id": "20260305T120000Z-a1b2c3d4",
                }
            )["action"],
            "stack-deploy",
        )
        self.assertEqual(self.parse({"action": "stack-rollback"})["action"], "stack-rollback")
        self.assertEqual(self.parse({"action": "backup-signer"})["action"], "backup-signer")
        self.assertEqual(
            self.parse({"action": "database-backup-list"})["action"],
            "database-backup-list",
        )

    def test_powershell_client_allowlists_match_the_helper(self):
        client = (
            MODULE_PATH.parent / "hanouti-pos-admin-v3.ps1"
        ).read_text(encoding="utf-8")
        blocks = re.findall(
            r"\[ValidateSet\((.*?)\)\]\s*\[string\]\$(Action|Service)",
            client,
            re.S,
        )
        allowlists = {
            name: set(re.findall(r"'([^']+)'", block))
            for block, name in blocks
        }
        self.assertEqual(allowlists.get("Action"), ADMIN.ALLOWED_ACTIONS)
        self.assertEqual(allowlists.get("Service"), set(ADMIN.CORE.CONTAINERS))

    def test_restore_is_not_exposed_while_offline_key_handoff_is_unresolved(self):
        with self.assertRaisesRegex(ValueError, "unknown action"):
            self.parse(
                {
                    "action": "database-restore",
                    "backup_id": "20260305T120000Z-a1b2c3d4",
                    "confirm": "RESTORE",
                }
            )

    def test_rejects_shell_commands_store_services_and_mutating_compose_actions(self):
        invalid_requests = (
            {"action": "shell", "command": "id"},
            {"action": "compose-restart", "service": "hanouti-stores"},
            {"action": "compose-log-summary", "service": "hanouti-stores"},
            {"action": "compose-stop"},
            {"action": "compose-up"},
            {"action": "compose-pull"},
            {"action": "nginx-reload"},
            {"action": "database-backup", "path": "/tmp/backup"},
            {"action": "database-backup-verify", "backup_id": "../latest"},
            {"action": "database-backup-list", "path": "/var/backups"},
        )
        for request in invalid_requests:
            with self.subTest(request=request):
                with self.assertRaises(ValueError):
                    self.parse(request)

    def test_rejects_duplicate_fields_and_multiple_requests(self):
        for request in (
            b'{"action":"host-status","action":"database-backup"}\n',
            b'{"action":"host-status"}\n{"action":"database-backup"}\n',
            b'{"action":"host-status"}',
        ):
            with self.subTest(request=request):
                with self.assertRaises(ValueError):
                    ADMIN.parse_request(request)


class BackupIntegrityTests(unittest.TestCase):
    def test_verifies_manifest_size_and_sha256_before_use(self):
        backup_id = "20260305T120000Z-a1b2c3d4"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / f"{backup_id}.gpg"
            archive.write_bytes(b"test-only-encrypted-archive")
            manifest = {
                "backup_id": backup_id,
                "database": "postgres",
                "encrypted_bytes": archive.stat().st_size,
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "created_at": "2026-03-05T12:00:00+00:00",
            }
            metadata = root / f"{backup_id}.json"
            metadata.write_text(json.dumps(manifest), encoding="ascii")
            Path(f"{metadata}.sig").write_bytes(b"authenticated-test-signature")

            def read_metadata(path, *, private=True):
                if path.suffix == ".sig":
                    return b"authenticated-test-signature"
                return path.read_bytes()

            with (
                patch.object(ADMIN, "BACKUP_DIR", root),
                patch.object(ADMIN, "RUN_DIR", root),
                patch.object(ADMIN, "_owned_directory"),
                patch.object(
                    ADMIN,
                    "_owned_regular_file",
                    side_effect=lambda path: SimpleNamespace(st_size=path.stat().st_size),
                ),
                patch.object(ADMIN, "_owned_file", side_effect=read_metadata),
                patch.object(ADMIN, "_verify_backup_manifest") as verify_signature,
            ):
                self.assertEqual(ADMIN._verified_backup(backup_id), archive)
                verify_signature.assert_called_once_with(
                    metadata.read_bytes(), b"authenticated-test-signature"
                )
                archive.write_bytes(b"tampered")
                with self.assertRaises(ADMIN.AdminError):
                    ADMIN._verified_backup(backup_id)

    def test_rejects_replaced_archive_and_manifest_without_valid_signature(self):
        backup_id = "20260305T120000Z-a1b2c3d4"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / f"{backup_id}.gpg"
            archive.write_bytes(b"replacement-encrypted-archive")
            manifest = {
                "backup_id": backup_id,
                "database": "postgres",
                "encrypted_bytes": archive.stat().st_size,
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "created_at": "2026-03-05T12:00:00+00:00",
            }
            metadata = root / f"{backup_id}.json"
            metadata.write_text(json.dumps(manifest), encoding="ascii")
            (root / f"{backup_id}.json.sig").write_bytes(b"old-signature")

            def read_metadata(path, *, private=True):
                return path.read_bytes()

            with (
                patch.object(ADMIN, "BACKUP_DIR", root),
                patch.object(ADMIN, "RUN_DIR", root),
                patch.object(ADMIN, "_owned_directory"),
                patch.object(
                    ADMIN,
                    "_owned_regular_file",
                    side_effect=lambda path: SimpleNamespace(st_size=path.stat().st_size),
                ),
                patch.object(ADMIN, "_owned_file", side_effect=read_metadata),
                patch.object(
                    ADMIN,
                    "_verify_backup_manifest",
                    side_effect=ADMIN.AdminError("the POS backup manifest signature is invalid"),
                ),
            ):
                with self.assertRaisesRegex(ADMIN.AdminError, "signature is invalid"):
                    ADMIN._verified_backup(backup_id)


class BackupListTests(unittest.TestCase):
    backup_id = "20260305T120000Z-a1b2c3d4"
    created_at = "2026-03-05T12:00:00+00:00"

    def _create_backup(self, root, backup_id=None, created_at=None):
        backup_id = backup_id or self.backup_id
        created_at = created_at or self.created_at
        archive = root / f"{backup_id}.gpg"
        archive.write_bytes(b"test-only-encrypted-archive")
        manifest = {
            "backup_id": backup_id,
            "database": "postgres",
            "encrypted_bytes": archive.stat().st_size,
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "created_at": created_at,
        }
        manifest_path = root / f"{backup_id}.json"
        manifest_path.write_text(json.dumps(manifest), encoding="ascii")
        Path(f"{manifest_path}.sig").write_bytes(b"authenticated-test-signature")
        return archive, manifest_path

    def _capture_listing(self, root):
        output = io.StringIO()

        def verify_directory(path, mode):
            if path != root:
                return
            try:
                info = path.lstat()
            except OSError:
                raise ADMIN.AdminError("backup directory unavailable") from None
            if not stat.S_ISDIR(info.st_mode):
                raise ADMIN.AdminError("backup directory is unsafe")

        def verify_file(path, *, private=True):
            try:
                info = path.lstat()
            except OSError:
                raise ADMIN.AdminError("backup file unavailable") from None
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ADMIN.AdminError("backup file is unsafe")
            return path.read_bytes()

        def verify_regular_file(path, *, private=True):
            try:
                info = path.lstat()
            except OSError:
                raise ADMIN.AdminError("backup file unavailable") from None
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise ADMIN.AdminError("backup file is unsafe")
            return info

        with (
            patch.object(ADMIN, "BACKUP_DIR", root),
            patch.object(ADMIN, "RUN_DIR", root),
            patch.object(ADMIN, "_owned_directory", side_effect=verify_directory),
            patch.object(ADMIN, "_owned_file", side_effect=verify_file),
            patch.object(
                ADMIN, "_owned_regular_file", side_effect=verify_regular_file
            ),
            patch.object(ADMIN, "_verify_backup_manifest"),
            redirect_stdout(output),
        ):
            ADMIN._list_backups()
        return output.getvalue()

    def test_lists_verified_id_and_signed_timestamp_only(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._create_backup(root)
            output = self._capture_listing(root)
        self.assertEqual(
            output,
            "database-backup-list=completed count=1\n"
            f"backup_id={self.backup_id} created_at={self.created_at} status=verified\n",
        )
        self.assertNotIn("test-only-encrypted-archive", output)
        self.assertNotIn("sha256", output)

    def test_fails_when_candidate_is_missing_archive_or_signature(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / f"{self.backup_id}.json").write_text("{}", encoding="ascii")
            with self.assertRaisesRegex(ADMIN.AdminError, "backup file unavailable"):
                self._capture_listing(root)

    def test_ignores_malformed_backup_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "not-a-backup-id.json").write_text("{}", encoding="ascii")
            output = self._capture_listing(root)
        self.assertEqual(output, "database-backup-list=completed count=0\n")

    def test_rejects_malformed_manifest_timestamp(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._create_backup(root, created_at="not-a-timestamp")
            with self.assertRaisesRegex(
                ADMIN.AdminError, "manifest timestamp is invalid"
            ):
                self._capture_listing(root)

    def test_rejects_symlinked_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, _ = self._create_backup(root)
            target = root / "outside-archive"
            target.write_bytes(b"external")
            archive.unlink()
            try:
                archive.symlink_to(target)
            except OSError:
                original_lstat = Path.lstat

                def lstat_with_symlink(path):
                    if path == archive:
                        return SimpleNamespace(
                            st_mode=stat.S_IFLNK | 0o777,
                            st_nlink=1,
                            st_size=target.stat().st_size,
                        )
                    return original_lstat(path)

                with patch.object(Path, "lstat", new=lstat_with_symlink):
                    with self.assertRaisesRegex(
                        ADMIN.AdminError, "backup file is unsafe"
                    ):
                        self._capture_listing(root)
            else:
                with self.assertRaisesRegex(
                    ADMIN.AdminError, "backup file is unsafe"
                ):
                    self._capture_listing(root)

    def test_rejects_hardlinked_unsafe_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, _ = self._create_backup(root)
            try:
                os.link(archive, root / "extra-link")
            except OSError as error:
                self.skipTest(f"hardlink creation unavailable: {error}")
            with self.assertRaisesRegex(ADMIN.AdminError, "backup file is unsafe"):
                self._capture_listing(root)

    def test_rejects_unsafe_backup_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with (
                patch.object(ADMIN, "BACKUP_DIR", root),
                patch.object(
                    ADMIN,
                    "_owned_directory",
                    side_effect=ADMIN.AdminError("backup directory is unsafe"),
                ) as verify_directory,
                self.assertRaisesRegex(ADMIN.AdminError, "directory is unsafe"),
            ):
                ADMIN._list_backups()
        verify_directory.assert_called_once_with(root, 0o700)

    def test_action_dispatch_does_not_inspect_or_mutate_stack_services(self):
        with (
            patch.object(ADMIN, "_ensure_stack_context") as ensure_stack,
            patch.object(ADMIN, "_list_backups") as list_backups,
        ):
            ADMIN._run_action({"action": "database-backup-list"})
        ensure_stack.assert_not_called()
        list_backups.assert_called_once_with()


class OfflineRestoreSafetyTests(unittest.TestCase):
    def test_rejects_archive_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "unsafe.tar"
            with tarfile.open(bundle, "w") as archive:
                entry = tarfile.TarInfo("../outside.gpg")
                entry.size = 4
                archive.addfile(entry, io.BytesIO(b"data"))
                for name, value in (
                    ("20260305T120000Z-a1b2c3d4.json", b"{}"),
                    ("20260305T120000Z-a1b2c3d4.json.sig", b"sig"),
                ):
                    member = tarfile.TarInfo(name)
                    member.size = len(value)
                    archive.addfile(member, io.BytesIO(value))
            with self.assertRaisesRegex(RESTORE.RestoreError, "unsafe entry"):
                RESTORE._read_bundle(bundle, root)

    def test_reads_only_a_manifest_matching_encrypted_archive_digest(self):
        backup_id = "20260305T120000Z-a1b2c3d4"
        encrypted = b"test-only-ciphertext"
        manifest = {
            "backup_id": backup_id,
            "database": "postgres",
            "encrypted_bytes": len(encrypted),
            "sha256": hashlib.sha256(encrypted).hexdigest(),
            "created_at": "2026-03-05T12:00:00+00:00",
        }
        entries = (
            (f"{backup_id}.gpg", encrypted),
            (f"{backup_id}.json", json.dumps(manifest).encode("ascii")),
            (f"{backup_id}.json.sig", b"test-signature"),
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "backup.tar"
            with tarfile.open(bundle, "w") as archive:
                for name, value in entries:
                    member = tarfile.TarInfo(name)
                    member.size = len(value)
                    archive.addfile(member, io.BytesIO(value))
            archive_path, manifest_bytes, signature, result = RESTORE._read_bundle(bundle, root)
            self.assertEqual(archive_path.read_bytes(), encrypted)
            self.assertEqual(json.loads(manifest_bytes), manifest)
            self.assertEqual(signature, b"test-signature")
            self.assertEqual(result["backup_id"], backup_id)

    def test_requires_loopback_recovery_database_and_exact_confirmation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "unused.tar"
            trusted_signers = root / "trusted_signers"
            bundle.write_bytes(b"")
            trusted_signers.write_text("test", encoding="ascii")
            with self.assertRaisesRegex(RESTORE.RestoreError, "loopback PGHOST"):
                RESTORE.restore(
                    bundle,
                    trusted_signers,
                    "production",
                    environment={"PGHOST": "database.example", "PGDATABASE": "production"},
                )

    def test_rejects_host_aliases_that_might_resolve_off_loopback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "unused.tar"
            trusted_signers = root / "trusted_signers"
            bundle.write_bytes(b"")
            trusted_signers.write_text("test", encoding="ascii")
            with self.assertRaisesRegex(RESTORE.RestoreError, "loopback PGHOST"):
                RESTORE.restore(
                    bundle,
                    trusted_signers,
                    "hanouti_recovery_test",
                    environment={
                        "PGHOST": "localhost",
                        "PGDATABASE": "hanouti_recovery_test",
                    },
                )

    def test_passes_the_selected_owner_key_home_to_gpg_only(self):
        backup_id = "20260305T120000Z-a1b2c3d4"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bundle = root / "backup.tar"
            trusted_signers = root / "trusted_signers"
            gpg_home = root / "owner-key"
            bundle.write_bytes(b"test bundle")
            trusted_signers.write_text("test", encoding="ascii")
            gpg_home.mkdir()
            captured = {}
            with (
                patch.object(
                    RESTORE,
                    "_read_bundle",
                    return_value=(
                        root / "encrypted.gpg",
                        b"manifest",
                        b"signature",
                        {"backup_id": backup_id},
                    ),
                ),
                patch.object(RESTORE, "_verify_signature"),
                patch.object(
                    RESTORE,
                    "_stream_restore",
                    side_effect=lambda archive, **kwargs: captured.update(kwargs),
                ),
            ):
                RESTORE.restore(
                    bundle,
                    trusted_signers,
                    "hanouti_recovery_test",
                    gpg_home=gpg_home,
                    environment={
                        "PGHOST": "127.0.0.1",
                        "PGDATABASE": "hanouti_recovery_test",
                        "PGPASSWORD": "test-only-password",
                        "PGHOSTADDR": "203.0.113.8",
                    },
                )

            environment = captured["environment"]
            self.assertEqual(environment["GNUPGHOME"], str(gpg_home.resolve()))
            self.assertEqual(environment["PGHOST"], "127.0.0.1")
            self.assertEqual(environment["PGPASSWORD"], "test-only-password")
            self.assertNotIn("PGHOSTADDR", environment)


class GpgStreamingTests(unittest.TestCase):
    def test_disposable_gpg_key_encrypts_and_decrypts_binary_streams(self):
        gpg = shutil.which("gpg")
        if gpg is None and os.name == "nt":
            candidate = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / (
                "Git/usr/bin/gpg.exe"
            )
            if candidate.is_file():
                gpg = str(candidate)
        if gpg is None:
            self.skipTest("GPG is unavailable")

        with tempfile.TemporaryDirectory(prefix="hanouti-gpg-test-") as directory:
            root = Path(directory)
            home = root / "gnupg"
            home.mkdir()
            gpg_home_argument = RESTORE._gpg_path_argument(home, gpg)
            command = [
                gpg,
                "--no-options",
                "--batch",
                "--homedir",
                gpg_home_argument,
                "--pinentry-mode",
                "loopback",
                "--passphrase",
                "",
            ]
            generated = subprocess.run(
                command
                + [
                    "--quick-generate-key",
                    "Disposable Hanouti test <hanouti-test@example.invalid>",
                    "rsa2048",
                    "encr",
                    "1d",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=90,
                check=False,
            )
            self.assertEqual(generated.returncode, 0)
            listing = subprocess.run(
                command + ["--with-colons", "--list-keys"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=True,
            ).stdout
            fingerprints = [
                line.split(b":")[9].decode("ascii")
                for line in listing.splitlines()
                if line.startswith(b"fpr:")
            ]
            self.assertTrue(fingerprints)
            exported = subprocess.run(
                command + ["--armor", "--export", fingerprints[0]],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=True,
            ).stdout
            public_key = root / "backup-recipient.asc"
            public_key.write_bytes(exported)
            displayed = subprocess.run(
                command
                + [
                    "--with-colons",
                    "--import-options",
                    "show-only",
                    "--import",
                    RESTORE._gpg_path_argument(public_key, gpg),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=True,
            ).stdout.decode("utf-8")
            public_records = [line.split(":") for line in displayed.splitlines()]
            primary_keys = [record for record in public_records if record[0] == "pub"]
            primary_fingerprints = [
                record[9] for record in public_records if record[0] == "fpr"
            ]
            self.assertEqual(len(primary_keys), 1)
            self.assertEqual(primary_fingerprints, [fingerprints[0]])
            self.assertIn("e", primary_keys[0][11].lower())
            payload = b"Hanouti disposable backup stream\x00with binary bytes\xff"
            encrypted = subprocess.run(
                command
                + [
                    "--trust-model",
                    "always",
                    "--output",
                    "-",
                    "--encrypt",
                    "--recipient",
                    fingerprints[0],
                ],
                input=payload,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=True,
            ).stdout
            self.assertTrue(encrypted)
            decrypted = subprocess.run(
                command + ["--decrypt", "--output", "-"],
                input=encrypted,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=30,
                check=True,
            ).stdout
            self.assertEqual(decrypted, payload)

            gpgconf = Path(gpg).with_name("gpgconf.exe" if os.name == "nt" else "gpgconf")
            if gpgconf.is_file():
                subprocess.run(
                    [
                        str(gpgconf),
                        "--homedir",
                        gpg_home_argument,
                        "--kill",
                        "gpg-agent",
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=15,
                    check=False,
                )


class SignedArtifactVerificationTests(unittest.TestCase):
    def test_backup_manifest_signature_rejects_replaced_manifest(self):
        ssh_keygen = shutil.which("ssh-keygen")
        if ssh_keygen is None:
            self.skipTest("OpenSSH ssh-keygen is unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            key = root / "signing-key"
            manifest_path = root / "manifest.json"
            manifest = b'{"backup_id":"20260305T120000Z-a1b2c3d4"}\n'
            manifest_path.write_bytes(manifest)
            subprocess.run(
                [ssh_keygen, "-q", "-t", "ed25519", "-N", "", "-f", str(key)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            public = subprocess.run(
                [ssh_keygen, "-y", "-f", str(key)],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            signers = root / "allowed_signers"
            signers.write_text(f"hanouti-pos-backup {public}\n", encoding="ascii")
            subprocess.run(
                [
                    ssh_keygen,
                    "-Y",
                    "sign",
                    "-f",
                    str(key),
                    "-n",
                    RESTORE.SIGNATURE_NAMESPACE,
                    str(manifest_path),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            RESTORE._verify_signature(
                    manifest,
                    Path(f"{manifest_path}.sig").read_bytes(),
                    signers,
                    root,
                    ssh_keygen,
                )
            with self.assertRaisesRegex(RESTORE.RestoreError, "signature is invalid"):
                RESTORE._verify_signature(
                    manifest + b'{"backup_id":"replacement"}\n',
                    Path(f"{manifest_path}.sig").read_bytes(),
                    signers,
                    root,
                    ssh_keygen,
                )

    def test_function_and_stack_packages_require_distinct_signature_namespaces(self):
        ssh_keygen = shutil.which("ssh-keygen")
        if ssh_keygen is None:
            self.skipTest("OpenSSH ssh-keygen is unavailable")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            key = root / "signing-key"
            archive = root / "release.tar.gz"
            archive.write_bytes(b"test-only-release")
            subprocess.run(
                [ssh_keygen, "-q", "-t", "ed25519", "-N", "", "-f", str(key)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            public = subprocess.run(
                [ssh_keygen, "-y", "-f", str(key)],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            signers = root / "allowed_signers"
            signers.write_text(f"hanouti-pos-functions {public}\n", encoding="ascii")
            for namespace in (
                ADMIN.FUNCTIONS_SIGNATURE_NAMESPACE,
                ADMIN.STACK_SIGNATURE_NAMESPACE,
            ):
                signature = root / f"{namespace}.sig"
                subprocess.run(
                    [
                        ssh_keygen,
                        "-Y",
                        "sign",
                        "-f",
                        str(key),
                        "-n",
                        namespace,
                        str(archive),
                    ],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                generated_signature = Path(f"{archive}.sig")
                generated_signature.replace(signature)
                with (
                    patch.object(ADMIN, "FUNCTIONS_SIGNERS", signers),
                    patch.object(ADMIN, "SSH_KEYGEN", ssh_keygen),
                    patch.object(ADMIN, "_safe_environment", return_value=dict(os.environ)),
                    patch.object(ADMIN, "_owned_file", return_value=signers.read_bytes()),
                    patch.object(ADMIN, "_owned_regular_file"),
                ):
                    if namespace == ADMIN.FUNCTIONS_SIGNATURE_NAMESPACE:
                        ADMIN._verify_functions_signature(archive, signature)
                    else:
                        ADMIN._verify_stack_signature(archive, signature)
                    wrong_verifier = (
                        ADMIN._verify_stack_signature
                        if namespace == ADMIN.FUNCTIONS_SIGNATURE_NAMESPACE
                        else ADMIN._verify_functions_signature
                    )
                    with self.assertRaisesRegex(ADMIN.AdminError, "signature is invalid"):
                        wrong_verifier(archive, signature)


class ReleaseSignatureRoutingTests(unittest.TestCase):
    def _stage_files(self, _source, target, _deploy_uid):
        archive_name = target.name.removesuffix(".sig").removesuffix(".sha256")
        if target.name.endswith(".sha256"):
            archive = target.with_name(archive_name)
            target.write_text(
                f"{hashlib.sha256(archive.read_bytes()).hexdigest()}  {archive_name}\n",
                encoding="ascii",
            )
        else:
            target.write_bytes(b"test signed release archive")

    def _patch_staging_directory_stats(self, parent, release, deploy_uid):
        original_lstat = Path.lstat

        def fake_lstat(path):
            if path in {parent, release}:
                return SimpleNamespace(
                    st_mode=stat.S_IFDIR | 0o700,
                    st_uid=deploy_uid,
                )
            return original_lstat(path)

        return patch.object(Path, "lstat", fake_lstat)

    def test_function_deployment_uses_edge_function_signature_namespace(self):
        release_id = "a" * 40 + "-123456789-1"
        deploy_uid = 4242
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            deploy_home = root / "deploy"
            stage_parent = deploy_home / "staging" / "supabase-edge-functions"
            stage = stage_parent / release_id
            stage.mkdir(parents=True)
            run_dir = root / "run"
            run_dir.mkdir()
            release_root = root / "releases"
            release_root.mkdir()

            with (
                patch.object(ADMIN, "RUN_DIR", run_dir),
                patch.object(ADMIN, "FUNCTIONS_RELEASE_ROOT", release_root),
                patch.object(
                    ADMIN.CORE,
                    "pwd",
                    SimpleNamespace(
                        getpwnam=lambda _name: SimpleNamespace(
                            pw_uid=deploy_uid, pw_dir=str(deploy_home)
                        )
                    ),
                    create=True,
                ),
                patch.object(ADMIN, "_require_pos_database"),
                patch.object(ADMIN, "_owned_directory"),
                self._patch_staging_directory_stats(stage_parent, stage, deploy_uid),
                patch.object(ADMIN, "_copy_staged_file", side_effect=self._stage_files),
                patch.object(ADMIN, "_verify_functions_signature") as verify_functions,
                patch.object(ADMIN, "_verify_stack_signature") as verify_stack,
                patch.object(ADMIN, "_extract_functions_archive"),
                patch.object(ADMIN, "_functions_release_target", return_value=None),
                patch.object(ADMIN, "_switch_functions_pointer"),
                patch.object(ADMIN, "_restart_functions"),
            ):
                ADMIN._deploy_functions_locked(release_id)

        verify_functions.assert_called_once()
        verify_stack.assert_not_called()

    def test_stack_deployment_uses_supabase_stack_signature_namespace(self):
        release_id = "b" * 40 + "-123456789-1"
        backup_id = "20260305T120000Z-a1b2c3d4"
        baseline_id = "baseline-" + "c" * 12
        deploy_uid = 4242
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            deploy_home = root / "deploy"
            stage_parent = deploy_home / "staging" / "supabase-stack"
            stage = stage_parent / release_id
            stage.mkdir(parents=True)
            run_dir = root / "run"
            run_dir.mkdir()
            release_root = root / "releases"
            release_root.mkdir()
            compose_path = root / "docker-compose.yml"
            compose_path.write_text("test compose", encoding="ascii")
            images = dict(ADMIN.DEFAULT_STACK_IMAGES)

            with ExitStack() as stack:
                stack.enter_context(patch.object(ADMIN, "RUN_DIR", run_dir))
                stack.enter_context(
                    patch.object(ADMIN, "STACK_RELEASE_ROOT", release_root)
                )
                stack.enter_context(
                    patch.object(
                        ADMIN.CORE,
                        "pwd",
                        SimpleNamespace(
                            getpwnam=lambda _name: SimpleNamespace(
                                pw_uid=deploy_uid, pw_dir=str(deploy_home)
                            )
                        ),
                        create=True,
                    )
                )
                stack.enter_context(patch.object(ADMIN, "_verified_backup"))
                stack.enter_context(patch.object(ADMIN, "_owned_directory"))
                stack.enter_context(
                    self._patch_staging_directory_stats(stage_parent, stage, deploy_uid)
                )
                stack.enter_context(
                    patch.object(ADMIN, "_copy_staged_file", side_effect=self._stage_files)
                )
                verify_stack = stack.enter_context(
                    patch.object(ADMIN, "_verify_stack_signature")
                )
                verify_functions = stack.enter_context(
                    patch.object(ADMIN, "_verify_functions_signature")
                )
                stack.enter_context(patch.object(ADMIN, "_extract_stack_release"))
                stack.enter_context(
                    patch.object(
                        ADMIN,
                        "_initialize_stack_state",
                        return_value={"active": baseline_id, "previous": None},
                    )
                )
                stack.enter_context(patch.object(ADMIN, "_ensure_stack_context"))
                stack.enter_context(
                    patch.object(ADMIN.CORE, "_verify_resource_ownership")
                )
                stack.enter_context(
                    patch.object(ADMIN, "_validate_stack_release", return_value=images)
                )
                stack.enter_context(
                    patch.object(
                        ADMIN,
                        "_stack_release_files",
                        return_value=(compose_path, images),
                    )
                )
                stack.enter_context(
                    patch.object(ADMIN.CORE, "COMPOSE_FILE", str(compose_path))
                )
                stack.enter_context(patch.object(ADMIN.CORE, "_load_compose_document"))
                stack.enter_context(
                    patch.object(
                        ADMIN.CORE, "compose_prefix", return_value=["docker", "compose"]
                    )
                )
                stack.enter_context(
                    patch.object(
                        ADMIN.CORE, "_run", return_value=SimpleNamespace(returncode=0)
                    )
                )
                stack.enter_context(patch.object(ADMIN, "_install_stack_compose"))
                stack.enter_context(patch.object(ADMIN, "_run_stack_compose"))
                stack.enter_context(patch.object(ADMIN, "_write_stack_state"))
                ADMIN._deploy_stack_locked(release_id, backup_id)

        verify_stack.assert_called_once()
        verify_functions.assert_not_called()


class EdgeFunctionArchiveTests(unittest.TestCase):
    def test_extracts_the_required_release_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "functions.tar.gz"
            target = root / "release"
            target.mkdir()
            with tarfile.open(archive_path, "w:gz") as archive:
                for name in sorted(ADMIN.CORE.FUNCTION_RELEASE_REQUIRED_FILES):
                    payload = f"verified:{name}".encode("utf-8")
                    member = tarfile.TarInfo(name)
                    member.size = len(payload)
                    archive.addfile(member, io.BytesIO(payload))

            ADMIN._extract_functions_archive(archive_path, target)

            for name in ADMIN.CORE.FUNCTION_RELEASE_REQUIRED_FILES:
                self.assertEqual(
                    (target / Path(*name.split("/"))).read_bytes(),
                    f"verified:{name}".encode("utf-8"),
                )

    def test_rejects_traversal_in_function_release_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_path = root / "functions.tar.gz"
            target = root / "release"
            target.mkdir()
            with tarfile.open(archive_path, "w:gz") as archive:
                member = tarfile.TarInfo("../outside")
                member.size = 4
                archive.addfile(member, io.BytesIO(b"nope"))

            with self.assertRaisesRegex(ADMIN.AdminError, "unsafe path"):
                ADMIN._extract_functions_archive(archive_path, target)
            self.assertFalse((root / "outside").exists())


class ReleaseRollbackTests(unittest.TestCase):
    def test_function_rollback_swaps_only_the_verified_release_pointers(self):
        current = Path("/releases/current")
        previous = Path("/releases/previous")
        with (
            patch.object(
                ADMIN, "_functions_release_target", side_effect=[current, previous]
            ),
            patch.object(ADMIN, "_switch_functions_pointer") as switch_pointer,
            patch.object(ADMIN, "_restart_functions") as restart,
        ):
            ADMIN._rollback_functions_locked()

        self.assertEqual(
            [entry.args[:2] for entry in switch_pointer.call_args_list],
            [
                (ADMIN.FUNCTIONS_PREVIOUS, current),
                (ADMIN.FUNCTIONS_CURRENT, previous),
            ],
        )
        restart.assert_called_once()

    def test_stack_rollback_restores_previous_version_and_updates_state(self):
        active = "a" * 40 + "-1-1"
        previous = "b" * 40 + "-2-1"
        active_images = dict(ADMIN.DEFAULT_STACK_IMAGES)
        previous_images = dict(ADMIN.DEFAULT_STACK_IMAGES)
        with (
            patch.object(ADMIN, "_owned_directory"),
            patch.object(
                ADMIN,
                "_initialize_stack_state",
                return_value={"active": active, "previous": previous},
            ),
            patch.object(ADMIN, "_validate_stack_release", side_effect=[
                active_images, previous_images
            ]),
            patch.object(ADMIN, "_ensure_stack_context"),
            patch.object(ADMIN.CORE, "_verify_resource_ownership"),
            patch.object(ADMIN, "_install_stack_compose") as install,
            patch.object(ADMIN, "_run_stack_compose") as run_stack,
            patch.object(ADMIN, "_write_stack_state") as write_state,
        ):
            ADMIN._rollback_stack_locked()

        install.assert_called_once_with(previous)
        run_stack.assert_called_once_with(previous_images)
        write_state.assert_called_once_with(previous, active)

    def test_failed_stack_rollback_reactivates_the_current_release(self):
        active = "a" * 40 + "-1-1"
        previous = "b" * 40 + "-2-1"
        active_images = dict(ADMIN.DEFAULT_STACK_IMAGES)
        previous_images = dict(ADMIN.DEFAULT_STACK_IMAGES)
        with (
            patch.object(ADMIN, "_owned_directory"),
            patch.object(
                ADMIN,
                "_initialize_stack_state",
                return_value={"active": active, "previous": previous},
            ),
            patch.object(
                ADMIN,
                "_validate_stack_release",
                side_effect=[active_images, previous_images],
            ),
            patch.object(ADMIN, "_ensure_stack_context"),
            patch.object(ADMIN.CORE, "_verify_resource_ownership"),
            patch.object(ADMIN, "_install_stack_compose") as install,
            patch.object(
                ADMIN,
                "_run_stack_compose",
                side_effect=[ADMIN.AdminError("rollback health failed"), None],
            ) as run_stack,
            patch.object(ADMIN, "_write_stack_state") as write_state,
        ):
            with self.assertRaisesRegex(ADMIN.AdminError, "rollback health failed"):
                ADMIN._rollback_stack_locked()

        self.assertEqual(
            install.call_args_list,
            [call(previous), call(active)],
        )
        self.assertEqual(
            run_stack.call_args_list,
            [call(previous_images), call(active_images)],
        )
        write_state.assert_called_once_with(active, previous)


class BootstrapIntegrityTests(unittest.TestCase):
    def test_admin_v3_uses_the_canonical_active_compose_root(self):
        repository = Path(__file__).parents[1]
        scripts = repository / "scripts" / "vps-admin"
        bootstrap = (scripts / "bootstrap-hanouti-pos-admin-v3.sh").read_text(
            encoding="utf-8"
        )
        core = (scripts / "hanouti_pos_admin.py").read_text(encoding="utf-8")
        deployment_sources = "\n".join(
            (scripts / name).read_text(encoding="utf-8")
            for name in (
                "bootstrap-hanouti-pos-admin-v3.sh",
                "hanouti_pos_admin.py",
                "hanouti_pos_admin_v3.py",
                "deploy-signed-vps-release.ps1",
                "revoke-hanouti-pos-admin-v3.sh",
            )
        )
        self.assertIn(
            'readonly COMPOSE_ROOT="/opt/supabase-vps/deployment"', bootstrap
        )
        self.assertIn(
            'readonly EDGE_SIGNERS_STAGE="$KEYS_STAGE/edge-functions.allowed_signers"',
            bootstrap,
        )
        self.assertIn('COMPOSE_DIR = Path("/opt/supabase-vps/deployment")', core)
        self.assertIn('"$COMPOSE_ROOT/volumes/functions/releases"', bootstrap)
        self.assertIn('"$COMPOSE_ROOT/releases"', bootstrap)
        self.assertNotIn("/opt/hanouti-pos/supabase-vps", deployment_sources)

    def test_bootstrap_reads_public_recipient_material_from_keys_directory(self):
        repository = Path(__file__).parents[1]
        scripts = repository / "scripts" / "vps-admin"
        bootstrap = (scripts / "bootstrap-hanouti-pos-admin-v3.sh").read_text(
            encoding="utf-8"
        )
        self.assertIn('readonly KEYS_STAGE="$STAGE_DIR/keys"', bootstrap)
        self.assertIn(
            'readonly RECIPIENT_STAGE="$KEYS_STAGE/backup-recipient.asc"',
            bootstrap,
        )
        self.assertIn(
            'readonly FINGERPRINT_STAGE="$KEYS_STAGE/backup-recipient-fingerprint"',
            bootstrap,
        )
        self.assertIn('stat -c \'%U:%G:%a\' -- "$KEYS_STAGE"', bootstrap)
        self.assertIn(
            'readonly EDGE_SIGNERS_STAGE="$KEYS_STAGE/edge-functions.allowed_signers"',
            bootstrap,
        )

    def test_bootstrap_and_revocation_hash_pins_match_installed_sources(self):
        repository = Path(__file__).parents[1]
        scripts = repository / "scripts" / "vps-admin"
        bootstrap = (scripts / "bootstrap-hanouti-pos-admin-v3.sh").read_text(
            encoding="utf-8"
        )
        revocation = (scripts / "revoke-hanouti-pos-admin-v3.sh").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("TO_BE_FILLED", bootstrap + revocation)
        pinned_files = {
            "HELPER": scripts / "hanouti_pos_admin_v3.py",
            "CORE": scripts / "hanouti_pos_admin.py",
            "EDGE_SIGNERS": scripts / "keys" / "edge-functions.allowed_signers",
            "REVOKE": scripts / "revoke-hanouti-pos-admin-v3.sh",
        }
        for label, path in pinned_files.items():
            with self.subTest(script="bootstrap", source=label):
                match = re.search(
                    rf'EXPECTED_{label}_SHA256="([a-f0-9]{{64}})"', bootstrap
                )
                self.assertIsNotNone(match)
                self.assertEqual(
                    match.group(1), hashlib.sha256(path.read_bytes()).hexdigest()
                )
        for label, path in (
            ("HELPER", pinned_files["HELPER"]),
            ("CORE", pinned_files["CORE"]),
        ):
            with self.subTest(script="revocation", source=label):
                match = re.search(
                    rf'EXPECTED_{label}_SHA256="([a-f0-9]{{64}})"', revocation
                )
                self.assertIsNotNone(match)
                self.assertEqual(
                    match.group(1), hashlib.sha256(path.read_bytes()).hexdigest()
                )

        entrypoint = (
            b"#!/bin/sh\n"
            b"exec /usr/bin/python3 /usr/local/sbin/hanouti_pos_admin_v3.py\n"
        )
        entry_match = re.search(
            r'EXPECTED_ENTRY_SHA256="([a-f0-9]{64})"', revocation
        )
        self.assertIsNotNone(entry_match)
        self.assertEqual(
            entry_match.group(1), hashlib.sha256(entrypoint).hexdigest()
        )
        readme = (scripts / "README-v3.md").read_text(encoding="utf-8")
        documented_bootstrap_hash = re.search(
            r"`BOOTSTRAP_SHA256` is `([a-f0-9]{64})`", readme
        )
        self.assertIsNotNone(documented_bootstrap_hash)
        self.assertEqual(
            documented_bootstrap_hash.group(1),
            hashlib.sha256((scripts / "bootstrap-hanouti-pos-admin-v3.sh").read_bytes()).hexdigest(),
        )
        self.assertIn('stat.S_IMODE(source_info.st_mode) != 0o600', bootstrap)
        self.assertIn('source_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK', bootstrap)
        self.assertIn('Type the backup-key fingerprint verified independently', bootstrap)
        self.assertIn('stat.S_IMODE(info.st_mode) != 0o600', revocation)
        self.assertLess(
            revocation.index('rm -f -- "$SUDOERS_TARGET"'),
            revocation.index('verify_installed_file "$ENTRY_TARGET"'),
        )

    def test_bootstrap_source_is_required_to_run_from_a_root_owned_copy(self):
        repository = Path(__file__).parents[1]
        bootstrap = (
            repository / "scripts" / "vps-admin" / "bootstrap-hanouti-pos-admin-v3.sh"
        ).read_text(encoding="utf-8")
        self.assertIn('root:root:700:1', bootstrap)
        self.assertIn('readonly REVOKE_TARGET="/usr/local/sbin/hanouti-pos-admin-v3-revoke"', bootstrap)
        self.assertIn('readonly SUDOERS_LINE=', bootstrap)
        self.assertIn('result=succeeded', bootstrap)

    def test_owner_key_home_is_initialized_before_gpg_path_conversion(self):
        repository = Path(__file__).parents[1]
        preparation = (
            repository / "scripts" / "vps-admin" / "prepare-owner-backup-key.ps1"
        ).read_text(encoding="utf-8")
        self.assertLess(
            preparation.index("$keyHome = Join-Path"),
            preparation.index("$gpgHome = $keyHome"),
        )


class SupabaseStackPackageTests(unittest.TestCase):
    def test_packages_the_exact_versioned_service_image_inventory(self):
        repository = Path(__file__).parents[1]
        compose = repository / "deploy" / "supabase-vps" / "docker-compose.yml"
        release_id = "c" * 40 + "-123-1"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "stack.tar.gz"
            STACK_PACKAGE.package(compose, release_id, output)
            with tarfile.open(output, "r:gz") as archive:
                self.assertEqual(
                    set(archive.getnames()),
                    {"docker-compose.yml", "release.json"},
                )
                manifest = json.load(archive.extractfile("release.json"))
            self.assertEqual(manifest["release_id"], release_id)
            self.assertEqual(set(manifest["images"]), STACK_PACKAGE.EXPECTED_SERVICES)

    def test_rejects_unpinned_or_incomplete_stack_compose(self):
        repository = Path(__file__).parents[1]
        compose_text = (
            repository / "deploy" / "supabase-vps" / "docker-compose.yml"
        ).read_text(encoding="utf-8")
        unpinned_text = compose_text.replace(
            "supabase/postgres:17.6.1.136",
            "supabase/postgres:latest",
            1,
        )
        with self.assertRaisesRegex(ValueError, "unapproved or unpinned"):
            STACK_PACKAGE.image_inventory(unpinned_text)


if __name__ == "__main__":
    unittest.main()
