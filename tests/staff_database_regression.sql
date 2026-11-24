-- Run in a disposable database after database_fixture.sql (with __OPTIONS_TYPE__ replaced),
-- 202611170004, 202611170005 and 202611240001 through 202611240003. The fixture must provide
-- service_role with BYPASSRLS, USAGE on public and SELECT on profiles and point_history.
begin;

insert into auth.users values
  ('00000000-0000-4000-8000-000000000001', 'one@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'two@example.test');
insert into public.profiles (id, name, school_name, grade, points) values
  ('00000000-0000-4000-8000-000000000001', 'テスト一', '東高校', '1', 500),
  ('00000000-0000-4000-8000-000000000002', 'テスト二', '西高校', '2', 500);
insert into public.point_history(user_id,title,category,points) values
  ('00000000-0000-4000-8000-000000000001','景品交換: 景品A','exchange',-100),
  ('00000000-0000-4000-8000-000000000002','景品交換: 景品B','exchange',-100);

set local role anon;
do $$
begin
  assert (select count(*) from public.exchange_logs_view) = 2;
  assert not exists (select 1 from public.exchange_logs_view where
    user_id is not null or user_name is not null or school_name is not null or grade is not null);
  assert not has_table_privilege(current_user, 'public.staff_exchange_logs', 'SELECT');
  assert not has_table_privilege(current_user, 'public.profiles', 'SELECT');
  assert not has_table_privilege(current_user, 'public.checkins', 'SELECT');
  assert not has_table_privilege(current_user, 'public.qr_codes', 'INSERT');
  assert not has_function_privilege(current_user, 'public.get_quiz_management()', 'EXECUTE');
  begin
    insert into storage.objects(bucket_id,name) values ('product-images','test.jpg');
    raise exception 'Anonymous upload unexpectedly allowed';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$
begin
  assert (select array_agg(name) from public.profiles) = array['テスト一'];
  assert (select array_agg(title) from public.point_history) = array['景品交換: 景品A'];
  assert not has_table_privilege(current_user, 'public.staff_exchange_logs', 'SELECT');
  assert not has_column_privilege(current_user, 'public.quizzes', 'correct_index', 'SELECT');
  assert not has_column_privilege(current_user, 'public.profiles', 'points', 'UPDATE');
  assert not has_table_privilege(current_user, 'public.products', 'DELETE');
  assert not has_function_privilege(current_user, 'public.get_quiz_management()', 'EXECUTE');
  perform public.save_profile('テスト更新', '東高校', '3');
  perform public.record_checkin('PT','00000000-0000-4000-8000-000000000010');
  assert (select points from public.profiles) = 550;
end $$;
reset role;

set local role service_role;
do $$
begin
  assert (select array_agg(user_name order by id) from public.staff_exchange_logs) = array['テスト更新','テスト二'];
  assert (select array_agg(school_name order by id) from public.staff_exchange_logs) = array['東高校','西高校'];
  assert (select array_agg(grade order by id) from public.staff_exchange_logs) = array['3','2'];
  assert (select count(*) from public.checkins) = 1;
  insert into public.products(name,points) values ('景品A',50);
  insert into public.qr_codes(code,category,department_name,points) values ('event:test','event','テスト',30);
  assert public.get_quiz_management() = '[]'::jsonb;
end $$;
reset role;

set local role authenticated;
do $$
declare product_id text;
begin
  select id::text into strict product_id from public.products where name = '景品A';
  perform public.exchange_product(product_id,'EXCHANGE_BOOTH','00000000-0000-4000-8000-000000000011',50);
  assert (select points from public.profiles) = 500;
  assert (select count(*) from public.point_history where category = 'exchange') = 2;
end $$;
rollback;
