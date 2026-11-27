create policy customers_staff_workflow_read on public.customers for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and (
      public.has_store_permission('customers_edit')
      or public.has_store_permission('use_tabs')
      or public.has_store_permission('settle_tabs')
    )
  );
create policy tabs_staff_workflow_read on public.tabs for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and (
      public.has_store_permission('use_tabs')
      or public.has_store_permission('settle_tabs')
    )
  );
create policy orders_staff_void_request_read on public.orders for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and staff_id = (select auth.uid())
    and public.has_store_permission('request_void')
  );
create policy shifts_staff_workflow_read on public.shifts for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and staff_id = (select auth.uid())
    and (
      public.has_store_permission('take_orders')
      or public.has_store_permission('print_x_report')
      or public.has_store_permission('cash_in_out')
      or public.has_store_permission('settle_tabs')
    )
  );
create policy cash_movements_staff_cash_in_out_read on public.cash_movements for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and staff_id = (select auth.uid())
    and public.has_store_permission('cash_in_out')
  );

do $$
declare
  definition text;
  original text;
  replacement text;
begin
  definition := pg_get_functiondef('public.can_read_order(uuid)'::regprocedure);
  original := 'public.has_store_permission(''view_order_history'')';
  replacement := '(public.has_store_permission(''view_order_history'') or public.has_store_permission(''request_void''))';
  if position(original in definition) = 0 then
    raise exception 'Could not locate own-order read permission check.';
  end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.get_shift_record(uuid)'::regprocedure);
  original := 'or public.has_store_permission(''view_own_hours'')';
  replacement := original
    || ' or public.has_store_permission(''take_orders'')'
    || ' or public.has_store_permission(''print_x_report'')'
    || ' or public.has_store_permission(''cash_in_out'')'
    || ' or public.has_store_permission(''settle_tabs'')';
  if position(original in definition) = 0 then
    raise exception 'Could not locate own-shift read permission check.';
  end if;
  execute replace(definition, original, replacement);

  definition := pg_get_functiondef('public.list_shift_records(uuid)'::regprocedure);
  original := 'or public.has_store_permission(''view_own_hours'')';
  if position(original in definition) = 0 then
    raise exception 'Could not locate own-shift list permission check.';
  end if;
  execute replace(definition, original, replacement);
end
$$;
