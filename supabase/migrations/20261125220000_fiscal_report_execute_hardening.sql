revoke all privileges on function public.get_fiscal_arbitrary_report(uuid, date, date, text)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.get_fiscal_arbitrary_report(uuid, date, date, text)
  to authenticated;

revoke all privileges on function public.save_fiscal_report_history(uuid, date, date, text, jsonb, jsonb)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.save_fiscal_report_history(uuid, date, date, text, jsonb, jsonb)
  to authenticated;

revoke all privileges on function public.list_fiscal_report_history(uuid)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.list_fiscal_report_history(uuid)
  to authenticated;

revoke all privileges on function public.get_fiscal_arbitrary_report_before_reconciliation(uuid, date, date, text)
  from PUBLIC, anon, authenticated, service_role;
revoke all privileges on function public.get_fiscal_arbitrary_report_before_item_link(uuid, date, date, text)
  from PUBLIC, anon, authenticated, service_role;

revoke all privileges on function public.is_store_owner(uuid)
  from PUBLIC, anon, authenticated, service_role;
grant execute on function public.is_store_owner(uuid)
  to authenticated;
