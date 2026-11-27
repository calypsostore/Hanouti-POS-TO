do $$
declare
  definition text;
  original text;
begin
  definition := pg_get_functiondef('public.record_report(jsonb,text)'::regprocedure);
  original := 'nullif(btrim(p_report->>''cashDifferenceNote''), '''') is null';
  if position(original in definition) = 0 then
    raise exception 'Could not locate Z-report required-note validation.';
  end if;
  definition := replace(definition, original, 'false');

  original := 'Z counts are incomplete, require a note, or do not reconcile with the server ledger.';
  if position(original in definition) = 0 then
    raise exception 'Could not locate Z-report validation message.';
  end if;
  definition := replace(definition, original, 'Z counts are incomplete or do not reconcile with the server ledger.');

  execute definition;
end
$$;
