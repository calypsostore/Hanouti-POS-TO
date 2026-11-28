# Hanouti POS self-hosted deployment

This bundle prepares a dedicated deployment for `hanouti-pos.tn`. It does not
start containers, connect to Supabase Cloud, contact the VPS, change DNS, or
deploy anything. The Cloud project and Vercel deployment remain the rollback
targets until cutover is separately approved.

## What is prepared

- `docker-compose.yml` pins the Supabase services and isolates them in the
  `hanouti-supabase` Compose project, network, and named volumes.
- `volumes/db/` contains the official PostgreSQL initialization SQL needed for
  Realtime, Supavisor, webhooks, JWT expiry, roles, and the `_supabase` database.
- `volumes/pooler/pooler.exs` and the Realtime entrypoint are pinned upstream
  assets.
- `volumes/functions/main/` contains the Edge Runtime dispatcher and event
  worker from Supabase commit
  `3580c144a456f1dd9e88c8db9dece36e0ded4bd8`. Its Apache-2.0 license is
  included with the function package.
- `.github/scripts/package-supabase-vps-functions.py` builds a bounded archive
  containing only the eight project functions, the runtime dispatcher, and the
  three imported notification catalogs. It deliberately excludes ignored local
  `.env` files.
- The Nginx file is a domain-specific example only; it is not installed.

The pinned Supabase component versions were compared with the official
self-hosting Compose file at preparation time: PostgreSQL `17.6.1.136`,
GoTrue `v2.199.0`, PostgREST `v14.18`, Realtime `v2.177.1`, Storage API
`v1.98.7`, imgproxy `v4.0.25`, Edge Runtime `v1.79.2`, postgres-meta
`v0.100.1`, and Studio `2026.11.23-sha-4a73166`. Kong `3.9.5` is intentionally
retained for this requested deployment; current official self-hosting Compose
uses Envoy instead, so Kong routing still requires an on-VPS smoke test before
production traffic.

## Isolation, ports, and persistence

- Compose project: `hanouti-supabase`.
- Network: `hanouti-supabase` (private bridge; no external networks).
- Persistent volumes: `hanouti-pos-db-data`, `hanouti-pos-db-config`,
  `hanouti-pos-storage-data`, and `hanouti-pos-deno-cache`.
- Only Kong (`127.0.0.1:8000`) and Studio (`127.0.0.1:3003`) publish host
  ports. PostgreSQL, Supavisor, Auth, REST, Realtime, Storage, imgproxy,
  functions, and pg-meta have no host-published ports.
- Storage API objects are persisted in `hanouti-pos-storage-data`; database
  metadata is persisted in `hanouti-pos-db-data`.

Do not run `docker compose down -v`, remove named volumes, or use global Docker
prune commands during normal deployment or rollback. The fixed names are
reserved for Hanouti POS and must not be reused by another project.

## Secrets and local configuration

Use `/opt/supabase-vps/deployment/.env` on the VPS. Create it from
`.env.example` only if it is absent; preserve any existing file and its
ownership. Keep permissions at `0600` and keep it outside Git. Do not copy
real values into this repository or chat.

Generate separate cryptographically random values for:

- `POSTGRES_PASSWORD` (use URL-safe hexadecimal characters because it appears
  in database connection URLs).
