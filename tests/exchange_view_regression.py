"""Verify the production RLS issue using an EMPTY, DISPOSABLE PostgreSQL database.
Usage: python3 tests/exchange_view_regression.py 'postgresql://.../empty_test_db'
"""
from pathlib import Path
import sys
import psycopg

ROOT = Path(__file__).resolve().parents[1]
FIRST = '11111111-1111-4111-8111-111111111111'
SECOND = '22222222-2222-4222-8222-222222222222'

def run_suite(dsn):
    with psycopg.connect(dsn, autocommit=True) as owner:
        assert owner.execute("select to_regclass('public.point_history')").fetchone()[0] is None, 'Database must be empty'
        owner.execute((ROOT / 'tests/database_fixture.sql').read_text().replace('__OPTIONS_TYPE__','jsonb'))
        for user in [FIRST,SECOND]:
            owner.execute('insert into auth.users(id) values (%s)',(user,))
            owner.execute("insert into public.profiles(id,name) values (%s,'氏名')",(user,))
        for user,product,points in [(FIRST,'ネコ',-50),(FIRST,'fesfes',-50),(FIRST,'ネコ',-150),
                                    (SECOND,'ネコ',-150),(SECOND,'fesfes',-50),(FIRST,'小',-100)]:
            owner.execute("insert into public.point_history(user_id,title,category,points) values (%s,%s,'exchange',%s)",
                          (user,'景品交換: '+product,points))
        owner.execute("insert into public.point_history(user_id,title,category,points) values (%s,'来校','welcome',50)",(FIRST,))
        owner.execute('''alter table public.point_history enable row level security;
          create policy own_history on public.point_history for select to authenticated using(auth.uid()=user_id);
          create view public.exchange_logs_view with (security_invoker=true) as
          select p.id,p.user_id,p.created_at,p.title as product_name,p.points,
                 prof.name as user_name,prof.school_name,prof.grade
          from public.point_history p left join public.profiles prof on p.user_id=prof.id
          where p.category='exchange' or p.points<0;
          grant select on public.exchange_logs_view to anon,authenticated;''')
        def read(role,user,query='select count(*) from public.exchange_logs_view'):
            with psycopg.connect(dsn) as conn:
                conn.execute('set local role '+role)
                conn.execute("select set_config('request.jwt.claim.sub',%s,true)",(user,))
                return conn.execute(query).fetchall()
        assert read('authenticated',SECOND)[0][0]==2
        assert read('anon','')[0][0]==0
        migration=(ROOT / 'supabase/migrations/202611170003_exchange_history_read.sql').read_text()
        owner.execute(migration)
        owner.execute(migration)  # Reapplying the standalone fix is safe.
        for role,user in [('authenticated',SECOND),('anon','')]:
            assert read(role,user)[0][0]==6
            ranks=read(role,user,"select product_name,count(*) from public.exchange_logs_view group by product_name order by count(*) desc")
            assert ranks==[('景品交換: ネコ',3),('景品交換: fesfes',2),('景品交換: 小',1)]
        # The new policy does not expose another user's positive, non-exchange history.
        assert read('authenticated',SECOND,'select count(*) from public.point_history')[0][0]==6
        assert read('anon','','select count(*) from public.point_history')[0][0]==6
        print('PASS: reproduced 2-row RLS restriction; fixed to 6 rows for anon and signed-in users; rankings 3/2/1; non-exchange history remains private')

if __name__=='__main__':
    if len(sys.argv)!=2: raise SystemExit(__doc__)
    run_suite(sys.argv[1])
