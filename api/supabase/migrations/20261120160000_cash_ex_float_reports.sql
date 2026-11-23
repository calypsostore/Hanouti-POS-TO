create or replace function public.get_shift_expected_cash(p_shift_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
begin
  select * into target from public.shifts s where s.id = p_shift_id;
  if not found or target.store_id <> (select public.current_store_id())
    or not (
      public.is_store_owner(target.store_id)
      or (
        target.staff_id = (select auth.uid())
        and public.has_store_permission('open_close_shift')
      )
    ) then
    raise exception 'Not authorized to view expected shift cash.' using errcode = '42501';
  end if;

  return target.starting_cash_millimes
    + coalesce((
      select sum(o.total_millimes)
      from public.orders o
      where o.shift_id = target.id
        and o.status in ('done', 'pending_void')
        and o.payment_method = 'cash'
    ), 0)
    + coalesce((
      select sum(o.total_millimes)
      from public.orders o
      where o.shift_id = target.id
        and o.status = 'voided'
        and o.payment_method = 'cash'
        and exists (
          select 1
          from public.shift_void_adjustments a
          where a.shift_id = o.shift_id
            and a.store_id = o.store_id
            and a.order_id = o.id
        )
    ), 0)
    + coalesce((
      select sum(case when t.kind = 'settled' then t.amount_millimes else -t.amount_millimes end)
      from public.tabs t
      where t.shift_id = target.id
        and t.kind in ('settled', 'reversal')
        and t.payment_method = 'cash'
    ), 0)
    + coalesce((
      select sum(case when m.kind = 'in' then m.amount_millimes else -m.amount_millimes end)
      from public.cash_movements m
      where m.shift_id = target.id
    ), 0)
    + coalesce((
      select sum(a.amount_millimes)
      from public.shift_void_adjustments a
      join public.orders o
        on o.id = a.order_id
        and o.shift_id = a.shift_id
        and o.store_id = a.store_id
      where a.shift_id = target.id
        and o.payment_method = 'cash'
    ), 0);
end
$$;

create or replace function public.close_shift(
  p_shift_id uuid,
  p_counted_cash_millimes bigint,
  p_difference_note text default null
)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
  expected bigint;
  difference bigint;
  v_note text;
  result public.shifts%rowtype;
begin
  select * into target from public.shifts s where s.id = p_shift_id for update;
  if not found or target.status <> 'open' or target.store_id <> (select public.current_store_id())
    or not (target.staff_id = auth.uid() or public.is_store_owner(target.store_id)) then
    raise exception 'Not authorized to close this shift.' using errcode = '42501';
  end if;
  if target.staff_id <> auth.uid() and not public.is_store_owner(target.store_id) then
    raise exception 'Only the shift owner can close it.' using errcode = '42501';
  end if;
  if target.staff_id = auth.uid() and not public.has_store_permission('open_close_shift') then
    raise exception 'Shift permission is required.' using errcode = '42501';
  end if;
  if p_counted_cash_millimes is null or p_counted_cash_millimes < 0 then
    raise exception 'Counted cash must not be negative.';
  end if;

  expected := public.get_shift_expected_cash(target.id);
  difference := p_counted_cash_millimes - expected;
  v_note := nullif(btrim(p_difference_note), '');
  if length(v_note) > 200 or (difference <> 0 and v_note is null) then
    raise exception 'A short note is required for a cash difference.';
  end if;
  update public.shifts as shift
  set status = 'closed',
      counted_cash_millimes = p_counted_cash_millimes,
      expected_cash_millimes = expected,
      difference_millimes = difference,
      difference_note = v_note,
      closed_at = now(),
      closed_by_user_id = auth.uid()
  where shift.id = target.id
  returning shift.* into result;
  return result;
end
$$;

create or replace function public.force_close_shift(
  p_shift_id uuid,
  p_counted_cash_millimes bigint,
  p_difference_note text default null
)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
  expected bigint;
  difference bigint;
  v_note text;
  result public.shifts%rowtype;
begin
  select * into target from public.shifts s where s.id = p_shift_id for update;
  if not found or target.status <> 'open' or not public.is_store_owner(target.store_id) then
    raise exception 'Only this store owner can force-close the shift.' using errcode = '42501';
  end if;
  if p_counted_cash_millimes is null or p_counted_cash_millimes < 0 then
    raise exception 'Counted cash must not be negative.';
  end if;

  expected := public.get_shift_expected_cash(target.id);
  difference := p_counted_cash_millimes - expected;
  v_note := nullif(btrim(p_difference_note), '');
  if length(v_note) > 200 or (difference <> 0 and v_note is null) then
    raise exception 'A short note is required for a cash difference.';
  end if;
  update public.shifts as shift
  set status = 'closed',
      counted_cash_millimes = p_counted_cash_millimes,
      expected_cash_millimes = expected,
      difference_millimes = difference,
      difference_note = v_note,
      closed_at = now(),
      closed_by_user_id = auth.uid(),
      force_closed_by_owner = true
  where shift.id = target.id
  returning shift.* into result;
  return result;
end
$$;

create or replace function public.record_report(p_report jsonb, p_pin text default null)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_store public.stores%rowtype;
  v_report_type text;
  v_business_day date;
  v_assigned_z_number integer;
  v_result public.reports%rowtype;
  v_server_order_count integer;
  v_server_sales bigint;
  v_snapshot_order_count integer;
  v_snapshot_sales bigint;
  v_snapshot_expected_cash bigint;
  v_snapshot_expected_cash_ex_float bigint;
  v_snapshot_counted_cash bigint;
  v_server_expected_cash bigint;
  v_server_cash_float bigint;
  v_post_close_void_adjustments bigint;
  v_snapshot_cash_difference bigint;
  v_period_from timestamptz;
  v_period_to timestamptz;
  v_report_created_at timestamptz;
  v_expected_period_from timestamptz;
  v_previous_z_period_to timestamptz;
begin
  select profile.*
    into v_actor
  from public.profiles as profile
  where profile.id = auth.uid()
    and profile.is_active;

  select store.*
    into v_store
  from public.stores as store
  where store.store_id = v_actor.store_id
  for update;

  if v_actor.id is null or v_actor.role <> 'owner' or v_store.store_id is null then
    raise exception 'Only this store owner can record reports.' using errcode = '42501';
  end if;

  v_report_type := nullif(p_report->>'type', '');
  v_business_day := (now() at time zone v_store.timezone)::date;
  v_snapshot_order_count := nullif(p_report->>'orderCount', '')::integer;
  v_snapshot_sales := nullif(p_report->>'salesMillimes', '')::bigint;
  v_period_from := nullif(p_report->>'periodFrom', 'null')::timestamptz;
  v_period_to := nullif(p_report->>'periodTo', 'null')::timestamptz;
  v_report_created_at := nullif(p_report->>'createdAt', 'null')::timestamptz;

  if v_report_type is null
    or v_report_type not in ('X', 'Z')
    or v_snapshot_order_count is null
    or v_snapshot_order_count < 0
    or v_snapshot_sales is null
    or v_snapshot_sales < 0
    or nullif(p_report->>'cashDifferenceMillimes', '') is null
    or v_period_from is null
    or v_period_to is null
    or v_report_created_at is null
    or v_period_from > v_period_to
    or v_period_to is distinct from v_report_created_at
    or v_period_to < now() - interval '5 minutes'
    or v_period_to > now() + interval '30 seconds' then
    raise exception 'Report details or period are invalid.';
  end if;

  select coalesce(report.period_to, report.created_at)
    into v_previous_z_period_to
  from public.reports as report
  where report.store_id = v_store.store_id
    and report.type = 'Z'
  order by report.created_at desc
  limit 1;

  v_expected_period_from := coalesce(
    v_previous_z_period_to,
    v_business_day::timestamp at time zone v_store.timezone
  );

  if v_period_from is distinct from v_expected_period_from then
    raise exception 'Report period does not begin after the last Z close.';
  end if;

  select count(*)::integer,
         coalesce(sum(order_record.total_millimes), 0)::bigint
    into v_server_order_count, v_server_sales
  from public.orders as order_record
  where order_record.store_id = v_store.store_id
    and order_record.status = 'done'
    and order_record.created_at >= v_period_from
    and order_record.created_at <= v_period_to;

  if v_server_order_count <> v_snapshot_order_count or v_server_sales <> v_snapshot_sales then
    raise exception 'Report totals do not match persisted orders.';
  end if;

  if v_report_type = 'Z' then
    if exists (
      select 1
      from public.shifts as shift
      where shift.store_id = v_store.store_id
        and shift.status = 'open'
    ) then
      raise exception 'Force-close or close every shift before creating a Z report.';
    end if;

    v_snapshot_expected_cash := nullif(p_report->>'totalExpectedCashMillimes', 'null')::bigint;
    v_snapshot_expected_cash_ex_float := nullif(p_report->>'expectedCashExFloatMillimes', 'null')::bigint;
    v_snapshot_counted_cash := nullif(p_report->>'countedCashMillimes', 'null')::bigint;
    v_snapshot_cash_difference := nullif(p_report->>'cashDifferenceMillimes', '')::bigint;

    if v_snapshot_expected_cash is null
      or v_snapshot_expected_cash_ex_float is null
      or v_snapshot_counted_cash is null
      or v_snapshot_counted_cash < 0
      or v_snapshot_cash_difference is distinct from v_snapshot_counted_cash - v_snapshot_expected_cash_ex_float then
      raise exception 'Z cash totals are incomplete or do not reconcile.';
    end if;

    select coalesce(sum(shift.expected_cash_millimes), 0)::bigint,
           coalesce(sum(shift.starting_cash_millimes), 0)::bigint
      into v_server_expected_cash, v_server_cash_float
    from public.shifts as shift
    where shift.store_id = v_store.store_id
      and shift.status = 'closed'
      and shift.opened_at <= v_period_to
      and shift.closed_at >= v_period_from
      and shift.closed_at <= v_period_to;

    select coalesce(sum(adjustment.amount_millimes), 0)::bigint
      into v_post_close_void_adjustments
    from public.shift_void_adjustments as adjustment
    join public.shifts as shift
      on shift.id = adjustment.shift_id
      and shift.store_id = adjustment.store_id
    where adjustment.store_id = v_store.store_id
      and adjustment.created_at >= v_period_from
      and adjustment.created_at <= v_period_to
      and adjustment.created_at > shift.closed_at;

    v_server_expected_cash := v_server_expected_cash + v_post_close_void_adjustments;
    if v_server_expected_cash <> v_snapshot_expected_cash then
      raise exception 'Z expected cash does not match the closed shift ledger.';
    end if;
    if v_snapshot_expected_cash_ex_float <> v_server_expected_cash - v_server_cash_float then
      raise exception 'Z expected cash excluding float does not match the closed shift ledger.';
    end if;

    if nullif(p_pin, '') is null
      or not public.verify_store_pin(v_store.store_id, p_pin, 'z_report') then
      raise exception 'Incorrect owner PIN.';
    end if;

    select coalesce(max(report.z_number), 0) + 1
      into v_assigned_z_number
    from public.reports as report
    where report.store_id = v_store.store_id
      and report.type = 'Z';

    update public.stores as store
    set day_closed_on = v_business_day
    where store.store_id = v_store.store_id;
  end if;

  insert into public.reports (
    store_id, type, business_date, created_at, sales_millimes, sales_collected_millimes,
    expenses_millimes, net_profit_millimes, receivable_millimes, order_count,
    cash_difference_millimes, z_number, period_from, period_to, generated_by, data
  ) values (
    v_store.store_id,
    v_report_type,
    v_business_day,
    now(),
    v_snapshot_sales,
    nullif(p_report->>'salesCollectedMillimes', 'null')::bigint,
    nullif(p_report->>'expensesMillimes', 'null')::bigint,
    nullif(p_report->>'netProfitMillimes', 'null')::bigint,
    nullif(p_report->>'receivableMillimes', 'null')::bigint,
    v_snapshot_order_count,
    (p_report->>'cashDifferenceMillimes')::bigint,
    v_assigned_z_number,
    v_period_from,
    v_period_to,
    v_actor.id,
    p_report
  ) returning * into v_result;

  return v_result;
end
$$;

revoke all on function public.close_shift(uuid, bigint, text) from public, anon;
revoke all on function public.force_close_shift(uuid, bigint, text) from public, anon;
revoke all on function public.get_shift_expected_cash(uuid) from public, anon;
revoke all on function public.record_report(jsonb, text) from public, anon;
grant execute on function public.close_shift(uuid, bigint, text) to authenticated;
grant execute on function public.force_close_shift(uuid, bigint, text) to authenticated;
grant execute on function public.get_shift_expected_cash(uuid) to authenticated;
grant execute on function public.record_report(jsonb, text) to authenticated;

update public.app_schema_version
set version = 20261120160000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
