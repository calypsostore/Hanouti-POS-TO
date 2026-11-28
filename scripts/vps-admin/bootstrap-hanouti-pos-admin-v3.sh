#!/bin/bash
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
umask 077

readonly STAGE_DIR="/home/hanouti-deploy/.local/share/hanouti-pos-admin-bootstrap-v3"
readonly CONFIG_DIR="/etc/hanouti-pos-admin-v3"
readonly KEYS_STAGE="$STAGE_DIR/keys"
readonly HELPER_STAGE="$STAGE_DIR/hanouti_pos_admin_v3.py"
readonly CORE_STAGE="$STAGE_DIR/hanouti_pos_admin.py"
readonly EDGE_SIGNERS_STAGE="$KEYS_STAGE/edge-functions.allowed_signers"
readonly RECIPIENT_STAGE="$KEYS_STAGE/backup-recipient.asc"
readonly FINGERPRINT_STAGE="$KEYS_STAGE/backup-recipient-fingerprint"
readonly REVOKE_STAGE="$STAGE_DIR/revoke-hanouti-pos-admin-v3.sh"
readonly HELPER_TARGET="/usr/local/sbin/hanouti_pos_admin_v3.py"
readonly CORE_TARGET="/usr/local/sbin/hanouti_pos_admin.py"
readonly ENTRY_TARGET="/usr/local/sbin/hanouti-pos-admin-v3"
readonly REVOKE_TARGET="/usr/local/sbin/hanouti-pos-admin-v3-revoke"
readonly SUDOERS_TARGET="/etc/sudoers.d/hanouti-pos-admin-v3"
readonly AUDIT_LOG="/var/log/hanouti-pos-admin-v3.log"
readonly SUDOERS_LINE='hanouti-deploy ALL=(root) NOPASSWD: /usr/local/sbin/hanouti-pos-admin-v3 ""'
readonly EXPECTED_HELPER_SHA256="20a487c87b87cdfb205ca3a8e6fd01ba94b2b21f1be9729eecc23768dab131a4"
readonly EXPECTED_CORE_SHA256="77440059d7769a29961db4ee7843fe5066ebc90e0ec5e260fd75116df6e8ea15"
readonly EXPECTED_EDGE_SIGNERS_SHA256="02123ea6eb58f0314e75e38ca99ad49c5e681c5a8637a24b40294f1b490b18cc"
readonly EXPECTED_REVOKE_SHA256="7ddeeb5b7ee353cb109b6ba92588dc48d10e8b11fc2bb59293f13497ed269043"

if [[ "$EUID" -ne 0 ]]; then
    echo "Run this one-time bootstrap from an authorized root console." >&2
    exit 1
fi
script_source="${BASH_SOURCE[0]}"
if [[ -L "$script_source" || ! -f "$script_source" ]]; then
    echo "The bootstrap must be a regular, root-owned protected copy." >&2
    exit 1
