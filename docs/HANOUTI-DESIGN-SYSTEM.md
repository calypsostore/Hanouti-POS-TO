# Hanouti — Crystal Glass Design System

**Status:** Approved design freeze and controlled-migration governance baseline.

**Effective rule:** The approved designs listed below are frozen visual references. This document is the single design-system authority and the only current source for migration governance. No application redesign or migration is authorized merely by this document.

## 1. Purpose

This system defines how future UI work must protect the approved Hanouti identity and progressively migrate non-frozen application sections to Hanouti Crystal Glass.

The legacy UI is not the visual reference for new work. The Shift section and Login page provide approved visual language, but they are outside the normal migration scope and must not be visually redesigned.

## 2. Approved and frozen components

The following components are approved and frozen. No visual redesign is allowed unless the project owner explicitly authorizes a specific modification in writing.

1. **Shift section**
   - Owner and staff Shift views.
   - Desktop and mobile layouts.
   - Shift headers, tabs, status strips, cards, tables, filters, and KPIs.
   - All existing spacing, dimensions, typography, colors, gradients, radii, shadows, blur, animations, transitions, and responsive behavior.

2. **Shift dialogs, popups, and cash movement interfaces**
   - Cash movement sheets and dialogs.
   - Shift confirmations and status prompts.
   - Existing related actions, menus, notifications, and interaction states.

3. **Desktop left sidebar navigation**
   - Structure, width, spacing, colors, icons, labels, active/hover states, badges, and responsive behavior.

4. **Mobile bottom navigation**
   - Items, fixed position, height, spacing, safe-area behavior, active/hover states, icons, labels, colors, and animations.

5. **Mobile More menu and expanded list**
   - Trigger, sheet/popup, entries, separators, grouping, ordering, spacing, colors, icons, typography, and interactions.

6. **Notifications interface**
   - Notification screen and notification popover/button presentation.
   - Existing list, empty, read/unread, action, badge, and overlay presentation.

7. **Login page**
   - Existing brand identity, logo, decorations, bubbles, colors, glass effects, typography, layout, dimensions, animations, and interactions.

The frozen list includes appearance and behavior. It does not prevent necessary technical maintenance that reproduces the current approved result exactly.

## 3. Components requiring technical maintenance only

Technical work may proceed only when it is necessary for correctness, maintainability, accessibility, performance, portal behavior, or browser compatibility, and only if the approved visual and interaction result remains unchanged.

Maintenance-only areas include:

- Shift overlay integration.
- Shift cash movement and other Shift dialog/popup portal placement.
- Shift notification bridge and notification popover behavior.
- Desktop sidebar implementation and owner/staff shell integration.
- Mobile bottom navigation implementation.
- Mobile More menu implementation and expanded list.
- Notification interface state and bridge behavior.
- Login initialization, loading, authentication integration, and technical accessibility fixes.
- Shared primitives used by frozen components, provided the frozen component API and rendered appearance are preserved.

A maintenance change must include a before/after visual and interaction check. Any change that alters approved appearance or behavior requires separate explicit authorization.

## 4. Sections awaiting Crystal Glass migration

No section in this list is approved for migration until a migration stage names it and explicit section approval is recorded.

### Owner workspace

- Owner dashboard.
- Point of Sale.
- Orders.
- Customers and customer detail.
- Staff list and staff profile.
- Schedule.
- Catalog/products.
- Inventory.
- Void requests.
- Waste log.
- Reports.
- Expenses.
- Suppliers.
- Activity log.
- Owner settings and settings subsections.
- Owner loading, error, empty, and placeholder states.

### Staff workspace

- Staff dashboard.
- Staff profile.
- POS.
- Orders.
- Customers.
- Settings.
- Staff lock/setup experiences.

### Authentication and account setup

- Set-new-password and account setup flows.
- Lock screen.
- Initialization and server-error states.
- Password/session recovery experiences that are not part of the frozen Login page.

### Administrative workspace

- Super-admin overview.
- Stores list and store detail/read-only view.
- Super-admin settings.
- Administrative placeholders and error states.

### Cross-cutting screens

- Generic loading and access-denied surfaces.
- Update-required and app-level prompts.
- Toast and action-feedback presentation.
- Shared reports, tickets, tab statements, receipts, and other non-frozen views.
- Any future route or newly added application section.

These migration candidates must adopt Crystal Glass through shared tokens and reusable components. They must not copy the legacy CSS or create page-specific theme implementations.

## 5. Architectural rules

### One centralized design system

