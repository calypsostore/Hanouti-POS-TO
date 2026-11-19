create table public.app_schema_version (
  singleton boolean primary key default true check (singleton),
  version bigint not null check (version > 0),
  updated_at timestamptz not null default now()
);

alter table public.app_schema_version enable row level security;

create policy app_schema_version_read
  on public.app_schema_version
  for select
  to anon, authenticated
  using (singleton);

grant select on public.app_schema_version to anon, authenticated;

insert into public.app_schema_version (singleton, version)
values (true, 20261119134000)
on conflict (singleton) do update
set version = excluded.version,
    updated_at = now();

notify pgrst, 'reload schema';
