#!/usr/bin/env bash
set -euo pipefail

expected_current="${1-}"
target_release="${2-}"
confirmation="${3-}"
release_pattern='^[0-9a-f]{40}-[0-9]+-[0-9]+$'
if [[ ! "$expected_current" =~ $release_pattern ||
      ! "$target_release" =~ $release_pattern ||
      "$expected_current" == "$target_release" ||
      "$confirmation" != "ROLLBACK" ]]; then
    echo "Rollback requires two distinct release IDs and explicit ROLLBACK confirmation." >&2
    exit 64
fi
if [[ "$(id -un)" != "hanouti-deploy" ]]; then
    echo "Rollback must run as hanouti-deploy." >&2
    exit 1
fi

deploy_root="/srv/www/hanouti-pos"
releases_dir="$deploy_root/releases"
current_link="$deploy_root/current"
previous_link="$deploy_root/previous"
lock_path="$deploy_root/.deployment.lock"
if [[ -L "$deploy_root" || ! -d "$deploy_root" ||
      "$(realpath -e -- "$deploy_root")" != "$deploy_root" ||
      ! -O "$deploy_root" || "$(stat -c '%U' -- "$deploy_root")" != "hanouti-deploy" ]]; then
    echo "The frontend deployment root is unsafe." >&2
    exit 1
fi
root_mode="$(stat -c '%a' -- "$deploy_root")"
if (( (8#$root_mode & 022) != 0 )); then
    echo "The frontend deployment root is group/other-writable." >&2
    exit 1
fi
if [[ -L "$releases_dir" || ! -d "$releases_dir" ||
      "$(realpath -e -- "$releases_dir")" != "$releases_dir" ||
      ! -O "$releases_dir" ]]; then
    echo "The frontend releases directory is unsafe." >&2
    exit 1
fi

umask 077
[[ -f "$lock_path" && ! -L "$lock_path" ]] || {
    echo "The frontend deployment lock is unsafe." >&2
    exit 1
}
exec 9<"$lock_path"
lock_fd_stat="$(stat -Lc '%d:%i:%U:%a:%h' -- "/proc/$$/fd/9")"
lock_path_stat="$(stat -c '%d:%i:%U:%a:%h' -- "$lock_path")"
[[ ! -L "$lock_path" && "$lock_fd_stat" == "$lock_path_stat" &&
   "$(stat -c '%U' -- "$lock_path")" == "hanouti-deploy" &&
   "$(stat -c '%a' -- "$lock_path")" == "600" &&
   "$(stat -c '%h' -- "$lock_path")" == "1" ]] || {
    echo "The frontend deployment lock is unsafe." >&2
    exit 1
}
flock -n 9 || {
    echo "Another frontend deployment or rollback is in progress." >&2
    exit 1
}

expected_path="$releases_dir/$expected_current"
target_path="$releases_dir/$target_release"
for release_path in "$expected_path" "$target_path"; do
    [[ -d "$release_path" && ! -L "$release_path" &&
       "$(realpath -e -- "$release_path")" == "$release_path" &&
       -O "$release_path" && -s "$release_path/index.html" &&
       -s "$release_path/version.json" ]] || {
        echo "A requested frontend release is missing or unsafe." >&2
        exit 1
    }
done
[[ -L "$current_link" &&
   "$(realpath -e -- "$current_link")" == "$expected_path" ]] || {
    echo "Rollback refused because current no longer matches the expected release." >&2
    exit 1
}

current_tmp="$deploy_root/.rollback-current-${expected_current}"
previous_tmp="$deploy_root/.rollback-previous-${expected_current}"
if [[ -e "$current_tmp" || -L "$current_tmp" ||
      -e "$previous_tmp" || -L "$previous_tmp" ]]; then
    echo "A rollback temporary pointer already exists." >&2
    exit 1
fi
ln -s -- "$expected_path" "$previous_tmp"
mv -Tf -- "$previous_tmp" "$previous_link"
ln -s -- "$target_path" "$current_tmp"
mv -Tf -- "$current_tmp" "$current_link"
[[ "$(realpath -e -- "$current_link")" == "$target_path" ]] || {
    echo "Frontend rollback pointer verification failed." >&2
    exit 1
}
printf 'FRONTEND_ROLLBACK=completed from=%s to=%s\n' "$expected_current" "$target_release"
