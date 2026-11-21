# Performance work plan

1. Phase 1: sanitize persisted update state; deduplicate/throttle checks; make build ID the modal source; add single-press cache-busting update flow and focused tests.
2. Phase 2: paginate and limit order reads; add summaries/detail paths; replace full-history screen loads with secured server aggregates; batch shift adjustments and customer credit checks.
3. Phase 3: deduplicate/correctly cache session and profile loads; parallelize schema checks; retain effective permissions in auth state and refresh safely; render cached session data immediately.
4. Phase 4: add a small keyed TTL/SWR query cache; persist specified POS data; target and debounce refreshes; bound notification catch-up; preserve offline POS snapshots.
5. Phase 5: add one new SQL migration only; reuse existing indexes, add missing RLS/FK indexes, optimize policies/session checks without weakening authorization, then ANALYZE. Do not apply remotely.
6. Phase 6: retain prompt-mode PWA updates; verify SKIP_WAITING handling; optimize font loading and lazy-load charts/PDF libraries without changing mobile layout.
7. Phase 7: run the prescribed typecheck, lint, tests, and build once; write the request-count report; bump the web version/versionCode pattern; commit each phase and push only after all phases.
8. Test update-state pure helpers and concurrent checks; verify bounded order query behavior, cached permissions, targeted invalidation, and aggregate result shapes with focused tests.
9. Existing indexes already cover orders(store_id, created_at), orders(shift_id), order_lines(order_id), catalog_items(store_id), and notifications(user_id, created_at); avoid duplicate indexes.
10. Preserve the pre-existing uncommitted worktree changes. In particular, src/App.tsx has unrelated loading-screen edits and will also be touched by Phases 1 and 3; isolate phase hunks before commits.

## Request-count report

These are source-derived Supabase REST/RPC counts, not production telemetry. Realtime WebSocket messages, auth token refreshes, and cached responses are excluded.

| Flow | Before | After |
| --- | --- | --- |
| Staff effective permissions | Protected routes and POS fetched permissions independently. | One aggregate `get_store_permissions` RPC during auth hydration; route and POS consumers use auth state, and focus/permission changes refresh it once. |
| POS credit status | One balance request per customer (`N`). | One `get_customers_credit_status` RPC for the store (`1`), saving `N - 1` requests when `N > 1`. |
| Shift adjustment reads | One adjustment query per shift (`N`). | One adjustment query for the listed shifts (`1`), saving `N - 1` requests when `N > 1`. |
| Dashboard aggregation | Client-side reads of historical orders and related records. | One secured dashboard aggregate RPC; shift metadata is loaded separately, with adjustments batched. |
| Order history | Unbounded full-order reads, including line details. | Summary reads are capped at 200 orders per page (`ceil(N / 200)` requests); details and lines load on demand. |
| Repeated catalog/store reads | Repeated requests on focus and screen refresh. | A 15-second keyed cache deduplicates fresh/in-flight reads, serves stale data while revalidating, and invalidates by changed table. |
| Notification catch-up | One 50-row query could skip older unseen rows when more than 50 arrived. | Pages of 50, at most three pages per pass, with a scheduled continuation; in-memory notification history is capped at 200. |
