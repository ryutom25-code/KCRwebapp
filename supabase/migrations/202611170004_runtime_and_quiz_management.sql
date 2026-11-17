-- Standalone installation of the UI's missing tables and RPCs.
-- Does not replace existing policies on participant tables.
-- Management remains intentionally login-free, as requested.
begin;
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


alter table public.qr_codes enable row level security;
alter table public.operation_requests enable row level security;
revoke all on public.operation_requests from public,anon,authenticated;
grant select,insert,update,delete on public.qr_codes to anon,authenticated;
drop policy if exists qr_management on public.qr_codes;
create policy qr_management on public.qr_codes for all to anon,authenticated using(true) with check(true);
-- Seed current printed department codes and their explicit welcome: aliases.
insert into public.qr_codes(code, category, department_name, points)
select prefix || dept.code, 'welcome', dept.name, 50
from (values ('PT','理学療法学科'), ('OT','作業療法学科'), ('Ns','看護学科'),
             ('CW','介護福祉学科'), ('IS','情報システム学科')) dept(code,name)
cross join (values (''), ('welcome:')) prefixes(prefix)
on conflict (code) do nothing;
insert into public.qr_codes(code, category, department_name, points)
values ('event:main','event','全体イベント',30) on conflict (code) do nothing;

-- The app intentionally allows repeated visits; preserve a log for every scan.
alter table public.checkins drop constraint if exists checkins_user_id_booth_id_key;
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
  update public.quiz_answers set is_correct=true,set_id=v_quiz.set_id where user_id=v_user and quiz_id=v_quiz.id;
  if not found then
    insert into public.quiz_answers(user_id,set_id,quiz_id,is_correct) values(v_user,v_quiz.set_id,v_quiz.id,true);
  end if;
  update public.profiles set points=v_points+v_quiz.points where id=v_user;
  insert into public.point_history(user_id,title,category,points)
    values(v_user,v_department || ' クイズ正解','quiz',v_quiz.points);
  return jsonb_build_object('isCorrect',true,'alreadyAnswered',false,'earnedPoints',v_quiz.points,'newPoints',v_points+v_quiz.points);
end $$;

create or replace function public.create_quiz_set(p_department text, p_title text, p_quizzes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_set public.quiz_sets.id%type; v_item jsonb; v_options public.quizzes.options%type;
begin
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


create or replace function public.get_quiz_management()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object('quizzes',
   (select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]'::jsonb) from public.quizzes q where q.set_id=s.id))
   order by s.created_at desc,s.id),'[]'::jsonb) from public.quiz_sets s;
$$;
create or replace function public.update_quiz(p_quiz_id text,p_question text,p_options jsonb,p_correct_index integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_options public.quizzes.options%type;
begin
 if coalesce(length(btrim(p_question)),0)=0 or jsonb_typeof(p_options) is distinct from 'array' then raise exception '問題文と選択肢を入力してください。'; end if;
 if jsonb_array_length(p_options)<>4 or p_correct_index is null or p_correct_index not between 0 and 3 or
   exists(select 1 from jsonb_array_elements(p_options) o(v) where jsonb_typeof(v)<>'string' or length(btrim(v#>>'{}'))=0)
   then raise exception '4つの選択肢と正解を指定してください。'; end if;
 select options into v_options from jsonb_populate_record(null::public.quizzes,jsonb_build_object('options',p_options));
 update public.quizzes set question=btrim(p_question),options=v_options,correct_index=p_correct_index where id::text=p_quiz_id;
 if not found then raise exception '問題が見つかりません。'; end if;
end $$;
create or replace function public.update_quiz_set(p_set_id text,p_title text,p_department text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(length(btrim(p_title)),0)=0 or p_department is null or p_department not in ('PT','OT','Ns','CW','IS') then raise exception 'タイトルと学科を指定してください。'; end if;
 update public.quiz_sets set title=btrim(p_title),department=p_department where id::text=p_set_id;
 if not found then raise exception 'セットが見つかりません。'; end if;
end $$;
create or replace function public.delete_quiz(p_quiz_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.quizzes where id::text=p_quiz_id for update;
 if not found then raise exception '問題が見つかりません。'; end if;
 delete from public.quiz_answers where quiz_id::text=p_quiz_id;
 delete from public.quizzes where id::text=p_quiz_id;
end $$;
create or replace function public.delete_quiz_set(p_set_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.quiz_sets where id::text=p_set_id for update;
 if not found then raise exception 'セットが見つかりません。'; end if;
 perform 1 from public.quizzes where set_id::text=p_set_id for update;
 delete from public.quiz_answers where set_id::text=p_set_id or quiz_id in(select id from public.quizzes where set_id::text=p_set_id);
 delete from public.quizzes where set_id::text=p_set_id;
 delete from public.quiz_sets where id::text=p_set_id;
end $$;
revoke all on function public.record_checkin(text,uuid) from public,anon;
grant execute on function public.record_checkin(text,uuid) to authenticated;
revoke all on function public.exchange_product(text,text,uuid,integer) from public,anon;
grant execute on function public.exchange_product(text,text,uuid,integer) to authenticated;
revoke all on function public.answer_quiz(text,integer) from public,anon;
grant execute on function public.answer_quiz(text,integer) to authenticated;
revoke all on function public.save_profile(text,text,text) from public,anon;
grant execute on function public.save_profile(text,text,text) to authenticated;
revoke all on function public.create_quiz_set(text,text,jsonb) from public;
grant execute on function public.create_quiz_set(text,text,jsonb) to anon,authenticated;
revoke all on function public.get_quiz_management() from public;
grant execute on function public.get_quiz_management() to anon,authenticated;
revoke all on function public.update_quiz(text,text,jsonb,integer) from public;
grant execute on function public.update_quiz(text,text,jsonb,integer) to anon,authenticated;
revoke all on function public.update_quiz_set(text,text,text) from public;
grant execute on function public.update_quiz_set(text,text,text) to anon,authenticated;
revoke all on function public.delete_quiz(text) from public;
grant execute on function public.delete_quiz(text) to anon,authenticated;
revoke all on function public.delete_quiz_set(text) from public;
grant execute on function public.delete_quiz_set(text) to anon,authenticated;

-- Normalize system department labels, retaining all history and balances.
update public.point_history set title=replace(title,'情報処理学科','情報システム学科'),
 department_name=replace(department_name,'情報処理学科','情報システム学科')
 where title like '%情報処理学科%' or department_name like '%情報処理学科%';
update public.events set title=replace(title,'情報処理学科','情報システム学科') where title like '%情報処理学科%';
update public.products set name=replace(name,'情報処理学科','情報システム学科') where name like '%情報処理学科%';
update public.quiz_sets set title=replace(title,'情報処理学科','情報システム学科') where title like '%情報処理学科%';
update public.qr_codes set department_name=replace(department_name,'情報処理学科','情報システム学科') where department_name like '%情報処理学科%';
do $$
declare r record; v_options public.quizzes.options%type; v_json jsonb;
begin
 for r in select id,options from public.quizzes where question like '%情報処理学科%' or options::text like '%情報処理学科%' loop
  select jsonb_agg(to_jsonb(replace(v#>>'{}','情報処理学科','情報システム学科')) order by n) into v_json
   from jsonb_array_elements(to_jsonb(r.options)) with ordinality as t(v,n);
  select options into v_options from jsonb_populate_record(null::public.quizzes,jsonb_build_object('options',v_json));
  update public.quizzes set question=replace(question,'情報処理学科','情報システム学科'),options=v_options where id=r.id;
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
