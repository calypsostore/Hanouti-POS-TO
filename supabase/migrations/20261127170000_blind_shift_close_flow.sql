create or replace function public.close_shift(
  p_shift_id uuid,
  p_counted_cash_millimes bigint,
  p_difference_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  target public.shifts%rowtype;
  blind boolean := false;
  blind_staff boolean := false;
  close_note text;
begin
  select shift.* into target
  from public.shifts shift
  where shift.id = p_shift_id;

  if found then
    select coalesce((setting.settings->>'blindShiftClosing')::boolean, false)
    into blind
    from public.store_settings setting
    where setting.store_id = target.store_id;
  end if;

  blind_staff := coalesce(blind, false)
    and (select auth.uid()) = target.staff_id
    and not public.is_store_owner(target.store_id);
  close_note := p_difference_note;
  if blind_staff then
    close_note := coalesce(nullif(btrim(p_difference_note), ''), 'Blind close; count submitted without review.');
  end if;

  payload := public.close_shift_blind_legacy(
    p_shift_id,
    p_counted_cash_millimes,
    close_note
  );

  if blind_staff then
    payload := jsonb_set(payload, '{shift,expected_cash_millimes}', 'null'::jsonb, true);
    payload := jsonb_set(payload, '{shift,difference_millimes}', 'null'::jsonb, true);
    payload := jsonb_set(payload, '{shift,difference_note}', 'null'::jsonb, true);
  end if;
  return payload;
end
$$;

revoke all on function public.close_shift(uuid,bigint,text) from public, anon;
grant execute on function public.close_shift(uuid,bigint,text) to authenticated;
revoke all on function public.close_shift_blind_legacy(uuid,bigint,text) from public, anon, authenticated;
revoke all on function public.get_shift_summary_blind_legacy(uuid) from public, anon, authenticated;
