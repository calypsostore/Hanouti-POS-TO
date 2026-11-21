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
