# Hanouti — Crystal Glass Design System

**Status:** Audit and governance baseline. A targeted notification-panel update was implemented after review; no broader redesign, theme-selector expansion, or section migration is authorized by this document.

## 1. Purpose and design authority

The Shift section is the approved visual authority for **HANOUTI — CRYSTAL GLASS DESIGN SYSTEM**. New UI and future migrations must follow its visual language while preserving existing Hanouti branding, routes, permissions, data flows, offline behavior, and business logic. Legacy screens are evidence of existing behavior, not the reference for new styling.

This audit distinguishes verified implementation from recommendations. The Login page remains an approved reference and must not be redesigned.

## 2. Shift visual language

The owner Shift screen combines the existing workspace shell with its own glass treatment:

- **Canvas and surfaces:** a cool blue/white canvas with soft radial gradients; translucent pale surfaces; thin light borders; subtle inset highlights; restrained shadows; and backdrop blur/saturation.
- **Shape and hierarchy:** rounded surfaces and pills, with cards commonly around 18–24 px radius. A compact Shift toolbar and status strip lead into pill-shaped section/date controls, colored KPI cards, and detailed shift history.
- **Color:** teal/cyan is the primary interaction color. KPI cards use distinct pastel accents; semantic status colors distinguish success, warning, and error. Dark mode has explicit Shift-specific overrides.
- **Typography and icons:** Inter is common in Shift-specific CSS, with Plus Jakarta Sans used for display headings elsewhere. Material Symbols are the dominant icon set. The Shift workspace also declares an Apple-system font stack, so typography is not fully governed by one shared token.
- **Interaction:** active navigation and filter states use bright teal fills and clear shape changes; cards and controls use subtle transitions. The design has responsive refinements and reduced-motion rules.
- **Desktop:** the owner workspace places a glass sidebar beside the Shift work area. The Shift view presents a six-card overview and a data table.
- **Mobile:** the workspace becomes a single-column flow, the overview becomes a two-column card grid, and the owner bottom navigation is fixed to the bottom with safe-area padding. The Shift section tabs and header controls remain usable at a 390 px viewport.
- **Full screen:** the application sidebar, standard top bar, and navigation are hidden; the Shift working area and its own toolbar remain.

These are observed characteristics, not a requirement to copy every current pixel value. The goal is to preserve the established identity while moving repeated values into shared tokens.

## 3. Existing tokens and styling systems

### Present today

- [`src/styles.css`](../src/styles.css) defines light and dark semantic color variables, including primary, surface, outline, success, warning, error, and secondary roles.
- [`tailwind.config.ts`](../tailwind.config.ts) maps those color variables into Tailwind and defines typography sizes, font families, spacing, radii, and card/sheet/overlay shadows.
- [`src/styles.css`](../src/styles.css) also defines `--glass-popup-*` variables for popup backdrop, surface, border, shadow, blur, radius, controls, and primary actions, with dark-mode overrides.
- [`index.html`](../index.html) loads Inter, Plus Jakarta Sans, and Material Symbols; Roboto Mono is bundled locally and used for receipt-like output.
- [`src/lib/displaySettings.ts`](../src/lib/displaySettings.ts) applies `light`, `dark`, or `system` mode and desktop compact density to the document root. Large POS buttons are also a display preference.

### Gaps and inconsistencies

- The existing theme mechanism switches between light and dark token values; it is not a theme registry and does not provide named palettes, custom primary/accent colors, or live preview.
- The device theme is applied both by the early bootstrap script in `index.html` and by `initializeDisplaySettings()` in `src/main.tsx`. A future authenticated preference must reconcile both paths to avoid a flash or applying a previous user's cached choice.
- The root color tokens do not cover all of Shift's direct color literals, gradients, radii, shadows, and blur values. Some Shift rules therefore do not respond consistently to a future palette.
- Tailwind has useful spacing, radius, typography, and shadow scales, but the glass-specific values and common control dimensions are not consistently routed through them.
- `styles.css` is a large global stylesheet (currently over 11,500 lines) with global rules, shared overlay styles, and page-specific rules. Shift rules and responsive refinements recur in multiple later blocks, so a value can be overridden far from its first definition.
- `Button`, `Chip`, `StatusTag`, `CardGrid`, `StatGrid`, and `DataTable` provide reusable starting points, but many screens still style controls and cards directly with utility classes or bespoke CSS. For example, `Button` has shared variants, while individual buttons often define their own sizes, radii, and states.

