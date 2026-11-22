-- Paste into the Supabase SQL editor using its postgres role.
-- All created rows, including the temporary auth users, are rolled back.
create extension if not exists pgtap;
select plan(1);

begin;

create temporary table smoke_order_context (
  store_id uuid not null,
  owner_id uuid not null,
  staff_id uuid not null,
  session_id text not null,
  position_id uuid not null,
  category_id uuid not null,
  item_id uuid not null,
  customer_id uuid not null,
  shift_id uuid
) on commit drop;

create temporary table smoke_order_results (
  order_kind text not null,
  order_number integer not null
) on commit drop;

insert into smoke_order_context (
  store_id, owner_id, staff_id, session_id, position_id, category_id, item_id, customer_id
)
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()::text,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select owner_id, 'authenticated', 'authenticated',
       'smoke-owner-' || replace(owner_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Order smoke owner"}'::jsonb, now(), now()
from smoke_order_context
union all
select staff_id, 'authenticated', 'authenticated',
       'smoke-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Order smoke staff"}'::jsonb, now(), now()
from smoke_order_context;

insert into public.stores (id, store_id, owner_id, code, name, pin_must_change)
select store_id, store_id, owner_id,
       'smoke' || left(replace(store_id::text, '-', ''), 8),
       'Order smoke test', false
from smoke_order_context;

insert into public.profiles (id, store_id, role, name, email, username, must_change_password, is_active)
select owner_id, store_id, 'owner', 'Order smoke owner',
       'smoke-owner-' || replace(owner_id::text, '-', '') || '@example.invalid',
       'smoke-owner-' || left(replace(owner_id::text, '-', ''), 8), false, true
from smoke_order_context;

insert into public.positions (id, store_id, name, permission_ids)
select position_id, store_id, 'Order smoke staff',
       array['open_close_shift', 'take_orders', 'use_tabs']
from smoke_order_context;

insert into public.profiles (
  id, store_id, role, name, email, username, position_id,
  must_change_password, is_active, session_version, must_set_pin
)
select staff_id, store_id, 'staff', 'Order smoke staff',
       'smoke-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       'smoke-staff-' || left(replace(staff_id::text, '-', ''), 8),
       position_id, false, true, 0, false
from smoke_order_context;

insert into public.auth_sessions (session_id, user_id, session_version, expires_at)
select session_id, staff_id, 0, now() + interval '1 hour'
from smoke_order_context;

insert into public.categories (id, store_id, name)
select category_id, store_id, 'Order smoke category'
from smoke_order_context;

insert into public.catalog_items (id, store_id, category_id, name, price_millimes, stock_count)
select item_id, store_id, category_id, 'Order smoke item', 1000, null
from smoke_order_context;

insert into public.customers (id, store_id, name)
select customer_id, store_id, 'Order smoke customer'
from smoke_order_context;

select set_config('request.jwt.claim.sub', staff_id::text, true)
from smoke_order_context;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', staff_id,
    'role', 'authenticated',
    'session_id', session_id
  )::text,
  true
)
from smoke_order_context;

update smoke_order_context
set shift_id = (public.open_shift(0)).id;

insert into smoke_order_results (order_kind, order_number)
select 'normal',
       (public.create_order(
         context.shift_id,
         jsonb_build_array(jsonb_build_object(
           'itemId', context.item_id,
           'quantity', 1,
           'modifiers', '[]'::jsonb
         )),
         'cash',
         null,
         null,
         'Normal order smoke test',
         null
       )->'order'->>'number')::integer
from smoke_order_context context;

insert into smoke_order_results (order_kind, order_number)
select 'customer tab',
       (public.create_order(
         context.shift_id,
         jsonb_build_array(jsonb_build_object(
           'itemId', context.item_id,
           'quantity', 1,
           'modifiers', '[]'::jsonb
         )),
         'tab',
         context.customer_id,
         null,
         'Tab order smoke test',
         null
       )->'order'->>'number')::integer
from smoke_order_context context;

select order_kind, order_number
from smoke_order_results
order by order_number;

do $$
begin
  if (select count(*) from smoke_order_results) <> 2
    or (select min(order_number) from smoke_order_results) <> 1
    or (select max(order_number) from smoke_order_results) <> 2 then
    raise exception 'Smoke orders must receive consecutive ticket numbers.';
  end if;
end
$$;

select pass('order creation and ticket numbering assertions completed');
select * from finish();

rollback;
