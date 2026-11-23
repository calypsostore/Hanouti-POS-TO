# 7anouti-POS

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```sh
npm install
npm run dev
```

Local demo accounts are available only with `VITE_DATA_DRIVER=local`:

| Role | Username / email | Initial password |
| --- | --- | --- |
| Staff | `CFSD.sarah` | `1234` |
| Owner | `owner@cafelamarsa.tn` | `owner123` |
| Super admin | `admin@7anouti.tn` | `admin123` |

These accounts are seeded in browser storage and are not production
credentials. All three require a password change at first login. Staff must
also set a personal PIN before entering the workspace. Production builds
require `VITE_DATA_DRIVER=supabase` and replace demo seed data with empty
fixtures; a local-driver production build is rejected.
`npm run dev` uses the local demo driver by default. Existing saved reports
keep their frozen store and print settings when settings later change.

The `local` driver stores data in that browser only; it does not sync to
Android or other devices. For shared admin and staff data, configure web
deployments and local development with `VITE_DATA_DRIVER=supabase` and the
same Supabase project URL and anon key. Android loads the production web app
and uses its configured Supabase project.

## First-time Supabase setup

Complete this checklist once for each environment:

1. **Create the project.** Create a Supabase project in the Supabase dashboard
   and wait for its database to finish provisioning.