- `JWT_SECRET` (at least 32 random bytes).
- `SECRET_KEY_BASE`, `VAULT_ENC_KEY`, `REALTIME_DB_ENC_KEY`, and
  `PG_META_CRYPTO_KEY` (each meets its component's required length/format).
- `LOGIN_RATE_LIMIT_PEPPER`, `PUSH_WEBHOOK_SECRET`, and `DASHBOARD_PASSWORD`.
- `ANON_KEY` and `SERVICE_ROLE_KEY`: legacy HS256 JWTs with roles `anon` and
  `service_role`, respectively, signed using the final `JWT_SECRET`. Keep all
  JWT-verifying services on that same secret. Do not use the service-role key
  in a browser build.

The included `.env.example` intentionally contains placeholders, not generated
secrets. `PUSH_WEBHOOK_SECRET` must be a 64-character hex value when the
`send-push` function is enabled. `FCM_SERVICE_ACCOUNT_JSON` is a private,
single-line JSON value and is needed only for Firebase push delivery. Configure
SMTP before expecting email confirmation, invitation, or password-recovery
messages to work. Public signup and phone signup are disabled by default; only
change `DISABLE_SIGNUP` after confirming the Cloud Auth policy and approving
the public-registration behavior.

For the VPS frontend workflow, configure the GitHub Actions environment
`hanouti-pos-vps` with:

- `VPS_SSH_KEY`: a restricted key for `hanouti-deploy`, with no sudo or Docker
  access.
- `VPS_KNOWN_HOSTS`: the independently verified pinned SSH host key.
- `VPS_SUPABASE_ANON_KEY`: the new self-hosted `ANON_KEY` only. It is public
  browser configuration; never put `SERVICE_ROLE_KEY` here.

The workflow remains manual and branch-restricted. It has not been dispatched.

## Edge Functions

The project has eight functions: `device-login`, `device-session`,
`device-staff-pin`, `login`, `manage-devices`, `provision-account`,
`send-push`, and `verify-password`. They use `npm:@supabase/supabase-js@2`;
the Supabase runtime dispatcher also uses `jsr:@panva/jose@6`.

The runtime package includes the `main` dispatcher and the locale imports
required by `_shared/notificationContent.ts`. Do not mount `supabase/functions`
directly: it can contain a local `.env.local` file. After the v3 bootstrap and
the protected local signing key are ready, the owner runs
`scripts/vps-admin/deploy-signed-vps-release.ps1 -ReleaseType edge-functions
-Confirmation DEPLOY`. It packages on the owner workstation, signs with
OpenSSH Ed25519, verifies the signature locally, then stages only the signed
archive, detached signature, and checksum. The root-owned helper verifies the
signature again before extracting to an immutable
`volumes/functions/releases/<release-id>` directory and atomically switching
`volumes/functions/current`. Only the Functions service is restarted. A
manually confirmed `rollback-supabase-vps-functions` workflow restores the
prior verified release. The signing private key is not stored in GitHub or
sent to the VPS.

The helper checks the Functions container state after activation and restores
the old pointer/service on failure. Before public use, still integration-test
all eight routes against the recovery stack; container health is not proof of
handler authentication or correct application behavior.

`FUNCTIONS_VERIFY_JWT=false` is required for the single Edge Runtime process:
the `login`, `device-login`, and `send-push` endpoints have their own distinct
authentication mechanisms, while the other functions verify caller identity
inside their handlers. The per-function `verify_jwt` entries in
`supabase/config.toml` are not automatically enforced by this raw runtime
container. The handler-level checks and all eight routes must be integration-
tested against the recovery stack before public use.

Required function environment includes `SUPABASE_URL`,
`SUPABASE_PUBLIC_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
and `LOGIN_RATE_LIMIT_PEPPER`. Push delivery additionally needs
`PUSH_WEBHOOK_SECRET` and `FCM_SERVICE_ACCOUNT_JSON`. The functions do not
access PostgreSQL directly, so the stack deliberately does not pass its
database password to the Edge Runtime.

## Versioned Supabase stack and rollback

The local release client packages only the reviewed Compose document plus an
exact service-image inventory; it signs locally under a separate OpenSSH
signature namespace. The helper validates the fixed project/service/image
repositories, mounts, volumes, network, and host ports, and keeps each accepted
release under `/opt/supabase-vps/deployment/releases/<release-id>`. Secrets
remain in the root-only `.env`; the package cannot change them or bind-mount
arbitrary host paths.

Before deploying, create an encrypted POS backup and verify its ID. Stack
activation refuses to proceed unless the backup manifest signature, archive
size, and digest all verify. Run the signed release client with
`-ReleaseType supabase-stack`, `-BackupId <verified-id>`, and
`-Confirmation DEPLOY`. It pulls the validated image set and runs Compose
`up -d`; it never runs `down`, `down -v`, prune, migrations, SQL, or volume
deletion. Health/ownership failure restores the previous Compose release and
restarts the prior stack. For an explicit operator rollback, dispatch
`Manually roll back Supabase VPS stack` and confirm `ROLLBACK`.

This is a service/configuration rollback, not a database rewind. Upstream
container startup may migrate internal schemas, so check version compatibility
and retain the verified backup; restoration remains a separately gated local
recovery operation. No stack deploy or rollback has been run.

## Frontend integration

The existing Vite client reads `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`. The manual VPS build workflow sets the URL to
`https://hanouti-pos.tn`; Supabase JS uses that origin with `/auth/v1`,
`/rest/v1`, `/realtime/v1`, `/storage/v1`, and `/functions/v1`.
`VITE_APP_URL` is also set to `https://hanouti-pos.tn`. Local development and
the existing Vercel configuration are unchanged.

APK update checks now read the public GitHub latest-release metadata directly,
not the Vercel `/api/update-manifest` route. Web update checks continue to use
the deployed `version.json`.

The existing signed Android APKs still use the hosted URL embedded at build
time and remain Vercel-dependent. A future, separately approved APK build must
set `CAP_SERVER_URL=https://hanouti-pos.tn`, `VITE_APP_URL=https://hanouti-pos.tn`,
`VITE_SUPABASE_URL=https://hanouti-pos.tn`, and the matching public
`VITE_SUPABASE_ANON_KEY`. Keep the existing Cloud build secrets unchanged for
rollback; the Android release workflow needs an explicitly selected,
VPS-targeted build configuration before a replacement APK can be released.

## Database and account migration

No Cloud connection, database dump, backup, or restore has been run. The local
repository contains 77 ordered SQL migrations through
`20261127230000_super_admin_store_read_only_access.sql`; this does not prove
which migrations are applied to the Cloud project.

Use this gated procedure only after a Cloud backup and an isolated recovery
stack have been approved:

1. Read-only inventory the Cloud PostgreSQL major version, installed
   extensions, schemas, roles, grants, Auth configuration, function settings,
   database hooks, and exact migration history. Keep credentials and exported
   user data encrypted and out of Git.
2. Produce an encrypted, full logical database backup and independently
   protected Auth/configuration exports. A `pg_dump` artifact alone is not
   proof of recoverability and does not include Storage object binaries.
3. Initialize a separate recovery stack with the same pinned image set.
   Compare the Cloud and target Auth/Storage internal schema versions before
   restoring any managed schemas. Do not restore Cloud `auth` or `storage`
   tables over a mismatched self-hosted schema.
4. Apply the repository migrations to a blank recovery database only after
   reconciling its schema with the Cloud schema and checking for dashboard-made
   changes. Review roles, ownership, grants, extensions, triggers, and
   `supabase_migrations` history independently; the initial database scripts
   are not a substitute for application migrations.
5. Restore into recovery, reconcile Auth identities and app data, then verify
   all three existing test accounts by signing in with their existing
   credentials. Password-hash compatibility is not yet verified. Do not claim
   passwords or identities are preserved until those tests pass. Expect old
   access tokens to require sign-in again if the JWT signing secret changes.
6. Test the application, permissions/RLS, reports, functions, Realtime, and
   restore checks against recovery. Keep Cloud and Vercel available.
7. Only for a separately approved cutover: freeze writes, take a final
   consistent delta/snapshot, repeat the validated restore, validate again,
   then change DNS. Keep the Cloud project and old Vercel frontend intact for
   the agreed rollback period.

The current daily-backup workflow is only preparation; no run or restore has
been confirmed. It must not be treated as the migration backup without a
successful restore rehearsal. Do not dispatch it during this preparation task.

## Storage migration

The tracked migrations contain no Storage bucket or policy creation, and the
frontend currently has no `storage.from(...)` calls. Cloud bucket/object state
is unknown because Cloud access is intentionally out of scope.

Before migration, inventory every Cloud bucket, visibility setting, size/MIME
restriction, object key, metadata, policy, and object count. Export actual
binary objects separately from database metadata. Copy bucket configuration,
objects, metadata, and policies to the recovery stack; compare object counts,
byte totals, and checksums, then test public, authenticated, and signed URLs.
Do not declare Storage migrated based only on `storage.objects` rows or a
database dump.

## VPS, Nginx, DNS, and TLS sequence

These are operator actions for a later approved deployment; none has been
performed:

1. Verify DNS A/AAAA records for `hanouti-pos.tn` independently. The A record
   must resolve to `84.247.176.105`; remove or correct any stale AAAA record.
2. Use the existing active Compose root `/opt/supabase-vps/deployment` and
   `/srv/www/hanouti-pos` for frontend releases. Do not create a replacement
   Compose root, use symlinks, move existing files, or change existing
   ownership or permissions. Do not touch `hanouti-stores.tn`, its Nginx site,
   containers, volumes, files, ports, or certificates.
3. Place this Compose bundle, its reviewed `.env`, the validated current Edge
   Function package, and its `current` symlink under the dedicated paths.
   Check `docker compose --env-file .env config --quiet`, then start only the
   `hanouti-supabase` project. Verify every service health status and test each
   API route locally through `127.0.0.1:8000`.
4. Install the Nginx example as a new `hanouti-pos.tn`-only site. Confirm it
   serves `/srv/www/hanouti-pos/current`, falls back to `index.html`, and
   proxies the five Supabase routes before the SPA fallback. Run `nginx -t`
   and inspect the site diff before reloading Nginx.
5. After DNS points at the VPS, obtain HTTPS for `hanouti-pos.tn` using the
   operator's approved ACME process. Verify certificate hostname/expiry and
   HTTPS routes. Do not modify or renew the other site's certificate.
6. Dispatch the frontend workflow only after backend and Nginx checks pass.
   It atomically switches the frontend release symlink and retains prior
   releases for rollback. Verify frontend-to-API connectivity, login, uploads,
   Realtime, and every function before cutover.
7. Roll back the frontend through the guarded manual workflow. Roll back
   backend service versions through the v3 guarded stack/function rollback
   actions and follow the separately tested database/storage recovery plan;
   never delete volumes as a rollback step.

## Not yet verified

No VPS state, DNS, Nginx, TLS, Compose runtime, live health check, Cloud
backup/restore, Auth password compatibility, Storage inventory/object copy, or
Edge Function invocation has been verified. The v3 helpers and workflows have
only local automated-test coverage; root installation and remote activation
remain blocked pending separately authorized provisioning and owner GPG key
setup. Existing signed Android APKs
remain configured for the current hosted endpoint until a new authorized APK
is built with the VPS target. This is a deployment bundle and runbook, not
evidence that the site is live.
