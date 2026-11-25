grant select (avatar_id)
on table public.profiles
to authenticated;

update public.app_schema_version
set version = 20261125140000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
