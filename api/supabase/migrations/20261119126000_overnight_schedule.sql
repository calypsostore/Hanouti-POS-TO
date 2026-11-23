alter table public.schedule_shifts
  drop constraint if exists schedule_shifts_check;
alter table public.schedule_shifts
  add constraint schedule_shifts_nonzero_duration check (end_time <> start_time);

alter table public.schedule_templates
  drop constraint if exists schedule_templates_check;
alter table public.schedule_templates
  add constraint schedule_templates_nonzero_duration check (end_time <> start_time);
