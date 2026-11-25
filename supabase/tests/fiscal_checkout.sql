create extension if not exists pgtap;
select plan(10);

begin;

create temporary table fiscal_checkout_context (
  store_id uuid not null,
  owner_id uuid not null,
  staff_id uuid not null,
  session_id text not null,
  position_id uuid not null,
  category_id uuid not null,
  item_id uuid not null,
  shift_id uuid,
  idempotency_key uuid not null
) on commit drop;

create temporary table fiscal_checkout_results (
  first_response jsonb not null,
  replay_response jsonb
) on commit drop;

insert into fiscal_checkout_context (
  store_id, owner_id, staff_id, session_id, position_id, category_id, item_id, idempotency_key
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
       'fiscal-owner-' || replace(owner_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Fiscal checkout owner"}'::jsonb, now(), now()
from fiscal_checkout_context
union all
select staff_id, 'authenticated', 'authenticated',
       'fiscal-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Fiscal checkout staff"}'::jsonb, now(), now()
from fiscal_checkout_context;

insert into public.stores (id, store_id, owner_id, code, name, pin_must_change)
select store_id, store_id, owner_id,
       'fiscal' || left(replace(store_id::text, '-', ''), 8),
       'Fiscal checkout test', false
from fiscal_checkout_context;

insert into public.profiles (id, store_id, role, name, email, username, must_change_password, is_active)
select owner_id, store_id, 'owner', 'Fiscal checkout owner',
       'fiscal-owner-' || replace(owner_id::text, '-', '') || '@example.invalid',
       'fiscal-owner-' || left(replace(owner_id::text, '-', ''), 8), false, true
from fiscal_checkout_context;

insert into public.positions (id, store_id, name, permission_ids)
select position_id, store_id, 'Fiscal checkout staff', array['open_close_shift', 'take_orders']
from fiscal_checkout_context;

insert into public.profiles (
  id, store_id, role, name, email, username, position_id,
  must_change_password, is_active, session_version, must_set_pin
)
select staff_id, store_id, 'staff', 'Fiscal checkout staff',
       'fiscal-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       'fiscal-staff-' || left(replace(staff_id::text, '-', ''), 8),
       position_id, false, true, 0, false
from fiscal_checkout_context;

insert into public.auth_sessions (session_id, user_id, session_version, expires_at)
select session_id, staff_id, 0, now() + interval '1 hour'
from fiscal_checkout_context;

insert into public.categories (id, store_id, name)
select category_id, store_id, 'Fiscal checkout category'
from fiscal_checkout_context;

insert into public.catalog_items (id, store_id, category_id, name, price_millimes, stock_count)
select item_id, store_id, category_id, 'Fiscal checkout item', 1000, null
from fiscal_checkout_context;

insert into public.fiscal_profiles (
  store_id, review_status, data, reviewed_by, reviewed_at, updated_by
)
select store_id, 'confirmed',
       '{"requiredTaxTypes":["vat"],"pricingMode":"exclusive","taxId":"TEST-ONLY"}'::jsonb,
       owner_id, now(), owner_id
from fiscal_checkout_context;

insert into public.fiscal_tax_rules (
  store_id, rule_id, version, name, tax_type, calculation_method,
  rate_ppm, priority, effective_from, status, legal_reference, legal_reviewed, created_by
)
select store_id, 'synthetic-vat-test', 1, 'Synthetic 10 percent database test',
       'vat', 'percentage', 100000, 1, current_date - 1, 'active',
       'Test fixture only; not a legal rate', true, owner_id
from fiscal_checkout_context;

insert into public.catalog_item_tax_assignments (
  store_id, category_id, tax_type, treatment, rule_id, rule_version,
  effective_from, created_by
)
select store_id, category_id, 'vat', 'taxable', 'synthetic-vat-test', 1,
       current_date - 1, owner_id
from fiscal_checkout_context;

select set_config('request.jwt.claim.sub', staff_id::text, true)
from fiscal_checkout_context;
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
from fiscal_checkout_context;

update fiscal_checkout_context
set shift_id = (public.open_shift(0)).id;

insert into fiscal_checkout_results (first_response)
select public.create_order_idempotent(
         context.idempotency_key,
         context.shift_id,
         jsonb_build_array(jsonb_build_object(
           'itemId', context.item_id,
           'quantity', 1,
           'modifiers', '[]'::jsonb
         )),
         'cash',
         null,
         null,
         'Fiscal checkout database test',
         null
       )
from fiscal_checkout_context context;

update fiscal_checkout_results
set replay_response = (
  select public.create_order_idempotent(
         context.idempotency_key,
         context.shift_id,
         jsonb_build_array(jsonb_build_object(
           'itemId', context.item_id,
           'quantity', 1,
           'modifiers', '[]'::jsonb
         )),
         'cash',
         null,
         null,
         'Fiscal checkout database test',
         null
       )
  from fiscal_checkout_context context
);

select ok(
  (checkout_profile->>'storeId') = context.store_id::text
  and not (checkout_profile ? 'taxId'),
  'checkout staff can read only the store-scoped, non-sensitive fiscal settings'
)
from fiscal_checkout_context context
cross join lateral (
  select public.get_checkout_fiscal_profile(context.store_id) as checkout_profile
) checkout;

select is(
  (checkout_profile->'requiredTaxTypes'),
  '["vat"]'::jsonb,
  'checkout fiscal profile returns the required tax types'
)
from fiscal_checkout_context context
cross join lateral (
  select public.get_checkout_fiscal_profile(context.store_id) as checkout_profile
) checkout;

select throws_ok(
  'select public.get_checkout_fiscal_profile(gen_random_uuid())',
  '42501',
  'Not authorized to read checkout fiscal settings.',
  'checkout fiscal settings cannot be read across stores'
);

select is(
  (first_response->'order'->>'total_millimes')::bigint,
  1100::bigint,
  'server-calculated tax is included in the persisted transaction total'
)
from fiscal_checkout_results;

select is(
  first_response->'order'->>'store_id',
  (select store_id::text from fiscal_checkout_context),
  'the idempotent order response includes its store id for snapshot validation'
)
from fiscal_checkout_results;

select is(
  (first_response->'order'->'fiscal_snapshot'->>'totalTaxMillimes')::bigint,
  100::bigint,
  'the order stores its immutable fiscal tax snapshot'
)
from fiscal_checkout_results;

select throws_ok(
  $$
    update public.orders
    set fiscal_snapshot = fiscal_snapshot || '{"totalTaxMillimes":101}'::jsonb
    where id = (
      select (first_response->'order'->>'id')::uuid
      from fiscal_checkout_results
    )
  $$,
  'P0001',
  'A completed order fiscal snapshot is immutable.',
  'a completed order fiscal snapshot cannot be changed'
);

select is(
  first_response->'order'->>'id',
  replay_response->'order'->>'id',
  'replaying the idempotency key returns the original fiscal order'
)
from fiscal_checkout_results;

select is(
  (select count(*)::integer from public.orders order_record
   join fiscal_checkout_context context on order_record.store_id = context.store_id),
  1,
  'idempotent fiscal synchronization creates only one order'
);

update public.positions
set permission_ids = '{}'
where id in (select position_id from fiscal_checkout_context);

select throws_ok(
  'select public.get_checkout_fiscal_profile((select store_id from fiscal_checkout_context))',
  '42501',
  'Not authorized to read checkout fiscal settings.',
  'checkout fiscal settings require take_orders permission'
);

select * from finish();
rollback;
