alter table public.device_pin_attempts
  drop constraint if exists device_pin_attempts_failed_attempts_check;

alter table public.device_pin_attempts
  add constraint device_pin_attempts_failed_attempts_check
  check (failed_attempts between 0 and 7);

update public.device_pin_attempts
set locked_until = now() + interval '1 minute',
    updated_at = now()
where failed_attempts = 5
  and locked_until = 'infinity'::timestamptz;

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
    if pin_attempt.locked_until = 'infinity'::timestamptz then
      raise exception 'PIN sign-in is blocked until the store owner restores device access.' using errcode = 'P0001';
    end if;
    raise exception 'PIN sign-in is temporarily locked. Wait before trying again.' using errcode = 'P0001';
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

  next_count := least(coalesce(pin_attempt.failed_attempts, 0) + 1, 7);
  insert into public.device_pin_attempts (
    device_id, store_id, failed_attempts, locked_until, updated_at
  )
  values (
    device_row.id,
    device_row.store_id,
    next_count,
    case next_count
      when 3 then now() + interval '30 seconds'
      when 5 then now() + interval '1 minute'
      when 6 then now() + interval '5 minutes'
      when 7 then 'infinity'::timestamptz
      else null
    end,
    now()
  )
  on conflict (device_id) do update
  set failed_attempts = excluded.failed_attempts,
      locked_until = excluded.locked_until,
      updated_at = excluded.updated_at;
  return null;
end
$$;

update public.app_schema_version
set version = 20261127210000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
