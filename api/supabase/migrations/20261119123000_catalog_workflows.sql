create or replace function public.adjust_catalog_stock(
  p_item_id uuid,
  p_stock_count integer,
  p_out_of_stock boolean,
  p_reason text
)
returns public.catalog_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  target public.catalog_items%rowtype;
  result public.catalog_items%rowtype;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  select * into target from public.catalog_items where id = p_item_id for update;
  if actor.id is null
    or target.id is null
    or target.store_id <> actor.store_id
    or not (actor.role = 'owner' or public.has_store_permission('edit_stock_counts')) then
    raise exception 'Not authorized to adjust stock.' using errcode = '42501';
  end if;
  if p_reason not in ('restock', 'correction', 'waste', 'stockTracking')
    or (p_stock_count is not null and p_stock_count < 0)
    or (p_stock_count = 0 and not p_out_of_stock) then
    raise exception 'Stock adjustment details are invalid.';
  end if;
  update public.catalog_items
  set stock_count = p_stock_count,
      out_of_stock = coalesce(p_out_of_stock, false),
      out_of_stock_by = case when coalesce(p_out_of_stock, false) then actor.id else null end,
      out_of_stock_at = case when coalesce(p_out_of_stock, false) then now() else null end
  where id = target.id
  returning * into result;
  if target.stock_count is distinct from result.stock_count then
    insert into public.item_history (
      store_id, item_id, field, old_value, new_value, changed_by, reason
    ) values (
      target.store_id, target.id, 'stockTracking', to_jsonb(target.stock_count),
      to_jsonb(result.stock_count), actor.id,
      case when p_reason = 'stockTracking' then null else p_reason end
    );
  end if;
  return result;
end
$$;

create or replace function public.track_catalog_item_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null then return new; end if;
  if old.name is distinct from new.name then
    insert into public.item_history (store_id, item_id, field, old_value, new_value, changed_by)
    values (new.store_id, new.id, 'name', to_jsonb(old.name), to_jsonb(new.name), actor.id);
  end if;
  if old.price_millimes is distinct from new.price_millimes then
    insert into public.item_history (store_id, item_id, field, old_value, new_value, changed_by)
    values (new.store_id, new.id, 'price', to_jsonb(old.price_millimes), to_jsonb(new.price_millimes), actor.id);
  end if;
  if old.category_id is distinct from new.category_id then
    insert into public.item_history (store_id, item_id, field, old_value, new_value, changed_by)
    values (new.store_id, new.id, 'category', to_jsonb(old.category_id), to_jsonb(new.category_id), actor.id);
  end if;
  if old.out_of_stock is distinct from new.out_of_stock then
    insert into public.item_history (store_id, item_id, field, old_value, new_value, changed_by)
    values (new.store_id, new.id, 'outOfStock', to_jsonb(old.out_of_stock), to_jsonb(new.out_of_stock), actor.id);
  end if;
  if new.out_of_stock and not old.out_of_stock then
    insert into public.notifications (
      store_id, user_id, type, title, body, entity_type, entity_id, catalog_item_id
    )
    select s.store_id, s.owner_id, 'item_86', 'Item marked 86',
      new.name || ' was marked out of stock.', 'catalog_item', new.id::text, new.id
    from public.stores s
    where s.store_id = new.store_id and s.owner_id is not null;
  end if;
  if old.stock_count is not null and new.stock_count = 0 and old.stock_count > 0 then
    insert into public.notifications (
      store_id, user_id, type, title, body, entity_type, entity_id, catalog_item_id
    )
    select s.store_id, s.owner_id, 'stock_depleted', 'Stock depleted',
      new.name || ' has reached 0 in tracked stock.', 'catalog_item', new.id::text, new.id
    from public.stores s
    where s.store_id = new.store_id and s.owner_id is not null;
  end if;
  if old.stock_count is not null
    and new.stock_count is not null
    and new.stock_count > 0
    and old.stock_count > new.low_stock_threshold
    and new.stock_count <= new.low_stock_threshold then
    insert into public.notifications (
      store_id, user_id, type, title, body, entity_type, entity_id, catalog_item_id
    )
    select s.store_id, s.owner_id, 'low_stock', 'Low stock',
      new.name || ' has ' || new.stock_count || ' units remaining.',
      'catalog_item', new.id::text, new.id
    from public.stores s
    where s.store_id = new.store_id and s.owner_id is not null;
  end if;
  insert into public.activity_logs (
    store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
  ) values (
    new.store_id, actor.id, actor.name, actor.role,
    case
      when old.out_of_stock is distinct from new.out_of_stock and new.out_of_stock then 'item.86'
      when old.out_of_stock is distinct from new.out_of_stock then 'item.available'
      when old.price_millimes is distinct from new.price_millimes then 'price.changed'
      when old.stock_count is distinct from new.stock_count then 'stock.updated'
      else 'catalog.item_updated'
    end,
    'Updated catalog item "' || new.name || '".',
    'catalog_item', new.id::text,
    jsonb_build_object('before', jsonb_build_object(
      'name', old.name, 'categoryId', old.category_id, 'priceMillimes', old.price_millimes,
      'stockCount', old.stock_count, 'outOfStock', old.out_of_stock
    ), 'after', jsonb_build_object(
      'name', new.name, 'categoryId', new.category_id, 'priceMillimes', new.price_millimes,
      'stockCount', new.stock_count, 'outOfStock', new.out_of_stock
    ))
  );
  return new;
end
$$;

create trigger catalog_items_track_changes
after update on public.catalog_items
for each row execute function public.track_catalog_item_changes();

revoke all on function public.adjust_catalog_stock(uuid, integer, boolean, text) from public, anon;
grant execute on function public.adjust_catalog_stock(uuid, integer, boolean, text) to authenticated;
