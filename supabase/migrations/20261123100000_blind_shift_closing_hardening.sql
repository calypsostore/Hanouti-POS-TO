-- Blind shift closing hardening.
-- Numeric calculation remains available to trusted SECURITY DEFINER workflows.
-- Authenticated callers use blind-aware public RPCs instead.

revoke all on function public.get_shift_expected_cash(uuid) from public, anon, authenticated;
grant execute on function public.get_shift_expected_cash(uuid) to service_role;

create or replace function public.get_shift_expected_cash_visible(p_shift_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
  blind boolean;
begin
  select shift.* into target
  from public.shifts shift
  where shift.id = p_shift_id;

  if not found
    or target.store_id is distinct from (select public.current_store_id())
    or not (
      public.is_store_owner(target.store_id)
      or (
        target.staff_id = (select auth.uid())
        and public.has_store_permission('open_close_shift')
      )
    ) then
    raise exception 'Not authorized to view expected shift cash.' using errcode = '42501';
  end if;

  select coalesce((setting.settings->>'blindShiftClosing')::boolean, false)
  into blind
  from public.store_settings setting
  where setting.store_id = target.store_id;

  if coalesce(blind, false)
    and target.staff_id = (select auth.uid())
    and not public.is_store_owner(target.store_id) then
    return null;
  end if;

  return public.get_shift_expected_cash(p_shift_id);
end
$$;

revoke all on function public.get_shift_expected_cash_visible(uuid) from public, anon;
grant execute on function public.get_shift_expected_cash_visible(uuid) to authenticated;

create or replace function public.get_shift_record(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
  blind boolean;
  is_blind_staff boolean;
  adjustments bigint;
begin
  select shift.* into target
  from public.shifts shift
  where shift.id = p_shift_id;

  if not found
    or target.store_id is distinct from (select public.current_store_id())
    or not (
      public.is_store_owner(target.store_id)
      or (
        target.staff_id = (select auth.uid())
        and (
          public.has_store_permission('open_close_shift')
          or public.has_store_permission('view_own_hours')
        )
      )
    ) then
    raise exception 'Not authorized to view this shift.' using errcode = '42501';
  end if;

  select coalesce((setting.settings->>'blindShiftClosing')::boolean, false)
  into blind
  from public.store_settings setting
  where setting.store_id = target.store_id;
  is_blind_staff := coalesce(blind, false)
    and target.staff_id = (select auth.uid())
    and not public.is_store_owner(target.store_id);

  select coalesce(sum(adjustment.amount_millimes), 0)
  into adjustments
  from public.shift_void_adjustments adjustment
  join public.orders order_record
    on order_record.id = adjustment.order_id
   and order_record.shift_id = adjustment.shift_id
   and order_record.store_id = adjustment.store_id
  where adjustment.shift_id = target.id
    and order_record.payment_method = 'cash';

  return jsonb_build_object(
    'id', target.id,
    'store_id', target.store_id,
    'staff_id', target.staff_id,
    'status', target.status,
    'starting_cash_millimes', target.starting_cash_millimes,
    'counted_cash_millimes', case when is_blind_staff then null else target.counted_cash_millimes end,
    'expected_cash_millimes', case
      when is_blind_staff or (
        target.staff_id = (select auth.uid())
        and not public.is_store_owner(target.store_id)
        and not public.has_store_permission('open_close_shift')
      ) then null
      when target.status = 'closed' and target.expected_cash_millimes is not null
        then target.expected_cash_millimes + adjustments
      else public.get_shift_expected_cash_visible(target.id)
    end,
    'difference_millimes', case when is_blind_staff then null else target.difference_millimes end,
    'opened_at', target.opened_at,
    'closed_at', target.closed_at,
    'force_closed_by_owner', target.force_closed_by_owner,
    'voids_auto_approved_count', target.voids_auto_approved_count,
    'closed_by_user_id', target.closed_by_user_id,
    'difference_note', case when is_blind_staff then null else target.difference_note end
  );
end
$$;

revoke all on function public.get_shift_record(uuid) from public, anon;
grant execute on function public.get_shift_record(uuid) to authenticated;

create or replace function public.list_shift_records(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_store_id is distinct from (select public.current_store_id())
    or not (
      public.is_store_owner(p_store_id)
      or public.has_store_permission('open_close_shift')
      or public.has_store_permission('view_own_hours')
    ) then
    raise exception 'Not authorized to view shifts.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      public.get_shift_record(shift.id)
      order by shift.opened_at desc
    )
    from public.shifts shift
    where shift.store_id = p_store_id
      and (
        public.is_store_owner(p_store_id)
        or shift.staff_id = (select auth.uid())
      )
  ), '[]'::jsonb);
end
$$;

revoke all on function public.list_shift_records(uuid) from public, anon;
grant execute on function public.list_shift_records(uuid) to authenticated;

-- Direct authenticated table access cannot expose reconciliation columns.
revoke all on table public.shifts from public, anon, authenticated;
grant select (
  id,
  store_id,
  staff_id,
  status,
  starting_cash_millimes,
  opened_at,
  closed_at,
  force_closed_by_owner,
  voids_auto_approved_count,
  closed_by_user_id
) on table public.shifts to authenticated;
