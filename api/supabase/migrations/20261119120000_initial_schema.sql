create extension if not exists pgcrypto with schema extensions;

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique,
  owner_id uuid,
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  archived_at timestamptz,
  day_closed_on date,
  timezone text not null default 'Africa/Tunis',
  allow_customer_credit_balance boolean not null default false,
  allow_card_payments boolean not null default false,
  allow_other_payments boolean not null default false,
  staff_auto_lock_minutes integer not null default 5 check (staff_auto_lock_minutes between 1 and 60),
  cash_out_alert_threshold_millimes bigint not null default 50000 check (cash_out_alert_threshold_millimes >= 0),
  daily_sales_target_millimes bigint not null default 0 check (daily_sales_target_millimes >= 0),
  admin_pin_hash text,
  pin_must_change boolean not null default true,
  subscription_plan text not null default 'trial' check (subscription_plan in ('trial', 'monthly', 'yearly')),
  subscription_paid_until date,
  subscription_notes text not null default '',
  created_at timestamptz not null default now(),
  constraint stores_store_id_matches_id check (store_id = id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  store_id uuid references public.stores(store_id) on delete cascade,
  role text not null check (role in ('staff', 'owner', 'super_admin')),
  name text not null,
  email text,
  username text unique,
  phone text,
  notes text,
  position_id uuid,
  pin_hash text,
  must_change_password boolean not null default true,
  is_active boolean not null default true,
  session_version integer not null default 0,
  created_at timestamptz not null default now(),
  constraint profiles_role_store_check check (
    (role = 'super_admin' and store_id is null) or
    (role in ('owner', 'staff') and store_id is not null)
  )
);

alter table public.stores
  add constraint stores_owner_id_fkey foreign key (owner_id) references public.profiles(id) deferrable initially deferred;

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  name text not null,
  permission_ids text[] not null default '{}',
  self_service_item_ids uuid[] not null default '{}',
  self_service_category_ids uuid[] not null default '{}',
  max_staff_drink_quantity_per_shift integer not null default 0 check (max_staff_drink_quantity_per_shift >= 0),
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

alter table public.profiles
  add constraint profiles_position_id_fkey foreign key (position_id) references public.positions(id) on delete set null;

create table public.permission_overrides (
  store_id uuid not null references public.stores(store_id) on delete cascade,
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted text[] not null default '{}',
  revoked text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table public.store_settings (
  store_id uuid primary key references public.stores(store_id) on delete cascade,
  settings jsonb not null default '{"defaultSettlementTerms":"monthly","notificationPreferences":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  name text not null,
  icon text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  category_id uuid not null references public.categories(id),
  name text not null,
  icon text not null default '',
  price_millimes bigint not null check (price_millimes >= 0),
  stock_count integer check (stock_count is null or stock_count >= 0),
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  description text,
  sku text,
  modifier_group_name text,
  modifiers_required boolean not null default false,
  modifier_selection_mode text not null default 'multiple' check (modifier_selection_mode in ('single', 'multiple')),
  out_of_stock boolean not null default false,
  out_of_stock_by uuid references public.profiles(id) on delete set null,
  out_of_stock_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint catalog_items_stock_availability_check check (stock_count is distinct from 0 or out_of_stock)
);

create table public.catalog_modifiers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  name text not null,
  price_millimes bigint not null default 0 check (price_millimes >= 0),
  sort_order integer not null default 0,
  unique (item_id, name)
);

create table public.item_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  item_id uuid not null references public.catalog_items(id) on delete cascade,
  field text not null check (field in ('price', 'name', 'category', 'stockTracking', 'outOfStock')),
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text check (reason is null or reason in ('restock', 'correction', 'waste'))
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  name text not null,
  phone text,
  email text,
  notes text,
  credit_limit_millimes bigint check (credit_limit_millimes is null or credit_limit_millimes >= 0),
  settlement_terms text not null default 'monthly' check (settlement_terms in ('weekly', 'monthly', 'anytime')),
  is_active boolean not null default true,
  last_payment_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  starting_cash_millimes bigint not null check (starting_cash_millimes >= 0),
  counted_cash_millimes bigint check (counted_cash_millimes is null or counted_cash_millimes >= 0),
  expected_cash_millimes bigint,
  difference_millimes bigint,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  force_closed_by_owner boolean not null default false,
  closed_by_user_id uuid references public.profiles(id),
  difference_note text,
  unique (store_id, id)
);

