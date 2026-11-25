create extension if not exists pgtap;
select plan(38);

begin;

create temporary table order_transaction_event_context (
  store_id uuid not null,
  owner_id uuid not null,
  staff_id uuid,
  other_owner_id uuid,
  session_id text,
  owner_session_id text,
  position_id uuid,
  category_id uuid,
  item_id uuid,
  shift_id uuid,
  idempotency_key uuid
) on commit drop;

insert into order_transaction_event_context (
  store_id, owner_id, staff_id, other_owner_id, session_id, owner_session_id,
  position_id, category_id, item_id, idempotency_key
)
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
);

create temporary table order_transaction_event_results (
  first_response jsonb not null,
  replay_response jsonb
) on commit drop;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select owner_id, 'authenticated', 'authenticated',
       'order-event-owner-' || replace(store_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Order event owner"}'::jsonb, now(), now()
from order_transaction_event_context
union all
select staff_id, 'authenticated', 'authenticated',
       'order-event-staff-' || replace(store_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Order event staff"}'::jsonb, now(), now()
from order_transaction_event_context
union all
select other_owner_id, 'authenticated', 'authenticated',
       'order-event-other-owner-' || replace(store_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Other store owner"}'::jsonb, now(), now()
from order_transaction_event_context;

insert into public.stores (id, store_id, owner_id, code, name, pin_must_change)
select store_id, store_id, owner_id,
       'evt' || left(replace(store_id::text, '-', ''), 8),
       'Order event test store', false
from order_transaction_event_context;

insert into public.stores (id, store_id, owner_id, code, name, pin_must_change)
select other_owner_id, other_owner_id, other_owner_id,
       'evt' || left(replace(other_owner_id::text, '-', ''), 8),
       'Other order event test store', false
from order_transaction_event_context;

insert into public.profiles (id, store_id, role, name, email, username, must_change_password, is_active)
select owner_id, store_id, 'owner', 'Order event owner',
       'order-event-owner-' || replace(store_id::text, '-', '') || '@example.invalid',
       'order-event-owner-' || left(replace(store_id::text, '-', ''), 8), false, true
from order_transaction_event_context
union all
select other_owner_id, other_owner_id, 'owner', 'Other store owner',
       'order-event-other-owner-' || replace(other_owner_id::text, '-', '') || '@example.invalid',
       'order-event-other-owner-' || left(replace(other_owner_id::text, '-', ''), 8), false, true
from order_transaction_event_context;

insert into public.positions (id, store_id, name, permission_ids)
select position_id, store_id, 'Order event staff',
       array['open_close_shift', 'take_orders', 'request_void', 'view_order_history']
from order_transaction_event_context;

insert into public.profiles (
  id, store_id, role, name, email, username, position_id,
  must_change_password, is_active, session_version, must_set_pin
)
select staff_id, store_id, 'staff', 'Order event staff',
       'order-event-staff-' || replace(store_id::text, '-', '') || '@example.invalid',
       'order-event-staff-' || left(replace(store_id::text, '-', ''), 8),
       position_id, false, true, 0, false
from order_transaction_event_context;

insert into public.auth_sessions (session_id, user_id, session_version, expires_at)
select session_id, staff_id, 0, now() + interval '1 hour'
from order_transaction_event_context
union all
select owner_session_id, owner_id, 0, now() + interval '1 hour'
from order_transaction_event_context;

insert into public.categories (id, store_id, name)
select category_id, store_id, 'Order event category'
from order_transaction_event_context;

insert into public.catalog_items (id, store_id, category_id, name, price_millimes, stock_count)
select item_id, store_id, category_id, 'Order event item', 1500, 100
from order_transaction_event_context;

select set_config('request.jwt.claim.sub', staff_id::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config(
         'request.jwt.claims',
         jsonb_build_object(
           'sub', staff_id,
           'role', 'authenticated',
           'session_id', session_id
         )::text,
         true
       )
from order_transaction_event_context;

update order_transaction_event_context
set shift_id = (public.open_shift(0)).id;

insert into order_transaction_event_results (first_response)
select public.create_order_idempotent(
         context.idempotency_key,
         context.shift_id,
         jsonb_build_array(jsonb_build_object(
           'itemId', context.item_id,
           'quantity', 2,
           'modifiers', '[]'::jsonb,
           'unit_price_millimes', 1
         )),
         'cash',
         null,
         null,
         'Order event test',
         null
       )
from order_transaction_event_context context;

update order_transaction_event_results
set replay_response = (
  select public.create_order_idempotent(
    context.idempotency_key,
    context.shift_id,
    jsonb_build_array(jsonb_build_object(
      'itemId', context.item_id,
      'quantity', 2,
      'modifiers', '[]'::jsonb
    )),
    'cash',
    null,
    null,
    'Order event test retry',
    null
  )
  from order_transaction_event_context context
);

select set_config(
  'test.order_transaction_event_id',
  (first_response->'order'->>'id'),
  true
)
from order_transaction_event_results;

create temporary table order_transaction_event_saved_sale (
  payload jsonb not null
) on commit drop;

insert into order_transaction_event_saved_sale (payload)
select payload
from public.order_transaction_events
where order_id = current_setting('test.order_transaction_event_id')::uuid
  and event_type = 'sale_created';

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'sale_created'
  ),
  1,
  'a committed sale creates exactly one sale event'
);

select is(
  (
    select (payload #>> '{order,totalMillimes}')::bigint
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'sale_created'
  ),
  3000::bigint,
  'sale event records the persisted order total'
);

select is(
  (
    select (payload #>> '{order,items,0,unitPriceMillimes}')::bigint
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'sale_created'
  ),
  1500::bigint,
  'sale event records persisted catalog pricing instead of submitted price data'
);

select is(
  (
    select actor_id
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'sale_created'
  ),
  (select staff_id from order_transaction_event_context),
  'sale event identifies the authenticated cashier'
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = (replay_response->'order'->>'id')::uuid
      and event_type = 'sale_created'
  ),
  1,
  'retrying an idempotent sale does not duplicate its event'
)
from order_transaction_event_results;

select public.request_order_void(
  current_setting('test.order_transaction_event_id')::uuid,
  'Customer changed their mind'
);

select throws_ok(
  format(
    'select public.request_order_void(%L::uuid, %L)',
    current_setting('test.order_transaction_event_id'),
    'Customer changed their mind'
  ),
  'P0001',
  'This order cannot be voided or the reason is invalid.',
  'retrying an already-pending void request cannot create another event'
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_requested'
  ),
  1,
  'a void request creates one separate event'
);

select is(
  (
    select actor_id
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_requested'
  ),
  (select staff_id from order_transaction_event_context),
  'void request event records the requesting cashier'
);

select is(
  (
    select reason
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_requested'
  ),
  'Customer changed their mind',
  'void request event records its reason'
);

select set_config('request.jwt.claim.sub', owner_id::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config(
         'request.jwt.claims',
         jsonb_build_object(
           'sub', owner_id,
           'role', 'authenticated',
           'session_id', owner_session_id
         )::text,
         true
       )
from order_transaction_event_context;

select public.resolve_order_void(
  current_setting('test.order_transaction_event_id')::uuid,
  'reject',
  'Review confirmed the original sale',
  ''
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_rejected'
  ),
  1,
  'a rejected void decision creates a separate event'
);

select is(
  (
    select actor_id
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_rejected'
  ),
  (select owner_id from order_transaction_event_context),
  'void rejection event records the deciding owner'
);

select is(
  (
    select reason
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_rejected'
  ),
  'Review confirmed the original sale',
  'void rejection event records its decision reason'
);

select throws_ok(
  format(
    'select public.resolve_order_void(%L::uuid, %L, %L, %L)',
    current_setting('test.order_transaction_event_id'),
    'reject',
    'Retry rejected decision',
    ''
  ),
  'P0001',
  'This order cannot be resolved.',
  'retrying a completed rejection cannot create another decision event'
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_rejected'
  ),
  1,
  'a rejected-decision retry does not duplicate its event'
);

select set_config('request.jwt.claim.sub', staff_id::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config(
         'request.jwt.claims',
         jsonb_build_object(
           'sub', staff_id,
           'role', 'authenticated',
           'session_id', session_id
         )::text,
         true
       )
from order_transaction_event_context;

select public.request_order_void(
  current_setting('test.order_transaction_event_id')::uuid,
  'Second review'
);

select set_config('request.jwt.claim.sub', owner_id::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config(
         'request.jwt.claims',
         jsonb_build_object(
           'sub', owner_id,
           'role', 'authenticated',
           'session_id', owner_session_id
         )::text,
         true
       )
from order_transaction_event_context;

select public.resolve_order_void(
  current_setting('test.order_transaction_event_id')::uuid,
  'approve',
  'Owner approved the void',
  ''
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_requested'
  ),
  2,
  'a later void request receives its own event'
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_approved'
  ),
  1,
  'an approved void decision creates a separate event'
);

select is(
  (
    select reason
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_approved'
  ),
  'Owner approved the void',
  'void approval event records its decision reason'
);

select is(
  (
    select actor_id
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_approved'
  ),
  (select owner_id from order_transaction_event_context),
  'void approval event records the deciding owner'
);

select throws_ok(
  format(
    'select public.resolve_order_void(%L::uuid, %L, %L, %L)',
    current_setting('test.order_transaction_event_id'),
    'approve',
    'Retry approved decision',
    ''
  ),
  'P0001',
  'This order cannot be resolved.',
  'retrying an approved void cannot create another decision event'
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'void_approved'
  ),
  1,
  'an approved-decision retry does not duplicate its event'
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
  ),
  5,
  'sale, repeated request, and both decisions remain distinct events'
);

