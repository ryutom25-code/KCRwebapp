-- Apply as the database owner, before deploying the new frontend.
-- Assumes the existing tables/columns used by this repository; see supabase/README.md.
begin;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.qr_codes (
  code text primary key check (length(code) between 1 and 200 and code <> 'EXCHANGE_BOOTH'),
  category text not null check (category in ('welcome', 'event')),
  department_name text not null check (length(btrim(department_name)) > 0),
  points integer not null check (points > 0),
  active boolean not null default true
);
create table if not exists public.operation_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  operation text not null,
  target text not null,
  result jsonb not null,
  primary key (user_id, request_id)
);

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- Seed current printed department codes and their explicit welcome: aliases.
insert into public.qr_codes(code, category, department_name, points)
select prefix || dept.code, 'welcome', dept.name, 50
from (values ('PT','理学療法学科'), ('OT','作業療法学科'), ('Ns','看護学科'),
             ('CW','介護福祉学科'), ('IS','情報システム学科')) dept(code,name)
cross join (values (''), ('welcome:')) prefixes(prefix)
on conflict (code) do nothing;
insert into public.qr_codes(code, category, department_name, points)
values ('event:main','event','全体イベント',30) on conflict (code) do nothing;

-- Replace permissive policies on application-owned tables, then grant only needed operations.
do $$
declare t text; p record; c record;
begin
  foreach t in array array['profiles','point_history','checkins','products','events',
                           'quiz_sets','quizzes','quiz_answers','admin_users','qr_codes','operation_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    -- Column grants survive table-level REVOKE, so clear those as well.
    for c in select column_name from information_schema.columns where table_schema = 'public' and table_name = t loop
      execute format('revoke select (%I), insert (%I), update (%I), references (%I) on public.%I from public, anon, authenticated',
                     c.column_name, c.column_name, c.column_name, c.column_name, t);
    end loop;
  end loop;
end $$;

grant select on public.profiles, public.point_history, public.checkins, public.products,
                public.events, public.quiz_sets, public.quiz_answers, public.qr_codes to authenticated;
-- Do not expose correct_index to players; SELECT * intentionally is not permitted.
grant select (id, set_id, question, options, points) on public.quizzes to authenticated;
grant insert, update, delete on public.products, public.events, public.qr_codes to authenticated;
grant update, delete on public.checkins to authenticated;

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy history_read on public.point_history for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy checkins_read on public.checkins for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy answers_read on public.quiz_answers for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
create policy products_read on public.products for select to authenticated using (true);
create policy events_read on public.events for select to authenticated using (true);
create policy sets_read on public.quiz_sets for select to authenticated using (true);
create policy quizzes_read on public.quizzes for select to authenticated using (true);
create policy qr_admin_read on public.qr_codes for select to authenticated using ((select public.is_admin()));

-- Grant sequence usage only for directly inserted admin catalog tables, if serial IDs are used.
do $$
declare t text; v_sequence text;
begin
  foreach t in array array['products','events'] loop
    v_sequence := pg_get_serial_sequence('public.' || t, 'id');
    if v_sequence is not null then execute format('grant usage on sequence %s to authenticated',v_sequence); end if;
  end loop;
end $$;

-- Administrator writes are authorized in the database, not by page URLs.
do $$
declare t text;
begin
  foreach t in array array['products','events','qr_codes'] loop
    execute format('create policy admin_insert on public.%I for insert to authenticated with check ((select public.is_admin()))',t);
    execute format('create policy admin_update on public.%I for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',t);
    execute format('create policy admin_delete on public.%I for delete to authenticated using ((select public.is_admin()))',t);
  end loop;
end $$;
create policy checkins_admin_update on public.checkins for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy checkins_admin_delete on public.checkins for delete to authenticated using ((select public.is_admin()));

-- Every operation takes the profile row lock first, serializing changes per user.
-- A request key makes a retry idempotent without restricting repeated legitimate visits.
create or replace function public.record_checkin(p_code text, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_points integer; v_qr public.qr_codes%rowtype;
  v_previous public.operation_requests%rowtype; v_title text; v_result jsonb;
begin
  if v_user is null or p_request_id is null then raise exception 'ログインが必要です。'; end if;
  select coalesce(points,0) into v_points from public.profiles where id=v_user for update;
  if not found then raise exception '先にプロフィールを登録してください。'; end if;
  select * into v_previous from public.operation_requests where user_id=v_user and request_id=p_request_id;
  if found then
    if v_previous.operation <> 'checkin' or v_previous.target <> p_code then raise exception 'リクエストが一致しません。'; end if;
    return v_previous.result;
  end if;
  select * into v_qr from public.qr_codes where code=p_code and active for share;
  if not found then raise exception '登録済みの来校・イベントQRコードを読み取ってください。'; end if;
  v_title := case when v_qr.category='event' then 'イベント参加 (' || v_qr.department_name || ')'
                  else v_qr.department_name || ' 来校ポイント' end;
  insert into public.checkins(user_id, booth_id) values(v_user,p_code);
  update public.profiles set points=v_points+v_qr.points where id=v_user;
  insert into public.point_history(user_id,title,category,department_name,points)
    values(v_user,v_title,v_qr.category,v_qr.department_name,v_qr.points);
  v_result := jsonb_build_object('newPoints',v_points+v_qr.points,'earnedPoints',v_qr.points,'historyTitle',v_title);
  insert into public.operation_requests values(v_user,p_request_id,'checkin',p_code,v_result);
  return v_result;
end $$;

create or replace function public.exchange_product(p_product_id text, p_code text, p_request_id uuid, p_expected_points integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_points integer; v_product public.products%rowtype;
  v_previous public.operation_requests%rowtype; v_result jsonb;
begin
  if v_user is null or p_request_id is null then raise exception 'ログインが必要です。'; end if;
  if p_code is distinct from 'EXCHANGE_BOOTH' then raise exception '交換ブースのQRコードが必要です。'; end if;
  select coalesce(points,0) into v_points from public.profiles where id=v_user for update;
  if not found then raise exception '先にプロフィールを登録してください。'; end if;
  select * into v_previous from public.operation_requests where user_id=v_user and request_id=p_request_id;
  if found then
    if v_previous.operation <> 'exchange' or v_previous.target <> p_product_id then raise exception 'リクエストが一致しません。'; end if;
    return v_previous.result;
  end if;
  select * into v_product from public.products where id::text=p_product_id for share;
  if not found then raise exception 'この景品は交換できません。'; end if;
  if v_product.points is null or v_product.points <= 0 then raise exception '景品のポイント設定が不正です。'; end if;
  if p_expected_points is distinct from v_product.points then raise exception '必要ポイントが変更されました。景品一覧を再読み込みしてください。'; end if;
  if v_points < v_product.points then raise exception 'ポイントが足りません。'; end if;
  update public.profiles set points=v_points-v_product.points where id=v_user;
  insert into public.point_history(user_id,title,category,points)
    values(v_user,'景品交換: ' || v_product.name,'exchange',-v_product.points);
  v_result := jsonb_build_object('newPoints',v_points-v_product.points,'productName',v_product.name);
  insert into public.operation_requests values(v_user,p_request_id,'exchange',p_product_id,v_result);
  return v_result;
end $$;

create or replace function public.answer_quiz(p_quiz_id text, p_selected_index integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_points integer; v_quiz public.quizzes%rowtype; v_department text;
begin
  if v_user is null then raise exception 'ログインが必要です。'; end if;
  if p_selected_index is null or p_selected_index not between 0 and 3 then raise exception '解答が不正です。'; end if;
  select coalesce(points,0) into v_points from public.profiles where id=v_user for update;
  if not found then raise exception '先にプロフィールを登録してください。'; end if;
  select * into v_quiz from public.quizzes where id::text=p_quiz_id for share;
  if not found then raise exception '問題が見つかりません。'; end if;
  if exists(select 1 from public.quiz_answers where user_id=v_user and quiz_id=v_quiz.id and is_correct) then
    return jsonb_build_object('isCorrect',true,'alreadyAnswered',true,'earnedPoints',0,'newPoints',v_points);
  end if;
  if p_selected_index is distinct from v_quiz.correct_index then return jsonb_build_object('isCorrect',false); end if;
  if v_quiz.points is null or v_quiz.points <= 0 then raise exception '問題のポイント設定が不正です。'; end if;
  select department into v_department from public.quiz_sets where id=v_quiz.set_id;
  v_department := case v_department when 'PT' then '理学療法学科' when 'OT' then '作業療法学科'
    when 'Ns' then '看護学科' when 'CW' then '介護福祉学科' when 'IS' then '情報システム学科' else v_department end;
  insert into public.quiz_answers(user_id,set_id,quiz_id,is_correct) values(v_user,v_quiz.set_id,v_quiz.id,true);
  update public.profiles set points=v_points+v_quiz.points where id=v_user;
  insert into public.point_history(user_id,title,category,points)
    values(v_user,v_department || ' クイズ正解','quiz',v_quiz.points);
  return jsonb_build_object('isCorrect',true,'alreadyAnswered',false,'earnedPoints',v_quiz.points,'newPoints',v_points+v_quiz.points);
end $$;

create or replace function public.create_quiz_set(p_department text, p_title text, p_quizzes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_set public.quiz_sets.id%type; v_item jsonb; v_options public.quizzes.options%type;
begin
  if not public.is_admin() then raise exception '管理者権限が必要です。'; end if;
  if p_department is null or p_department not in ('PT','OT','Ns','CW','IS') or coalesce(length(btrim(p_title)),0)=0 then
    raise exception '学科とタイトルを指定してください。';
  end if;
  if jsonb_typeof(p_quizzes) is distinct from 'array' then raise exception '問題を4問指定してください。'; end if;
  if jsonb_array_length(p_quizzes) <> 4 then raise exception '問題を4問指定してください。'; end if;
  insert into public.quiz_sets(department,title) values(p_department,btrim(p_title)) returning id into v_set;
  for v_item in select value from jsonb_array_elements(p_quizzes) loop
    if coalesce(length(btrim(v_item->>'question')),0)=0 or jsonb_typeof(v_item->'options') is distinct from 'array' then
      raise exception '問題文と4つの選択肢が必要です。';
    end if;
    if jsonb_array_length(v_item->'options') <> 4 or
       exists(select 1 from jsonb_array_elements(v_item->'options') o(value)
              where jsonb_typeof(value) <> 'string' or length(btrim(value #>> '{}'))=0) or
       (v_item->>'correct_index') is null or (v_item->>'correct_index') !~ '^[0-3]$' then
      raise exception '選択肢または正解の設定が不正です。';
    end if;
    -- Supports the existing options column whether it is text[], json or jsonb.
    select options into v_options from jsonb_populate_record(null::public.quizzes,v_item);
    insert into public.quizzes(set_id,question,options,correct_index,points)
      values(v_set,btrim(v_item->>'question'),v_options,(v_item->>'correct_index')::integer,10);
  end loop;
  return jsonb_build_object('id',v_set);
end $$;

create or replace function public.save_profile(p_name text, p_school_name text, p_grade text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ログインが必要です。'; end if;
  if coalesce(length(btrim(p_name)),0)=0 or coalesce(length(btrim(p_school_name)),0)=0 or
     p_grade is null or p_grade not in ('1','2','3','既卒生') then raise exception 'プロフィールを入力してください。'; end if;
  insert into public.profiles(id,name,school_name,grade,points)
    values(auth.uid(),btrim(p_name),btrim(p_school_name),p_grade,0)
  on conflict(id) do update set name=excluded.name,school_name=excluded.school_name,grade=excluded.grade;
end $$;

-- Explicitly remove default PUBLIC execute permissions on SECURITY DEFINER functions.
revoke all on function public.is_admin() from public, anon;
revoke all on function public.record_checkin(text,uuid) from public, anon;
revoke all on function public.exchange_product(text,text,uuid,integer) from public, anon;
revoke all on function public.answer_quiz(text,integer) from public, anon;
revoke all on function public.create_quiz_set(text,text,jsonb) from public, anon;
revoke all on function public.save_profile(text,text,text) from public, anon;
grant execute on function public.is_admin(), public.record_checkin(text,uuid),
  public.exchange_product(text,text,uuid,integer), public.answer_quiz(text,integer),
  public.create_quiz_set(text,text,jsonb), public.save_profile(text,text,text) to authenticated;

-- Additional restrictive policies keep old Storage policies from granting non-admin writes.
-- Bucket-scoped: permissions on unrelated buckets are unchanged.
create policy product_images_insert_guard on storage.objects as restrictive for insert to authenticated
  with check (bucket_id <> 'product-images' or (select public.is_admin()));
create policy product_images_update_guard on storage.objects as restrictive for update to authenticated
  using (bucket_id <> 'product-images' or (select public.is_admin()))
  with check (bucket_id <> 'product-images' or (select public.is_admin()));
create policy product_images_delete_guard on storage.objects as restrictive for delete to authenticated
  using (bucket_id <> 'product-images' or (select public.is_admin()));
create policy product_images_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id='product-images' and (select public.is_admin()));
create policy product_images_admin_select on storage.objects for select to authenticated
  using (bucket_id='product-images' and (select public.is_admin()));
-- anon may inherit existing permissive storage policies, so explicitly block writes.
create policy product_images_anon_insert_guard on storage.objects as restrictive for insert to anon
  with check (bucket_id <> 'product-images');
create policy product_images_anon_update_guard on storage.objects as restrictive for update to anon
  using (bucket_id <> 'product-images') with check (bucket_id <> 'product-images');
create policy product_images_anon_delete_guard on storage.objects as restrictive for delete to anon
  using (bucket_id <> 'product-images');

notify pgrst, 'reload schema';
commit;
