create or replace function public.get_customers_credit_status(p_store_id uuid)
returns table(customer_id uuid, balance_millimes bigint, credit_limit_millimes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_store_id is distinct from (select public.current_store_id())
    or not (
      public.is_store_owner(p_store_id)
      or public.has_store_permission('customers_view')
      or public.has_store_permission('use_tabs')
      or public.has_store_permission('settle_tabs')
    ) then
    raise exception 'Not authorized to view customer credit status.' using errcode = '42501';
  end if;

  return query
  with order_balances as (
    select customer_id, sum(total_millimes)::bigint as amount_millimes
    from public.orders
    where store_id = p_store_id
      and customer_id is not null
      and payment_method = 'tab'
      and status = 'done'
    group by customer_id
  ),
  legacy_tab_balances as (
    select tab.customer_id,
      sum(case when tab.kind = 'settled' then -tab.amount_millimes else tab.amount_millimes end)::bigint as amount_millimes
    from public.tabs tab
    where tab.store_id = p_store_id
      and (tab.kind <> 'issued' or tab.order_id is null)
    group by tab.customer_id
  )
  select customer.id,
    coalesce(order_balances.amount_millimes, 0) + coalesce(legacy_tab_balances.amount_millimes, 0),
    customer.credit_limit_millimes
  from public.customers customer
  left join order_balances on order_balances.customer_id = customer.id
  left join legacy_tab_balances on legacy_tab_balances.customer_id = customer.id
  where customer.store_id = p_store_id;
end
$$;

create or replace function public.get_shift_summary(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
  actor_id uuid := (select auth.uid());
  now_at timestamptz := now();
  from_at timestamptz;
  payment_split jsonb;
  sales_millimes bigint;
  order_count bigint;
  first_ticket integer;
  last_ticket integer;
  voids jsonb;
  pending_voids jsonb;
  comps jsonb;
  cash_movements jsonb;
  cash_in_millimes bigint;
  cash_out_millimes bigint;
  expected_cash_millimes bigint;
  tab_payments_millimes bigint;
  cash_adjustments_millimes bigint;
begin
  select * into target from public.shifts where id = p_shift_id;
  if not found or target.store_id is distinct from (select public.current_store_id())
    or not (
      public.is_store_owner(target.store_id)
      or (
        target.staff_id = actor_id
        and public.has_store_permission('print_x_report')
      )
    ) then
    raise exception 'Not authorized to view this shift summary.' using errcode = '42501';
  end if;
  from_at := target.opened_at;

  select jsonb_build_object(
    'cash', coalesce(sum(total_millimes) filter (where payment_method = 'cash' and status = 'done'), 0),
    'card', coalesce(sum(total_millimes) filter (where payment_method = 'card' and status = 'done'), 0),
    'other', coalesce(sum(total_millimes) filter (where payment_method = 'other' and status = 'done'), 0),
    'tab', coalesce(sum(total_millimes) filter (where payment_method = 'tab' and status = 'done'), 0)
  ), coalesce(sum(total_millimes) filter (where status = 'done'), 0)::bigint,
    count(*) filter (where status = 'done')
  into payment_split, sales_millimes, order_count
  from public.orders
  where shift_id = target.id
    and created_at >= from_at
    and created_at <= now_at;
  select order_record.number into first_ticket
  from public.orders order_record
  where order_record.shift_id = target.id and order_record.status = 'done'
    and order_record.created_at between from_at and now_at
  order by order_record.created_at, order_record.number limit 1;
  select order_record.number into last_ticket
  from public.orders order_record
  where order_record.shift_id = target.id and order_record.status = 'done'
    and order_record.created_at between from_at and now_at
  order by order_record.created_at desc, order_record.number desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ticketNumber', order_record.number,
    'reason', coalesce(order_record.void_reason, ''),
    'totalMillimes', order_record.total_millimes,
    'approvedBy', coalesce(profile.name, case order_record.voided_by when 'owner' then 'Owner' when 'pin' then 'PIN authorized' else 'Unknown' end)
  ) order by order_record.created_at), '[]'::jsonb)
  into voids
  from public.orders order_record
  left join public.profiles profile on profile.id = order_record.voided_by_user_id
  where order_record.shift_id = target.id
    and order_record.status = 'voided'
    and order_record.voided_at between from_at and now_at;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ticketNumber', order_record.number,
    'staffName', staff.name,
    'shiftId', target.id,
    'amountMillimes', order_record.total_millimes,
    'paymentMethod', order_record.payment_method,
    'reason', coalesce(order_record.void_reason, ''),
    'requestedAt', coalesce(order_record.void_requested_at, order_record.created_at)
  ) order by order_record.created_at), '[]'::jsonb)
  into pending_voids
  from public.orders order_record
  join public.profiles staff on staff.id = order_record.staff_id
  where order_record.shift_id = target.id and order_record.status = 'pending_void';

  select coalesce(jsonb_agg(jsonb_build_object(
    'staffName', staff.name,
    'itemName', comp.name,
    'quantity', comp.quantity,
    'valueMillimes', comp.value_millimes,
    'reason', comp.reason,
    'note', comp.note,
    'createdAt', comp.created_at
  ) order by comp.created_at), '[]'::jsonb)
  into comps
  from public.comps comp
  join public.profiles staff on staff.id = comp.staff_id
  where comp.shift_id = target.id
    and comp.created_at between from_at and now_at;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shiftId', movement.shift_id,
    'staffName', staff.name,
    'kind', movement.kind,
    'reason', movement.reason,
    'amountMillimes', movement.amount_millimes,
    'note', movement.note,
    'createdAt', movement.created_at
  ) order by movement.created_at), '[]'::jsonb),
    coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'in'), 0)::bigint,
    coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'out'), 0)::bigint
  into cash_movements, cash_in_millimes, cash_out_millimes
  from public.cash_movements movement
  join public.profiles staff on staff.id = movement.staff_id
  where movement.shift_id = target.id
    and movement.created_at between from_at and now_at;

  select coalesce(sum(case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end), 0)::bigint
  into tab_payments_millimes
  from public.tabs tab
  where tab.shift_id = target.id
    and tab.payment_method = 'cash'
    and tab.kind in ('settled', 'reversal')
    and tab.created_at between from_at and now_at;

  select coalesce(sum(adjustment.amount_millimes), 0)::bigint
  into cash_adjustments_millimes
  from public.shift_void_adjustments adjustment
  join public.orders order_record
    on order_record.id = adjustment.order_id
    and order_record.shift_id = adjustment.shift_id
    and order_record.store_id = adjustment.store_id
  where adjustment.shift_id = target.id and order_record.payment_method = 'cash';
  if target.status = 'closed' and target.expected_cash_millimes is not null then
    expected_cash_millimes := target.expected_cash_millimes + cash_adjustments_millimes;
  else
    expected_cash_millimes := target.starting_cash_millimes
      + coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.shift_id = target.id
          and order_record.status = 'done'
          and order_record.payment_method = 'cash'
      ), 0)
      + coalesce((
        select sum(case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end)
        from public.tabs tab
        where tab.shift_id = target.id
          and tab.kind in ('settled', 'reversal')
          and tab.payment_method = 'cash'
      ), 0)
      + coalesce((
        select sum(case when movement.kind = 'in' then movement.amount_millimes else -movement.amount_millimes end)
        from public.cash_movements movement
        where movement.shift_id = target.id
      ), 0)
      + cash_adjustments_millimes;
  end if;

  return jsonb_build_object(
    'shiftId', target.id,
    'staffName', (select profile.name from public.profiles profile where profile.id = target.staff_id),
    'status', case when target.status = 'open' then 'in_progress' else 'closed' end,
    'openedAt', target.opened_at,
    'closedAt', target.closed_at,
    'startingCashMillimes', target.starting_cash_millimes,
    'salesMillimes', sales_millimes,
    'orderCount', order_count,
    'firstTicketNumber', first_ticket,
    'lastTicketNumber', last_ticket,
    'paymentSplit', payment_split,
    'cashSalesMillimes', (payment_split->>'cash')::bigint,
    'cardSalesMillimes', (payment_split->>'card')::bigint,
    'otherSalesMillimes', (payment_split->>'other')::bigint,
    'tabSalesMillimes', (payment_split->>'tab')::bigint,
    'tabPaymentsMillimes', tab_payments_millimes,
    'cashInMillimes', cash_in_millimes,
    'cashOutMillimes', cash_out_millimes,
    'expectedCashMillimes', expected_cash_millimes,
    'cashFlowExFloatMillimes', expected_cash_millimes - target.starting_cash_millimes,
    'countedCashMillimes', target.counted_cash_millimes,
    'differenceMillimes', target.difference_millimes,
    'forceClosedByOwner', target.force_closed_by_owner,
    'voidsAutoApprovedCount', target.voids_auto_approved_count,
    'voids', jsonb_build_object(
      'count', jsonb_array_length(voids),
      'totalMillimes', coalesce((select sum((entry->>'totalMillimes')::bigint) from jsonb_array_elements(voids) entry), 0),
      'orders', voids
    ),
    'pendingVoids', jsonb_build_object(
      'count', jsonb_array_length(pending_voids),
      'totalMillimes', coalesce((select sum((entry->>'amountMillimes')::bigint) from jsonb_array_elements(pending_voids) entry), 0),
      'orders', pending_voids
    ),
    'comps', jsonb_build_object(
      'count', jsonb_array_length(comps),
      'quantity', coalesce((select sum((entry->>'quantity')::integer) from jsonb_array_elements(comps) entry), 0),
      'totalMillimes', coalesce((select sum((entry->>'valueMillimes')::bigint) from jsonb_array_elements(comps) entry), 0),
      'records', comps
    ),
    'cashMovements', cash_movements,
    'cashOuts', coalesce((
      select jsonb_agg(entry) from jsonb_array_elements(cash_movements) entry where entry->>'kind' = 'out'
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.get_dashboard_summary(
  p_store_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_use_expense_creation_period boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  store_timezone text;
  sales_millimes bigint;
  order_count bigint;
  payment_split jsonb;
  first_ticket integer;
  last_ticket integer;
  sales_by_category jsonb;
  items_sold jsonb;
  top_items jsonb;
  voids jsonb;
  pending_voids jsonb;
  employee_breakdown jsonb;
  comps jsonb;
  expense_details jsonb;
  expenses_millimes bigint;
  cash_movements jsonb;
  cash_outs jsonb;
  cash_in_millimes bigint;
  cash_out_millimes bigint;
  void_adjustments jsonb;
  shift_lines jsonb;
  customer_tabs jsonb;
  tabs_issued_millimes bigint;
  tabs_settled_millimes bigint;
  non_cash_tab_payments_millimes bigint;
  card_tab_payments_millimes bigint;
  other_tab_payments_millimes bigint;
  tabs_outstanding_millimes bigint;
  receivable_millimes bigint;
  sales_collected_millimes bigint;
  cash_refunds_millimes bigint;
  total_expected_cash_millimes bigint;
  expected_cash_ex_float_millimes bigint;
  total_counted_millimes bigint;
  total_difference_millimes bigint;
  cash_float_millimes bigint;
  cash_sales_millimes bigint;
  cash_difference_millimes bigint;
  sales_by_day jsonb;
  sales_by_hour jsonb;
  sales_today bigint;
  sales_last_week bigint;
  recent_orders jsonb;
begin
  if p_store_id is distinct from (select public.current_store_id())
    or not public.is_store_owner(p_store_id) then
    raise exception 'Not authorized to view dashboard summaries.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid dashboard summary period.' using errcode = '22023';
  end if;
  select timezone into store_timezone from public.stores where store_id = p_store_id;
  if store_timezone is null then
    raise exception 'Store could not be found.' using errcode = 'P0002';
  end if;

  select coalesce(sum(total_millimes) filter (where status = 'done'), 0)::bigint,
    count(*) filter (where status = 'done'),
    jsonb_build_object(
      'cash', coalesce(sum(total_millimes) filter (where status = 'done' and payment_method = 'cash'), 0),
      'card', coalesce(sum(total_millimes) filter (where status = 'done' and payment_method = 'card'), 0),
      'other', coalesce(sum(total_millimes) filter (where status = 'done' and payment_method = 'other'), 0),
      'tab', coalesce(sum(total_millimes) filter (where status = 'done' and payment_method = 'tab'), 0)
    )
  into sales_millimes, order_count, payment_split
  from public.orders
  where store_id = p_store_id and created_at between p_from and p_to;
  select order_record.number into first_ticket
  from public.orders order_record
  where order_record.store_id = p_store_id and order_record.status = 'done'
    and order_record.created_at between p_from and p_to
  order by order_record.created_at, order_record.number limit 1;
  select order_record.number into last_ticket
  from public.orders order_record
  where order_record.store_id = p_store_id and order_record.status = 'done'
    and order_record.created_at between p_from and p_to
  order by order_record.created_at desc, order_record.number desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'categoryId', totals.category_id,
    'name', totals.category_name,
    'quantity', totals.quantity,
    'totalMillimes', totals.total_millimes
  ) order by totals.total_millimes desc), '[]'::jsonb)
  into sales_by_category
  from (
    select coalesce(line.category_id, item.category_id)::text as category_id,
      coalesce(max(line.category_name), max(category.name), 'Other') as category_name,
      sum(line.quantity)::bigint as quantity,
      sum(line.line_total_millimes)::bigint as total_millimes
    from public.orders order_record
    join public.order_lines line on line.order_id = order_record.id
    left join public.catalog_items item on item.id = line.item_id
    left join public.categories category on category.id = coalesce(line.category_id, item.category_id)
    where order_record.store_id = p_store_id
      and order_record.status = 'done'
      and order_record.created_at between p_from and p_to
    group by coalesce(line.category_id, item.category_id)
  ) totals;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', totals.item_id,
    'name', totals.item_name,
    'quantity', totals.quantity,
    'totalMillimes', totals.total_millimes,
    'categoryId', totals.category_id,
    'categoryName', totals.category_name,
    'unitPriceMillimes', totals.unit_price_millimes
  ) order by totals.total_millimes desc), '[]'::jsonb)
  into items_sold
  from (
    select line.item_id,
      min(line.name) as item_name,
      sum(line.quantity)::bigint as quantity,
      sum(line.line_total_millimes)::bigint as total_millimes,
      coalesce(line.category_id, item.category_id)::text as category_id,
      coalesce(max(line.category_name), max(category.name), 'Other') as category_name,
      line.unit_price_millimes
    from public.orders order_record
    join public.order_lines line on line.order_id = order_record.id
    left join public.catalog_items item on item.id = line.item_id
    left join public.categories category on category.id = coalesce(line.category_id, item.category_id)
    where order_record.store_id = p_store_id
      and order_record.status = 'done'
      and order_record.created_at between p_from and p_to
    group by line.item_id, coalesce(line.category_id, item.category_id), line.unit_price_millimes
  ) totals;

  select coalesce(jsonb_object_agg(item_totals.item_name, item_totals.quantity), '{}'::jsonb)
  into top_items
  from (
    select line.name as item_name, sum(line.quantity)::bigint as quantity
    from public.orders order_record
    join public.order_lines line on line.order_id = order_record.id
    where order_record.store_id = p_store_id
      and order_record.status = 'done'
      and order_record.created_at between p_from and p_to
    group by line.name
  ) item_totals;

  select jsonb_build_object(
    'count', count(*),
    'totalMillimes', coalesce(sum(total_millimes), 0),
    'orders', coalesce(jsonb_agg(jsonb_build_object(
      'ticketNumber', order_record.number,
      'reason', coalesce(order_record.void_reason, ''),
      'totalMillimes', order_record.total_millimes,
      'autoApprovedAtForcedClose', order_record.void_reason = 'Auto-approved at forced close',
      'approvedBy', coalesce(profile.name, case order_record.voided_by when 'owner' then 'Owner' when 'pin' then 'PIN authorized' else 'Unknown' end)
    ) order by order_record.voided_at), '[]'::jsonb)
  )
  into voids
  from public.orders order_record
  left join public.profiles profile on profile.id = order_record.voided_by_user_id
  where order_record.store_id = p_store_id
    and order_record.status = 'voided'
    and order_record.voided_at between p_from and p_to;

  select jsonb_build_object(
    'count', count(*),
    'totalMillimes', coalesce(sum(order_record.total_millimes), 0),
    'orders', coalesce(jsonb_agg(jsonb_build_object(
      'ticketNumber', order_record.number,
      'staffName', staff.name,
      'shiftId', order_record.shift_id,
      'amountMillimes', order_record.total_millimes,
      'paymentMethod', order_record.payment_method,
      'reason', coalesce(order_record.void_reason, ''),
      'requestedAt', coalesce(order_record.void_requested_at, order_record.created_at)
    ) order by order_record.created_at), '[]'::jsonb)
  )
  into pending_voids
  from public.orders order_record
  join public.profiles staff on staff.id = order_record.staff_id
  where order_record.store_id = p_store_id and order_record.status = 'pending_void';

  select coalesce(jsonb_agg(jsonb_build_object(
    'staffId', staff.id,
    'name', staff.name,
    'orderCount', totals.order_count,
    'salesMillimes', totals.sales_millimes
  ) order by totals.sales_millimes desc), '[]'::jsonb)
  into employee_breakdown
  from (
    select staff_id, count(*)::bigint as order_count, sum(total_millimes)::bigint as sales_millimes
    from public.orders
    where store_id = p_store_id and status = 'done' and created_at between p_from and p_to
    group by staff_id
  ) totals
  join public.profiles staff on staff.id = totals.staff_id;

  select jsonb_build_object(
    'count', count(*),
    'quantity', coalesce(sum(comp.quantity), 0),
    'totalMillimes', coalesce(sum(comp.value_millimes), 0),
    'records', coalesce(jsonb_agg(jsonb_build_object(
      'staffName', staff.name,
      'itemName', comp.name,
      'quantity', comp.quantity,
      'valueMillimes', comp.value_millimes,
      'reason', comp.reason,
      'note', comp.note,
      'createdAt', comp.created_at
    ) order by comp.created_at), '[]'::jsonb)
  )
  into comps
  from public.comps comp
  join public.profiles staff on staff.id = comp.staff_id
  where comp.store_id = p_store_id and comp.created_at between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'expenseId', expense.id,
    'category', expense.category,
    'amountMillimes', expense.amount_millimes,
    'paidMillimes', expense.paid_millimes,
    'date', expense.date,
    'supplierId', expense.supplier_id,
    'note', expense.note,
    'createdBy', creator.name
  ) order by expense.date), '[]'::jsonb), coalesce(sum(expense.amount_millimes), 0)::bigint
  into expense_details, expenses_millimes
  from public.expenses expense
  left join public.profiles creator on creator.id = expense.created_by
  where expense.store_id = p_store_id
    and case when p_use_expense_creation_period
      then expense.created_at between p_from and p_to
      else expense.date between (p_from at time zone store_timezone)::date and (p_to at time zone store_timezone)::date
    end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shiftId', movement.shift_id,
    'staffName', staff.name,
    'kind', movement.kind,
    'reason', movement.reason,
    'amountMillimes', movement.amount_millimes,
    'note', movement.note,
    'createdAt', movement.created_at
  ) order by movement.created_at), '[]'::jsonb),
    coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'in'), 0)::bigint,
    coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'out'), 0)::bigint
  into cash_movements, cash_in_millimes, cash_out_millimes
  from public.cash_movements movement
  join public.profiles staff on staff.id = movement.staff_id
  where movement.store_id = p_store_id and movement.created_at between p_from and p_to;

  select coalesce(jsonb_agg(entry) filter (where entry->>'kind' = 'out'), '[]'::jsonb)
  into cash_outs
  from jsonb_array_elements(cash_movements) entry;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shiftId', shift_record.id,
    'staffName', staff.name,
    'orderNumber', adjustment.order_number,
    'kind', adjustment.kind,
    'amountMillimes', adjustment.amount_millimes,
    'createdAt', adjustment.created_at
  ) order by adjustment.created_at), '[]'::jsonb)
  into void_adjustments
  from public.shift_void_adjustments adjustment
  join public.shifts shift_record on shift_record.id = adjustment.shift_id
  join public.profiles staff on staff.id = shift_record.staff_id
  where shift_record.store_id = p_store_id and adjustment.created_at between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shiftId', shift_record.id,
    'staffName', staff.name,
    'orderCount', coalesce(sales.order_count, 0),
    'status', case when shift_record.status = 'open' then 'in_progress' else 'closed' end,
    'openedAt', shift_record.opened_at,
    'closedAt', shift_record.closed_at,
    'startingCashMillimes', shift_record.starting_cash_millimes,
    'cashSalesMillimes', coalesce(sales.cash_sales, 0),
    'cardSalesMillimes', coalesce(sales.card_sales, 0),
    'otherSalesMillimes', coalesce(sales.other_sales, 0),
    'tabSalesMillimes', coalesce(sales.tab_sales, 0),
    'tabPaymentsMillimes', coalesce(tab_payments.amount_millimes, 0),
    'cashInMillimes', coalesce(movements.cash_in, 0),
    'cashOutMillimes', coalesce(movements.cash_out, 0),
    'expectedCashMillimes', case
      when shift_record.expected_cash_millimes is not null
        then shift_record.expected_cash_millimes + coalesce(adjustments.cash_amount_millimes, 0)
      else (select public.get_shift_expected_cash(shift_record.id))
    end,
    'cashFlowExFloatMillimes', case
      when shift_record.expected_cash_millimes is not null
        then shift_record.expected_cash_millimes + coalesce(adjustments.cash_amount_millimes, 0)
      else (select public.get_shift_expected_cash(shift_record.id))
    end - shift_record.starting_cash_millimes,
    'countedCashMillimes', case when shift_record.status = 'open' then null else shift_record.counted_cash_millimes end,
    'differenceMillimes', case when shift_record.status = 'open' then null
      else coalesce(shift_record.counted_cash_millimes, 0)
        - case
          when shift_record.expected_cash_millimes is not null
            then shift_record.expected_cash_millimes + coalesce(adjustments.cash_amount_millimes, 0)
          else (select public.get_shift_expected_cash(shift_record.id))
        end end,
    'forceClosedByOwner', shift_record.force_closed_by_owner,
    'voidsAutoApprovedCount', shift_record.voids_auto_approved_count,
    'voidAdjustmentMillimes', nullif(coalesce(adjustments.amount_millimes, 0), 0),
    'voidRequestsMillimes', nullif(coalesce(adjustments.requested_millimes, 0), 0),
    'voidRejectionsMillimes', nullif(coalesce(adjustments.rejected_millimes, 0), 0)
  ) order by shift_record.opened_at), '[]'::jsonb)
  into shift_lines
  from public.shifts shift_record
  join public.profiles staff on staff.id = shift_record.staff_id
  left join lateral (
    select count(*) filter (where order_record.status = 'done')::bigint as order_count,
      coalesce(sum(order_record.total_millimes) filter (where order_record.status = 'done' and order_record.payment_method = 'cash'), 0)::bigint as cash_sales,
      coalesce(sum(order_record.total_millimes) filter (where order_record.status = 'done' and order_record.payment_method = 'card'), 0)::bigint as card_sales,
      coalesce(sum(order_record.total_millimes) filter (where order_record.status = 'done' and order_record.payment_method = 'other'), 0)::bigint as other_sales,
      coalesce(sum(order_record.total_millimes) filter (where order_record.status = 'done' and order_record.payment_method = 'tab'), 0)::bigint as tab_sales
    from public.orders order_record where order_record.shift_id = shift_record.id
  ) sales on true
  left join lateral (
    select coalesce(sum(case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end), 0)::bigint as amount_millimes
    from public.tabs tab where tab.shift_id = shift_record.id and tab.payment_method = 'cash'
      and tab.kind in ('settled', 'reversal') and tab.created_at between p_from and p_to
  ) tab_payments on true
  left join lateral (
    select coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'in'), 0)::bigint as cash_in,
      coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'out'), 0)::bigint as cash_out
    from public.cash_movements movement where movement.shift_id = shift_record.id
      and movement.created_at between p_from and p_to
  ) movements on true
  left join lateral (
    select coalesce(sum(adjustment.amount_millimes), 0)::bigint as amount_millimes,
      coalesce(sum(adjustment.amount_millimes) filter (where order_record.payment_method = 'cash'), 0)::bigint as cash_amount_millimes,
      coalesce(sum(adjustment.amount_millimes) filter (where adjustment.kind = 'requested'), 0)::bigint as requested_millimes,
      coalesce(sum(adjustment.amount_millimes) filter (where adjustment.kind = 'rejected'), 0)::bigint as rejected_millimes
    from public.shift_void_adjustments adjustment
    join public.orders order_record
      on order_record.id = adjustment.order_id
      and order_record.shift_id = adjustment.shift_id
      and order_record.store_id = adjustment.store_id
    where adjustment.shift_id = shift_record.id and adjustment.created_at between p_from and p_to
  ) adjustments on true
  where shift_record.store_id = p_store_id and shift_record.opened_at between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'customerId', totals.customer_id,
    'customerName', totals.customer_name,
    'issuedMillimes', totals.issued_millimes,
    'paymentsMillimes', totals.payments_millimes,
    'outstandingMillimes', totals.outstanding_millimes
  ) order by totals.customer_name), '[]'::jsonb),
    coalesce(sum(totals.outstanding_millimes), 0)::bigint,
    coalesce(sum(greatest(totals.outstanding_millimes, 0)), 0)::bigint,
    coalesce(sum(totals.issued_millimes), 0)::bigint,
    coalesce(sum(totals.payments_millimes), 0)::bigint
  into customer_tabs, tabs_outstanding_millimes, receivable_millimes, tabs_issued_millimes, tabs_settled_millimes
  from (
    select customer.id as customer_id, customer.name as customer_name,
      coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.customer_id = customer.id
          and order_record.payment_method = 'tab'
          and order_record.status = 'done'
          and order_record.created_at between p_from and p_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'issued'
          and (tab.order_id is null or not exists (
            select 1 from public.orders linked_order
            where linked_order.id = tab.order_id and linked_order.payment_method = 'tab'
          ))
          and tab.created_at between p_from and p_to
      ), 0) as issued_millimes,
      coalesce((
        select sum(case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind in ('settled', 'reversal')
          and tab.created_at between p_from and p_to
      ), 0) as payments_millimes,
      coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.customer_id = customer.id
          and order_record.payment_method = 'tab'
          and order_record.created_at <= p_to
          and order_record.status <> 'pending_void'
          and not (order_record.status = 'voided' and order_record.voided_at <= p_to)
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'issued'
          and (tab.order_id is null or not exists (
            select 1 from public.orders linked_order
            where linked_order.id = tab.order_id and linked_order.payment_method = 'tab'
          ))
          and tab.created_at <= p_to
      ), 0) - coalesce((
        select sum(tab.amount_millimes) from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'settled' and tab.created_at <= p_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes) from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'reversal' and tab.created_at <= p_to
      ), 0) as outstanding_millimes
    from public.customers customer
    where customer.store_id = p_store_id
  ) totals
  where totals.issued_millimes <> 0 or totals.payments_millimes <> 0 or totals.outstanding_millimes <> 0;

  select coalesce(sum(case when tab.payment_method = 'cash' then
      case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end else 0 end), 0)::bigint,
    coalesce(sum(case when tab.payment_method <> 'cash' then
      case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end else 0 end), 0)::bigint,
    coalesce(sum(case when tab.payment_method = 'card' then
      case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end else 0 end), 0)::bigint,
    coalesce(sum(case when tab.payment_method = 'other' then
      case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end else 0 end), 0)::bigint
  into tabs_settled_millimes, non_cash_tab_payments_millimes, card_tab_payments_millimes, other_tab_payments_millimes
  from public.tabs tab
  where tab.store_id = p_store_id
    and tab.kind in ('settled', 'reversal')
    and tab.created_at between p_from and p_to;
  select coalesce(sum(total_millimes), 0)::bigint
  into tabs_issued_millimes
  from public.orders
  where store_id = p_store_id
    and status = 'done'
    and payment_method = 'tab'
    and created_at between p_from and p_to;

  select coalesce(sum(tab.amount_millimes), 0)::bigint
  into cash_refunds_millimes
  from public.tabs tab
  join public.shifts shift_record on shift_record.id = tab.shift_id
  where tab.store_id = p_store_id
    and tab.kind = 'reversal'
    and tab.payment_method = 'cash'
    and tab.created_at between p_from and p_to
    and shift_record.closed_at is not null
    and shift_record.closed_at < tab.created_at;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', to_char(day_start, 'YYYY-MM-DD'),
    'salesMillimes', coalesce(day_sales.amount_millimes, 0)
  ) order by day_start), '[]'::jsonb)
  into sales_by_day
  from generate_series(
    date_trunc('day', p_from at time zone store_timezone),
    date_trunc('day', p_to at time zone store_timezone),
    interval '1 day'
  ) as days(day_start)
  left join lateral (
    select sum(order_record.total_millimes)::bigint as amount_millimes
    from public.orders order_record
    where order_record.store_id = p_store_id
      and order_record.status = 'done'
      and order_record.created_at at time zone store_timezone >= day_start
      and order_record.created_at at time zone store_timezone < day_start + interval '1 day'
  ) day_sales on true;

  select coalesce(jsonb_agg(jsonb_build_object('hour', hours.hour, 'orders', coalesce(hour_orders.order_count, 0)) order by hours.hour), '[]'::jsonb)
  into sales_by_hour
  from generate_series(0, 23) hours(hour)
  left join lateral (
    select count(*)::bigint as order_count
    from public.orders order_record
    where order_record.store_id = p_store_id and order_record.status = 'done'
      and order_record.created_at between p_from and p_to
      and extract(hour from order_record.created_at at time zone store_timezone) = hours.hour
  ) hour_orders on true;

  select coalesce(sum(total_millimes), 0)::bigint
  into sales_today
  from public.orders
  where store_id = p_store_id and status = 'done'
    and created_at at time zone store_timezone >= date_trunc('day', now() at time zone store_timezone)
    and created_at <= now();

  select coalesce(sum(total_millimes), 0)::bigint
  into sales_last_week
  from public.orders
  where store_id = p_store_id and status = 'done'
    and created_at at time zone store_timezone >= (date_trunc('day', now() at time zone store_timezone) - interval '7 days')
    and created_at at time zone store_timezone < (date_trunc('day', now() at time zone store_timezone) - interval '6 days');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', order_record.id,
    'number', order_record.number,
    'storeId', order_record.store_id,
    'businessDate', order_record.business_date,
    'staffId', order_record.staff_id,
    'staffName', staff.name,
    'shiftId', order_record.shift_id,
    'location', order_record.location,
    'status', order_record.status,
    'paymentMethod', order_record.payment_method,
    'customerId', order_record.customer_id,
    'note', order_record.note,
    'totalMillimes', order_record.total_millimes,
    'createdAt', order_record.created_at,
    'voidRequestedAt', order_record.void_requested_at,
    'voidedAt', order_record.voided_at,
    'voidedBy', order_record.voided_by,
    'voidedByUserId', order_record.voided_by_user_id,
    'voidReason', order_record.void_reason
  ) order by order_record.created_at desc), '[]'::jsonb)
  into recent_orders
  from (
    select * from public.orders
    where store_id = p_store_id and created_at between p_from and p_to
    order by created_at desc
    limit 6
  ) order_record
  join public.profiles staff on staff.id = order_record.staff_id;

  select coalesce(sum((entry->>'expectedCashMillimes')::bigint), 0)::bigint,
    coalesce(sum((entry->>'startingCashMillimes')::bigint), 0)::bigint,
    coalesce(sum(case when entry->>'status' <> 'in_progress' then coalesce((entry->>'countedCashMillimes')::bigint, 0) else 0 end), 0)::bigint,
    coalesce(sum(case when entry->>'status' <> 'in_progress' then coalesce((entry->>'differenceMillimes')::bigint, 0) else 0 end), 0)::bigint,
    coalesce(sum((entry->>'cashSalesMillimes')::bigint), 0)::bigint
  into total_expected_cash_millimes, cash_float_millimes, total_counted_millimes, total_difference_millimes, cash_sales_millimes
  from jsonb_array_elements(shift_lines) entry;

  select coalesce(sum(adjustment.amount_millimes), 0)::bigint
  into expected_cash_ex_float_millimes
  from public.shift_void_adjustments adjustment
  join public.shifts shift_record on shift_record.id = adjustment.shift_id
  where shift_record.store_id = p_store_id
    and adjustment.created_at between p_from and p_to
    and not exists (
      select 1 from jsonb_array_elements(shift_lines) entry
      where entry->>'shiftId' = adjustment.shift_id::text
    );
  total_expected_cash_millimes := total_expected_cash_millimes + expected_cash_ex_float_millimes - cash_refunds_millimes;
  expected_cash_ex_float_millimes := total_expected_cash_millimes - cash_float_millimes;
  cash_difference_millimes := total_difference_millimes;
  sales_collected_millimes := (payment_split->>'cash')::bigint + (payment_split->>'card')::bigint
    + (payment_split->>'other')::bigint + tabs_settled_millimes + non_cash_tab_payments_millimes;

  return jsonb_build_object(
    'salesMillimes', sales_millimes,
    'salesCollectedMillimes', sales_collected_millimes,
    'expensesMillimes', expenses_millimes,
    'netProfitMillimes', sales_collected_millimes - expenses_millimes,
    'receivableMillimes', receivable_millimes,
    'orderCount', order_count,
    'firstTicketNumber', first_ticket,
    'lastTicketNumber', last_ticket,
    'cashDifferenceMillimes', cash_difference_millimes,
    'topItems', top_items,
    'shifts', '[]'::jsonb,
    'salesByCategory', sales_by_category,
    'itemsSold', items_sold,
    'voids', voids,
    'pendingVoids', pending_voids,
    'comps', comps,
    'shiftLines', shift_lines,
    'paymentSplit', payment_split,
    'totalExpectedCashMillimes', total_expected_cash_millimes,
    'expectedCashExFloatMillimes', expected_cash_ex_float_millimes,
    'totalCountedMillimes', total_counted_millimes,
    'totalDifferenceMillimes', total_difference_millimes,
    'cashSalesMillimes', cash_sales_millimes,
    'tabSalesMillimes', (payment_split->>'tab')::bigint,
    'tabPaymentsReceivedMillimes', tabs_settled_millimes,
    'cashFloatMillimes', cash_float_millimes,
    'cashInMillimes', cash_in_millimes,
    'cashOutMillimes', cash_out_millimes,
    'cashRefundsMillimes', cash_refunds_millimes,
    'cashMovements', cash_movements,
    'voidAdjustments', void_adjustments,
    'employeeBreakdown', employee_breakdown,
    'cashOuts', cash_outs,
    'expenseDetails', expense_details,
    'customerTabs', customer_tabs,
    'tabsIssuedMillimes', tabs_issued_millimes,
    'tabsSettledMillimes', tabs_settled_millimes,
    'nonCashTabPaymentsMillimes', non_cash_tab_payments_millimes,
    'cardTabPaymentsMillimes', card_tab_payments_millimes,
    'otherTabPaymentsMillimes', other_tab_payments_millimes,
    'tabsOutstandingMillimes', tabs_outstanding_millimes,
    'salesByDay', sales_by_day,
    'salesByHour', sales_by_hour,
    'salesTodayMillimes', sales_today,
    'salesLastWeekMillimes', sales_last_week,
    'recentOrders', recent_orders
  );
end
$$;

revoke all on function public.get_customers_credit_status(uuid) from public, anon;
revoke all on function public.get_shift_summary(uuid) from public, anon;
revoke all on function public.get_dashboard_summary(uuid, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.get_customers_credit_status(uuid) to authenticated;
grant execute on function public.get_shift_summary(uuid) to authenticated;
grant execute on function public.get_dashboard_summary(uuid, timestamptz, timestamptz, boolean) to authenticated;
