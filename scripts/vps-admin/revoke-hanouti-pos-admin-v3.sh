#!/bin/bash
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
umask 077

readonly ENTRY_TARGET="/usr/local/sbin/hanouti-pos-admin-v3"
readonly HELPER_TARGET="/usr/local/sbin/hanouti_pos_admin_v3.py"
readonly CORE_TARGET="/usr/local/sbin/hanouti_pos_admin.py"
readonly REVOKE_TARGET="/usr/local/sbin/hanouti-pos-admin-v3-revoke"
readonly SUDOERS_TARGET="/etc/sudoers.d/hanouti-pos-admin-v3"
readonly SUDOERS_DIR="/etc/sudoers.d"
readonly AUDIT_LOG="/var/log/hanouti-pos-admin-v3.log"
readonly EXPECTED_ENTRY_SHA256="1d3db6bb644dc4331dfad2ded3cff1b480dcf5b64ce35f804eaa5d3f7b60c2c0"
readonly EXPECTED_HELPER_SHA256="20a487c87b87cdfb205ca3a8e6fd01ba94b2b21f1be9729eecc23768dab131a4"
readonly EXPECTED_CORE_SHA256="77440059d7769a29961db4ee7843fe5066ebc90e0ec5e260fd75116df6e8ea15"

if [[ "$EUID" -ne 0 ]]; then
    echo "Run this revocation from an authorized root console." >&2
    exit 1
fi

script_source="${BASH_SOURCE[0]}"
if [[ -L "$script_source" || ! -f "$script_source" ]]; then
    echo "The revocation procedure must be the installed root-owned copy." >&2
    exit 1
fi
script_path="$(realpath -e -- "$script_source")"
script_directory="$(dirname -- "$script_path")"
if [[ "$(stat -c '%U:%G:%a:%h' -- "$script_path")" != "root:root:700:1" ||
      "$(stat -c '%U' -- "$script_directory")" != "root" ||
      "$(realpath -e -- "$script_directory")" != "$script_directory" ]] ||
   (( (8#$(stat -c '%a' -- "$script_directory") & 022) != 0 )); then
    echo "The revocation procedure or its directory is not safely protected." >&2
    exit 1
fi
if [[ ! -d "$SUDOERS_DIR" || -L "$SUDOERS_DIR" ||
      "$(stat -c '%U' -- "$SUDOERS_DIR")" != "root" ||
      "$(realpath -e -- "$SUDOERS_DIR")" != "$SUDOERS_DIR" ]] ||
   (( (8#$(stat -c '%a' -- "$SUDOERS_DIR") & 022) != 0 )); then
    echo "The sudoers include directory is unsafe; administrative access was not changed." >&2
    exit 1
fi


write_revocation_audit() {
    python3 - "$AUDIT_LOG" "$1" <<'PY_AUDIT' || return 1
import os
import stat
import sys
from datetime import datetime, timezone

path, result = sys.argv[1:3]
descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
try:
    info = os.fstat(descriptor)
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != 0
        or info.st_nlink != 1
        or stat.S_IMODE(info.st_mode) != 0o600
    ):
        raise SystemExit("revocation audit log is unsafe")
    line = "{} actor=root action=revocation service=none result={}\n".format(
        datetime.now(timezone.utc).isoformat(timespec="seconds"),
        result,
    ).encode("ascii")
    remaining = memoryview(line)
    while remaining:
        written = os.write(descriptor, remaining)
        remaining = remaining[written:]
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY_AUDIT
}

if ! write_revocation_audit started; then
    echo "The revocation start could not be recorded; revocation will still be attempted." >&2
fi
audit_result=failed
finish_revocation() {
    status=$?
    trap - EXIT
    if [[ "$status" -eq 0 ]]; then
        audit_result=succeeded
    fi
    if ! write_revocation_audit "$audit_result"; then
        echo "Revocation state may have changed, but the audit result could not be recorded." >&2
        status=1
    fi
    exit "$status"
}
trap finish_revocation EXIT
if [[ -d "$SUDOERS_TARGET" && ! -L "$SUDOERS_TARGET" ]]; then
    echo "The dedicated v3 sudoers path is a directory; manual root review is required." >&2
    exit 1
fi
if [[ -e "$SUDOERS_TARGET" || -L "$SUDOERS_TARGET" ]]; then
    rm -f -- "$SUDOERS_TARGET"
fi
if [[ -e "$SUDOERS_TARGET" || -L "$SUDOERS_TARGET" ]]; then
    echo "The v3 sudoers grant could not be removed." >&2
    exit 1
fi

sudoers_valid=0
if command -v visudo >/dev/null 2>&1 && visudo -c >/dev/null; then
    sudoers_valid=1
fi

verify_installed_file() {
    local path="$1"
    local expected="$2"
    local expected_mode="$3"
    if [[ -e "$path" || -L "$path" ]]; then
        if [[ -L "$path" || ! -f "$path" ||
              "$(stat -c '%U:%G:%a:%h' -- "$path")" != "root:root:$expected_mode:1" ]]; then
            echo "Access is revoked, but an installed file is unsafe and was preserved: $path" >&2
            exit 1
        fi
        printf '%s  %s\n' "$expected" "$path" | sha256sum --check --status || {
            echo "Access is revoked, but a modified installed file was preserved: $path" >&2
            exit 1
        }
    fi
}

if ! command -v sha256sum >/dev/null 2>&1; then
    echo "The v3 sudoers grant is revoked; hash verification is unavailable, so helper files were preserved." >&2
    exit 1
fi
verify_installed_file "$ENTRY_TARGET" "$EXPECTED_ENTRY_SHA256" 755
verify_installed_file "$HELPER_TARGET" "$EXPECTED_HELPER_SHA256" 644
verify_installed_file "$CORE_TARGET" "$EXPECTED_CORE_SHA256" 644
for path in "$ENTRY_TARGET" "$HELPER_TARGET" "$CORE_TARGET"; do
    if [[ -e "$path" ]]; then
        rm -- "$path"
    fi
done

if [[ "$sudoers_valid" -ne 1 ]]; then
    echo "The v3 sudoers grant is revoked; remaining sudoers configuration needs operator review." >&2
    exit 1
fi

echo "The v3 sudo grant and verified helper files were revoked."
echo "The root-only revocation procedure remains installed; backup keys, archives, audit logs, releases, Docker resources, data, and other services were preserved."
