# Fiscal Database Migration

Migrations:

- `20261125100000_fiscal_foundation.sql`
- `20261125120000_fiscal_checkout.sql`
- `20261125130000_fiscal_tax_type_variable.sql`
- `20261125140000_grant_profile_avatar_read.sql`
- `20261125150000_order_response_store_id.sql`

## Changes

- Adds a store-scoped fiscal profile table with explicit review state.
- Adds append-only, effective-dated, store-scoped tax rule versions; activation requires a legal reference and reviewer flag.
- Adds effective-dated item/category tax assignments, including explicit treatment/evidence fields and composite foreign keys that prevent cross-store product/rule references.
- Validates that referenced assignment rules are active, legally reviewed, and cover the assignment's effective interval.
- Adds a nullable JSON fiscal snapshot to `orders` for legacy compatibility and a trigger that prevents changing the snapshot after insertion.
- Extends the authoritative `create_order` transaction to resolve each store's effective item/category assignments, calculate the configured line taxes, reconcile the order total, and insert its immutable snapshot in the same transaction.
- Grants authenticated users only the non-sensitive `profiles.avatar_id` column needed by their RLS-scoped own-profile query, and includes `store_id` in the idempotent order response so clients can validate the persisted snapshot against its order.
- Revalidates pinned offline snapshots against the server's store-scoped, effective rules and rejects mismatches rather than recalculating the queued order with different rules.
- Uses the stored snapshot's gross total for tab credit checks, order lines, payment totals, and the idempotent response.
- Adds owner-only profile/rule/assignment writes and POS read policies for active rules/assignments.
- Exposes only the non-sensitive fiscal settings required by checkout through a store- and permission-scoped RPC; staff cannot read the full legal profile.
- Does not populate stores with rates, activate draft rules, alter previous orders, or derive historical taxes. Stores without configured active rules retain the existing checkout totals.

## Operational cautions

- This is additive and has no destructive data operation.
- The local Supabase stack uses API `55000`, database `55001`, shadow database `55002`, Studio `55003`, Mailpit `55004`, analytics `55005`, and pooler `55006` to avoid this host's excluded TCP port range. The existing local database volume was preserved.
- Local-only migrations were applied to the verified database at `127.0.0.1:55001`; latest local version is `20261125150000`. Local database lint previously reported no errors (11 warnings); pgTAP had five passing files before the new integration regression assertion was added and rerun.
- Hosted migration status was not checked. No hosted database was connected to or modified. The online transaction path still requires a separately approved deployment before it is active for hosted users.
- Owner profile and draft-rule configuration screens are available. Rules stay draft and are never activated automatically; line-tax types must also be explicitly configured.
- X/Z reports aggregate persisted snapshots and explicitly show missing-snapshot coverage. Their aggregate remains client-side and is not independently recomputed by the report RPC.
- Offline orders preserve the cached business date and calculated snapshot. The server verifies that snapshot against the effective store configuration before inserting; changed or unavailable configurations put the queued order into `needs_attention`.
- Full-order void reporting reverses amounts from the original snapshot. Partial refunds and fiscal credit-note workflows are not implemented.
- Rule rows are immutable. Changes require a new version; assignments should be superseded with a new effective-dated row.
- `reports.data` remains the storage location for report snapshots; new fiscal report fields must be populated from saved order snapshots.
