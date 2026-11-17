-- Standalone fix for the existing security_invoker exchange_logs_view.
-- Allow login-free management to read every exchange, without granting history writes.
begin;
grant select on public.exchange_logs_view, public.point_history, public.profiles to anon, authenticated;
drop policy if exists exchange_history_management_read on public.point_history;
create policy exchange_history_management_read on public.point_history
  for select to anon, authenticated
  using (category = 'exchange' or points < 0);
notify pgrst, 'reload schema';
commit;
