-- Preserve the view's existing column types for deployed clients, while
-- removing participant data and links to profiles from the public report.
begin;

create or replace view public.exchange_logs_view
with (security_invoker = false, security_barrier = true) as
select
  p.id,
  null::uuid as user_id,
  p.created_at,
  p.title as product_name,
  p.points,
  null::text as user_name,
  null::text as school_name,
  null::text as grade
from public.point_history p
where p.category = 'exchange' or p.points < 0;

revoke all on public.exchange_logs_view from public, anon, authenticated;
grant select on public.exchange_logs_view to anon, authenticated;

-- Direct reads of exchange rows must be limited to their owner. The
-- restrictive rule also covers environments with other permissive policies.
drop policy if exists exchange_history_management_read on public.point_history;
drop policy if exists exchange_history_own_read_guard on public.point_history;
create policy exchange_history_own_read_guard on public.point_history
  as restrictive for select to anon, authenticated
  using (
    (category is distinct from 'exchange' and (points < 0) is not true)
    or user_id = (select auth.uid())
  );

notify pgrst, 'reload schema';
commit;