## 4. Existing components and duplication

- **Navigation:** [`src/components/WorkspaceLayout.tsx`](../src/components/WorkspaceLayout.tsx) renders the owner workspace shell and mobile navigation. [`src/components/BottomNav.tsx`](../src/components/BottomNav.tsx) is used by staff screens and contains another navigation rendering path, including owner-oriented logic. The owner workspace and staff pages do not necessarily render both at once, but the implementations and styling responsibilities overlap.
- **Notifications:** Both [`src/components/TopBar.tsx`](../src/components/TopBar.tsx) and [`src/components/ShiftNotificationsButton.tsx`](../src/components/ShiftNotificationsButton.tsx) use the shared [`src/components/NotificationsPopoverButton.tsx`](../src/components/NotificationsPopoverButton.tsx) for popover markup and notification actions. This targeted component was added after the audit; the TopBar still coordinates opening it with the profile menu.
- **Dialogs and receipts:** [`src/components/BottomSheet.tsx`](../src/components/BottomSheet.tsx) correctly reuses [`src/components/layout/ResponsiveDialog.tsx`](../src/components/layout/ResponsiveDialog.tsx). By contrast, [`src/components/ReportView.tsx`](../src/components/ReportView.tsx), [`src/components/TabStatementView.tsx`](../src/components/TabStatementView.tsx), and [`src/components/TicketView.tsx`](../src/components/TicketView.tsx) each manage their own portal/backdrop/panel wrapper.
- **Global overlays:** [`src/components/PermissionsPrompt.tsx`](../src/components/PermissionsPrompt.tsx), [`src/components/UpdateRequiredModal.tsx`](../src/components/UpdateRequiredModal.tsx), and [`src/components/ActionFeedbackToast.tsx`](../src/components/ActionFeedbackToast.tsx) are mounted at the app level rather than through a shared overlay host.
- **Settings:** [`src/lib/displaySettings.ts`](../src/lib/displaySettings.ts) owns theme and display preferences, while [`src/services/settingsService.ts`](../src/services/settingsService.ts) owns language. Both currently use browser `localStorage`; they are not a unified, authenticated user-preferences service.

## 5. Theme engine and persistence proposal — not implemented

Keep **theme palette** separate from **color mode**:

1. Define a typed theme registry for named palettes and semantic token values. Keep `light`, `dark`, and `system` as a separate mode choice. Custom primary/accent values should override semantic tokens, not page-specific CSS.
2. Apply the selected semantic variables at the document root so Tailwind utilities and shared CSS consume the same source. Keep a default palette that reproduces the approved Shift identity and the current Login appearance.
3. Persist personal appearance preferences per authenticated user. Prefer a dedicated `user_preferences` table keyed by `user_id` (foreign key to `profiles.id`) with a versioned appearance payload and `updated_at`, protected by row-level security so a user can read/write only their own preferences.
4. Do not put personal theme choices in `store_settings`: that record is store-scoped and is used for shared business and receipt settings. The current `profiles` table has security-sensitive, explicitly restricted read/update grants; adding personal preference updates to it would require careful policy and column-grant work. A separate table is the safer boundary.
5. Cache preferences locally only under an authenticated-user-specific key. Load/apply them after auth hydration, and clear or reset the active user's theme on logout/account switch so a shared terminal cannot leak one employee's theme into another's session. Define an offline fallback and sync/conflict rule before implementation.
6. Keep device/terminal controls such as large POS buttons and compact density distinct unless product decisions explicitly make them personal. Do not silently migrate the existing unscoped `hanouti.display-settings.v1` value to a shared user.

