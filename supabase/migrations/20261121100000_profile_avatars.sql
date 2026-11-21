alter table public.profiles
  add column avatar_id text not null default 'avatar-1',
  add constraint profiles_avatar_id_check
    check (avatar_id in ('avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6'));

create or replace function public.update_profile_avatar(p_avatar_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile public.profiles%rowtype;
begin
  if p_avatar_id is null or p_avatar_id not in ('avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6') then
    raise exception 'Choose one of the available profile avatars.';
  end if;

  select * into current_profile
  from public.profiles
  where id = (select auth.uid())
    and is_active
  for update;

  if not found then
    raise exception 'An active signed-in profile is required to update the avatar.' using errcode = '42501';
  end if;

  update public.profiles
  set avatar_id = p_avatar_id
  where id = current_profile.id;
end
$$;

revoke all on function public.update_profile_avatar(text) from public, anon;
grant execute on function public.update_profile_avatar(text) to authenticated;

update public.app_schema_version
set version = 20261121100000,
    updated_at = now()
where singleton;
