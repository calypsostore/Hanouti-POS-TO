-- Run against a migrated Supabase database with the postgres role.
-- Fixture data is rolled back after every assertion completes.
create extension if not exists pgtap;
select plan(1);

begin;

create temporary table shift_report_audit_context (
  store_id uuid primary key,
  owner_id uuid not null,
  staff_id uuid not null,
  session_id text not null,
  owner_session_id text not null,
  position_id uuid not null,
  category_id uuid not null,
  item_id uuid not null,
  customer_id uuid not null
) on commit drop;

insert into shift_report_audit_context
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()::text,
       gen_random_uuid()::text,
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
union all
select gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()::text,
       gen_random_uuid()::text,
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select owner_id, 'authenticated', 'authenticated',
       'shift-audit-owner-' || replace(store_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Shift audit owner"}'::jsonb, now(), now()
from shift_report_audit_context
union all
select staff_id, 'authenticated', 'authenticated',
       'shift-audit-staff-' || replace(store_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Shift audit staff"}'::jsonb, now(), now()
from shift_report_audit_context;

insert into public.stores (
  id, store_id, owner_id, code, name, admin_pin_hash, pin_must_change,
  allow_card_payments, allow_other_payments
)
select store_id, store_id, owner_id,
       'audit' || left(replace(store_id::text, '-', ''), 8),
       'Shift audit test store',
       extensions.crypt('1234', extensions.gen_salt('bf', 12)),
       false, true, true
from shift_report_audit_context;

insert into public.profiles (id, store_id, role, name, email, username, must_change_password, is_active)
select owner_id, store_id, 'owner', 'Shift audit owner',
       'shift-audit-owner-' || replace(store_id::text, '-', '') || '@example.invalid',
       'shift-audit-owner-' || left(replace(store_id::text, '-', ''), 8), false, true
from shift_report_audit_context;

insert into public.positions (id, store_id, name, permission_ids)
select position_id, store_id, 'Shift audit staff',
       array['open_close_shift', 'take_orders', 'cash_in_out', 'use_tabs',
         'settle_tabs', 'request_void', 'print_x_report']
from shift_report_audit_context;

insert into public.profiles (
  id, store_id, role, name, email, username, position_id,
  must_change_password, is_active, session_version, must_set_pin
)
select staff_id, store_id, 'staff', 'Shift audit staff',
       'shift-audit-staff-' || replace(store_id::text, '-', '') || '@example.invalid',
       'shift-audit-staff-' || left(replace(store_id::text, '-', ''), 8),
       position_id, false, true, 0, false
from shift_report_audit_context;

insert into public.auth_sessions (session_id, user_id, session_version, expires_at)
select session_id, staff_id, 0, now() + interval '1 hour'
from shift_report_audit_context;

insert into public.auth_sessions (session_id, user_id, session_version, expires_at)
select context.owner_session_id, context.owner_id, owner.session_version,
       now() + interval '1 hour'
from shift_report_audit_context context
join public.profiles owner on owner.id = context.owner_id;

insert into public.categories (id, store_id, name)
select category_id, store_id, 'Shift audit category'
from shift_report_audit_context;

insert into public.catalog_items (id, store_id, category_id, name, price_millimes, stock_count)
select item_id, store_id, category_id, 'Shift audit item', 1000, 100
from shift_report_audit_context;

insert into public.customers (id, store_id, name)
select customer_id, store_id, 'Shift audit customer'
from shift_report_audit_context;

create function pg_temp.shift_audit_order_items(p_item_id uuid)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'itemId', p_item_id,
    'quantity', 1,
    'modifiers', '[]'::jsonb
  ))
$$;

create function pg_temp.shift_audit_z_snapshot(
  p_store_id uuid,
  p_counted_cash bigint,
  p_note text default null,
  p_counted_card bigint default 0,
  p_counted_other bigint default 0
)
returns jsonb
language plpgsql
as $$
declare
  v_business_date date;
  v_period_from timestamptz;
  v_period_to timestamptz := now();
  v_order_count integer;
  v_sales bigint;
  v_split jsonb;
  v_cash_tab bigint;
  v_card_tab bigint;
  v_other_tab bigint;
  v_cash_refunds bigint;
  v_sales_collected bigint;
  v_receivable bigint;
  v_tabs_outstanding bigint;
  v_tabs_issued bigint;
  v_void_count integer;
  v_void_total bigint;
  v_pending_count integer;
  v_pending_total bigint;
  v_shift_lines jsonb;
  v_expected_cash bigint;
  v_cash_float bigint;
  v_total_counted bigint;
  v_total_difference bigint;
  v_expected_card bigint;
  v_expected_other bigint;
