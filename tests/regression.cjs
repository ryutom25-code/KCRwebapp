// Run with Node.js 18+: node tests/regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function context(files) {
  const elements = new Map();
  const documentEvents = new Map(), windowEvents = new Map();
  function element() { return { textContent: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelectorAll() { return []; }, querySelector() { return element(); }, appendChild() {}, focus() {} }; }
  const document = { baseURI: 'https://example.test/app/', readyState: 'complete', body: element(),
    addEventListener(name, handler) { documentEvents.set(name, handler); }, querySelectorAll() { return []; },
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
  const alerts = [], timers = [];
  const sandbox = { document, URL, URLSearchParams, TextEncoder, console, addEventListener(name, handler) { windowEvents.set(name, handler); }, crypto: require('node:crypto').webcrypto,
    setTimeout(fn) { timers.push(fn); }, clearTimeout() {},
    alert(message) { alerts.push(message); }, confirm() { return true; }, supabaseInitPromise: Promise.resolve() };
  sandbox.window = sandbox;
  sandbox.location = { replace(url) { sandbox.redirect = url; } };
  const ctx = vm.createContext(sandbox);
  for (const file of ['js/common.js', ...files]) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  return { ctx, elements, alerts, timers, documentEvents, windowEvents, run: code => vm.runInContext(code, ctx) };
}
function query(result) {
  const q = { then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
  for (const method of ['select', 'eq', 'order', 'single', 'maybeSingle', 'gte', 'or']) q[method] = () => q;
  return q;
}
(async () => {
  // Parse every script, including those not exercised by this test.
  for (const dir of ['js', 'admin/js']) for (const file of fs.readdirSync(path.join(root, dir))) {
    if (file.endsWith('.js')) new vm.Script(fs.readFileSync(path.join(root, dir, file), 'utf8'), { filename: file });
  }
  let t = context([]);
  t.ctx.input = `<img onerror="x">&'`;
  assert.equal(t.run('App.escapeHtml(input)'), '&lt;img onerror=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(t.run(`App.csvCell('=1+1')`), '"\'=1+1"');
  for (const value of ['+cmd', '-cmd', '@SUM(A1)', '  =1', '\t=1', '\r=1', '\n=1']) {
    t.ctx.input = value;
    assert.ok(t.run('App.csvCell(input)').startsWith('"\''));
  }
  t.ctx.input = '山田,"太郎"\n高校';
  assert.equal(t.run('App.csvCell(input)'), '"山田,""太郎""\n高校"');
  assert.equal(t.run(`App.safeImageUrl('javascript:alert(1)')`), '');
  assert.equal(t.run(`App.safeImageUrl('data:text/html,x')`), '');
  assert.equal(t.run(`App.safeImageUrl('../icons/icon-192.png')`), 'https://example.test/icons/icon-192.png');
  // Simulate an API with a smaller cap than the requested page size.
  t.ctx.rows = Array.from({ length: 1203 }, (_, id) => ({ id }));
  assert.equal(await t.run(`App.fetchAll(() => ({ range(start, end) { return Promise.resolve({ data: rows.slice(start, Math.min(end+1, start+137)), error: null }); } })).then(rows => rows.length)`), 1203);
  t.ctx.page = 0;
  const failed = await t.run(`App.fetchAllResult(() => ({range() { return Promise.resolve(++page === 1 ? {data:[1]} : {error: new Error('page failed')}); }}))`);
  assert.equal(failed.data, null);
  assert.equal(failed.error.message, 'page failed');
  // Staff page scripts use the Node.js session rather than Supabase Auth.
  t.ctx.supabaseClient = { auth: { getUser: () => { throw new Error('Auth must not be called'); } },
    rpc: () => { throw new Error('is_admin must not be called'); } };
  assert.equal(await t.run('App.initAdminPage()'), true);
  assert.equal(t.ctx.redirect, undefined);
  t.ctx.supabaseClient = null;
  assert.equal(await t.run('App.initAdminPage()'), false);
  assert.match(t.ctx.document.body.textContent, /Supabase/);
  for (const file of fs.readdirSync(path.join(root,'admin/js'))) {
    const source = fs.readFileSync(path.join(root,'admin/js',file),'utf8');
    assert.ok(source.includes('App.initAdminPage()'),file);
    assert.ok(!/requireAdmin|is_admin|auth\.getUser/.test(source),file);
  }

  // A static preview can serve participant pages while staff still require the backend.
  function bootstrap(area, response, locationUrl = 'https://campus.test') {
    const setup = context([]);
    const calls = [];
    setup.ctx.document.body.dataset.area = area;
    setup.ctx.location = new URL(locationUrl);
    setup.ctx.supabase = { createClient(url, key, options) {
      calls.push({ url, key, options });
      return {};
    } };
    setup.ctx.fetch = async route => {
      assert.equal(route, '/api/config');
      return response;
    };
    setup.run(fs.readFileSync(path.join(root, 'js/env.js'), 'utf8'));
    return { ready: setup.run('supabaseInitPromise'), calls };
  }

  const staticResponse = new Response('Not found', { status: 404 });
  const participant = bootstrap('campus', staticResponse);
  await participant.ready;
  assert.equal(participant.calls.length, 1);
  const publicClaims = JSON.parse(Buffer.from(participant.calls[0].key.split('.')[1], 'base64url'));
  assert.equal(publicClaims.role, 'anon');

  const staticWithHtmlFallback = bootstrap('campus', new Response('<html></html>', {
    headers: { 'Content-Type': 'text/html' }
  }));
  await staticWithHtmlFallback.ready;
  assert.equal(staticWithHtmlFallback.calls[0].url, participant.calls[0].url);
  const localFile = bootstrap('campus', undefined, 'file:///tmp/KCRwebapp/home.html');
  await localFile.ready;
  assert.equal(localFile.calls[0].url, participant.calls[0].url);

  const staticStaff = bootstrap('admin', staticResponse);
  await assert.rejects(staticStaff.ready, /Node\.js版/);
  assert.equal(staticStaff.calls.length, 0);
  const liveServerStaff = bootstrap('admin', staticResponse, 'http://127.0.0.1:5500/admin/index.html');
  await assert.rejects(liveServerStaff.ready, /127\.0\.0\.1:8080\/admin\//);
  assert.equal(liveServerStaff.calls.length, 0);

  const failedBackend = bootstrap('campus', new Response('Unavailable', { status: 503 }));
  await assert.rejects(failedBackend.ready, /サーバーの設定/);
  assert.equal(failedBackend.calls.length, 0);

  const configured = { url: 'https://example.supabase.co', publicKey: 'sb_publishable_configured' };
  const backendParticipant = bootstrap('campus', Response.json(configured));
  await backendParticipant.ready;
  assert.equal(backendParticipant.calls[0].url, configured.url);
  assert.equal(backendParticipant.calls[0].key, configured.publicKey);
  const backendStaff = bootstrap('admin', Response.json(configured));
  await backendStaff.ready;
  assert.equal(backendStaff.calls[0].url, 'https://campus.test/api/staff');
  assert.equal(backendStaff.calls[0].key, 'staff-session');

  // Apostrophes, quotes and HTML in a product never enter an inline handler.
  t = context(['js/qr-camera.js', 'js/exchange.js']);
  const product = { id: "p'1", name: `Kid's "<img src=x onerror=alert(1)>"`, points: 50, image_url: 'javascript:alert(1)' };
  t.ctx.supabaseClient = { from: table => query({ data: table === 'profiles' ? {points:100} : [product] }) };
  t.run("currentUser={id:'u'}");
  await t.run('loadProfileAndProducts()');
  const html = t.elements.get('productList').innerHTML;
  assert.ok(!html.includes('onclick='));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('Kid&#39;s'));
  assert.ok(html.includes('data-product-index="0"'));
  // Duplicate scanner callbacks send one request; RPC failures never report success.
  let resolveRpc, calls = 0;
  const exchangeIds = [];
  t.ctx.supabaseClient.rpc = (name, args) => { exchangeIds.push(args.p_request_id); calls++; return new Promise(resolve => {resolveRpc=resolve;}); };
  t.run("selectedProduct={id:'p',name:'景品',points:50}; currentProfile={points:100}; loadProfileAndProducts=async()=>{};");
  const first = t.run("onScanSuccess('EXCHANGE_BOOTH')");
  await t.run("onScanSuccess('EXCHANGE_BOOTH')");
  assert.equal(calls, 1);
  resolveRpc({error:{message:'履歴保存失敗'}});
  await first;
  assert.equal(t.alerts.length, 1);
  assert.match(t.alerts[0], /完了できません/);
  assert.equal(t.run('exchangeProcessing'), false);
  t.ctx.supabaseClient.rpc = async (name,args) => {
    exchangeIds.push(args.p_request_id);
    assert.equal(args.p_expected_points,50);
    return {data:{newPoints:50,productName:'景品'}};
  };
  await t.run("onScanSuccess('EXCHANGE_BOOTH')");
  assert.equal(t.run("App.hasPendingRequest('exchange:p')"), false);
  assert.equal(exchangeIds[0], exchangeIds[1]); // Retry an uncertain result with the same key.
  await t.run("onScanSuccess('EXCHANGE_BOOTH')");
  assert.notEqual(exchangeIds[1], exchangeIds[2]); // A completed exchange permits a new request.


  // A quiz failure restores controls and never schedules progression.
  t = context(['js/quiz.js']);
  t.ctx.supabaseClient = { rpc: async () => ({error:{message:'transaction failed'}}) };
  t.run("currentQuizzes=[{id:'q'}]; currentSet={id:'s'};");
  await t.run('submitAnswer(0)');
  assert.match(t.elements.get('resultFeedback').textContent, /保存できません/);
  assert.equal(t.run('currentQuizIndex'), 0);
  assert.equal(t.run('answerProcessing'), false);
  assert.equal(t.timers.length, 0);
  // Server controls the awarded amount; duplicate input is ignored during a request.
  calls = 0;
  t.ctx.supabaseClient.rpc = async () => { calls++; return {data:{isCorrect:true,earnedPoints:25}}; };
  await t.run('submitAnswer(0)');
  await t.run('submitAnswer(0)');
  assert.equal(calls, 1);
  assert.match(t.elements.get('resultFeedback').textContent, /25 PT/);
  t.run('openQuizSets=async()=>{}');
  t.timers[0]();
  assert.equal(t.run('currentQuizIndex'), 1);

  // The signed-in check-in page starts the back camera without a menu or click.
  t = context(['js/qr-camera.js', 'js/qr.js']);
  t.ctx.authReady = Promise.resolve({ id: 'u' });
  let cameraStarts = 0, cameraStops = 0;
  t.ctx.Html5Qrcode = class {
    constructor(readerId) { assert.equal(readerId, 'reader'); }
    start(constraints) {
      assert.equal(constraints.facingMode, 'environment');
      cameraStarts++;
      return Promise.resolve();
    }
    stop() { cameraStops++; return Promise.resolve(); }
    clear() {}
  };
  await t.documentEvents.get('DOMContentLoaded')();
  assert.equal(cameraStarts, 1);
  assert.match(t.elements.get('statusMessage').textContent, /読み取れます/);
  await t.windowEvents.get('pagehide')();
  assert.equal(cameraStops, 1);

  // Closing while the permission prompt is pending releases the old camera before reopening.
  t = context(['js/qr-camera.js', 'js/exchange.js']);
  const scanners = [];
  const scanNotifications = [];
  let allowCamera;
  t.ctx.Html5Qrcode = class {
    constructor() { scanners.push(this); }
    start(constraints, config, onScan) {
      assert.equal(constraints.facingMode, 'environment');
      assert.equal(config.qrbox(390, 220).width, 176);
      this.scan = onScan;
      return scanners.length === 1 ? new Promise(resolve => { allowCamera = resolve; }) : Promise.resolve();
    }
    stop() { this.stopped = true; return Promise.resolve(); }
    clear() { this.cleared = true; }
  };
  t.ctx.scanNotifications = scanNotifications;
  t.run("currentProfile={points:100}; onScanSuccess=text=>scanNotifications.push(text);");
  const pendingCamera = t.run("openScanner({id:'p',name:'景品',points:50})");
  assert.equal(t.elements.get('scannerModal').style.display, 'flex');
  const releasing = t.run('stopScanner()');
  assert.equal(t.elements.get('scannerModal').style.display, 'none');
  const reopened = t.run("openScanner({id:'p',name:'景品',points:50})");
  assert.equal(scanners.length, 1);
  scanners[0].scan('stale');
  allowCamera();
  await Promise.all([pendingCamera, releasing, reopened]);
  assert.equal(scanners.length, 2);
  assert.ok(scanners[0].stopped && scanners[0].cleared);
  scanners[1].scan('EXCHANGE_BOOTH');
  assert.deepEqual(scanNotifications, ['EXCHANGE_BOOTH']);
  await t.windowEvents.get('pagehide')();
  assert.ok(scanners[1].stopped && scanners[1].cleared);

  // Unknown QR rejection is passed through; there is no local fallback award.
  t = context(['js/qr-camera.js', 'js/qr.js']);
  t.ctx.supabaseClient = { rpc: async (name, args) => {
    assert.equal(name,'record_checkin'); assert.equal(args.p_code,'https://unrelated.test');
    return {error:{message:'未登録QR'}};
  } };
  await assert.rejects(t.run("handleScanSuccess({id:'u'}, 'https://unrelated.test')"), /未登録QR/);
  await assert.rejects(t.run("handleScanSuccess({id:'u'}, 'EXCHANGE_BOOTH')"), /景品交換用/);

  // Newly generated event QR codes register the same 50 points as the migration.
  t = context(['admin/js/qr.js']);
  const issuedCodes = [];
  t.ctx.supabaseClient = { from(table) {
    assert.equal(table, 'qr_codes');
    return { upsert(record) { issuedCodes.push(record); return Promise.resolve({ error: null }); } };
  } };
  t.ctx.QRCode = class { static CorrectLevel = { H: 1 }; };
  await t.documentEvents.get('DOMContentLoaded')();
  t.elements.get('boothInput').value = '公開イベント';
  await t.elements.get('customQrBtn').listeners.click();
  assert.match(issuedCodes[0].code, /^event:text:[0-9a-f]{64}$/);
  assert.equal(issuedCodes[0].department_name, '公開イベント');
  assert.equal(await t.run("customEventCode('公開イベント')"), issuedCodes[0].code);
  assert.equal(await t.run("customEventCode('OpenCampus')"), 'event:OpenCampus');
  assert.equal(issuedCodes[0].category, 'event');
  assert.equal(issuedCodes[0].points, 50);

  t = context(['admin/js/qr.js']);
  t.ctx.location.search = '?eventId=e1';
  t.ctx.supabaseClient = { from(table) {
    if (table === 'events') return query({ data: { id: 'e1', title: '日本語のイベント' } });
    return { upsert(record) { issuedCodes.push(record); return Promise.resolve({ error: null }); } };
  } };
  t.ctx.QRCode = class { static CorrectLevel = { H: 1 }; };
  await t.documentEvents.get('DOMContentLoaded')();
  assert.equal(issuedCodes[1].code, 'event:event-id:e1');
  assert.equal(issuedCodes[1].department_name, '日本語のイベント');
  assert.equal(t.elements.get('resultCard').style.display, 'block');

  // A camera facing the same department should not hammer the API during cooldown.
  t = context(['js/qr-camera.js', 'js/qr.js']);
  let scanCalls = 0;
  t.ctx.supabaseClient = {rpc:async()=>{scanCalls++;return {data:{cooldown:false,earnedPoints:50,newPoints:50,departmentName:'理学療法学科',nextAllowedAt:new Date(Date.now()+3600000).toISOString()}};}};
  assert.equal((await t.run("handleScanSuccess({id:'u'}, 'PT')")).earnedPoints,50);
  assert.equal((await t.run("handleScanSuccess({id:'u'}, 'welcome:PT')")).cooldown,true);
  assert.equal(scanCalls,1);
  await t.run("handleScanSuccess({id:'u'}, 'OT')");
  assert.equal(scanCalls,2);
  await t.run("handleScanSuccess({id:'other'}, 'PT')");
  assert.equal(scanCalls,3);

  // The staff exchange view provides named rows without a PostgREST relationship.
  t = context(['admin/js/exchange.js']);
  const history = [
    {id:1,user_id:'u',product_name:'景品交換: A',points:-50,created_at:'2026-11-17T01:00:00Z'},
    {id:2,user_id:'missing',product_name:'景品交換: B',points:-50,created_at:'2026-11-17T02:00:00Z'},
    {id:3,user_id:'u',product_name:'景品交換: A',points:-100,created_at:'2026-11-17T03:00:00Z'},
    {id:4,user_id:'u',product_name:'景品交換：B',points:-50,created_at:'2026-11-17T04:00:00Z'},
    {id:5,user_id:'u',product_name:'景品交換: <img src=x onerror=alert(1)>',points:-50,created_at:'2026-11-17T05:00:00Z'}
  ];
  history[0].user_name = "Kid's <script>";
  history[0].school_name = '=学校';
  history[0].grade = '1';
  t.ctx.supabaseClient = {from(table) {
    assert.equal(table,'staff_exchange_logs');
    const rows = history;
    const q = {select(columns) { assert.equal(columns,'id, created_at, product_name, points, user_name, school_name, grade'); return q; },
      order() { return q; }, range(start,end) { return Promise.resolve({data:rows.slice(start,end+1)}); }};
    return q;
  }};
  await t.run('loadExchangeLogs()');
  assert.equal(t.elements.get('recordCount').textContent,'5 件');
  assert.match(t.elements.get('exchangeTableBody').innerHTML, /Kid&#39;s &lt;script&gt;/);
  assert.match(t.elements.get('exchangeTableBody').innerHTML, /学校/);
  t.elements.get('exchangeSearch').value = 'kid';
  t.run('renderExchangeLogs()');
  assert.equal(t.elements.get('recordCount').textContent, '1 件');
  assert.equal(t.run('buildExchangeRanking(allExchangeLogs)[0].count'), 2);
  let exportedCsv;
  t.ctx.Blob = class { constructor(parts) { exportedCsv = parts.join(''); } };
  t.ctx.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
  t.ctx.document.createElement = () => ({ click() {} });
  t.ctx.document.body.removeChild = () => {};
  t.run('exportToCsv()');
  assert.match(exportedCsv, /日時,氏名,学校名,学年,交換景品,消費PT/);
  assert.match(exportedCsv, /"Kid's <script>","'=学校","1"/);
  t.elements.get('exchangeSearch').value = '';
  t.run('renderExchangeLogs()');
  const ranks = t.run('buildExchangeRanking(currentLogs)');
  assert.equal(ranks[0].name,'A'); assert.equal(ranks[0].count,2); assert.equal(ranks[0].rank,1);
  assert.equal(ranks[1].name,'B'); assert.equal(ranks[1].rank,1); assert.equal(ranks[2].rank,3);
  assert.ok(!t.elements.get('exchangeRanking').innerHTML.includes('<img src=x'));
  t.ctx.supabaseClient = {from() {return {select(){return this;},eq(){return this;},order(){return this;},range(){return Promise.resolve({data:[]});}};}};
  await t.run('loadExchangeLogs()');
  assert.equal(t.run('currentLogs.length'),0);
  assert.equal(t.elements.get('exchangeRanking').textContent,'交換履歴はありません。');

  // Supplied export: differing point prices still represent the same product.
  t.ctx.exported = [
    {product_name:'景品交換: ネコ',points:-50}, {product_name:'景品交換: fesfes',points:-50},
    {product_name:'景品交換: ネコ',points:-150}, {product_name:'景品交換: ネコ',points:-150},
    {product_name:'景品交換: fesfes',points:-50}, {product_name:'景品交換: 小',points:-100}
  ];
  const suppliedRanks = t.run('buildExchangeRanking(exported)');
  assert.equal(suppliedRanks[0].name,'ネコ'); assert.equal(suppliedRanks[0].count,3);
  assert.equal(suppliedRanks[1].name,'fesfes'); assert.equal(suppliedRanks[1].count,2);
  assert.equal(suppliedRanks[2].name,'小'); assert.equal(suppliedRanks[2].count,1);

  // A write that affects zero rows must not report success.
  t = context(['admin/js/product.js']);
  t.ctx.mutation = query({ data: null, error: null });
  t.ctx.mutation.delete = () => t.ctx.mutation;
  t.ctx.supabaseClient = { from: () => t.ctx.mutation };
  await t.run("deleteProduct('missing', '景品')");
  assert.match(t.alerts.at(-1), /対象が見つからない/);
  t.ctx.mutation.maybeSingle = async () => ({ data: { id: 'p' }, error: null });
  t.run('loadProducts = async () => {}');
  await t.run("deleteProduct('p', '景品')");
  assert.match(t.alerts.at(-1), /商品を削除しました/);

  // Dashboard counts checkins, not positive quiz point history.
  t = context(['admin/js/dashboard.js']);
  const tables = [];
  t.ctx.supabaseClient = { from(table) { tables.push(table); return query({count:table==='checkins'?2:3}); } };
  await t.run('loadTodayStats()');
  assert.deepEqual(tables, ['checkins','exchange_logs_view']);
  assert.match(t.elements.get('todayCheckins').innerHTML, /^2 /);
  console.log('PASS: syntax, escaping, CSV, pagination, staff exchange, quiz, QR and dashboard regressions');
})().catch(error => { console.error(error); process.exitCode=1; });