2. **Apply migrations.** From the repository root, link the Supabase CLI to the
   project and push the migrations:

   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --remote
   ```

3. **Set Edge Function secrets.** Use the project URL and keys from the
   Supabase project settings. Generate a separate random pepper for login
   rate-limiting:

   ```sh
   npx supabase secrets set SUPABASE_URL=YOUR_PROJECT_URL SUPABASE_ANON_KEY=YOUR_ANON_KEY SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY LOGIN_RATE_LIMIT_PEPPER=YOUR_RANDOM_32_BYTE_SECRET
   ```

   Never put the service-role key in a `VITE_` variable or the client app.
4. **Deploy all required Edge Functions:**

   ```sh
   npx supabase functions deploy provision-account
   npx supabase functions deploy login
   npx supabase functions deploy verify-password
   ```

5. **Create the first super admin.** Create the administrator user through
   Supabase Authentication, then run this once in the SQL editor. Replace the
   email and display name with the administrator account you just created:

   ```sql
   insert into public.profiles (id, store_id, role, name, email)
   select id, null, 'super_admin', 'Platform administrator', email
   from auth.users
   where lower(email) = lower('admin@example.com')
   on conflict (id) do nothing;
   ```

6. **Configure Vercel.** In the Vercel project settings, add these environment
   variables for each environment you deploy (Production, Preview, and
   Development as needed), then redeploy:

   - `VITE_DATA_DRIVER=supabase`
   - `VITE_SUPABASE_URL=YOUR_PROJECT_URL`
   - `VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY`

   For local development, copy `.env.example` to `.env.local` and set the same
   values. Local demos use `VITE_DATA_DRIVER=local`.
7. **Confirm the end-to-end setup.** Sign in as the super admin and create an
   owner account. Sign in as that owner, create a staff member, then sign in on
   two devices and take an order on one. Confirm the new order appears live on
   the other device.

The login Edge Function applies server-side limits of five attempts per
username and 20 per source IP in a 15-minute window. Supabase Auth also
enforces its project-level rate limits. Password hashes are managed by
Supabase Auth; store and staff PIN hashes are generated and verified in
PostgreSQL and are never hashed in the browser.

Store IDs are generated from store names (for example, `Orange` becomes
`ORNG` and `Oranges Bites` becomes `ORBT`); duplicate IDs receive an incrementing
number. Staff accounts are provisioned by an owner and sign in with a username
in the form `<STORE_ID>.<first-name>`; duplicate first names receive an
incrementing number such as `ORBT.sarah1`. Staff Auth emails are generated
internally. Staff password resets invalidate existing sessions, clear the old
PIN, and require a new password and PIN at the next sign-in. Owners contact the super admin for an
owner password reset. RLS isolates store data, and
protected order, shift, tab, PIN, and void operations execute through database
functions. Realtime updates are enabled for orders, shifts, notifications, and
catalog availability. Server-registered sessions expire after 12 hours, are
revoked by staff force-logout, and are revalidated when the app regains focus.
Store inactivity, archival, subscription expiry, or an inactive owner blocks
authenticated API requests.

## Known limits

- Native foreground/background delivery uses Supabase Realtime. Production
  killed-app delivery requires FCM setup and a new Android APK; see
  `RELEASING.md`.
- The offline queue only covers new orders. Shifts, voids, and tab payments
  require an internet connection.
- Killed-app FCM delivery depends on completing the Firebase/APK and Supabase
  push setup in `RELEASING.md`; foreground delivery is handled by Realtime.

## Build and preview

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

Production builds must be made with `VITE_DATA_DRIVER=supabase` and valid
Supabase URL/anon-key build variables. For example, configure those variables
in the deployment environment before running `npm run build`.

To test the production-mode Supabase bundle locally, put the production-safe
client values and `VITE_DATA_DRIVER=supabase` in an ignored
`.env.production.local` file (never use a service-role key), then run:

```sh
npm run build:prod-local
npm run preview:prod
```

`build:prod-local` runs the typecheck and creates the same production-mode
bundle as the deployment build. `preview:prod` serves that `dist` output for
local verification.

## Daily backups and restore

The GitHub Actions workflow `.github/workflows/supabase-daily-backup.yml`
creates an encrypted PostgreSQL custom-format dump every day at 02:17 UTC and
retains the encrypted artifact for 30 days. In repository **Settings >
Secrets and variables > Actions**, add:

- `SUPABASE_DB_URL`: the database connection string from the Supabase project
  database settings. Use the direct connection or a session-mode pooler
  reachable from GitHub Actions, not transaction mode.
- `BACKUP_ENCRYPTION_KEY`: a long, randomly generated passphrase. Store it
  separately from downloaded backups and restrict repository artifact access.

Run the workflow manually after setting the secrets and confirm that the
encrypted artifact is uploaded. For provider-managed point-in-time recovery,
also enable Supabase scheduled backups/PITR in the project dashboard where the
plan supports it.

To restore a workflow artifact, download it from the Actions run, then decrypt
and restore it into a **separate recovery project** first. Use a PostgreSQL
client matching the database major version:

```sh
gpg --decrypt --output hanouti.dump --passphrase-file /secure/path/backup-key.txt supabase-backup.dump.gpg
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DB_URL" hanouti.dump
```

Verify the restored profiles, stores, catalog, orders, shifts, financial
records, and RLS policies before directing application traffic to the recovery
project. Preserve the original project until validation is complete. A restore
overwrites matching database objects; never test these commands against the
production database. Keep the encryption key separately—without it the
artifact cannot be restored.

## Deploy to Vercel

Import the Git repository into Vercel and deploy the Vite project with the
default build command `npm run build` and output directory `dist`. Pushes to the
connected production branch trigger a web deployment. Set `VITE_APP_URL` to the
production URL only if it differs from `https://hanoutipos.vercel.app`.

## Android / Capacitor

The Android wrapper loads `https://hanoutipos.vercel.app` by default, so web
deployments update installed apps without rebuilding the APK. Override the
server URL with `CAP_SERVER_URL` when needed. To explicitly create an offline,
bundled APK, set `CAP_BUNDLED=1` when syncing Capacitor.

```sh
npm run build
npm run cap:add
npm run cap:sync
npm run cap:open
```

`npm run cap:add` generates the native `android` project. Review that generated
project in source control before committing it; do not generate or commit it
blindly. Run `cap:sync` after changing the web build or native plugins. In
Android Studio, select the desired build variant and use **Build > Build
Bundle(s) / APK(s) > Build APK(s)**, then use the generated APK from
`android/app/build/outputs/apk/`.

## When a new APK is needed

- The default APK loads the hosted site, so pushes update it automatically
  after the Vercel deployment finishes. No new APK is needed for web changes.
- Rebuild and distribute an APK when native Android code, Capacitor/native
  plugin configuration, permissions, app identity, or other bundled native
  resources change. An APK built with `CAP_BUNDLED=1` also needs rebuilding to
  include web changes; the app can instead open the hosted site when an update
  is available.
