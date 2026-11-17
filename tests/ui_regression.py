"""Browser QA against preview_server.py --fixtures, using a disposable CDP browser.
Requires websocket-client. Chrome must use --remote-debugging-port=9333.
"""
import json,time,urllib.request,base64,sys
from pathlib import Path
import websocket
pages=['home','login','signup','profile','qr','quiz','history','exchange','dept','admin/index','admin/checkin','admin/exchange','admin/product','admin/event','admin/quiz','admin/qr']
tabs=json.load(urllib.request.urlopen('http://127.0.0.1:9333/json'))
ws=websocket.create_connection(next(t['webSocketDebuggerUrl'] for t in tabs if t['type']=='page'),origin='http://localhost:9333')
serial=0;errors=[]
def call(method,params={}):
 global serial
 serial+=1;msgid=serial;ws.send(json.dumps({'id':msgid,'method':method,'params':params}))
 while True:
  result=json.loads(ws.recv())
  if result.get('method')=='Runtime.exceptionThrown':errors.append(result['params']['exceptionDetails'])
  if result.get('id')==msgid:
   if 'error'in result:raise RuntimeError(result['error'])
   return result.get('result',{})
def js(code):
 r=call('Runtime.evaluate',{'expression':code,'returnByValue':True,'awaitPromise':True})
 if 'exceptionDetails'in r:raise RuntimeError(r['exceptionDetails'])
 return r.get('result',{}).get('value')
call('Runtime.enable');call('Page.enable')
def visit(page,width):
 call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':width<761})
 call('Page.navigate',{'url':'http://127.0.0.1:8765/'+page+'.html'})
 for _ in range(80):
  time.sleep(.04)
  if js("document.readyState==='complete' && !!document.querySelector('.mobile-header')"):break
 time.sleep(.08)
for width in ([] if '--interactions-only' in sys.argv else [390,1440]):
 for page in pages:
  errors.clear();visit(page,width)
  result=js("({overflow:document.documentElement.scrollWidth>innerWidth+1,title:document.title,h1:!!document.querySelector('h1'),navigation:document.querySelectorAll('.nav-item').length,broken:[...document.images].filter(i=>i.offsetParent!==null&&i.complete&&i.naturalWidth===0).map(i=>i.src)})")
  assert result['h1'],(page,'missing heading')
  assert not result['overflow'],(page,width,'page overflow',result)
  assert not result['broken'],(page,result)
  assert not errors,(page,width,errors)
  print('PASS',width,page,flush=True)
  if page in ['home','admin/exchange','login']:
   output=Path('/tmp/kcr-ui-previews');output.mkdir(exist_ok=True)
   shot=call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':True})
   (output/f'{page.replace("/","-")}-{width}.png').write_bytes(base64.b64decode(shot['data']))
# Exercise real DOM controls; all writes stay in the fixture client.
visit('admin/exchange',390)
assert js("document.getElementById('recordCount').textContent")== '6 件'
js("document.getElementById('exchangeSearch').value='ネコ';document.getElementById('exchangeSearch').dispatchEvent(new Event('input'))")
assert js("document.querySelectorAll('#exchangeTableBody tr').length")==3
assert js("document.getElementById('exchangeTotal').textContent")== '6 件'
visit('quiz',390);js("document.querySelector('[data-dept=PT]').click()")
time.sleep(.15);js("document.querySelector('[data-set-index]').click()")
time.sleep(.15);assert js("document.getElementById('questionText').textContent").startswith('理学療法士')
js("document.querySelector('.option-btn').click()")
time.sleep(.15);assert '正解' in js("document.getElementById('resultFeedback').textContent")
visit('admin/event',390);js("document.querySelector('[data-edit-index]').click()")
assert js("document.getElementById('eventTitle').value")== '学科体験・キャンパスツアー'
js("document.getElementById('cancelEditBtn').click()")
assert js("document.getElementById('eventTitle').value")== ''
visit('exchange',390);js("document.querySelector('[data-product-index]').click()")
assert js("getComputedStyle(document.getElementById('scannerModal')).display")== 'flex'
js("document.getElementById('closeScannerBtn').click()")
assert js("getComputedStyle(document.getElementById('scannerModal')).display")== 'none'
visit('login',390);js("document.querySelector('[data-show-password]').click()")
assert js("document.getElementById('password').type")== 'text'
visit('admin/qr',390);js("document.querySelector('.preset-btn').click()")
time.sleep(.1);assert js("getComputedStyle(document.getElementById('resultCard')).display")!='none'
visit('home',390)
assert js("[...document.querySelectorAll('.campus-actions h3')].map(e=>e.textContent)")==['学科クイズ','ミニゲーム','学科説明','ポイント交換']
assert js("document.querySelector('.wallet-scan').getBoundingClientRect().bottom<document.querySelector('.wallet-link').getBoundingClientRect().top")
assert js("getComputedStyle(document.querySelector('.campus-actions')).gridTemplateColumns.split(' ').length")==2
visit('admin/product',390)
assert js("document.querySelector('.product-image-button img').getBoundingClientRect().width")>=100
js("document.querySelector('.product-image-button').click()")
assert js("!!document.querySelector('dialog.image-dialog[open]')")
js("document.querySelector('.image-dialog button').click()")
assert not js("!!document.querySelector('.image-dialog')")
visit('admin/quiz',390)
assert js("document.querySelectorAll('.quiz-set-item').length")==1
js("document.querySelector('.quiz-set-item summary').click()")
assert js("document.querySelector('[data-question]').value").startswith('理学療法士')
assert js("document.querySelectorAll('[data-option]').length")==4
js("document.querySelector('[data-question]').value='編集テスト';document.querySelector('.quiz-question-editor').requestSubmit()")
time.sleep(.15)
assert '問題を保存' in js("document.getElementById('notifications').textContent")
js("document.querySelector('[data-delete-question]').click()")
time.sleep(.1)
assert js("!!document.querySelector('dialog[open]')")
js("document.querySelector('[data-cancel]').click()")
js("document.querySelector('[data-delete-question]').click()")
time.sleep(.1)
js("document.querySelector('[data-confirm]').click()")
time.sleep(.15)
assert '問題を削除' in js("document.getElementById('notifications').textContent")
visit('login',390)
js("window.supabaseClient.auth.signInWithPassword=async()=>({error:{message:'確認用エラー'}});document.getElementById('email').value='test@example.com';document.getElementById('password').value='test-password';document.getElementById('loginForm').requestSubmit()")
time.sleep(.15)
assert '確認用エラー' in js("document.querySelector('.form-status').textContent")
assert js("document.querySelector('button[type=submit]').disabled") is False
js("window.confirmResult=null;UI.confirm('景品を交換しますか？').then(value=>window.confirmResult=value);'opened'")
assert js("!!document.querySelector('dialog[open]')")
js("document.querySelector('[data-confirm]').click()")
assert js('window.confirmResult') is True
js("UI.notify('保存しました')")
assert '保存しました' in js("document.getElementById('notifications').textContent")
print('PASS interactions: exchange search, quiz, event editing, scanner modal, password toggle, QR preview')
ws.close()
