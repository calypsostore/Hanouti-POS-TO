create index if not exists stores_owner_id_idx on public.stores (owner_id);
create index if not exists profiles_position_id_idx on public.profiles (position_id);
create index if not exists permission_overrides_store_id_idx on public.permission_overrides (store_id);
create index if not exists categories_store_sort_idx on public.categories (store_id, sort_order);
create index if not exists catalog_items_category_id_idx on public.catalog_items (category_id);
create index if not exists catalog_modifiers_store_id_idx on public.catalog_modifiers (store_id);
create index if not exists item_history_store_item_idx on public.item_history (store_id, item_id);
create index if not exists item_history_item_id_idx on public.item_history (item_id);
create index if not exists item_history_changed_by_idx on public.item_history (changed_by);
create index if not exists customers_store_id_idx on public.customers (store_id);
create index if not exists shifts_staff_id_idx on public.shifts (staff_id);
create index if not exists shifts_closed_by_user_id_idx on public.shifts (closed_by_user_id);
create index if not exists orders_staff_id_idx on public.orders (staff_id);
create index if not exists orders_store_business_date_created_idx on public.orders (store_id, business_date, created_at desc);
create index if not exists orders_customer_id_idx on public.orders (customer_id);
create index if not exists orders_voided_by_idx on public.orders (voided_by);
create index if not exists orders_voided_by_user_id_idx on public.orders (voided_by_user_id);
create index if not exists order_lines_store_order_idx on public.order_lines (store_id, order_id);
create index if not exists order_lines_item_id_idx on public.order_lines (item_id);
create index if not exists order_lines_category_id_idx on public.order_lines (category_id);
create index if not exists cash_movements_store_staff_idx on public.cash_movements (store_id, staff_id);
create index if not exists cash_movements_staff_id_idx on public.cash_movements (staff_id);
create index if not exists cash_movements_shift_created_idx on public.cash_movements (shift_id, created_at);
create index if not exists shift_void_adjustments_store_id_idx on public.shift_void_adjustments (store_id);
create index if not exists shift_void_adjustments_order_id_idx on public.shift_void_adjustments (order_id);
create index if not exists tabs_store_created_idx on public.tabs (store_id, created_at desc);
create index if not exists tabs_order_id_idx on public.tabs (order_id);
create index if not exists tabs_shift_created_idx on public.tabs (shift_id, created_at);
create index if not exists tabs_staff_id_idx on public.tabs (staff_id);
create index if not exists tabs_reverses_tab_id_idx on public.tabs (reverses_tab_id);
create index if not exists comps_store_shift_created_idx on public.comps (store_id, shift_id, created_at);
create index if not exists comps_shift_id_idx on public.comps (shift_id);
create index if not exists comps_staff_id_idx on public.comps (staff_id);
create index if not exists comps_item_id_idx on public.comps (item_id);
create index if not exists suppliers_store_id_idx on public.suppliers (store_id);
create index if not exists expenses_store_date_idx on public.expenses (store_id, date desc);
create index if not exists expenses_supplier_id_idx on public.expenses (supplier_id);
create index if not exists expenses_created_by_idx on public.expenses (created_by);
create index if not exists supplier_payments_store_id_idx on public.supplier_payments (store_id);
create index if not exists supplier_payments_supplier_id_idx on public.supplier_payments (supplier_id);
create index if not exists supplier_payments_expense_id_idx on public.supplier_payments (expense_id);
create index if not exists schedule_shifts_store_staff_date_idx on public.schedule_shifts (store_id, staff_id, date);
create index if not exists schedule_shifts_staff_id_idx on public.schedule_shifts (staff_id);
create index if not exists schedule_templates_store_id_idx on public.schedule_templates (store_id);
create index if not exists activity_logs_actor_id_idx on public.activity_logs (actor_id);
create index if not exists notifications_store_role_created_idx on public.notifications (store_id, target_role, created_at desc);
create index if not exists notifications_staff_id_idx on public.notifications (staff_id);
create index if not exists notifications_customer_id_idx on public.notifications (customer_id);
create index if not exists notifications_catalog_item_id_idx on public.notifications (catalog_item_id);
create index if not exists notifications_shift_id_idx on public.notifications (shift_id);
create index if not exists notifications_cash_movement_id_idx on public.notifications (cash_movement_id);
create index if not exists notification_preferences_store_id_idx on public.notification_preferences (store_id);
create index if not exists reports_store_business_date_idx on public.reports (store_id, business_date desc);
create index if not exists reports_generated_by_idx on public.reports (generated_by);
create index if not exists order_idempotency_keys_actor_id_idx on public.order_idempotency_keys (actor_id);
create index if not exists auth_sessions_user_id_idx on public.auth_sessions (user_id);
create index if not exists device_tokens_store_id_idx on public.device_tokens (store_id);
create index if not exists device_tokens_user_id_idx on public.device_tokens (user_id);

analyze public.stores, public.profiles, public.permission_overrides, public.categories,
  public.catalog_items, public.catalog_modifiers, public.item_history, public.customers,
  public.shifts, public.orders, public.order_lines, public.cash_movements,
  public.shift_void_adjustments, public.tabs, public.comps, public.suppliers,
  public.expenses, public.supplier_payments, public.schedule_shifts, public.schedule_templates,
  public.activity_logs, public.notifications, public.notification_preferences, public.reports,
  public.order_idempotency_keys, public.auth_sessions, public.device_tokens;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories'
  ) then
    alter publication supabase_realtime add table public.categories;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'stores'
  ) then
    alter publication supabase_realtime add table public.stores;
  end if;
end
$$;

update public.app_schema_version
set version = 20261121150331,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
