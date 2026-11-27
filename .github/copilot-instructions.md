# Copilot instructions

## Platform localization and code organization

For every platform change, keep all app-owned user-facing content available in
English, French, and Arabic. Follow the
[`platform-localization` skill](skills/platform-localization/SKILL.md) whenever
adding or changing UI, notifications, reports, exports, or printable content.
Do not call localization complete until the affected surfaces have been audited
and locale parity has been validated.

- Put translations in the appropriate section catalog under
  `src/i18n/locales/{en,fr,ar}/`; keep the locale aggregators in sync.
- Keep all customer tickets, kitchen tickets, statements, X/Z reports, and other
  printed ticket/report wording in the dedicated ticket catalogs. Do not mix
  ticket wording into general UI catalogs.
- Translate app-owned labels, actions, dialogs, validation and error messages,
  empty/loading states, tooltips, accessibility text, notifications, chart
  labels, and CSV/PDF output. Avoid hardcoded UI strings and English-only
  fallbacks.
- Keep keys and interpolation placeholders aligned in all three languages.
  Preserve Arabic RTL behavior and use the active language for date, time, and
  money display.
- Do not translate customer/store-entered content, proper names, or standard
  technical/currency identifiers. If stored generated content cannot change
  language when the UI language changes, document that limitation rather than
  claiming it is fully localized.
- Keep catalogs sectioned and code changes focused; reuse existing i18n helpers
  instead of duplicating translation or formatting logic.
- Validate the relevant locale and ticket parity tests, typecheck, lint, and
  production build. Scan the changed UI for remaining hardcoded text and
  locale-implicit formatting.

## Android APK download link

When the user requests an Android APK release, use two separate pushes:

1. Push the requested app/version changes and publish the APK release.
2. Wait until the GitHub release is published, then fetch its APK asset's actual
   `browser_download_url`. Update `LATEST_APK_URL` in
   `src/screens/LoginScreen.tsx` to that verified URL. It is used only by the
   footer `admin_panel_settings` download icon. The top-right `apk1` logo is
   an interactive joke trigger, but must never navigate to or download the APK.
   Validate the change, then commit and push it separately as the second push.

Do not guess the version or asset URL. Do not consider the release task complete
until the second push succeeds and the footer download icon points to the
verified APK. Never publish or push a release unless the user asks.
