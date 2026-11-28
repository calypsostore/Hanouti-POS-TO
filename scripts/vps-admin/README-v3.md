# Hanouti POS VPS administration v3

The Admin v3 bootstrap and restricted helper are installed. The owner GPG
backup key and encrypted offline backup are prepared, and the public backup
signer has been exported locally. This source update adds the read-only
`database-backup-list` action; it is not available on the VPS until the
hash-pinned helper update is installed. No database, Docker, application
service, DNS/Nginx/TLS, or `hanouti-stores.tn` resource is changed by this
listing action. The v2 action protocol and operational behavior remain
unchanged.

## Capabilities

- Fixed JSON request protocol, pinned-host SSH clients, and an exact no-argument
  sudo entry point.
- PostgreSQL custom-format backups encrypted directly to the pinned owner GPG
  recipient. Each manifest is signed with a separate root-only Ed25519 host
  signing key; archive size, SHA-256, and signature are verified before export
  or use.
- Binary-safe encrypted backup export and a local restore tool. The restore
  verifies the signed manifest and ciphertext, decrypts only into a pipe, and
  permits restore only to a loopback `hanouti_recovery_*` database after an
  exact database-name confirmation. It does not expose a server-side restore
  action, run `--clean`, or target a production database.
- Signed Edge Function releases. The local release client signs the package
  with an SSH signing key that remains on the owner workstation. The installed
  helper verifies the signature and checksum, validates and installs an
  immutable release, atomically switches the `current` pointer, restarts only
  the Functions service, checks its state, and reverts the pointer/service on
  failure. A manually confirmed rollback swaps to the last verified release.
- Versioned Supabase Compose releases. The local client signs a Compose file
  and image inventory. The helper validates the fixed project, service names,
  images, mounts, volumes, network, and ports; requires a signed, verified
  database backup ID; pulls only the approved stack images; and applies the
  configuration without `down`, volume deletion, prune, or application SQL.
  It keeps the prior Compose release and automatically restores it on failed
  activation. The active Compose root is `/opt/supabase-vps/deployment`; its
  existing ownership and permissions are preserved. A separate confirmed
  action restores the previous version.
- Frontend deploy remains manual and branch/environment restricted. The
  separate manual rollback requires the exact current and target release IDs,
  a `ROLLBACK` confirmation, the deployment lock, and post-switch build-ID
  health verification.
- A one-time root bootstrap and hash-checked revocation procedure. Sudo grants
  only `/usr/local/sbin/hanouti-pos-admin-v3` with no arguments; the helper
  accepts only fixed, allowlisted JSON requests. Bootstrap and revocation
  hashes are populated and tested against the exact helper, core, verifier,
  and entrypoint bytes.

Stack rollback restores service images/configuration only. It cannot reverse
database schema changes made by upstream container startup migrations; review
version compatibility and keep a verified backup before every stack release.
No v3 action automatically restores database contents or applies application
migrations. Shared Nginx reloads, certificate renewal, DNS, firewall changes,
and other projects are deliberately excluded.

## Local key material and secure handoff

The Edge/stack signing key was generated locally at
`%USERPROFILE%\.ssh\hanouti-pos-v3-signing\functions-signing`; its directory
ACL is limited to the current user, SYSTEM, and local Administrators. Its
private key is not tracked, copied to GitHub, sent to the VPS, or included in
chat. The public verifier is
[`keys/edge-functions.allowed_signers`](./keys/edge-functions.allowed_signers).
Keep a protected offline copy of the private key. To sign and deploy a clean,
committed feature-branch release after bootstrap, run:

```powershell
.\scripts\vps-admin\deploy-signed-vps-release.ps1 `
  -ReleaseType edge-functions -Confirmation DEPLOY
```

The script signs locally, verifies its own signature, stages only the signed
archive/checksum/signature with pinned SSH, and invokes the exact helper action.
It refuses dirty worktrees and does not transmit the signing private key. For
a stack release, first create and verify a database backup, then provide its
ID:

```powershell
.\scripts\vps-admin\deploy-signed-vps-release.ps1 `
  -ReleaseType supabase-stack -BackupId 20261128T120000Z-a1b2c3d4 `
  -Confirmation DEPLOY
```

GnuPG 2.4.9 is available here from the Git for Windows toolchain; no software
was installed. The existing owner backup key and encrypted offline backup are
complete. Its protected GPG home is under
`%USERPROFILE%\.ssh\hanouti-pos-backup-key`; only the public key and
fingerprint are staged. Do not rerun the key-preparation script for this
setup. Never put the private key or passphrase in the repository, GitHub, the
VPS, or chat.

The server-side backup-manifest signing key is generated root-only by the
bootstrap. After bootstrap, fetch its public verifier over the existing pinned
SSH host key:

```powershell
.\scripts\vps-admin\export-backup-signer.ps1
```

That signer file is the independent trust anchor used for offline manifest
verification. Keep it alongside encrypted backup copies. Export an encrypted
backup without PowerShell text conversion:

```powershell
.\scripts\vps-admin\hanouti-pos-admin-v3.ps1 -Action database-backup-list
```

This read-only action lists only backups with a valid ID whose signed manifest,
signature, archive ownership/mode, encrypted archive size, and SHA-256 verify.
It prints each ID, the signed UTC `created_at` timestamp, and `status=verified`;
it never exports an archive. If a valid-ID backup has missing or unsafe
components or fails verification, the listing fails rather than returning a
partial list. Unrecognized filenames are ignored.

After selecting an ID from the verified list, export it without PowerShell text
conversion:

```powershell
.\scripts\vps-admin\export-backup.ps1 -BackupId 20261128T120000Z-a1b2c3d4
```

For offline restore, create an **empty local recovery database** on loopback,
set `PGHOST=127.0.0.1`, `PGDATABASE=hanouti_recovery_<unique_suffix>`, and the
local `PGUSER`/`PGPASSWORD`/`PGPORT` environment values. Then:

```powershell
python .\scripts\vps-admin\restore_offline.py `
  --bundle "$env:USERPROFILE\Downloads\hanouti-pos-20261128T120000Z-a1b2c3d4.tar" `
  --trusted-signers "$env:USERPROFILE\Documents\hanouti-pos-backup.allowed_signers" `
  --gpg-home "$env:USERPROFILE\.ssh\hanouti-pos-backup-key" `
  --confirm-database "$env:PGDATABASE"
