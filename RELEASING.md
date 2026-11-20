# Release checklist

Before publishing a new app version:

1. Run `npx supabase migration list --remote` and inspect the local/remote migration versions.
2. Run `npm run release:check`. It fails when a local migration has not been applied to the linked remote database.
3. If migrations are pending, run `npx supabase db push --remote`, then run `npm run release:check` again.
4. Check for changed files under `supabase/functions` since the last release and deploy each changed function before publishing, for example `npx supabase functions deploy provision-account`.
5. For each changed PL/pgSQL function, manually compare parameters, declared variables, and `RETURNS TABLE` output names with columns from every referenced relation. Use `v_`-prefixed locals and qualify SQL columns; a regex-based check is not reliable for nested PL/pgSQL.
6. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
7. Only then bump the app version and publish the web or Android release.

Do not publish while the database migration check is failing. The app compares its expected schema version with `public.app_schema_version` at startup and blocks with a retry screen while the server is behind.

## Android push notifications

1. Create or select a Firebase project and register Android app
   `com.hanouti.pos`.
2. Download `google-services.json` and place it at `android/app/google-services.json`.
   This file is not a secret, but keep project configuration committed only
   when it is appropriate for the repository.
3. Enable Firebase Cloud Messaging in the Firebase console and create Android
   notification channels `orders_v2`, `alerts_v2`, and `system_v2`.
4. Add the FCM HTTP v1 service-account JSON to Supabase Secrets as
   `FCM_SERVICE_ACCOUNT_JSON`. Never expose the service-account or private key
   as a `VITE_` variable or commit it to Git.
5. Deploy `send-push` and configure a Database Webhook or insert trigger for
   `public.notifications`.
6. Run `npm run apk:sync`, then `npx cap sync android`, and publish a new APK.

## PL/pgSQL diagnostics

In the Supabase SQL Editor, run `supabase/tests/plpgsql_check.sql`. It enables
`plpgsql_check` and checks every non-trigger PL/pgSQL function in `public`.
Every returned row is a problem to investigate and fix; the release check
should return zero rows. If the extension is not available, enable it under
the project's Database Extensions settings first.
