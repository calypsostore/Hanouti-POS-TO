-- Run against a migrated local Supabase database with the postgres role.
-- All fixture users, profiles, PINs, and audit entries are rolled back.
create extension if not exists pgtap;
select plan(1);

begin;

create temporary table staff_pin_context (
  store_id uuid primary key,
  owner_id uuid not null,
  first_staff_id uuid not null,
  second_staff_id uuid not null,
  owner_session_id text not null,
  first_staff_session_id text not null,
  second_staff_session_id text not null
) on commit drop;

insert into staff_pin_context
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select owner_id, 'authenticated', 'authenticated',
       'staff-pin-owner-' || replace(store_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Staff PIN owner"}'::jsonb, now(), now()
from staff_pin_context
union all
select first_staff_id, 'authenticated', 'authenticated',
       'staff-pin-first-' || replace(store_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"First PIN staff"}'::jsonb, now(), now()
from staff_pin_context
union all
select second_staff_id, 'authenticated', 'authenticated',
       'staff-pin-second-' || replace(store_id::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Second PIN staff"}'::jsonb, now(), now()
from staff_pin_context;

insert into public.stores (id, store_id, owner_id, code, name, admin_pin_hash, pin_must_change)
select store_id, store_id, owner_id,
       'pin' || left(replace(store_id::text, '-', ''), 8),
       'Staff PIN test store',
       extensions.crypt('2468', extensions.gen_salt('bf', 4)),
       false
from staff_pin_context;

insert into public.profiles (
  id, store_id, role, name, email, username, pin_hash,
  must_change_password, is_active, session_version, must_set_pin
)
select owner_id, store_id, 'owner', 'Staff PIN owner',
       'staff-pin-owner-' || replace(store_id::text, '-', '') || '@example.invalid',
       'staff-pin-owner-' || left(replace(store_id::text, '-', ''), 12),
       extensions.crypt('1357', extensions.gen_salt('bf', 4)),
       false, true, 0, false
from staff_pin_context
union all
select first_staff_id, store_id, 'staff', 'First PIN staff',
       'staff-pin-first-' || replace(store_id::text, '-', '') || '@example.invalid',
       'staff-pin-first-' || left(replace(store_id::text, '-', ''), 12),
       null, true, true, 0, true
from staff_pin_context
union all
select second_staff_id, store_id, 'staff', 'Second PIN staff',
       'staff-pin-second-' || replace(store_id::text, '-', '') || '@example.invalid',
       'staff-pin-second-' || left(replace(store_id::text, '-', ''), 12),
       null, true, true, 0, true
from staff_pin_context;

insert into public.auth_sessions (session_id, user_id, session_version, expires_at)
select owner_session_id, owner_id, 0, now() + interval '1 hour' from staff_pin_context
union all
select first_staff_session_id, first_staff_id, 0, now() + interval '1 hour' from staff_pin_context
union all
select second_staff_session_id, second_staff_id, 0, now() + interval '1 hour' from staff_pin_context;

do $$
declare
  context staff_pin_context%rowtype;
  first_pin text;
  second_pin text;
  replacement_pin text;
  result boolean;
  loop_index integer;
  recorded_attempts integer;
  attempt_lock_until timestamptz;
  owner_pin_hash text;
  void_pin_hash text;
begin
  select * into context from staff_pin_context;
  select pin_hash into owner_pin_hash from public.profiles where id = context.owner_id;
  select admin_pin_hash into void_pin_hash from public.stores where store_id = context.store_id;

  perform pg_catalog.set_config('request.jwt.claim.sub', context.owner_id::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', context.owner_id,
      'role', 'authenticated',
      'session_id', context.owner_session_id
    )::text,
    true
  );

  update public.auth_sessions
  set expires_at = now() - interval '1 minute'
  where session_id = context.owner_session_id;

  begin
    perform public.verify_personal_pin('1357');
    raise exception 'Expired session unexpectedly verified a PIN.' using errcode = 'P0002';
  exception when sqlstate '28000' then
    null;
  end;
  begin
    perform public.has_personal_pin(context.owner_id);
    raise exception 'Expired session unexpectedly queried PIN status.' using errcode = 'P0002';
  exception when sqlstate '28000' then
    null;
  end;
  begin
    perform public.change_personal_pin('1357', '8642');
    raise exception 'Expired session unexpectedly changed the Owner PIN.' using errcode = 'P0002';
  exception when sqlstate '28000' then
    null;
  end;
  begin
    perform public.set_personal_pin('8642');
    raise exception 'Expired session unexpectedly called PIN setup.' using errcode = 'P0002';
  exception when sqlstate '28000' then
    null;
  end;
  begin
    perform public.generate_staff_pin_by_owner(context.first_staff_id);
    raise exception 'Expired session unexpectedly managed a Staff PIN.' using errcode = 'P0002';
  exception when sqlstate '28000' then
    null;
  end;

  update public.auth_sessions
  set expires_at = now() + interval '1 hour',
      session_version = session_version + 1
  where session_id = context.owner_session_id;

  begin
    perform public.verify_personal_pin('1357');
    raise exception 'Invalidated session unexpectedly verified a PIN.' using errcode = 'P0002';
  exception when sqlstate '28000' then
    null;
  end;
  update public.auth_sessions
  set session_version = 0
  where session_id = context.owner_session_id;

  first_pin := public.generate_staff_pin_by_owner(context.first_staff_id);
  second_pin := public.generate_staff_pin_by_owner(context.second_staff_id);
  if first_pin = second_pin
    or not public.is_acceptable_staff_pin(first_pin)
    or not public.is_acceptable_staff_pin(second_pin) then
    raise exception 'Generated PINs were predictable or duplicated within the store.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = context.first_staff_id
      and must_set_pin = false
      and extensions.crypt(first_pin, pin_hash) = pin_hash
  ) then
    raise exception 'The generated PIN was not stored as a salted hash.';
  end if;

  replacement_pin := public.generate_staff_pin_by_owner(context.first_staff_id);
  if replacement_pin = first_pin then
    raise exception 'PIN replacement did not invalidate the prior credential.';
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', context.first_staff_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', context.first_staff_id,
      'role', 'authenticated',
      'session_id', context.first_staff_session_id
    )::text,
    true
  );
  if public.verify_personal_pin(first_pin) or not public.verify_personal_pin(replacement_pin) then
    raise exception 'Replacing the PIN did not immediately invalidate the old PIN.';
  end if;

  begin
    perform public.set_personal_pin('4826');
    raise exception 'Staff unexpectedly used the self-service PIN function.' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    null;
  end;

  perform pg_catalog.set_config('request.jwt.claim.sub', context.owner_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', context.owner_id,
      'role', 'authenticated',
      'session_id', context.owner_session_id
    )::text,
    true
  );
  if not exists (
    select 1 from public.profiles
    where id = context.owner_id
      and extensions.crypt('1357', pin_hash) = owner_pin_hash
  ) or not exists (
    select 1 from public.stores
    where store_id = context.store_id
      and admin_pin_hash = void_pin_hash
      and extensions.crypt('2468', admin_pin_hash) = admin_pin_hash
  ) then
    raise exception 'Staff PIN management changed an Owner or store PIN.';
  end if;

  delete from public.pin_attempts
  where store_id = context.store_id
    and user_id = context.owner_id
    and purpose = 'personal_pin';

  for loop_index in 1..5 loop
    result := public.change_personal_pin('9999', '8642');
    if result is distinct from false then
      raise exception 'An incorrect current PIN was not rejected on attempt %.', loop_index;
    end if;

    select failed_attempts, locked_until
    into recorded_attempts, attempt_lock_until
    from public.pin_attempts
    where store_id = context.store_id
      and user_id = context.owner_id
      and purpose = 'personal_pin';

    if loop_index < 5
      and (recorded_attempts is distinct from loop_index or attempt_lock_until is not null) then
      raise exception 'An incorrect current PIN attempt was not recorded.';
    end if;
    if loop_index = 5
      and (recorded_attempts is distinct from 0 or attempt_lock_until is null or attempt_lock_until <= now()) then
      raise exception 'The fifth incorrect PIN attempt did not activate lockout.';
    end if;
  end loop;

  begin
    perform public.change_personal_pin('1357', '8642');
    raise exception 'A locked account unexpectedly changed its PIN.' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    null;
  end;

  delete from public.pin_attempts
  where store_id = context.store_id
    and user_id = context.owner_id
    and purpose = 'personal_pin';

  result := public.change_personal_pin('1357', '8642');
  if result is distinct from true
    or not exists (
      select 1 from public.profiles
      where id = context.owner_id
        and extensions.crypt('8642', pin_hash) = pin_hash
    )
    or exists (
      select 1 from public.profiles
      where id = context.owner_id
        and extensions.crypt('1357', pin_hash) = pin_hash
    ) then
    raise exception 'A valid Owner session could not change the Owner Personal PIN.';
  end if;

  if exists (
    select 1
    from public.activity_logs
    where entity_id in (context.first_staff_id::text, context.second_staff_id::text)
      and action in ('staff.pin_assigned', 'staff.pin_reset')
      and meta::text like '%' || first_pin || '%'
  ) then
    raise exception 'A generated PIN was included in the audit metadata.';
  end if;
end
$$;

select pass('staff PIN generation, uniqueness, replacement, authorization, hashing, and PIN separation assertions completed');
select * from finish();

rollback;
