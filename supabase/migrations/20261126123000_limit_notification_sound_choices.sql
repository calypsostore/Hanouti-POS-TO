alter table public.notification_sound_preferences
  drop constraint if exists notification_sound_preferences_general_sound_check,
  drop constraint if exists notification_sound_preferences_void_sound_check;

alter table public.notification_sound_preferences
  add constraint notification_sound_preferences_general_sound_check
    check (general_sound in ('alert1', 'alert4', 'alert5', 'alert6', 'alert7', 'alert8')),
  add constraint notification_sound_preferences_void_sound_check
    check (void_sound in ('alert1', 'alert4', 'alert5', 'alert6', 'alert7', 'alert8'));

update public.app_schema_version
set version = 20261126123000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
