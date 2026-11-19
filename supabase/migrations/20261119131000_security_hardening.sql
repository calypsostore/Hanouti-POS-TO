create table public.auth_sessions (
  session_id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_version integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.auth_sessions enable row level security;
revoke all on public.auth_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.auth_sessions to service_role;

revoke select on public.profiles, public.stores from authenticated;
grant select (
  id, store_id, role, name, email, username, phone, notes, position_id,
  must_change_password, is_active, session_version, created_at
) on public.profiles to authenticated;
grant select (
  id, store_id, owner_id, code, name, is_active, archived_at, day_closed_on,
  allow_customer_credit_balance, allow_card_payments, allow_other_payments,
  staff_auto_lock_minutes, cash_out_alert_threshold_millimes,
  daily_sales_target_millimes, pin_must_change, subscription_plan,
  subscription_paid_until, subscription_notes, created_at
) on public.stores to authenticated;
revoke all on public.pin_attempts from public, anon, authenticated;

create table public.login_rate_limits (
  dimension text not null check (dimension in ('username', 'ip')),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  failed_attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  primary key (dimension, key_hash)
);

alter table public.login_rate_limits enable row level security;
revoke all on public.login_rate_limits from public, anon, authenticated, service_role;
create index login_rate_limits_window_started_at_idx on public.login_rate_limits (window_started_at);

create or replace function public.consume_login_attempt(p_username_hash text, p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  subject record;
  current_attempt public.login_rate_limits%rowtype;
  attempt_limit integer;
  next_count integer;
begin
  if p_username_hash !~ '^[0-9a-f]{64}$' or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Login rate-limit keys are invalid.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('login:ip:' || p_ip_hash, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('login:username:' || p_username_hash, 0));

  for subject in
    select 'username'::text as dimension, p_username_hash as key_hash, 5 as max_attempts
    union all
    select 'ip'::text, p_ip_hash, 20
  loop
    attempt_limit := subject.max_attempts;
    select * into current_attempt
    from public.login_rate_limits
    where dimension = subject.dimension and key_hash = subject.key_hash
    for update;

    if found and (
      current_attempt.locked_until > now()
      or (
        current_attempt.window_started_at > now() - interval '15 minutes'
        and current_attempt.failed_attempts >= attempt_limit
      )
    ) then
      return false;
    end if;
  end loop;

  for subject in
    select 'username'::text as dimension, p_username_hash as key_hash, 5 as max_attempts
    union all
    select 'ip'::text, p_ip_hash, 20
  loop
    attempt_limit := subject.max_attempts;
    select * into current_attempt
    from public.login_rate_limits
    where dimension = subject.dimension and key_hash = subject.key_hash
    for update;
    next_count := case
      when not found or current_attempt.window_started_at <= now() - interval '15 minutes' then 1
      else current_attempt.failed_attempts + 1
    end;
    insert into public.login_rate_limits (dimension, key_hash, failed_attempts, window_started_at, locked_until)
    values (
      subject.dimension,
      subject.key_hash,
      next_count,
      case when next_count = 1 then now() else current_attempt.window_started_at end,
      case when next_count >= attempt_limit then now() + interval '15 minutes' else null end
    )
    on conflict (dimension, key_hash) do update
    set failed_attempts = excluded.failed_attempts,
        window_started_at = excluded.window_started_at,
        locked_until = excluded.locked_until;
  end loop;

  return true;
end
$$;

create or replace function public.clear_login_attempts(p_username_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_username_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Login rate-limit keys are invalid.';
  end if;
  delete from public.login_rate_limits
  where dimension = 'username' and key_hash = p_username_hash;
end
$$;

revoke all on function public.consume_login_attempt(text, text) from public, anon, authenticated;
revoke all on function public.clear_login_attempts(text) from public, anon, authenticated;
grant execute on function public.consume_login_attempt(text, text) to service_role;
grant execute on function public.clear_login_attempts(text) to service_role;

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
        profile.store_id is null
        or exists (
          select 1
          from public.stores target_store
          join public.profiles store_owner on store_owner.id = target_store.owner_id
          where target_store.store_id = profile.store_id
            and target_store.is_active
            and target_store.archived_at is null
            and (target_store.subscription_paid_until is null or target_store.subscription_paid_until >= (now() at time zone target_store.timezone)::date)
            and store_owner.role = 'owner'
            and store_owner.is_active
            and store_owner.store_id = target_store.store_id
        )
      )
  )
$$;

create or replace function public.enforce_current_session()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'authenticated' and not public.is_current_session_valid() then
    raise exception 'The sign-in session has expired or is no longer active.' using errcode = '28000';
  end if;
end
$$;

revoke all on function public.is_current_session_valid() from public, anon;
revoke all on function public.enforce_current_session() from public, anon, authenticated;
grant execute on function public.is_current_session_valid() to authenticated, authenticator;
grant execute on function public.enforce_current_session() to anon, authenticated, authenticator, service_role;
grant usage on schema public to authenticator;

create or replace function public.current_store_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.store_id
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.is_active
    and public.is_current_session_valid()
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.is_active
    and public.is_current_session_valid()
$$;

create or replace function public.is_store_owner(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores target_store
    join public.profiles store_owner on store_owner.id = target_store.owner_id
    where target_store.store_id = p_store_id
      and target_store.is_active
      and target_store.archived_at is null
      and (target_store.subscription_paid_until is null or target_store.subscription_paid_until >= (now() at time zone target_store.timezone)::date)
      and target_store.owner_id = (select auth.uid())
      and store_owner.is_active
      and store_owner.role = 'owner'
      and store_owner.store_id = p_store_id
      and public.is_current_session_valid()
  )
$$;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) and public.is_current_session_valid());

create or replace function public.revoke_current_auth_session()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.auth_sessions
  where session_id = (auth.jwt() ->> 'session_id')
    and user_id = (select auth.uid());
end
$$;

revoke all on function public.revoke_current_auth_session() from public, anon;
grant execute on function public.revoke_current_auth_session() to authenticated;

create or replace function public.force_logout_staff(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles profile
  set session_version = profile.session_version + 1
  where profile.id = p_staff_id
    and profile.role = 'staff'
    and profile.store_id = (select public.current_store_id())
    and public.is_store_owner(profile.store_id);
  if not found then
    raise exception 'Only this store owner can force-logout this staff member.' using errcode = '42501';
  end if;
  delete from public.auth_sessions where user_id = p_staff_id;
end
$$;

revoke all on function public.force_logout_staff(uuid) from public, anon;
grant execute on function public.force_logout_staff(uuid) to authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.enforce_current_session';
notify pgrst, 'reload config';
