create or replace function public.track_shift_activity()
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

  if tg_op = 'INSERT' then
    insert into public.activity_logs (
      store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
    ) values (
      new.store_id, actor.id, actor.name, actor.role, 'shift.opened',
      actor.name || ' opened a shift with ' || new.starting_cash_millimes || ' millimes starting cash.',
      'shift', new.id::text, jsonb_build_object('after', to_jsonb(new))
    );
    insert into public.notifications (
      store_id, target_role, type, title, body, entity_type, entity_id, shift_id
    ) values (
      new.store_id, 'owner', 'shift_opened', 'Shift opened',
      actor.name || ' opened a shift.', 'shift', new.id::text, new.id
    );
  elsif old.status is distinct from new.status and new.status = 'closed' then
    insert into public.activity_logs (
      store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
    ) values (
      new.store_id, actor.id, actor.name, actor.role,
      case when new.force_closed_by_owner then 'shift.force_closed' else 'shift.closed' end,
      case when new.force_closed_by_owner then 'Force-closed ' else 'Closed ' end
        || actor.name || '''s shift with a cash difference of ' || coalesce(new.difference_millimes, 0) || ' millimes.',
      'shift', new.id::text,
      jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
    );
    insert into public.notifications (
      store_id, target_role, type, title, body, entity_type, entity_id, shift_id
    ) values (
      new.store_id, 'owner', 'shift_closed', 'Shift closed',
      actor.name || ' closed their shift.', 'shift', new.id::text, new.id
    );
    if coalesce(new.difference_millimes, 0) <> 0 then
      insert into public.notifications (
        store_id, target_role, type, title, body, entity_type, entity_id, shift_id
      ) values (
        new.store_id, 'owner', 'cash_difference', 'Cash difference at close',
        actor.name || '''s shift closed with a cash difference of ' || new.difference_millimes || ' millimes.',
        'shift', new.id::text, new.id
      );
    end if;
  end if;
  return new;
end
$$;

create trigger shifts_track_activity
after insert or update of status on public.shifts
for each row execute function public.track_shift_activity();

create or replace function public.track_cash_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  threshold bigint;
begin
  select * into actor from public.profiles where id = new.staff_id;
  insert into public.activity_logs (
    store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
  ) values (
    new.store_id, actor.id, actor.name, actor.role,
    case when new.kind = 'in' then 'cash.in' else 'cash.out' end,
    'Recorded cash ' || new.kind || ' of ' || new.amount_millimes || ' millimes (' || new.reason || ').',
    'cash_movement', new.id::text, jsonb_build_object('after', to_jsonb(new))
  );
  if new.kind = 'out' then
    select cash_out_alert_threshold_millimes into threshold
    from public.stores where store_id = new.store_id;
    if new.amount_millimes >= coalesce(threshold, 50000) then
      insert into public.notifications (
        store_id, target_role, type, title, body, entity_type, entity_id, cash_movement_id
      ) values (
        new.store_id, 'owner', 'cash_out_alert', 'Large cash out',
        actor.name || ' recorded a cash out of ' || new.amount_millimes || ' millimes.',
        'cash_movement', new.id::text, new.id
      );
    end if;
  end if;
  return new;
end
$$;

create trigger cash_movements_track_activity
after insert on public.cash_movements
for each row execute function public.track_cash_movement();

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
  select * into target from public.shifts where id = p_shift_id;
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
  return target.starting_cash_millimes
    + coalesce((
      select sum(o.total_millimes)
      from public.orders o
      where o.shift_id = target.id and o.status = 'done' and o.payment_method = 'cash'
    ), 0)
    + coalesce((
      select sum(t.amount_millimes)
      from public.tabs t
      where t.shift_id = target.id and t.kind = 'settled' and t.payment_method = 'cash'
    ), 0)
    + coalesce((
      select sum(case when m.kind = 'in' then m.amount_millimes else -m.amount_millimes end)
      from public.cash_movements m
      where m.shift_id = target.id
    ), 0)
    + coalesce((
      select sum(a.amount_millimes)
      from public.shift_void_adjustments a
      where a.shift_id = target.id
    ), 0);
end
$$;

revoke all on function public.get_shift_expected_cash(uuid) from public, anon;
grant execute on function public.get_shift_expected_cash(uuid) to authenticated;

