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
  v_snapshot_counted_cash bigint;
  v_server_expected_cash bigint;
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
    v_snapshot_counted_cash := nullif(p_report->>'countedCashMillimes', 'null')::bigint;
    v_snapshot_cash_difference := nullif(p_report->>'cashDifferenceMillimes', '')::bigint;

    if v_snapshot_expected_cash is null
      or v_snapshot_counted_cash is null
      or v_snapshot_counted_cash < 0
      or v_snapshot_cash_difference is distinct from v_snapshot_counted_cash - v_snapshot_expected_cash then
      raise exception 'Z cash totals are incomplete or do not reconcile.';
    end if;

    select coalesce(sum(shift.expected_cash_millimes), 0)::bigint
      into v_server_expected_cash
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

revoke all on function public.record_report(jsonb, text) from public, anon;
grant execute on function public.record_report(jsonb, text) to authenticated;

update public.app_schema_version
set version = 20261120135000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
