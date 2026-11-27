# Release checklist

## CI and release gates

The `CI Quality Gate` workflow runs on pull requests to `main`, pushes to
`main`, and is reused by the Android build/release workflow. It runs dependency
installation, TypeScript checks, lint, tests, production build, and a
local-only migration filename check. The CI build uses non-production
placeholder Supabase values and does not connect to Supabase.

### GitHub settings required

Configure these controls in repository **Settings**; workflow YAML cannot
apply repository rulesets or environment reviewers:

1. Under **Rules > Rulesets**, create an active branch ruleset targeting
   `main`. Require pull requests and the `CI Quality Gate / quality` status
   check; block force pushes and deletion; restrict bypass to a minimal,
   named administrator group.
2. Create an active tag ruleset targeting `v*`. Restrict creation to release
   managers, block updates and deletions, and do not grant bypass to ordinary
   write/admin roles. Existing tags, especially `v1.0.6`, must remain in place
   but become immutable. Do not force-update or recreate them.
3. In **Actions > Workflows**, disable the historical `Android APKs` workflow
   from old tag refs. Use only `Android APKs (Protected)`, which has no
   tag-push release trigger and allows release dispatch from protected `main`
   only. Restrict who can dispatch workflows or edit workflow files.
4. Configure the `production-release` environment with required reviewers,
   prevent self-review, and restrict allowed deployments to the protected
   `main` branch. Store Android signing credentials as environment secrets,
   not broad repository secrets.
5. Under **Actions > General > Workflow permissions**, set the repository
   default to read-only. Keep release write access limited to the
   `android-release` job's `contents: write` permission.

### Vercel settings required

The checks in `vercel.json` make a Vercel build fail when local validation
fails, but they are not a substitute for deployment protection: a dashboard
override or direct production promotion can bypass repository checks. In the
Vercel project:

1. Set **Settings > Git > Production Branch** to `main`.
2. Enable Vercel System Environment Variables, including `VERCEL`,
   `VERCEL_ENV`, and `VERCEL_GIT_COMMIT_REF`. The repository build guard fails
   closed if deployment context is missing and rejects production builds not
   coming from `main`.
3. In **Deployment Checks**, require the GitHub `CI Quality Gate / quality`
   check to pass before a production deployment is promoted/assigned.
4. Use the repository's `vercel.json` install/build commands and output
   directory; remove dashboard overrides. Restrict production deployment and
   promotion permissions to authorized operators. If production Deployment
   Checks are unavailable, disable automatic production promotion and promote
   only after the GitHub check succeeds.

The `Android APKs (Protected)` workflow waits for the `production-release`
environment before running its release job. Releases are dispatched from
`main` and require an existing `v<package.json version>` tag pointing to that
exact commit. The reviewer requirement is only effective after the environment
is configured in GitHub.

Before publishing a new app version:

1. Update `package.json` and `package-lock.json` to the approved release version
   in a reviewed change, then merge through protected `main`.
2. Create the approved `v<package.json version>` tag at that exact `main`
   commit. Tag pushes do not publish; dispatch the protected release workflow
   from `main` using the matching version.
3. Confirm the required CI checks pass. CI validates migration filenames and
   duplicate versions locally, but does not contact or change Hosted Supabase.
4. Before approving the protected production release, run
   `npm run release:check` in an authorized environment and confirm no local
   migrations are pending on the linked database. This check reads remote
   migration status; it does not apply migrations.
   The notification sound preferences migration
   (`20261126103500_notification_sound_preferences.sql`) must be applied through
   the approved database process before releasing the client version that
   expects its schema version. The additional sound choices require
   `20261126111200_add_notification_sound_choices.sql` before those choices can
   be saved to Supabase. The six supported choices are `alert1`, `alert4`,
   `alert5`, `alert6`, `alert7`, and `alert8`; migration
   `20261126123000_limit_notification_sound_choices.sql` enforces that exact set
   without rewriting existing preferences.
   Verify that a recent encrypted backup artifact is available and that its
   configured database target is the same linked production project before
   applying a migration; never print the connection secret. The additional
   sound migration preserves stored legacy sound IDs, while the app resolves
   removed choices to the current defaults.
5. If migrations are pending, stop the release and use the separately approved
   database change process. Do not run `supabase db push --remote` as part of
   the application release workflow.
6. Apply `20261127220000_notification_localized_content.sql` before deploying
   the updated web app. It adds structured notification content and per-device
   language metadata; the app schema version check rejects older databases.
7. Apply `20261127230000_super_admin_store_read_only_access.sql` before
   deploying the updated web app. It enables read-only store data access for
   super-admins and updates the expected schema version.
8. After the sound, localization, and super-admin migrations are applied, deploy
   the changed `send-push` Edge Function through the approved process so FCM uses
   per-device language and the configured sound choices. Older Android clients
   without sound-specific channels fall back to their manifest default channel;
   notifications remain deliverable, but those clients use their channel's
   existing sound until updated.
9. Check for other changed files under `supabase/functions` since the last
   release and deploy each changed function through the approved process.
10. For each changed PL/pgSQL function, manually compare parameters, declared
   variables, and `RETURNS TABLE` output names with columns from every
   referenced relation. Use `v_`-prefixed locals and qualify SQL columns; a
   regex-based check is not reliable for nested PL/pgSQL.
11. Publish only after all checks and required production approvals succeed.

The repository has `package.json` version `1.0.12`; the latest remote tag is
`v1.0.6`, and `v1.0.12` is unused remotely. The selected next release version
is therefore `1.0.12`, matching the current package version and Android's
derived `versionName`/`versionCode`. Create `v1.0.12` only after the verified
commit is merged to protected `main` and its required checks pass.

Do not publish while the database migration check is failing. The app compares its expected schema version with `public.app_schema_version` at startup and blocks with a retry screen while the server is behind.

## Android push notifications

1. Create or select a Firebase project and register Android app
   `com.hanouti.pos`.
2. Provide the matching `google-services.json` as the GitHub Actions secret
   `GOOGLE_SERVICES_JSON_BASE64`. The protected release workflow decodes it
   only in its validation step, checks the package ID, and enables push
   registration only for that configured release build.
3. Enable Firebase Cloud Messaging in the Firebase console and create Android
   notification channels `orders_v2`, `alerts_v2`, and `system_v2`.
4. Add the FCM HTTP v1 service-account JSON to Supabase Secrets as
   `FCM_SERVICE_ACCOUNT_JSON`. Never expose the service-account or private key
   as a `VITE_` variable or commit it to Git.
5. Deploy `send-push` and configure a Database Webhook or insert trigger for
   `public.notifications`.
6. Run `npm run apk:sync`, then `npx cap sync android`, and publish a new APK.
7. Do not disable the protected release workflow's push registration. It
   fails closed when the Firebase configuration secret is missing or does not
   contain `com.hanouti.pos`.

## PL/pgSQL diagnostics

In the Supabase SQL Editor, run `supabase/tests/plpgsql_check.sql`. It enables
`plpgsql_check` and checks every non-trigger PL/pgSQL function in `public`.
Every returned row is a problem to investigate and fix; the release check
should return zero rows. If the extension is not available, enable it under
the project's Database Extensions settings first.
