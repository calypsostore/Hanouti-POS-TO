#!/bin/bash
set -euo pipefail

readonly STAGE_DIR="/home/hanouti-deploy/.local/share/hanouti-pos-admin-bootstrap-v2"
readonly HELPER_SOURCE="$STAGE_DIR/hanouti_pos_admin.py"
readonly HELPER_TARGET="/usr/local/sbin/hanouti-pos-admin"
readonly SUDOERS_TARGET="/etc/sudoers.d/hanouti-pos-admin"
readonly AUDIT_LOG="/var/log/hanouti-pos-admin.log"
readonly EXPECTED_HELPER_SHA256="206af895f5fd46201caf113b00f48b159fe4836564696105201cbcc8705745ee"
readonly SUDOERS_LINE='hanouti-deploy ALL=(root) NOPASSWD: /usr/local/sbin/hanouti-pos-admin ""'

if [[ "$EUID" -ne 0 ]]; then
    echo "Run this one-time bootstrap from an authorized root console." >&2
    exit 1
fi

if [[ -L "$STAGE_DIR" || ! -d "$STAGE_DIR" ]] ||
   [[ "$(stat -c '%U' -- "$STAGE_DIR")" != "hanouti-deploy" ]] ||
   [[ "$(stat -c '%a' -- "$STAGE_DIR")" != "700" ]]; then
    echo "The staged bootstrap directory is not safe." >&2
    exit 1
fi
if [[ -L "$HELPER_SOURCE" || ! -f "$HELPER_SOURCE" ]]; then
    echo "The staged administrative helper is missing or unsafe." >&2
    exit 1
fi
if ! getent passwd hanouti-deploy >/dev/null; then
    echo "The expected deployment account does not exist." >&2
    exit 1
fi
if ! command -v visudo >/dev/null 2>&1 || ! command -v install >/dev/null 2>&1; then
    echo "Required sudo validation or installation tools are unavailable." >&2
    exit 1
fi
if [[ ! -d /usr/local/sbin || ! -d /etc/sudoers.d ]]; then
    echo "Expected system installation directories are unavailable." >&2
    exit 1
fi
if [[ "$(stat -c '%U' /usr/local/sbin)" != "root" ]] ||
   [[ "$(stat -c '%U' /etc/sudoers.d)" != "root" ]] ||
   (( (8#$(stat -c '%a' /usr/local/sbin) & 022) != 0 )) ||
   (( (8#$(stat -c '%a' /etc/sudoers.d) & 022) != 0 )) ||
   [[ "$(stat -c '%U' /var/log)" != "root" ]] ||
   (( (8#$(stat -c '%a' /var/log) & 022) != 0 )); then
    echo "A system installation directory has unsafe ownership or permissions." >&2
    exit 1
fi

staging_file="$(mktemp /usr/local/sbin/.hanouti-pos-admin.XXXXXX)"
sudoers_file="$(mktemp /etc/sudoers.d/.hanouti-pos-admin.XXXXXX)"
helper_installed=0
sudoers_installed=0
audit_created=0

cleanup() {
    status=$?
    rm -f -- "$staging_file" "$sudoers_file"
    if [[ "$status" -ne 0 ]]; then
        if [[ "$sudoers_installed" -eq 1 ]]; then
            rm -f -- "$SUDOERS_TARGET"
        fi
        if [[ "$helper_installed" -eq 1 ]]; then
            rm -f -- "$HELPER_TARGET"
        fi
        if [[ "$audit_created" -eq 1 ]]; then
            rm -f -- "$AUDIT_LOG"
        fi
    fi
    exit "$status"
}
trap cleanup EXIT

if [[ -e "$HELPER_TARGET" || -L "$HELPER_TARGET" || -e "$SUDOERS_TARGET" || -L "$SUDOERS_TARGET" ]]; then
    echo "An administrative interface already exists; refusing to overwrite it." >&2
    exit 1
fi
if [[ -e "$AUDIT_LOG" || -L "$AUDIT_LOG" ]]; then
    if [[ -L "$AUDIT_LOG" || ! -f "$AUDIT_LOG" ]] ||
       [[ "$(stat -c '%U:%G:%a' "$AUDIT_LOG")" != "root:root:600" ]]; then
        echo "The existing administrative audit log is not safely owned." >&2
        exit 1
    fi
else
    install -o root -g root -m 0600 /dev/null "$AUDIT_LOG"
    audit_created=1
fi

cat -- "$HELPER_SOURCE" > "$staging_file"
chown root:root "$staging_file"
chmod 0600 "$staging_file"
printf '%s  %s\n' "$EXPECTED_HELPER_SHA256" "$staging_file" | sha256sum --check --status
chmod 0755 "$staging_file"
install -o root -g root -m 0755 "$staging_file" "$HELPER_TARGET"
helper_installed=1

printf '%s\n' "$SUDOERS_LINE" > "$sudoers_file"
chown root:root "$sudoers_file"
chmod 0440 "$sudoers_file"
visudo -cf "$sudoers_file" >/dev/null
install -o root -g root -m 0440 "$sudoers_file" "$SUDOERS_TARGET"
sudoers_installed=1
visudo -c >/dev/null

python3 -c 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))' "$HELPER_TARGET"

echo "Hanouti POS administrative interface installed."
echo "The existing hanouti-vps-deploy helper and all application resources were left unchanged."
