create extension if not exists pgtap;
select plan(27);

begin;

create temporary table fiscal_report_test_context (
  store_id uuid not null,
  owner_id uuid not null,
  staff_id uuid not null,
  other_store_id uuid not null,
  other_owner_id uuid not null,
  shift_id uuid not null,
  category_id uuid not null,
  item_id uuid not null
) on commit drop;

insert into fiscal_report_test_context
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select owner_id, 'authenticated', 'authenticated',
       'fiscal-report-owner-' || replace(owner_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Fiscal report owner"}'::jsonb, now(), now()
from fiscal_report_test_context
union all
select staff_id, 'authenticated', 'authenticated',
       'fiscal-report-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Fiscal report staff"}'::jsonb, now(), now()
from fiscal_report_test_context
union all
select other_owner_id, 'authenticated', 'authenticated',
       'fiscal-report-other-owner-' || replace(other_owner_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Other report owner"}'::jsonb, now(), now()
from fiscal_report_test_context;

insert into public.stores (id, store_id, owner_id, code, name, timezone)
select store_id, store_id, owner_id,
       'fr' || left(replace(store_id::text, '-', ''), 8),
       'Fiscal report E2E fixture', 'Africa/Tunis'
from fiscal_report_test_context;

insert into public.stores (id, store_id, owner_id, code, name, timezone)
select other_store_id, other_store_id, other_owner_id,
       'fo' || left(replace(other_store_id::text, '-', ''), 8),
       'Other store fixture', 'Africa/Tunis'
from fiscal_report_test_context;

insert into public.profiles (id, store_id, role, name, email, username, is_active, must_change_password)
select owner_id, store_id, 'owner', 'Fiscal report owner',
       'fiscal-report-owner-' || replace(owner_id::text, '-', '') || '@example.invalid',
       'fiscal-report-owner-' || left(replace(owner_id::text, '-', ''), 8), true, false
from fiscal_report_test_context
union all
select staff_id, store_id, 'staff', 'Fiscal report staff',
       'fiscal-report-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       'fiscal-report-staff-' || left(replace(staff_id::text, '-', ''), 8), true, false
from fiscal_report_test_context
union all
select other_owner_id, other_store_id, 'owner', 'Other report owner',
       'fiscal-report-other-owner-' || replace(other_owner_id::text, '-', '') || '@example.invalid',
       'fiscal-report-other-owner-' || left(replace(other_owner_id::text, '-', ''), 8), true, false
from fiscal_report_test_context;

insert into public.auth_sessions (session_id, user_id, session_version, expires_at)
select 'fiscal-report-test-' || replace(owner_id::text, '-', ''), owner_id, 0, now() + interval '1 hour'
from fiscal_report_test_context
union all
select 'fiscal-report-test-' || replace(staff_id::text, '-', ''), staff_id, 0, now() + interval '1 hour'
from fiscal_report_test_context;

insert into public.shifts (id, store_id, staff_id, status, starting_cash_millimes, opened_at)
select shift_id, store_id, staff_id, 'closed', 0, '2026-03-01 00:00:00+01'
from fiscal_report_test_context;

insert into public.categories (id, store_id, name)
select category_id, store_id, 'Report fixture category'
from fiscal_report_test_context;

insert into public.catalog_items (id, store_id, category_id, name, price_millimes, stock_count)
select item_id, store_id, category_id, 'Synthetic VAT item', 3210, null
from fiscal_report_test_context;

create temporary table fiscal_report_test_orders (
  fixture_key text primary key,
  order_id uuid not null,
  order_number integer not null,
  status text not null,
  payment_method text not null,
  total_millimes bigint not null,
  created_at timestamptz not null,
  voided_at timestamptz,
  fiscal_snapshot jsonb
) on commit drop;

insert into fiscal_report_test_orders values
('vat19', gen_random_uuid(), 1, 'done', 'cash', 3000, '2026-02-28 23:00:00+00', null,
 jsonb_build_object('schemaVersion', 1, 'calculationVersion', 'millime-tax-v1', 'currency', 'TND',
   'storeId', (select store_id from fiscal_report_test_context), 'transactionDate', '2026-03-01',
   'roundingPolicy', 'nearest-millime-half-up', 'netAmountMillimes', 2521, 'totalTaxMillimes', 479, 'totalAmountMillimes', 3000,
   'lines', jsonb_build_array(jsonb_build_object('lineId', 'vat19-line', 'itemId', (select item_id from fiscal_report_test_context),
     'quantity', 1, 'unitAmountMillimes', 3000, 'discountMillimes', 0, 'priceMode', 'inclusive',
     'netAmountMillimes', 2521, 'totalTaxMillimes', 479, 'totalAmountMillimes', 3000,
     'taxes', jsonb_build_array(jsonb_build_object('taxType', 'vat', 'treatment', 'taxable',
       'ruleId', 'synthetic-19', 'ruleVersion', 1, 'ruleName', 'Synthetic 19 percent',
       'calculationMethod', 'percentage', 'ratePpm', 190000, 'taxableBaseMillimes', 2521, 'amountMillimes', 479)))))),
('vat7-inclusive', gen_random_uuid(), 2, 'done', 'card', 3000, '2026-03-01 10:00:00+00', null,
 jsonb_build_object('schemaVersion', 1, 'calculationVersion', 'millime-tax-v1', 'currency', 'TND',
   'storeId', (select store_id from fiscal_report_test_context), 'transactionDate', '2026-03-01',
   'roundingPolicy', 'nearest-millime-half-up', 'netAmountMillimes', 2804, 'totalTaxMillimes', 196, 'totalAmountMillimes', 3000,
   'lines', jsonb_build_array(jsonb_build_object('lineId', 'vat7-inclusive-line', 'itemId', (select item_id from fiscal_report_test_context),
     'quantity', 1, 'unitAmountMillimes', 3000, 'discountMillimes', 0, 'priceMode', 'inclusive',
     'netAmountMillimes', 2804, 'totalTaxMillimes', 196, 'totalAmountMillimes', 3000,
     'taxes', jsonb_build_array(jsonb_build_object('taxType', 'vat', 'treatment', 'taxable',
       'ruleId', 'synthetic-7', 'ruleVersion', 1, 'ruleName', 'Synthetic 7 percent',
       'calculationMethod', 'percentage', 'ratePpm', 70000, 'taxableBaseMillimes', 2804, 'amountMillimes', 196)))))),
('vat7-exclusive', gen_random_uuid(), 3, 'done', 'other', 3210, '2026-03-01 15:00:00+00', null,
 jsonb_build_object('schemaVersion', 1, 'calculationVersion', 'millime-tax-v1', 'currency', 'TND',
   'storeId', (select store_id from fiscal_report_test_context), 'transactionDate', '2026-03-01',
   'roundingPolicy', 'nearest-millime-half-up', 'netAmountMillimes', 3000, 'totalTaxMillimes', 210, 'totalAmountMillimes', 3210,
   'lines', jsonb_build_array(jsonb_build_object('lineId', 'vat7-exclusive-line', 'itemId', (select item_id from fiscal_report_test_context),
     'quantity', 1, 'unitAmountMillimes', 3000, 'discountMillimes', 0, 'priceMode', 'exclusive',
     'netAmountMillimes', 3000, 'totalTaxMillimes', 210, 'totalAmountMillimes', 3210,
     'taxes', jsonb_build_array(jsonb_build_object('taxType', 'vat', 'treatment', 'taxable',
       'ruleId', 'synthetic-7', 'ruleVersion', 1, 'ruleName', 'Synthetic 7 percent',
       'calculationMethod', 'percentage', 'ratePpm', 70000, 'taxableBaseMillimes', 3000, 'amountMillimes', 210)))))),
('legacy-tab', gen_random_uuid(), 4, 'done', 'tab', 900, '2026-03-01 17:00:00+00', null, null),
('voided', gen_random_uuid(), 5, 'voided', 'cash', 3000, '2026-03-01 11:00:00+00', '2026-03-01 18:00:00+00',
 jsonb_build_object('schemaVersion', 1, 'calculationVersion', 'millime-tax-v1', 'currency', 'TND',
   'storeId', (select store_id from fiscal_report_test_context), 'transactionDate', '2026-03-01',
   'roundingPolicy', 'nearest-millime-half-up', 'netAmountMillimes', 2521, 'totalTaxMillimes', 479, 'totalAmountMillimes', 3000,
   'lines', jsonb_build_array(jsonb_build_object('lineId', 'void-line', 'itemId', (select item_id from fiscal_report_test_context),
     'quantity', 1, 'unitAmountMillimes', 3000, 'discountMillimes', 0, 'priceMode', 'inclusive',
     'netAmountMillimes', 2521, 'totalTaxMillimes', 479, 'totalAmountMillimes', 3000,
     'taxes', jsonb_build_array(jsonb_build_object('taxType', 'vat', 'treatment', 'taxable',
       'ruleId', 'synthetic-19', 'ruleVersion', 1, 'ruleName', 'Synthetic 19 percent',
       'calculationMethod', 'percentage', 'ratePpm', 190000, 'taxableBaseMillimes', 2521, 'amountMillimes', 479)))))),
('at-exclusive-end', gen_random_uuid(), 6, 'done', 'cash', 3000, '2026-03-01 23:00:00+00', null,
 jsonb_build_object('schemaVersion', 1, 'calculationVersion', 'millime-tax-v1', 'currency', 'TND',
   'storeId', (select store_id from fiscal_report_test_context), 'transactionDate', '2026-03-02',
   'roundingPolicy', 'nearest-millime-half-up', 'netAmountMillimes', 2521, 'totalTaxMillimes', 479, 'totalAmountMillimes', 3000,
   'lines', jsonb_build_array(jsonb_build_object('lineId', 'end-line', 'itemId', (select item_id from fiscal_report_test_context),
     'quantity', 1, 'unitAmountMillimes', 3000, 'discountMillimes', 0, 'priceMode', 'inclusive',
     'netAmountMillimes', 2521, 'totalTaxMillimes', 479, 'totalAmountMillimes', 3000,
     'taxes', jsonb_build_array(jsonb_build_object('taxType', 'vat', 'treatment', 'taxable',
       'ruleId', 'synthetic-19', 'ruleVersion', 1, 'ruleName', 'Synthetic 19 percent',
       'calculationMethod', 'percentage', 'ratePpm', 190000, 'taxableBaseMillimes', 2521, 'amountMillimes', 479)))))),
('before-start', gen_random_uuid(), 7, 'done', 'cash', 3000, '2026-02-28 22:59:59+00', null, null);

insert into public.orders (
  id, store_id, number, business_date, staff_id, shift_id, status,
  payment_method, total_millimes, created_at, voided_at, void_reason, fiscal_snapshot
)
select fixture.order_id, context.store_id, fixture.order_number, '2026-03-01',
       context.staff_id, context.shift_id, fixture.status, fixture.payment_method,
       fixture.total_millimes, fixture.created_at, fixture.voided_at,
       case when fixture.status = 'voided' then 'Fixture void' else null end,
       fixture.fiscal_snapshot
from fiscal_report_test_orders fixture
cross join fiscal_report_test_context context;

insert into public.order_lines (
  store_id, order_id, item_id, category_id, category_name, name,
  quantity, unit_price_millimes, line_total_millimes
)
select context.store_id, fixture.order_id, context.item_id, context.category_id,
       'Report fixture category', 'Synthetic VAT item', 1,
       fixture.total_millimes, fixture.total_millimes
from fiscal_report_test_orders fixture
cross join fiscal_report_test_context context
where fixture.fiscal_snapshot is not null;

insert into public.shift_void_adjustments (
  store_id, shift_id, order_id, order_number, amount_millimes, created_at
)
select context.store_id, context.shift_id, fixture.order_id, fixture.order_number, 3000,
       '2026-03-01 18:30:00+00'
from fiscal_report_test_orders fixture
cross join fiscal_report_test_context context
where fixture.fixture_key = 'voided';

insert into public.cash_movements (
  store_id, shift_id, staff_id, kind, amount_millimes, reason, note, created_at
)
select store_id, shift_id, staff_id, 'in', 250, 'other', 'Fixture movement',
       '2026-03-01 19:00:00+00'
from fiscal_report_test_context;

select set_config('request.jwt.claim.sub', owner_id::text, true)
from fiscal_report_test_context;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', owner_id,
  'role', 'authenticated',
  'session_id', 'fiscal-report-test-' || replace(owner_id::text, '-', '')
)::text, true)
from fiscal_report_test_context;
select diag(format(
  'owner fixture check: uid=%s, role=%s, store-owner=%s, profiles=%s, store-owner-id=%s, profile-store=%s',
  coalesce(auth.uid()::text, 'null'),
  coalesce(public.current_user_role(), 'null'),
  public.is_store_owner((select store_id from fiscal_report_test_context)),
  (select count(*) from public.profiles where id = (select owner_id from fiscal_report_test_context)),
  (select owner_id::text from public.stores where store_id = (select store_id from fiscal_report_test_context)),
  (select store_id::text from public.profiles where id = (select owner_id from fiscal_report_test_context))
));

