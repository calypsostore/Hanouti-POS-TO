create or replace function public.verify_staff_pin_for_device(
  p_device_id uuid,
  p_device_auth_user_id uuid,
  p_session_id text,
  p_pin text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_row public.devices%rowtype;
  pin_attempt public.device_pin_attempts%rowtype;
  matching_account_id uuid;
  match_count integer;
  next_count integer;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'Enter a valid account PIN.' using errcode = '22023';
  end if;

  select d.* into device_row
  from public.devices d
  join public.device_sessions s on s.device_id = d.id
  join public.stores target_store on target_store.store_id = d.store_id
  join public.profiles store_owner on store_owner.id = target_store.owner_id
  where d.id = p_device_id
    and d.auth_user_id = p_device_auth_user_id
    and d.is_active
    and s.session_id = p_session_id
    and s.session_version = d.session_version
    and s.expires_at > now()
    and target_store.is_active
    and target_store.archived_at is null
    and (
      target_store.subscription_paid_until is null
      or target_store.subscription_paid_until >= (now() at time zone target_store.timezone)::date
    )
    and store_owner.role = 'owner'
    and store_owner.is_active
    and store_owner.store_id = target_store.store_id;
  if not found then
    raise exception 'The device session is no longer active.' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(device_row.id::text || ':staff-pin', 0)
  );
  select * into pin_attempt
  from public.device_pin_attempts
  where device_id = device_row.id
  for update;
  if found and pin_attempt.locked_until > now() then
    raise exception 'PIN verification is locked until the owner resets device access.' using errcode = 'P0001';
  end if;

  select count(*), (array_agg(p.id order by p.id))[1]
  into match_count, matching_account_id
  from public.profiles p
  join public.stores owner_store on owner_store.store_id = p.store_id
  where p.id = owner_store.owner_id
    and p.store_id = device_row.store_id
    and p.role = 'owner'
    and p.is_active
    and not p.must_set_pin
    and p.pin_hash is not null
    and extensions.crypt(p_pin, p.pin_hash) = p.pin_hash;

  if match_count = 1 then
    delete from public.device_pin_attempts where device_id = device_row.id;
    return matching_account_id;
  end if;

  select count(*), (array_agg(p.id order by p.id))[1]
  into match_count, matching_account_id
  from public.profiles p
  where p.store_id = device_row.store_id
    and p.role = 'staff'
    and p.is_active
    and not p.must_set_pin
    and p.pin_hash is not null
    and extensions.crypt(p_pin, p.pin_hash) = p.pin_hash;

  if match_count = 1 then
    delete from public.device_pin_attempts where device_id = device_row.id;
    return matching_account_id;
  end if;

  next_count := least(coalesce(pin_attempt.failed_attempts, 0) + 1, 5);
  insert into public.device_pin_attempts (
    device_id, store_id, failed_attempts, locked_until, updated_at
  )
  values (
    device_row.id,
    device_row.store_id,
    next_count,
    case when next_count >= 5 then 'infinity'::timestamptz else null end,
    now()
  )
  on conflict (device_id) do update
  set failed_attempts = excluded.failed_attempts,
      locked_until = excluded.locked_until,
      updated_at = excluded.updated_at;
  return null;
end
$$;

