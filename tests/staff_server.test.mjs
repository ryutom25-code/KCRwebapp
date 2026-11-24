import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';

test('HTTPS deployment accepts the configured shared login and keeps the service key server-side', async t => {
  const secret = 'sb_secret_test_key';
  const publishable = 'sb_publishable_test_key';
  const publicOrigin = 'https://campus.test';
  const requests = [];
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify([{ user_name: '交換テスト' }]));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  t.after(() => { upstream.close(); upstream.closeAllConnections(); });

  const supabaseUrl = 'http://127.0.0.1:' + upstream.address().port;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: {
      ...process.env, HOST: '127.0.0.1', PORT: '0', APP_ORIGIN: '', RENDER_EXTERNAL_URL: publicOrigin,
      STAFF_USERNAME: 'admin', STAFF_PASSWORD: 'admin', SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: publishable, SUPABASE_SERVICE_ROLE_KEY: secret
    }
  });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => reject(new Error('Node.js exited with code ' + code)));
    child.stderr.on('data', data => reject(new Error(data.toString())));
    child.stdout.on('data', data => {
      const match = /listening on port (\d+)/.exec(data.toString());
      if (match) resolve(match[1]);
    });
  });
  const call = (url, options) => fetch('http://127.0.0.1:' + port + url, { redirect: 'manual', ...options });
  const endpoint = '/api/staff/rest/v1/staff_exchange_logs';
  const login = (password, origin = publicOrigin) => call('/api/staff/login', {
    method: 'POST', headers: { origin }, body: new URLSearchParams({ username: 'admin', password })
  });

  let response = await call('/admin/index.html');
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/admin/login.html');
  assert.equal((await call('/admin/login.html')).status, 200);
  assert.equal((await call(endpoint)).status, 401);
  assert.equal((await call('/.env')).status, 404);
  assert.equal((await call('/server.mjs')).status, 404);
  assert.deepEqual(await (await call('/api/config')).json(), { url: supabaseUrl, publicKey: publishable });
  assert.equal(requests.length, 0);

  response = await login('wrong');
  assert.equal(response.headers.get('location'), '/admin/login.html?error=credentials');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal((await login('admin', 'https://foreign.test')).status, 403);
  response = await login('admin');
  assert.equal(response.headers.get('location'), '/admin/index.html');
  const staffCookie = response.headers.get('set-cookie');
  assert.match(staffCookie, /^__Host-kcr_staff=[A-Za-z0-9_-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
  const cookie = staffCookie.split(';')[0];
  const session = { cookie };
  assert.equal((await call('/admin/exchange.html', { headers: session })).status, 200);
  assert.equal((await call('/api/staff/auth/v1/admin/users', { headers: session })).status, 404);
  assert.equal((await call(endpoint + '?select=profiles(*)', { headers: session })).status, 400);
  assert.equal((await call('/api/staff/rest/v1/rpc/get_quiz_management', {
    method: 'POST', headers: { ...session, origin: 'https://foreign.test' }
  })).status, 403);
  assert.equal(requests.length, 0);

  response = await call(endpoint + '?select=user_name', {
    headers: { ...session, authorization: 'Bearer client-value', range: '0-499' }
  });
  assert.deepEqual(await response.json(), [{ user_name: '交換テスト' }]);
  assert.equal(response.headers.get('content-range'), '0-0/1');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(requests[0].headers.apikey, secret);
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].headers.cookie, undefined);
  assert.equal(requests[0].headers.range, '0-499');
  assert.equal(requests[0].url, '/rest/v1/staff_exchange_logs?select=user_name');

  response = await call('/api/staff/rest/v1/checkins?select=id', { method: 'HEAD', headers: session });
  assert.equal(response.headers.get('content-range'), '0-0/1');
  assert.equal(requests[1].method, 'HEAD');
  response = await call('/api/staff/rest/v1/rpc/get_quiz_management', {
    method: 'POST', headers: { ...session, origin: publicOrigin, 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(response.status, 200);
  assert.equal(requests[2].body, '{}');

  response = await call('/api/staff/logout', { method: 'POST', headers: { ...session, origin: publicOrigin } });
  assert.match(response.headers.get('set-cookie'), /Max-Age=0; Secure/);
  assert.equal((await call(endpoint, { headers: session })).status, 401);

  for (let i = 0; i < 10; i++) {
    assert.equal((await login('wrong')).headers.get('location'), '/admin/login.html?error=credentials');
  }
  response = await login('wrong');
  assert.equal(response.headers.get('location'), '/admin/login.html?error=limit');
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});
