-- Run against a migrated local Supabase database with the postgres role.
-- All fixture data is rolled back.
create extension if not exists pgtap;
select plan(1);

begin;

create temporary table device_auth_context (
  store_a uuid primary key,
  store_b uuid not null,
  owner_a uuid not null,
  staff_a uuid not null,
  owner_b uuid not null,
  staff_b uuid not null,
  device_auth_user uuid not null,
  device_id uuid not null,
  device_session_id text not null,
  staff_session_id text not null
) on commit drop;

insert into device_auth_context
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid()::text, gen_random_uuid()::text
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select owner_a, 'authenticated', 'authenticated',
       'device-owner-a-' || replace(store_a::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Device owner A"}'::jsonb, now(), now()
from device_auth_context
union all
select staff_a, 'authenticated', 'authenticated',
       'device-staff-a-' || replace(store_a::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Device staff A"}'::jsonb, now(), now()
from device_auth_context
union all
select owner_b, 'authenticated', 'authenticated',
       'device-owner-b-' || replace(store_b::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Device owner B"}'::jsonb, now(), now()
from device_auth_context
union all
select staff_b, 'authenticated', 'authenticated',
       'device-staff-b-' || replace(store_b::text, '-', '') || '@example.invalid',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Device staff B"}'::jsonb, now(), now()
from device_auth_context
union all
select device_auth_user, 'authenticated', 'authenticated',
       'device-auth-' || replace(device_auth_user::text, '-', '') || '@device.7anouti.app',
       '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
       '{"name":"Device auth"}'::jsonb, now(), now()
from device_auth_context;

insert into public.stores (id, store_id, owner_id, code, name, admin_pin_hash)
select store_a, store_a, owner_a,
       'da' || left(replace(store_a::text, '-', ''), 8),
       'Device test store A',
       extensions.crypt('1357', extensions.gen_salt('bf', 4))
from device_auth_context
union all
select store_b, store_b, owner_b,
       'db' || left(replace(store_b::text, '-', ''), 8),
       'Device test store B',
       extensions.crypt('9753', extensions.gen_salt('bf', 4))
from device_auth_context;

insert into public.profiles (
  id, store_id, role, name, email, username, pin_hash,
  must_change_password, is_active, session_version, must_set_pin
)
select owner_a, store_a, 'owner', 'Device owner A',
       'device-owner-a-' || replace(store_a::text, '-', '') || '@example.invalid',
       'device-owner-a-' || left(replace(store_a::text, '-', ''), 12),
       extensions.crypt('1357', extensions.gen_salt('bf', 4)),
       false, true, 0, false
from device_auth_context
union all
select staff_a, store_a, 'staff', 'Device staff A',
       'device-staff-a-' || replace(store_a::text, '-', '') || '@example.invalid',
       'device-staff-a-' || left(replace(store_a::text, '-', ''), 12),
       extensions.crypt('4826', extensions.gen_salt('bf', 4)),
       false, true, 0, false
from device_auth_context
union all
select owner_b, store_b, 'owner', 'Device owner B',
       'device-owner-b-' || replace(store_b::text, '-', '') || '@example.invalid',
       'device-owner-b-' || left(replace(store_b::text, '-', ''), 12),
       extensions.crypt('8642', extensions.gen_salt('bf', 4)),
       false, true, 0, false
from device_auth_context
union all
select staff_b, store_b, 'staff', 'Device staff B',
       'device-staff-b-' || replace(store_b::text, '-', '') || '@example.invalid',
       'device-staff-b-' || left(replace(store_b::text, '-', ''), 12),
       extensions.crypt('7531', extensions.gen_salt('bf', 4)),
       false, true, 0, false
from device_auth_context;

insert into public.devices (
  id, store_id, auth_user_id, name, username, created_by
)
select device_id, store_a, device_auth_user, 'Device A', 'd-' || left(replace(device_id::text, '-', ''), 8), owner_a
from device_auth_context;

insert into public.device_sessions (session_id, device_id, session_version, expires_at)
select device_session_id, device_id, 0, now() + interval '1 hour'
from device_auth_context;

do $$
declare
  context device_auth_context%rowtype;
  result_id uuid;
  attempt integer;
begin
  select * into context from device_auth_context;

  if has_table_privilege('authenticated', 'public.devices', 'SELECT')
    or has_table_privilege('authenticated', 'public.device_sessions', 'SELECT')
    or has_function_privilege(
      'authenticated',
      'public.verify_staff_pin_for_device(uuid,uuid,text,text)',
      'EXECUTE'
    ) then
    raise exception 'Device data or server PIN verification is exposed to client Auth roles.';
  end if;

  result_id := public.verify_staff_pin_for_device(
    context.device_id, context.device_auth_user, context.device_session_id, '4826'
  );
  if result_id is distinct from context.staff_a then
    raise exception 'A valid same-store staff PIN did not identify its staff account.';
  end if;
  if public.verify_staff_pin_for_device(
    context.device_id, context.device_auth_user, context.device_session_id, '7531'
  ) is not null then
    raise exception 'A PIN belonging to another store authenticated on this device.';
  end if;
  if public.verify_staff_pin_for_device(
    context.device_id, context.device_auth_user, context.device_session_id, '1357'
  ) is not null then
    raise exception 'The Owner Personal PIN authenticated as Staff.';
  end if;

  delete from public.device_pin_attempts where device_id = context.device_id;
  for attempt in 1..3 loop
    perform public.verify_staff_pin_for_device(
      context.device_id, context.device_auth_user, context.device_session_id, '1111'
    );
  end loop;
  if not exists (
    select 1
    from public.device_pin_attempts
    where device_id = context.device_id
      and failed_attempts = 3
      and locked_until > now()
      and locked_until <= now() + interval '30 seconds'
  ) then
    raise exception 'Three failed PIN attempts did not lock the device for 30 seconds.';
  end if;
  begin
    perform public.verify_staff_pin_for_device(
      context.device_id, context.device_auth_user, context.device_session_id, '4826'
    );
    raise exception 'The first PIN cooldown did not block a correct attempt.' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    null;
  end;

  update public.device_pin_attempts
  set locked_until = now() - interval '1 second'
  where device_id = context.device_id;
  perform public.verify_staff_pin_for_device(
    context.device_id, context.device_auth_user, context.device_session_id, '1111'
  );
  perform public.verify_staff_pin_for_device(
    context.device_id, context.device_auth_user, context.device_session_id, '1111'
  );
  if not exists (
    select 1
    from public.device_pin_attempts
    where device_id = context.device_id
      and failed_attempts = 5
      and locked_until > now()
      and locked_until <= now() + interval '1 minute'
  ) then
    raise exception 'The fifth failed PIN attempt did not lock the device for one minute.';
  end if;

  update public.device_pin_attempts
  set locked_until = now() - interval '1 second'
  where device_id = context.device_id;
  perform public.verify_staff_pin_for_device(
    context.device_id, context.device_auth_user, context.device_session_id, '1111'
  );
  if not exists (
    select 1
    from public.device_pin_attempts
    where device_id = context.device_id
      and failed_attempts = 6
      and locked_until > now()
      and locked_until <= now() + interval '5 minutes'
  ) then
    raise exception 'The sixth failed PIN attempt did not lock the device for five minutes.';
  end if;

  update public.device_pin_attempts
  set locked_until = now() - interval '1 second'
  where device_id = context.device_id;
  perform public.verify_staff_pin_for_device(
    context.device_id, context.device_auth_user, context.device_session_id, '1111'
  );
  if not exists (
    select 1
    from public.device_pin_attempts
    where device_id = context.device_id
      and failed_attempts = 7
      and locked_until = 'infinity'::timestamptz
  ) then
    raise exception 'The seventh failed PIN attempt did not permanently block PIN login.';
  end if;
  begin
    perform public.verify_staff_pin_for_device(
      context.device_id, context.device_auth_user, context.device_session_id, '4826'
    );
    raise exception 'The permanent PIN block did not reject a correct attempt.' using errcode = 'P0002';
  exception when sqlstate 'P0001' then
    null;
  end;
  delete from public.device_pin_attempts where device_id = context.device_id;
  if public.verify_staff_pin_for_device(
    context.device_id, context.device_auth_user, context.device_session_id, '4826'
  ) is distinct from context.staff_a then
    raise exception 'Resetting the device PIN lockout did not restore valid Staff sign-in.';
  end if;

  insert into public.device_sessions (session_id, device_id, session_version, expires_at)
  values (context.staff_session_id, context.device_id, 0, now() + interval '1 hour');
  insert into public.auth_sessions (session_id, user_id, session_version, expires_at, device_id)
  values (context.staff_session_id, context.staff_a, 0, now() + interval '1 hour', context.device_id);

  perform pg_catalog.set_config('request.jwt.claim.sub', context.staff_a::text, true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', context.staff_a,
      'role', 'authenticated',
      'session_id', context.staff_session_id
    )::text,
    true
  );
  if not public.is_current_session_valid() then
    raise exception 'A valid staff session on an active device was rejected.';
  end if;
  update public.devices set is_active = false where id = context.device_id;
  if public.is_current_session_valid() then
    raise exception 'Deactivating a device did not invalidate its staff session.';
  end if;

  if exists (
    select 1 from public.profiles
    where id = context.device_auth_user
  ) then
    raise exception 'A device Auth identity was incorrectly represented as an employee profile.';
  end if;
end
$$;

select pass('device store isolation, PIN identity, lockout, client access, session validity, and deactivation assertions completed');
select * from finish();

rollback;
