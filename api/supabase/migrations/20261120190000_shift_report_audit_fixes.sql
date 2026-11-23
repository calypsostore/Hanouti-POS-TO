create or replace function public.void_order_with_pin(p_order_id uuid, p_reason text, p_pin text)
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
  select * into target
  from public.orders
  where id = p_order_id
  for update;
  if actor.id is null
    or actor.store_id is distinct from target.store_id
    or not (public.is_store_owner(target.store_id) or public.has_store_permission('request_void')) then
    raise exception 'Not authorized to void this order.' using errcode = '42501';
  end if;
  if target.status <> 'done' then
    raise exception 'This order is not available to void.';
  end if;
  cleaned_reason := nullif(pg_catalog.btrim(p_reason), '');
  if cleaned_reason is null then
    raise exception 'A reason is required to void an order.';
  end if;
  if not public.verify_store_pin(target.store_id, p_pin, 'void') then
    raise exception 'Incorrect Admin PIN.';
  end if;

  update public.orders
  set status = 'voided',
      voided_at = now(),
      voided_by = 'pin',
      voided_by_user_id = actor.id,
      void_reason = cleaned_reason
  where id = target.id
  returning * into result;

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
    select 1 from public.shifts where id = target.shift_id and status = 'closed'
  ) and target.payment_method = 'cash' then
    insert into public.shift_void_adjustments (
      store_id, shift_id, order_id, order_number, kind, amount_millimes
    ) values (
      target.store_id, target.shift_id, target.id, target.number, 'approved', -target.total_millimes
    )
    on conflict (shift_id, order_id, kind) do nothing;
  end if;

  insert into public.activity_logs (
    store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
  ) values (
    target.store_id, actor.id, actor.name, actor.role, 'order.voided',
    'Voided order #' || target.number || '. ' || cleaned_reason,
    'order', target.id::text,
    jsonb_build_object(
      'before', jsonb_build_object('status', target.status),
      'after', jsonb_build_object('status', result.status, 'voidReason', cleaned_reason)
    )
  );
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
  select * into target from public.shifts shift where shift.id = p_shift_id;
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
    return target.expected_cash_millimes + coalesce((
      select sum(adjustment.amount_millimes)
      from public.shift_void_adjustments adjustment
      join public.orders order_record
        on order_record.id = adjustment.order_id
        and order_record.shift_id = adjustment.shift_id
        and order_record.store_id = adjustment.store_id
      where adjustment.shift_id = target.id
        and order_record.payment_method = 'cash'
    ), 0);
  end if;

  return target.starting_cash_millimes
    + coalesce((
      select sum(order_record.total_millimes)
      from public.orders order_record
      where order_record.shift_id = target.id
        and order_record.status = 'done'
        and order_record.payment_method = 'cash'
    ), 0)
    + coalesce((
      select sum(case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end)
      from public.tabs tab
      where tab.shift_id = target.id
        and tab.kind in ('settled', 'reversal')
        and tab.payment_method = 'cash'
    ), 0)
    + coalesce((
      select sum(case when movement.kind = 'in' then movement.amount_millimes else -movement.amount_millimes end)
      from public.cash_movements movement
      where movement.shift_id = target.id
    ), 0)
    + coalesce((
      select sum(adjustment.amount_millimes)
      from public.shift_void_adjustments adjustment
      join public.orders order_record
        on order_record.id = adjustment.order_id
        and order_record.shift_id = adjustment.shift_id
        and order_record.store_id = adjustment.store_id
      where adjustment.shift_id = target.id
        and order_record.payment_method = 'cash'
    ), 0);
end
$$;

create or replace function public.reverse_tab_payment(
  p_payment_id uuid,
  p_pin text,
  p_reason text
)
returns public.tabs
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment public.tabs%rowtype;
  target_shift public.shifts%rowtype;
  result public.tabs%rowtype;
begin
  select * into payment from public.tabs where id = p_payment_id for update;
  if not found or payment.store_id <> (select public.current_store_id())
    or not public.is_store_owner(payment.store_id) then
    raise exception 'Only this store owner can reverse a tab payment.' using errcode = '42501';
  end if;
  if payment.kind <> 'settled' or length(btrim(coalesce(p_reason, ''))) = 0 or length(p_reason) > 500 then
    raise exception 'A valid payment and reversal reason are required.';
  end if;
  if exists (select 1 from public.tabs where reverses_tab_id = payment.id) then
    raise exception 'This payment has already been reversed.';
  end if;
  if not public.verify_store_pin(payment.store_id, p_pin, 'credit_override') then
    raise exception 'Incorrect Admin PIN.';
  end if;

  select * into target_shift
  from public.shifts
  where store_id = payment.store_id
    and staff_id = auth.uid()
    and status = 'open'
  order by opened_at desc
  limit 1
  for update;

  insert into public.tabs (
    store_id, customer_id, shift_id, staff_id, kind, amount_millimes,
    note, reverses_tab_id, payment_method
  ) values (
    payment.store_id,
    payment.customer_id,
    coalesce(target_shift.id, payment.shift_id),
    auth.uid(),
    'reversal',
    payment.amount_millimes,
    btrim(p_reason),
    payment.id,
    payment.payment_method
  ) returning * into result;
  return result;
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
  select coalesce(report.period_to, report.created_at) into last_z_at
  from public.reports report
  where report.store_id = p_store_id and report.type = 'Z'
  order by report.created_at desc
  limit 1;
  select min(shift.opened_at) into opened_at
  from public.shifts shift
  where shift.store_id = p_store_id
    and (last_z_at is null or shift.opened_at > last_z_at);
  return coalesce(
    (opened_at at time zone store_timezone)::date,
    (now() at time zone store_timezone)::date
  );
end
$$;

