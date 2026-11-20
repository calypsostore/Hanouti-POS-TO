alter table public.shift_void_adjustments
  add column kind text not null default 'approved';

alter table public.shift_void_adjustments
  drop constraint if exists shift_void_adjustments_kind_check;

alter table public.shift_void_adjustments
  add constraint shift_void_adjustments_kind_check
  check (kind in ('requested', 'rejected', 'approved'));

alter table public.shift_void_adjustments
  drop constraint if exists shift_void_adjustments_shift_id_order_id_key;

alter table public.shift_void_adjustments
  add constraint shift_void_adjustments_shift_order_kind_key
  unique (shift_id, order_id, kind);

alter table public.shifts
  add column voids_auto_approved_count integer not null default 0
  check (voids_auto_approved_count >= 0);

create or replace function public.refresh_closed_shift_void_difference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.shifts as shift
  set difference_millimes = shift.counted_cash_millimes
    - shift.expected_cash_millimes
    - coalesce((
      select sum(adjustment.amount_millimes)
      from public.shift_void_adjustments adjustment
      where adjustment.shift_id = new.shift_id
    ), 0)
  where shift.id = new.shift_id
    and shift.status = 'closed'
    and shift.counted_cash_millimes is not null
    and shift.expected_cash_millimes is not null;
  return new;
end
$$;

