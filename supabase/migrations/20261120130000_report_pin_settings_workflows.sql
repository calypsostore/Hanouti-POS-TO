alter table public.stores
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists tax_id text;

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
begin
  select * into v_actor
  from public.profiles
  where id = auth.uid() and is_active;
  select * into v_store
  from public.stores
  where store_id = v_actor.store_id
  for update;
  if v_actor.id is null or v_actor.role <> 'owner' or v_store.store_id is null then
    raise exception 'Only this store owner can record reports.' using errcode = '42501';
  end if;

  v_report_type := nullif(p_report->>'type', '');
  v_business_day := (now() at time zone v_store.timezone)::date;
  v_snapshot_order_count := nullif(p_report->>'orderCount', '')::integer;
  v_snapshot_sales := nullif(p_report->>'salesMillimes', '')::bigint;
  if v_report_type not in ('X', 'Z')
    or v_snapshot_order_count is null
    or v_snapshot_sales is null
    or nullif(p_report->>'cashDifferenceMillimes', '') is null then
    raise exception 'Report details are invalid.';
  end if;

  select count(*)::integer,
         coalesce(sum(o.total_millimes) filter (where o.status = 'done'), 0)::bigint
    into v_server_order_count, v_server_sales
  from public.orders o
  where o.store_id = v_store.store_id
    and o.status = 'done'
    and o.created_at >= ((v_business_day::timestamp at time zone v_store.timezone))
    and o.created_at < (((v_business_day + 1)::timestamp at time zone v_store.timezone));

  if v_server_order_count <> v_snapshot_order_count or v_server_sales <> v_snapshot_sales then
    raise exception 'Report totals do not match persisted orders.';
  end if;
  if v_report_type = 'Z' then
    if exists (
      select 1 from public.shifts
      where store_id = v_store.store_id and status = 'open'
    ) then
      raise exception 'Force-close or close every shift before creating a Z report.';
    end if;
    if nullif(p_pin, '') is null
      or not public.verify_store_pin(v_store.store_id, p_pin, 'z_report') then
      raise exception 'Incorrect owner PIN.';
    end if;
    select coalesce(max(z_number), 0) + 1 into v_assigned_z_number
    from public.reports
    where store_id = v_store.store_id and type = 'Z';
    update public.stores
    set day_closed_on = v_business_day
    where store_id = v_store.store_id;
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
    nullif(p_report->>'periodFrom', 'null')::timestamptz,
    nullif(p_report->>'periodTo', 'null')::timestamptz,
    v_actor.id,
    p_report
  ) returning * into v_result;
  return v_result;
end
$$;

revoke all on function public.record_report(jsonb, text) from public, anon;
grant execute on function public.record_report(jsonb, text) to authenticated;

update public.app_schema_version
set version = 20261120130000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
