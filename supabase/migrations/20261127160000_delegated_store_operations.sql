create or replace function public.has_store_permission(p_permission text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile_role text;
  position_permissions text[];
  granted_permissions text[];
  revoked_permissions text[];
  effective_permissions text[];
  implied_permissions text[] := '{}'::text[];
  all_operations_permissions text[] := array[
    'take_orders', 'view_order_history', 'view_all_orders', 'request_void', 'add_order_note',
    'comp_items', '86_items', 'edit_stock_counts', 'customers_view', 'customers_create',
    'customers_edit', 'use_tabs', 'settle_tabs', 'tab_override_limit', 'open_close_shift',
    'cash_in_out', 'print_x_report', 'view_schedule', 'view_own_hours', 'view_dashboard',
    'manage_catalog', 'manage_schedule', 'resolve_voids', 'manage_shifts', 'view_reports',
    'manage_fiscal', 'view_fiscal_reports', 'manage_inventory', 'manage_waste',
    'manage_expenses', 'manage_suppliers', 'view_activity_log'
  ];
begin
  select profile.role,
         coalesce(position_record.permission_ids, '{}'::text[]),
         coalesce(overrides.granted, '{}'::text[]),
         coalesce(overrides.revoked, '{}'::text[])
  into profile_role, position_permissions, granted_permissions, revoked_permissions
  from public.profiles profile
  left join public.positions position_record
    on position_record.id = profile.position_id
    and position_record.store_id = profile.store_id
  left join public.permission_overrides overrides
    on overrides.user_id = profile.id
    and overrides.store_id = profile.store_id
  where profile.id = (select auth.uid())
    and profile.is_active
    and profile.store_id = (select public.current_store_id())
    and profile.role in ('staff', 'owner');

  if profile_role is null then
    return false;
  end if;
  if profile_role = 'owner' then
    return true;
  end if;

  select coalesce(array_agg(permission_id), '{}'::text[])
  into effective_permissions
  from (
    select distinct permission.permission_id
    from unnest(position_permissions || granted_permissions) as permission(permission_id)
    where (permission.permission_id = any(granted_permissions)
      or permission.permission_id = any(position_permissions))
      and not permission.permission_id = any(revoked_permissions)
  ) effective;

  if p_permission = any(effective_permissions) then
    return true;
  end if;

  if 'manage_store_operations' = any(effective_permissions)
    and p_permission = any(all_operations_permissions)
    and not p_permission = any(revoked_permissions) then
    return true;
  end if;

  if 'manage_catalog' = any(effective_permissions) then
    implied_permissions := implied_permissions || array['86_items'];
  end if;
  if 'manage_schedule' = any(effective_permissions) then
    implied_permissions := implied_permissions || array['view_schedule'];
  end if;
  if 'resolve_voids' = any(effective_permissions) then
    implied_permissions := implied_permissions || array['view_all_orders'];
  end if;
  if 'manage_shifts' = any(effective_permissions) then
    implied_permissions := implied_permissions || array[
      'open_close_shift', 'print_x_report', 'view_all_orders', 'view_dashboard', 'view_reports', 'resolve_voids'
    ];
  end if;
  if 'view_reports' = any(effective_permissions) then
    implied_permissions := implied_permissions || array['view_dashboard', 'view_all_orders'];
  end if;
  if 'view_dashboard' = any(effective_permissions) then
    implied_permissions := implied_permissions || array['view_all_orders'];
  end if;
  if 'manage_inventory' = any(effective_permissions) or 'manage_waste' = any(effective_permissions) then
    implied_permissions := implied_permissions || array['edit_stock_counts'];
  end if;

  return p_permission = any(implied_permissions)
    and not p_permission = any(revoked_permissions);
end
$$;

create or replace function public.get_store_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(permission.permission_id order by permission.permission_id), '{}'::text[])
  from unnest(array[
    'take_orders', 'view_order_history', 'view_all_orders', 'request_void', 'add_order_note',
    'comp_items', '86_items', 'edit_stock_counts', 'customers_view', 'customers_create',
    'customers_edit', 'use_tabs', 'settle_tabs', 'tab_override_limit', 'open_close_shift',
    'cash_in_out', 'print_x_report', 'view_schedule', 'view_own_hours', 'manage_store_operations',
    'view_dashboard', 'manage_catalog', 'manage_schedule', 'resolve_voids', 'manage_shifts',
    'view_reports', 'manage_fiscal', 'view_fiscal_reports', 'manage_inventory', 'manage_waste',
    'manage_expenses', 'manage_suppliers', 'view_activity_log'
  ]::text[]) as permission(permission_id)
  where public.has_store_permission(permission.permission_id)
$$;

revoke all on function public.has_store_permission(text) from public, anon;
grant execute on function public.has_store_permission(text) to authenticated;
revoke all on function public.get_store_permissions() from public, anon;
grant execute on function public.get_store_permissions() to authenticated;