select ok(
  (
    select count(*) = 4
      and count(*) filter (
        where original_sale_event_id = (
          select id
          from public.order_transaction_events
          where order_id = current_setting('test.order_transaction_event_id')::uuid
            and event_type = 'sale_created'
        )
      ) = 4
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type <> 'sale_created'
  ),
  'void events for a newly recorded sale reference its immutable sale event'
);

select is(
  (
    select payload
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'sale_created'
  ),
  (select payload from order_transaction_event_saved_sale),
  'void operations do not change the original sale snapshot'
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
      and event_type = 'sale_created'
  ),
  1,
  'the original sale event remains after a void'
);

select throws_ok(
  format(
    'update public.order_transaction_events set reason = %L where order_id = %L::uuid',
    'tampered',
    current_setting('test.order_transaction_event_id')
  ),
  '55000',
  'Order transaction events are append-only.',
  'database trigger rejects event updates'
);

select throws_ok(
  format(
    'delete from public.order_transaction_events where order_id = %L::uuid',
    current_setting('test.order_transaction_event_id')
  ),
  '55000',
  'Order transaction events are append-only.',
  'database trigger rejects event deletion'
);

select throws_ok(
  format(
    'delete from public.orders where id = %L::uuid',
    current_setting('test.order_transaction_event_id')
  ),
  '23503',
  'update or delete on table "orders" violates foreign key constraint "order_transaction_events_order_store_fkey" on table "order_transaction_events"',
  'the linked original order cannot be deleted while its event history exists'
);

