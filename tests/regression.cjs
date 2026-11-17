// Run with Node.js 18+: node tests/regression.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function context(files) {
  const elements = new Map();
  function element() { return { textContent: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
    listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelectorAll() { return []; }, querySelector() { return element(); }, appendChild() {} }; }
  const document = { baseURI: 'https://example.test/app/', readyState: 'complete', body: element(),
    addEventListener() {}, querySelectorAll() { return []; },
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
  const alerts = [], timers = [];
  const sandbox = { document, URL, console, crypto: require('node:crypto').webcrypto,
    setTimeout(fn) { timers.push(fn); }, clearTimeout() {},
    alert(message) { alerts.push(message); }, confirm() { return true; }, supabaseInitPromise: Promise.resolve() };
  sandbox.window = sandbox;
  sandbox.location = { replace(url) { sandbox.redirect = url; } };
  const ctx = vm.createContext(sandbox);
  for (const file of ['js/common.js', ...files]) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  return { ctx, elements, alerts, timers, run: code => vm.runInContext(code, ctx) };
}
function query(result) {
  const q = { then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
  for (const method of ['select', 'eq', 'order', 'single', 'gte', 'or']) q[method] = () => q;
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
  // Management initialization must not require a session or an is_admin RPC.
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

  // Apostrophes, quotes and HTML in a product never enter an inline handler.
  t = context(['js/exchange.js']);
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

  // Unknown QR rejection is passed through; there is no local fallback award.
  t = context(['js/qr.js']);
  t.ctx.supabaseClient = { rpc: async (name, args) => {
    assert.equal(name,'record_checkin'); assert.equal(args.p_code,'https://unrelated.test');
    return {error:{message:'未登録QR'}};
  } };
  await assert.rejects(t.run("handleScanSuccess({id:'u'}, 'https://unrelated.test')"), /未登録QR/);
  await assert.rejects(t.run("handleScanSuccess({id:'u'}, 'EXCHANGE_BOOTH')"), /景品交換用/);

  // A camera facing the same department should not hammer the API during cooldown.
  t = context(['js/qr.js']);
  let scanCalls = 0;
  t.ctx.supabaseClient = {rpc:async()=>{scanCalls++;return {data:{cooldown:false,earnedPoints:50,newPoints:50,departmentName:'理学療法学科',nextAllowedAt:new Date(Date.now()+3600000).toISOString()}};}};
  assert.equal((await t.run("handleScanSuccess({id:'u'}, 'PT')")).earnedPoints,50);
  assert.equal((await t.run("handleScanSuccess({id:'u'}, 'welcome:PT')")).cooldown,true);
  assert.equal(scanCalls,1);
  await t.run("handleScanSuccess({id:'u'}, 'OT')");
  assert.equal(scanCalls,2);
  await t.run("handleScanSuccess({id:'other'}, 'PT')");
  assert.equal(scanCalls,3);

  // The exchange view is the only data source; no category column or FK is required.
  t = context(['admin/js/exchange.js']);
  const history = [
    {id:1,user_id:'u',product_name:'景品交換: A',points:-50,created_at:'2026-11-17T01:00:00Z'},
    {id:2,user_id:'missing',product_name:'景品交換: B',points:-50,created_at:'2026-11-17T02:00:00Z'},
    {id:3,user_id:'u',product_name:'景品交換: A',points:-100,created_at:'2026-11-17T03:00:00Z'},
    {id:4,user_id:'u',product_name:'景品交換：B',points:-50,created_at:'2026-11-17T04:00:00Z'},
    {id:5,user_id:'u',product_name:'景品交換: <img src=x onerror=alert(1)>',points:-50,created_at:'2026-11-17T05:00:00Z'}
  ];
  history[0].user_name = "Kid's <script>";
  history[0].school_name = '学校';
  t.ctx.supabaseClient = {from(table) {
    assert.equal(table,'exchange_logs_view');
    const rows = history;
    const q = {select(columns) { assert.ok(!columns.includes('profiles')); return q; },
      order() { return q; }, range(start,end) { return Promise.resolve({data:rows.slice(start,end+1)}); }};
    return q;
  }};
  await t.run('loadExchangeLogs()');
  assert.equal(t.elements.get('recordCount').textContent,'5 件');
  assert.match(t.elements.get('exchangeTableBody').innerHTML,/Kid&#39;s &lt;script&gt;/);
  assert.match(t.elements.get('exchangeTableBody').innerHTML,/名称未設定/);
  assert.equal(t.run('currentLogs[0].school_name'),'学校');
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

  // Dashboard counts checkins, not positive quiz point history.
  t = context(['admin/js/dashboard.js']);
  const tables = [];
  t.ctx.supabaseClient = { from(table) { tables.push(table); return query({count:table==='checkins'?2:3}); } };
  await t.run('loadTodayStats()');
  assert.deepEqual(tables, ['checkins','point_history']);
  assert.match(t.elements.get('todayCheckins').innerHTML, /^2 /);
  console.log('PASS: syntax, escaping, CSV, pagination, login-free management, exchange, quiz, QR and dashboard regressions');
})().catch(error => { console.error(error); process.exitCode=1; });
