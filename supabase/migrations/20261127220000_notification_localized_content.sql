alter table public.notifications
  add column content_values jsonb;

alter table public.device_tokens
  add column language_code text not null default 'en'
  check (language_code in ('en', 'fr', 'ar'));

create or replace function public.populate_notification_content_values()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  staff_name text;
  item_name text;
  amount_dinars numeric;
  reason text;
  note text;
  order_number integer;
  stock_count integer;
  low_stock_threshold integer;
begin
  if new.content_values is not null and new.content_values <> '{}'::jsonb then
    return new;
  end if;

  case new.type
    when 'shift_opened' then
      select p.name into staff_name
      from public.shifts s
      join public.profiles p on p.id = s.staff_id
      where s.id = new.shift_id;
      if staff_name is not null then
        new.content_values := jsonb_build_object('name', staff_name);
      end if;
    when 'shift_closed' then
      select p.name into staff_name
      from public.shifts s
      join public.profiles p on p.id = s.staff_id
      where s.id = new.shift_id;
      if staff_name is not null then
        new.content_values := jsonb_build_object('name', staff_name);
      end if;
    when 'cash_difference' then
      select p.name, s.difference_millimes / 1000.0
      into staff_name, amount_dinars
      from public.shifts s
      join public.profiles p on p.id = s.staff_id
      where s.id = new.shift_id;
      if staff_name is not null and amount_dinars is not null then
        new.content_values := jsonb_build_object('name', staff_name, 'amount', amount_dinars);
      end if;
    when 'cash_out_alert' then
      select p.name, m.amount_millimes / 1000.0, m.reason, m.note
      into staff_name, amount_dinars, reason, note
      from public.cash_movements m
      join public.profiles p on p.id = m.staff_id
      where m.id = new.cash_movement_id;
      if staff_name is not null and amount_dinars is not null then
        new.content_values := jsonb_build_object(
          'name', staff_name,
          'amount', amount_dinars,
          'reason', coalesce(reason, ''),
          'note', coalesce(note, '')
        );
      end if;
    when 'stock_depleted' then
      select name into item_name
      from public.catalog_items
      where id = new.catalog_item_id;
      if item_name is not null then
        new.content_values := jsonb_build_object('name', item_name);
      end if;
    when 'item_86' then
      select name into item_name
      from public.catalog_items
      where id = new.catalog_item_id;
      if item_name is not null then
        new.content_values := jsonb_build_object('name', item_name);
      end if;
    when 'low_stock' then
      select item.name, item.stock_count, item.low_stock_threshold
      into item_name, stock_count, low_stock_threshold
      from public.catalog_items as item
      where item.id = new.catalog_item_id;
      if item_name is not null and stock_count is not null and low_stock_threshold is not null then
        new.content_values := jsonb_build_object(
          'name', item_name,
          'count', stock_count,
          'threshold', low_stock_threshold
        );
      end if;
    when 'void_requested' then
      select p.name, o.number
      into staff_name, order_number
      from public.orders o
      join public.profiles p on p.id = o.staff_id
      where o.id::text = new.entity_id;
      if staff_name is not null and order_number is not null then
        new.content_values := jsonb_build_object('name', staff_name, 'number', order_number);
      end if;
    when 'void_approved', 'void_rejected' then
      select number into order_number
      from public.orders
      where id::text = new.entity_id;
      if order_number is not null then
        new.content_values := jsonb_build_object('number', order_number);
      end if;
    else
      null;
  end case;
  return new;
end
$$;

create trigger notifications_populate_content_values
before insert on public.notifications
for each row execute function public.populate_notification_content_values();

update public.notifications
set content_values = jsonb_build_object(
  'version', (regexp_match(body, '([0-9]+[.][0-9]+[.][0-9]+)'))[1],
  'build', entity_id
)
where type = 'app_update'
  and entity_id is not null
  and body ~ '[0-9]+[.][0-9]+[.][0-9]+';

create or replace function public.create_localized_notification(
  p_store_id uuid,
  p_user_id uuid,
  p_target_role text,
  p_type text,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id text,
  p_staff_id uuid,
  p_message text,
  p_customer_id uuid,
  p_catalog_item_id uuid,
  p_shift_id uuid,
  p_cash_movement_id uuid,
  p_due_at timestamptz,
  p_content_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created jsonb;
  created_record public.notifications%rowtype;
begin
  created := public.create_notification(
    p_store_id,
    p_user_id,
    p_target_role,
    p_type,
    p_title,
    p_body,
    p_entity_type,
    p_entity_id,
    p_staff_id,
    p_message,
    p_customer_id,
    p_catalog_item_id,
    p_shift_id,
    p_cash_movement_id,
    p_due_at
  );
  if created is null then
    return null;
  end if;

  update public.notifications
  set content_values = coalesce(p_content_values, '{}'::jsonb)
  where id = (created ->> 'id')::uuid;

  select * into created_record
  from public.notifications
  where id = (created ->> 'id')::uuid;
  return to_jsonb(created_record);
end
$$;

revoke all on function public.create_localized_notification(uuid, uuid, text, text, text, text, text, text, uuid, text, uuid, uuid, uuid, uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.create_localized_notification(uuid, uuid, text, text, text, text, text, text, uuid, text, uuid, uuid, uuid, uuid, timestamptz, jsonb) to authenticated;

update public.app_schema_version
set version = 20261127220000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
