"""Test the rolling department cooldown on an EMPTY DISPOSABLE database."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import sys,uuid
import psycopg
ROOT=Path(__file__).resolve().parents[1]
USER='11111111-1111-4111-8111-111111111111';OTHER='22222222-2222-4222-8222-222222222222'
def run_suite(dsn):
 with psycopg.connect(dsn,autocommit=True)as owner:
  assert owner.execute("select to_regclass('public.profiles')").fetchone()[0]is None,'Empty test DB required'
  owner.execute((ROOT/'tests/database_fixture.sql').read_text().replace('__OPTIONS_TYPE__','jsonb'))
  for name in ['202611170004_runtime_and_quiz_management.sql','202611170005_department_checkin_cooldown.sql']:
   owner.execute((ROOT/'supabase/migrations'/name).read_text())
  for user in [USER,OTHER]:
   owner.execute('insert into auth.users(id)values(%s)',(user,));owner.execute("insert into profiles(id,name,points)values(%s,'test',0)",(user,))
  def scan(code,user=USER,key=None):
   with psycopg.connect(dsn)as c:
    c.execute('set local role authenticated');c.execute("select set_config('request.jwt.claim.sub',%s,true)",(user,))
    return c.execute('select record_checkin(%s,%s)',(code,key or uuid.uuid4())).fetchone()[0]
  def points():return owner.execute('select points from profiles where id=%s',(USER,)).fetchone()[0]
  key=uuid.uuid4();result=scan('PT',key=key)
  assert result['earnedPoints']==50 and not result['cooldown']
  assert scan('PT',key=key)==result and points()==50
  assert scan('PT')['cooldown'] and scan('welcome:PT')['cooldown'] and points()==50
  assert scan('OT')['earnedPoints']==50 and points()==100
  assert scan('PT',OTHER)['earnedPoints']==50
  for table in ['checkins','point_history']:
   owner.execute(f"update {table} set created_at=clock_timestamp()-interval '55 minutes' where user_id=%s and "+("booth_id='PT'"if table=='checkins'else"department_name='理学療法学科'"),(USER,))
  assert scan('PT')['cooldown']
  for table in ['checkins','point_history']:
   owner.execute(f"update {table} set created_at=clock_timestamp()-interval '60 minutes' where user_id=%s and "+("booth_id='PT'"if table=='checkins'else"department_name='理学療法学科'"),(USER,))
  assert scan('welcome:PT')['earnedPoints']==50 and points()==150
  owner.execute("delete from checkins where user_id=%s and booth_id in('PT','welcome:PT')",(USER,))
  assert scan('PT')['cooldown']  # deleting the visit log does not reset award history
  assert scan('event:main')['earnedPoints']==30 and scan('event:main')['earnedPoints']==30
  assert points()==210
  with ThreadPoolExecutor(max_workers=8)as pool:results=list(pool.map(lambda _:scan('IS'),range(8)))
  assert sum(r['earnedPoints']for r in results)==50 and points()==260
  assert sum(bool(r['cooldown'])for r in results)==7
  owner.execute("create function fail_award()returns trigger language plpgsql as $$begin raise exception 'test';end$$;create trigger fail_award before insert on point_history for each row execute function fail_award()")
  key=uuid.uuid4()
  try:scan('CW',key=key);raise AssertionError('expected failure')
  except psycopg.Error:pass
  assert points()==260
  assert owner.execute("select count(*)from checkins where booth_id='CW'").fetchone()[0]==0
  owner.execute('drop trigger fail_award on point_history')
  assert scan('CW',key=key)['earnedPoints']==50 and points()==310
  print('PASS cooldown: repeat QR/aliases blocked for 60min; boundary allowed; different departments/users independent; event rules unchanged; concurrent scans award once; retries and rollback safe')
if __name__=='__main__':run_suite(sys.argv[1])
