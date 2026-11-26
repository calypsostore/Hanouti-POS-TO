create table public.notification_sound_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  general_sound text not null default 'alert1'
    check (general_sound in ('alert1', 'alert2', 'alert3', 'alert4', 'alert5')),
  void_sound text not null default 'alert1'
    check (void_sound in ('alert1', 'alert2', 'alert3', 'alert4', 'alert5'))
);

alter table public.notification_sound_preferences enable row level security;

create policy notification_sound_preferences_self_read
  on public.notification_sound_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create policy notification_sound_preferences_self_insert
  on public.notification_sound_preferences for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy notification_sound_preferences_self_update
  on public.notification_sound_preferences for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.notification_sound_preferences to authenticated;

update public.app_schema_version
set version = 20261126103500,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