begin
  v_business_date := public.get_current_business_date(p_store_id);
  select min(shift.opened_at)
  into v_period_from
  from public.shifts shift
  where shift.store_id = p_store_id
    and shift.opened_at > coalesce(
      public.get_last_z_report_boundary(p_store_id),
      '-infinity'::timestamptz
    )
    and shift.opened_at <= v_period_to
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );

  select count(*)::integer,
         coalesce(sum(order_record.total_millimes), 0)::bigint,
         jsonb_build_object(
           'cash', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'cash'), 0),
           'card', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'card'), 0),
           'other', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'other'), 0),
           'tab', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'tab'), 0)
         )
  into v_order_count, v_sales, v_split
  from public.orders order_record
  where order_record.store_id = p_store_id and order_record.status = 'done'
    and order_record.created_at between v_period_from and v_period_to;

  select coalesce(sum(order_record.total_millimes), 0)::bigint
  into v_tabs_issued
  from public.orders order_record
  where order_record.store_id = p_store_id and order_record.status = 'done'
    and order_record.payment_method = 'tab'
    and order_record.created_at between v_period_from and v_period_to;

  select
    coalesce(sum(tab.amount_millimes) filter (where tab.payment_method = 'cash' and tab.kind = 'settled'), 0)
      - coalesce(sum(tab.amount_millimes) filter (where tab.payment_method = 'cash' and tab.kind = 'reversal'), 0),
    coalesce(sum(tab.amount_millimes) filter (where tab.payment_method = 'card' and tab.kind = 'settled'), 0)
      - coalesce(sum(tab.amount_millimes) filter (where tab.payment_method = 'card' and tab.kind = 'reversal'), 0),
    coalesce(sum(tab.amount_millimes) filter (where tab.payment_method = 'other' and tab.kind = 'settled'), 0)
      - coalesce(sum(tab.amount_millimes) filter (where tab.payment_method = 'other' and tab.kind = 'reversal'), 0)
  into v_cash_tab, v_card_tab, v_other_tab
  from public.tabs tab
  where tab.store_id = p_store_id and tab.kind in ('settled', 'reversal')
    and tab.created_at between v_period_from and v_period_to;
  v_sales_collected := (v_split->>'cash')::bigint + (v_split->>'card')::bigint
    + (v_split->>'other')::bigint + v_cash_tab + v_card_tab + v_other_tab;
  v_expected_card := (v_split->>'card')::bigint + v_card_tab;
  v_expected_other := (v_split->>'other')::bigint + v_other_tab;

  select coalesce(sum(customer_balance.balance), 0)::bigint,
         coalesce(sum(greatest(customer_balance.balance, 0)), 0)::bigint
  into v_tabs_outstanding, v_receivable
  from (
    select customer.id,
      coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.customer_id = customer.id
          and order_record.payment_method = 'tab'
          and order_record.status = 'done'
          and order_record.created_at <= v_period_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'issued'
          and tab.order_id is null and tab.created_at <= v_period_to
      ), 0) - coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'settled'
          and tab.created_at <= v_period_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'reversal'
          and tab.created_at <= v_period_to
      ), 0) as balance
    from public.customers customer
    where customer.store_id = p_store_id
  ) customer_balance;

  select coalesce(sum(tab.amount_millimes), 0)::bigint
  into v_cash_refunds
  from public.tabs tab
  where tab.store_id = p_store_id and tab.kind = 'reversal'
    and tab.payment_method = 'cash'
    and tab.created_at between v_period_from and v_period_to;
  v_cash_refunds := coalesce(v_cash_refunds, 0);

  select count(*)::integer, coalesce(sum(order_record.total_millimes), 0)::bigint
  into v_void_count, v_void_total
  from public.orders order_record
  where order_record.store_id = p_store_id and order_record.status = 'voided'
    and order_record.voided_at between v_period_from and v_period_to;
  select count(*)::integer, coalesce(sum(order_record.total_millimes), 0)::bigint
  into v_pending_count, v_pending_total
  from public.orders order_record
  where order_record.store_id = p_store_id and order_record.status = 'pending_void';

  select coalesce(jsonb_agg(jsonb_build_object(
           'shiftId', shift.id,
           'startingCashMillimes', shift.starting_cash_millimes,
           'forceClosedByOwner', shift.force_closed_by_owner
         ) order by shift.opened_at), '[]'::jsonb),
         coalesce(sum(public.get_shift_expected_cash(shift.id)), 0)::bigint,
         coalesce(sum(shift.starting_cash_millimes), 0)::bigint,
         coalesce(sum(shift.counted_cash_millimes) filter (where shift.status = 'closed'), 0)::bigint,
         coalesce(sum(
           shift.counted_cash_millimes - shift.expected_cash_millimes
           - coalesce((select sum(adjustment.amount_millimes)
             from public.shift_void_adjustments adjustment
             where adjustment.shift_id = shift.id
               and adjustment.created_at between v_period_from and v_period_to), 0)
         ) filter (where shift.status = 'closed'), 0)::bigint
  into v_shift_lines, v_expected_cash, v_cash_float, v_total_counted, v_total_difference
  from public.shifts shift
  where shift.store_id = p_store_id and shift.opened_at between v_period_from and v_period_to;
  v_expected_cash := v_expected_cash - v_cash_refunds;

  return jsonb_build_object(
    'type', 'Z',
    'businessDate', v_business_date,
    'createdAt', v_period_to,
    'periodFrom', v_period_from,
    'periodTo', v_period_to,
    'reportNumber', 'Z-000001',
    'orderCount', v_order_count,
    'salesMillimes', v_sales,
    'salesCollectedMillimes', v_sales_collected,
    'expensesMillimes', 0,
    'receivableMillimes', v_receivable,
    'paymentSplit', v_split,
    'voids', jsonb_build_object('count', v_void_count, 'totalMillimes', v_void_total, 'orders', '[]'::jsonb),
    'pendingVoids', jsonb_build_object('count', v_pending_count, 'totalMillimes', v_pending_total, 'orders', '[]'::jsonb),
    'comps', jsonb_build_object('count', 0, 'quantity', 0, 'totalMillimes', 0, 'records', '[]'::jsonb),
    'tabsIssuedMillimes', v_tabs_issued,
    'tabsOutstandingMillimes', v_tabs_outstanding,
    'tabsSettledMillimes', v_cash_tab,
    'tabPaymentsReceivedMillimes', v_cash_tab,
    'nonCashTabPaymentsMillimes', v_card_tab + v_other_tab,
    'cashInMillimes', 0,
    'cashOutMillimes', 0,
    'cashRefundsMillimes', v_cash_refunds,
    'shifts', v_shift_lines,
    'totalExpectedCashMillimes', v_expected_cash,
    'cashFloatMillimes', v_cash_float,
    'expectedCashExFloatMillimes', v_expected_cash - v_cash_float,
    'totalCountedMillimes', v_total_counted,
    'totalDifferenceMillimes', v_total_difference,
    'countedCashMillimes', p_counted_cash,
    'countedCashIncludesFloat', false,
    'cashDifferenceMillimes', p_counted_cash - (v_expected_cash - v_cash_float),
    'cashDifferenceNote', p_note,
    'countedCardMillimes', p_counted_card,
    'expectedCardMillimes', v_expected_card,
    'cardDifferenceMillimes', p_counted_card - v_expected_card,
    'countedOtherMillimes', p_counted_other,
    'expectedOtherMillimes', v_expected_other,
    'otherDifferenceMillimes', p_counted_other - v_expected_other
  );
