-- Apply after the public exchange view has been anonymized.
begin;

-- Keep the public exchange view anonymous. Staff get a separate view.
create or replace view public.staff_exchange_logs
with (security_invoker = true) as
select
  h.id,
  h.created_at,
  h.title as product_name,
  h.points,
  p.name as user_name,
  p.school_name,
  p.grade
from public.point_history h
left join public.profiles p on p.id = h.user_id
where h.category = 'exchange' or h.points < 0;

revoke all on public.staff_exchange_logs from public, anon, authenticated;
grant select on public.staff_exchange_logs to service_role;

do $$
begin
  if has_any_column_privilege('anon', 'public.staff_exchange_logs', 'SELECT')
    or has_any_column_privilege('authenticated', 'public.staff_exchange_logs', 'SELECT') then
    raise exception 'Staff exchange history must not be readable by browser roles';
  end if;
end $$;

-- Verify the service role can read the view before publishing it.
set local role service_role;
select id, user_name, school_name, grade
from public.staff_exchange_logs
limit 0;
reset role;

notify pgrst, 'reload schema';
commit;
