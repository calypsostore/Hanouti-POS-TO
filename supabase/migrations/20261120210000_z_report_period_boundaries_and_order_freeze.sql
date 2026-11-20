alter table public.expenses add column if not exists created_at timestamptz;
alter table public.expenses alter column created_at set default now();

create or replace function public.reject_archived_z_order_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.reports report
    where report.store_id = old.store_id
      and report.type = 'Z'
      and old.created_at between report.period_from and report.period_to
  ) then
    raise exception 'Orders included in a closed Z report are archived and cannot be changed.'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create or replace function public.reject_archived_z_order_line_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order_ids uuid[];
begin
  if tg_op = 'DELETE' then
    target_order_ids := array[old.order_id];
  elsif tg_op = 'INSERT' then
    target_order_ids := array[new.order_id];
  else
    target_order_ids := array[old.order_id, new.order_id];
  end if;

  if exists (
    select 1
    from public.orders order_record
    join public.reports report
      on report.store_id = order_record.store_id
      and report.type = 'Z'
      and order_record.created_at between report.period_from and report.period_to
    where order_record.id = any(target_order_ids)
  ) then
    raise exception 'Order lines included in a closed Z report are archived and cannot be changed.'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

drop trigger if exists archived_z_order_mutation on public.orders;
create trigger archived_z_order_mutation
before update or delete on public.orders
for each row execute function public.reject_archived_z_order_mutation();

drop trigger if exists archived_z_order_line_mutation on public.order_lines;
create trigger archived_z_order_line_mutation
before insert or update or delete on public.order_lines
for each row execute function public.reject_archived_z_order_line_mutation();

revoke all on function public.reject_archived_z_order_mutation() from public, anon, authenticated;
revoke all on function public.reject_archived_z_order_line_mutation() from public, anon, authenticated;

