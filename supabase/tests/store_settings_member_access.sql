-- Run against a migrated Supabase database with the postgres role.
-- Verifies a staff session sees the store's manual Quick Picks and no other stores.
begin;

create temporary table store_settings_context (
  store_id uuid primary key,
  other_store_id uuid not null,
  staff_id uuid not null,
  item_id uuid not null
) on commit drop;

insert into store_settings_context
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select staff_id, 'authenticated', 'authenticated',
       'settings-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Settings smoke staff"}'::jsonb, now(), now()
from store_settings_context;

insert into public.stores (id, store_id, owner_id, code, name)
select store_id, store_id, gen_random_uuid(),
       'ss' || left(replace(store_id::text, '-', ''), 8),
       'Settings smoke store'
from store_settings_context
union all
select other_store_id, other_store_id, gen_random_uuid(),
       'ss' || left(replace(other_store_id::text, '-', ''), 8),
       'Other settings smoke store'
from store_settings_context;

insert into public.profiles (id, store_id, role, name, email, username, is_active)
select staff_id, store_id, 'staff', 'Settings smoke staff',
       'settings-staff-' || replace(staff_id::text, '-', '') || '@example.invalid',
       'settings-staff-' || left(replace(staff_id::text, '-', ''), 12), true
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

select set_config('request.jwt.claim.sub', staff_id::text, true)
from store_settings_context;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', staff_id,
    'role', 'authenticated',
    'item_id', item_id
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

rollback;
