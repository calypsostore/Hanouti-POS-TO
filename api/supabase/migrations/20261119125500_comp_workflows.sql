create or replace function public.create_comp(
  p_shift_id uuid,
  p_item_id uuid,
  p_quantity integer,
  p_reason text,
  p_note text default null
)
returns public.comps
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target_shift public.shifts%rowtype;
  target_item public.catalog_items%rowtype;
  target_position public.positions%rowtype;
  used_quantity integer := 0;
  comp_value bigint;
  result public.comps%rowtype;
begin
  select * into actor from public.profiles where id = (select auth.uid()) and is_active;
  select * into target_shift from public.shifts
  where id = p_shift_id and store_id = actor.store_id and staff_id = actor.id and status = 'open'
  for update;
  select * into target_item from public.catalog_items
  where id = p_item_id and store_id = actor.store_id and is_active
  for update;
  if actor.id is null or target_shift.id is null or target_item.id is null
    or (actor.role <> 'owner' and (actor.role <> 'staff' or not public.has_store_permission('comp_items'))) then
    raise exception 'Not authorized to record a comp.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1
    or p_reason not in ('dropped', 'staff_drink', 'free_customer', 'remake', 'other')
    or length(coalesce(p_note, '')) > 500 then
    raise exception 'Comp details are invalid.';
  end if;
  if target_item.stock_count is not null and target_item.stock_count < p_quantity then
    raise exception 'Comp quantity exceeds available stock.';
  end if;

  if p_reason = 'staff_drink' then
    select * into target_position from public.positions
    where id = actor.position_id and store_id = actor.store_id;
    if actor.role <> 'staff' or target_position.id is null
      or target_position.max_staff_drink_quantity_per_shift < 1
      or not (
        target_item.id = any(target_position.self_service_item_ids)
        or target_item.category_id = any(target_position.self_service_category_ids)
      ) then
      raise exception 'This item is not allowed for staff drinks in your position.';
    end if;
    select coalesce(sum(quantity), 0) into used_quantity
    from public.comps
    where store_id = actor.store_id and staff_id = actor.id
      and shift_id = target_shift.id and reason = 'staff_drink';
    if used_quantity + p_quantity > target_position.max_staff_drink_quantity_per_shift then
      raise exception 'Staff drink limit reached.';
    end if;
  end if;

  comp_value := target_item.price_millimes * p_quantity;
  if comp_value > 9000000000000000 then
    raise exception 'Comp value is too large.';
  end if;
  insert into public.comps (
    store_id, staff_id, shift_id, item_id, name, quantity, value_millimes, reason, note
  ) values (
    actor.store_id, actor.id, target_shift.id, target_item.id, target_item.name,
    p_quantity, comp_value, p_reason, nullif(btrim(p_note), '')
  ) returning * into result;
  if target_item.stock_count is not null then
    update public.catalog_items
    set stock_count = stock_count - p_quantity,
        out_of_stock = (stock_count - p_quantity = 0)
    where id = target_item.id;
  end if;
  return result;
end
$$;

revoke all on function public.create_comp(uuid, uuid, integer, text, text) from public, anon;
grant execute on function public.create_comp(uuid, uuid, integer, text, text) to authenticated;