- Use one source of truth for semantic colors, glass surfaces, borders, radii, shadows, spacing, typography, icon sizing, control heights, motion, breakpoints, and overlay z-index layers.
- Existing `src/styles.css`, Tailwind configuration, and shared component styles must converge on the centralized tokens; do not add a parallel styling system.
- No page may define an arbitrary palette or private duplicate token set.

### Reusable shared components

- Extend and reuse existing primitives and composites such as buttons, inputs, cards, badges, tables, dialogs, sheets, navigation items, loading states, empty states, and feedback components.
- Common variants belong in shared component APIs, not in page-specific class lists or CSS blocks.
- Shared components must support all approved responsive, RTL, keyboard, touch, and accessibility requirements.

### Centralized theme management

- Keep color mode and palette/theme selection as separate concerns.
- Apply semantic theme variables at the document root so Tailwind, shared CSS, and components consume the same values.
- Theme changes must not require editing Shift, Login, frozen navigation, or frozen notification CSS.
- Maintain persisted appearance preferences behind one centralized service; do not add ad hoc `localStorage` theme keys or page-specific theme stores.

### Responsive and overlay architecture

- Use shared breakpoints and responsive behavior.
- Use one overlay manager/host for dialogs, bottom sheets, popovers, notifications, prompts, toasts, and app-level feedback.
- Overlays render into a persistent document-level target.
- The overlay stack must own topmost Escape handling, focus entry/restoration, modal semantics, scroll behavior, and semantic z-index layers.
- Portals must not be added with arbitrary z-index fixes.

## 6. Permanent development rules

1. Never redesign or change an approved frozen component.
2. Never modify more than one unrelated section in a task.
3. Never migrate a frozen shell, login, shift, notification, or bottom-sheet implementation while visually changing another section.
4. Never change business logic, authentication, database operations, permissions, routing, offline behavior, data models, or existing workflows during a visual migration.
5. Preserve existing route paths, role checks, permission checks, API calls, repositories, stores, offline fallbacks, and business calculations.
6. One source of truth: add or adjust shared tokens and components first; do not duplicate styling in a page.
7. Keep technical maintenance reversible and minimize its surface area.
8. Do not remove features or workflows to make a screen easier to migrate.
9. Do not use the legacy design as a visual reference for migrated sections.
10. Do not change database migrations or schema. A separate, explicitly approved preferences feature may not be bundled into visual migration work.
11. Preserve the existing brand assets and Login identity.
12. Preserve desktop, mobile, tablet, RTL, safe-area, reduced-motion, keyboard, screen-reader, and contrast behavior.
13. Test overlay behavior where the migrated section or shared overlay system participates.
14. Test loading, empty, error, success, permission-denied, offline, and return-navigation states.
15. Stop and request separate approval if a requested visual change would affect a frozen component or intentionally alter existing behavior.
16. Record the exact files changed, verification performed, and remaining risks at the end of each migration task.
17. No visual migration may start from this document alone; the specific section and scope must be explicitly approved.

## 7. Exact staged migration process

### Stage 0 — Freeze and baseline

1. Confirm the approved frozen inventory in this document.
2. Create a visual baseline for frozen components at supported desktop and mobile sizes.
3. Record existing Shift, notification, navigation, More menu, and Login behavior.
4. Do not change source code or application behavior in this stage.

**Exit gate:** The frozen inventory is acknowledged and a baseline exists.

### Stage 1 — Shared foundation without page redesign

1. Audit existing token usage and shared components.
2. Complete one centralized semantic token and glass token set.
3. Consolidate theme-mode application in existing theme initialization.
4. Build or extend shared primitives with existing component patterns.
5. Implement the centralized document-level overlay host.
6. Add focused foundation tests and run existing build/type checks.

**Exit gate:** Foundation work passes tests and does not change frozen or migrated UI appearance.

### Stage 2 — Technical maintenance and compatibility

1. Move Shift sheets/dialogs and notifications onto the shared overlay behavior only where required.
2. Verify desktop and mobile navigation, Mobile More, notifications, Login, and Shift overlays remain pixel-equivalent and interaction-equivalent.
3. Fix only confirmed technical defects, with no visual restyling.

**Exit gate:** All approved frozen surfaces are visually unchanged and overlays work across supported routes and viewports.

### Stage 3 — Select one pilot migration

The recommended first candidate is the read-oriented Owner Dashboard. It remains only a candidate until the project owner approves it.

