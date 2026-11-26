create table public.devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(store_id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  username text not null unique check (username ~ '^d-[a-z0-9]{8}$'),
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  session_version integer not null default 0,
  last_seen_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.devices enable row level security;
revoke all on public.devices from public, anon, authenticated;
grant select, insert, update, delete on public.devices to service_role;

create table public.device_sessions (
  session_id text primary key,
  device_id uuid not null references public.devices(id) on delete cascade,
  session_version integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.device_sessions enable row level security;
revoke all on public.device_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.device_sessions to service_role;

create table public.device_pin_attempts (
  device_id uuid primary key references public.devices(id) on delete cascade,
  store_id uuid not null references public.stores(store_id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 4),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.device_pin_attempts enable row level security;
revoke all on public.device_pin_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.device_pin_attempts to service_role;

alter table public.auth_sessions
  add column device_id uuid references public.devices(id) on delete cascade;
create index auth_sessions_device_id_idx on public.auth_sessions (device_id)
  where device_id is not null;

create or replace function public.is_current_session_valid()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.auth_sessions active_session
    join public.profiles profile on profile.id = active_session.user_id
    where active_session.session_id = (auth.jwt() ->> 'session_id')
      and active_session.user_id = (select auth.uid())
      and active_session.session_version = profile.session_version
      and active_session.expires_at > now()
      and profile.is_active
      and (
        active_session.device_id is null
        or exists (
          select 1
          from public.devices active_device
          join public.device_sessions device_session
            on device_session.device_id = active_device.id
          where active_device.id = active_session.device_id
            and active_device.is_active
            and device_session.session_id = active_session.session_id
            and device_session.session_version = active_device.session_version
            and device_session.expires_at > now()
        )
      )
      and (
        profile.store_id is null
        or exists (
          select 1
          from public.stores target_store
          join public.profiles store_owner on store_owner.id = target_store.owner_id
          where target_store.store_id = profile.store_id
            and target_store.is_active
            and target_store.archived_at is null
            and (
              target_store.subscription_paid_until is null
              or target_store.subscription_paid_until >= (now() at time zone target_store.timezone)::date
            )
            and store_owner.role = 'owner'
            and store_owner.is_active
            and store_owner.store_id = target_store.store_id
        )
      )
  )
$$;

create or replace function public.revoke_current_auth_session()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_session_id text := auth.jwt() ->> 'session_id';
  current_device_id uuid;
begin
  select device_id into current_device_id
  from public.auth_sessions
  where session_id = current_session_id
    and user_id = (select auth.uid());

  if current_device_id is not null then
    delete from public.device_sessions
    where session_id = current_session_id
      and device_id = current_device_id;
  end if;

  delete from public.auth_sessions
  where session_id = current_session_id
    and user_id = (select auth.uid());
end
$$;

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
  matching_staff_id uuid;
  match_count integer;
  next_count integer;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'Enter a valid staff PIN.' using errcode = '22023';
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
    raise exception 'PIN verification is temporarily locked.' using errcode = 'P0001';
  end if;

  select count(*), (array_agg(p.id order by p.id))[1]
  into match_count, matching_staff_id
  from public.profiles p
  where p.store_id = device_row.store_id
    and p.role = 'staff'
    and p.is_active
    and not p.must_set_pin
    and p.pin_hash is not null
    and extensions.crypt(p_pin, p.pin_hash) = p.pin_hash;

  if match_count = 1 then
    delete from public.device_pin_attempts where device_id = device_row.id;
    return matching_staff_id;
  end if;

  next_count := coalesce(pin_attempt.failed_attempts, 0) + 1;
  insert into public.device_pin_attempts (
    device_id, store_id, failed_attempts, locked_until, updated_at
  )
  values (
    device_row.id,
    device_row.store_id,
    case when next_count >= 5 then 0 else next_count end,
    case when next_count >= 5 then now() + interval '60 seconds' else null end,
    now()
  )
  on conflict (device_id) do update
  set failed_attempts = excluded.failed_attempts,
      locked_until = excluded.locked_until,
      updated_at = excluded.updated_at;
  return null;
end
$$;

revoke all on function public.verify_staff_pin_for_device(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.verify_staff_pin_for_device(uuid, uuid, text, text)
  to service_role;

update public.app_schema_version
set version = 20261127100000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