drop trigger if exists shift_void_adjustments_refresh_difference on public.shift_void_adjustments;
create trigger shift_void_adjustments_refresh_difference
after insert on public.shift_void_adjustments
for each row execute function public.refresh_closed_shift_void_difference();

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

  if target.status = 'closed' and target.expected_cash_millimes is not null then
    return target.expected_cash_millimes
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
  end if;

  return target.starting_cash_millimes
    + coalesce((
      select sum(o.total_millimes)
      from public.orders o
      where o.shift_id = target.id
        and o.status = 'done'
        and o.payment_method = 'cash'
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

create or replace function public.request_order_void(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  target_shift public.shifts%rowtype;
  result public.orders%rowtype;
begin
  select * into target from public.orders where id = p_order_id for update;
  if not found or target.store_id <> (select public.current_store_id())
    or not public.has_store_permission('request_void') then
    raise exception 'Not authorized to request this void.' using errcode = '42501';
  end if;
  if target.staff_id <> auth.uid() and not public.has_store_permission('view_all_orders') then
    raise exception 'You can only request a void for an order you can access.' using errcode = '42501';
  end if;
  if target.status <> 'done' or p_reason is null or length(btrim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception 'This order cannot be voided or the reason is invalid.';
  end if;

  update public.orders
  set status = 'pending_void',
      void_requested_at = now(),
      void_reason = btrim(p_reason)
  where id = target.id
  returning * into result;

  if target.payment_method = 'cash' then
    select * into target_shift
    from public.shifts
    where id = target.shift_id;
    if target_shift.status = 'closed' then
      insert into public.shift_void_adjustments (
        store_id, shift_id, order_id, order_number, kind, amount_millimes
      ) values (
        target.store_id, target.shift_id, target.id, target.number, 'requested', -target.total_millimes
      )
      on conflict (shift_id, order_id, kind) do nothing;
    end if;
  end if;
  return result;
end
$$;

create or replace function public.resolve_order_void(
  p_order_id uuid,
  p_decision text,
  p_reason text,
  p_pin text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target public.orders%rowtype;
  target_shift public.shifts%rowtype;
  result public.orders%rowtype;
  cleaned_reason text;
  line public.order_lines%rowtype;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  select * into target from public.orders where id = p_order_id for update;
  if actor.id is null or not public.is_store_owner(target.store_id)
    or target.store_id <> actor.store_id then
    raise exception 'Only this store owner can resolve a void request.' using errcode = '42501';
  end if;
  if target.status <> 'pending_void' or p_decision not in ('approve', 'reject') then
    raise exception 'This order cannot be resolved.';
  end if;
  cleaned_reason := nullif(pg_catalog.btrim(p_reason), '');
  if p_decision = 'approve' and cleaned_reason is null then
    raise exception 'A reason is required to void an order.';
  end if;

  update public.orders
  set status = case when p_decision = 'approve' then 'voided' else 'done' end,
      voided_at = case when p_decision = 'approve' then now() else null end,
      voided_by = case when p_decision = 'approve' then 'owner' else null end,
      voided_by_user_id = case when p_decision = 'approve' then actor.id else null end,
      void_reason = case when p_decision = 'approve' then cleaned_reason else null end,
      void_requested_at = null
  where id = target.id
  returning * into result;

  if p_decision = 'approve' then
    for line in select * from public.order_lines where order_id = target.id loop
      update public.catalog_items
      set stock_count = stock_count + line.quantity,
          out_of_stock = false,
          out_of_stock_by = null,
          out_of_stock_at = null
      where id = line.item_id
        and store_id = target.store_id
        and stock_count is not null;
    end loop;
  elsif target.payment_method = 'cash' then
    select * into target_shift
    from public.shifts
    where id = target.shift_id;
    if target_shift.status = 'closed' then
      insert into public.shift_void_adjustments (
        store_id, shift_id, order_id, order_number, kind, amount_millimes
      ) values (
        target.store_id, target.shift_id, target.id, target.number, 'rejected', target.total_millimes
      )
      on conflict (shift_id, order_id, kind) do nothing;
    end if;
  end if;

  insert into public.activity_logs (
    store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
  ) values (
    target.store_id, actor.id, actor.name, actor.role,
    case when p_decision = 'approve' then 'order.voided' else 'order.void_rejected' end,
    case when p_decision = 'approve'
      then 'Approved void for order #' || target.number || '. ' || cleaned_reason
      else 'Rejected void request for order #' || target.number || '.'
    end,
    'order', target.id::text,
    jsonb_build_object(
      'before', jsonb_build_object('status', target.status, 'voidReason', target.void_reason),
      'after', jsonb_build_object('status', result.status, 'voidReason', result.void_reason)
    )
  );
  return result;
end
$$;

drop function if exists public.close_shift(uuid, bigint, text);

create function public.close_shift(
  p_shift_id uuid,
  p_counted_cash_millimes bigint,
  p_difference_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
  expected bigint;
  difference bigint;
  pending_count integer;
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
  select count(*)::integer into pending_count
  from public.orders
  where shift_id = target.id and status = 'pending_void';

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
  return jsonb_build_object('shift', to_jsonb(result), 'pendingVoidCount', pending_count);
end
$$;

drop function if exists public.force_close_shift(uuid, bigint, text);

create function public.force_close_shift(p_shift_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target public.shifts%rowtype;
  order_record public.orders%rowtype;
  line public.order_lines%rowtype;
  expected bigint;
  approved_count integer := 0;
  result public.shifts%rowtype;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  select * into target from public.shifts where id = p_shift_id for update;
  if actor.id is null or not found or target.status <> 'open'
    or target.store_id <> actor.store_id or not public.is_store_owner(target.store_id) then
    raise exception 'Only this store owner can force-close the shift.' using errcode = '42501';
  end if;
  if nullif(p_pin, '') is null
    or not public.verify_store_pin(target.store_id, p_pin, 'z_report') then
    raise exception 'Incorrect owner PIN.';
  end if;

  for order_record in
    select * from public.orders
    where store_id = target.store_id
      and shift_id = target.id
      and status = 'pending_void'
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
        and store_id = target.store_id
        and stock_count is not null;
    end loop;
    insert into public.activity_logs (
      store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
    ) values (
      target.store_id, actor.id, actor.name, actor.role, 'order.voided',
      'Auto-approved void for order #' || order_record.number || ' at forced close.',
      'order', order_record.id::text,
      jsonb_build_object(
        'before', jsonb_build_object('status', 'pending_void'),
        'after', jsonb_build_object('status', 'voided', 'voidReason', 'Auto-approved at forced close')
      )
    );
    approved_count := approved_count + 1;
  end loop;

  expected := public.get_shift_expected_cash(target.id);
  update public.shifts as shift
  set status = 'closed',
      counted_cash_millimes = expected,
      expected_cash_millimes = expected,
      difference_millimes = 0,
      difference_note = null,
      closed_at = now(),
      closed_by_user_id = actor.id,
      force_closed_by_owner = true,
      voids_auto_approved_count = shift.voids_auto_approved_count + approved_count
  where shift.id = target.id
  returning shift.* into result;
  return jsonb_build_object('shift', to_jsonb(result), 'voidsAutoApprovedCount', approved_count);
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
    from public.orders order_record
    where order_record.id = any(order_ids)
      and order_record.shift_id = shift.id
  )
  where shift.id = any(shift_ids)
    and exists (
      select 1
      from public.orders order_record
      where order_record.id = any(order_ids)
        and order_record.shift_id = shift.id
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
      'id', order_record.id,
      'ticketNumber', order_record.number,
      'totalMillimes', order_record.total_millimes,
      'shiftId', order_record.shift_id
    ) order by order_record.number), '[]'::jsonb)
      into affected_orders
    from public.orders order_record
    where order_record.id = any(order_ids);
  else
    affected_orders := '[]'::jsonb;
  end if;
  return jsonb_build_object('shifts', affected_shifts, 'orders', affected_orders);
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
  v_has_activity boolean;
  v_pending_void_count integer;
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

  select coalesce(report.period_to, report.created_at)
    into v_previous_z_period_to
  from public.reports as report
  where report.store_id = v_store.store_id
    and report.type = 'Z'
  order by report.created_at desc
  limit 1;

  select exists (
    select 1
    from public.shifts as shift
    where shift.store_id = v_store.store_id
      and (v_previous_z_period_to is null or shift.opened_at > v_previous_z_period_to)
  ) into v_has_activity;
  if not v_has_activity then
    raise exception 'The business day is closed. Open a new shift before creating another report.';
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
    select count(*)::integer into v_pending_void_count
    from public.orders
    where store_id = v_store.store_id and status = 'pending_void';
    if v_pending_void_count > 0 then
      raise exception 'Resolve every void request before creating a Z report.';
    end if;
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
revoke all on function public.force_close_shift(uuid, text) from public, anon;
revoke all on function public.force_close_day(text) from public, anon;
revoke all on function public.get_shift_expected_cash(uuid) from public, anon;
revoke all on function public.request_order_void(uuid, text) from public, anon;
revoke all on function public.resolve_order_void(uuid, text, text, text) from public, anon;
revoke all on function public.record_report(jsonb, text) from public, anon;
grant execute on function public.close_shift(uuid, bigint, text) to authenticated;
grant execute on function public.force_close_shift(uuid, text) to authenticated;
grant execute on function public.force_close_day(text) to authenticated;
grant execute on function public.get_shift_expected_cash(uuid) to authenticated;
grant execute on function public.request_order_void(uuid, text) to authenticated;
grant execute on function public.resolve_order_void(uuid, text, text, text) to authenticated;
grant execute on function public.record_report(jsonb, text) to authenticated;

update public.app_schema_version
set version = 20261120180000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