```

The encrypted bundle is stored temporarily; decrypted bytes pass directly from
GPG into `pg_restore`. Supply `PGHOST` as a loopback IP literal (for example
`127.0.0.1`), not a host alias. The selected owner key home is passed only to
GPG; non-loopback hosts, host aliases, non-recovery database names, mismatched
confirmations, invalid signatures, bad hashes, duplicate/traversal archive
entries, and failed decrypt/restore commands are rejected.

## One-time bootstrap (already installed)

The one-time bootstrap has completed. Do not rerun it to deploy helper
updates. The initial-install procedure below is retained for audit/reference;
the currently installed sudo rule permits only the no-argument helper and
does not provide an in-band helper updater.

Initial-install staging and verification procedure:

1. The owner GPG key and encrypted offline backup are already prepared.
   Stage only `backup-recipient.asc` and `backup-recipient-fingerprint` in
   the `keys` subdirectory of the exact deployment-user staging directory.
   Existing root-level copies are preserved but are not bootstrap inputs.
   Never stage the private key.
2. Stage `hanouti_pos_admin_v3.py`, `hanouti_pos_admin.py`, and
   `keys/edge-functions.allowed_signers`, `keys/backup-recipient.asc`,
   `keys/backup-recipient-fingerprint`, and
   `revoke-hanouti-pos-admin-v3.sh` in
   `/home/hanouti-deploy/.local/share/hanouti-pos-admin-bootstrap-v3`, all
   owned by `hanouti-deploy`, mode `0600`; the staging directory and its
   `keys` subdirectory must be mode `0700`. Also stage
   `bootstrap-hanouti-pos-admin-v3.sh` mode `0600`. The bootstrap snapshots
   staged inputs into a private root-owned directory, then verifies pinned
   hashes and the recipient fingerprint before using them; this prevents a
   concurrent deployment-account change between checking and installation.
3. During initial installation, from an independently authorized root console,
   copy the bootstrap into `/root`, verify the exact source hash below, and
   run only that verified root-owned copy:

   ```sh
   install -o root -g root -m 0700 \
     /home/hanouti-deploy/.local/share/hanouti-pos-admin-bootstrap-v3/bootstrap-hanouti-pos-admin-v3.sh \
     /root/hanouti-pos-admin-v3-bootstrap.sh &&
   printf '%s  %s\n' 'BOOTSTRAP_SHA256' \
     /root/hanouti-pos-admin-v3-bootstrap.sh | sha256sum --check - &&
   /root/hanouti-pos-admin-v3-bootstrap.sh
   ```

   `BOOTSTRAP_SHA256` is `a0bbb5322d1645fa6cf86679dee2efa776be4f56abb671ac25eee5f9fb564758`.
   The script refuses to run from a deployment-user-writable location. It
   snapshots staged inputs into root-owned storage, validates `visudo`, asks
   for independent confirmation of the owner-key fingerprint, and installs
   the root-owned helper, core, configuration, audit log and revocation
   procedure. It does not start/restart services or modify application data.
4. Confirm a harmless `host-status` result and root-only audit entries. Export
   and independently retain the new backup signer public key before creating
   backups.

The sudoers rule permits only the v3 entry point with an empty argument list.
The deployment account receives no Docker-group membership or shell/root
grant. V3 has no arbitrary command, SQL, restore, `compose down`, volume
deletion, Nginx reload, or certificate-renewal action.

## Revocation (not run)

From an authorized root console, run the root-owned
`/usr/local/sbin/hanouti-pos-admin-v3-revoke`. It first removes the dedicated
v3 sudoers include, then validates the remaining sudoers policy and removes
only hash-verified v3 helper/entrypoint files. If a helper hash is unexpected,
the sudo grant is still already disabled and the changed file is preserved for
inspection. It deliberately preserves backup archives, GPG recipient
material, the backup signing key, audit logs, releases, Docker resources, and
unrelated services/data.

## Validation evidence and remaining gates

- `python -m unittest tests.test_hanouti_pos_admin_v3 tests.test_hanouti_pos_admin`
  covers protocol allowlists, backup replacement/signature checks, offline
  bundle and restore restrictions, safe Edge Function archive extraction,
  deployment signature namespace routing, bootstrap/revocation hash pins,
  real OpenSSH Ed25519 signing/verifying, stack package contents/image pins,
  and existing v2 behavior.
- The provided isolated PostgreSQL/GPG restore rehearsal passed as reported;
  it did not use an owner key or exercise the installed v3 helper.
- A disposable GPG key was generated only in a temporary test home; binary
  encryption/decryption round-tripped successfully. No real owner key, VPS
  stage, or VPS test was produced.
- No local Git or VPS staging was performed. The deployment SSH key and
  pinned `known_hosts` file are present locally; their private contents were
  not read or displayed.
- No workflow was dispatched. Frontend deployment, Edge Function activation,
  stack activation/rollback, backup creation/export, and recovery restore
  remain unexecuted pending authorized provisioning and owner key setup.
- This worktree contains pre-existing user changes and the new implementation
  remains unstaged/uncommitted; deployment helper intentionally refuses a
  dirty worktree.
