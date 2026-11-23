alter table public.pin_attempts
  drop constraint pin_attempts_purpose_check;

alter table public.pin_attempts
  add constraint pin_attempts_purpose_check
  check (purpose in ('credit_override', 'void', 'z_report', 'personal_pin'));

drop policy stores_read on public.stores;
create policy stores_read on public.stores for select to authenticated
  using (public.is_super_admin() or store_id = (select public.current_store_id()));

drop policy if exists profiles_owner_staff_update on public.profiles;
create policy profiles_owner_staff_update on public.profiles for update to authenticated
  using (role = 'staff' and public.is_store_owner(store_id))
  with check (role = 'staff' and public.is_store_owner(store_id));

create policy activity_logs_super_admin_read on public.activity_logs for select to authenticated
  using (public.is_super_admin());

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
        or new.admin_pin_hash is distinct from old.admin_pin_hash
        or new.pin_must_change is distinct from old.pin_must_change
        or new.day_closed_on is distinct from old.day_closed_on then
        raise exception 'Store ownership and platform-managed fields cannot be changed by a store owner.' using errcode = '42501';
      end if;
    elsif tg_table_name = 'profiles' then
      if new.id is distinct from old.id
        or new.store_id is distinct from old.store_id
        or new.role is distinct from old.role
        or new.username is distinct from old.username
        or new.email is distinct from old.email
        or new.pin_hash is distinct from old.pin_hash
        or new.session_version is distinct from old.session_version then
        raise exception 'Profile identity and security fields cannot be changed directly.' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end
$$;

create or replace function public.log_activity(
  p_action text,
  p_summary text,
  p_entity_type text,
  p_entity_id text,
  p_meta jsonb default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  result_id uuid;
  target_store_id uuid;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid())
    and is_active;
  if not found then
    raise exception 'An active account is required to record activity.' using errcode = '42501';
  end if;
  if actor.role = 'super_admin'
    and p_entity_type = 'store'
    and p_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    target_store_id := p_entity_id::uuid;
  elsif actor.role = 'super_admin'
    and p_entity_type = 'owner'
    and p_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select p.store_id into target_store_id
    from public.profiles p
    where p.id = p_entity_id::uuid
      and p.role = 'owner';
    if target_store_id is null then
      raise exception 'The owner account could not be found.';
    end if;
  elsif actor.store_id is not null then
    target_store_id := actor.store_id;
  else
    raise exception 'An active store account is required to record activity.' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(p_action), '') is null
    or nullif(pg_catalog.btrim(p_summary), '') is null
    or nullif(pg_catalog.btrim(p_entity_type), '') is null
    or nullif(pg_catalog.btrim(p_entity_id), '') is null then
    raise exception 'Activity records require an action, summary, and entity.';
  end if;

  insert into public.activity_logs (
    store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta
  ) values (
    target_store_id, actor.id, actor.name, actor.role, p_action, p_summary,
    p_entity_type, p_entity_id, coalesce(p_meta, '{}'::jsonb)
  )
  returning id into result_id;
  return result_id;
end
$$;

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
    or p_purpose not in ('credit_override', 'void', 'z_report')
    or not (
      public.is_store_owner(p_store_id)
      or (p_purpose = 'credit_override' and public.has_store_permission('tab_override_limit'))
      or (p_purpose = 'void' and public.has_store_permission('request_void'))
    ) then
    raise exception 'Not authorized to verify this PIN.' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_store_id::text || auth.uid()::text || p_purpose, 0)
  );
  select s.admin_pin_hash into stored_hash
  from public.stores s
  where s.store_id = p_store_id;
  if stored_hash is null then return false; end if;

  select * into attempt
  from public.pin_attempts
  where store_id = p_store_id
    and user_id = auth.uid()
    and purpose = p_purpose
  for update;
  if found and attempt.locked_until > now() then
    raise exception 'PIN verification is temporarily locked.' using errcode = 'P0001';
  end if;
  if (stored_hash like '$2%' and extensions.crypt(p_pin, stored_hash) = stored_hash)
    or (stored_hash not like '$2%' and public.verify_secret(p_pin, stored_hash)) then
    delete from public.pin_attempts
    where store_id = p_store_id
      and user_id = auth.uid()
      and purpose = p_purpose;
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

create or replace function public.set_store_admin_pin(p_store_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'Admin PIN must contain exactly 4 digits.';
  end if;
  update public.stores
  set admin_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12)),
      pin_must_change = false
  where store_id = p_store_id
    and p_store_id = (select public.current_store_id())
    and public.is_store_owner(p_store_id);
  if not found then
    raise exception 'Only this store owner can change the store Admin PIN.' using errcode = '42501';
  end if;
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
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12))
  where p.id = p_staff_id
    and p.role = 'staff'
    and p.store_id = (select public.current_store_id())
    and public.is_store_owner(p.store_id);
  if not found then
    raise exception 'Only this store owner can reset this staff PIN.' using errcode = '42501';
  end if;
  delete from public.pin_attempts
  where user_id = p_staff_id
    and purpose = 'personal_pin';
end
$$;

create or replace function public.force_logout_staff(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles p
  set session_version = session_version + 1
  where p.id = p_staff_id
    and p.role = 'staff'
    and p.store_id = (select public.current_store_id())
    and public.is_store_owner(p.store_id);
  if not found then
    raise exception 'Only this store owner can force-logout this staff member.' using errcode = '42501';
  end if;
end
$$;

create or replace function public.complete_initial_password()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set must_change_password = false
  where id = (select auth.uid())
    and must_change_password;
  if not found then
    raise exception 'This account is not awaiting an initial password change.';
  end if;
end
$$;

create or replace function public.set_personal_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must contain exactly 4 digits.';
  end if;
  update public.profiles
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 12))
  where id = (select auth.uid())
    and role = 'staff'
    and not must_change_password;
  if not found then
    raise exception 'The staff account is not ready to set a PIN.';
  end if;
  delete from public.pin_attempts
  where user_id = (select auth.uid())
    and purpose = 'personal_pin';
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
      and p.role = 'staff'
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
    and role = 'staff'
  for update;
  if not found then
    raise exception 'The staff account could not be found.';
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

revoke all on function public.complete_initial_password() from public, anon;
revoke all on function public.log_activity(text, text, text, text, jsonb) from public, anon;
revoke all on function public.verify_store_pin(uuid, text, text) from public, anon;
revoke all on function public.set_store_admin_pin(uuid, text) from public, anon;
revoke all on function public.set_staff_pin_by_owner(uuid, text) from public, anon;
revoke all on function public.force_logout_staff(uuid) from public, anon;
revoke all on function public.set_personal_pin(text) from public, anon;
revoke all on function public.has_personal_pin(uuid) from public, anon;
revoke all on function public.verify_personal_pin(text) from public, anon;
grant execute on function public.complete_initial_password() to authenticated;
grant execute on function public.log_activity(text, text, text, text, jsonb) to authenticated;
grant execute on function public.verify_store_pin(uuid, text, text) to authenticated;
grant execute on function public.set_store_admin_pin(uuid, text) to authenticated;
grant execute on function public.set_staff_pin_by_owner(uuid, text) to authenticated;
grant execute on function public.force_logout_staff(uuid) to authenticated;
grant execute on function public.set_personal_pin(text) to authenticated;
grant execute on function public.has_personal_pin(uuid) to authenticated;
grant execute on function public.verify_personal_pin(text) to authenticated;
