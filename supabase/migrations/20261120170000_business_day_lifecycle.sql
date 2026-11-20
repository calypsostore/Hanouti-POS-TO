do $$
declare
  definition text;
  original text;
  replacement text;
begin
  definition := pg_get_functiondef('public.record_report(jsonb,text)'::regprocedure);

  original := '  v_previous_z_period_to timestamptz;';
  if position(original in definition) = 0 then
    raise exception 'Could not locate record_report declaration for business-day validation.';
  end if;
  definition := replace(definition, original, original || E'\n  v_has_activity boolean;');

  original := $find$  v_report_type := nullif(p_report->>'type', '');$find$;
  replacement := $insert$
  select coalesce(report.period_to, report.created_at)
    into v_previous_z_period_to
  from public.reports as report
  where report.store_id = v_store.store_id
    and report.type = 'Z'
  order by report.created_at desc
  limit 1;

  v_has_activity := exists (
    select 1
    from public.shifts as shift
    where shift.store_id = v_store.store_id
      and (v_previous_z_period_to is null or shift.opened_at > v_previous_z_period_to)
  );
  if not v_has_activity then
    raise exception 'The business day is closed. Open a new shift before creating another report.';
  end if;

  v_report_type := nullif(p_report->>'type', '');
$insert$;
  if position(original in definition) = 0 then
    raise exception 'Could not locate record_report checks for business-day validation.';
  end if;
  definition := replace(definition, original, replacement);
  execute definition;

  definition := pg_get_functiondef('public.create_order(uuid,jsonb,text,uuid,text,text,text)'::regprocedure);
  original := $find$
  if target_store.day_closed_on = business_day then
    raise exception 'The business day is closed. Open a new shift to continue.';
  end if;
$find$;
  if position(original in definition) = 0 then
    raise exception 'Could not locate date-based business-day validation in create_order.';
  end if;
  definition := replace(definition, original, '');
  original := $find$  if not found then raise exception 'Open a shift before taking orders.'; end if;$find$;
  replacement := $insert$  if not found then raise exception 'The business day is closed. Open a new shift to continue.'; end if;$insert$;
  if position(original in definition) = 0 then
    raise exception 'Could not locate open-shift validation in create_order.';
  end if;
  definition := replace(definition, original, replacement);
  execute definition;

  definition := pg_get_functiondef('public.record_cash_movement(uuid,text,bigint,text,text)'::regprocedure);
  original := $find$
  if actor.id is null or not found or target.store_id <> actor.store_id or target.status <> 'open'
    or not (
      public.is_store_owner(target.store_id)
      or (target.staff_id = actor.id and public.has_store_permission('cash_in_out'))
    ) then
    raise exception 'Not authorized to record a cash movement.' using errcode = '42501';
  end if;
$find$;
  replacement := $insert$
  if actor.id is null then
    raise exception 'Not authorized to record a cash movement.' using errcode = '42501';
  end if;
  if not found or target.status <> 'open' then
    raise exception 'The business day is closed. Open a new shift to continue.';
  end if;
  if target.store_id <> actor.store_id
    or not (
      public.is_store_owner(target.store_id)
      or (target.staff_id = actor.id and public.has_store_permission('cash_in_out'))
    ) then
    raise exception 'Not authorized to record a cash movement.' using errcode = '42501';
  end if;
$insert$;
  if position(original in definition) = 0 then
    raise exception 'Could not locate open-shift validation in record_cash_movement.';
  end if;
  definition := replace(definition, original, replacement);
  execute definition;

  definition := pg_get_functiondef('public.settle_customer_tab(uuid,bigint,uuid,text,text)'::regprocedure);
  original := $find$
  if actor.id is null or target_customer.id is null or target_shift.id is null
    or (actor.role <> 'owner' and not public.has_store_permission('settle_tabs')) then
    raise exception 'Not authorized to take a tab payment.' using errcode = '42501';
  end if;
$find$;
  replacement := $insert$
  if actor.id is null then
    raise exception 'Not authorized to take a tab payment.' using errcode = '42501';
  end if;
  if target_shift.id is null then
    raise exception 'The business day is closed. Open a new shift to continue.';
  end if;
  if target_customer.id is null
    or (actor.role <> 'owner' and not public.has_store_permission('settle_tabs')) then
    raise exception 'Not authorized to take a tab payment.' using errcode = '42501';
  end if;
$insert$;
  if position(original in definition) = 0 then
    raise exception 'Could not locate open-shift validation in settle_customer_tab.';
  end if;
  definition := replace(definition, original, replacement);
  execute definition;
end
$$;

create or replace function public.get_business_day_status(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  last_z public.reports%rowtype;
  last_z_period_to timestamptz;
  has_activity boolean;
  open_shift_count integer;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  if actor.id is null or actor.store_id is distinct from p_store_id then
    raise exception 'An active account for this store is required.' using errcode = '42501';
  end if;

  select report.* into last_z
  from public.reports as report
  where report.store_id = p_store_id
    and report.type = 'Z'
  order by report.created_at desc
  limit 1;
  last_z_period_to := coalesce(last_z.period_to, last_z.created_at);

  select exists (
    select 1
    from public.shifts as shift
    where shift.store_id = p_store_id
      and (last_z_period_to is null or shift.opened_at > last_z_period_to)
  ) into has_activity;

  select count(*)::integer into open_shift_count
  from public.shifts as shift
  where shift.store_id = p_store_id
    and shift.status = 'open';

  return jsonb_build_object(
    'dayIsClosed', last_z.id is not null and not has_activity,
    'hasActivity', has_activity,
    'openShiftCount', open_shift_count,
    'lastZ', case when last_z.id is null then null else jsonb_build_object(
      'reportNumber', coalesce(
        last_z.data ->> 'reportNumber',
        'Z-' || lpad(coalesce(last_z.z_number, 0)::text, 6, '0')
      ),
      'createdAt', last_z.created_at
    ) end
  );
end
$$;

revoke all on function public.get_business_day_status(uuid) from public, anon;
grant execute on function public.get_business_day_status(uuid) to authenticated;

update public.app_schema_version
set version = 20261120170000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