create unique index shifts_one_open_per_staff
  on public.shifts (store_id, staff_id) where status = 'open';

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  number integer not null check (number > 0),
  business_date date not null default current_date,
  staff_id uuid not null references public.profiles(id),
  shift_id uuid not null references public.shifts(id),
  location text,
  status text not null default 'done' check (status in ('done', 'pending_void', 'voided')),
  payment_method text not null check (payment_method in ('cash', 'card', 'other', 'tab')),
  customer_id uuid references public.customers(id),
  note text,
  total_millimes bigint not null check (total_millimes >= 0),
  created_at timestamptz not null default now(),
  void_requested_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  voided_by_user_id uuid references public.profiles(id),
  void_reason text,
  unique (store_id, business_date, number),
  unique (store_id, id)
);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id uuid not null references public.catalog_items(id),
  category_id uuid references public.categories(id),
  category_name text,
  name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_millimes bigint not null check (unit_price_millimes >= 0),
  line_total_millimes bigint not null check (line_total_millimes >= 0),
  modifiers text[] not null default '{}'
);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  shift_id uuid not null references public.shifts(id),
  staff_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('in', 'out')),
  amount_millimes bigint not null check (amount_millimes > 0),
  reason text not null check (reason in ('supplier', 'change', 'expense', 'other')),
  note text,
  created_at timestamptz not null default now()
);

create table public.shift_void_adjustments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  shift_id uuid not null references public.shifts(id),
  order_id uuid not null references public.orders(id),
  order_number integer not null,
  amount_millimes bigint not null,
  created_at timestamptz not null default now(),
  unique (shift_id, order_id)
);

create table public.tabs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  order_id uuid references public.orders(id),
  shift_id uuid not null references public.shifts(id),
  staff_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('issued', 'settled', 'reversal')),
  amount_millimes bigint not null check (amount_millimes > 0),
  note text,
  reverses_tab_id uuid references public.tabs(id),
  payment_method text not null default 'cash' check (payment_method in ('cash', 'card', 'other')),
  created_at timestamptz not null default now()
);

create table public.comps (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  shift_id uuid not null references public.shifts(id),
  item_id uuid not null references public.catalog_items(id),
  name text not null,
  quantity integer not null check (quantity > 0),
  value_millimes bigint not null check (value_millimes >= 0),
  reason text not null check (reason in ('dropped', 'staff_drink', 'free_customer', 'remake', 'other')),
  note text,
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  name text not null,
  phone text,
  notes text
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  category text not null check (category in ('rent', 'electricity', 'water', 'supplier', 'salary', 'other')),
  supplier_id uuid references public.suppliers(id),
  amount_millimes bigint not null check (amount_millimes >= 0),
  paid_millimes bigint not null default 0 check (paid_millimes >= 0 and paid_millimes <= amount_millimes),
  date date not null,
  note text,
  created_by uuid not null references public.profiles(id)
);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  expense_id uuid references public.expenses(id),
  amount_millimes bigint not null check (amount_millimes > 0),
  date date not null
);

create table public.schedule_shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  date date not null,
  start_time time not null,
  end_time time not null,
  note text,
  published_at timestamptz,
  check (end_time > start_time)
);

create table public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  actor_role text not null,
  action text not null,
  summary text not null,
  entity_type text not null,
  entity_id text not null,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  target_role text check (target_role is null or target_role in ('staff', 'owner', 'super_admin')),
  type text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  entity_type text,
  entity_id text,
  read_at timestamptz,
  staff_id uuid references public.profiles(id),
  message text,
  customer_id uuid references public.customers(id),
  catalog_item_id uuid references public.catalog_items(id),
  shift_id uuid references public.shifts(id),
  cash_movement_id uuid references public.cash_movements(id),
  due_at timestamptz
);