create or replace function public.create_order(
  p_shift_id uuid,
  p_items jsonb,
  p_payment_method text default 'cash',
  p_customer_id uuid default null,
  p_location text default null,
  p_note text default null,
  p_admin_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target_shift public.shifts%rowtype;
  target_store public.stores%rowtype;
  target_customer public.customers%rowtype;
  item_line jsonb;
  catalog_item record;
  selected_modifiers text[];
  modifier_total bigint;
  matched_modifier_count integer;
  v_quantity integer;
  unit_price bigint;
  line_total bigint;
  total bigint := 0;
  business_day date;
  v_order_number integer;
  v_order_id uuid := gen_random_uuid();
  order_row public.orders%rowtype;
  prepared_lines jsonb := '[]'::jsonb;
  outstanding bigint;
  limit_value bigint;
  effective_payment text := coalesce(p_payment_method, 'cash');
  line_rows jsonb;
begin
  select * into actor from public.profiles where id = auth.uid() and is_active;
  if actor.id is null or actor.store_id is null
    or not (actor.role = 'owner' or public.has_store_permission('take_orders')) then
    raise exception 'Not authorized to create orders.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item before completing an order.';
  end if;
  select * into target_store from public.stores where store_id = actor.store_id for share;
  if not found or not target_store.is_active then
    raise exception 'This store is inactive.';
  end if;
  business_day := public.get_current_business_date(actor.store_id);
  if target_store.day_closed_on = business_day then
    raise exception 'The business day is closed. Open a new shift to continue.';
  end if;
  select * into target_shift
  from public.shifts
  where id = p_shift_id and store_id = actor.store_id and staff_id = actor.id and status = 'open'
  for update;
  if not found then
    raise exception 'The business day is closed. Open a new shift to continue.';
  end if;
  if effective_payment not in ('cash', 'card', 'other', 'tab') then
    raise exception 'Choose a valid payment method.';
  end if;
  if effective_payment = 'card' and not target_store.allow_card_payments then
    raise exception 'Card payments are not enabled for this store.';
  end if;
  if effective_payment = 'other' and not target_store.allow_other_payments then
    raise exception 'Other payments are not enabled for this store.';
  end if;
  if effective_payment = 'tab' then
    if actor.role <> 'owner' and not public.has_store_permission('use_tabs') then
      raise exception 'Your position does not allow customer tabs.' using errcode = '42501';
    end if;
    if p_customer_id is null then
      raise exception 'Select a customer before charging this order to a tab.';
    end if;
    select * into target_customer
    from public.customers
    where id = p_customer_id and store_id = actor.store_id and is_active
    for update;
    if not found then
      raise exception 'Select an active customer from this store.';
    end if;
  elsif p_customer_id is not null then
    raise exception 'A customer can only be attached to a tab order.';
  end if;

  for item_line in select value from jsonb_array_elements(p_items) as input(value) loop
    if item_line->>'itemId' is null
      or jsonb_typeof(item_line->'quantity') <> 'number'
      or (item_line->>'quantity') !~ '^[1-9][0-9]*$' then
      raise exception 'Order contains an invalid quantity.';
    end if;
    v_quantity := (item_line->>'quantity')::integer;
    if v_quantity < 1 then
      raise exception 'Order contains an invalid quantity.';
    end if;
    if jsonb_typeof(coalesce(item_line->'modifiers', '[]'::jsonb)) <> 'array' then
      raise exception 'Order contains invalid modifiers.';
    end if;
    selected_modifiers := array(
      select jsonb_array_elements_text(coalesce(item_line->'modifiers', '[]'::jsonb))
    );
    if cardinality(selected_modifiers) <> cardinality(array(select distinct unnest(selected_modifiers))) then
      raise exception 'Order contains a duplicate item modifier.';
    end if;

    select item.*, category.name as category_name
    into catalog_item
    from public.catalog_items item
    join public.categories category
      on category.id = item.category_id and category.store_id = item.store_id
    where item.id = (item_line->>'itemId')::uuid
      and item.store_id = actor.store_id
      and item.is_active
      and category.is_active
    for update of item;
    if not found then
      raise exception 'Order contains an item that is not in this store catalog.';
    end if;
    if catalog_item.out_of_stock or catalog_item.stock_count = 0 then
      raise exception '% is out of stock.', catalog_item.name;
    end if;
    if catalog_item.stock_count is not null and v_quantity > catalog_item.stock_count then
      raise exception '% has only % remaining.', catalog_item.name, catalog_item.stock_count;
    end if;
    if catalog_item.modifiers_required and cardinality(selected_modifiers) = 0 then
      raise exception 'Choose a modifier for %.', catalog_item.name;
    end if;
    if catalog_item.modifier_selection_mode = 'single' and cardinality(selected_modifiers) > 1 then
      raise exception 'Choose only one modifier for %.', catalog_item.name;
    end if;
    select coalesce(sum(modifier.price_millimes), 0), count(*)::integer
    into modifier_total, matched_modifier_count
    from public.catalog_modifiers modifier
    where modifier.store_id = actor.store_id
      and modifier.item_id = catalog_item.id
      and modifier.name = any(selected_modifiers);
    if matched_modifier_count <> cardinality(selected_modifiers) then
      raise exception 'Order contains an invalid modifier for %.', catalog_item.name;
    end if;
    unit_price := catalog_item.price_millimes + modifier_total;
    line_total := unit_price * v_quantity;
    total := total + line_total;
    if total > 9000000000000000 then
      raise exception 'Order total is too large.';
    end if;
    prepared_lines := prepared_lines || jsonb_build_array(jsonb_build_object(
      'item_id', catalog_item.id,
      'category_id', catalog_item.category_id,
      'category_name', catalog_item.category_name,
      'name', catalog_item.name,
      'quantity', v_quantity,
      'unit_price_millimes', unit_price,
      'line_total_millimes', line_total,
      'modifiers', selected_modifiers
    ));
    if catalog_item.stock_count is not null then
      update public.catalog_items
      set stock_count = stock_count - v_quantity,
          out_of_stock = (stock_count - v_quantity) = 0,
          out_of_stock_by = case when stock_count - v_quantity = 0 then actor.id else out_of_stock_by end,
          out_of_stock_at = case when stock_count - v_quantity = 0 then now() else out_of_stock_at end
      where id = catalog_item.id;
    end if;
  end loop;

  if effective_payment = 'tab' and target_customer.credit_limit_millimes is not null then
    select coalesce((
      select sum(order_record.total_millimes)
      from public.orders order_record
      where order_record.customer_id = target_customer.id
        and order_record.payment_method = 'tab'
        and order_record.status = 'done'
    ), 0) + coalesce((
      select sum(case
        when tab.kind = 'settled' then -tab.amount_millimes
        when tab.kind = 'reversal' then tab.amount_millimes
        else tab.amount_millimes
      end)
      from public.tabs tab
      where tab.customer_id = target_customer.id
        and (tab.kind <> 'issued' or tab.order_id is null)
    ), 0)
    into outstanding;
    limit_value := target_customer.credit_limit_millimes;
    if outstanding + total > limit_value then
      if p_admin_pin is null or target_store.pin_must_change
        or not public.verify_store_pin(actor.store_id, p_admin_pin, 'credit_override') then
        raise exception 'Customer credit limit reached.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  insert into public.order_counters as counter (store_id, business_date, next_number)
  values (actor.store_id, business_day, 2)
  on conflict (store_id, business_date)
  do update set next_number = counter.next_number + 1
  returning counter.next_number - 1 into v_order_number;

  insert into public.orders (
    id, store_id, number, business_date, staff_id, shift_id, location, status,
    payment_method, customer_id, note, total_millimes
  ) values (
    v_order_id, actor.store_id, v_order_number, business_day, actor.id, target_shift.id,
    nullif(btrim(p_location), ''), 'done', effective_payment, p_customer_id,
    nullif(btrim(p_note), ''), total
  ) returning * into order_row;

  insert into public.order_lines (
    store_id, order_id, item_id, category_id, category_name, name,
    quantity, unit_price_millimes, line_total_millimes, modifiers
  )
  select actor.store_id, v_order_id,
    (line->>'item_id')::uuid,
    (line->>'category_id')::uuid,
    line->>'category_name',
    line->>'name',
    (line->>'quantity')::integer,
    (line->>'unit_price_millimes')::bigint,
    (line->>'line_total_millimes')::bigint,
    array(select jsonb_array_elements_text(line->'modifiers'))
  from jsonb_array_elements(prepared_lines) as lines(line);

  if effective_payment = 'tab' then
    insert into public.tabs (
      store_id, customer_id, order_id, shift_id, staff_id, kind, amount_millimes
    ) values (
      actor.store_id, target_customer.id, v_order_id, target_shift.id, actor.id, 'issued', total
    );
  end if;
  select coalesce(jsonb_agg(to_jsonb(order_line) - 'store_id'), '[]'::jsonb)
  into line_rows from public.order_lines order_line where order_line.order_id = v_order_id;
  return jsonb_build_object(
    'order', to_jsonb(order_row) - 'store_id',
    'items', line_rows,
    'store_name', target_store.name,
    'staff_name', actor.name
  );
end
$$;

create or replace function public.record_cash_movement(
  p_shift_id uuid,
  p_kind text,
  p_amount_millimes bigint,
  p_reason text,
  p_note text default null
)
returns public.cash_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target public.shifts%rowtype;
  result public.cash_movements%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid() and is_active;
  select * into target from public.shifts where id = p_shift_id for update;
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
  if p_kind not in ('in', 'out') or p_amount_millimes is null or p_amount_millimes <= 0
    or p_reason not in ('supplier', 'change', 'expense', 'other')
    or length(coalesce(p_note, '')) > 500 then
    raise exception 'Cash movement details are invalid.';
  end if;
  insert into public.cash_movements (
    store_id, shift_id, staff_id, kind, amount_millimes, reason, note
  ) values (
    target.store_id, target.id, actor.id, p_kind, p_amount_millimes, p_reason,
    nullif(btrim(p_note), '')
  ) returning * into result;
  return result;
end
$$;

create or replace function public.settle_customer_tab(
  p_customer_id uuid,
  p_amount_millimes bigint,
  p_shift_id uuid,
  p_payment_method text default 'cash',
  p_note text default null
)
returns public.tabs
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target_customer public.customers%rowtype;
  target_shift public.shifts%rowtype;
  target_store public.stores%rowtype;
  balance bigint;
  result public.tabs%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid() and is_active;
  if actor.id is null then
    raise exception 'Not authorized to take a tab payment.' using errcode = '42501';
  end if;
  select * into target_customer from public.customers
  where id = p_customer_id and store_id = actor.store_id and is_active
  for update;
  select * into target_shift from public.shifts
  where id = p_shift_id and store_id = actor.store_id and staff_id = actor.id and status = 'open';
  if target_shift.id is null then
    raise exception 'The business day is closed. Open a new shift to continue.';
  end if;
  if target_customer.id is null
    or (actor.role <> 'owner' and not public.has_store_permission('settle_tabs')) then
    raise exception 'Not authorized to take a tab payment.' using errcode = '42501';
  end if;
  if p_amount_millimes is null or p_amount_millimes <= 0
    or p_payment_method not in ('cash', 'card', 'other')
    or length(coalesce(p_note, '')) > 500 then
    raise exception 'Tab payment details are invalid.';
  end if;
  select * into target_store from public.stores where store_id = actor.store_id;
  select
    coalesce((
      select sum(order_record.total_millimes)
      from public.orders order_record
      where order_record.customer_id = target_customer.id
        and order_record.payment_method = 'tab'
        and order_record.status = 'done'
    ), 0)
    + coalesce((
      select sum(case
        when tab.kind = 'settled' then -tab.amount_millimes
        else tab.amount_millimes
      end)
      from public.tabs tab
      where tab.customer_id = target_customer.id
        and (tab.kind <> 'issued' or tab.order_id is null)
    ), 0)
  into balance;
  if p_amount_millimes > balance and not target_store.allow_customer_credit_balance then
    raise exception 'This payment exceeds the balance. Ask the owner to enable customer credit balances in Store settings.';
  end if;
  insert into public.tabs (
    store_id, customer_id, shift_id, staff_id, kind, amount_millimes, payment_method, note
  ) values (
    actor.store_id, target_customer.id, target_shift.id, actor.id, 'settled',
    p_amount_millimes, p_payment_method, nullif(btrim(p_note), '')
  ) returning * into result;
  update public.customers set last_payment_at = result.created_at where id = target_customer.id;
  return result;
end
$$;

create or replace function public.get_customer_balance(p_customer_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.customers%rowtype;
  result bigint;
begin
  select * into target from public.customers where id = p_customer_id;
  if not found or target.store_id <> (select public.current_store_id())
    or not (
      public.is_store_owner(target.store_id)
      or public.has_store_permission('customers_view')
      or public.has_store_permission('use_tabs')
      or public.has_store_permission('settle_tabs')
    ) then
    raise exception 'Not authorized to view this customer balance.' using errcode = '42501';
  end if;
  select coalesce((
      select sum(order_record.total_millimes)
      from public.orders order_record
      where order_record.customer_id = target.id
        and order_record.payment_method = 'tab'
        and order_record.status = 'done'
    ), 0)
    + coalesce((
      select sum(case when tab.kind = 'settled' then -tab.amount_millimes else tab.amount_millimes end)
      from public.tabs tab
      where tab.customer_id = target.id
        and (tab.kind <> 'issued' or tab.order_id is null)
    ), 0)
  into result;
  return result;
end
$$;

create or replace function public.get_next_order_number()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_store uuid := (select public.current_store_id());
  business_day date;
  result integer;
begin
  if current_store is null
    or not (public.current_user_role() = 'owner' or public.has_store_permission('take_orders')) then
    raise exception 'Not authorized to read order numbers.' using errcode = '42501';
  end if;
  business_day := public.get_current_business_date(current_store);
  select counter.next_number into result
  from public.order_counters counter
  where counter.store_id = current_store
    and counter.business_date = business_day;
  return coalesce(result, 1);
end
$$;

create or replace function public.record_report(p_report jsonb, p_pin text default null)
returns public.reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target_store public.stores%rowtype;
  report_type text;
  business_day date;
  assigned_z_number integer;
  result public.reports%rowtype;
  report_data jsonb := p_report;
  previous_z_at timestamptz;
  expected_period_from timestamptz;
  period_from timestamptz;
  period_to timestamptz;
  report_created_at timestamptz;
  server_order_count integer;
  server_sales bigint;
  server_payment_split jsonb;
  server_sales_collected bigint;
  server_expenses bigint;
  server_receivable bigint;
  server_tabs_outstanding bigint;
  server_tabs_issued bigint;
  server_cash_tab_payments bigint;
  server_card_tab_payments bigint;
  server_other_tab_payments bigint;
  server_non_cash_tab_payments bigint;
  server_cash_in bigint;
  server_cash_out bigint;
  server_void_count integer;
  server_void_total bigint;
  server_pending_count integer;
  server_pending_total bigint;
  server_comp_count integer;
  server_comp_quantity integer;
  server_comp_total bigint;
  server_expected_cash bigint;
  server_cash_float bigint;
  server_cash_refunds bigint;
  expected_cash_ex_float bigint;
  server_total_counted bigint;
  server_total_difference bigint;
  counted_cash bigint;
  cash_difference bigint;
  counted_card bigint;
  expected_card bigint;
  card_difference bigint;
  counted_other bigint;
  expected_other bigint;
  other_difference bigint;
  shift_count integer;
  server_shift_lines jsonb;
  server_voids jsonb;
  server_pending_voids jsonb;
  server_comps jsonb;
  server_expense_details jsonb;
  server_customer_tabs jsonb;
  first_ticket integer;
  last_ticket integer;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active;
  select * into target_store
  from public.stores
  where store_id = actor.store_id
  for update;
  if actor.id is null or actor.role <> 'owner' or target_store.store_id is null then
    raise exception 'Only this store owner can record reports.' using errcode = '42501';
  end if;

  report_type := nullif(p_report->>'type', '');
  business_day := public.get_current_business_date(target_store.store_id);
  period_from := nullif(p_report->>'periodFrom', 'null')::timestamptz;
  period_to := nullif(p_report->>'periodTo', 'null')::timestamptz;
  report_created_at := nullif(p_report->>'createdAt', 'null')::timestamptz;
  if report_type not in ('X', 'Z')
    or period_from is null or period_to is null or report_created_at is null
    or period_from > period_to or period_to is distinct from report_created_at
    or period_to < now() - interval '5 minutes'
    or period_to > now() + interval '30 seconds' then
    raise exception 'Report details or period are invalid.';
  end if;

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
  expected_period_from := coalesce(
    previous_z_at,
    business_day::timestamp at time zone target_store.timezone
  );
  if period_from is distinct from expected_period_from then
    raise exception 'Report period does not begin after the last Z close or the first shift business date.';
  end if;

  select count(*)::integer,
    coalesce(sum(order_record.total_millimes), 0)::bigint,
    jsonb_build_object(
      'cash', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'cash'), 0),
      'card', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'card'), 0),
      'other', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'other'), 0),
      'tab', coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method = 'tab'), 0)
    ),
    coalesce(sum(order_record.total_millimes) filter (where order_record.payment_method <> 'tab'), 0)::bigint
  into server_order_count, server_sales, server_payment_split, server_sales_collected
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'done'
    and order_record.created_at between period_from and period_to;

  select
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'cash' and tab.kind = 'settled'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'cash' and tab.kind = 'reversal'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'card' and tab.kind = 'settled'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'card' and tab.kind = 'reversal'
    ), 0),
    coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'other' and tab.kind = 'settled'
    ), 0) - coalesce(sum(tab.amount_millimes) filter (
      where tab.payment_method = 'other' and tab.kind = 'reversal'
    ), 0)
  into server_cash_tab_payments, server_card_tab_payments, server_other_tab_payments
  from public.tabs tab
  where tab.store_id = target_store.store_id
    and tab.kind in ('settled', 'reversal')
    and tab.created_at between period_from and period_to;

  server_sales_collected := server_sales_collected
    + server_cash_tab_payments + server_card_tab_payments + server_other_tab_payments;
  server_payment_split := server_payment_split || jsonb_build_object(
    'cash', (server_payment_split->>'cash')::bigint,
    'card', (server_payment_split->>'card')::bigint,
    'other', (server_payment_split->>'other')::bigint,
    'tab', (server_payment_split->>'tab')::bigint
  );

  select coalesce(sum(expense.amount_millimes), 0)::bigint
  into server_expenses
  from public.expenses expense
  where expense.store_id = target_store.store_id
    and expense.date between (period_from at time zone target_store.timezone)::date
      and (period_to at time zone target_store.timezone)::date;

  select coalesce(sum(customer_balance.balance), 0)::bigint,
         coalesce(sum(greatest(customer_balance.balance, 0)), 0)::bigint
  into server_tabs_outstanding, server_receivable
  from (
    select customer.id,
      coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.customer_id = customer.id
          and order_record.payment_method = 'tab'
          and order_record.status = 'done'
          and order_record.created_at <= period_to
      ), 0)
      + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'issued'
          and tab.order_id is null and tab.created_at <= period_to
      ), 0)
      - coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'settled'
          and tab.created_at <= period_to
      ), 0)
      + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'reversal'
          and tab.created_at <= period_to
      ), 0) as balance
    from public.customers customer
    where customer.store_id = target_store.store_id
  ) customer_balance;

  select coalesce(sum(order_record.total_millimes), 0)::bigint
  into server_tabs_issued
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'done'
    and order_record.payment_method = 'tab'
    and order_record.created_at between period_from and period_to;

  select count(*)::integer, coalesce(sum(order_record.total_millimes), 0)::bigint
  into server_void_count, server_void_total
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'voided'
    and order_record.voided_at between period_from and period_to;
  select count(*)::integer, coalesce(sum(order_record.total_millimes), 0)::bigint
  into server_pending_count, server_pending_total
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'pending_void';
  select count(*)::integer, coalesce(sum(comp.quantity), 0)::integer,
         coalesce(sum(comp.value_millimes), 0)::bigint
  into server_comp_count, server_comp_quantity, server_comp_total
  from public.comps comp
  where comp.store_id = target_store.store_id
    and comp.created_at between period_from and period_to;
  select coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'in'), 0)::bigint,
         coalesce(sum(movement.amount_millimes) filter (where movement.kind = 'out'), 0)::bigint
  into server_cash_in, server_cash_out
  from public.cash_movements movement
  where movement.store_id = target_store.store_id
    and movement.created_at between period_from and period_to;
  server_non_cash_tab_payments := server_card_tab_payments + server_other_tab_payments;

  if nullif(p_report->>'orderCount', '')::integer is distinct from server_order_count
    or nullif(p_report->>'salesMillimes', '')::bigint is distinct from server_sales
    or nullif(p_report->>'salesCollectedMillimes', 'null')::bigint is distinct from server_sales_collected
    or nullif(p_report->>'expensesMillimes', 'null')::bigint is distinct from server_expenses
    or nullif(p_report->>'receivableMillimes', 'null')::bigint is distinct from server_receivable
    or p_report->'paymentSplit' is distinct from server_payment_split
    or coalesce((p_report->'voids'->>'count')::integer, -1) <> server_void_count
    or coalesce((p_report->'voids'->>'totalMillimes')::bigint, -1) <> server_void_total
    or coalesce((p_report->'pendingVoids'->>'count')::integer, -1) <> server_pending_count
    or coalesce((p_report->'pendingVoids'->>'totalMillimes')::bigint, -1) <> server_pending_total
    or coalesce((p_report->'comps'->>'count')::integer, -1) <> server_comp_count
    or coalesce((p_report->'comps'->>'quantity')::integer, -1) <> server_comp_quantity
    or coalesce((p_report->'comps'->>'totalMillimes')::bigint, -1) <> server_comp_total
    or coalesce((p_report->>'tabsIssuedMillimes')::bigint, -1) <> server_tabs_issued
    or coalesce((p_report->>'tabsOutstandingMillimes')::bigint, -1) <> server_tabs_outstanding
    or coalesce((p_report->>'tabsSettledMillimes')::bigint, -1) <> server_cash_tab_payments
    or coalesce((p_report->>'tabPaymentsReceivedMillimes')::bigint, -1) <> server_cash_tab_payments
    or coalesce((p_report->>'nonCashTabPaymentsMillimes')::bigint, -1) <> server_non_cash_tab_payments
    or coalesce((p_report->>'cashInMillimes')::bigint, -1) <> server_cash_in
    or coalesce((p_report->>'cashOutMillimes')::bigint, -1) <> server_cash_out
    or coalesce((p_report->>'cashRefundsMillimes')::bigint, -1) <> coalesce((
      select sum(tab.amount_millimes)
      from public.tabs tab
      join public.shifts shift on shift.id = tab.shift_id
      where tab.store_id = target_store.store_id
        and tab.kind = 'reversal'
        and tab.payment_method = 'cash'
        and tab.created_at between period_from and period_to
        and shift.closed_at < tab.created_at
    ), 0) then
    raise exception 'Report snapshot totals do not match persisted sales, tabs, voids, expenses, comps, or payments.';
  end if;

  select count(*)::integer into shift_count
  from public.shifts shift
  where shift.store_id = target_store.store_id
    and shift.opened_at <= period_to
    and coalesce(shift.closed_at, period_to) >= period_from;
  if jsonb_typeof(p_report->'shifts') <> 'array'
    or jsonb_array_length(p_report->'shifts') <> shift_count then
    raise exception 'Report shift lines do not match persisted shifts.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_report->'shifts') snapshot_line
    where not exists (
      select 1
      from public.shifts shift
      where shift.id = (snapshot_line->>'shiftId')::uuid
        and shift.store_id = target_store.store_id
        and shift.starting_cash_millimes = (snapshot_line->>'startingCashMillimes')::bigint
        and shift.force_closed_by_owner = (snapshot_line->>'forceClosedByOwner')::boolean
    )
  ) then
    raise exception 'Report shift lines contain values that do not match persisted shifts.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shiftId', shift.id,
    'staffName', profile.name,
    'orderCount', (select count(*)::integer from public.orders order_record
      where order_record.shift_id = shift.id and order_record.status = 'done'
        and order_record.created_at between period_from and period_to),
    'status', case when shift.status = 'open' then 'in_progress' else 'closed' end,
    'openedAt', shift.opened_at,
    'closedAt', shift.closed_at,
    'startingCashMillimes', shift.starting_cash_millimes,
    'cashSalesMillimes', (select coalesce(sum(order_record.total_millimes), 0)
      from public.orders order_record where order_record.shift_id = shift.id
        and order_record.status = 'done' and order_record.payment_method = 'cash'
        and order_record.created_at between period_from and period_to),
    'cardSalesMillimes', (select coalesce(sum(order_record.total_millimes), 0)
      from public.orders order_record where order_record.shift_id = shift.id
        and order_record.status = 'done' and order_record.payment_method = 'card'
        and order_record.created_at between period_from and period_to),
    'otherSalesMillimes', (select coalesce(sum(order_record.total_millimes), 0)
      from public.orders order_record where order_record.shift_id = shift.id
        and order_record.status = 'done' and order_record.payment_method = 'other'
        and order_record.created_at between period_from and period_to),
    'tabSalesMillimes', (select coalesce(sum(order_record.total_millimes), 0)
      from public.orders order_record where order_record.shift_id = shift.id
        and order_record.status = 'done' and order_record.payment_method = 'tab'
        and order_record.created_at between period_from and period_to),
    'tabPaymentsMillimes', (select coalesce(sum(case when tab.kind = 'settled'
        then tab.amount_millimes else -tab.amount_millimes end), 0)
      from public.tabs tab where tab.shift_id = shift.id and tab.payment_method = 'cash'
        and tab.kind in ('settled', 'reversal') and tab.created_at between period_from and period_to),
    'cashInMillimes', (select coalesce(sum(movement.amount_millimes), 0)
      from public.cash_movements movement where movement.shift_id = shift.id
        and movement.kind = 'in' and movement.created_at between period_from and period_to),
    'cashOutMillimes', (select coalesce(sum(movement.amount_millimes), 0)
      from public.cash_movements movement where movement.shift_id = shift.id
        and movement.kind = 'out' and movement.created_at between period_from and period_to),
    'expectedCashMillimes', case when shift.status = 'closed'
      then shift.expected_cash_millimes + coalesce((select sum(adjustment.amount_millimes)
        from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
          and adjustment.created_at between period_from and period_to), 0)
      else public.get_shift_expected_cash(shift.id) end,
    'cashFlowExFloatMillimes', case when shift.status = 'closed'
      then shift.expected_cash_millimes + coalesce((select sum(adjustment.amount_millimes)
        from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
          and adjustment.created_at between period_from and period_to), 0) - shift.starting_cash_millimes
      else public.get_shift_expected_cash(shift.id) - shift.starting_cash_millimes end,
    'countedCashMillimes', shift.counted_cash_millimes,
    'differenceMillimes', case when shift.counted_cash_millimes is null then null
      else shift.counted_cash_millimes - shift.expected_cash_millimes
        - coalesce((select sum(adjustment.amount_millimes)
          from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
            and adjustment.created_at between period_from and period_to), 0) end,
    'voidAdjustmentMillimes', nullif((select coalesce(sum(adjustment.amount_millimes), 0)
      from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
        and adjustment.created_at between period_from and period_to), 0),
    'voidRequestsMillimes', nullif((select coalesce(sum(adjustment.amount_millimes), 0)
      from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
        and adjustment.kind = 'requested'
        and adjustment.created_at between period_from and period_to), 0),
    'voidRejectionsMillimes', nullif((select coalesce(sum(adjustment.amount_millimes), 0)
      from public.shift_void_adjustments adjustment where adjustment.shift_id = shift.id
        and adjustment.kind = 'rejected'
        and adjustment.created_at between period_from and period_to), 0),
    'forceClosedByOwner', shift.force_closed_by_owner,
    'voidsAutoApprovedCount', shift.voids_auto_approved_count
  ) order by shift.opened_at), '[]'::jsonb)
  into server_shift_lines
  from public.shifts shift
  join public.profiles profile on profile.id = shift.staff_id
  where shift.store_id = target_store.store_id
    and shift.opened_at <= period_to
    and coalesce(shift.closed_at, period_to) >= period_from;

  select coalesce(sum((line->>'expectedCashMillimes')::bigint), 0)::bigint,
         coalesce(sum((line->>'startingCashMillimes')::bigint), 0)::bigint,
         coalesce(sum((line->>'countedCashMillimes')::bigint)
           filter (where line->>'status' = 'closed'), 0)::bigint,
         coalesce(sum((line->>'differenceMillimes')::bigint)
           filter (where line->>'status' = 'closed'), 0)::bigint
  into server_expected_cash, server_cash_float, server_total_counted, server_total_difference
  from jsonb_array_elements(server_shift_lines) line;
  select server_expected_cash + coalesce(sum(adjustment.amount_millimes), 0)::bigint
  into server_expected_cash
  from public.shift_void_adjustments adjustment
  where adjustment.store_id = target_store.store_id
    and adjustment.created_at between period_from and period_to
    and not exists (
      select 1 from public.shifts shift
      where shift.id = adjustment.shift_id
        and shift.opened_at <= period_to
        and coalesce(shift.closed_at, period_to) >= period_from
    );
  select coalesce(sum(tab.amount_millimes), 0)::bigint
  into server_cash_refunds
  from public.tabs tab
  join public.shifts shift on shift.id = tab.shift_id
  where tab.store_id = target_store.store_id
    and tab.kind = 'reversal'
    and tab.payment_method = 'cash'
    and tab.created_at between period_from and period_to
    and shift.closed_at < tab.created_at;
  server_cash_refunds := coalesce(server_cash_refunds, 0);
  server_expected_cash := coalesce(server_expected_cash, 0) - server_cash_refunds;
  expected_cash_ex_float := server_expected_cash - server_cash_float;

  select jsonb_build_object(
    'count', count(*)::integer,
    'totalMillimes', coalesce(sum(order_record.total_millimes), 0)::bigint,
    'orders', coalesce(jsonb_agg(jsonb_build_object(
      'ticketNumber', order_record.number,
      'reason', coalesce(order_record.void_reason, ''),
      'totalMillimes', order_record.total_millimes,
      'autoApprovedAtForcedClose', order_record.void_reason = 'Auto-approved at forced close',
      'approvedBy', coalesce(profile.name,
        case when order_record.voided_by = 'owner' then 'Owner'
             when order_record.voided_by = 'pin' then 'PIN authorized' else 'Unknown' end)
    ) order by order_record.number), '[]'::jsonb)
  ) into server_voids
  from public.orders order_record
  left join public.profiles profile on profile.id = order_record.voided_by_user_id
  where order_record.store_id = target_store.store_id
    and order_record.status = 'voided'
    and order_record.voided_at between period_from and period_to;

  select jsonb_build_object(
    'count', count(*)::integer,
    'totalMillimes', coalesce(sum(order_record.total_millimes), 0)::bigint,
    'orders', coalesce(jsonb_agg(jsonb_build_object(
      'ticketNumber', order_record.number,
      'staffName', profile.name,
      'shiftId', order_record.shift_id,
      'amountMillimes', order_record.total_millimes,
      'paymentMethod', order_record.payment_method,
      'reason', coalesce(order_record.void_reason, ''),
      'requestedAt', coalesce(order_record.void_requested_at, order_record.created_at)
    ) order by order_record.number), '[]'::jsonb)
  ) into server_pending_voids
  from public.orders order_record
  join public.profiles profile on profile.id = order_record.staff_id
  where order_record.store_id = target_store.store_id
    and order_record.status = 'pending_void';

  select jsonb_build_object(
    'count', count(*)::integer,
    'quantity', coalesce(sum(comp.quantity), 0)::integer,
    'totalMillimes', coalesce(sum(comp.value_millimes), 0)::bigint,
    'records', coalesce(jsonb_agg(jsonb_build_object(
      'staffName', profile.name,
      'itemName', comp.name,
      'quantity', comp.quantity,
      'valueMillimes', comp.value_millimes,
      'reason', comp.reason,
      'note', comp.note,
      'createdAt', comp.created_at
    ) order by comp.created_at), '[]'::jsonb)
  ) into server_comps
  from public.comps comp
  join public.profiles profile on profile.id = comp.staff_id
  where comp.store_id = target_store.store_id
    and comp.created_at between period_from and period_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'expenseId', expense.id,
    'category', expense.category,
    'amountMillimes', expense.amount_millimes,
    'paidMillimes', expense.paid_millimes,
    'date', expense.date,
    'supplierId', expense.supplier_id,
    'note', expense.note,
    'createdBy', profile.name
  ) order by expense.date, expense.id), '[]'::jsonb)
  into server_expense_details
  from public.expenses expense
  join public.profiles profile on profile.id = expense.created_by
  where expense.store_id = target_store.store_id
    and expense.date between (period_from at time zone target_store.timezone)::date
      and (period_to at time zone target_store.timezone)::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'customerId', customer.id,
    'customerName', customer.name,
    'issuedMillimes', tab_totals.issued_millimes,
    'paymentsMillimes', tab_totals.payments_millimes,
    'outstandingMillimes', tab_totals.outstanding_millimes
  ) order by customer.name), '[]'::jsonb)
  into server_customer_tabs
  from public.customers customer
  cross join lateral (
    select
      coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.customer_id = customer.id
          and order_record.payment_method = 'tab'
          and order_record.status = 'done'
          and order_record.created_at between period_from and period_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id
          and tab.kind = 'issued' and tab.order_id is null
          and tab.created_at between period_from and period_to
      ), 0) as issued_millimes,
      coalesce((
        select sum(case when tab.kind = 'settled' then tab.amount_millimes else -tab.amount_millimes end)
        from public.tabs tab
        where tab.customer_id = customer.id
          and tab.kind in ('settled', 'reversal')
          and tab.created_at between period_from and period_to
      ), 0) as payments_millimes,
      coalesce((
        select sum(order_record.total_millimes)
        from public.orders order_record
        where order_record.customer_id = customer.id
          and order_record.payment_method = 'tab'
          and order_record.status = 'done'
          and order_record.created_at <= period_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'issued'
          and tab.order_id is null and tab.created_at <= period_to
      ), 0) - coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'settled'
          and tab.created_at <= period_to
      ), 0) + coalesce((
        select sum(tab.amount_millimes)
        from public.tabs tab
        where tab.customer_id = customer.id and tab.kind = 'reversal'
          and tab.created_at <= period_to
      ), 0) as outstanding_millimes
  ) tab_totals
  where customer.store_id = target_store.store_id
    and (tab_totals.issued_millimes <> 0 or tab_totals.payments_millimes <> 0
      or tab_totals.outstanding_millimes <> 0);

  if nullif(p_report->>'totalExpectedCashMillimes', 'null')::bigint is distinct from server_expected_cash
    or nullif(p_report->>'cashFloatMillimes', 'null')::bigint is distinct from server_cash_float
    or nullif(p_report->>'expectedCashExFloatMillimes', 'null')::bigint is distinct from expected_cash_ex_float
    or nullif(p_report->>'totalCountedMillimes', 'null')::bigint is distinct from server_total_counted
    or nullif(p_report->>'totalDifferenceMillimes', 'null')::bigint is distinct from server_total_difference
    or (report_type = 'X'
      and nullif(p_report->>'cashDifferenceMillimes', '')::bigint is distinct from server_total_difference) then
    raise exception 'Report cash totals do not match persisted shift and refund ledgers.';
  end if;

  select (array_agg(order_record.number order by order_record.created_at, order_record.number))[1],
         (array_agg(order_record.number order by order_record.created_at desc, order_record.number desc))[1]
  into first_ticket, last_ticket
  from public.orders order_record
  where order_record.store_id = target_store.store_id
    and order_record.status = 'done'
    and order_record.created_at between period_from and period_to;

  report_data := jsonb_set(report_data, '{paymentSplit}', server_payment_split, true);
  report_data := jsonb_set(report_data, '{shifts}', server_shift_lines, true);
  report_data := jsonb_set(report_data, '{voids}', server_voids, true);
  report_data := jsonb_set(report_data, '{pendingVoids}', server_pending_voids, true);
  report_data := jsonb_set(report_data, '{comps}', server_comps, true);
  report_data := jsonb_set(report_data, '{expenseDetails}', server_expense_details, true);
  report_data := jsonb_set(report_data, '{customerTabs}', server_customer_tabs, true);
  report_data := jsonb_set(report_data, '{salesMillimes}', to_jsonb(server_sales), true);
  report_data := jsonb_set(report_data, '{salesCollectedMillimes}', to_jsonb(server_sales_collected), true);
  report_data := jsonb_set(report_data, '{expensesMillimes}', to_jsonb(server_expenses), true);
  report_data := jsonb_set(report_data, '{netProfitMillimes}', to_jsonb(server_sales_collected - server_expenses), true);
  report_data := jsonb_set(report_data, '{totalExpectedCashMillimes}', to_jsonb(server_expected_cash), true);
  report_data := jsonb_set(report_data, '{cashFloatMillimes}', to_jsonb(server_cash_float), true);
  report_data := jsonb_set(report_data, '{expectedCashExFloatMillimes}', to_jsonb(expected_cash_ex_float), true);
  report_data := jsonb_set(report_data, '{totalCountedMillimes}', to_jsonb(server_total_counted), true);
  report_data := jsonb_set(report_data, '{totalDifferenceMillimes}', to_jsonb(server_total_difference), true);
  report_data := jsonb_set(report_data, '{receivableMillimes}', to_jsonb(server_receivable), true);
  report_data := jsonb_set(report_data, '{tabsOutstandingMillimes}', to_jsonb(server_tabs_outstanding), true);
  report_data := jsonb_set(report_data, '{tabsIssuedMillimes}', to_jsonb(server_tabs_issued), true);
  report_data := jsonb_set(report_data, '{tabsSettledMillimes}', to_jsonb(server_cash_tab_payments), true);
  report_data := jsonb_set(report_data, '{nonCashTabPaymentsMillimes}',
    to_jsonb(server_non_cash_tab_payments), true);
  report_data := jsonb_set(report_data, '{tabPaymentsReceivedMillimes}', to_jsonb(server_cash_tab_payments), true);
  report_data := jsonb_set(report_data, '{cashInMillimes}', to_jsonb(server_cash_in), true);
  report_data := jsonb_set(report_data, '{cashOutMillimes}', to_jsonb(server_cash_out), true);
  report_data := jsonb_set(report_data, '{cashRefundsMillimes}', to_jsonb(coalesce((
    select sum(tab.amount_millimes)
    from public.tabs tab
    join public.shifts shift on shift.id = tab.shift_id
    where tab.store_id = target_store.store_id
      and tab.kind = 'reversal' and tab.payment_method = 'cash'
      and tab.created_at between period_from and period_to
      and shift.closed_at < tab.created_at
  ), 0)), true);
  report_data := jsonb_set(report_data, '{firstTicketNumber}', coalesce(to_jsonb(first_ticket), 'null'::jsonb), true);
  report_data := jsonb_set(report_data, '{lastTicketNumber}', coalesce(to_jsonb(last_ticket), 'null'::jsonb), true);
  report_data := jsonb_set(report_data, '{businessDate}', to_jsonb(business_day), true);

  if report_type = 'Z' then
    if server_pending_count > 0 then
      raise exception 'Resolve every void request before creating a Z report.';
    end if;
    if exists (
      select 1 from public.shifts
      where store_id = target_store.store_id and status = 'open'
    ) then
      raise exception 'Force-close or close every shift before creating a Z report.';
    end if;
    if nullif(p_pin, '') is null
      or not public.verify_store_pin(target_store.store_id, p_pin, 'z_report') then
      raise exception 'Incorrect owner PIN.';
    end if;

    select coalesce(sum(shift.expected_cash_millimes), 0)::bigint,
           coalesce(sum(shift.starting_cash_millimes), 0)::bigint
    into server_expected_cash, server_cash_float
    from public.shifts shift
    where shift.store_id = target_store.store_id
      and shift.status = 'closed'
      and shift.opened_at <= period_to
      and shift.closed_at between period_from and period_to;
    select coalesce(sum(tab.amount_millimes), 0)::bigint
    into server_cash_refunds
    from public.tabs tab
    join public.shifts shift on shift.id = tab.shift_id
    where tab.store_id = target_store.store_id
      and tab.kind = 'reversal'
      and tab.payment_method = 'cash'
      and tab.created_at between period_from and period_to
      and shift.closed_at < tab.created_at;
    server_cash_refunds := coalesce(server_cash_refunds, 0);
    select server_expected_cash + coalesce(sum(adjustment.amount_millimes), 0)::bigint
    into server_expected_cash
    from public.shift_void_adjustments adjustment
    join public.shifts shift on shift.id = adjustment.shift_id
    where adjustment.store_id = target_store.store_id
      and adjustment.created_at between period_from and period_to
      and adjustment.created_at > shift.closed_at;
    server_expected_cash := coalesce(server_expected_cash, 0) - server_cash_refunds;
    expected_cash_ex_float := server_expected_cash - server_cash_float;
    counted_cash := nullif(p_report->>'countedCashMillimes', 'null')::bigint;
    cash_difference := nullif(p_report->>'cashDifferenceMillimes', '')::bigint;
    expected_card := (server_payment_split->>'card')::bigint + server_card_tab_payments;
    expected_other := (server_payment_split->>'other')::bigint + server_other_tab_payments;
    counted_card := nullif(p_report->>'countedCardMillimes', 'null')::bigint;
    counted_other := nullif(p_report->>'countedOtherMillimes', 'null')::bigint;
    card_difference := counted_card - expected_card;
    other_difference := counted_other - expected_other;
    if counted_cash is null or counted_cash < 0
      or counted_card is null or counted_card < 0
      or counted_other is null or counted_other < 0
      or p_report->>'countedCashIncludesFloat' is distinct from 'true'
      or cash_difference is distinct from counted_cash - server_expected_cash
      or nullif(p_report->>'expectedCashExFloatMillimes', 'null')::bigint is distinct from expected_cash_ex_float
      or nullif(p_report->>'totalExpectedCashMillimes', 'null')::bigint is distinct from server_expected_cash
      or nullif(p_report->>'expectedCardMillimes', 'null')::bigint is distinct from expected_card
      or nullif(p_report->>'cardDifferenceMillimes', 'null')::bigint is distinct from card_difference
      or nullif(p_report->>'expectedOtherMillimes', 'null')::bigint is distinct from expected_other
      or nullif(p_report->>'otherDifferenceMillimes', 'null')::bigint is distinct from other_difference
      or ((cash_difference <> 0 or card_difference <> 0 or other_difference <> 0)
        and nullif(btrim(p_report->>'cashDifferenceNote'), '') is null) then
      raise exception 'Z counts are incomplete, require a note, or do not reconcile with the server ledger.';
    end if;
    select coalesce(max(report.z_number), 0) + 1
    into assigned_z_number
    from public.reports report
    where report.store_id = target_store.store_id and report.type = 'Z';
    report_data := jsonb_set(report_data, '{zNumber}', to_jsonb(assigned_z_number), true);
    report_data := jsonb_set(report_data, '{reportNumber}',
      to_jsonb('Z-' || pg_catalog.lpad(assigned_z_number::text, 6, '0')), true);
    report_data := jsonb_set(report_data, '{totalExpectedCashMillimes}', to_jsonb(server_expected_cash), true);
    report_data := jsonb_set(report_data, '{expectedCashExFloatMillimes}', to_jsonb(expected_cash_ex_float), true);
    report_data := jsonb_set(report_data, '{cashDifferenceMillimes}', to_jsonb(cash_difference), true);
    report_data := jsonb_set(report_data, '{countedCashIncludesFloat}', 'true'::jsonb, true);
    report_data := jsonb_set(report_data, '{expectedCardMillimes}', to_jsonb(expected_card), true);
    report_data := jsonb_set(report_data, '{cardDifferenceMillimes}', to_jsonb(card_difference), true);
    report_data := jsonb_set(report_data, '{expectedOtherMillimes}', to_jsonb(expected_other), true);
    report_data := jsonb_set(report_data, '{otherDifferenceMillimes}', to_jsonb(other_difference), true);
    report_data := jsonb_set(report_data, '{cashRefundsMillimes}', to_jsonb(server_cash_refunds), true);
    update public.stores set day_closed_on = business_day where store_id = target_store.store_id;
  end if;

  insert into public.reports (
    store_id, type, business_date, created_at, sales_millimes, sales_collected_millimes,
    expenses_millimes, net_profit_millimes, receivable_millimes, order_count,
    cash_difference_millimes, z_number, period_from, period_to, generated_by, data
  ) values (
    target_store.store_id, report_type, business_day, now(), server_sales,
    server_sales_collected, server_expenses, server_sales_collected - server_expenses,
    server_receivable, server_order_count, coalesce(cash_difference,
      nullif(p_report->>'cashDifferenceMillimes', '')::bigint),
    assigned_z_number, period_from, period_to, actor.id, report_data
  ) returning * into result;
  return result;
