-- Apply when cutting management over to Node.js, after the staff exchange view migration.
begin;

grant select on public.exchange_logs_view to service_role;

-- Remove old direct grants, including column grants that can survive table-level revocation.
do $$
declare t text; c record; seq text;
begin
  foreach t in array array['profiles','point_history','checkins','products','events','qr_codes','quiz_sets','quizzes','quiz_answers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    for c in select column_name from information_schema.columns where table_schema = 'public' and table_name = t loop
      execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on public.%2$I from public, anon, authenticated',
                     c.column_name, t);
    end loop;
  end loop;
  foreach t in array array['products','events'] loop
    seq := pg_get_serial_sequence('public.' || t, 'id');
    if seq is not null then
      execute format('revoke all on sequence %s from public, anon, authenticated', seq);
      execute format('grant usage on sequence %s to service_role', seq);
    end if;
  end loop;
  if to_regclass('public.checkin_logs_view') is not null then
    execute 'revoke all on public.checkin_logs_view from public, anon, authenticated';
    for c in select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'checkin_logs_view'
    loop
      execute format('revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on public.checkin_logs_view from public, anon, authenticated',
                     c.column_name);
    end loop;
  end if;
end $$;

grant select on public.profiles, public.point_history, public.products, public.events, public.quiz_sets, public.quiz_answers to authenticated;
grant select (id, set_id, question, options, points) on public.quizzes to authenticated;
grant select on public.profiles, public.point_history, public.checkins, public.products, public.events, public.qr_codes to service_role;
grant insert, update on public.qr_codes to service_role;
grant insert, update, delete on public.products, public.events to service_role;
grant update, delete on public.checkins to service_role;

-- Restrictive rules also apply where an old permissive policy still exists.
create policy staff_backend_own_profile on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy staff_backend_profile_guard on public.profiles as restrictive for select to authenticated
  using (id = (select auth.uid()));
create policy staff_backend_own_points on public.point_history for select to authenticated
  using (user_id = (select auth.uid()));
create policy staff_backend_points_guard on public.point_history as restrictive for select to authenticated
  using (user_id = (select auth.uid()));
create policy staff_backend_own_answers on public.quiz_answers for select to authenticated
  using (user_id = (select auth.uid()));
create policy staff_backend_answers_guard on public.quiz_answers as restrictive for select to authenticated
  using (user_id = (select auth.uid()));

create policy staff_backend_products_read on public.products for select to authenticated using (true);
create policy staff_backend_events_read on public.events for select to authenticated using (true);
create policy staff_backend_quiz_sets_read on public.quiz_sets for select to authenticated using (true);
create policy staff_backend_quizzes_read on public.quizzes for select to authenticated using (true);

revoke execute on function
  public.create_quiz_set(text,text,jsonb), public.get_quiz_management(),
  public.update_quiz(text,text,jsonb,integer), public.update_quiz_set(text,text,text),
  public.delete_quiz(text), public.delete_quiz_set(text)
from public, anon, authenticated;

grant execute on function
  public.create_quiz_set(text,text,jsonb), public.get_quiz_management(),
  public.update_quiz(text,text,jsonb,integer), public.update_quiz_set(text,text,text),
  public.delete_quiz(text), public.delete_quiz_set(text)
to service_role;

create policy staff_backend_images_insert_guard on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'product-images');
create policy staff_backend_images_update_guard on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'product-images') with check (bucket_id <> 'product-images');
create policy staff_backend_images_delete_guard on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'product-images');

notify pgrst, 'reload schema';
commit;
