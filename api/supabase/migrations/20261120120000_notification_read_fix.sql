revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists notifications_recipient_update on public.notifications;
create policy notifications_recipient_update on public.notifications for update to authenticated
  using (
    store_id = (select public.current_store_id())
    and (
      user_id = (select auth.uid())
      or (user_id is null and target_role = (select public.current_user_role()))
    )
  )
  with check (
    store_id = (select public.current_store_id())
    and (
      user_id = (select auth.uid())
      or (user_id is null and target_role = (select public.current_user_role()))
    )
  );

create index if not exists notifications_unread_idx
  on public.notifications (store_id, user_id, target_role)
  where read_at is null;

create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_role text;
  v_updated integer;
begin
  v_store_id := public.current_store_id();
  v_role := public.current_user_role();

  if v_store_id is null or v_role is null then
    return 0;
  end if;

  update public.notifications n
  set read_at = now()
  where n.store_id = v_store_id
    and n.read_at is null
    and (
      n.user_id = (select auth.uid())
      or (n.user_id is null and n.target_role = v_role)
    )
    and (p_ids is null or n.id = any(p_ids));

  get diagnostics v_updated = row_count;
  return v_updated;
end
$$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

create or replace function public.unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where n.store_id = (select public.current_store_id())
    and n.read_at is null
    and (
      n.user_id = (select auth.uid())
      or (
        n.user_id is null
        and n.target_role = (select public.current_user_role())
      )
    )
$$;

revoke all on function public.unread_notification_count() from public, anon;
grant execute on function public.unread_notification_count() to authenticated;

update public.app_schema_version
set version = 20261120120000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  store_id uuid not null references public.stores(store_id) on delete cascade,
  token text not null,
  platform text not null default 'android',
  updated_at timestamptz not null default now(),
  unique (token)
);

alter table public.device_tokens enable row level security;

drop policy if exists device_tokens_self on public.device_tokens;
create policy device_tokens_self on public.device_tokens for all to authenticated
  using (
    user_id = (select auth.uid())
    and store_id = (select public.current_store_id())
  )
  with check (
    user_id = (select auth.uid())
    and store_id = (select public.current_store_id())
  );

revoke all on public.device_tokens from anon;
grant select, insert, update, delete on public.device_tokens to authenticated;

notify pgrst, 'reload schema';