end
$$;

create or replace function public.reject_report_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Stored reports are immutable.' using errcode = '55000';
end
$$;

drop trigger if exists reports_immutable on public.reports;
create trigger reports_immutable
before update or delete on public.reports
for each row execute function public.reject_report_mutation();

drop policy if exists reports_owner_update on public.reports;
drop policy if exists reports_owner_delete on public.reports;
drop policy if exists reports_authenticated_update on public.reports;
drop policy if exists reports_authenticated_delete on public.reports;
do $$
declare
  report_policy record;
begin
  for report_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'reports'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy %I on public.reports', report_policy.policyname);
  end loop;
  alter table public.reports enable row level security;
  if not (
    select relrowsecurity
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public' and relation.relname = 'reports'
  ) then
    raise exception 'Reports must have row-level security enabled.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'reports'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'Reports must not have update or delete policies.';
  end if;
end
$$;
revoke insert, update, delete, truncate on public.reports from public, anon, authenticated;
revoke update, delete, truncate on public.reports from service_role;
grant select on public.reports to authenticated;

revoke all on function public.void_order_with_pin(uuid, text, text) from public, anon;
revoke all on function public.get_shift_expected_cash(uuid) from public, anon;
revoke all on function public.reverse_tab_payment(uuid, text, text) from public, anon;
revoke all on function public.get_current_business_date(uuid) from public, anon;
revoke all on function public.create_order(uuid, jsonb, text, uuid, text, text, text) from public, anon;
revoke all on function public.record_cash_movement(uuid, text, bigint, text, text) from public, anon;
revoke all on function public.settle_customer_tab(uuid, bigint, uuid, text, text) from public, anon;
revoke all on function public.get_customer_balance(uuid) from public, anon;
revoke all on function public.get_next_order_number() from public, anon;
revoke all on function public.record_report(jsonb, text) from public, anon;
grant execute on function public.void_order_with_pin(uuid, text, text) to authenticated;
grant execute on function public.get_shift_expected_cash(uuid) to authenticated;
grant execute on function public.reverse_tab_payment(uuid, text, text) to authenticated;
grant execute on function public.get_current_business_date(uuid) to authenticated;
grant execute on function public.create_order(uuid, jsonb, text, uuid, text, text, text) to authenticated;
grant execute on function public.record_cash_movement(uuid, text, bigint, text, text) to authenticated;
grant execute on function public.settle_customer_tab(uuid, bigint, uuid, text, text) to authenticated;
grant execute on function public.get_customer_balance(uuid) to authenticated;
grant execute on function public.get_next_order_number() to authenticated;
grant execute on function public.record_report(jsonb, text) to authenticated;

update public.app_schema_version
set version = 20261120190000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
