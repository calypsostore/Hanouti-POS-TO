# Hanouti POS Fiscal System Architecture

Status: implementation contract and current gaps, 2026-11-25.

## Design principles

- Fiscal facts belong to a store and are never inferred from a store type or product name.
- Rules are effective-dated, versioned, and carry a legal citation plus reviewer status.
- A fiscal calculation is reproducible from its captured input and immutable snapshot; changing current rules never mutates completed sales or reports.
- Money stays in integer millimes. Tax rates use integer parts-per-million (1,000,000 = 100%) to avoid floating-point rate math.
- Tax statuses and tax types remain distinct: VAT, consumption duty, stamp duty, withholding, and business income taxes are not interchangeable.
- Every unreviewed/ambiguous rule is surfaced and cannot silently win rule selection.
- Existing POS orders continue to work until a store has an explicit fiscal configuration. This compatibility mode is not a legal-compliance assertion.

## Domain boundaries

1. **Fiscal profile** - store identity, activity/legal-form/regime claims, tax registrations, verification status, document preferences, and evidence references. Owner-entered profile data is not a legal determination.
2. **Tax configuration** - tax types, effective-dated rule versions, calculation method/base, status, applicability, legal source, reviewer, and audit history.
3. **Product assignment** - product/category assignment to rule versions, treatment status, effective dates, and exemption/suspension evidence.
4. **Tax engine** - pure calculation from explicitly selected rules, price mode, line amount, quantity, and transaction date. It does not choose the law for the user.
5. **Transaction fiscal snapshot** - immutable per-line and order-level bases, taxes, totals, treatment, selected rule versions, and calculation metadata captured at order completion.
6. **Fiscal documents** - separately numbered issued invoices/credit notes and commercial-document history. A POS ticket is not automatically an invoice, certified receipt, or e-invoice.
7. **Fiscal reporting/tracking** - reports aggregate historical snapshots; legal registers store preparation/review/filing/payment evidence and verified due dates only.

## Proposed persistence

- `fiscal_profiles`: one store-scoped row with explicit review state and structured profile data.
- `fiscal_tax_rules`: immutable versions keyed by store, rule ID, and version; active dates must not overlap for the same scope/priority.
- `catalog_item_tax_assignments`: store-scoped item/category-to-rule assignments and explicit treatment/evidence.
- `orders.fiscal_snapshot`: nullable for legacy orders, populated at completion for configured fiscal orders. A database workflow computes or validates it from authoritative server rules; do not trust a client total.
- `fiscal_documents`: store-scoped document sequence/type/status and immutable issued payload; sequence allocation is transactional and unique.
- `fiscal_tracking_records`: store-scoped declarations, notices, legal documents, payment evidence references, review and audit status.
- Existing `reports.data` JSON snapshots can be extended with fiscal totals/breakdowns. X/Z reports read included order snapshots and retain their captured result.
- Local mode stores configuration under versioned store-specific keys and follows existing repository patterns. IndexedDB offline snapshots must include the exact rule/assignment versions used for each queued calculation.

Every tenant-owned table needs RLS based on the authenticated store/owner and should use composite store FKs where relationships cross tables. Privileged functions must set a fixed search path, check actor/store ownership and immutable state, and return explicit errors.

## Calculation contract

Input is a transaction timestamp/date, explicit line quantity and price, a declared price mode (`inclusive` or `exclusive`), a resolved treatment, and a validated ordered set of effective rule versions. Rule applicability is resolved and checked before calculation; missing, draft, out-of-date, conflicting, or unsupported rules cause an explicit failure or a clearly tagged non-fiscal/legacy operation.

For each line, calculate a non-negative HT base and each tax separately. Percentage rates are integer ppm; fixed charges are integer millimes per defined unit. Compound rules name the previous components that form their base. Round each component to the nearest millime using the documented half-away-from-zero policy; use the same order and policy in browser, server, reports, and exports. Inclusive prices must be solved against the same rule sequence and rejected if there is no exact millime solution rather than changing the configured gross price.

The immutable snapshot records:

- schema/calculation version and transaction time;
- tax treatment and legal evidence/reference;
- each rule ID/version, type, method, base, rate/fixed amount, effective interval, priority, and computed amount;
- line quantity, configured input price/mode, HT, tax amounts, other charges, and TTC;
- order-level sums and currency unit.

Discounts, promotions, returns, voids, and refunds must be represented as linked adjustments using the original snapshot; they cannot be recalculated from today's product price or rules.

## Online and offline order integration

The current online path is `orderService` -> `orderRepository.createOrder` -> `create_order_idempotent`/`create_order`. The database is authoritative. Extend this workflow so it loads locked active rule versions/assignments for the current store, computes and stores the snapshot atomically with order lines, and includes the snapshot in its idempotent response.

The current offline queue validates against a cached catalog. Extend its cache with profile/rule/assignment versions and calculation algorithm version, and store the queued snapshot. On reconnect, server validation must accept an exact still-valid version or move the order to an explicit review state; it must not silently recalculate a different historical sale.

## X/Z and fiscal reporting

Add report fields for HT sales, taxable bases by status, VAT by rate, other taxes by type, refunded/voided tax adjustments, and net TTC. Compute them only from the report period's completed-order snapshots and linked reversal snapshots. Persist the aggregate in the X/Z record so UI, print, PDF, and exports use identical values. Ticket display toggles never control these fields.

Dedicated fiscal reports use the same snapshot aggregation, date/range/status filters, source transaction IDs, and reconciliation checks. Filing a declaration is always a separate user/provider-confirmed action.

## Documents, e-invoicing, and certified devices

An issued document sequence is allocated in one server transaction and protected by a store/document-series unique constraint. Issued documents are never deleted or edited; correction, cancellation, and credit-note actions create linked records. Required fields are derived from a legally reviewed rule profile, not an owner-controlled visibility setting.

Implement only a provider/device adapter boundary until official legal scope, schemas, credentials, approvals, and archiving specifications have been confirmed. No local PDF, QR, API stub, or successful-looking status can be called certified or filed.

## Rollout and migration safety

Use additive migrations only: nullable snapshot columns for historical orders, new store-owned tables, indexes, RLS policies, and guarded RPCs. Preserve legacy rows and reports. Do not populate tax rates for existing stores, backfill historical taxes, rewrite issued documents, or change current order totals. Keep legacy behavior explicit until each store's fiscal configuration is reviewed.

## Implemented foundation and open technical decisions

The repository now contains the pure TypeScript millime calculation engine, profile/rule domain and persistence foundation, an owner profile/draft-rule/classification screen, a nullable immutable-order-snapshot schema, snapshot structure/reconciliation checks when reading orders, and X/Z aggregation/printing of snapshots with coverage warnings. Draft rules are intentionally not activated or applied at checkout. The report aggregate is client-generated and is not server-recomputed. Before production checkout implementation, specify SQL/TypeScript calculation parity, how cached-but-expired rules are handled, exact refund/discount representation, and document-number series rules with accounting/legal review. The live migration is not applied or database-validated.