create table public.notification_preferences (
  store_id uuid not null references public.stores(store_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  enabled boolean not null default true,
  primary key (user_id, type)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  type text not null check (type in ('X', 'Z')),
  business_date date not null,
  created_at timestamptz not null default now(),
  sales_millimes bigint not null default 0,
  sales_collected_millimes bigint,
  expenses_millimes bigint,
  net_profit_millimes bigint,
  receivable_millimes bigint,
  order_count integer not null default 0,
  cash_difference_millimes bigint not null default 0,
  z_number integer,
  period_from date,
  period_to date,
  generated_by uuid references public.profiles(id),
  data jsonb not null default '{}'
);

create table public.order_counters (
  store_id uuid not null references public.stores(store_id) on delete cascade,
  business_date date not null,
  next_number integer not null default 1 check (next_number > 0),
  primary key (store_id, business_date)
);

create table public.pin_attempts (
  store_id uuid not null references public.stores(store_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null check (purpose in ('credit_override', 'void')),
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  primary key (store_id, user_id, purpose)
);

create index profiles_store_role_idx on public.profiles (store_id, role);
create index catalog_items_store_category_idx on public.catalog_items (store_id, category_id);
create index orders_store_created_idx on public.orders (store_id, created_at desc);
create index orders_shift_status_idx on public.orders (shift_id, status);
create index order_lines_order_idx on public.order_lines (order_id);
create index shifts_store_opened_idx on public.shifts (store_id, opened_at desc);
create index tabs_customer_created_idx on public.tabs (customer_id, created_at desc);
create index activity_logs_store_created_idx on public.activity_logs (store_id, created_at desc);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

create or replace function public.current_store_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.store_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'super_admin', false)
$$;

create or replace function public.is_store_owner(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores s
    join public.profiles p on p.id = s.owner_id
    where s.store_id = p_store_id
      and s.owner_id = (select auth.uid())
      and p.is_active
      and p.role = 'owner'
      and p.store_id = p_store_id
  )
$$;

create or replace function public.restrict_tenant_admin_updates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and public.current_user_role() <> 'super_admin' then
    if tg_table_name = 'stores' then
      if new.id is distinct from old.id
        or new.store_id is distinct from old.store_id
        or new.owner_id is distinct from old.owner_id
        or new.code is distinct from old.code
        or new.is_active is distinct from old.is_active
        or new.archived_at is distinct from old.archived_at
        or new.subscription_plan is distinct from old.subscription_plan
        or new.subscription_paid_until is distinct from old.subscription_paid_until
        or new.subscription_notes is distinct from old.subscription_notes
        or new.day_closed_on is distinct from old.day_closed_on then
        raise exception 'Store ownership and platform-managed fields cannot be changed by a store owner.' using errcode = '42501';
      end if;
    elsif tg_table_name = 'profiles' then
      if new.id is distinct from old.id
        or new.store_id is distinct from old.store_id
        or new.role is distinct from old.role
        or new.username is distinct from old.username
        or new.position_id is distinct from old.position_id
        or new.pin_hash is distinct from old.pin_hash
        or new.session_version is distinct from old.session_version then
        raise exception 'Profile identity and permission fields cannot be changed directly.' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end
$$;

create trigger stores_restrict_admin_updates
before update on public.stores
for each row execute function public.restrict_tenant_admin_updates();

create trigger profiles_restrict_admin_updates
before update on public.profiles
for each row execute function public.restrict_tenant_admin_updates();

create or replace function public.has_store_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.positions pos on pos.id = p.position_id and pos.store_id = p.store_id
    left join public.permission_overrides ov on ov.user_id = p.id and ov.store_id = p.store_id
    where p.id = (select auth.uid())
      and p.is_active
      and p.store_id = (select public.current_store_id())
      and p.role in ('staff', 'owner')
      and (
        p.role = 'owner'
        or (
          p_permission = any(coalesce(ov.granted, '{}'::text[]))
          or (
            p_permission = any(coalesce(pos.permission_ids, '{}'::text[]))
            and not (p_permission = any(coalesce(ov.revoked, '{}'::text[])))
          )
        )
      )
  )
$$;

create or replace function public.can_read_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.store_id = (select public.current_store_id())
      and (
        public.is_store_owner(o.store_id)
        or (
          o.staff_id = (select auth.uid())
          and public.has_store_permission('view_order_history')
        )
        or public.has_store_permission('view_all_orders')
      )
  )
$$;

