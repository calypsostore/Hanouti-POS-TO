# Codebase audit

Audit performed on 2026-11-24. This is a read-only review summary; no application code or dependencies were changed.

## Stack and checks

- TypeScript, React 19, Vite 7, Supabase JS, Capacitor Android; npm (`package-lock.json`).
- Tests exist: 35 files. `npm test` passed: 177 tests.
- `npm run build` passed. Vite warned that the main JS bundle is 703.58 kB minified (over its 500 kB warning threshold).
- `npm run lint` failed with one error and three warnings (details below).

## Security

| # | Severity | File | Lines | Finding | Confidence |
|---|---|---|---|---|---|
| 1 | MEDIUM | `supabase/functions/send-push/index.ts` | 38–69, 107–130 | The function trusts caller-supplied notification/store/role data and sends to matching device tokens without authenticating a trusted webhook or verifying the notification record. A caller with the public Supabase anon JWT may be able to forge push notifications. Require a webhook secret/signature or service-role caller, validate the notification against the database, and restrict wildcard CORS if it is not required. | 9/10 |

No other confirmed security findings surfaced in the repository-wide read-only review.

## Dependencies

`npm audit` reported four moderate advisory entries in the development/build dependency tree: `vite-plugin-pwa` → `workbox-build` → `glob` / `minimatch`. npm reports a fix available. `npm audit --omit=dev` reported zero vulnerabilities. There were no high or critical findings.

Outdated packages (installed version → latest reported by npm):

| Package | Current | Latest | Upgrade |
|---|---:|---:|---|
| `autoprefixer` | 10.6.2 | 10.7.0 | Minor |
| `lucide-react` | 1.78.0 | 1.79.0 | Minor |
| `react-router-dom` | 7.18.5 | 7.18.6 | Patch |
| `recharts` | 3.11.0 | 3.11.1 | Patch |
| `typescript-eslint` | 8.73.0 | 8.74.0 | Minor |
| `@capacitor/android` | 7.6.10 | 8.6.2 | Major |
| `@capacitor/app` | 7.1.2 | 8.1.2 | Major |
| `@capacitor/browser` | 7.0.5 | 8.0.5 | Major |
| `@capacitor/cli` | 7.6.10 | 8.6.2 | Major |
| `@capacitor/core` | 7.6.10 | 8.6.2 | Major |
| `@capacitor/filesystem` | 7.1.9 | 8.1.5 | Major |
| `@capacitor/local-notifications` | 7.0.7 | 8.3.1 | Major |
| `@capacitor/push-notifications` | 7.0.7 | 8.1.3 | Major |
| `@capacitor/share` | 7.0.4 | 8.0.3 | Major |
| `@vitejs/plugin-react` | 5.2.0 | 6.3.0 | Major |
| `tailwindcss` | 3.4.19 | 4.3.5 | Major |
| `typescript` | 5.8.3 | 7.0.2 | Major |
| `vite` | 7.3.8 | 8.3.8 | Major |
| `vite-plugin-pwa` | 1.3.0 | 2.0.0 | Major |

The major upgrades were not applied. The Capacitor packages should be treated as a coordinated migration; the PWA advisory should be resolved using the smallest compatible update.

## Duplicated logic

| Finding | Location | Suggested fix |
|---|---|---|
| Time-zone date-key conversion exists in multiple locations despite an existing shared helper. | `src/services/orderService.ts:66`, `src/screens/OwnerReportsScreen.tsx:66`, existing `src/lib/date.ts:1` | Reuse the existing `dateKeyInTimezone` helper. |
| Time-zone date-parts formatting is duplicated. | `src/services/reportService.ts:63`, `src/lib/shiftOverview.ts:148` | Reuse a common helper if approved to reduce divergence in reporting and shift date boundaries. |

No additional component or hook extraction was clearly justified.

## Lint and quick health checks

| Finding | Location | Suggested fix |
|---|---|---|
| ESLint error: a ref is assigned during render (`onEscapeRef.current = onEscape`). | `src/components/overlay/overlayArchitecture.ts:149` | Move callback synchronization out of render using the existing lifecycle/effect pattern, preserving the latest callback. |
| Three ESLint warnings: Fast Refresh export and cleanup callbacks reading refs. | `src/components/layout/PageHeader.tsx:10`; `src/screens/OwnerDashboardScreen.tsx:196`; `src/screens/PosScreen.tsx:330` | Consider separately if warning cleanup is approved. |
| Main production JS bundle is 703.58 kB minified. | Build output: `dist/assets/index-*.js` | Inspect bundle composition and split the largest eagerly loaded paths if initial-load performance is a measured issue. |
