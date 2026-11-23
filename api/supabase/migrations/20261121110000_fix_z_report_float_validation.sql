do $$
declare
  function_definition text;
  patched_definition text;
begin
  function_definition := pg_get_functiondef('public.record_report(jsonb,text)'::regprocedure);
  if position($check$p_report->>'countedCashIncludesFloat' is distinct from 'true'$check$ in function_definition) = 0
    or position($check$cash_difference is distinct from counted_cash - server_expected_cash$check$ in function_definition) = 0
    or position($check$'{countedCashIncludesFloat}', 'true'::jsonb$check$ in function_definition) = 0
    or position($check$'{cashDifferenceMillimes}', to_jsonb(cash_difference), true)$check$ in function_definition) = 0 then
    raise exception 'record_report no longer matches the expected Z cash-count validation.';
  end if;

  patched_definition := replace(
    function_definition,
    $old$p_report->>'countedCashIncludesFloat' is distinct from 'true'$old$,
    $new$p_report->>'countedCashIncludesFloat' is distinct from 'false'$new$
  );
  patched_definition := replace(
    patched_definition,
    $old$cash_difference is distinct from counted_cash - server_expected_cash$old$,
    $new$cash_difference is distinct from counted_cash - expected_cash_ex_float$new$
  );
  patched_definition := replace(
    patched_definition,
    $old$'{countedCashIncludesFloat}', 'true'::jsonb$old$,
    $new$'{countedCashIncludesFloat}', 'false'::jsonb$new$
  );
  patched_definition := replace(
    patched_definition,
    $old$report_data := jsonb_set(report_data, '{cashDifferenceMillimes}', to_jsonb(cash_difference), true);$old$,
    $new$report_data := jsonb_set(report_data, '{cashDifferenceMillimes}', to_jsonb(cash_difference), true);
    report_data := jsonb_set(report_data, '{cashDifference}', to_jsonb(cash_difference), true);$new$
  );

  execute patched_definition;
end
$$;

update public.app_schema_version
set version = 20261121110000,
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
