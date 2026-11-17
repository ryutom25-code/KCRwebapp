-- Login-free management, as requested. Apply AFTER 202611170001.
-- Both anonymous visitors and signed-in users can read management data and edit catalogs.
-- User point mutations remain authenticated transactional RPCs.
begin;

grant select on public.profiles, public.point_history, public.checkins,
                public.products, public.events, public.quiz_sets, public.qr_codes to anon, authenticated;
grant insert, update, delete on public.products, public.events, public.qr_codes to anon, authenticated;
grant update, delete on public.checkins to anon, authenticated;

do $$
declare t text; p record; v_sequence text;
begin
  foreach t in array array['profiles','point_history','checkins','products','events','quiz_sets','qr_codes'] loop
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
    execute format('create policy management_read on public.%I for select to anon, authenticated using (true)',t);
  end loop;
  foreach t in array array['products','events','qr_codes'] loop
    execute format('create policy management_insert on public.%I for insert to anon, authenticated with check (true)',t);
    execute format('create policy management_update on public.%I for update to anon, authenticated using (true) with check (true)',t);
    execute format('create policy management_delete on public.%I for delete to anon, authenticated using (true)',t);
  end loop;
  foreach t in array array['products','events'] loop
    v_sequence := pg_get_serial_sequence('public.' || t,'id');
    if v_sequence is not null then execute format('grant usage on sequence %s to anon, authenticated',v_sequence); end if;
  end loop;
end $$;
create policy management_update on public.checkins for update to anon, authenticated using (true) with check (true);
create policy management_delete on public.checkins for delete to anon, authenticated using (true);

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

revoke all on function public.create_quiz_set(text,text,jsonb) from public;
grant execute on function public.create_quiz_set(text,text,jsonb) to anon, authenticated;

-- Remove the guards introduced by the prior migration for this bucket only.
drop policy if exists product_images_insert_guard on storage.objects;
drop policy if exists product_images_update_guard on storage.objects;
drop policy if exists product_images_delete_guard on storage.objects;
drop policy if exists product_images_admin_insert on storage.objects;
drop policy if exists product_images_admin_select on storage.objects;
drop policy if exists product_images_anon_insert_guard on storage.objects;
drop policy if exists product_images_anon_update_guard on storage.objects;
drop policy if exists product_images_anon_delete_guard on storage.objects;
create policy product_images_management_select on storage.objects for select to anon, authenticated
  using (bucket_id='product-images');
create policy product_images_management_insert on storage.objects for insert to anon, authenticated
  with check (bucket_id='product-images');
create policy product_images_management_update on storage.objects for update to anon, authenticated
  using (bucket_id='product-images') with check (bucket_id='product-images');
create policy product_images_management_delete on storage.objects for delete to anon, authenticated
  using (bucket_id='product-images');

notify pgrst, 'reload schema';
commit;