create or replace function public.verify_secret(p_secret text, p_encoded text)
returns boolean
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  parts text[];
  iterations integer;
  salt bytea;
  key_bytes bytea;
  u bytea;
  derived bytea;
  expected bytea;
  i integer;
  j integer;
begin
  parts := string_to_array(p_encoded, '$');
  if array_length(parts, 1) <> 4 or parts[1] <> 'pbkdf2-sha256' then
    return false;
  end if;
  iterations := parts[2]::integer;
  if iterations < 1 or iterations > 500000 then
    return false;
  end if;
  salt := decode(parts[3], 'hex');
  expected := decode(parts[4], 'hex');
  if octet_length(expected) <> 32 then
    return false;
  end if;
  key_bytes := convert_to(p_secret, 'UTF8');
  u := extensions.hmac(salt || decode('00000001', 'hex'), key_bytes, 'sha256');
  derived := u;
  for i in 2..iterations loop
    u := extensions.hmac(u, key_bytes, 'sha256');
    for j in 0..31 loop
      derived := set_byte(derived, j, get_byte(derived, j) # get_byte(u, j));
    end loop;
  end loop;
  return derived = expected;
exception
  when others then return false;
end
$$;

revoke all on function public.verify_secret(text, text) from public, anon, authenticated;

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
    or p_purpose not in ('credit_override', 'void')
    or not (public.is_store_owner(p_store_id) or public.has_store_permission('tab_override_limit')) then
    raise exception 'Not authorized to verify this PIN.' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_store_id::text || auth.uid()::text || p_purpose, 0)
  );
  select s.admin_pin_hash into stored_hash
  from public.stores s where s.store_id = p_store_id;
  if stored_hash is null then return false; end if;

  select * into attempt
  from public.pin_attempts
  where store_id = p_store_id and user_id = auth.uid() and purpose = p_purpose
  for update;
  if found and attempt.locked_until > now() then
    raise exception 'PIN verification is temporarily locked.' using errcode = 'P0001';
  end if;

  if public.verify_secret(p_pin, stored_hash) then
    delete from public.pin_attempts
    where store_id = p_store_id and user_id = auth.uid() and purpose = p_purpose;
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

revoke all on function public.verify_store_pin(uuid, text, text) from public, anon;
grant execute on function public.verify_store_pin(uuid, text, text) to authenticated;

create or replace function public.open_shift(p_starting_cash_millimes bigint)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  result public.shifts%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid() and is_active;
  if actor.id is null or actor.store_id is null
    or not (actor.role = 'owner' or public.has_store_permission('open_close_shift')) then
    raise exception 'Not authorized to open a shift.' using errcode = '42501';
  end if;
  if p_starting_cash_millimes is null or p_starting_cash_millimes < 0 then
    raise exception 'Starting cash must not be negative.';
  end if;
  if not exists (select 1 from public.stores where store_id = actor.store_id and is_active) then
    raise exception 'This store is inactive.';
  end if;
  update public.stores set day_closed_on = null
  where store_id = actor.store_id and day_closed_on is not null;
  insert into public.shifts (store_id, staff_id, starting_cash_millimes)
  values (actor.store_id, actor.id, p_starting_cash_millimes)
  returning * into result;
  return result;
end
$$;

create or replace function public.close_shift(p_shift_id uuid, p_counted_cash_millimes bigint, p_difference_note text default null)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
  expected bigint;
  difference bigint;
  note text;
  result public.shifts%rowtype;