select ok(
  not has_table_privilege('authenticated', 'public.order_transaction_events', 'UPDATE'),
  'authenticated users have no event update grant'
);

select ok(
  not has_table_privilege('authenticated', 'public.order_transaction_events', 'DELETE'),
  'authenticated users have no event delete grant'
);

select ok(
  not has_table_privilege('authenticated', 'public.order_transaction_events', 'INSERT'),
  'authenticated users cannot directly insert event rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.order_transaction_events', 'TRUNCATE'),
  'authenticated users have no event truncate grant'
);

select set_config('request.jwt.claim.sub', staff_id::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config(
         'request.jwt.claims',
         jsonb_build_object(
           'sub', staff_id,
           'role', 'authenticated',
           'session_id', session_id
         )::text,
         true
       )
from order_transaction_event_context;

create function pg_temp.try_update_order_total(p_order_id uuid)
returns integer
language sql
as $$
  with updated as (
    update public.orders
    set total_millimes = 1
    where id = p_order_id
    returning id
  )
  select count(*)::integer from updated
$$;

create function pg_temp.try_update_order_line_total(p_order_id uuid)
returns integer
language sql
as $$
  with updated as (
    update public.order_lines
    set line_total_millimes = 1
    where order_id = p_order_id
    returning id
  )
  select count(*)::integer from updated
$$;

set local role authenticated;

select is(
  pg_temp.try_update_order_total(current_setting('test.order_transaction_event_id')::uuid),
  0,
  'authenticated staff cannot rewrite a persisted order total'
);

select is(
  pg_temp.try_update_order_line_total(current_setting('test.order_transaction_event_id')::uuid),
  0,
  'authenticated staff cannot rewrite persisted order lines'
);

reset role;

create temporary table legacy_order_transaction_event_context (
  order_id uuid not null
) on commit drop;

insert into legacy_order_transaction_event_context (order_id)
select gen_random_uuid();

insert into public.orders (
  id, store_id, number, business_date, staff_id, shift_id,
  status, payment_method, total_millimes
)
select legacy.order_id, context.store_id, 2147483647,
       source_order.business_date, context.staff_id, context.shift_id,
       'done', 'cash', 1000
from legacy_order_transaction_event_context legacy
cross join order_transaction_event_context context
join public.orders source_order
  on source_order.id = current_setting('test.order_transaction_event_id')::uuid;

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = (select order_id from legacy_order_transaction_event_context)
      and event_type = 'sale_created'
  ),
  0,
  'the simulated pre-migration order is not backfilled with a sale event'
);

