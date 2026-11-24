import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = fileURLToPath(new URL('.', import.meta.url));
const env = process.env;
const appOrigin = env.APP_ORIGIN || env.RENDER_EXTERNAL_URL;
if (!appOrigin) throw new Error('APP_ORIGIN is required');
for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'STAFF_PASSWORD']) {
  if (!env[name]) throw new Error(name + ' is required');
}
const origin = new URL(appOrigin);
const upstream = new URL(env.SUPABASE_URL);
const secure = origin.protocol === 'https:';
const cookieName = secure ? '__Host-kcr_staff' : 'kcr_staff';
const username = env.STAFF_USERNAME || 'admin';
const lifetime = 8 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();

function keyRole(key) {
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; }
  catch { return null; }
}
if (appOrigin !== origin.origin ||
    (!secure && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))) {
  throw new Error('APP_ORIGIN must be an HTTPS origin or local HTTP');
}
if (env.SUPABASE_URL.replace(/\/$/, '') !== upstream.origin ||
    (upstream.protocol !== 'https:' && !(upstream.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(upstream.hostname)))) {
  throw new Error('SUPABASE_URL must be an HTTPS origin or local HTTP');
}
if (!env.SUPABASE_ANON_KEY.startsWith('sb_publishable_') && keyRole(env.SUPABASE_ANON_KEY) !== 'anon') {
  throw new Error('SUPABASE_ANON_KEY must be a public key');
}
if (!env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_') && keyRole(env.SUPABASE_SERVICE_ROLE_KEY) !== 'service_role') {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY must be a server key');
}

const readMethods = ['GET', 'HEAD'];
const restMethods = {
  profiles: readMethods, staff_exchange_logs: readMethods, exchange_logs_view: readMethods,
  checkins: [...readMethods, 'PATCH', 'DELETE'],
  events: [...readMethods, 'POST', 'PATCH', 'DELETE'],
  products: [...readMethods, 'POST', 'PATCH', 'DELETE'],
  qr_codes: ['POST']
};
const staffFunctions = new Set(['create_quiz_set', 'get_quiz_management', 'update_quiz_set', 'update_quiz', 'delete_quiz_set', 'delete_quiz']);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'
};
const staticFile = /^\/(?:index\.html|(?:home|login|signup|profile|qr|quiz|history|exchange|dept|games)\.html|manifest\.json|admin\/[a-z]+\.html|(?:admin\/)?(?:js\/[a-z-]+\.js|css\/[a-z-]+\.css)|icons\/[a-z0-9-]+\.(?:png|svg))$/;

function json(res, code, value) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
function redirect(res, location) {
  res.writeHead(303, { Location: location });
  res.end();
}
function cookie(token, seconds) {
  return cookieName + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + seconds + (secure ? '; Secure' : '');
}
function sessionToken(req) {
  const match = (req.headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(cookieName + '='));
  return match?.slice(cookieName.length + 1);
}
function authorized(token) {
  const expires = sessions.get(token);
  return Boolean(expires && expires > Date.now());
}
function equals(value, expected) {
  const digest = input => createHash('sha256').update(input).digest();
  return timingSafeEqual(digest(value), digest(expected));
}
async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw Object.assign(new Error('Request too large'), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function allowProxy(path, method) {
  const table = /^\/rest\/v1\/([a-z_]+)$/.exec(path)?.[1];
  if (table) return Object.hasOwn(restMethods, table) && restMethods[table].includes(method);
  const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path)?.[1];
  if (rpc) return method === 'POST' && staffFunctions.has(rpc);
  return method === 'POST' && /^\/storage\/v1\/object\/product-images\/[a-z0-9_]+\.jpg$/.test(path);
}
async function proxy(req, res, path, url) {
  const method = req.method;
  if (!allowProxy(path, method)) return json(res, 404, { message: '対象の操作がありません。' });
  if (url.searchParams.getAll('select').some(value => !/^(?:\*|[a-z_]+(?:,[a-z_]+)*)$/.test(value))) {
    return json(res, 400, { message: '対象の項目を指定してください。' });
  }
  const headers = new Headers({ apikey: env.SUPABASE_SERVICE_ROLE_KEY });
  if (!env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_secret_')) {
    headers.set('Authorization', 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY);
  }
  for (const name of ['accept', 'content-type', 'prefer', 'range', 'range-unit', 'x-upsert', 'cache-control']) {
    if (req.headers[name]) headers.set(name, req.headers[name]);
  }
  const body = readMethods.includes(method) ? undefined : await readBody(req, 4 * 1024 * 1024);
  const response = await fetch(upstream.origin + path + url.search, {
    method, headers, body, redirect: 'error', signal: AbortSignal.timeout(30000)
  });
  const details = {};
  for (const key of ['content-type', 'content-range', 'range-unit', 'preference-applied']) {
    if (response.headers.has(key)) details[key] = response.headers.get(key);
  }
  res.writeHead(response.status, details);
  if (response.body) await pipeline(Readable.fromWeb(response.body), res);
  else res.end();
}
function prune() {
  const now = Date.now();
  for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
  for (const [ip, entry] of attempts) if (entry.expires <= now) attempts.delete(ip);
}
setInterval(prune, 60000).unref();