create policy notifications_recipient_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.get_notification_preference(p_type text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  store_enabled text;
  user_enabled boolean;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  if actor.id is null or actor.store_id is null then
    raise exception 'An active store account is required.' using errcode = '42501';
  end if;
  select s.settings -> 'notificationPreferences' ->> p_type into store_enabled
  from public.store_settings s
  where s.store_id = actor.store_id;
  select np.enabled into user_enabled
  from public.notification_preferences np
  where np.store_id = actor.store_id
    and np.user_id = actor.id
    and np.type = p_type;
  return coalesce(store_enabled <> 'false', true) and coalesce(user_enabled, true);
end
$$;

create or replace function public.create_notification(
  p_store_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_user_id uuid default null,
  p_target_role text default null,
  p_entity_type text default null,
  p_entity_id text default null,
  p_staff_id uuid default null,
  p_message text default null,
  p_customer_id uuid default null,
  p_catalog_item_id uuid default null,
  p_shift_id uuid default null,
  p_cash_movement_id uuid default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  recipient public.profiles%rowtype;
  created public.notifications%rowtype;
  store_enabled text;
  recipient_enabled boolean;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  if actor.id is null or actor.store_id is distinct from p_store_id then
    raise exception 'An active account for this store is required.' using errcode = '42501';
  end if;
  if actor.role <> 'owner' and p_user_id is distinct from actor.id then
    raise exception 'Staff can only create notifications for their own account.' using errcode = '42501';
  end if;
  if (p_user_id is null) = (p_target_role is null) then
    raise exception 'Choose exactly one notification recipient.';
  end if;
  if p_user_id is not null then
    select * into recipient from public.profiles
    where id = p_user_id and store_id = p_store_id and is_active;
    if not found then raise exception 'Notification recipient could not be found.'; end if;
  elsif p_target_role not in ('staff', 'owner') then
    raise exception 'Invalid notification role.';
  end if;
  select s.settings -> 'notificationPreferences' ->> p_type into store_enabled
  from public.store_settings s where s.store_id = p_store_id;
  if store_enabled = 'false' then
    return null;
  end if;
  if p_user_id is not null then
    select np.enabled into recipient_enabled
    from public.notification_preferences np
    where np.store_id = p_store_id and np.user_id = p_user_id and np.type = p_type;
  end if;
  if recipient_enabled is false then
    return null;
  end if;
  insert into public.notifications (
    store_id, user_id, target_role, type, title, body, entity_type, entity_id,
    staff_id, message, customer_id, catalog_item_id, shift_id, cash_movement_id, due_at
  ) values (
    p_store_id, p_user_id, p_target_role, p_type, p_title, p_body, p_entity_type, p_entity_id,
    p_staff_id, p_message, p_customer_id, p_catalog_item_id, p_shift_id, p_cash_movement_id, p_due_at
  )
  returning * into created;
  return to_jsonb(created);
end
$$;

revoke all on function public.get_notification_preference(text) from public, anon;
revoke all on function public.create_notification(uuid, text, text, text, uuid, text, text, text, uuid, text, uuid, uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.get_notification_preference(text) to authenticated;
grant execute on function public.create_notification(uuid, text, text, text, uuid, text, text, text, uuid, text, uuid, uuid, uuid, uuid, timestamptz) to authenticated;

create policy customers_staff_insert on public.customers for insert to authenticated
  with check (
    store_id = (select public.current_store_id())
    and public.has_store_permission('customers_create')
  );
create policy customers_staff_update on public.customers for update to authenticated
  using (
    store_id = (select public.current_store_id())
    and public.has_store_permission('customers_edit')
  )
  with check (
    store_id = (select public.current_store_id())
    and public.has_store_permission('customers_edit')
  );

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
  select
    coalesce((
      select sum(o.total_millimes)
      from public.orders o
      where o.customer_id = target.id
        and o.payment_method = 'tab'
        and o.status <> 'voided'
    ), 0)
    + coalesce((
      select sum(case when t.kind = 'settled' then -t.amount_millimes else t.amount_millimes end)
      from public.tabs t
      where t.customer_id = target.id
        and (t.kind <> 'issued' or t.order_id is null)
    ), 0)
  into result;
  return result;
end
$$;

create or replace function public.track_tab_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  customer_name text;
  action_name text;
  summary_text text;
begin
  select * into actor from public.profiles where id = new.staff_id;
  select name into customer_name from public.customers where id = new.customer_id;
  action_name := case
    when new.kind = 'settled' then 'tab.payment'
    when new.kind = 'reversal' then 'tab.payment_reversed'
    else 'tab.issued'
  end;
  summary_text := case
    when new.kind = 'settled' then 'Recorded a ' || new.amount_millimes || ' millime payment for "' || customer_name || '".'
    when new.kind = 'reversal' then 'Reversed a ' || new.amount_millimes || ' millime payment for "' || customer_name || '".'
    else 'Recorded a ' || new.amount_millimes || ' millime tab charge for "' || customer_name || '".'
  end;
  insert into public.activity_logs (
    store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
  ) values (
    new.store_id, actor.id, actor.name, actor.role, action_name, summary_text,
    'tab_payment', new.id::text,
    jsonb_build_object('after', jsonb_build_object(
      'customerId', new.customer_id, 'amountMillimes', new.amount_millimes, 'note', new.note
    ))
  );
  return new;
end
$$;

create trigger tabs_track_activity
after insert on public.tabs
for each row execute function public.track_tab_activity();

revoke all on function public.get_customer_balance(uuid) from public, anon;
grant execute on function public.get_customer_balance(uuid) to authenticated;