Settings currently offers only `light`, `dark`, and `system`; multi-palette selection, custom color picking, preview/save/reset, and per-user persistence remain future work.

## 6. Shared component architecture proposal — not implemented

Build on existing components rather than creating a parallel UI library:

- **Tokens:** semantic colors and theme roles; glass surfaces; border/radius; elevation; spacing; typography; icon sizes; control heights; motion; and z-index layers.
- **Primitives:** buttons and icon buttons, inputs/selects/search, cards/stat cards, badges/status tags, navigation items, and tooltips. Components should expose semantic variants and states, not page-specific colors.
- **Composites:** responsive tables with mobile-card renderers, loading/empty/error states, and shared notifications.
- **Shell:** `WorkspaceLayout` owns the page shell and navigation presentation; shared navigation data remains in `src/app/navigation.ts`.
- **Migration rule:** preserve business logic and page behavior; replace styling only in the approved section. Do not bulk-rewrite every screen or change the Login design.

## 7. Full-screen and overlay diagnosis

### Verified behavior

The owner Shift page calls `requestFullscreen()` on `.workspace-layout.shift-screen-layout`, tracks `fullscreenchange`, and calls `exitFullscreen()` to leave. The CSS hides the sidebar, standard top bar, desktop navigation, and owner mobile navigation while expanding the main work area. This was visually inspected at desktop and mobile sizes; entering and exiting full screen restored the normal shell.

The shared notification popover switches its portal target between `document.fullscreenElement` and `document.body` on `fullscreenchange`. In a desktop browser run, the notification popover appeared within the full-screen Shift content.

### Confirmed defect

`ResponsiveDialog` always portals to `document.body`. The browser's fullscreen top layer only displays the fullscreen element and its descendants; raising a body's z-index cannot fix a portal outside that subtree. In a desktop browser run, opening the Shift **Cash Movements** bottom sheet created a dialog in the DOM, but the dialog was absent from the full-screen screenshot; the dialog was not contained by `document.fullscreenElement`. This affects Shift bottom-sheet flows that use `BottomSheet`/`ResponsiveDialog`.

Other components also portal to `document.body`: the standard `TopBar` notification/profile popovers and the non-inline paths of report, ticket, and tab-statement views. In addition, the app-level permissions prompt, required-update modal, and action toast are outside the Shift workspace. They are structurally at risk of being hidden behind fullscreen content when triggered during Shift full screen. The standard TopBar is hidden in Shift full screen, while the Shift-specific notification popover is fullscreen-aware.

`ResponsiveDialog` registers a window-level Escape handler per open dialog and does not centralize focus trapping/restoration or scroll locking. Multiple simultaneous dialogs could each react to Escape; this nested case was not runtime-tested. In the tested browser run, Escape closed the open Shift sheet while leaving full screen active. This does not substitute for testing native Escape behavior in every supported browser.

### Recommended overlay design

Use one overlay manager/host with a normal document target and a target inside the active fullscreen element. Switch targets on `fullscreenchange`; route dialogs, sheets, popovers, notifications, app-level prompts, and toasts through it. The manager should own the overlay stack, close only the topmost overlay on Escape, focus entry/return, modal semantics, scroll behavior, and semantic z-index layers. Preserve normal non-fullscreen behavior. Test fullscreen entry/exit, every overlay type, forms, dropdowns, notification actions, keyboard focus, Escape, scrolling, and mobile layouts.

No fullscreen or shared-dialog tests were found in `tests/`; the findings above are from code inspection and the described browser checks.

During the browser inspection, the console also emitted a `NotificationsBridge` Realtime error (`cannot add postgres_changes callbacks ... after subscribe()`). The notification popover UI rendered, but Realtime delivery was not validated. This is outside the visual audit and was not changed.

## 8. Likely files for future work

These are candidates for future application work, not current changes. This document itself is the audit deliverable added in this task.