end
$$;

do $$
declare
  flow record;
  report_store record;
  v_staff_shift uuid;
  v_same_shift uuid;
  v_owner_shift uuid;
  v_minus_shift uuid;
  v_force_shift uuid;
  v_z_shift uuid;
  v_next_z_shift uuid;
  v_order_cash uuid;
  v_order_card uuid;
  v_order_other uuid;
  v_order_tab uuid;
  v_order_approve uuid;
  v_order_force uuid;
  v_pending_order uuid;
  v_next_z_order uuid;
  v_pin_void_order uuid;
  v_tab_payment uuid;
  v_post_close_payment uuid;
  v_period_from timestamptz;
  v_expected bigint;
  v_result jsonb;
  v_z_report public.reports%rowtype;
  v_next_z_report public.reports%rowtype;
  v_snapshot jsonb;
  v_next_business_date date;
  v_day_status jsonb;
  v_record_report_definition text;
  v_lock_position integer;
  v_boundary_position integer;
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'period_from')
      is distinct from 'timestamp with time zone'
    or (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'period_to')
      is distinct from 'timestamp with time zone'
    or (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'stores' and column_name = 'day_closed_on')
      is distinct from 'date' then
    raise exception 'Report boundaries must preserve timestamps while store day_closed_on remains a date.';
  end if;
  v_record_report_definition := pg_get_functiondef('public.record_report(jsonb,text)'::regprocedure);
  v_lock_position := strpos(v_record_report_definition, '  for update;');
  v_boundary_position := strpos(
    v_record_report_definition,
    'previous_z_at := public.get_last_z_report_boundary'
  );
  if v_lock_position = 0 or v_boundary_position = 0 or v_lock_position >= v_boundary_position
    or not exists (
      select 1
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conrelid = 'public.z_reported_shifts'::regclass
        and constraint_record.contype = 'p'
        and pg_catalog.pg_get_constraintdef(constraint_record.oid)
          = 'PRIMARY KEY (store_id, shift_id)'
    ) then
    raise exception 'Z submissions must lock the store before boundary checks and retain unique shift claims.';
  end if;

  select * into flow
  from shift_report_audit_context
  order by store_id
  limit 1;
  select * into report_store
  from shift_report_audit_context
  where store_id <> flow.store_id
  limit 1;

  perform set_config('request.jwt.claim.sub', flow.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.staff_id, 'role', 'authenticated', 'session_id', flow.session_id
  )::text, true);
  v_staff_shift := (public.open_shift(5000)).id;
  perform public.record_cash_movement(v_staff_shift, 'in', 200, 'change', null);
  perform public.record_cash_movement(v_staff_shift, 'out', 100, 'expense', null);
  v_order_cash := (public.create_order(
    v_staff_shift, pg_temp.shift_audit_order_items(flow.item_id), 'cash'
  )->'order'->>'id')::uuid;
  v_order_card := (public.create_order(
    v_staff_shift, pg_temp.shift_audit_order_items(flow.item_id), 'card'
  )->'order'->>'id')::uuid;
  v_order_tab := (public.create_order(
    v_staff_shift, pg_temp.shift_audit_order_items(flow.item_id), 'tab', flow.customer_id
  )->'order'->>'id')::uuid;
  perform public.settle_customer_tab(flow.customer_id, 500, v_staff_shift, 'cash', 'Audit settlement');
  v_tab_payment := (public.settle_customer_tab(
    flow.customer_id, 100, v_staff_shift, 'cash', 'Same-shift test settlement'
  )).id;
  perform set_config('request.jwt.claim.sub', flow.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.owner_id, 'role', 'authenticated', 'session_id', flow.owner_session_id
  )::text, true);
  perform public.reverse_tab_payment(v_tab_payment, '1234', 'Same-shift test reversal');
  begin
    perform public.reverse_tab_payment(v_tab_payment, '1234', 'Repeated reversal attempt');
    raise exception 'Repeated reversal attempt unexpectedly succeeded.';
  exception
    when others then
      if SQLERRM <> 'This payment has already been reversed.' then
        raise;
      end if;
  end;
  perform set_config('request.jwt.claim.sub', flow.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.staff_id, 'role', 'authenticated', 'session_id', flow.session_id
  )::text, true);
  v_tab_payment := (public.settle_customer_tab(
    flow.customer_id, 100, v_staff_shift, 'cash', 'Same-shift snapshot settlement'
  )).id;
  perform set_config('request.jwt.claim.sub', flow.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.owner_id, 'role', 'authenticated', 'session_id', flow.owner_session_id
  )::text, true);
  perform public.reverse_tab_payment(v_tab_payment, '1234', 'Same-shift snapshot reversal');
  perform set_config('request.jwt.claim.sub', flow.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.staff_id, 'role', 'authenticated', 'session_id', flow.session_id
  )::text, true);
  if public.get_shift_expected_cash(v_staff_shift) <> 6600 then
    raise exception 'Cash expected must include float, cash sales, cash tab payments, cash in, and cash out.';
  end if;
  v_result := public.get_shift_summary(v_staff_shift);
  if (v_result->>'expectedCashMillimes')::bigint <> 6600
    or (v_result->>'cashFlowExFloatMillimes')::bigint <> 1600
    or (v_result->>'tabPaymentsMillimes')::bigint <> 500
    or (v_result->>'cardTabPaymentsMillimes')::bigint <> 0
    or (v_result->>'otherTabPaymentsMillimes')::bigint <> 0 then
    raise exception 'Open shift summary did not reconcile attributed cash and non-cash tab payments.';
  end if;
  if (select count(*) from public.orders where id = any(array[v_order_cash, v_order_card, v_order_tab])) <> 3 then
    raise exception 'Cash, card, and tab sales were not recorded.';
  end if;
  if not exists (
    select 1 from public.tabs
    where id = v_tab_payment
      and customer_id = flow.customer_id
      and kind = 'settled'
  ) then
    raise exception 'Cash tab settlement was not recorded.';
  end if;

  perform public.request_order_void(v_order_cash, 'Test rejection after close');
  if public.get_shift_expected_cash(v_staff_shift) <> 5600 then
    raise exception 'A pending void must be treated as voided for cash until rejected.';
  end if;
  if (select stock_count from public.catalog_items where id = flow.item_id) <> 97 then
    raise exception 'Stock must remain held, not restored, while a void is pending.';
  end if;
  perform public.close_shift(v_staff_shift, 5700, 'One hundred millimes over.');
  v_same_shift := v_staff_shift;
  if not exists (
    select 1
    from public.shift_reversal_snapshots snapshot
    join public.tabs reversal on reversal.id = snapshot.reversal_id
    where snapshot.shift_id = v_staff_shift
      and reversal.reverses_tab_id = v_tab_payment
      and reversal.kind = 'reversal'
  ) then
    raise exception 'Same-shift reversal was not captured in the close snapshot.';
  end if;
  if (
    select count(*)
    from public.shift_reversal_snapshots snapshot
    join public.tabs reversal on reversal.id = snapshot.reversal_id
    where snapshot.shift_id = v_staff_shift
      and reversal.kind = 'reversal'
      and reversal.reversal_attribution = 'same_shift'
  ) <> 2 then
    raise exception 'Every pre-close same-shift reversal must be captured at shift close.';
  end if;
  perform set_config('request.jwt.claim.sub', flow.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.owner_id, 'role', 'authenticated', 'session_id', flow.owner_session_id
  )::text, true);
  perform public.resolve_order_void(v_order_cash, 'reject', '', '');
  if public.get_shift_expected_cash(v_staff_shift) <> 6600 then
    raise exception 'Rejecting a void after shift close must restore its cash ledger.';
  end if;
  if (select stock_count from public.catalog_items where id = flow.item_id) <> 97 then
    raise exception 'Rejecting a held-stock void must not deduct stock a second time.';
  end if;

  perform set_config('request.jwt.claim.sub', flow.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.staff_id, 'role', 'authenticated', 'session_id', flow.session_id
  )::text, true);
  v_staff_shift := (public.open_shift(0)).id;
  v_order_approve := (public.create_order(
    v_staff_shift, pg_temp.shift_audit_order_items(flow.item_id), 'cash'
  )->'order'->>'id')::uuid;
  perform public.request_order_void(v_order_approve, 'Test approval');
  perform set_config('request.jwt.claim.sub', flow.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.owner_id, 'role', 'authenticated', 'session_id', flow.owner_session_id
  )::text, true);
  perform public.resolve_order_void(v_order_approve, 'approve', 'Approved test void', '');
  if (select status from public.orders where id = v_order_approve) <> 'voided' then
    raise exception 'Owner approval did not void the order.';
  end if;
  if (select stock_count from public.catalog_items where id = flow.item_id) <> 97 then
    raise exception 'Approving a pending void must release its held stock.';
  end if;
  perform set_config('request.jwt.claim.sub', flow.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.staff_id, 'role', 'authenticated', 'session_id', flow.session_id
  )::text, true);
  perform public.close_shift(v_staff_shift, 0, null);

  perform set_config('request.jwt.claim.sub', flow.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.owner_id, 'role', 'authenticated', 'session_id', flow.owner_session_id
  )::text, true);
  v_owner_shift := (public.open_shift(3000)).id;
  select id into v_post_close_payment
  from public.tabs
  where customer_id = flow.customer_id
    and kind = 'settled'
    and note = 'Audit settlement';
  if v_post_close_payment is null then
    raise exception 'The original cash tab settlement was not available for post-close testing.';
  end if;
  perform public.reverse_tab_payment(v_post_close_payment, '1234', 'Post-close test reversal');
  if not exists (
    select 1
    from public.tabs reversal
    where reversal.reverses_tab_id = v_post_close_payment
      and reversal.shift_id = v_owner_shift
      and reversal.kind = 'reversal'
      and reversal.reversal_attribution = 'post_close'
  ) then
    raise exception 'A post-close reversal was not attributed to the later open shift.';
  end if;
  if public.get_shift_expected_cash(v_same_shift) <> 6600
    or public.get_shift_expected_cash(v_owner_shift) <> 2500 then
    raise exception 'A post-close reversal must reduce only the later shift cash ledger.';
  end if;
  v_result := public.get_shift_summary(v_owner_shift);
  if (v_result->>'expectedCashMillimes')::bigint <> 2500
    or (v_result->>'tabPaymentsMillimes')::bigint <> -500 then
    raise exception 'The later shift summary did not include its post-close reversal exactly once.';
  end if;
  select opened_at into v_period_from from public.shifts where id = v_same_shift;
  v_result := public.get_reversal_ledger(flow.store_id, v_period_from, now());
  if (v_result->>'cashVerifiedNetMillimes')::bigint <> 0
    or (v_result->>'cashPostCloseReversalMillimes')::bigint <> 500
    or jsonb_array_length(v_result->'unresolvedTabReversals') <> 0 then
    raise exception 'The post-close reversal was not accounted for once in the verified period ledger.';
  end if;
  v_result := public.get_dashboard_summary(flow.store_id, v_period_from, now(), true);
  if (v_result->>'cashRefundsMillimes')::bigint <> 500
    or (v_result->>'totalExpectedCashMillimes')::bigint <> (
      select coalesce(sum((line->>'expectedCashMillimes')::bigint), 0)
      from jsonb_array_elements(v_result->'shiftLines') line
    ) then
    raise exception 'The dashboard deducted the post-close reversal more than once.';
  end if;
  v_result := public.close_shift(v_owner_shift, 2500, null);
  if v_result->'shift'->>'difference_millimes' <> '0' then
    raise exception 'An owner-opened zero-difference shift did not close at zero.';
  end if;

  perform set_config('request.jwt.claim.sub', flow.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.staff_id, 'role', 'authenticated', 'session_id', flow.session_id
  )::text, true);
  v_minus_shift := (public.open_shift(0)).id;
  perform public.create_order(v_minus_shift, pg_temp.shift_audit_order_items(flow.item_id), 'cash');
  v_result := public.close_shift(v_minus_shift, 900, 'One hundred millimes short.');
  if v_result->'shift'->>'difference_millimes' <> '-100' then
    raise exception 'A negative shift difference was not recorded.';
  end if;

  v_force_shift := (public.open_shift(1000)).id;
  v_order_force := (public.create_order(
    v_force_shift, pg_temp.shift_audit_order_items(flow.item_id), 'cash'
  )->'order'->>'id')::uuid;
  perform public.request_order_void(v_order_force, 'Auto-approval at force close');
  perform set_config('request.jwt.claim.sub', flow.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', flow.owner_id, 'role', 'authenticated', 'session_id', flow.owner_session_id
  )::text, true);
  v_result := public.force_close_shift(v_force_shift, '1234');
  if v_result->'shift'->>'difference_millimes' <> '0'
    or v_result->>'voidsAutoApprovedCount' <> '1'
    or (select status from public.orders where id = v_order_force) <> 'voided' then
    raise exception 'Force-close shift must approve pending voids and close at zero difference.';
  end if;

  perform set_config('request.jwt.claim.sub', report_store.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', report_store.staff_id, 'role', 'authenticated', 'session_id', report_store.session_id
  )::text, true);
  v_z_shift := (public.open_shift(0)).id;
  v_pin_void_order := (public.create_order(
    v_z_shift, pg_temp.shift_audit_order_items(report_store.item_id), 'cash'
  )->'order'->>'id')::uuid;
  v_order_tab := (public.create_order(
    v_z_shift, pg_temp.shift_audit_order_items(report_store.item_id), 'tab', report_store.customer_id
  )->'order'->>'id')::uuid;
  v_order_card := (public.create_order(
    v_z_shift, pg_temp.shift_audit_order_items(report_store.item_id), 'card'
  )->'order'->>'id')::uuid;
  v_order_other := (public.create_order(
    v_z_shift, pg_temp.shift_audit_order_items(report_store.item_id), 'other'
  )->'order'->>'id')::uuid;
  v_tab_payment := (public.settle_customer_tab(
    report_store.customer_id, 500, v_z_shift, 'cash', 'Closed-shift reversal test'
  )).id;
  perform public.settle_customer_tab(report_store.customer_id, 100, v_z_shift, 'card', 'Card tab payment');
  perform public.settle_customer_tab(report_store.customer_id, 200, v_z_shift, 'other', 'Other tab payment');
  perform public.request_order_void(v_pin_void_order, 'Void after review');
  perform set_config('request.jwt.claim.sub', report_store.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', report_store.owner_id, 'role', 'authenticated',
    'session_id', report_store.owner_session_id
  )::text, true);

  v_snapshot := pg_temp.shift_audit_z_snapshot(report_store.store_id, 0, null);
  begin
    perform public.record_report(v_snapshot, '1234');
    raise exception 'Z unexpectedly succeeded while a void was pending.';
  exception when others then
    if position('Resolve every void request before creating a Z report.' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  if public.get_shift_expected_cash(v_z_shift) <> 500 then
    raise exception 'Pending-void cash must be excluded while settled tab cash remains expected.';
  end if;
  perform public.resolve_order_void(v_pin_void_order, 'reject', '', '');
  if (select stock_count from public.catalog_items where id = report_store.item_id) <> 96 then
    raise exception 'Rejecting a pending void must leave its stock deducted only once.';
  end if;
  v_snapshot := pg_temp.shift_audit_z_snapshot(report_store.store_id, 1000, null);
  begin
    perform public.record_report(v_snapshot, '1234');
    raise exception 'Z unexpectedly succeeded while a shift was open.';
  exception when others then
    if position('Force-close or close every shift before creating a Z report.' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  perform set_config('request.jwt.claim.sub', report_store.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', report_store.staff_id, 'role', 'authenticated', 'session_id', report_store.session_id
  )::text, true);
  perform public.close_shift(v_z_shift, 1500, null);
  perform set_config('request.jwt.claim.sub', report_store.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', report_store.owner_id, 'role', 'authenticated',
    'session_id', report_store.owner_session_id
  )::text, true);
  perform public.void_order_with_pin(v_pin_void_order, 'PIN void on closed shift', '1234');
  if public.get_shift_expected_cash(v_z_shift) <> 500
    or not exists (
      select 1 from public.shift_void_adjustments adjustment
      where adjustment.shift_id = v_z_shift
        and adjustment.order_id = v_pin_void_order
        and adjustment.kind = 'approved'
        and adjustment.amount_millimes = -1000
    ) then
    raise exception 'Closed-shift PIN void did not reconcile its approved adjustment.';
  end if;
  if position(
    'on conflict (shift_id, order_id) do'
    in pg_catalog.pg_get_functiondef('public.void_order_with_pin(uuid,text,text)'::regprocedure)
  ) > 0 then
    raise exception 'The active PIN-void function uses a stale conflict target.';
  end if;
  if (select stock_count from public.catalog_items where id = report_store.item_id) <> 97 then
    raise exception 'Approving a PIN void must restore the held stock.';
  end if;
  perform public.reverse_tab_payment(v_tab_payment, '1234', 'Cash reversal after shift close');
  if not exists (
    select 1 from public.tabs reversal
    where reversal.reverses_tab_id = v_tab_payment
      and reversal.shift_id = v_z_shift
      and reversal.kind = 'reversal'
      and reversal.payment_method = 'cash'
      and reversal.reversal_attribution = 'ambiguous'
  ) then
    raise exception 'A reversal after close without a later active shift must be marked ambiguous and exposed for reconciliation.';
  end if;
  select opened_at into v_period_from from public.shifts where id = v_z_shift;
  v_result := public.get_reversal_ledger(report_store.store_id, v_period_from, now());
  if (v_result->>'cashVerifiedNetMillimes')::bigint <> 500
    or (v_result->>'cashPostCloseReversalMillimes')::bigint <> 0
    or jsonb_array_length(v_result->'unresolvedTabReversals') <> 1 then
    raise exception 'An ambiguous reversal changed verified totals or was hidden from reconciliation.';
  end if;
  v_result := public.get_shift_summary(v_z_shift);
  if (v_result->>'expectedCashMillimes')::bigint <> 500
    or (v_result->>'tabPaymentsMillimes')::bigint <> 500
    or jsonb_array_length(v_result->'unresolvedTabReversals') <> 1 then
    raise exception 'An ambiguous reversal changed closed-shift totals or was hidden from reconciliation.';
  end if;

  perform set_config('request.jwt.claim.sub', report_store.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', report_store.staff_id, 'role', 'authenticated', 'session_id', report_store.session_id
  )::text, true);
  v_z_shift := (public.open_shift(500)).id;
  v_pending_order := (public.create_order(
    v_z_shift, pg_temp.shift_audit_order_items(report_store.item_id), 'cash'
  )->'order'->>'id')::uuid;
  perform public.request_order_void(v_pending_order, 'Force-close day approval');
  perform set_config('request.jwt.claim.sub', report_store.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', report_store.owner_id, 'role', 'authenticated',
    'session_id', report_store.owner_session_id
  )::text, true);
  perform public.force_close_day('1234');
  if exists (select 1 from public.shifts where store_id = report_store.store_id and status = 'open')
    or exists (select 1 from public.orders where store_id = report_store.store_id and status = 'pending_void')
    or exists (select 1 from public.shifts where id = v_z_shift
      and (difference_millimes <> 0 or not force_closed_by_owner or voids_auto_approved_count <> 1)) then
    raise exception 'Force-close day must approve pending voids and close all shifts at zero.';
  end if;
  if (select stock_count from public.catalog_items where id = report_store.item_id) <> 97 then
    raise exception 'Force-close day must restore stock for auto-approved voids.';
  end if;

  v_snapshot := pg_temp.shift_audit_z_snapshot(report_store.store_id, 0, null, 1100, 1200);
  begin
    perform public.record_report(v_snapshot, '1234');
    raise exception 'Z unexpectedly accepted an unresolved ambiguous reversal.';
  exception when others then
    if position('Z reconciliation unresolved:' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  delete from public.tabs reversal
  where reversal.reverses_tab_id = v_tab_payment
    and reversal.kind = 'reversal'
    and reversal.reversal_attribution = 'ambiguous';

  v_snapshot := pg_temp.shift_audit_z_snapshot(report_store.store_id, 0, null, 1100, 1200);
  v_snapshot := jsonb_set(v_snapshot, '{expectedCardMillimes}', '1'::jsonb, true);
  begin
    perform public.record_report(v_snapshot, '1234');
    raise exception 'Z unexpectedly accepted a client-provided expected card total.';
  exception when others then
    if position('Z counts are incomplete, require a note, or do not reconcile with the server ledger.' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  v_snapshot := pg_temp.shift_audit_z_snapshot(report_store.store_id, 0, null, 1, 0);
  begin
    perform public.record_report(v_snapshot, '1234');
    raise exception 'Z unexpectedly accepted a non-zero card difference without a note.';
  exception when others then
    if position('Z counts are incomplete, require a note, or do not reconcile with the server ledger.' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  -- now() is fixed for this transaction; keep later fixture events outside the immutable Z interval.
  update public.shifts
  set opened_at = opened_at - interval '2 seconds',
      closed_at = closed_at - interval '2 seconds'
  where store_id = report_store.store_id;
  update public.orders
  set created_at = created_at - interval '2 seconds',
      void_requested_at = void_requested_at - interval '2 seconds',
      voided_at = voided_at - interval '2 seconds'
  where store_id = report_store.store_id;
  update public.tabs
  set created_at = created_at - interval '2 seconds'
  where store_id = report_store.store_id;
  update public.cash_movements
  set created_at = created_at - interval '2 seconds'
  where store_id = report_store.store_id;
  update public.shift_void_adjustments
  set created_at = created_at - interval '2 seconds'
  where store_id = report_store.store_id;
  update public.comps
  set created_at = created_at - interval '2 seconds'
  where store_id = report_store.store_id;
  update public.expenses
  set created_at = created_at - interval '2 seconds'
  where store_id = report_store.store_id;
  v_snapshot := pg_temp.shift_audit_z_snapshot(report_store.store_id, 500, null, 1100, 1200);
  v_snapshot := jsonb_set(v_snapshot, '{periodTo}', to_jsonb(now() - interval '1 second'), true);
  v_snapshot := jsonb_set(v_snapshot, '{createdAt}', to_jsonb(now() - interval '1 second'), true);
  v_z_report := public.record_report(v_snapshot, '1234');
  if v_z_report.type <> 'Z'
    or v_z_report.cash_difference_millimes <> 0
    or (v_z_report.data->>'cashDifferenceMillimes')::bigint <> 0
    or (v_z_report.data->>'cashDifference')::bigint <> 0
    or v_z_report.z_number <> 1
    or (v_z_report.data->>'totalExpectedCashMillimes')::bigint <> 1000
    or (v_z_report.data->>'cashFloatMillimes')::bigint <> 500
    or (v_z_report.data->>'expectedCashExFloatMillimes')::bigint <> 500
    or (v_z_report.data->>'countedCashMillimes')::bigint <> 500
    or (v_z_report.data->>'countedCashIncludesFloat')::boolean is distinct from false
    or (v_z_report.data->>'totalDifferenceMillimes')::bigint <> 1000
    or (v_z_report.data->>'cashRefundsMillimes')::bigint <> 0
    or (v_z_report.data->>'expectedCardMillimes')::bigint <> 1100
    or (v_z_report.data->>'countedCardMillimes')::bigint <> 1100
    or (v_z_report.data->>'expectedOtherMillimes')::bigint <> 1200
    or (v_z_report.data->>'countedOtherMillimes')::bigint <> 1200
    or v_z_report.period_to is distinct from
      public.try_parse_z_report_timestamp(v_z_report.data->>'periodTo')
    or (select count(*) from public.z_reported_shifts
        where store_id = report_store.store_id and shift_id = v_z_shift) <> 1
    or not exists (
      select 1 from jsonb_array_elements(v_z_report.data->'shiftLines') line
      where (line->>'forceClosedByOwner')::boolean
        and (line->>'voidsAutoApprovedCount')::integer = 1
    ) then
    raise exception 'Z after force-close did not reconcile to the stored snapshot.';
  end if;
  if exists (
    with snapshot_shifts as (
      select
        report.store_id,
        report.id as report_id,
        report.created_at,
        case
          when line->>'shiftId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            then (line->>'shiftId')::uuid
          else null
        end as shift_id
      from public.reports report
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(report.data->'shiftLines') = 'array' then report.data->'shiftLines'
          when jsonb_typeof(report.data->'shifts') = 'array' then report.data->'shifts'
          else '[]'::jsonb
        end
      ) line
      where report.type = 'Z'
    ),
    ranked_shifts as (
      select snapshot_shifts.*,
        row_number() over (
          partition by snapshot_shifts.store_id, snapshot_shifts.shift_id
          order by snapshot_shifts.created_at, snapshot_shifts.report_id
        ) as assignment_order
      from snapshot_shifts
      join public.shifts shift
        on shift.id = snapshot_shifts.shift_id
        and shift.store_id = snapshot_shifts.store_id
      where snapshot_shifts.shift_id is not null
    )
    select 1
    from ranked_shifts ranked
    left join public.z_reported_shifts reported
      on reported.store_id = ranked.store_id
      and reported.shift_id = ranked.shift_id
    where ranked.assignment_order = 1
      and reported.report_id is distinct from ranked.report_id
  ) then
    raise exception 'Every historical Z shift must be claimed by its earliest report only.';
  end if;

  v_day_status := public.get_business_day_status(report_store.store_id);
  if v_day_status->>'dayIsClosed' is distinct from 'true'
    or v_day_status->>'hasActivity' is distinct from 'false' then
    raise exception 'Business-day status did not use the exact latest Z boundary.';
  end if;
  begin
    insert into public.z_reported_shifts (store_id, shift_id, report_id, reported_at)
    values (report_store.store_id, v_z_shift, v_z_report.id, now());
    raise exception 'A previously Z-reported shift was claimable again.';
  exception when unique_violation then
    null;
  end;

  begin
    update public.orders set note = 'mutated after Z' where id = v_pending_order;
    raise exception 'An order included in the Z report was unexpectedly mutable.';
  exception when others then
    if position('Orders included in a closed Z report are archived and cannot be changed.' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  begin
    update public.order_lines set quantity = quantity + 1 where order_id = v_pending_order;
    raise exception 'An order line included in the Z report was unexpectedly mutable.';
  exception when others then
    if position('Order lines included in a closed Z report are archived and cannot be changed.' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  begin
    perform public.record_report(v_snapshot, '1234');
    raise exception 'A second Z report was unexpectedly created for the closed business day.';
  exception when others then
    if position('The business day is closed. Open a new shift before creating another report.' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  begin
    update public.reports set data = data || '{"tampered":true}'::jsonb where id = v_z_report.id;
    raise exception 'Stored Z report was unexpectedly mutable.';
  exception when others then
    if position('Stored reports are immutable.' in sqlerrm) = 0
      and position('reports is append-only;' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  begin
    delete from public.reports where id = v_z_report.id;
    raise exception 'Stored Z report was unexpectedly deletable.';
  exception when others then
    if position('Stored reports are immutable.' in sqlerrm) = 0
      and position('reports is append-only;' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  if (select count(*) from public.reports where id = v_z_report.id) <> 1 then
    raise exception 'Reprinting the stored Z snapshot changed or removed its report.';
  end if;
  if (select data from public.reports where id = v_z_report.id) is distinct from v_z_report.data
    or exists (
      select 1 from pg_catalog.pg_policies
      where schemaname = 'public' and tablename = 'reports'
        and cmd in ('UPDATE', 'DELETE', 'ALL')
    ) then
    raise exception 'Reprinting changed the stored Z snapshot or report RLS permits mutation.';
  end if;

  perform set_config('request.jwt.claim.sub', report_store.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', report_store.staff_id, 'role', 'authenticated', 'session_id', report_store.session_id
  )::text, true);
  v_next_z_shift := (public.open_shift(0)).id;
  v_result := public.create_order(
    v_next_z_shift, pg_temp.shift_audit_order_items(report_store.item_id), 'cash'
  );
  v_next_z_order := (v_result->'order'->>'id')::uuid;
  perform public.close_shift(v_next_z_shift, 1000, null);
  perform set_config('request.jwt.claim.sub', report_store.owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', report_store.owner_id, 'role', 'authenticated',
    'session_id', report_store.owner_session_id
  )::text, true);
  v_day_status := public.get_business_day_status(report_store.store_id);
  if v_day_status->>'dayIsClosed' is distinct from 'false'
    or v_day_status->>'hasActivity' is distinct from 'true' then
    raise exception 'Business-day status did not recognize the newly opened shift.';
  end if;
  v_snapshot := pg_temp.shift_audit_z_snapshot(report_store.store_id, 1000, null, 0, 0);
  v_snapshot := jsonb_set(
    v_snapshot,
    '{shifts,0,shiftId}',
    '"malformed-shift-id"'::jsonb
  );
  begin
    perform public.record_report(v_snapshot, '1234');
    raise exception 'Z unexpectedly accepted a malformed shift UUID.';
  exception when others then
    if position('Report shift IDs must be valid UUIDs.' in sqlerrm) = 0 then
      raise;
    end if;
  end;
  v_snapshot := pg_temp.shift_audit_z_snapshot(report_store.store_id, 1000, null, 0, 0);
  v_next_z_report := public.record_report(v_snapshot, '1234');
  if v_next_z_report.z_number <> 2
    or v_next_z_report.sales_millimes <> 1000
    or (v_next_z_report.data->>'periodFrom')::timestamptz is distinct from (
      select opened_at from public.shifts where id = v_next_z_shift
    )
    or v_next_z_report.period_to is distinct from
      public.try_parse_z_report_timestamp(v_next_z_report.data->>'periodTo')
    or jsonb_array_length(v_next_z_report.data->'shiftLines') <> 1
    or (v_next_z_report.data->'shiftLines'->0->>'shiftId')::uuid <> v_next_z_shift
    or not exists (
      select 1 from public.orders where id = v_next_z_order
        and created_at between v_next_z_report.period_from and v_next_z_report.period_to
    ) then
    raise exception 'The second Z report did not isolate the newly opened shift period.';
  end if;
  v_z_report := v_next_z_report;

  select (public.get_last_z_report_boundary(report.store_id) at time zone store.timezone)::date + 1
  into v_next_business_date
  from public.reports report
  join public.stores store on store.store_id = report.store_id
  where report.id = v_z_report.id;
  perform set_config('request.jwt.claim.sub', report_store.staff_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', report_store.staff_id, 'role', 'authenticated', 'session_id', report_store.session_id
  )::text, true);
  v_z_shift := (public.open_shift(0)).id;
  update public.shifts set opened_at = (
    select public.get_last_z_report_boundary(report.store_id) + interval '1 day'
    from public.reports report where report.id = v_z_report.id
  ) where id = v_z_shift;
  if public.get_current_business_date(report_store.store_id) <> v_next_business_date
    or public.get_next_order_number() <> 1 then
    raise exception 'The next business day did not start a fresh ticket counter.';
  end if;
  alter table public.orders alter column created_at set default clock_timestamp();
  v_result := public.create_order(
    v_z_shift, pg_temp.shift_audit_order_items(report_store.item_id), 'cash'
  );
  alter table public.orders alter column created_at set default now();
  if (v_result->'order'->>'number')::integer <> 1
    or (v_result->'order'->>'business_date')::date <> v_next_business_date then
    raise exception 'Overnight order date or ticket counter does not match the business day.';
  end if;
end
$$;

select pass('shift, reversal, and Z-report audit assertions completed');
select * from finish();

rollback;