create temporary table fiscal_report_test_result (report jsonb) on commit drop;
insert into fiscal_report_test_result
select public.get_fiscal_arbitrary_report(
  (select store_id from fiscal_report_test_context),
  '2026-03-01',
  '2026-03-02',
  'Africa/Tunis'
);

select is((report#>>'{summary,transactionCount}')::integer, 4,
  'completed sales include legacy rows, not voided orders')
from fiscal_report_test_result;
select is((report#>>'{summary,voidedTransactionCount}')::integer, 1,
  'void count is reported separately')
from fiscal_report_test_result;
select is((report#>>'{summary,missingSnapshotCount}')::integer, 1,
  'missing fiscal snapshot is disclosed')
from fiscal_report_test_result;
select is((report#>>'{summary,netAmountMillimes}')::bigint, 8325::bigint,
  'completed snapshot HT reconciles across inclusive and exclusive prices')
from fiscal_report_test_result;
select is((report#>>'{summary,vatAmountMillimes}')::bigint, 885::bigint,
  'completed VAT reconciles at 19 and 7 percent')
from fiscal_report_test_result;
select is((report#>>'{summary,grossAmountMillimes}')::bigint, 9210::bigint,
  'completed snapshot TTC excludes voids and missing snapshots')
from fiscal_report_test_result;
select is(report#>>'{summary,reconciliationValid}', 'true',
  'HT plus tax reconciles to TTC')
from fiscal_report_test_result;
select is((select (line->>'taxableHTMillimes')::bigint
  from fiscal_report_test_result, jsonb_array_elements(report->'vatBreakdown') line
  where line->>'ratePpm' = '190000'), 2521::bigint,
  '19 percent taxable base matches the immutable inclusive snapshot');
select is((select (line->>'vatMillimes')::bigint
  from fiscal_report_test_result, jsonb_array_elements(report->'vatBreakdown') line
  where line->>'ratePpm' = '190000'), 479::bigint,
  '19 percent VAT amount matches the immutable inclusive snapshot');
select is((select (line->>'taxableHTMillimes')::bigint
  from fiscal_report_test_result, jsonb_array_elements(report->'vatBreakdown') line
  where line->>'ratePpm' = '70000'), 5804::bigint,
  '7 percent inclusive and exclusive bases aggregate correctly');
select is((select (line->>'vatMillimes')::bigint
  from fiscal_report_test_result, jsonb_array_elements(report->'vatBreakdown') line
  where line->>'ratePpm' = '70000'), 406::bigint,
  '7 percent inclusive and exclusive VAT reconciles');
select is((report#>>'{payments,sales,cash}')::bigint, 3000::bigint,
  'voided cash is excluded from sales payment totals')
from fiscal_report_test_result;
select is((report#>>'{payments,sales,card}')::bigint, 3000::bigint,
  'card sales total matches completed orders')
from fiscal_report_test_result;
select is((report#>>'{payments,sales,other}')::bigint, 3210::bigint,
  'other payment total matches exclusive-price order')
from fiscal_report_test_result;
select is((report#>>'{payments,sales,tab}')::bigint, 900::bigint,
  'unpaid tab sales are shown separately')
from fiscal_report_test_result;
select is((report#>>'{payments,collected,tab}')::bigint, 0::bigint,
  'unpaid tab balance is not treated as collected')
from fiscal_report_test_result;
select is((report#>>'{adjustments,voidAdjustmentsTotalMillimes}')::bigint, 3000::bigint,
  'void adjustment is disclosed separately')
from fiscal_report_test_result;
select is((report#>>'{adjustments,cashMovementsNetMillimes}')::bigint, 250::bigint,
  'cash movements are reported independently from sales')
from fiscal_report_test_result;
select is(jsonb_array_length(report->'transactions'), 5,
  'report includes completed and voided transactions within the period')
from fiscal_report_test_result;
select is((select count(*)::integer from fiscal_report_test_result,
  jsonb_array_elements(report->'transactions') tx
  where (tx->>'number')::integer = 1), 1,
  'store-local start boundary is inclusive');
select is((select count(*)::integer from fiscal_report_test_result,
  jsonb_array_elements(report->'transactions') tx
  where (tx->>'number')::integer in (6, 7)), 0,
  'store-local exclusive end and prior-second boundaries are excluded');
select is((select tx->'items'->0->>'itemId'
  from fiscal_report_test_result, jsonb_array_elements(report->'transactions') tx
  where tx->>'number' = '1'),
  (select item_id::text from fiscal_report_test_context),
  'transaction items expose stable catalog identity for snapshot reconciliation');

select set_config('request.jwt.claim.sub', staff_id::text, true)
from fiscal_report_test_context;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', staff_id,
  'role', 'authenticated',
  'session_id', 'fiscal-report-test-' || replace(staff_id::text, '-', '')
)::text, true)
from fiscal_report_test_context;

select throws_ok(
  $$select public.get_fiscal_arbitrary_report(
    (select store_id from fiscal_report_test_context), '2026-03-01', '2026-03-02', 'Africa/Tunis')$$,
  '42501',
  'Only the store owner can access fiscal reports.',
  'staff cannot access owner fiscal reports'
);
select throws_ok(
  $$select public.list_fiscal_report_history(
    (select store_id from fiscal_report_test_context))$$,
  '42501',
  'Only the store owner can access fiscal report history.',
  'staff cannot access report history'
);

select set_config('request.jwt.claim.sub', owner_id::text, true)
from fiscal_report_test_context;
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', owner_id,
  'role', 'authenticated',
  'session_id', 'fiscal-report-test-' || replace(owner_id::text, '-', '')
)::text, true)
from fiscal_report_test_context;
select throws_ok(
  $$select public.get_fiscal_arbitrary_report(
    (select other_store_id from fiscal_report_test_context), '2026-03-01', '2026-03-02', 'Africa/Tunis')$$,
  '42501',
  'Only the store owner can access fiscal reports.',
  'owner cannot read another store fiscal report'
);

select public.save_fiscal_report_history(
  (select store_id from fiscal_report_test_context),
  '2026-03-01', '2026-03-02', 'Africa/Tunis', '{}'::jsonb,
  (select report from fiscal_report_test_result)
);
select is(jsonb_array_length(public.list_fiscal_report_history(
  (select store_id from fiscal_report_test_context))), 1,
  'owner can access own report history');
select throws_ok(
  $$select public.list_fiscal_report_history(
    (select other_store_id from fiscal_report_test_context))$$,
  '42501',
  'Only the store owner can access fiscal report history.',
  'report history cannot be accessed across stores'
);

select * from finish();
rollback;