- **Theme/tokens:** `tailwind.config.ts`, `src/styles.css`, `src/main.tsx`, `src/App.tsx`, `src/lib/displaySettings.ts`, `src/services/settingsService.ts`, and a small theme/preferences module.
- **Per-user persistence, if approved:** a new repository/service and a Supabase migration for `user_preferences`, plus focused type, RLS, and service tests. `src/types/domain.ts` may gain a preference type.
- **Overlay host:** `src/App.tsx`, `src/components/WorkspaceLayout.tsx`, `src/components/BottomSheet.tsx`, `src/components/layout/ResponsiveDialog.tsx`, `src/components/NotificationsPopoverButton.tsx`, `src/components/ShiftNotificationsButton.tsx`, `src/components/TopBar.tsx`, `src/components/ReportView.tsx`, `src/components/TabStatementView.tsx`, `src/components/TicketView.tsx`, `src/components/PermissionsPrompt.tsx`, `src/components/UpdateRequiredModal.tsx`, and `src/components/ActionFeedbackToast.tsx`.
- **Selected screen migration only:** the chosen screen and directly dependent shared components. `src/screens/LoginScreen.tsx` is excluded unless a strictly necessary integration change can preserve its approved appearance.

## 9. Controlled migration roadmap — proposal only

1. **Foundation approval:** agree on token names, theme/persistence boundary, and overlay/fullscreen behavior. Fix and test the overlay host before relying on fullscreen dialogs.
2. **Pilot selection:** migrate one low-risk, preferably read-oriented section first (Owner Dashboard is a candidate). Wait for review and approval before starting another section.
3. **Incremental sections:** proceed one section at a time, prioritizing shared components and lower-risk views before transaction-heavy flows. A possible order is Owner Dashboard, Catalog/Inventory, Staff/Schedule, Reports/Customers/Orders, then POS.
4. **Per-section gate:** inspect the existing screen; preserve routes, permissions, data and offline behavior; implement only that section; validate desktop, tablet, mobile, RTL, overlays, loading/empty/error/success states, accessibility, and relevant tests/build checks; report the exact changes and stop for review.

This order is a recommendation, not a decision. No migration starts without approval.

## 10. Risks and permanent governance rules

### Risks to manage

- Translucent surfaces can reduce text contrast against changing content; validate contrast in light/dark modes and on glass backgrounds.
- Hardcoded Shift colors and CSS cascade order can make future themes inconsistent or cause regressions.
- Backdrop filters, shadows, and animation can affect rendering cost on lower-powered/mobile devices; preserve reduced-motion and reduced-transparency support.
- RTL layout, browser zoom, safe-area insets, keyboard operation, touch targets, and screen readers must remain supported.
- Fullscreen behavior is browser-controlled and sensitive to portal placement; test actual supported browsers rather than relying only on z-index or DOM visibility.
- User-scoped settings require correct RLS and account-switch behavior; store-wide settings must not accidentally become personal preferences or vice versa.

### Governance rules

1. Crystal Glass, as established in Shift, is the primary visual reference. Do not use legacy styling as the model for new work.
2. Use semantic shared tokens and existing reusable components; do not add page-specific copies of common UI or hardcode values where a token is appropriate.
3. Preserve brand name, logo/assets, Login appearance, routing, authentication, permissions, data handling, offline behavior, and all existing features.
4. Do not simplify by removing workflows or changing business logic during visual work.
5. Keep overlays on the shared overlay architecture and verify them in normal and fullscreen contexts; do not solve portal problems with arbitrary z-index increases.
6. Migrate one approved section at a time. Test its desktop/mobile layouts, states, accessibility, overlays, and business behavior before requesting approval for the next section.
7. Prefer small, reversible changes. Document intentional deviations from Shift and verify every behavioral claim.

**Audit outcome:** the Shift design provides a strong visual source, and the app already has useful semantic color tokens and reusable primitives. The main architectural gaps are incomplete token coverage, device-scoped theme persistence, duplicated overlay implementations, and the confirmed `ResponsiveDialog` fullscreen portal failure. No application or Supabase changes are part of this audit.