async function staffLogin(req, res, token) {
  const ip = req.socket.remoteAddress;
  const now = Date.now();
  const previous = attempts.get(ip);
  const entry = previous?.expires > now ? previous : { count: 0, expires: now + 5 * 60000 };
  if (entry.count >= 10) {
    res.setHeader('Retry-After', Math.ceil((entry.expires - now) / 1000));
    return redirect(res, '/admin/login.html?error=limit');
  }
  if (attempts.size >= 5000 && !previous) return json(res, 429, { message: 'しばらく待ってからお試しください。' });
  entry.count++;
  attempts.set(ip, entry);
  const form = new URLSearchParams((await readBody(req, 4096)).toString());
  const userMatches = equals(form.get('username') || '', username);
  const passwordMatches = equals(form.get('password') || '', env.STAFF_PASSWORD);
  if (!userMatches || !passwordMatches) return redirect(res, '/admin/login.html?error=credentials');
  if (sessions.size >= 1000 && !authorized(token)) return json(res, 503, { message: 'しばらく待ってからお試しください。' });
  attempts.delete(ip);
  sessions.delete(token);
  const newToken = randomBytes(32).toString('base64url');
  sessions.set(newToken, Date.now() + lifetime);
  res.setHeader('Set-Cookie', cookie(newToken, lifetime / 1000));
  return redirect(res, '/admin/index.html');
}

async function handle(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  const url = new URL(req.url, origin);
  let path = url.pathname;
  const method = req.method;
  if (!readMethods.includes(method) && req.headers.origin !== origin.origin) {
    return json(res, 403, { message: 'リクエスト元を確認できません。' });
  }
  const token = sessionToken(req);
  if (path === '/api/staff/login' && method === 'POST') return staffLogin(req, res, token);
  if (path === '/api/staff/logout' && method === 'POST') {
    sessions.delete(token);
    res.setHeader('Set-Cookie', cookie('', 0));
    return redirect(res, '/admin/login.html');
  }
  if (path === '/api/config' && method === 'GET') {
    return json(res, 200, { url: upstream.origin, publicKey: env.SUPABASE_ANON_KEY });
  }
  if (path.startsWith('/api/staff/')) {
    if (!authorized(token)) return json(res, 401, { message: 'スタッフとしてログインしてください。' });
    return proxy(req, res, path.slice('/api/staff'.length), url);
  }
  if (!readMethods.includes(method)) return json(res, 405, { message: 'この操作は許可されていません。' });
  if (path === '/admin' || path === '/admin/') path = '/admin/index.html';
  if (path.startsWith('/admin/') && path !== '/admin/login.html' && !authorized(token)) {
    return redirect(res, '/admin/login.html');
  }
  if (path === '/admin/login.html' && authorized(token)) return redirect(res, '/admin/index.html');
  if (path === '/') path = '/index.html';
  if (!staticFile.test(path)) return json(res, 404, { message: 'ページが見つかりません。' });
  const file = join(root, path);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return json(res, 404, { message: 'ページが見つかりません。' });
  res.writeHead(200, { 'Content-Type': types[extname(file)], 'Content-Length': info.size });
  if (method === 'HEAD') res.end();
  else await pipeline(createReadStream(file), res);
}

const server = createServer((req, res) => {
  handle(req, res).catch(error => {
    if (res.headersSent) return res.destroy();
    const code = error.status || 502;
    json(res, code, { message: code === 413 ? 'リクエストが大きすぎます。' : 'サーバーで処理できませんでした。' });
  });
});
const port = Number(env.PORT || 8080);
server.listen(port, env.HOST || '127.0.0.1', () => console.log('KCR Campus listening on port ' + server.address().port));
