create or replace function public.try_parse_z_report_timestamp(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null
    or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$' then
    return null;
  end if;
  return p_value::timestamptz;
exception
  when datetime_field_overflow
    or invalid_datetime_format
    or invalid_time_zone_displacement_value then
    return null;
end
$$;

revoke all on function public.try_parse_z_report_timestamp(text) from public, anon, authenticated;

alter table public.reports
  alter column period_from type timestamptz
    using coalesce(
      public.try_parse_z_report_timestamp(data->>'periodFrom'),
      (period_from::timestamp without time zone) at time zone 'UTC'
    ),
  alter column period_to type timestamptz
    using coalesce(
      public.try_parse_z_report_timestamp(data->>'periodTo'),
      (period_to::timestamp without time zone) at time zone 'UTC'
    );

comment on column public.reports.period_from is
  'Exact Z/X period start for new reports. Legacy DATE values are represented as midnight UTC only when no full timestamp survives in data; this deterministic conversion does not recover the lost time and is not a Z boundary.';
comment on column public.reports.period_to is
  'Exact Z/X period end for new reports. Legacy DATE values are represented as midnight UTC only when no full timestamp survives in data; lifecycle boundaries come from a valid timezone-qualified data.periodTo snapshot or report.created_at, never this column.';

create or replace function public.get_last_z_report_boundary(p_store_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  report_created_at timestamptz;
  snapshot_period_to text;
begin
  select report.created_at, report.data->>'periodTo'
  into report_created_at, snapshot_period_to
  from public.reports report
  where report.store_id = p_store_id
    and report.type = 'Z'
  order by report.created_at desc, report.id desc
  limit 1;

  if not found then
    return null;
  end if;

  return coalesce(
    public.try_parse_z_report_timestamp(snapshot_period_to),
    report_created_at
  );
end
$$;

revoke all on function public.get_last_z_report_boundary(uuid) from public, anon, authenticated;

create table public.z_reported_shifts (
  store_id uuid not null references public.stores(store_id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete restrict,
  report_id uuid not null references public.reports(id) on delete restrict,
  reported_at timestamptz not null,
  primary key (store_id, shift_id)
);

alter table public.z_reported_shifts enable row level security;
revoke all on public.z_reported_shifts from public, anon, authenticated;

create index z_reported_shifts_shift_id_idx
  on public.z_reported_shifts (shift_id);
create index z_reported_shifts_report_id_idx
  on public.z_reported_shifts (report_id);

with snapshot_shifts as (
  select
    report.store_id,
    report.id as report_id,
    report.created_at,
    case
      when snapshot_line->>'shiftId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then (snapshot_line->>'shiftId')::uuid
      else null
    end as shift_id
  from public.reports report
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(report.data->'shifts') = 'array' then report.data->'shifts'
      else '[]'::jsonb
    end
  ) snapshot_line
  where report.type = 'Z'
),
ranked_shifts as (
  select
    snapshot_shifts.*,
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
insert into public.z_reported_shifts (store_id, shift_id, report_id, reported_at)
select store_id, shift_id, report_id, created_at
from ranked_shifts
where assignment_order = 1;

do $$
declare
  definition text;
  original text;
  replacement text;
  replacement_count integer;
  lock_position integer;
  boundary_position integer;
begin
  definition := replace(
    pg_get_functiondef('public.record_report(jsonb,text)'::regprocedure),
    E'\r\n',
    E'\n'
  );

  original := '  for update;';
  replacement_count := (length(definition) - length(replace(definition, original, '')))
    / length(original);
  if replacement_count <> 1 then
    raise exception 'record_report must contain exactly one per-store row lock.';
  end if;
  lock_position := position(original in definition);

  original := '  select coalesce(report.period_to, report.created_at)';
  replacement_count := (length(definition) - length(replace(definition, original, '')))
    / length(original);
  if replacement_count <> 1 then
    raise exception 'record_report does not match the expected previous-Z boundary query.';
  end if;
  boundary_position := position(original in definition);
  if lock_position >= boundary_position then
    raise exception 'record_report must lock the store before reading the previous Z boundary.';
  end if;

  original := '  shift_count integer;';
  replacement_count := (length(definition) - length(replace(definition, original, '')))
    / length(original);
  if replacement_count <> 1 then
    raise exception 'record_report must contain exactly one shift-count declaration.';
  end if;
  definition := replace(definition, original, original || E'\n  registered_shift_count integer;');

  original := $find$
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
$find$;
  replacement := $insert$
  previous_z_at := public.get_last_z_report_boundary(target_store.store_id);
  select min(shift.opened_at)
  into expected_period_from
  from public.shifts shift
  where shift.store_id = target_store.store_id
    and shift.opened_at <= period_to
    and (previous_z_at is null or shift.opened_at > previous_z_at)
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );
  if expected_period_from is null then
    raise exception 'The business day is closed. Open a new shift before creating another report.';
  end if;
  if period_from is distinct from expected_period_from then
    raise exception 'Report period must begin when the first unreported shift after the previous Z opens.';
  end if;
$insert$;
  original := replace(original, E'\r\n', E'\n');
  replacement := replace(replacement, E'\r\n', E'\n');
  replacement_count := (length(definition) - length(replace(definition, original, '')))
    / length(original);
  if replacement_count <> 1 then
    raise exception 'record_report previous-Z boundary block differs from the expected definition.';
  end if;
  definition := replace(definition, original, replacement);

  original := $find$    and shift.opened_at >= period_from
    and shift.opened_at <= period_to;$find$;
  replacement := $insert$    and shift.opened_at >= period_from
    and shift.opened_at <= period_to
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );$insert$;
  original := replace(original, E'\r\n', E'\n');
  replacement := replace(replacement, E'\r\n', E'\n');
  replacement_count := (length(definition) - length(replace(definition, original, '')))
    / length(original);
  if replacement_count <> 2 then
    raise exception 'record_report must contain exactly two eligible-shift range filters.';
  end if;
  definition := replace(definition, original, replacement);

  original := $find$  if jsonb_typeof(p_report->'shifts') <> 'array'
    or jsonb_array_length(p_report->'shifts') <> shift_count then
    raise exception 'Report shift lines do not match persisted shifts.';
  end if;$find$;
  replacement := $insert$  if jsonb_typeof(p_report->'shifts') is distinct from 'array' then
    raise exception 'Report shift lines must be a JSON array.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_report->'shifts') as snapshot_line(value)
    where jsonb_typeof(snapshot_line.value) is distinct from 'object'
      or jsonb_typeof(snapshot_line.value->'shiftId') is distinct from 'string'
      or snapshot_line.value->>'shiftId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Report shift IDs must be valid UUIDs.';
  end if;
  if report_type = 'Z' and exists (
    select 1
    from jsonb_array_elements(p_report->'shifts') as snapshot_line(value)
    join public.z_reported_shifts reported
      on reported.store_id = target_store.store_id
      and reported.shift_id = (snapshot_line.value->>'shiftId')::uuid
  ) then
    raise exception 'A shift in this Z report was already included in a previous Z report.';
  end if;
  if jsonb_array_length(p_report->'shifts') <> shift_count then
    raise exception 'Report shift lines do not match persisted shifts.';
  end if;$insert$;
  original := replace(original, E'\r\n', E'\n');
  replacement := replace(replacement, E'\r\n', E'\n');
  replacement_count := (length(definition) - length(replace(definition, original, '')))
    / length(original);
  if replacement_count <> 1 then
    raise exception 'record_report shift snapshot validation differs from the expected definition.';
  end if;
  definition := replace(definition, original, replacement);

  original := $find$  into server_shift_lines
  from public.shifts shift
  join public.profiles profile on profile.id = shift.staff_id
  where shift.store_id = target_store.store_id
    and shift.opened_at >= period_from
    and shift.opened_at <= period_to
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );$find$;
  replacement := $insert$  into server_shift_lines
  from public.shifts shift
  join public.profiles profile on profile.id = shift.staff_id
  where shift.store_id = target_store.store_id
    and shift.opened_at >= period_from
    and shift.opened_at <= period_to
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );
  if jsonb_array_length(server_shift_lines) <> shift_count
    or exists (
      select 1
      from public.shifts eligible_shift
      where eligible_shift.store_id = target_store.store_id
        and eligible_shift.opened_at >= period_from
        and eligible_shift.opened_at <= period_to
        and not exists (
          select 1
          from public.z_reported_shifts reported
          where reported.store_id = eligible_shift.store_id
            and reported.shift_id = eligible_shift.id
        )
        and not exists (
          select 1
          from jsonb_array_elements(server_shift_lines) line
          where line->>'shiftId' = eligible_shift.id::text
        )
    )
    or exists (
      select 1
      from jsonb_array_elements(server_shift_lines) line
      where not exists (
        select 1
        from public.shifts eligible_shift
        where line->>'shiftId' = eligible_shift.id::text
          and eligible_shift.store_id = target_store.store_id
          and eligible_shift.opened_at >= period_from
          and eligible_shift.opened_at <= period_to
          and not exists (
            select 1
            from public.z_reported_shifts reported
            where reported.store_id = eligible_shift.store_id
              and reported.shift_id = eligible_shift.id
          )
      )
    ) then
    raise exception 'Server-selected shift lines do not match the eligible shift set.';
  end if;$insert$;
  original := replace(original, E'\r\n', E'\n');
  replacement := replace(replacement, E'\r\n', E'\n');
  replacement_count := (length(definition) - length(replace(definition, original, '')))
    / length(original);
  if replacement_count <> 1 then
    raise exception 'record_report server shift selection differs from the expected definition.';
  end if;
  definition := replace(definition, original, replacement);

  original := $find$      and shift.closed_at between period_from and period_to;$find$;
  replacement := $insert$      and shift.closed_at between period_from and period_to
      and not exists (
        select 1
        from public.z_reported_shifts reported
        where reported.store_id = shift.store_id
          and reported.shift_id = shift.id
      );$insert$;
  original := replace(original, E'\r\n', E'\n');
  replacement := replace(replacement, E'\r\n', E'\n');
  replacement_count := (length(definition) - length(replace(definition, original, '')))
    / length(original);
  if replacement_count <> 1 then
    raise exception 'record_report final Z cash shift filter differs from the expected definition.';
  end if;
  definition := replace(definition, original, replacement);

  original := '  ) returning * into result;';
  replacement := $insert$  ) returning * into result;
  if report_type = 'Z' then
    insert into public.z_reported_shifts (store_id, shift_id, report_id, reported_at)
    select target_store.store_id, (line->>'shiftId')::uuid, result.id, result.created_at
    from jsonb_array_elements(server_shift_lines) line
    on conflict (store_id, shift_id) do nothing;
    get diagnostics registered_shift_count = row_count;
    if registered_shift_count <> shift_count then
      raise exception 'One or more shifts have already been included in a Z report.';
    end if;
  end if;$insert$;
  replacement := replace(replacement, E'\r\n', E'\n');
  replacement_count := (length(definition) - length(replace(definition, original, '')))
    / length(original);
  if replacement_count <> 1 then
    raise exception 'record_report result insertion point differs from the expected definition.';
  end if;
  definition := replace(definition, original, replacement);

  lock_position := position('  for update;' in definition);
  boundary_position := position(
    '  previous_z_at := public.get_last_z_report_boundary(target_store.store_id);'
    in definition
  );
  if lock_position = 0 or boundary_position = 0 or lock_position >= boundary_position then
    raise exception 'record_report must retain the per-store lock before calculating eligible shifts.';
  end if;

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
  next_period_from timestamptz;
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
  order by report.created_at desc, report.id desc
  limit 1;
  last_z_period_to := public.get_last_z_report_boundary(p_store_id);

  select min(shift.opened_at)
  into next_period_from
  from public.shifts as shift
  where shift.store_id = p_store_id
    and shift.opened_at <= now()
    and (last_z_period_to is null or shift.opened_at > last_z_period_to)
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );
  has_activity := next_period_from is not null;

  select count(*)::integer into open_shift_count
  from public.shifts as shift
  where shift.store_id = p_store_id
    and shift.status = 'open';

  return jsonb_build_object(
    'dayIsClosed', last_z.id is not null and not has_activity,
    'hasActivity', has_activity,
    'openShiftCount', open_shift_count,
    'periodFrom', next_period_from,
    'lastZBoundary', last_z_period_to,
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

create or replace function public.get_current_business_date(p_store_id uuid)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  store_timezone text;
  last_z_at timestamptz;
  opened_at timestamptz;
begin
  if p_store_id <> (select public.current_store_id()) then
    raise exception 'Not authorized to read the business date.' using errcode = '42501';
  end if;
  select store.timezone into store_timezone
  from public.stores store
  where store.store_id = p_store_id;
  last_z_at := public.get_last_z_report_boundary(p_store_id);
  select min(shift.opened_at) into opened_at
  from public.shifts shift
  where shift.store_id = p_store_id
    and (last_z_at is null or shift.opened_at > last_z_at)
    and not exists (
      select 1
      from public.z_reported_shifts reported
      where reported.store_id = shift.store_id
        and reported.shift_id = shift.id
    );
  return coalesce(
    (opened_at at time zone store_timezone)::date,
    (now() at time zone store_timezone)::date
  );
end
$$;

create or replace function public.force_close_day(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target_store public.stores%rowtype;
  target_shift public.shifts%rowtype;
  order_record public.orders%rowtype;
  line public.order_lines%rowtype;
  expected bigint;
  order_ids uuid[] := array[]::uuid[];
  shift_ids uuid[] := array[]::uuid[];
  affected_shifts jsonb;
  affected_orders jsonb;
  approved_count integer;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  if actor.id is null or actor.role <> 'owner' then
    raise exception 'Only this store owner can force-close the business day.' using errcode = '42501';
  end if;
  select * into target_store
  from public.stores
  where store_id = actor.store_id
  for update;
  if not found or not public.is_store_owner(target_store.store_id) then
    raise exception 'Only this store owner can force-close the business day.' using errcode = '42501';
  end if;
  if nullif(p_pin, '') is null
    or not public.verify_store_pin(target_store.store_id, p_pin, 'z_report') then
    raise exception 'Incorrect owner PIN.';
  end if;

  for order_record in
    select * from public.orders
    where store_id = target_store.store_id and status = 'pending_void'
    for update
  loop
    update public.orders
    set status = 'voided',
        voided_at = now(),
        voided_by = 'owner',
        voided_by_user_id = actor.id,
        void_reason = 'Auto-approved at forced close',
        void_requested_at = null
    where id = order_record.id;
    for line in select * from public.order_lines where order_id = order_record.id loop
      update public.catalog_items
      set stock_count = stock_count + line.quantity,
          out_of_stock = false,
          out_of_stock_by = null,
          out_of_stock_at = null
      where id = line.item_id
        and store_id = target_store.store_id
        and stock_count is not null;
    end loop;
    insert into public.activity_logs (
      store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
    ) values (
      target_store.store_id, actor.id, actor.name, actor.role, 'order.voided',
      'Auto-approved void for order #' || order_record.number || ' at forced close.',
      'order', order_record.id::text,
      jsonb_build_object(
        'before', jsonb_build_object('status', 'pending_void'),
        'after', jsonb_build_object('status', 'voided', 'voidReason', 'Auto-approved at forced close')
      )
    );
    order_ids := array_append(order_ids, order_record.id);
    if not (order_record.shift_id = any(shift_ids)) then
      shift_ids := array_append(shift_ids, order_record.shift_id);
    end if;
  end loop;

  update public.shifts as shift
  set voids_auto_approved_count = shift.voids_auto_approved_count + (
    select count(*)::integer
    from public.orders counted_order
    where counted_order.id = any(order_ids)
      and counted_order.shift_id = shift.id
  )
  where shift.id = any(shift_ids)
    and exists (
      select 1
      from public.orders counted_order
      where counted_order.id = any(order_ids)
        and counted_order.shift_id = shift.id
    );

  for target_shift in
    select * from public.shifts
    where store_id = target_store.store_id and status = 'open'
    for update
  loop
    if not (target_shift.id = any(shift_ids)) then
      shift_ids := array_append(shift_ids, target_shift.id);
    end if;
    expected := public.get_shift_expected_cash(target_shift.id);
    update public.shifts as shift
    set status = 'closed',
        counted_cash_millimes = expected,
        expected_cash_millimes = expected,
        difference_millimes = 0,
        difference_note = null,
        closed_at = now(),
        closed_by_user_id = actor.id,
        force_closed_by_owner = true,
        voids_auto_approved_count = shift.voids_auto_approved_count
    where shift.id = target_shift.id;
  end loop;

  if cardinality(shift_ids) > 0 then
    select coalesce(jsonb_agg(to_jsonb(shift) order by shift.opened_at), '[]'::jsonb)
      into affected_shifts
    from public.shifts shift
    where shift.id = any(shift_ids);
  else
    affected_shifts := '[]'::jsonb;
  end if;
  if cardinality(order_ids) > 0 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', counted_order.id,
      'ticketNumber', counted_order.number,
      'totalMillimes', counted_order.total_millimes,
      'shiftId', counted_order.shift_id
    ) order by counted_order.number), '[]'::jsonb)
      into affected_orders
    from public.orders counted_order
    where counted_order.id = any(order_ids);
  else
    affected_orders := '[]'::jsonb;
  end if;
  return jsonb_build_object('shifts', affected_shifts, 'orders', affected_orders);
end
$$;

update public.app_schema_version
set version = 20261122100000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