begin
  select * into target from public.shifts where id = p_shift_id for update;
  if not found or target.status <> 'open' or target.store_id <> (select public.current_store_id())
    or not (target.staff_id = auth.uid() or public.is_store_owner(target.store_id)) then
    raise exception 'Not authorized to close this shift.' using errcode = '42501';
  end if;
  if target.staff_id <> auth.uid() and not public.is_store_owner(target.store_id) then
    raise exception 'Only the shift owner can close it.' using errcode = '42501';
  end if;
  if target.staff_id = auth.uid() and not public.has_store_permission('open_close_shift') then
    raise exception 'Shift permission is required.' using errcode = '42501';
  end if;
  if p_counted_cash_millimes is null or p_counted_cash_millimes < 0 then raise exception 'Counted cash must not be negative.'; end if;

  select target.starting_cash_millimes
    + coalesce((select sum(o.total_millimes) from public.orders o where o.shift_id = target.id and o.status = 'done' and o.payment_method = 'cash'), 0)
    + coalesce((select sum(t.amount_millimes) from public.tabs t where t.shift_id = target.id and t.kind = 'settled' and t.payment_method = 'cash'), 0)
    + coalesce((select sum(case when m.kind = 'in' then m.amount_millimes else -m.amount_millimes end) from public.cash_movements m where m.shift_id = target.id), 0)
    + coalesce((select sum(a.amount_millimes) from public.shift_void_adjustments a where a.shift_id = target.id), 0)
  into expected;
  difference := p_counted_cash_millimes - expected;
  note := nullif(btrim(p_difference_note), '');
  if length(note) > 200 or (difference <> 0 and note is null) then
    raise exception 'A short note is required for a cash difference.';
  end if;
  update public.shifts
  set status = 'closed',
      counted_cash_millimes = p_counted_cash_millimes,
      expected_cash_millimes = expected,
      difference_millimes = difference,
      difference_note = note,
      closed_at = now(),
      closed_by_user_id = auth.uid()
  where id = target.id
  returning * into result;
  return result;
end
$$;

create or replace function public.force_close_shift(p_shift_id uuid, p_counted_cash_millimes bigint, p_difference_note text default null)
returns public.shifts
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.shifts%rowtype;
  expected bigint;
  difference bigint;
  note text;
  result public.shifts%rowtype;
begin
  select * into target from public.shifts where id = p_shift_id for update;
  if not found or target.status <> 'open' or not public.is_store_owner(target.store_id) then
    raise exception 'Only this store owner can force-close the shift.' using errcode = '42501';
  end if;
  if p_counted_cash_millimes is null or p_counted_cash_millimes < 0 then raise exception 'Counted cash must not be negative.'; end if;
  select target.starting_cash_millimes
    + coalesce((select sum(o.total_millimes) from public.orders o where o.shift_id = target.id and o.status = 'done' and o.payment_method = 'cash'), 0)
    + coalesce((select sum(t.amount_millimes) from public.tabs t where t.shift_id = target.id and t.kind = 'settled' and t.payment_method = 'cash'), 0)
    + coalesce((select sum(case when m.kind = 'in' then m.amount_millimes else -m.amount_millimes end) from public.cash_movements m where m.shift_id = target.id), 0)
    + coalesce((select sum(a.amount_millimes) from public.shift_void_adjustments a where a.shift_id = target.id), 0)
  into expected;
  difference := p_counted_cash_millimes - expected;
  note := nullif(btrim(p_difference_note), '');
  if length(note) > 200 or (difference <> 0 and note is null) then
    raise exception 'A short note is required for a cash difference.';
  end if;
  update public.shifts
  set status = 'closed',
      counted_cash_millimes = p_counted_cash_millimes,
      expected_cash_millimes = expected,
      difference_millimes = difference,
      difference_note = note,
      closed_at = now(),
      closed_by_user_id = auth.uid(),
      force_closed_by_owner = true
  where id = target.id
  returning * into result;
  return result;
end
$$;

