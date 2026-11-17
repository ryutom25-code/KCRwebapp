"""Run against a DISPOSABLE, EMPTY PostgreSQL database as owner.
Example: python3 tests/database_regression.py 'postgresql://.../disposable_test'
Requires psycopg 3; never pass a production database (the fixture refuses existing tables).
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json
import sys
import uuid
import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
USER = '11111111-1111-4111-8111-111111111111'
OTHER = '22222222-2222-4222-8222-222222222222'
ADMIN = '33333333-3333-4333-8333-333333333333'


def run_suite(dsn, options_type='jsonb'):
    owner = psycopg.connect(dsn, autocommit=True)
    assert owner.execute("select to_regclass('public.profiles')").fetchone()[0] is None, 'Database must be empty'
    fixture = (ROOT / 'tests/database_fixture.sql').read_text().replace('__OPTIONS_TYPE__', options_type)
    owner.execute(fixture)
    owner.execute((ROOT / 'supabase/migrations/202611170001_secure_operations.sql').read_text())
    for user, email in [(USER, 'user@test.invalid'), (OTHER, 'other@test.invalid'), (ADMIN, 'admin@test.invalid')]:
        owner.execute('insert into auth.users values(%s,%s)', (user,email))
    owner.execute('insert into public.admin_users values(%s)',(ADMIN,))

    def call(sql, args=(), user=USER, role='authenticated'):
        with psycopg.connect(dsn) as conn:
            conn.execute(f'set local role {role}')
            conn.execute("select set_config('request.jwt.claim.sub',%s,true)", (user,))
            return conn.execute(sql,args).fetchall() if sql.lstrip().lower().startswith('select') else conn.execute(sql,args).rowcount

    def fails(sql, args=(), user=USER, role='authenticated'):
        try:
            call(sql,args,user,role)
        except psycopg.Error:
            return
        raise AssertionError('Expected database rejection: '+sql)

    def points(user=USER):
        return owner.execute('select points from public.profiles where id=%s',(user,)).fetchone()[0]

    assert call('select public.is_admin()')[0][0] is False
    assert call('select public.is_admin()',user=ADMIN)[0][0] is True
    for user in [USER, OTHER, ADMIN]:
        call('select public.save_profile(%s,%s,%s)',('氏名','学校','3'),user=user)
    fails('update public.profiles set points=99999 where id=%s',(USER,))
    fails('insert into public.admin_users values(%s)',(USER,))
    fails('insert into public.point_history(user_id,title,points) values(%s,%s,999)',(USER,'偽造'))
    fails('insert into public.quiz_answers(user_id,is_correct) values(%s,true)',(USER,))
    assert len(call('select * from public.profiles')) == 1
    assert len(call('select * from public.profiles',user=ADMIN)) == 3
    fails('select * from public.profiles',role='anon',user='')
    fails('select public.record_checkin(%s,%s)',('PT',uuid.uuid4()),role='anon',user='')
    assert call('select public.products.* from public.products') == []
    fails('insert into public.products(name,points) values(%s,50)',('偽景品',))
    call('insert into public.products(name,points) values(%s,50)',('景品',),user=ADMIN)
    product = str(owner.execute('select id from public.products').fetchone()[0])
    fails("insert into storage.objects(bucket_id,name) values('product-images','bad.jpg')")
    fails("insert into storage.objects(bucket_id,name) values('product-images','bad.jpg')",role='anon',user='')
    call("insert into storage.objects(bucket_id,name) values('product-images','ok.jpg')",user=ADMIN)

    # Unknown code does not create any record or change the balance.
    for code in ['https://example.test','welcome:INVALID','exchange:foo','EXCHANGE_BOOTH','']:
        fails('select public.record_checkin(%s,%s)',(code,uuid.uuid4()))
    assert points()==0
    key=uuid.uuid4()
    first=call('select public.record_checkin(%s,%s)',('PT',key))[0][0]
    assert first['newPoints']==50
    assert call('select public.record_checkin(%s,%s)',('PT',key))[0][0]==first
    assert points()==50
    fails('select public.record_checkin(%s,%s)',('OT',key))
    call('select public.record_checkin(%s,%s)',('PT',uuid.uuid4()))
    assert points()==100  # Intentional repeat visits still allowed.
    # All increments must survive concurrent operations.
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: call('select public.record_checkin(%s,%s)',('PT',uuid.uuid4())),range(8)))
    assert points()==500

    # Failed history insertion must roll back checkin, points and idempotency key.
    owner.execute("""create function public.fail_history() returns trigger language plpgsql as $$
      begin raise exception 'test history failure'; end $$;
      create trigger fail_history before insert on public.point_history for each row execute function public.fail_history();""")
    before = owner.execute('select count(*) from public.checkins').fetchone()[0]
    rollback_key=uuid.uuid4()
    fails('select public.record_checkin(%s,%s)',('PT',rollback_key))
    assert points()==500
    assert owner.execute('select count(*) from public.checkins').fetchone()[0]==before
    assert owner.execute('select count(*) from public.operation_requests where request_id=%s',(rollback_key,)).fetchone()[0]==0
    fails('select public.exchange_product(%s,%s,%s,%s)',(product,'EXCHANGE_BOOTH',uuid.uuid4(),50))
    assert points()==500
    owner.execute('drop trigger fail_history on public.point_history')

    # Concurrent redemptions consume exactly available points; no overspend.
    owner.execute('update public.profiles set points=50 where id=%s',(USER,))
    def redeem(_):
        try: return call('select public.exchange_product(%s,%s,%s,%s)',(product,'EXCHANGE_BOOTH',uuid.uuid4(),50))
        except psycopg.Error: return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(redeem,range(2)))
    assert sum(result is not None for result in results)==1
    assert points()==0
    owner.execute('update public.profiles set points=100 where id=%s',(USER,))
    fails('select public.exchange_product(%s,%s,%s,%s)',(product,'EXCHANGE_BOOTH',uuid.uuid4(),1))
    assert points()==100
    key=uuid.uuid4()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:call('select public.exchange_product(%s,%s,%s,%s)',(product,'EXCHANGE_BOOTH',key,50)),range(2)))
    assert results[0]==results[1] and points()==50
    call('select public.save_profile(%s,%s,%s)',('変更','学校','既卒生'))
    assert points()==50  # Profile edits never reset the balance.

    questions=[{'question':f'問題{i}', 'options':['A','B','C','D'], 'correct_index':1} for i in range(4)]
    fails('select public.create_quiz_set(%s,%s,%s)',('PT','セット',Jsonb(questions)))
    result=call('select public.create_quiz_set(%s,%s,%s)',('PT',"Kid's セット",Jsonb(questions)),user=ADMIN)[0][0]
    set_id=result['id']
    quiz=str(owner.execute('select id from public.quizzes where set_id=%s order by id',(set_id,)).fetchone()[0])
    assert len(call('select id,question,options,points from public.quizzes'))==4
    fails('select correct_index from public.quizzes')
    fails('select * from public.quizzes')
    assert call('select public.answer_quiz(%s,0)',(quiz,))[0][0]['isCorrect'] is False
    assert points()==50
    # Correct-answer recording must roll back if the history write fails.
    owner.execute('create trigger fail_history before insert on public.point_history for each row execute function public.fail_history()')
    fails('select public.answer_quiz(%s,1)',(quiz,))
    assert points()==50
    assert owner.execute('select count(*) from public.quiz_answers').fetchone()[0]==0
    owner.execute('drop trigger fail_history on public.point_history')
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:call('select public.answer_quiz(%s,1)',(quiz,))[0][0],range(2)))
    assert sum(result['earnedPoints'] for result in results)==10
    assert points()==60
    assert owner.execute('select count(*) from public.quiz_answers').fetchone()[0]==1
    # Invalid question four cannot leave a partial set or questions behind.
    before=owner.execute('select count(*) from public.quiz_sets').fetchone()[0]
    bad=questions+[{}]
    fails('select public.create_quiz_set(%s,%s,%s)',('PT','bad',Jsonb(bad)),user=ADMIN)
    bad=questions[:3]+[{'question':'','options':['A','B','C','D'],'correct_index':1}]
    fails('select public.create_quiz_set(%s,%s,%s)',('PT','bad',Jsonb(bad)),user=ADMIN)
    assert owner.execute('select count(*) from public.quiz_sets').fetchone()[0]==before
    assert owner.execute('select count(*) from public.quizzes').fetchone()[0]==4
    print(f'PASS database ({options_type}): RLS, grants, storage, QR validation, concurrency, retries, rollback, quiz and profile')
    # Final configuration: management is intentionally available without login.
    owner.execute((ROOT / 'supabase/migrations/202611170002_login_free_management.sql').read_text())
    for role, user in [('anon',''),('authenticated',USER)]:
        assert len(call('select * from public.profiles',role=role,user=user))==3
        assert call('select * from public.checkins',role=role,user=user)
        assert call('select * from public.point_history',role=role,user=user)
        call("insert into public.products(name,points) values('公開管理の景品',50)",role=role,user=user)
        call("update public.products set points=100 where name='公開管理の景品'",role=role,user=user)
        call("delete from public.products where name='公開管理の景品'",role=role,user=user)
        call("insert into public.events(title,event_date) values('公開管理イベント','2026-11-17')",role=role,user=user)
        call("delete from public.events where title='公開管理イベント'",role=role,user=user)
        call("insert into public.qr_codes(code,category,department_name,points) values('event:open','event','イベント',30)",role=role,user=user)
        call("update public.qr_codes set active=false where code='event:open'",role=role,user=user)
        call("delete from public.qr_codes where code='event:open'",role=role,user=user)
        call('select public.create_quiz_set(%s,%s,%s)',('PT','ログイン不要セット',Jsonb(questions)),role=role,user=user)
        call("insert into storage.objects(bucket_id,name) values('product-images','public.jpg')",role=role,user=user)
        assert call("select * from storage.objects where bucket_id='product-images'",role=role,user=user)
        call("delete from storage.objects where name='public.jpg'",role=role,user=user)
        call("update public.checkins set booth_id='OT' where booth_id='PT'",role=role,user=user)
        fails('update public.profiles set points=99999',role=role,user=user)
        fails('insert into public.point_history(user_id,title,points) values(%s,%s,999)',(USER,'偽造'),role=role,user=user)
    fails('select public.record_checkin(%s,%s)',('PT',uuid.uuid4()),role='anon',user='')
    fails('select public.answer_quiz(%s,1)',(quiz,),role='anon',user='')
    fails('select public.save_profile(%s,%s,%s)',('氏名','学校','3'),role='anon',user='')
    before=owner.execute('select count(*) from public.quiz_sets').fetchone()[0]
    fails('select public.create_quiz_set(%s,%s,%s)',('PT','bad',Jsonb(bad)),role='anon',user='')
    assert owner.execute('select count(*) from public.quiz_sets').fetchone()[0]==before
    print(f'PASS login-free management ({options_type}): anonymous/signed-in reads, catalog edits, quiz creation, storage; point protection retained')
    # Missing runtime installation and newly requested login-free quiz CRUD.
    runtime=(ROOT / 'supabase/migrations/202611170004_runtime_and_quiz_management.sql').read_text()
    owner.execute(runtime)
    owner.execute(runtime)
    rows=call('select public.get_quiz_management()',role='anon',user='')[0][0]
    assert rows and rows[0]['quizzes']
    q=rows[0]['quizzes'][0];sid=str(rows[0]['id']);qid=str(q['id'])
    before=points()
    call('select public.update_quiz(%s,%s,%s,%s)',(qid,'編集した問題',Jsonb(['選択A','選択B','選択C','選択D']),2),role='anon',user='')
    edited=owner.execute('select question,correct_index from public.quizzes where id=%s',(qid,)).fetchone()
    assert edited==('編集した問題',2)
    fails('select public.update_quiz(%s,%s,%s,%s)',(qid,'bad',Jsonb(['A']),0),role='anon',user='')
    call('select public.update_quiz_set(%s,%s,%s)',(sid,'編集セット','IS'),role='anon',user='')
    call('select public.delete_quiz(%s)',(qid,),role='anon',user='')
    assert owner.execute('select count(*) from public.quizzes where id=%s',(qid,)).fetchone()[0]==0
    assert points()==before
    call('select public.delete_quiz_set(%s)',(sid,),role='anon',user='')
    assert owner.execute('select count(*) from public.quiz_sets where id=%s',(sid,)).fetchone()[0]==0
    assert points()==before
    # Existing incorrect answers are upgraded instead of violating the live unique constraint.
    fresh=call('select public.create_quiz_set(%s,%s,%s)',('PT','再挑戦',Jsonb(questions)),role='anon',user='')[0][0]['id']
    qid=owner.execute('select id from public.quizzes where set_id=%s limit 1',(fresh,)).fetchone()[0]
    owner.execute('insert into public.quiz_answers(user_id,set_id,quiz_id,is_correct) values(%s,%s,%s,false)',(USER,fresh,qid))
    result=call('select public.answer_quiz(%s,1)',(str(qid),))[0][0]
    assert result['isCorrect'] and points()==before+10
    assert owner.execute('select count(*) from public.quiz_answers where user_id=%s and quiz_id=%s',(USER,qid)).fetchone()[0]==1
    print(f'PASS runtime install ({options_type}): idempotent schema, anonymous quiz edit/delete, preserved balances, incorrect-answer retries')
    owner.close()

if __name__=='__main__':
    if len(sys.argv) not in (2,3): raise SystemExit(__doc__)
    run_suite(sys.argv[1],sys.argv[2] if len(sys.argv)==3 else 'jsonb')