1. Define the exact pilot route and exact set of child components.
2. Inventory every direct and shared dependency.
3. Capture existing desktop, tablet, and mobile behavior.
4. Preserve every route, permission, repository call, state, and workflow.
5. Replace only that screen's styling and directly necessary shared primitives.
6. Verify Crystal Glass tokens, contrast, breakpoints, RTL, reduced motion, loading/empty/error states, keyboard navigation, and overlays.
7. Run the smallest relevant tests, then build/type checks and focused browser validation.
8. Stop after reviewable completion; do not migrate adjacent sections.

**Exit gate:** Owner explicitly approves the pilot against its frozen-surfaces protection and behavior checks.

### Stage 4 — Incremental section migration

Proceed in one-section units only, in this recommended order:

1. Owner Dashboard.
2. Catalog/Inventory.
3. Staff/Schedule.
4. Customers.
5. Orders.
6. Reports.
7. POS.
8. Remaining owner, staff, authentication/setup, administrative, and cross-cutting screens.

The order may change, but any change must be an explicit scope decision made before work starts.

For each section:

1. Create a scope statement naming the route, components, and exclusions.
2. Prove no frozen component is included unless it is a technical-maintenance-only dependency.
3. Inspect direct state/data/permission requirements.
4. Implement only shared visual migration for that section.
5. Preserve business logic and workflows line by line.
6. Review desktop, tablet, mobile, and RTL.
7. Test all relevant interaction states and overlays.
8. Run targeted tests and build checks.
9. Report exact changes and ask for section approval.
10. Stop. Start no adjacent section in the same task.

**Exit gate:** Every section needs its own approved visual review before the next migration begins.

### Stage 5 — Consolidation

1. Remove obsolete page-specific styling only after migrated sections no longer depend on it.
2. Reconcile remaining duplicate styles into shared tokens/components.
3. Run a final cross-section regression pass.
4. Recheck frozen components unchanged.
5. Document known exceptions and unresolved technical work.

No mass cleanup or redesign may bypass the per-section gates.

## 8. Verification matrix

Every migration task must verify the following where applicable:

- Approved frozen surfaces remain unchanged.
- Desktop and mobile navigation remain unchanged.
- Mobile More and notification presentation remain unchanged.
- Login remains unchanged.
- Shift remains unchanged except approved technical-maintenance fixes.
- Routes, permissions, authentication, database calls, and offline behavior remain unchanged.
- Light/dark/system behavior follows centralized tokens.
- Text contrast and glass transparency remain usable.
- RTL, browser zoom, safe areas, and touch targets remain usable.
- Keyboard focus, Escape, focus restoration, and modal semantics work.
- Loading, empty, error, success, and access-denied states work.
- The smallest relevant tests and build/type checks pass.

## 9. Current architectural audit

The application now has one registered theme, **Hanouti Crystal Glass**, and a store-scoped appearance configuration. Shared tokens drive semantic Tailwind colors, typography, radii, spacing, button sizes, common inputs, page containers, tables, settings cards, and overlay z-index values.

The store workspace and Shift use the shared token application. Login and Splash components were not changed. The previous `legacy-workspace` palette override and local theme-selection code were removed.

This is a centralized foundation, not a complete conversion of every page-specific CSS declaration. The stylesheet and some components still contain literal colors, dimensions, shadows, and layout rules; these remain areas for a careful follow-up audit rather than being represented as already tokenized.

## 10. Theme foundation and persistence

Theme Settings stores the complete light and dark token sets, color mode, large-control preference, and density preference inside the existing `store_settings.settings.appearance` JSON object. The store owner is the only editor; store members read the shared setting. The existing `store_settings` Realtime subscription refreshes the active appearance on connected devices.

`resolveStoreAppearance()` fixes the theme ID to the official theme and validates persisted token values before applying them. `store_settings.settings` is normalized by `resolveStoreSettings()` so older rows without appearance data continue to receive the official defaults.

Older local keys such as `hanouti.display-settings.v1` are no longer read or written. They are left untouched; no unrelated local storage is cleared. Theme changes are not saved to local storage.

No schema, RLS policy, migration, or Supabase data was changed for this implementation. Existing store ownership and member-read permissions remain authoritative. There is no separate per-user or per-device theme persistence.

## 11. Current migration boundary

The code reuses the existing JSON settings and permission model. The implementation does not change POS calculations, financial behavior, routing, authentication, or store permissions.

The token source and shared components cover common application styles, but page-specific hardcoded CSS remains. Further visual consolidation should preserve the current Hanouti Crystal Glass baseline, avoid the untouched Login/Splash and PayOS areas, and be validated against Shift and responsive layouts before removing remaining styles.