create or replace function public.record_report(p_report jsonb, p_pin text default null)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target_store public.stores%rowtype;
  report_type text;
  business_day date;
  assigned_z_number integer;
  result public.reports%rowtype;
  report_data jsonb := p_report;
  previous_z_at timestamptz;
  expected_period_from timestamptz;
  period_from timestamptz;
  period_to timestamptz;
  report_created_at timestamptz;
  server_order_count integer;
  server_sales bigint;
  server_payment_split jsonb;
  server_sales_collected bigint;
  server_expenses bigint;
  server_receivable bigint;
  server_tabs_outstanding bigint;
  server_tabs_issued bigint;
  server_cash_tab_payments bigint;
  server_card_tab_payments bigint;
  server_other_tab_payments bigint;
  server_non_cash_tab_payments bigint;
  server_cash_in bigint;
  server_cash_out bigint;
  server_void_count integer;
  server_void_total bigint;
  server_pending_count integer;
  server_pending_total bigint;
  server_comp_count integer;
  server_comp_quantity integer;
  server_comp_total bigint;
  server_expected_cash bigint;
  server_cash_float bigint;
  server_cash_refunds bigint;
  expected_cash_ex_float bigint;
  server_total_counted bigint;
  server_total_difference bigint;
  counted_cash bigint;
  cash_difference bigint;
  counted_card bigint;
  expected_card bigint;
  card_difference bigint;
  counted_other bigint;
  expected_other bigint;
  other_difference bigint;
  shift_count integer;
  server_shift_lines jsonb;
  server_voids jsonb;
  server_pending_voids jsonb;
  server_comps jsonb;
  server_expense_details jsonb;
  server_customer_tabs jsonb;
  first_ticket integer;
  last_ticket integer;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active;
  select * into target_store
  from public.stores
  where store_id = actor.store_id
  for update;
  if actor.id is null or actor.role <> 'owner' or target_store.store_id is null then
    raise exception 'Only this store owner can record reports.' using errcode = '42501';
  end if;

  report_type := nullif(p_report->>'type', '');
  business_day := public.get_current_business_date(target_store.store_id);
  period_from := nullif(p_report->>'periodFrom', 'null')::timestamptz;
  period_to := nullif(p_report->>'periodTo', 'null')::timestamptz;
  report_created_at := nullif(p_report->>'createdAt', 'null')::timestamptz;
  if report_type not in ('X', 'Z')
    or period_from is null or period_to is null or report_created_at is null
    or period_from > period_to or period_to is distinct from report_created_at
    or period_to < now() - interval '5 minutes'
    or period_to > now() + interval '30 seconds' then
    raise exception 'Report details or period are invalid.';
  end if;

  select coalesce(report.period_to, report.created_at)
  into previous_z_at
  from public.reports report
  where report.store_id = target_store.store_id and report.type = 'Z'
  order by report.created_at desc
  limit 1;
  if not exists (
    select 1 from public.shifts shift
    where shift.store_id = target_store.store_id
      and (previous_z_at is null or shift.opened_at > previous_z_at)
  ) then
    raise exception 'The business day is closed. Open a new shift before creating another report.';
  end if;
  select min(shift.opened_at)
  into expected_period_from
  from public.shifts shift
  where shift.store_id = target_store.store_id
    and (previous_z_at is null or shift.opened_at > previous_z_at);
  if period_from is distinct from expected_period_from then
    raise exception 'Report period must begin when the first shift after the previous Z opens.';
  end if;

  select count(*)::integer,
    coalesce(sum(order_record.total_millimes), 0)::bigint,
    jsonb_build_object(
      'cash', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'cash'), 0),
      'card', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'card'), 0),
      'other', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'other'), 0),
      'tab', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'tab'), 0)
    ),
    coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method <> 'tab'), 0)::bigint
  into server_order_count, server_sales, server_payment_split, server_sales_collected
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'done'
    and order_record.created_at between period_from and period_to;

  select
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'cash' and tab.kind = 'settled'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'cash' and tab.kind = 'reversal'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'card' and tab.kind = 'settled'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'card' and tab.kind = 'reversal'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'other' and tab.kind = 'settled'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'other' and tab.kind = 'reversal'
    ), 0)
  into server_cash_tab_payments, server_card_tab_payments, server_other_tab_payments
  from public.tabs tab
  where tab.store_id = target_store.store_id
    and tab.kind in ('settled', 'reversal')
    and tab.created_at between period_from and period_to;

  server_sales_collected := server_sales_collected
    + server_cash_tab_payments + server_card_tab_payments + server_other_tab_payments;
  server_payment_split := server_payment_split || jsonb_build_object(
    'cash', (server_payment_split->>'cash')::bigint,
    'card', (server_payment_split->>'card')::bigint,
    'other', (server_payment_split->>'other')::bigint,
    'tab', (server_payment_split->>'tab')::bigint
  );

  select coalesce(sum(expense.amount_millimes), 0)::bigint
  into server_expenses
  from public.expenses expense
  where expense.store_id = target_store.store_id
    and expense.created_at between period_from and period_to
    and not exists (
      select 1
      from public.reports prior_report
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(prior_report.data->'expenseDetails') = 'array'
            then prior_report.data->'expenseDetails'
          else '[]'::jsonb
        end
      ) as prior_expense(expense_data)
      where prior_report.store_id = target_store.store_id
        and prior_report.type = 'Z'
        and prior_expense.expense_data->>'expenseId' = expense.id::text
    );

  select coalesce(sum(customer_balance.balance), 0)::bigint,
         coalesce(sum(greatest(customer_balance.balance, 0)), 0)::bigint
  into server_tabs_outstanding, server_receivable
  from (
    select customer.id,
      coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.customer_id = customer.id
          and order_record.payment_method = 'tab'
          and order_record.status = 'done'
          and order_record.created_at <= period_to
      ), 0)
      + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'issued'
          and tab.order_id is null and tab.created_at <= period_to
      ), 0)
      - coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'settled'
          and tab.created_at <= period_to
      ), 0)
      + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'reversal'
          and tab.created_at <= period_to
      ), 0) as balance
    from public.customers customer
    where customer.store_id = target_store.store_id
  ) customer_balance;

  select coalesce(sum(order_record.total_millimes), 0)::bigint
  into server_tabs_issued
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'done'
    and order_record.payment_method = 'tab'
    and order_record.created_at between period_from and period_to;

  select count(*)::integer, coalesce(sum(order_record.total_millimes), 0)::bigint
  into server_void_count, server_void_total
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'voided'
    and order_record.voided_at between period_from and period_to;
  select count(*)::integer, coalesce(sum(order_record.total_millimes), 0)::bigint
  into server_pending_count, server_pending_total
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'pending_void';
  select count(*)::integer, coalesce(sum(comp.quantity), 0)::integer,
         coalesce(sum(comp.value_millimes), 0)::bigint
  into server_comp_count, server_comp_quantity, server_comp_total
  from public.comps comp
  where comp.store_id = target_store.store_id
    and comp.created_at between period_from and period_to;
  select coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'in'), 0)::bigint,
         coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'out'), 0)::bigint
  into server_cash_in, server_cash_out
  from public.cash_movements movement
  where movement.store_id = target_store.store_id
    and movement.created_at between period_from and period_to;
  server_non_cash_tab_payments := server_card_tab_payments + server_other_tab_payments;

  if nullif(p_report->>'orderCount', '')::integer is distinct from server_order_count
    or nullif(p_report->>'salesMillimes', '')::bigint is distinct from server_sales
    or nullif(p_report->>'salesCollectedMillimes', 'null')::bigint is distinct from server_sales_collected
    or nullif(p_report->>'expensesMillimes', 'null')::bigint is distinct from server_expenses
    or nullif(p_report->>'receivableMillimes', 'null')::bigint is distinct from server_receivable
    or p_report->'paymentSplit' is distinct from server_payment_split
    or coalesce((p_report->'voids'->>'count')::integer, -1) <> server_void_count
    or coalesce((p_report->'voids'->>'totalMillimes')::bigint, -1) <> server_void_total
    or coalesce((p_report->'pendingVoids'->>'count')::integer, -1) <> server_pending_count
    or coalesce((p_report->'pendingVoids'->>'totalMillimes')::bigint, -1) <> server_pending_total
    or coalesce((p_report->'comps'->>'count')::integer, -1) <> server_comp_count
    or coalesce((p_report->'comps'->>'quantity')::integer, -1) <> server_comp_quantity
    or coalesce((p_report->'comps'->>'totalMillimes')::bigint, -1) <> server_comp_total
    or coalesce((p_report->>'tabsIssuedMillimes')::bigint, -1) <> server_tabs_issued
    or coalesce((p_report->>'tabsOutstandingMillimes')::bigint, -1) <> server_tabs_outstanding
    or coalesce((p_report->>'tabsSettledMillimes')::bigint, -1) <> server_cash_tab_payments
    or coalesce((p_report->>'tabPaymentsReceivedMillimes')::bigint, -1) <> server_cash_tab_payments
    or coalesce((p_report->>'nonCashTabPaymentsMillimes')::bigint, -1) <> server_non_cash_tab_payments
    or coalesce((p_report->>'cashInMillimes')::bigint, -1) <> server_cash_in
    or coalesce((p_report->>'cashOutMillimes')::bigint, -1) <> server_cash_out
    or coalesce((p_report->>'cashRefundsMillimes')::bigint, -1) <> coalesce((
      select sum(tab.amount_millimes)
      from public.tabs tab
      join public.shifts shift on shift.id = tab.shift_id
      where tab.store_id = target_store.store_id
        and tab.kind = 'reversal'
        and tab.payment_method = 'cash'
        and tab.created_at between period_from and period_to
        and shift.closed_at < tab.created_at
    ), 0) then
    raise exception 'Report snapshot totals do not match persisted sales, tabs, voids, expenses, comps, or payments.';
  end if;

  select count(*)::integer into shift_count
  from public.shifts shift
  where shift.store_id = target_store.store_id
    and shift.opened_at >= period_from
    and shift.opened_at <= period_to;
  if jsonb_typeof(p_report->'shifts') <> 'array'
    or jsonb_array_length(p_report->'shifts') <> shift_count then
    raise exception 'Report shift lines do not match persisted shifts.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_report->'shifts') snapshot_line
    where not exists (
      select 1
      from public.shifts shift
      where shift.id = (snapshot_line->>'shiftId')::uuid
        and shift.store_id = target_store.store_id
        and shift.starting_cash_millimes = (snapshot_line->>'startingCashMillimes')::bigint
        and shift.force_closed_by_owner = (snapshot_line->>'forceClosedByOwner')::boolean
    )
  ) then
    raise exception 'Report shift lines contain values that do not match persisted shifts.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shiftId', shift.id,
    'staffName', profile.name,
    'orderCount', (select count(*)::integer from public.orders order_record
      where order_record.shift_id = shift.id and order_record.status = 'done'
        and order_record.created_at between period_from and period_to),
    'status', case when shift.status = 'open' then 'in_progress' else 'closed' end,
    'openedAt', shift.opened_at,
    'closedAt', shift.closed_at,
    'startingCashMillimes', shift.starting_cash_millimes,
    'cashSalesMillimes', (select coalesce(sum(order_record.total_millimes), 0)
      from public.orders order_record where order_record.shift_id = shift.id
        and order_record.status = 'done' and order_record.payment_method = 'cash'
        and order_record.created_at between period_from and period_to),
    'cardSalesMillimes', (select coalesce(sum(order_record.total_millimes), 0)
      from public.orders order_record where order_record.shift_id = shift.id
        and order_record.status = 'done' and order_record.payment_method = 'card'
        and order_record.created_at between period_from and period_to),
    'otherSalesMillimes', (select coalesce(sum(order_record.total_millimes), 0)
      from public.orders order_record where order_record.shift_id = shift.id
        and order_record.status = 'done' and order_record.payment_method = 'other'
        and order_record.created_at between period_from and period_to),
    'tabSalesMillimes', (select coalesce(sum(order_record.total_millimes), 0)
      from public.orders order_record where order_record.shift_id = shift.id
        and order_record.status = 'done' and order_record.payment_method = 'tab'
        and order_record.created_at between period_from and period_to),
    'tabPaymentsMillimes', (select coalesce(sum(case when tab.kind = 'settled'
        then tab.amount_millimes else -tab.amount_millimes end), 0)
      from public.tabs tab where tab.shift_id = shift.id and tab.payment_method = 'cash'
        and tab.kind in ('settled', 'reversal') and tab.created_at between period_from and period_to),
    'cashInMillimes', (select coalesce(sum(movement.amount_millimes), 0)
      from public.cash_movements movement where movement.shift_id = shift.id
        and movement.kind = 'in' and movement.created_at between period_from and period_to),
    'cashOutMillimes', (select coalesce(sum(movement.amount_millimes), 0)
      from public.cash_movements movement where movement.shift_id = shift.id
        and movement.kind = 'out' and movement.created_at between period_from and period_to),
    'expectedCashMillimes', case when shift.status = 'closed'
      then shift.expected_cash_millimes + coalesce((select sum(adjustment.amount_millimes)
        from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
          and adjustment.created_at between period_from and period_to), 0)
      else public.get_shift_expected_cash(shift.id) end,
    'cashFlowExFloatMillimes', case when shift.status = 'closed'
      then shift.expected_cash_millimes + coalesce((select sum(adjustment.amount_millimes)
        from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
          and adjustment.created_at between period_from and period_to), 0) - shift.starting_cash_millimes
      else public.get_shift_expected_cash(shift.id) - shift.starting_cash_millimes end,
    'countedCashMillimes', shift.counted_cash_millimes,
    'differenceMillimes', case when shift.counted_cash_millimes is null then null
      else shift.counted_cash_millimes - shift.expected_cash_millimes
        - coalesce((select sum(adjustment.amount_millimes)
          from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
            and adjustment.created_at between period_from and period_to), 0) end,
    'voidAdjustmentMillimes', nullif((select coalesce(sum(adjustment.amount_millimes), 0)
      from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
        and adjustment.created_at between period_from and period_to), 0),
    'voidRequestsMillimes', nullif((select coalesce(sum(adjustment.amount_millimes), 0)
      from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
        and adjustment.kind = 'requested'
        and adjustment.created_at between period_from and period_to), 0),
    'voidRejectionsMillimes', nullif((select coalesce(sum(adjustment.amount_millimes), 0)
      from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
        and adjustment.kind = 'rejected'
        and adjustment.created_at between period_from and period_to), 0),
    'forceClosedByOwner', shift.force_closed_by_owner,
    'voidsAutoApprovedCount', shift.voids_auto_approved_count
  ) order by shift.opened_at), '[]'::jsonb)
  into server_shift_lines
  from public.shifts shift
  join public.profiles profile on profile.id = shift.staff_id
  where shift.store_id = target_store.store_id
    and shift.opened_at >= period_from
    and shift.opened_at <= period_to;

  select coalesce(sum((line->>'expectedCashMillimes')::bigint), 0)::bigint,
         coalesce(sum((line->>'startingCashMillimes')::bigint), 0)::bigint,
         coalesce(sum((line->>'countedCashMillimes')::bigint)
           filter (where line->>'status' = 'closed'), 0)::bigint,
         coalesce(sum((line->>'differenceMillimes')::bigint)
           filter (where line->>'status' = 'closed'), 0)::bigint
  into server_expected_cash, server_cash_float, server_total_counted, server_total_difference
  from jsonb_array_elements(server_shift_lines) line;
  select server_expected_cash + coalesce(sum(adjustment.amount_millimes), 0)::bigint
  into server_expected_cash
  from public.shift_void_adjustments adjustment
  where adjustment.store_id = target_store.store_id
    and adjustment.created_at between period_from and period_to
    and not exists (
      select 1 from public.shifts shift
      where shift.id = adjustment.shift_id
        and shift.opened_at <= period_to
        and coalesce(shift.closed_at, period_to) >= period_from
    );
  select coalesce(sum(tab.amount_millimes), 0)::bigint
  into server_cash_refunds
  from public.tabs tab
  join public.shifts shift on shift.id = tab.shift_id
  where tab.store_id = target_store.store_id
    and tab.kind = 'reversal'
    and tab.payment_method = 'cash'
    and tab.created_at between period_from and period_to
    and shift.closed_at < tab.created_at;
  server_cash_refunds := coalesce(server_cash_refunds, 0);
  server_expected_cash := coalesce(server_expected_cash, 0) - server_cash_refunds;
  expected_cash_ex_float := server_expected_cash - server_cash_float;

  select jsonb_build_object(
    'count', count(*)::integer,
    'totalMillimes', coalesce(sum(order_record.total_millimes), 0)::bigint,
    'orders', coalesce(jsonb_agg(jsonb_build_object(
      'ticketNumber', order_record.number,
      'reason', coalesce(order_record.void_reason, ''),
      'totalMillimes', order_record.total_millimes,
      'autoApprovedAtForcedClose', order_record.void_reason = 'Auto-approved at forced close',
      'approvedBy', coalesce(profile.name,
        case when order_record.voided_by = 'owner' then 'Owner'
             when order_record.voided_by = 'pin' then 'PIN authorized' else 'Unknown' end)
    ) order by order_record.number), '[]'::jsonb)
  ) into server_voids
  from public.orders order_record
  left join public.profiles profile on profile.id = order_record.voided_by_user_id
  where order_record.store_id = target_store.store_id
    and order_record.status = 'voided'
    and order_record.voided_at between period_from and period_to;

  select jsonb_build_object(
    'count', count(*)::integer,
    'totalMillimes', coalesce(sum(order_record.total_millimes), 0)::bigint,
    'orders', coalesce(jsonb_agg(jsonb_build_object(
      'ticketNumber', order_record.number,
      'staffName', profile.name,
      'shiftId', order_record.shift_id,
      'amountMillimes', order_record.total_millimes,
      'paymentMethod', order_record.payment_method,
      'reason', coalesce(order_record.void_reason, ''),
      'requestedAt', coalesce(order_record.void_requested_at, order_record.created_at)
    ) order by order_record.number), '[]'::jsonb)
  ) into server_pending_voids
  from public.orders order_record
  join public.profiles profile on profile.id = order_record.staff_id
  where order_record.store_id = target_store.store_id
    and order_record.status = 'pending_void';

  select jsonb_build_object(
    'count', count(*)::integer,
    'quantity', coalesce(sum(comp.quantity), 0)::integer,
    'totalMillimes', coalesce(sum(comp.value_millimes), 0)::bigint,
    'records', coalesce(jsonb_agg(jsonb_build_object(
      'staffName', profile.name,
      'itemName', comp.name,
      'quantity', comp.quantity,
      'valueMillimes', comp.value_millimes,
      'reason', comp.reason,
      'note', comp.note,
      'createdAt', comp.created_at
    ) order by comp.created_at), '[]'::jsonb)
  ) into server_comps
  from public.comps comp
  join public.profiles profile on profile.id = comp.staff_id
  where comp.store_id = target_store.store_id
    and comp.created_at between period_from and period_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'expenseId', expense.id,
    'category', expense.category,
    'amountMillimes', expense.amount_millimes,
    'paidMillimes', expense.paid_millimes,
    'date', expense.date,
    'supplierId', expense.supplier_id,
    'note', expense.note,
    'createdBy', profile.name
  ) order by expense.date, expense.id), '[]'::jsonb)
  into server_expense_details
  from public.expenses expense
  join public.profiles profile on profile.id = expense.created_by
  where expense.store_id = target_store.store_id
    and expense.created_at between period_from and period_to
    and not exists (
      select 1
      from public.reports prior_report
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(prior_report.data->'expenseDetails') = 'array'
            then prior_report.data->'expenseDetails'
          else '[]'::jsonb
        end
      ) as prior_expense(expense_data)
      where prior_report.store_id = target_store.store_id
        and prior_report.type = 'Z'
        and prior_expense.expense_data->>'expenseId' = expense.id::text
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'customerId', customer.id,
    'customerName', customer.name,
    'issuedMillimes', tab_totals.issued_millimes,
    'paymentsMillimes', tab_totals.payments_millimes,
    'outstandingMillimes', tab_totals.outstanding_millimes
  ) order by customer.name), '[]'::jsonb)
  into server_customer_tabs
  from public.customers customer
  cross join lateral (
    select
      coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.customer_id = customer.id
          and order_record.payment_method = 'tab'
          and order_record.status = 'done'
          and order_record.created_at between period_from and period_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id
          and tab.kind = 'issued' and tab.order_id is null
          and tab.created_at between period_from and period_to
      ), 0) as issued_millimes,
      coalesce((
        select sum(case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end)
        from public.tabs tab
        where tab.customer_id = customer.id
          and tab.kind in ('settled', 'reversal')
          and tab.created_at between period_from and period_to
      ), 0) as payments_millimes,
      coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.customer_id = customer.id
          and order_record.payment_method = 'tab'
          and order_record.status = 'done'
          and order_record.created_at <= period_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'issued'
          and tab.order_id is null and tab.created_at <= period_to
      ), 0) - coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'settled'
          and tab.created_at <= period_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'reversal'
          and tab.created_at <= period_to
      ), 0) as outstanding_millimes
  ) tab_totals
  where customer.store_id = target_store.store_id
    and (tab_totals.issued_millimes <> 0 or tab_totals.payments_millimes <> 0
      or tab_totals.outstanding_millimes <> 0);

  if nullif(p_report->>'totalExpectedCashMillimes', 'null')::bigint is distinct from server_expected_cash
    or nullif(p_report->>'cashFloatMillimes', 'null')::bigint is distinct from server_cash_float
    or nullif(p_report->>'expectedCashExFloatMillimes', 'null')::bigint is distinct from expected_cash_ex_float
    or nullif(p_report->>'totalCountedMillimes', 'null')::bigint is distinct from server_total_counted
    or nullif(p_report->>'totalDifferenceMillimes', 'null')::bigint is distinct from server_total_difference
    or (report_type = 'X'
      and nullif(p_report->>'cashDifferenceMillimes', '')::bigint is distinct from server_total_difference) then
    raise exception 'Report cash totals do not match persisted shift and refund ledgers.';
  end if;

  select (array_agg(order_record.number order by order_record.created_at, order_record.number))[1],
         (array_agg(order_record.number order by order_record.created_at desc, order_record.number desc))[1]
  into first_ticket, last_ticket
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'done'
    and order_record.created_at between period_from and period_to;

  report_data := jsonb_set(report_data, '{paymentSplit}', server_payment_split, true);
  report_data := jsonb_set(report_data, '{shifts}', server_shift_lines, true);
  report_data := jsonb_set(report_data, '{voids}', server_voids, true);
  report_data := jsonb_set(report_data, '{pendingVoids}', server_pending_voids, true);
  report_data := jsonb_set(report_data, '{comps}', server_comps, true);
  report_data := jsonb_set(report_data, '{expenseDetails}', server_expense_details, true);
  report_data := jsonb_set(report_data, '{customerTabs}', server_customer_tabs, true);
  report_data := jsonb_set(report_data, '{salesMillimes}', to_jsonb(server_sales), true);
  report_data := jsonb_set(report_data, '{salesCollectedMillimes}', to_jsonb(server_sales_collected), true);
  report_data := jsonb_set(report_data, '{expensesMillimes}', to_jsonb(server_expenses), true);
  report_data := jsonb_set(report_data, '{netProfitMillimes}', to_jsonb(server_sales_collected - server_expenses), true);
  report_data := jsonb_set(report_data, '{totalExpectedCashMillimes}', to_jsonb(server_expected_cash), true);
  report_data := jsonb_set(report_data, '{cashFloatMillimes}', to_jsonb(server_cash_float), true);
  report_data := jsonb_set(report_data, '{expectedCashExFloatMillimes}', to_jsonb(expected_cash_ex_float), true);
  report_data := jsonb_set(report_data, '{totalCountedMillimes}', to_jsonb(server_total_counted), true);
  report_data := jsonb_set(report_data, '{totalDifferenceMillimes}', to_jsonb(server_total_difference), true);
  report_data := jsonb_set(report_data, '{receivableMillimes}', to_jsonb(server_receivable), true);
  report_data := jsonb_set(report_data, '{tabsOutstandingMillimes}', to_jsonb(server_tabs_outstanding), true);
  report_data := jsonb_set(report_data, '{tabsIssuedMillimes}', to_jsonb(server_tabs_issued), true);
  report_data := jsonb_set(report_data, '{tabsSettledMillimes}', to_jsonb(server_cash_tab_payments), true);
  report_data := jsonb_set(report_data, '{nonCashTabPaymentsMillimes}',
    to_jsonb(server_non_cash_tab_payments), true);
  report_data := jsonb_set(report_data, '{tabPaymentsReceivedMillimes}', to_jsonb(server_cash_tab_payments), true);
  report_data := jsonb_set(report_data, '{cashInMillimes}', to_jsonb(server_cash_in), true);
  report_data := jsonb_set(report_data, '{cashOutMillimes}', to_jsonb(server_cash_out), true);
  report_data := jsonb_set(report_data, '{cashRefundsMillimes}', to_jsonb(coalesce((
    select sum(tab.amount_millimes)
    from public.tabs tab
    join public.shifts shift on shift.id = tab.shift_id
    where tab.store_id = target_store.store_id
      and tab.kind = 'reversal' and tab.payment_method = 'cash'
      and tab.created_at between period_from and period_to
      and shift.closed_at < tab.created_at
  ), 0)), true);
  report_data := jsonb_set(report_data, '{firstTicketNumber}', coalesce(to_jsonb(first_ticket), 'null'::jsonb), true);
  report_data := jsonb_set(report_data, '{lastTicketNumber}', coalesce(to_jsonb(last_ticket), 'null'::jsonb), true);
  report_data := jsonb_set(report_data, '{businessDate}', to_jsonb(business_day), true);

  if report_type = 'Z' then
    if server_pending_count > 0 then
      raise exception 'Resolve every void request before creating a Z report.';
    end if;
    if exists (
      select 1 from public.shifts
      where store_id = target_store.store_id and status = 'open'
    ) then
      raise exception 'Force-close or close every shift before creating a Z report.';
    end if;
    if nullif(p_pin, '') is null
      or not public.verify_store_pin(target_store.store_id, p_pin, 'z_report') then
      raise exception 'Incorrect owner PIN.';
    end if;

    select coalesce(sum(shift.expected_cash_millimes), 0)::bigint,
           coalesce(sum(shift.starting_cash_millimes), 0)::bigint
    into server_expected_cash, server_cash_float
    from public.shifts shift
    where shift.store_id = target_store.store_id
      and shift.status = 'closed'
      and shift.opened_at >= period_from
      and shift.opened_at <= period_to
      and shift.closed_at between period_from and period_to;
    select coalesce(sum(tab.amount_millimes), 0)::bigint
    into server_cash_refunds
    from public.tabs tab
    join public.shifts shift on shift.id = tab.shift_id
    where tab.store_id = target_store.store_id
      and tab.kind = 'reversal'
      and tab.payment_method = 'cash'
      and tab.created_at between period_from and period_to
      and shift.closed_at < tab.created_at;
    server_cash_refunds := coalesce(server_cash_refunds, 0);
    select server_expected_cash + coalesce(sum(adjustment.amount_millimes), 0)::bigint
    into server_expected_cash
    from public.shift_void_adjustments adjustment
    join public.shifts shift on shift.id = adjustment.shift_id
    where adjustment.store_id = target_store.store_id
      and adjustment.created_at between period_from and period_to
      and adjustment.created_at > shift.closed_at;
    server_expected_cash := coalesce(server_expected_cash, 0) - server_cash_refunds;
    expected_cash_ex_float := server_expected_cash - server_cash_float;
    counted_cash := nullif(p_report->>'countedCashMillimes', 'null')::bigint;
    cash_difference := nullif(p_report->>'cashDifferenceMillimes', '')::bigint;
    expected_card := (server_payment_split->>'card')::bigint + server_card_tab_payments;
    expected_other := (server_payment_split->>'other')::bigint + server_other_tab_payments;
    counted_card := nullif(p_report->>'countedCardMillimes', 'null')::bigint;
    counted_other := nullif(p_report->>'countedOtherMillimes', 'null')::bigint;
    card_difference := counted_card - expected_card;
    other_difference := counted_other - expected_other;
    if counted_cash is null or counted_cash < 0
      or counted_card is null or counted_card < 0
      or counted_other is null or counted_other < 0
      or p_report->>'countedCashIncludesFloat' is distinct from 'true'
      or cash_difference is distinct from counted_cash - server_expected_cash
      or nullif(p_report->>'expectedCashExFloatMillimes', 'null')::bigint is distinct from expected_cash_ex_float
      or nullif(p_report->>'totalExpectedCashMillimes', 'null')::bigint is distinct from server_expected_cash
      or nullif(p_report->>'expectedCardMillimes', 'null')::bigint is distinct from expected_card
      or nullif(p_report->>'cardDifferenceMillimes', 'null')::bigint is distinct from card_difference
      or nullif(p_report->>'expectedOtherMillimes', 'null')::bigint is distinct from expected_other
      or nullif(p_report->>'otherDifferenceMillimes', 'null')::bigint is distinct from other_difference
      or ((cash_difference <> 0 or card_difference <> 0 or other_difference <> 0)
        and nullif(btrim(p_report->>'cashDifferenceNote'), '') is null) then
      raise exception 'Z counts are incomplete, require a note, or do not reconcile with the server ledger.';
    end if;
    select coalesce(max(report.z_number), 0) + 1
    into assigned_z_number
    from public.reports report
    where report.store_id = target_store.store_id and report.type = 'Z';
    report_data := jsonb_set(report_data, '{zNumber}', to_jsonb(assigned_z_number), true);
    report_data := jsonb_set(report_data, '{reportNumber}',
      to_jsonb('Z-' || pg_catalog.lpad(assigned_z_number::text, 6, '0')), true);
    report_data := jsonb_set(report_data, '{totalExpectedCashMillimes}', to_jsonb(server_expected_cash), true);
    report_data := jsonb_set(report_data, '{expectedCashExFloatMillimes}', to_jsonb(expected_cash_ex_float), true);
    report_data := jsonb_set(report_data, '{cashDifferenceMillimes}', to_jsonb(cash_difference), true);
    report_data := jsonb_set(report_data, '{countedCashIncludesFloat}', 'true'::jsonb, true);
    report_data := jsonb_set(report_data, '{expectedCardMillimes}', to_jsonb(expected_card), true);
    report_data := jsonb_set(report_data, '{cardDifferenceMillimes}', to_jsonb(card_difference), true);
    report_data := jsonb_set(report_data, '{expectedOtherMillimes}', to_jsonb(expected_other), true);
    report_data := jsonb_set(report_data, '{otherDifferenceMillimes}', to_jsonb(other_difference), true);
    report_data := jsonb_set(report_data, '{cashRefundsMillimes}', to_jsonb(server_cash_refunds), true);
    update public.stores set day_closed_on = business_day where store_id = target_store.store_id;
  end if;

  insert into public.reports (
    store_id, type, business_date, created_at, sales_millimes, sales_collected_millimes,
    expenses_millimes, net_profit_millimes, receivable_millimes, order_count,
    cash_difference_millimes, z_number, period_from, period_to, generated_by, data
  ) values (
    target_store.store_id, report_type, business_day, now(), server_sales,
    server_sales_collected, server_expenses, server_sales_collected - server_expenses,
    server_receivable, server_order_count, coalesce(cash_difference,
      nullif(p_report->>'cashDifferenceMillimes', '')::bigint),
    assigned_z_number, period_from, period_to, actor.id, report_data
  ) returning * into result;
  return result;
end
$$;

update public.app_schema_version
set version = 20261120210000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
