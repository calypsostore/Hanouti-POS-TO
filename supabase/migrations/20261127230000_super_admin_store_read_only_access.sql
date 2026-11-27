create policy store_settings_super_admin_read
  on public.store_settings for select to authenticated
  using (public.is_super_admin());

create policy profiles_super_admin_staff_read
  on public.profiles for select to authenticated
  using (public.is_super_admin() and role = 'staff');

create policy orders_super_admin_read
  on public.orders for select to authenticated
  using (public.is_super_admin());

create policy order_lines_super_admin_read
  on public.order_lines for select to authenticated
  using (public.is_super_admin());

create policy catalog_items_super_admin_read
  on public.catalog_items for select to authenticated
  using (public.is_super_admin());

create policy catalog_modifiers_super_admin_read
  on public.catalog_modifiers for select to authenticated
  using (public.is_super_admin());

create policy shift_void_adjustments_super_admin_read
  on public.shift_void_adjustments for select to authenticated
  using (public.is_super_admin());

do $$
declare
  definition text;
  original text;
  replacement text;
begin
  definition := pg_get_functiondef('public.get_shift_expected_cash_visible(uuid)'::regprocedure);
  original := 'target.store_id is distinct from (select public.current_store_id())';
  replacement := '(target.store_id is distinct from (select public.current_store_id()) and not public.is_super_admin())';
  if position(original in definition) = 0 then
    raise exception 'Could not locate expected-cash store authorization check.';
  end if;
  definition := replace(definition, original, replacement);
  original := 'public.is_store_owner(target.store_id)';
  replacement := '(public.is_super_admin() or public.is_store_owner(target.store_id))';
  if position(original in definition) = 0 then
    raise exception 'Could not locate expected-cash role authorization check.';
  end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.get_shift_record(uuid)'::regprocedure);
  original := 'target.store_id is distinct from (select public.current_store_id())';
  replacement := '(target.store_id is distinct from (select public.current_store_id()) and not public.is_super_admin())';
  if position(original in definition) = 0 then
    raise exception 'Could not locate shift-record store authorization check.';
  end if;
  definition := replace(definition, original, replacement);
  original := 'public.is_store_owner(target.store_id)';
  replacement := '(public.is_super_admin() or public.is_store_owner(target.store_id))';
  if position(original in definition) = 0 then
    raise exception 'Could not locate shift-record role authorization check.';
  end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.list_shift_records(uuid)'::regprocedure);
  original := 'p_store_id is distinct from (select public.current_store_id())';
  replacement := '(p_store_id is distinct from (select public.current_store_id()) and not public.is_super_admin())';
  if position(original in definition) = 0 then
    raise exception 'Could not locate shift-list store authorization check.';
  end if;
  definition := replace(definition, original, replacement);
  original := 'public.is_store_owner(p_store_id)';
  replacement := '(public.is_super_admin() or public.is_store_owner(p_store_id))';
  if position(original in definition) = 0 then
    raise exception 'Could not locate shift-list role authorization check.';
  end if;
  execute replace(definition, original, replacement);
end
$$;

update public.app_schema_version
set version = 20261127230000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