create or replace function public.request_order_void(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  result public.orders%rowtype;
begin
  select * into target from public.orders where id = p_order_id for update;
  if not found or target.store_id <> (select public.current_store_id())
    or not public.has_store_permission('request_void') then
    raise exception 'Not authorized to request this void.' using errcode = '42501';
  end if;
  if target.staff_id <> auth.uid() and not public.has_store_permission('view_all_orders') then
    raise exception 'You can only request a void for an order you can access.' using errcode = '42501';
  end if;
  if target.status <> 'done' or p_reason is null or length(btrim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception 'This order cannot be voided or the reason is invalid.';
  end if;
  update public.orders
  set status = 'pending_void', void_requested_at = now(), void_reason = btrim(p_reason)
  where id = target.id
  returning * into result;
  return result;
end
$$;

create or replace function public.resolve_order_void(p_order_id uuid, p_decision text, p_reason text, p_pin text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.orders%rowtype;
  result public.orders%rowtype;
begin
  select * into target from public.orders where id = p_order_id for update;
  if not found or target.store_id <> (select public.current_store_id())
    or not public.is_store_owner(target.store_id) then
    raise exception 'Only this store owner can resolve a void request.' using errcode = '42501';
  end if;
  if target.status not in ('done', 'pending_void') or p_decision not in ('approve', 'reject') then
    raise exception 'This order cannot be resolved.';
  end if;
  if not public.verify_store_pin(target.store_id, p_pin, 'void') then
    raise exception 'Incorrect Admin PIN.';
  end if;
  update public.orders
  set status = case when p_decision = 'approve' then 'voided' else 'done' end,
      voided_at = case when p_decision = 'approve' then now() else null end,
      voided_by = case when p_decision = 'approve' then coalesce(nullif(btrim(p_reason), ''), 'Owner void') else null end,
      voided_by_user_id = case when p_decision = 'approve' then auth.uid() else null end,
      void_reason = coalesce(nullif(btrim(p_reason), ''), void_reason)
  where id = target.id
  returning * into result;
  if p_decision = 'approve' and exists (select 1 from public.shifts where id = target.shift_id and status = 'closed') then
    insert into public.shift_void_adjustments (store_id, shift_id, order_id, order_number, amount_millimes)
    values (target.store_id, target.shift_id, target.id, target.number, -target.total_millimes)
    on conflict (shift_id, order_id) do nothing;
  end if;
  return result;
end
$$;

create or replace function public.set_catalog_availability(p_item_id uuid, p_out_of_stock boolean)
returns public.catalog_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.catalog_items%rowtype;
  result public.catalog_items%rowtype;
begin
  select * into target from public.catalog_items where id = p_item_id for update;
  if not found or target.store_id <> (select public.current_store_id())
    or not public.has_store_permission('86_items') then
    raise exception 'Not authorized to update item availability.' using errcode = '42501';
  end if;
  if not p_out_of_stock and target.stock_count = 0 then
    raise exception 'Add tracked stock before marking this item available.';
  end if;
  update public.catalog_items
  set out_of_stock = p_out_of_stock,
      out_of_stock_by = case when p_out_of_stock then auth.uid() else null end,
      out_of_stock_at = case when p_out_of_stock then now() else null end
  where id = target.id
  returning * into result;
  return result;
end
$$;

revoke all on function public.open_shift(bigint) from public, anon;
revoke all on function public.close_shift(uuid, bigint, text) from public, anon;
revoke all on function public.force_close_shift(uuid, bigint, text) from public, anon;
revoke all on function public.request_order_void(uuid, text) from public, anon;
revoke all on function public.resolve_order_void(uuid, text, text, text) from public, anon;
revoke all on function public.set_catalog_availability(uuid, boolean) from public, anon;
grant execute on function public.open_shift(bigint) to authenticated;
grant execute on function public.close_shift(uuid, bigint, text) to authenticated;
grant execute on function public.force_close_shift(uuid, bigint, text) to authenticated;
grant execute on function public.request_order_void(uuid, text) to authenticated;
grant execute on function public.resolve_order_void(uuid, text, text, text) to authenticated;
grant execute on function public.set_catalog_availability(uuid, boolean) to authenticated;

do $$
declare
  table_name text;
  owner_write_tables text[] := array[
    'positions', 'permission_overrides', 'store_settings', 'categories', 'catalog_items',
    'catalog_modifiers', 'item_history', 'customers', 'cash_movements',
    'shift_void_adjustments', 'tabs', 'comps', 'suppliers', 'expenses',
    'supplier_payments', 'schedule_shifts', 'schedule_templates', 'activity_logs',
    'notifications', 'notification_preferences', 'reports'
  ];
  tenant_tables text[] := array[
    'positions', 'permission_overrides', 'store_settings', 'categories', 'catalog_items',
    'catalog_modifiers', 'item_history', 'customers', 'shifts', 'orders', 'order_lines',
    'cash_movements', 'shift_void_adjustments', 'tabs', 'comps', 'suppliers', 'expenses',
    'supplier_payments', 'schedule_shifts', 'schedule_templates', 'activity_logs',
    'notifications', 'notification_preferences', 'reports', 'order_counters', 'pin_attempts'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_store_owner(store_id))',
      table_name || '_owner_select', table_name
    );
    if table_name = any(owner_write_tables) then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.is_store_owner(store_id))',
        table_name || '_owner_insert', table_name
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (public.is_store_owner(store_id)) with check (public.is_store_owner(store_id))',
        table_name || '_owner_update', table_name
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (public.is_store_owner(store_id))',
        table_name || '_owner_delete', table_name
      );
    end if;
  end loop;