create or replace function public.generate_staff_pin_by_owner(p_staff_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
  random_bytes bytea;
  random_value integer;
  candidate text;
  attempt_count integer := 0;
  previous_pin_assigned boolean;
begin
  if not public.is_current_session_valid() then
    raise exception 'The sign-in session has expired or is no longer active.' using errcode = '28000';
  end if;

  select * into target
  from public.profiles
  where id = p_staff_id
    and role = 'staff'
    and store_id = (select public.current_store_id())
  for update;

  if not found or not public.is_store_owner(target.store_id) then
    raise exception 'Only this store owner can generate a staff PIN.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.store_id::text || ':staff-pin-generation', 0)
  );

  previous_pin_assigned := target.pin_hash is not null;
  loop
    attempt_count := attempt_count + 1;
    if attempt_count > 1000 then
      raise exception 'Unable to generate an available staff PIN. Try again.';
    end if;

    random_bytes := extensions.gen_random_bytes(2);
    random_value := pg_catalog.get_byte(random_bytes, 0) * 256
      + pg_catalog.get_byte(random_bytes, 1);
    if random_value >= 60000 then
      continue;
    end if;

    candidate := pg_catalog.lpad((random_value % 10000)::text, 4, '0');
    if not public.is_acceptable_staff_pin(candidate) then
      continue;
    end if;

    if target.pin_hash is not null
      and extensions.crypt(candidate, target.pin_hash) = target.pin_hash then
      continue;
    end if;

    if exists (
      select 1
      from public.profiles other_account
      where other_account.store_id = target.store_id
        and other_account.role in ('staff', 'owner')
        and other_account.id <> target.id
        and other_account.pin_hash is not null
        and extensions.crypt(candidate, other_account.pin_hash) = other_account.pin_hash
    ) then
      continue;
    end if;
    exit;
  end loop;

  update public.profiles
  set pin_hash = extensions.crypt(candidate, extensions.gen_salt('bf', 12)),
      must_set_pin = false
  where id = target.id;

  delete from public.pin_attempts
  where store_id = target.store_id
    and user_id = target.id
    and purpose = 'personal_pin';

  perform public.log_activity(
    case when previous_pin_assigned then 'staff.pin_reset' else 'staff.pin_assigned' end,
    case when previous_pin_assigned then 'Owner generated a replacement staff PIN.' else 'Owner generated a staff PIN.' end,
    'staff',
    target.id::text,
    jsonb_build_object(
      'before', jsonb_build_object('hasPin', previous_pin_assigned),
      'after', jsonb_build_object('hasPin', true)
    )
  );

  return candidate;
end
$$;

create or replace function public.set_personal_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_current_session_valid() then
    raise exception 'The sign-in session has expired or is no longer active.' using errcode = '28000';
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must contain exactly 4 digits.';
  end if;
  select * into target
  from public.profiles
  where id = (select auth.uid())
    and role = 'owner'
    and is_active
  for update;
  if not found or target.must_change_password or not target.must_set_pin or target.pin_hash is not null then
    raise exception 'The owner account is not ready to set a personal PIN.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.store_id::text || ':staff-pin-generation', 0)
  );
  if exists (
    select 1
    from public.profiles other_account
    where other_account.store_id = target.store_id
      and other_account.role in ('staff', 'owner')
      and other_account.id <> target.id
      and other_account.pin_hash is not null
      and extensions.crypt(p_pin, other_account.pin_hash) = other_account.pin_hash
  ) then
    raise exception 'This PIN is already assigned to another account. Choose a different PIN.';
  end if;

  update public.profiles
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
      must_set_pin = false
  where id = target.id;
  delete from public.pin_attempts
  where user_id = target.id
    and purpose = 'personal_pin';
  perform public.log_activity(
    'owner.pin_set',
    target.name || ' set a personal PIN.',
    'owner',
    target.id::text,
    jsonb_build_object('after', jsonb_build_object('hasPin', true))
  );
end
$$;

create or replace function public.change_personal_pin(p_current_pin text, p_new_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
begin
  if not public.is_current_session_valid() then
    raise exception 'The sign-in session has expired or is no longer active.' using errcode = '28000';
  end if;

  if p_current_pin is null or p_current_pin !~ '^[0-9]{4}$'
    or p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must contain exactly 4 digits.';
  end if;
  select * into target
  from public.profiles
  where id = (select auth.uid())
    and role = 'owner'
    and is_active
    and not must_change_password
    and not must_set_pin
  for update;
  if not found or target.pin_hash is null then
    raise exception 'Complete the initial password and PIN setup first.';
  end if;
  if not public.verify_personal_pin(p_current_pin) then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.store_id::text || ':staff-pin-generation', 0)
  );
  if exists (
    select 1
    from public.profiles other_account
    where other_account.store_id = target.store_id
      and other_account.role in ('staff', 'owner')
      and other_account.id <> target.id
      and other_account.pin_hash is not null
      and extensions.crypt(p_new_pin, other_account.pin_hash) = other_account.pin_hash
  ) then
    raise exception 'This PIN is already assigned to another account. Choose a different PIN.';
  end if;

  update public.profiles
  set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 12))
  where id = target.id;
  delete from public.pin_attempts
  where user_id = target.id
    and purpose = 'personal_pin';
  perform public.log_activity(
    'owner.pin_changed',
    target.name || ' changed their personal PIN.',
    'owner',
    target.id::text,
    '{}'::jsonb
  );
  return true;
end
$$;

update public.app_schema_version
set version = 20261127120000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
