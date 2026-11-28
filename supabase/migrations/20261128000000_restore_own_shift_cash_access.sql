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
    or (
      target.store_id is distinct from (select public.current_store_id())
      and not public.is_super_admin()
    )
    or not (
      public.is_super_admin()
      or public.is_store_owner(target.store_id)
      or public.has_store_permission('manage_shifts')
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

update public.app_schema_version
set version = 20261128000000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