end
$$;

alter table public.stores enable row level security;
create policy stores_read on public.stores for select to authenticated
  using (public.is_super_admin() or public.is_store_owner(store_id));
create policy stores_owner_update on public.stores for update to authenticated
  using (public.is_store_owner(store_id))
  with check (public.is_store_owner(store_id));
create policy stores_super_admin_insert on public.stores for insert to authenticated
  with check (public.is_super_admin());
create policy stores_super_admin_update on public.stores for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy stores_super_admin_delete on public.stores for delete to authenticated
  using (public.is_super_admin());

alter table public.profiles enable row level security;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_store_owner_read on public.profiles for select to authenticated
  using (store_id = (select public.current_store_id()) and public.is_store_owner(store_id));
create policy profiles_super_admin_owner_read on public.profiles for select to authenticated
  using (public.is_super_admin() and role = 'owner');
create policy profiles_super_admin_owner_update on public.profiles for update to authenticated
  using (public.is_super_admin() and role = 'owner')
  with check (public.is_super_admin() and role = 'owner');

create policy positions_staff_read on public.positions for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and (id = (select p.position_id from public.profiles p where p.id = (select auth.uid()))
      or public.has_store_permission('take_orders'))
  );
create policy categories_staff_read on public.categories for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('take_orders'));
create policy catalog_items_staff_read on public.catalog_items for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('take_orders'));
create policy catalog_modifiers_staff_read on public.catalog_modifiers for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('take_orders'));
create policy item_history_staff_read on public.item_history for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and (public.has_store_permission('edit_stock_counts') or public.has_store_permission('86_items'))
  );
create policy customers_staff_read on public.customers for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('customers_view'));
create policy shifts_staff_read on public.shifts for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and staff_id = (select auth.uid())
    and (public.has_store_permission('open_close_shift') or public.has_store_permission('view_own_hours'))
  );
create policy orders_staff_read on public.orders for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and (
      (staff_id = (select auth.uid()) and public.has_store_permission('view_order_history'))
      or public.has_store_permission('view_all_orders')
    )
  );
create policy order_lines_staff_read on public.order_lines for select to authenticated
  using (store_id = (select public.current_store_id()) and public.can_read_order(order_id));
create policy cash_movements_staff_read on public.cash_movements for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and staff_id = (select auth.uid())
    and public.has_store_permission('open_close_shift')
  );
create policy shift_void_adjustments_staff_read on public.shift_void_adjustments for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and exists (
      select 1 from public.shifts s
      where s.id = shift_id and s.staff_id = (select auth.uid())
    )
    and public.has_store_permission('view_own_hours')
  );
create policy tabs_staff_read on public.tabs for select to authenticated
  using (store_id = (select public.current_store_id()) and public.has_store_permission('customers_view'));
create policy comps_staff_read on public.comps for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and staff_id = (select auth.uid())
    and public.has_store_permission('comp_items')
  );
create policy schedule_staff_read on public.schedule_shifts for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and staff_id = (select auth.uid())
    and public.has_store_permission('view_schedule')
  );
create policy notifications_staff_read on public.notifications for select to authenticated
  using (
    store_id = (select public.current_store_id())
    and (user_id = (select auth.uid()) or (user_id is null and target_role = public.current_user_role()))
  );
create policy notification_preferences_self on public.notification_preferences for select to authenticated
  using (store_id = (select public.current_store_id()) and user_id = (select auth.uid()));
create policy notification_preferences_self_update on public.notification_preferences for all to authenticated
  using (store_id = (select public.current_store_id()) and user_id = (select auth.uid()))
  with check (store_id = (select public.current_store_id()) and user_id = (select auth.uid()));
create policy activity_logs_staff_read on public.activity_logs for select to authenticated
  using (store_id = (select public.current_store_id()) and actor_id = (select auth.uid()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.shifts;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.catalog_items;
