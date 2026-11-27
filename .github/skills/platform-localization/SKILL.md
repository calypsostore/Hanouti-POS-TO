---
name: platform-localization
description: Maintain complete EN/FR/AR localization across the POS platform, with ticket and report translations kept separate.
---

# Platform localization

Use this workflow whenever changing app-owned text or auditing localization.
Treat the task as incomplete until the affected user-facing surfaces are
localized, the catalogs agree, and the relevant checks pass.

## Catalog organization

- Add general interface text to the narrowest applicable section catalog in
  `src/i18n/locales/en/`, `fr/`, or `ar/`.
- Add every key to all three languages and include the module in all three
  locale aggregators.
- Keep ticket-specific wording in each locale's `tickets.ts` catalog, accessed
  with `ticketT()`. This includes customer and kitchen tickets, customer
  statements, and X/Z reports, whether shown on screen or printed/exported.
- Reuse an existing key only when its meaning and interpolation are identical.
  Do not couple behavior to translated display strings.

## Surface audit

Check all affected screens and shared components for:

- Visible headings, buttons, labels, placeholders, status text, helper text,
  alerts, confirmations, errors, empty/loading states, and navigation.
- Accessible names, tooltips, chart labels, notifications, and content rendered
  in portals, dialogs, and mobile layouts.
- Customer/kitchen tickets, statements, X/Z reports, and PDF/CSV exports.
- Dates, times, and amounts that must follow the active language and locale.

Translate app-authored messages at their source. Keep user-entered names,
descriptions, notes, product labels, proper names, and standard identifiers as
data rather than attempting to translate them. For persisted generated content,
verify how language is selected on creation and display; do not imply that
historical content changes language unless the implementation actually supports
it.

## Quality and validation

- Keep all locale keys and interpolation placeholders in parity; retain the
  locale parity tests as the source of truth.
- Preserve Arabic RTL layout and avoid locale-specific punctuation or number
  formatting that breaks interpolation, machine-readable exports, or ticket
  calculations.
- Before finishing, search changed UI for hardcoded app-owned English, check
  locale-implicit date/time/money formatting, and verify ticket text still uses
  the dedicated catalog.
- Run the smallest relevant tests first, then typecheck and lint affected code.
  Run the production build when the change affects shared localization,
  aggregation, or multiple platform sections.
- Report any existing or unavoidable untranslated persisted content explicitly;
  never claim complete localization based only on key parity or a successful
  build.