create policy categories_manager_all on public.categories for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_catalog'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_catalog'));
create policy catalog_items_manager_all on public.catalog_items for all to authenticated
  using (
    store_id = (select public.current_store_id())
    and (public.has_store_permission('manage_catalog') or public.has_store_permission('manage_inventory') or public.has_store_permission('manage_waste'))
  )
  with check (
    store_id = (select public.current_store_id())
    and (public.has_store_permission('manage_catalog') or public.has_store_permission('manage_inventory') or public.has_store_permission('manage_waste'))
  );
create policy catalog_modifiers_manager_all on public.catalog_modifiers for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_catalog'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_catalog'));
create policy item_history_manager_read on public.item_history for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and (public.has_store_permission('manage_inventory') or public.has_store_permission('manage_waste'))
  );
create policy schedule_shifts_manager_all on public.schedule_shifts for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_schedule'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_schedule'));
create policy schedule_templates_manager_all on public.schedule_templates for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_schedule'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_schedule'));
create policy profiles_schedule_manager_read on public.profiles for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and role = 'staff'
    and (
      public.has_store_permission('manage_store_operations')
      or public.has_store_permission('manage_schedule')
      or public.has_store_permission('resolve_voids')
      or public.has_store_permission('manage_shifts')
      or public.has_store_permission('view_dashboard')
      or public.has_store_permission('view_reports')
      or public.has_store_permission('view_fiscal_reports')
      or public.has_store_permission('manage_expenses')
      or public.has_store_permission('manage_suppliers')
      or public.has_store_permission('view_activity_log')
    )
  );
create policy expenses_manager_all on public.expenses for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_expenses'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_expenses'));
create policy suppliers_manager_all on public.suppliers for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_suppliers'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_suppliers'));
create policy supplier_payments_manager_all on public.supplier_payments for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_suppliers'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_suppliers'));
create policy activity_logs_manager_read on public.activity_logs for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('view_activity_log'));
create policy reports_manager_read on public.reports for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and (public.has_store_permission('view_reports') or public.has_store_permission('manage_shifts'))
  );
create policy shifts_manager_read on public.shifts for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_shifts'));
create policy orders_void_manager_read on public.orders for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('resolve_voids'));
create policy fiscal_profiles_manager_all on public.fiscal_profiles for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_fiscal'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_fiscal'));
create policy fiscal_tax_rules_manager_all on public.fiscal_tax_rules for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_fiscal'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_fiscal'));
create policy catalog_item_tax_assignments_manager_all on public.catalog_item_tax_assignments for all to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('manage_fiscal'))
  with check (store_id = (select public.current_store_id()) and public.has_store_permission('manage_fiscal'));
create policy fiscal_report_history_manager_read on public.fiscal_report_history for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('view_fiscal_reports'));

revoke select on public.profiles from authenticated;
grant select (
  id, store_id, role, name, avatar_id, email, username, phone, notes, position_id,
  must_change_password, must_set_pin, is_active, session_version, created_at
) on public.profiles to authenticated;

create or replace function public.verify_store_pin(p_store_id uuid, p_pin text, p_purpose text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
  attempt public.pin_attempts%rowtype;
  next_count integer;
begin
  if p_store_id <> (select public.current_store_id())
    or p_purpose not in ('credit_override', 'void', 'z_report')
    or not (
      public.is_store_owner(p_store_id)
      or (p_purpose = 'credit_override' and public.has_store_permission('tab_override_limit'))
      or (p_purpose = 'void' and public.has_store_permission('request_void'))
      or (p_purpose = 'void' and public.has_store_permission('resolve_voids'))
      or (p_purpose = 'z_report' and public.has_store_permission('manage_shifts'))
    ) then
    raise exception 'Not authorized to verify this PIN.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_store_id::text || auth.uid()::text || p_purpose, 0)
  );

  if not public.is_store_owner(p_store_id)
    and ((p_purpose = 'z_report' and public.has_store_permission('manage_shifts'))
      or (p_purpose = 'void' and public.has_store_permission('resolve_voids'))) then
    select profile.pin_hash into stored_hash
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.store_id = p_store_id
      and profile.role = 'staff'
      and profile.is_active;
  else
    select store.admin_pin_hash into stored_hash
    from public.stores store
    where store.store_id = p_store_id;
  end if;

  if stored_hash is null then return false; end if;

  select * into attempt
  from public.pin_attempts
  where store_id = p_store_id
    and user_id = auth.uid()
    and purpose = p_purpose
  for update;
  if found and attempt.locked_until > now() then
    raise exception 'PIN verification is temporarily locked.' using errcode = 'P0001';
  end if;
  if (stored_hash like '$2%' and extensions.crypt(p_pin, stored_hash) = stored_hash)
    or (stored_hash not like '$2%' and public.verify_secret(p_pin, stored_hash)) then
    delete from public.pin_attempts
    where store_id = p_store_id
      and user_id = auth.uid()
      and purpose = p_purpose;
    return true;
  end if;

  next_count := coalesce(attempt.failed_attempts, 0) + 1;
  insert into public.pin_attempts (store_id, user_id, purpose, failed_attempts, locked_until)
  values (
    p_store_id,
    auth.uid(),
    p_purpose,
    case when next_count >= 3 then 0 else next_count end,
    case when next_count >= 3 then now() + interval '60 seconds' else null end
  )
  on conflict (store_id, user_id, purpose) do update
  set failed_attempts = excluded.failed_attempts,
      locked_until = excluded.locked_until;
  return false;
