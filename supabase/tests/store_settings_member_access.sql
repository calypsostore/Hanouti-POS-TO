-- Run against a migrated Supabase database with the postgres role.
-- Verifies super-admin store settings are read-only and staff only see their own store.
create extension if not exists pgtap;
select plan(2);

begin;

create temporary table store_settings_context (
  store_id uuid primary key,
  other_store_id uuid not null,
  staff_id uuid not null,
  owner_id uuid not null,
  super_admin_id uuid not null,
  item_id uuid not null,
  shift_id uuid not null,
  session_id text not null,
  super_admin_session_id text not null
) on commit drop;

insert into store_settings_context
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid()::text, gen_random_uuid()::text
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select staff_id, 'authenticated', 'authenticated',
       'settings-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Settings smoke staff"}'::jsonb, now(), now()
from store_settings_context;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select owner_id, 'authenticated', 'authenticated',
       'settings-owner-' || replace(store_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Settings smoke owner"}'::jsonb, now(), now()
from store_settings_context;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select super_admin_id, 'authenticated', 'authenticated',
       'settings-admin-' || replace(super_admin_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Settings smoke super admin"}'::jsonb, now(), now()
from store_settings_context;

insert into public.stores (id, store_id, owner_id, code, name)
select store_id, store_id, owner_id,
       'ss' || left(replace(store_id::text, '-', ''), 8),
       'Settings smoke store'
from store_settings_context
union all
select other_store_id, other_store_id, gen_random_uuid(),
       'ss' || left(replace(other_store_id::text, '-', ''), 8),
       'Other settings smoke store'
from store_settings_context;

insert into public.profiles (id, store_id, role, name, email, username, is_active)
select super_admin_id, null, 'super_admin', 'Settings smoke super admin',
       'settings-admin-' || replace(super_admin_id::text, '-', '') || '@example.invalid',
       'settings-admin-' || left(replace(super_admin_id::text, '-', ''), 12), true
from store_settings_context;

insert into public.profiles (id, store_id, role, name, email, username, is_active)
select owner_id, store_id, 'owner', 'Settings smoke owner',
       'settings-owner-' || replace(store_id::text, '-', '') || '@example.invalid',
       'settings-owner-' || left(replace(store_id::text, '-', ''), 12), true
from store_settings_context;

insert into public.auth_sessions (session_id, user_id, session_version, expires_at)
select context.super_admin_session_id, context.super_admin_id, profile.session_version,
       now() + interval '1 hour'
from store_settings_context context
join public.profiles profile on profile.id = context.super_admin_id;

insert into public.profiles (id, store_id, role, name, email, username, is_active)
select staff_id, store_id, 'staff', 'Settings smoke staff',
       'settings-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       'settings-staff-' || left(replace(staff_id::text, '-', ''), 12), true
from store_settings_context;

insert into public.auth_sessions (session_id, user_id, session_version, expires_at)
select context.session_id, context.staff_id, profile.session_version,
       now() + interval '1 hour'
from store_settings_context context
join public.profiles profile on profile.id = context.staff_id;

insert into public.shifts (id, store_id, staff_id, status, starting_cash_millimes, opened_at)
select shift_id, store_id, staff_id, 'closed', 0, now() - interval '1 hour'
from store_settings_context;

insert into public.store_settings (store_id, settings)
select store_id,
       jsonb_build_object(
         'quickPickMode', 'manual',
         'quickPickItemIds', jsonb_build_array(item_id::text)
       )
from store_settings_context;
insert into public.store_settings (store_id, settings)
select other_store_id, '{"quickPickMode":"auto","quickPickItemIds":[]}'::jsonb
from store_settings_context;

select set_config('request.jwt.claim.sub', super_admin_id::text, true)
from store_settings_context;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', super_admin_id,
    'role', 'authenticated',
    'store_id', store_id,
    'session_id', super_admin_session_id
  )::text,
  true
)
from store_settings_context;

set local role authenticated;
do $$
declare
  visible_count integer;
  updated_count integer;
  visible_shift_count integer;
begin
  select count(*) into visible_count from public.store_settings;
  if visible_count <> 2 then
    raise exception 'Super admins cannot read store settings for all stores.';
  end if;

  select jsonb_array_length(public.list_shift_records(
    (current_setting('request.jwt.claims')::jsonb ->> 'store_id')::uuid
  )) into visible_shift_count;
  if visible_shift_count <> 1 then
    raise exception 'Super admins cannot read shifts through the store view.';
  end if;

  update public.store_settings
  set settings = settings;
  get diagnostics updated_count = row_count;
  if updated_count <> 0 then
    raise exception 'Super admins can modify store settings through the read-only access policy.';
  end if;
end
$$;
reset role;

select pass('super admins can read but cannot modify store settings');

select set_config('request.jwt.claim.sub', staff_id::text, true)
from store_settings_context;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', staff_id,
    'role', 'authenticated',
    'item_id', item_id,
    'session_id', session_id
  )::text,
  true
)
from store_settings_context;

set local role authenticated;
do $$
declare
  visible_count integer;
  selected_mode text;
  selected_ids jsonb;
begin
  select count(*), max(settings ->> 'quickPickMode')
  into visible_count, selected_mode
  from public.store_settings s
  where s.store_id = (select public.current_store_id());

  select settings -> 'quickPickItemIds'
  into selected_ids
  from public.store_settings s
  where s.store_id = (select public.current_store_id());

  if visible_count <> 1
    or selected_mode <> 'manual'
    or selected_ids <> jsonb_build_array(
      (current_setting('request.jwt.claims')::jsonb ->> 'item_id')
    ) then
    raise exception 'Staff cannot read the shared manual Quick Picks settings.';
  end if;

  select count(*) into visible_count from public.store_settings;
  if visible_count <> 1 then
    raise exception 'Staff can read settings outside their own store.';
  end if;
end
$$;
reset role;

select pass('store settings member-access assertions completed');
select * from finish();

rollback;
