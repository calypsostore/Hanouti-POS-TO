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
  quantity integer;
  unit_price bigint;
  line_total bigint;
  total bigint := 0;
  business_day date;
  next_number integer;
  order_id uuid := gen_random_uuid();
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
  if not found or not target_store.is_active then raise exception 'This store is inactive.'; end if;
  business_day := (now() at time zone target_store.timezone)::date;
  if target_store.day_closed_on = business_day then
    raise exception 'The business day is closed. Open a new shift to continue.';
  end if;
  select * into target_shift
  from public.shifts
  where id = p_shift_id and store_id = actor.store_id and staff_id = actor.id and status = 'open'
  for update;
  if not found then raise exception 'Open a shift before taking orders.'; end if;
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
    if p_customer_id is null then raise exception 'Select a customer before charging this order to a tab.'; end if;
    select * into target_customer
    from public.customers
    where id = p_customer_id and store_id = actor.store_id and is_active
    for update;
    if not found then raise exception 'Select an active customer from this store.'; end if;
  elsif p_customer_id is not null then
    raise exception 'A customer can only be attached to a tab order.';
  end if;

  for item_line in select value from jsonb_array_elements(p_items) as input(value) loop
    if item_line->>'itemId' is null
      or jsonb_typeof(item_line->'quantity') <> 'number'
      or (item_line->>'quantity') !~ '^[1-9][0-9]*$' then
      raise exception 'Order contains an invalid quantity.';
    end if;
    quantity := (item_line->>'quantity')::integer;
    if quantity < 1 then raise exception 'Order contains an invalid quantity.'; end if;
    if jsonb_typeof(coalesce(item_line->'modifiers', '[]'::jsonb)) <> 'array' then
      raise exception 'Order contains invalid modifiers.';
    end if;
    selected_modifiers := array(
      select jsonb_array_elements_text(coalesce(item_line->'modifiers', '[]'::jsonb))
    );
    if cardinality(selected_modifiers) <> cardinality(array(select distinct unnest(selected_modifiers))) then
      raise exception 'Order contains a duplicate item modifier.';
    end if;

    select ci.*, c.name as category_name
    into catalog_item
    from public.catalog_items ci
    join public.categories c on c.id = ci.category_id and c.store_id = ci.store_id
    where ci.id = (item_line->>'itemId')::uuid
      and ci.store_id = actor.store_id
      and ci.is_active
      and c.is_active
    for update of ci;
    if not found then raise exception 'Order contains an item that is not in this store catalog.'; end if;
    if catalog_item.out_of_stock or catalog_item.stock_count = 0 then
      raise exception '% is out of stock.', catalog_item.name;
    end if;
    if catalog_item.stock_count is not null and quantity > catalog_item.stock_count then
      raise exception '% has only % remaining.', catalog_item.name, catalog_item.stock_count;
    end if;
    if catalog_item.modifiers_required and cardinality(selected_modifiers) = 0 then
      raise exception 'Choose a modifier for %.', catalog_item.name;
    end if;
    if catalog_item.modifier_selection_mode = 'single' and cardinality(selected_modifiers) > 1 then
      raise exception 'Choose only one modifier for %.', catalog_item.name;
    end if;
    select coalesce(sum(cm.price_millimes), 0), count(*)::integer
    into modifier_total, matched_modifier_count
    from public.catalog_modifiers cm
    where cm.store_id = actor.store_id
      and cm.item_id = catalog_item.id
      and cm.name = any(selected_modifiers);
    if matched_modifier_count <> cardinality(selected_modifiers) then
      raise exception 'Order contains an invalid modifier for %.', catalog_item.name;
    end if;
    unit_price := catalog_item.price_millimes + modifier_total;
    line_total := unit_price * quantity;
    total := total + line_total;
    if total > 9000000000000000 then raise exception 'Order total is too large.'; end if;
    prepared_lines := prepared_lines || jsonb_build_array(jsonb_build_object(
      'item_id', catalog_item.id,
      'category_id', catalog_item.category_id,
      'category_name', catalog_item.category_name,
      'name', catalog_item.name,
      'quantity', quantity,
      'unit_price_millimes', unit_price,
      'line_total_millimes', line_total,
      'modifiers', selected_modifiers
    ));
    if catalog_item.stock_count is not null then
      update public.catalog_items
      set stock_count = stock_count - quantity,
          out_of_stock = (stock_count - quantity) = 0,
          out_of_stock_by = case when stock_count - quantity = 0 then actor.id else out_of_stock_by end,
          out_of_stock_at = case when stock_count - quantity = 0 then now() else out_of_stock_at end
      where id = catalog_item.id;
    end if;
  end loop;

  if effective_payment = 'tab' and target_customer.credit_limit_millimes is not null then
    select
      coalesce((
        select sum(o.total_millimes)
        from public.orders o
        where o.customer_id = target_customer.id
          and o.payment_method = 'tab'
          and o.status <> 'voided'
      ), 0)
      + coalesce((
        select sum(case when t.kind = 'settled' then -t.amount_millimes else t.amount_millimes end)
        from public.tabs t
        where t.customer_id = target_customer.id
          and (t.kind <> 'issued' or t.order_id is null)
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

  insert into public.order_counters (store_id, business_date, next_number)
  values (actor.store_id, business_day, 2)
  on conflict (store_id, business_date)
  do update set next_number = public.order_counters.next_number + 1
  returning next_number - 1 into next_number;

  insert into public.orders (
    id, store_id, number, business_date, staff_id, shift_id, location, status,
    payment_method, customer_id, note, total_millimes
  ) values (
    order_id, actor.store_id, next_number, business_day, actor.id, target_shift.id,
    nullif(btrim(p_location), ''), 'done', effective_payment, p_customer_id,
    nullif(btrim(p_note), ''), total
  ) returning * into order_row;

  insert into public.order_lines (
    store_id, order_id, item_id, category_id, category_name, name,
    quantity, unit_price_millimes, line_total_millimes, modifiers
  )
  select actor.store_id, order_id,
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
      actor.store_id, target_customer.id, order_id, target_shift.id, actor.id, 'issued', total
    );
  end if;
  select coalesce(jsonb_agg(to_jsonb(ol) - 'store_id'), '[]'::jsonb)
  into line_rows from public.order_lines ol where ol.order_id = order_id;
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
  if actor.id is null or not found or target.store_id <> actor.store_id or target.status <> 'open'
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
  insert into public.cash_movements (store_id, shift_id, staff_id, kind, amount_millimes, reason, note)
  values (target.store_id, target.id, actor.id, p_kind, p_amount_millimes, p_reason, nullif(btrim(p_note), ''))
  returning * into result;
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
  select * into target_customer from public.customers
  where id = p_customer_id and store_id = actor.store_id and is_active
  for update;
  select * into target_shift from public.shifts
  where id = p_shift_id and store_id = actor.store_id and staff_id = actor.id and status = 'open';
  if actor.id is null or target_customer.id is null or target_shift.id is null
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
      select sum(o.total_millimes) from public.orders o
      where o.customer_id = target_customer.id and o.payment_method = 'tab' and o.status <> 'voided'
    ), 0)
    + coalesce((
      select sum(case when t.kind = 'settled' then -t.amount_millimes else t.amount_millimes end)
      from public.tabs t
      where t.customer_id = target_customer.id
        and (t.kind <> 'issued' or t.order_id is null)
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
  insert into public.tabs (
    store_id, customer_id, shift_id, staff_id, kind, amount_millimes,
    note, reverses_tab_id, payment_method
  ) values (
    payment.store_id, payment.customer_id, payment.shift_id, auth.uid(), 'reversal',
    payment.amount_millimes, btrim(p_reason), payment.id, payment.payment_method
  ) returning * into result;
  return result;
end
$$;

revoke all on function public.create_order(uuid, jsonb, text, uuid, text, text, text) from public, anon;
revoke all on function public.record_cash_movement(uuid, text, bigint, text, text) from public, anon;
revoke all on function public.settle_customer_tab(uuid, bigint, uuid, text, text) from public, anon;
revoke all on function public.reverse_tab_payment(uuid, text, text) from public, anon;
grant execute on function public.create_order(uuid, jsonb, text, uuid, text, text, text) to authenticated;
grant execute on function public.record_cash_movement(uuid, text, bigint, text, text) to authenticated;
grant execute on function public.settle_customer_tab(uuid, bigint, uuid, text, text) to authenticated;
grant execute on function public.reverse_tab_payment(uuid, text, text) to authenticated;
