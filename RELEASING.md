# Release checklist

Before publishing a new app version:

1. Run `npx supabase migration list --remote` and inspect the local/remote migration versions.
2. Run `npm run release:check`. It fails when a local migration has not been applied to the linked remote database.
3. If migrations are pending, run `npx supabase db push`, then run `npm run release:check` again.
4. Check for changed files under `supabase/functions` since the last release and deploy each changed function before publishing, for example `npx supabase functions deploy provision-account`.
5. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`.
6. Only then bump the app version and publish the web or Android release.

Do not publish while the database migration check is failing. The app compares its expected schema version with `public.app_schema_version` at startup and blocks with a retry screen while the server is behind.
