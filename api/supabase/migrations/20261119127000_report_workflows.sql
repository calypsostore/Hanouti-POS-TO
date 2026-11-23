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
begin
  select * into actor from public.profiles
  where id = (select auth.uid()) and is_active;
  select * into target_store from public.stores
  where store_id = actor.store_id
  for update;
  if actor.id is null or actor.role <> 'owner' or target_store.store_id is null then
    raise exception 'Only this store owner can record reports.' using errcode = '42501';
  end if;
  report_type := p_report->>'type';
  business_day := (now() at time zone target_store.timezone)::date;
  if report_type not in ('X', 'Z')
    or nullif(p_report->>'salesMillimes', '') is null
    or nullif(p_report->>'orderCount', '') is null
    or nullif(p_report->>'cashDifferenceMillimes', '') is null then
    raise exception 'Report details are invalid.';
  end if;
  if report_type = 'Z' then
    if exists (
      select 1 from public.shifts
      where store_id = target_store.store_id and status = 'open'
    ) then
      raise exception 'Force-close or close every shift before creating a Z report.';
    end if;
    if target_store.day_closed_on = business_day
      and not public.verify_store_pin(target_store.store_id, p_pin, 'z_report') then
      raise exception 'Incorrect owner PIN.';
    end if;
    select coalesce(max(z_number), 0) + 1 into assigned_z_number
    from public.reports
    where store_id = target_store.store_id and type = 'Z';
    update public.stores set day_closed_on = business_day where store_id = target_store.store_id;
  end if;

  insert into public.reports (
    store_id, type, business_date, created_at, sales_millimes, sales_collected_millimes,
    expenses_millimes, net_profit_millimes, receivable_millimes, order_count,
    cash_difference_millimes, z_number, period_from, period_to, generated_by, data
  ) values (
    target_store.store_id,
    report_type,
    business_day,
    now(),
    (p_report->>'salesMillimes')::bigint,
    nullif(p_report->>'salesCollectedMillimes', 'null')::bigint,
    nullif(p_report->>'expensesMillimes', 'null')::bigint,
    nullif(p_report->>'netProfitMillimes', 'null')::bigint,
    nullif(p_report->>'receivableMillimes', 'null')::bigint,
    (p_report->>'orderCount')::integer,
    (p_report->>'cashDifferenceMillimes')::bigint,
    assigned_z_number,
    nullif(p_report->>'periodFrom', 'null')::timestamptz::date,
    nullif(p_report->>'periodTo', 'null')::timestamptz::date,
    actor.id,
    p_report
  ) returning * into result;
  return result;
end
$$;

revoke all on function public.record_report(jsonb, text) from public, anon;
grant execute on function public.record_report(jsonb, text) to authenticated;