end
$$;

do $$
declare
  definition text;
  original text;
  replacement text;
begin
  definition := pg_get_functiondef('public.get_dashboard_summary_legacy(uuid,timestamptz,timestamptz,boolean)'::regprocedure);
  original := 'or not public.is_store_owner(p_store_id) then';
  replacement := 'or not (public.is_store_owner(p_store_id) or public.has_store_permission(''view_dashboard'') or public.has_store_permission(''view_reports'') or public.has_store_permission(''manage_shifts'')) then';
  if position(original in definition) = 0 then raise exception 'Could not locate dashboard authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.get_fiscal_arbitrary_report(uuid,date,date,text)'::regprocedure);
  original := 'not public.is_store_owner(p_store_id)';
  replacement := '(not public.is_store_owner(p_store_id) and not public.has_store_permission(''view_fiscal_reports''))';
  if position(original in definition) = 0 then raise exception 'Could not locate fiscal report authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.save_fiscal_report_history(uuid,date,date,text,jsonb,jsonb)'::regprocedure);
  original := 'not public.is_store_owner(p_store_id)';
  replacement := '(not public.is_store_owner(p_store_id) and not public.has_store_permission(''view_fiscal_reports''))';
  if position(original in definition) = 0 then raise exception 'Could not locate fiscal report history authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.list_fiscal_report_history(uuid)'::regprocedure);
  original := 'not public.is_store_owner(p_store_id)';
  replacement := '(not public.is_store_owner(p_store_id) and not public.has_store_permission(''view_fiscal_reports''))';
  if position(original in definition) = 0 then raise exception 'Could not locate fiscal report history listing check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.resolve_order_void(uuid,text,text,text)'::regprocedure);
  original := 'not public.is_store_owner(target.store_id)';
  replacement := '(not public.is_store_owner(target.store_id) and not public.has_store_permission(''resolve_voids''))';
  if position(original in definition) = 0 then raise exception 'Could not locate void authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.record_supplier_payment(uuid,uuid,bigint,date)'::regprocedure);
  original := 'actor.role <> ''owner''';
  replacement := '(actor.role <> ''owner'' and not public.has_store_permission(''manage_suppliers''))';
  if position(original in definition) = 0 then raise exception 'Could not locate supplier payment authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.record_report(jsonb,text)'::regprocedure);
  original := 'actor.role <> ''owner''';
  replacement := '(actor.role <> ''owner'' and not public.has_store_permission(''manage_shifts''))';
  if position(original in definition) = 0 then raise exception 'Could not locate report authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.force_close_shift(uuid,text)'::regprocedure);
  original := 'not public.is_store_owner(target.store_id)';
  replacement := '(not public.is_store_owner(target.store_id) and not public.has_store_permission(''manage_shifts''))';
  if position(original in definition) = 0 then raise exception 'Could not locate force-close shift authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.force_close_day(text)'::regprocedure);
  original := 'actor.role <> ''owner''';
  replacement := '(actor.role <> ''owner'' and not public.has_store_permission(''manage_shifts''))';
  if position(original in definition) = 0 then raise exception 'Could not locate force-close day authorization check.'; end if;
  definition := replace(definition, original, replacement);
  original := 'not public.is_store_owner(target_store.store_id)';
  replacement := '(not public.is_store_owner(target_store.store_id) and not public.has_store_permission(''manage_shifts''))';
  if position(original in definition) = 0 then raise exception 'Could not locate force-close store authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.get_shift_summary_legacy(uuid)'::regprocedure);
  original := 'public.is_store_owner(target.store_id)';
  replacement := '(public.is_store_owner(target.store_id) or public.has_store_permission(''manage_shifts'') or public.has_store_permission(''view_reports'') or public.has_store_permission(''view_dashboard''))';
  if position(original in definition) = 0 then raise exception 'Could not locate legacy shift-summary authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.get_shift_expected_cash_visible(uuid)'::regprocedure);
  original := 'public.is_store_owner(target.store_id)';
  replacement := '(public.is_store_owner(target.store_id) or public.has_store_permission(''manage_shifts''))';
  if position(original in definition) = 0 then raise exception 'Could not locate visible cash authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.list_shift_records(uuid)'::regprocedure);
  original := 'public.is_store_owner(p_store_id)';
  replacement := '(public.is_store_owner(p_store_id) or public.has_store_permission(''manage_shifts''))';
  if position(original in definition) = 0 then raise exception 'Could not locate shift-list authorization check.'; end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.get_shift_record(uuid)'::regprocedure);
  original := 'public.is_store_owner(target.store_id)';
  replacement := '(public.is_store_owner(target.store_id) or public.has_store_permission(''manage_shifts''))';
  if position(original in definition) = 0 then raise exception 'Could not locate shift-record authorization check.'; end if;
  execute replace(definition, original, replacement);

end
$$;
