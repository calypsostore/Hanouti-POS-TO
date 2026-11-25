# Hanouti POS Fiscal Architecture Audit

Audit date: 2026-11-25

## Executive summary

The application has a usable foundation for an incremental fiscal subsystem: TypeScript domain types, millime-based money, Supabase RPC workflows, store-scoped relational data, an offline order queue, and persisted X/Z report records. The current work adds a pure calculation engine, owner-entered profile/rule drafts, item/category classification, POS tax preview, pinned offline snapshots, server-side transaction calculation, and immutable order snapshots in additive migrations. Those migrations and pgTAP fixtures have been applied and tested on the preserved local Supabase database only; hosted checkout persistence and end-to-end offline synchronization remain unverified. Fiscal invoices and declaration tracking remain unimplemented; X/Z derives totals from saved snapshots and reports void reversals from those same original snapshots. Existing receipts and reports must not be described as legally compliant fiscal documents.

## Existing boundaries

| Area | Current implementation | Fiscal implication |
|---|---|---|
| Domain | `src/types/domain.ts` defines stores, catalog items, order lines/orders, shifts, and reports. Prices and totals are integer millimes. | Extend domain types without converting prices to floating-point or changing existing default prices. |
| Catalog | `src/services/catalogService.ts` and `src/data/repositories/catalogRepository.ts` manage products and categories; fiscal item/category assignments live in a separate store-scoped repository. | Classification is effective-dated; item-level assignments override category assignments, and missing/ambiguous treatments fail closed. |
| Checkout | `src/services/orderService.ts` previews configured taxes and uses `create_order_idempotent` in `src/data/repositories/orderRepository.ts`; local SQL migrations extend the authoritative order transaction. | Local pgTAP verifies server-calculated gross and stored snapshot. Hosted behavior remains unverified; snapshots are calculated and persisted atomically by the migration. |
| Database | Supabase schema uses store-owned rows, `store_id`, RPC workflows, RLS, unique order numbering, and idempotency keys. | Fiscal rules and documents need store-scoped FKs, RLS, and role-checked RPCs. Existing transaction records must not be rewritten. |
| Offline | `src/services/offlineOrderQueue.ts` persists cached fiscal configuration and a pinned snapshot (or explicit no-snapshot marker) with idempotent orders. | Sync submits the pinned snapshot for server comparison; mismatches become needs-attention orders rather than being silently recalculated. Queue payload behavior is unit-tested; database sync is not verified. |
| Reports | `src/services/reports/reportGeneration.ts` persists X/Z fiscal summaries and reverses voids by their void timestamp using the original snapshot. | Aggregation is client-side from persisted, shape-checked snapshots, not independently recomputed by a server report RPC. Missing snapshots remain visible. |
| Receipts | Ticket/document services render commercial POS tickets from order values. | Ticket presentation controls cannot define or suppress legal tax calculations; certification/e-invoice claims require separate verification. |
| Audit/security | Activity logging, owner/staff roles, store permissions, Supabase RLS, and security-focused migrations exist. | Reuse these controls; never expose another tenant's legal identifiers, documents, tax rules, or declarations. |
| Tests | Vitest covers fiscal calculation, POS preparation, offline snapshot forwarding, RPC payloads, and report reversals. | Focused and full application suites pass; local pgTAP files pass. The SQL fixture is not a full offline restart/reconnect or reporting integration test. |

## Gaps and risks found

1. Rules remain drafts in the owner UI and are never activated automatically. No applicable rates or legal status are preloaded; invoice and declaration workflows remain absent.
2. The local SQL migration adds authoritative calculation and immutable insertion and passed local lint/tests. Hosted deployment is unverified. Existing orders are not reconstructed or recalculated.
3. Full-order void reversals use the original immutable snapshot in X/Z summaries. There is no partial refund workflow or separate fiscal credit-note workflow.
4. Online totals are validated in the privileged database transaction; the POS preview is only a preview and stale previews are rejected.
5. Offline configuration and snapshots are cached, pinned through retry, and compared during sync. Queue behavior is unit-tested; actual restart/reconnect synchronization against Supabase remains unverified.
6. X/Z documents aggregate persisted snapshots and warn about missing coverage; the aggregation is client-side, not independently verified by the report RPC.
7. Store tax identification exists, but legal name, activity, legal form, tax regime, VAT registration/status, exemptions, and supporting fiscal documents do not.
8. No invoice sequence, issued-document history, e-invoicing provider, or certified fiscal-device integration exists.
9. The Ministry's published tax-code recueil found during this audit is dated 2017; it is not a consolidated current statement of law. Later amendments require review before any legal rules/rates are activated.

## Safe implementation direction

- Keep all money in integer millimes. Define and test one deterministic rounding policy before calculations are persisted.
- Model tax treatment/status separately from rules and from product assignment.
- Version every rule by store and effective dates. Reject ambiguous overlapping rules instead of picking an arbitrary winner.
- Persist an immutable snapshot for every order subject to configured fiscal calculation and reconcile voids against that original snapshot. Historical reports must never recalculate with current rules.
- Make current legal profile incomplete/unconfirmed by default; do not infer rates or eligibility from a store type.
- Use server-authoritative validation for online orders and deterministic cached rule versions for offline work. Define explicit behavior when rules expire or conflict.
- Extend, rather than replace, existing X/Z report snapshots and output.
- Keep ordinary POS tickets distinct from tax invoices, certified receipts, and legally compliant electronic invoices.

## Phase 1 result and implementation update

Completed the source audit of the domain, catalog, checkout, Supabase RPC, offline queue, reporting, tenant model, and tests. The follow-up implementation includes POS preview, server transaction calculation, offline pinning, and void reversal reporting. On 2026-11-25, 49 local migration versions were verified, six pending migrations were applied to the preserved local volume, local SQL lint returned zero errors, and all five pgTAP files passed (12 tests). Typecheck, focused application tests, the full application suite, lint, and production build were rerun successfully; no hosted database was queried or changed. The system is **not safe to claim fiscal compliance**; hosted deployment, end-to-end offline sync, server-side report aggregation, refund/document workflows, and qualified legal validation remain outstanding.
