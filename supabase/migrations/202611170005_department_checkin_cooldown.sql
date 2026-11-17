-- One successful welcome award per user and department in a rolling 60 minutes.
-- Event QR rules and prize exchanges are unchanged.
begin;
create index if not exists checkins_department_cooldown_idx on public.checkins(user_id,booth_id,created_at desc);
create index if not exists history_department_cooldown_idx on public.point_history(user_id,category,department_name,created_at desc);
create or replace function public.record_checkin(p_code text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=auth.uid(); v_points integer; v_qr public.qr_codes%rowtype;
 v_previous public.operation_requests%rowtype; v_title text; v_result jsonb;
 v_last timestamptz; v_now timestamptz; v_next timestamptz;
begin
 if v_user is null or p_request_id is null then raise exception 'ログインが必要です。'; end if;
 -- Serialize every point operation for this user, including concurrent tabs.
 select coalesce(points,0) into v_points from public.profiles where id=v_user for update;
 if not found then raise exception '先にプロフィールを登録してください。'; end if;
 select * into v_previous from public.operation_requests where user_id=v_user and request_id=p_request_id;
 if found then
  if v_previous.operation<>'checkin' or v_previous.target<>p_code then raise exception 'リクエストが一致しません。'; end if;
  return v_previous.result;
 end if;
 select * into v_qr from public.qr_codes where code=p_code and active for share;
 if not found then raise exception '登録済みの来校・イベントQRコードを読み取ってください。'; end if;
 v_now:=clock_timestamp();
 if v_qr.category='welcome' then
  -- IS and welcome:IS share a department, as do other registered aliases.
  -- Award history also protects against edits/deletion of a checkin log.
  select max(log.created_at) into v_last from (
   select c.created_at from public.checkins c join public.qr_codes q on q.code=c.booth_id
    where c.user_id=v_user and q.category='welcome' and q.department_name=v_qr.department_name
   union all
   select h.created_at from public.point_history h where h.user_id=v_user and h.category='welcome'
    and (h.department_name=v_qr.department_name or h.title=v_qr.department_name||' 来校ポイント')
  ) log;
  v_next:=v_last+interval '60 minutes';
  if v_next>v_now then
   return jsonb_build_object('cooldown',true,'nextAllowedAt',v_next,'departmentName',v_qr.department_name,'earnedPoints',0,'newPoints',v_points);
  end if;
  v_next:=v_now+interval '60 minutes';
 end if;
 v_title:=case when v_qr.category='event' then 'イベント参加 ('||v_qr.department_name||')' else v_qr.department_name||' 来校ポイント' end;
 insert into public.checkins(user_id,booth_id,created_at)values(v_user,p_code,v_now);
 update public.profiles set points=v_points+v_qr.points where id=v_user;
 insert into public.point_history(user_id,title,category,department_name,points,created_at)
  values(v_user,v_title,v_qr.category,v_qr.department_name,v_qr.points,v_now);
 v_result:=jsonb_build_object('cooldown',false,'nextAllowedAt',v_next,'departmentName',v_qr.department_name,'newPoints',v_points+v_qr.points,'earnedPoints',v_qr.points,'historyTitle',v_title);
 insert into public.operation_requests values(v_user,p_request_id,'checkin',p_code,v_result);
 return v_result;
end $$;
revoke all on function public.record_checkin(text,uuid) from public,anon;
grant execute on function public.record_checkin(text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
