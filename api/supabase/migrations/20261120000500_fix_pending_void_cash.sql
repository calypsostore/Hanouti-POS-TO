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

  select target.starting_cash_millimes
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
      select sum(t.amount_millimes)
      from public.tabs t
      where t.shift_id = target.id
        and t.kind = 'settled'
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
    ), 0)
  into expected;

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

  select target.starting_cash_millimes
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
      select sum(t.amount_millimes)
      from public.tabs t
      where t.shift_id = target.id
        and t.kind = 'settled'
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
    ), 0)
  into expected;

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
    -- Keep the gross amount for adjusted voids here so the negative adjustment is applied once.
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
      select sum(t.amount_millimes)
      from public.tabs t
      where t.shift_id = target.id
        and t.kind = 'settled'
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
    if exists (
      select 1 from public.shifts s
      where s.id = target.shift_id and s.status = 'closed'
    ) then
      insert into public.shift_void_adjustments (
        store_id, shift_id, order_id, order_number, amount_millimes
      ) values (
        target.store_id, target.shift_id, target.id, target.number, -target.total_millimes
      )
      on conflict (shift_id, order_id) do nothing;
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
    jsonb_build_object('before', jsonb_build_object('status', target.status, 'voidReason', target.void_reason),
      'after', jsonb_build_object('status', result.status, 'voidReason', result.void_reason))
  );
  return result;
end
$$;

revoke all on function public.close_shift(uuid, bigint, text) from public, anon;
revoke all on function public.force_close_shift(uuid, bigint, text) from public, anon;
revoke all on function public.get_shift_expected_cash(uuid) from public, anon;
revoke all on function public.resolve_order_void(uuid, text, text, text) from public, anon;
grant execute on function public.close_shift(uuid, bigint, text) to authenticated;
grant execute on function public.force_close_shift(uuid, bigint, text) to authenticated;
grant execute on function public.get_shift_expected_cash(uuid) to authenticated;
grant execute on function public.resolve_order_void(uuid, text, text, text) to authenticated;

insert into public.app_schema_version (singleton, version)
values (true, 20261120000500)
on conflict (singleton) do update
set version = excluded.version,
    updated_at = now();

notify pgrst, 'reload schema';