select set_config('request.jwt.claim.sub', staff_id::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config(
         'request.jwt.claims',
         jsonb_build_object(
           'sub', staff_id,
           'role', 'authenticated',
           'session_id', session_id
         )::text,
         true
       )
from order_transaction_event_context;

select public.request_order_void(
  (select order_id from legacy_order_transaction_event_context),
  'Legacy order void request'
);

select set_config('request.jwt.claim.sub', owner_id::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config(
         'request.jwt.claims',
         jsonb_build_object(
           'sub', owner_id,
           'role', 'authenticated',
           'session_id', owner_session_id
         )::text,
         true
       )
from order_transaction_event_context;

select public.resolve_order_void(
  (select order_id from legacy_order_transaction_event_context),
  'reject',
  'Legacy order reviewed',
  ''
);

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = (select order_id from legacy_order_transaction_event_context)
      and event_type in ('void_requested', 'void_rejected')
  ),
  2,
  'legacy orders can complete the void request and rejection workflow'
);

select ok(
  (
    select count(*) = 2
      and count(*) filter (where original_sale_event_id is null) = 2
    from public.order_transaction_events
    where order_id = (select order_id from legacy_order_transaction_event_context)
  ),
  'legacy void events remain linked to their order without fabricating a sale-event reference'
);

select ok(
  (
    select count(*) = 0
    from public.order_transaction_events event
    where event.event_type <> 'sale_created'
      and event.order_id in (
        current_setting('test.order_transaction_event_id')::uuid,
        (select order_id from legacy_order_transaction_event_context)
      )
      and event.occurred_at is distinct from (
        case
          when event.event_type = 'void_requested'
            then (event.payload #>> '{transition,requestedAt}')::timestamptz
          else (event.payload #>> '{transition,resolvedAt}')::timestamptz
        end
      )
  ),
  'all void events preserve their authoritative transition timestamps'
);

select set_config('request.jwt.claim.sub', other_owner_id::text, true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config(
         'request.jwt.claims',
         jsonb_build_object(
           'sub', other_owner_id,
           'role', 'authenticated'
         )::text,
         true
       )
from order_transaction_event_context;

set local role authenticated;

select is(
  (
    select count(*)::integer
    from public.order_transaction_events
    where order_id = current_setting('test.order_transaction_event_id')::uuid
  ),
  0,
  'another store owner cannot read this order event history'
);

reset role;

select * from finish();
rollback;
