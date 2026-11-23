alter table public.profiles
  add column if not exists must_set_pin boolean not null default false;

update public.profiles
set pin_hash = null
where role = 'staff'
  and must_change_password
  and pin_hash is not null;

update public.profiles
set must_set_pin = role = 'staff' and pin_hash is null;

alter table public.profiles
  add constraint profiles_must_set_pin_role_check
  check (not must_set_pin or role = 'staff');

grant select (must_set_pin) on public.profiles to authenticated;

create unique index if not exists profiles_username_case_insensitive_key
  on public.profiles (lower(username))
  where username is not null;

create or replace function public.reject_profile_setup_flag_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.must_set_pin is distinct from old.must_set_pin
    and current_user in ('anon', 'authenticated') then
    raise exception 'Only a credential workflow can change the PIN setup state.' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger profiles_reject_setup_flag_change
before update of must_set_pin on public.profiles
for each row execute function public.reject_profile_setup_flag_change();

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
    and role = 'staff'
    and is_active
  for update;
  if not found or target.must_change_password or not target.must_set_pin or target.pin_hash is not null then
    raise exception 'The staff account is not ready to set a PIN.';
  end if;
  update public.profiles
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
      must_set_pin = false
  where id = target.id;
  delete from public.pin_attempts
  where user_id = target.id
    and purpose = 'personal_pin';
  perform public.log_activity(
    'staff.pin_set',
    target.name || ' set a personal PIN.',
    'staff',
    target.id::text,
    jsonb_build_object('after', jsonb_build_object('hasPin', true))
  );
end
$$;

create or replace function public.set_staff_pin_by_owner(p_staff_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must contain exactly 4 digits.';
  end if;
  update public.profiles p
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
      must_set_pin = false
  where p.id = p_staff_id
    and p.role = 'staff'
    and p.store_id = (select public.current_store_id())
    and not p.must_change_password
    and not p.must_set_pin
    and public.is_store_owner(p.store_id);
  if not found then
    raise exception 'Only this store owner can reset a staff PIN after setup is complete.' using errcode = '42501';
  end if;
  delete from public.pin_attempts
  where user_id = p_staff_id
    and purpose = 'personal_pin';
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
    and role = 'staff'
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
    'staff.pin_changed',
    target.name || ' changed their personal PIN.',
    'staff',
    target.id::text,
    '{}'::jsonb
  );
end
$$;

revoke all on function public.change_personal_pin(text, text) from public, anon;
grant execute on function public.change_personal_pin(text, text) to authenticated;