fi
script_path="$(realpath -e -- "$script_source")"
script_directory="$(dirname -- "$script_path")"
if [[ "$(stat -c '%U:%G:%a:%h' -- "$script_path")" != "root:root:700:1" ||
      "$(stat -c '%U' -- "$script_directory")" != "root" ||
      "$(realpath -e -- "$script_directory")" != "$script_directory" ]] ||
   (( (8#$(stat -c '%a' -- "$script_directory") & 022) != 0 )); then
    echo "The bootstrap copy or its directory is not safely protected." >&2
    exit 1
fi

if [[ -L "$STAGE_DIR" || ! -d "$STAGE_DIR" ||
      "$(realpath -e -- "$STAGE_DIR")" != "$STAGE_DIR" ]] ||
   [[ "$(stat -c '%U:%G:%a' -- "$STAGE_DIR")" != "hanouti-deploy:hanouti-deploy:700" ]]; then
    echo "The staged v3 bootstrap directory is not safely owned." >&2
    exit 1
fi
if [[ -L "$KEYS_STAGE" || ! -d "$KEYS_STAGE" ||
      "$(realpath -e -- "$KEYS_STAGE")" != "$KEYS_STAGE" ]] ||
   [[ "$(stat -c '%U:%G:%a' -- "$KEYS_STAGE")" != "hanouti-deploy:hanouti-deploy:700" ]]; then
    echo "The staged v3 public-keys directory is not safely owned." >&2
    exit 1
fi
if ! getent passwd hanouti-deploy >/dev/null ||
   ! command -v visudo >/dev/null 2>&1 ||
   ! command -v install >/dev/null 2>&1 ||
   ! command -v python3 >/dev/null 2>&1 ||
   ! command -v gpg >/dev/null 2>&1 ||
   ! command -v ssh-keygen >/dev/null 2>&1; then
    echo "A required account or bootstrap tool is unavailable." >&2
    exit 1
fi
for directory in /usr/local/sbin /etc/sudoers.d /etc /var/log /var/backups /var/lib /run; do
    if [[ ! -d "$directory" || -L "$directory" ||
          "$(stat -c '%U' -- "$directory")" != "root" ]] ||
       (( (8#$(stat -c '%a' -- "$directory") & 022) != 0 )); then
        echo "A required system directory has unsafe ownership or permissions: $directory" >&2
        exit 1
    fi
done
readonly COMPOSE_ROOT="/opt/supabase-vps/deployment"
for directory in "$COMPOSE_ROOT" "$COMPOSE_ROOT/volumes" \
                 "$COMPOSE_ROOT/volumes/functions"; do
    if [[ -L "$directory" || ! -d "$directory" ||
          "$(stat -c '%U' -- "$directory")" != "root" ]] ||
       (( (8#$(stat -c '%a' -- "$directory") & 022) != 0 )) ||
       [[ "$(realpath -e -- "$directory")" != "$directory" ]]; then
        echo "The existing POS Supabase tree is missing or unsafe: $directory" >&2
        exit 1
    fi
done
check_optional_directory() {
    local path="$1"
    local expected_mode="$2"
    if [[ -e "$path" || -L "$path" ]]; then
        if [[ -L "$path" || ! -d "$path" ||
              "$(stat -c '%U:%a' -- "$path")" != "root:$expected_mode" ||
              "$(realpath -e -- "$path")" != "$path" ]]; then
            echo "An existing v3 directory has unsafe ownership or permissions: $path" >&2
            exit 1
        fi
    fi
}
check_optional_directory /var/backups/hanouti-pos 700
check_optional_directory /run/hanouti-pos-admin-v3 700
check_optional_directory /var/lib/hanouti-pos-admin-v3 700
check_optional_directory "$COMPOSE_ROOT/volumes/functions/releases" 755
check_optional_directory "$COMPOSE_ROOT/releases" 755

for path in "$HELPER_STAGE" "$CORE_STAGE" "$EDGE_SIGNERS_STAGE" \
            "$RECIPIENT_STAGE" "$FINGERPRINT_STAGE" "$REVOKE_STAGE"; do
    if [[ -L "$path" || ! -f "$path" ||
          "$(stat -c '%U:%G:%a' -- "$path")" != "hanouti-deploy:hanouti-deploy:600" ]]; then
        echo "A staged v3 bootstrap input is missing or unsafe: $path" >&2
        exit 1
    fi
done

bootstrap_work="$(mktemp -d /run/hanouti-pos-admin-v3-bootstrap.XXXXXX)"
trap 'rm -rf -- "$bootstrap_work"' EXIT
chown root:root "$bootstrap_work"
chmod 0700 "$bootstrap_work"
readonly HELPER_SOURCE="$bootstrap_work/hanouti_pos_admin_v3.py"
readonly CORE_SOURCE="$bootstrap_work/hanouti_pos_admin.py"
readonly EDGE_SIGNERS_SOURCE="$bootstrap_work/edge-functions.allowed_signers"
readonly RECIPIENT_SOURCE="$bootstrap_work/backup-recipient.asc"
readonly FINGERPRINT_SOURCE="$bootstrap_work/backup-recipient-fingerprint"
readonly REVOKE_SOURCE="$bootstrap_work/revoke-hanouti-pos-admin-v3.sh"
staging_file=""
sudoers_file=""
config_created=0
entry_installed=0
core_installed=0
helper_installed=0
revoke_installed=0
sudoers_installed=0
audit_created=0
backup_directory_created=0
run_directory_created=0
state_directory_created=0
functions_release_directory_created=0
stack_release_directory_created=0

cleanup() {
    status=$?
    if [[ -n "$staging_file" ]]; then rm -f -- "$staging_file"; fi
    if [[ -n "$sudoers_file" ]]; then rm -f -- "$sudoers_file"; fi
    if [[ "$status" -ne 0 ]]; then
        if [[ "$sudoers_installed" -eq 1 ]]; then rm -f -- "$SUDOERS_TARGET"; fi
        if [[ "$entry_installed" -eq 1 ]]; then rm -f -- "$ENTRY_TARGET"; fi
        if [[ "$helper_installed" -eq 1 ]]; then rm -f -- "$HELPER_TARGET"; fi
        if [[ "$core_installed" -eq 1 ]]; then rm -f -- "$CORE_TARGET"; fi
        if [[ "$revoke_installed" -eq 1 ]]; then rm -f -- "$REVOKE_TARGET"; fi
        if [[ "$audit_created" -eq 1 ]]; then rm -f -- "$AUDIT_LOG"; fi
        if [[ "$backup_directory_created" -eq 1 ]]; then rmdir -- /var/backups/hanouti-pos 2>/dev/null || true; fi
        if [[ "$run_directory_created" -eq 1 ]]; then rmdir -- /run/hanouti-pos-admin-v3 2>/dev/null || true; fi
        if [[ "$state_directory_created" -eq 1 ]]; then rmdir -- /var/lib/hanouti-pos-admin-v3 2>/dev/null || true; fi
        if [[ "$functions_release_directory_created" -eq 1 ]]; then rmdir -- "$COMPOSE_ROOT/volumes/functions/releases" 2>/dev/null || true; fi
        if [[ "$stack_release_directory_created" -eq 1 ]]; then rmdir -- "$COMPOSE_ROOT/releases" 2>/dev/null || true; fi
        if [[ "$config_created" -eq 1 ]]; then rm -rf -- "$CONFIG_DIR"; fi
    fi
    rm -rf -- "$bootstrap_work"
    exit "$status"
}
trap cleanup EXIT

deploy_uid="$(id -u hanouti-deploy)"
snapshot_stage_file() {
    python3 - "$1" "$2" "$deploy_uid" "$3" <<'PY_SNAPSHOT'
import os
import stat
import sys

source_path, target_path = sys.argv[1:3]
deploy_uid = int(sys.argv[3])
max_bytes = int(sys.argv[4])
source_flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
source_fd = os.open(source_path, source_flags)
target_fd = None
try:
    source_info = os.fstat(source_fd)
    if (
        not stat.S_ISREG(source_info.st_mode)
        or source_info.st_uid != deploy_uid
        or stat.S_IMODE(source_info.st_mode) != 0o600
        or source_info.st_nlink != 1
        or source_info.st_size > max_bytes
    ):
        raise SystemExit("unsafe staged input")
    target_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    target_fd = os.open(target_path, target_flags, 0o600)
    target_info = os.fstat(target_fd)
    if (
        not stat.S_ISREG(target_info.st_mode)
        or target_info.st_uid != 0
        or stat.S_IMODE(target_info.st_mode) != 0o600
        or target_info.st_nlink != 1
    ):
        raise SystemExit("unsafe root snapshot")
    copied = 0
    while True:
        block = os.read(source_fd, 1024 * 1024)
        if not block:
            break
        copied += len(block)
        if copied > source_info.st_size or copied > max_bytes:
            raise SystemExit("staged input changed while copying")
        view = memoryview(block)
        while view:
            written = os.write(target_fd, view)
            view = view[written:]
    if copied != source_info.st_size:
        raise SystemExit("staged input changed while copying")
    os.fsync(target_fd)
finally:
    os.close(source_fd)
    if target_fd is not None:
        os.close(target_fd)
PY_SNAPSHOT
}
snapshot_stage_file "$HELPER_STAGE" "$HELPER_SOURCE" 1048576
snapshot_stage_file "$CORE_STAGE" "$CORE_SOURCE" 1048576
snapshot_stage_file "$EDGE_SIGNERS_STAGE" "$EDGE_SIGNERS_SOURCE" 1048576
snapshot_stage_file "$RECIPIENT_STAGE" "$RECIPIENT_SOURCE" 1048576
snapshot_stage_file "$FINGERPRINT_STAGE" "$FINGERPRINT_SOURCE" 1024
snapshot_stage_file "$REVOKE_STAGE" "$REVOKE_SOURCE" 131072
printf '%s  %s\n' "$EXPECTED_HELPER_SHA256" "$HELPER_SOURCE" "$EXPECTED_CORE_SHA256" "$CORE_SOURCE" \
    "$EXPECTED_EDGE_SIGNERS_SHA256" "$EDGE_SIGNERS_SOURCE" "$EXPECTED_REVOKE_SHA256" \
    "$REVOKE_SOURCE" | sha256sum --check --status || {
    echo "A root-owned v3 source snapshot failed its pinned SHA-256 check." >&2
    exit 1
}

if [[ -e "$ENTRY_TARGET" || -L "$ENTRY_TARGET" ||
      -e "$HELPER_TARGET" || -L "$HELPER_TARGET" ||
      -e "$CORE_TARGET" || -L "$CORE_TARGET" ||
      -e "$REVOKE_TARGET" || -L "$REVOKE_TARGET" ||
      -e "$SUDOERS_TARGET" || -L "$SUDOERS_TARGET" ||
      -e "$CONFIG_DIR" || -L "$CONFIG_DIR" ]]; then
    echo "A v3 administrative installation already exists; refusing to overwrite it." >&2
    exit 1
fi
if [[ -e "$AUDIT_LOG" || -L "$AUDIT_LOG" ]]; then
    echo "A v3 audit log already exists; inspect it before bootstrapping." >&2
    exit 1
fi

recipient_fingerprint="$(tr -d '\r\n' < "$FINGERPRINT_SOURCE")"
if [[ ! "$recipient_fingerprint" =~ ^[A-F0-9]{40,64}$ ]]; then
    echo "The staged owner backup fingerprint is invalid." >&2
    exit 1
fi
key_listing="$(gpg --no-options --batch --with-colons --import-options show-only --import "$RECIPIENT_SOURCE" 2>/dev/null)" || {
    echo "The staged owner backup recipient is not a valid OpenPGP key." >&2
    exit 1
}
primary_fingerprint="$(
    printf '%s\n' "$key_listing" |
        awk -F: '$1 == "pub" { primary = 1; encryption = encryption || tolower($12) ~ /e/; next } $1 == "sub" { encryption = encryption || tolower($12) ~ /e/ } $1 == "fpr" && primary { print $10; primary = 0 } END { if (!encryption) exit 1 }'
)" || {
    echo "The staged owner backup key lacks an encryption-capable key." >&2
    exit 1
}
if [[ "$primary_fingerprint" != "$recipient_fingerprint" ]]; then
    echo "The staged owner backup key does not match its independently pinned fingerprint." >&2
    exit 1
fi
read -r -p "Type the backup-key fingerprint verified independently from the owner workstation: " confirmed_fingerprint
if [[ "$confirmed_fingerprint" != "$recipient_fingerprint" ]]; then
    echo "The owner backup key fingerprint did not match the independent confirmation." >&2
    exit 1
fi

staging_file="$(mktemp /usr/local/sbin/.hanouti-pos-admin-v3.XXXXXX)"
sudoers_file="$(mktemp /etc/sudoers.d/.hanouti-pos-admin-v3.XXXXXX)"

mkdir -- "$CONFIG_DIR"
config_created=1
chown root:root "$CONFIG_DIR"
chmod 0700 "$CONFIG_DIR"
install -o root -g root -m 0644 "$RECIPIENT_SOURCE" "$CONFIG_DIR/backup-recipient.asc"
install -o root -g root -m 0600 "$FINGERPRINT_SOURCE" "$CONFIG_DIR/backup-recipient-fingerprint"
install -o root -g root -m 0644 "$EDGE_SIGNERS_SOURCE" "$CONFIG_DIR/functions.allowed_signers"
umask 077
ssh-keygen -q -t ed25519 -C hanouti-pos-backup-manifest -N "" \
    -f "$CONFIG_DIR/backup-manifest-signing"
backup_signer_public="$(ssh-keygen -y -f "$CONFIG_DIR/backup-manifest-signing")"
printf 'hanouti-pos-backup %s\n' "$backup_signer_public" > "$CONFIG_DIR/backup-manifest.allowed_signers"
chown root:root "$CONFIG_DIR/backup-manifest-signing" "$CONFIG_DIR/backup-manifest.allowed_signers"
chmod 0600 "$CONFIG_DIR/backup-manifest-signing"
chmod 0644 "$CONFIG_DIR/backup-manifest.allowed_signers"

if [[ ! -d /var/backups/hanouti-pos ]]; then
    install -d -o root -g root -m 0700 /var/backups/hanouti-pos
    backup_directory_created=1
fi
if [[ ! -d /run/hanouti-pos-admin-v3 ]]; then
    install -d -o root -g root -m 0700 /run/hanouti-pos-admin-v3
    run_directory_created=1
fi
if [[ ! -d /var/lib/hanouti-pos-admin-v3 ]]; then
    install -d -o root -g root -m 0700 /var/lib/hanouti-pos-admin-v3
    state_directory_created=1
fi
if [[ ! -d "$COMPOSE_ROOT/volumes/functions/releases" ]]; then
    install -d -o root -g root -m 0755 "$COMPOSE_ROOT/volumes/functions/releases"
    functions_release_directory_created=1
fi
if [[ ! -d "$COMPOSE_ROOT/releases" ]]; then
    install -d -o root -g root -m 0755 "$COMPOSE_ROOT/releases"
    stack_release_directory_created=1
fi

core_installed=1
install -o root -g root -m 0644 "$CORE_SOURCE" "$CORE_TARGET"
helper_installed=1
install -o root -g root -m 0644 "$HELPER_SOURCE" "$HELPER_TARGET"
revoke_installed=1
install -o root -g root -m 0700 "$REVOKE_SOURCE" "$REVOKE_TARGET"
cat > "$staging_file" <<'ENTRYPOINT'
#!/bin/sh
exec /usr/bin/python3 /usr/local/sbin/hanouti_pos_admin_v3.py
ENTRYPOINT
chown root:root "$staging_file"
chmod 0755 "$staging_file"
entry_installed=1
install -o root -g root -m 0755 "$staging_file" "$ENTRY_TARGET"

audit_created=1
install -o root -g root -m 0600 /dev/null "$AUDIT_LOG"
printf '%s\n' "$SUDOERS_LINE" > "$sudoers_file"
chown root:root "$sudoers_file"
chmod 0440 "$sudoers_file"
visudo -cf "$sudoers_file" >/dev/null
sudoers_installed=1
install -o root -g root -m 0440 "$sudoers_file" "$SUDOERS_TARGET"
visudo -c >/dev/null
python3 -c 'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))' "$HELPER_TARGET"
python3 -c 'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))' "$CORE_TARGET"
python3 - "$AUDIT_LOG" <<'PY_AUDIT'
import os
import stat
from datetime import datetime, timezone

path = os.sys.argv[1]
descriptor = os.open(
    path,
    os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW,
)
try:
    info = os.fstat(descriptor)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_nlink != 1
        or stat.S_IMODE(info.st_mode) != 0o600
    ):
        raise SystemExit("bootstrap audit log is unsafe")
    line = "{} actor=root action=bootstrap service=none result=succeeded\n".format(
        datetime.now(timezone.utc).isoformat(timespec="seconds")
    ).encode("ascii")
    remaining = memoryview(line)
    while remaining:
        written = os.write(descriptor, remaining)
        remaining = remaining[written:]
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY_AUDIT

echo "Hanouti POS v3 administrative interface installed."
echo "Only the exact helper with no arguments is authorized by sudoers."
echo "The root-only revocation procedure is installed at $REVOKE_TARGET."
echo "No Docker command, database, application file, Nginx site, certificate, DNS record, or service was changed."
echo "Export the backup signer over the pinned SSH host key before trusting offline manifests."
