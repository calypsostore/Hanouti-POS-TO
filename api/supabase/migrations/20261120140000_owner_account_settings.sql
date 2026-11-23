alter table public.profiles
  drop constraint if exists profiles_must_set_pin_role_check;

alter table public.profiles
  add constraint profiles_must_set_pin_role_check
  check (not must_set_pin or role in ('staff', 'owner'));

create or replace function public.set_personal_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must contain exactly 4 digits.';
  end if;
  select * into target
  from public.profiles
  where id = (select auth.uid())
    and role in ('staff', 'owner')
    and is_active
  for update;
  if not found or target.must_change_password or not target.must_set_pin or target.pin_hash is not null then
    raise exception 'The account is not ready to set a PIN.';
  end if;
  update public.profiles
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
      must_set_pin = false
  where id = target.id;
  delete from public.pin_attempts
  where user_id = target.id
    and purpose = 'personal_pin';
  perform public.log_activity(
    target.role || '.pin_set',
    target.name || ' set a personal PIN.',
    target.role,
    target.id::text,
    jsonb_build_object('after', jsonb_build_object('hasPin', true))
  );
end
$$;

create or replace function public.has_personal_pin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.id = (select auth.uid())
      and p.role in ('staff', 'owner')
      and p.pin_hash is not null
  )
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

create or replace function public.change_personal_pin(p_current_pin text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
begin
  if p_current_pin is null or p_current_pin !~ '^[0-9]{4}$'
    or p_new_pin is null or p_new_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must contain exactly 4 digits.';
  end if;
  select * into target
  from public.profiles
  where id = (select auth.uid())
    and role in ('staff', 'owner')
    and is_active
    and not must_change_password
    and not must_set_pin
  for update;
  if not found or target.pin_hash is null then
    raise exception 'Complete the initial password and PIN setup first.';
  end if;
  if not public.verify_personal_pin(p_current_pin) then
    raise exception 'Incorrect PIN.' using errcode = '42501';
  end if;
  update public.profiles
  set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 12))
  where id = target.id;
  delete from public.pin_attempts
  where user_id = target.id
    and purpose = 'personal_pin';
  perform public.log_activity(
    target.role || '.pin_changed',
    target.name || ' changed their personal PIN.',
    target.role,
    target.id::text,
    '{}'::jsonb
  );
end
$$;

create or replace function public.update_owner_profile(p_name text, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.profiles%rowtype;
  clean_name text := pg_catalog.btrim(p_name);
  clean_phone text := nullif(pg_catalog.btrim(p_phone), '');
begin
  if clean_name is null or clean_name = '' or pg_catalog.length(clean_name) > 200 then
    raise exception 'Owner name is required and must be 200 characters or fewer.';
  end if;
  if clean_phone is not null and pg_catalog.length(clean_phone) > 100 then
    raise exception 'Phone must be 100 characters or fewer.';
  end if;
  select * into target
  from public.profiles
  where id = (select auth.uid())
    and role = 'owner'
    and is_active
  for update;
  if not found then
    raise exception 'Only an active store owner can update this profile.' using errcode = '42501';
  end if;
  update public.profiles
  set name = clean_name,
      phone = clean_phone
  where id = target.id;
  perform public.log_activity(
    'owner.profile_changed',
    'Updated owner profile details.',
    'owner',
    target.id::text,
    jsonb_build_object(
      'before', jsonb_build_object('name', target.name, 'phone', target.phone),
      'after', jsonb_build_object('name', clean_name, 'phone', clean_phone)
    )
  );
end
$$;

revoke all on function public.set_personal_pin(text) from public, anon;
revoke all on function public.has_personal_pin(uuid) from public, anon;
revoke all on function public.verify_personal_pin(text) from public, anon;
revoke all on function public.change_personal_pin(text, text) from public, anon;
revoke all on function public.update_owner_profile(text, text) from public, anon;

grant execute on function public.set_personal_pin(text) to authenticated;
grant execute on function public.has_personal_pin(uuid) to authenticated;
grant execute on function public.verify_personal_pin(text) to authenticated;
grant execute on function public.change_personal_pin(text, text) to authenticated;
grant execute on function public.update_owner_profile(text, text) to authenticated;

update public.app_schema_version
set version = 20261120140000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
