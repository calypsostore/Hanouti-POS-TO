create or replace function public.is_acceptable_staff_pin(p_pin text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  first_digit integer;
  second_digit integer;
  third_digit integer;
  fourth_digit integer;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    return false;
  end if;

  first_digit := pg_catalog.substr(p_pin, 1, 1)::integer;
  second_digit := pg_catalog.substr(p_pin, 2, 1)::integer;
  third_digit := pg_catalog.substr(p_pin, 3, 1)::integer;
  fourth_digit := pg_catalog.substr(p_pin, 4, 1)::integer;

  return p_pin not in (
      '0123', '1234', '2345', '3456', '4567', '5678', '6789', '7890', '8901', '9012',
      '9876', '8765', '7654', '6543', '5432', '4321', '3210', '2109', '1098', '0987',
      '0246', '1357', '2468', '3579', '8642', '7531', '6420', '9753',
      '1470', '2580', '3690', '0852', '0741', '0963'
    )
    and not (
      (first_digit = second_digit and second_digit = third_digit)
      or (second_digit = third_digit and third_digit = fourth_digit)
      or (first_digit = second_digit and third_digit = fourth_digit)
      or (first_digit = third_digit and second_digit = fourth_digit)
      or (first_digit = fourth_digit and second_digit = third_digit)
    );
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
      from public.profiles other_staff
      where other_staff.store_id = target.store_id
        and other_staff.role = 'staff'
        and other_staff.id <> target.id
        and other_staff.pin_hash is not null
        and extensions.crypt(candidate, other_staff.pin_hash) = other_staff.pin_hash
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

create or replace function public.has_personal_pin(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_current_session_valid() then
    raise exception 'The sign-in session has expired or is no longer active.' using errcode = '28000';
  end if;

  return exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.id = (select auth.uid())
      and p.role in ('staff', 'owner')
      and p.pin_hash is not null
  );
end
$$;

create or replace function public.verify_personal_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
  attempt public.pin_attempts%rowtype;
  next_count integer;
begin
  if not public.is_current_session_valid() then
    raise exception 'The sign-in session has expired or is no longer active.' using errcode = '28000';
  end if;

  select * into target
  from public.profiles
  where id = (select auth.uid())
    and role in ('staff', 'owner')
    and is_active
  for update;
  if not found then
    raise exception 'The account could not be found.';
  end if;
  if target.pin_hash is null then
    raise exception 'No PIN is set for this account. Use your password instead.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target.store_id::text || target.id::text || 'personal_pin', 0)
  );
  select * into attempt
  from public.pin_attempts
  where store_id = target.store_id
    and user_id = target.id
    and purpose = 'personal_pin'
  for update;
  if found and attempt.locked_until > now() then
    raise exception 'PIN verification is temporarily locked.' using errcode = 'P0001';
  end if;

  if p_pin ~ '^[0-9]{4}$'
    and extensions.crypt(p_pin, target.pin_hash) = target.pin_hash then
    delete from public.pin_attempts
    where store_id = target.store_id
      and user_id = target.id
      and purpose = 'personal_pin';
    return true;
  end if;

  next_count := coalesce(attempt.failed_attempts, 0) + 1;
  insert into public.pin_attempts (store_id, user_id, purpose, failed_attempts, locked_until)
  values (
    target.store_id,
    target.id,
    'personal_pin',
    case when next_count >= 5 then 0 else next_count end,
    case when next_count >= 5 then now() + interval '60 seconds' else null end
  )
  on conflict (store_id, user_id, purpose) do update
  set failed_attempts = excluded.failed_attempts,
      locked_until = excluded.locked_until;
  return false;
end
$$;

drop function if exists public.change_personal_pin(text, text);

create function public.change_personal_pin(p_current_pin text, p_new_pin text)
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

revoke all on function public.is_acceptable_staff_pin(text) from public, anon, authenticated;
revoke all on function public.generate_staff_pin_by_owner(uuid) from public, anon;
revoke all on function public.set_staff_pin_by_owner(uuid, text) from public, anon, authenticated;
revoke all on function public.set_personal_pin(text) from public, anon;
revoke all on function public.verify_personal_pin(text) from public, anon;
revoke all on function public.change_personal_pin(text, text) from public, anon;
grant execute on function public.generate_staff_pin_by_owner(uuid) to authenticated;
grant execute on function public.set_personal_pin(text) to authenticated;
grant execute on function public.verify_personal_pin(text) to authenticated;
grant execute on function public.change_personal_pin(text, text) to authenticated;

update public.app_schema_version
set version = 20261126100000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
