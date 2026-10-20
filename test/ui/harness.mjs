// Servidores de teste: app estático (:PORT), licença+Xtream simulados (com CORS) e o servidor REAL de vinculação do projeto.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const serverDir = process.env.VIONZA_SERVER_DIR || path.resolve(root, '../vionza-server');
const S = await import(path.join(serverDir, 'src/crypto.js'));
const keys = S.generateSigningKeys(), sign = S.makeSigner(keys.privateB64);
const pairPort = 21000 + Math.floor(Math.random() * 5000), senderToken = 'tok_' + crypto.randomBytes(16).toString('hex');
const pair = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { cwd: serverDir, env: { ...process.env, PAIR_ONLY: '1', PORT: String(pairPort), SENDER_TOKEN: senderToken, NODE_ENV: 'development' }, stdio: 'ignore' });
process.on('exit', () => pair.kill());

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
let licState = process.env.LIC_STATE || 'none', now = Date.now();
const live = [{ stream_id: 1, name: 'Canal Um', category_id: '1' }, { stream_id: 2, name: 'Canal Dois', category_id: '1' }, { stream_id: 3, name: 'Canal Adulto', category_id: '2' }];
const movies = Array.from({ length: 130 }, (_, i) => ({ stream_id: 100 + i, name: 'Filme ' + String(i + 1).padStart(3, '0') + (i % 7 === 0 ? ' Ação' : ''), category_id: '5', container_extension: 'webm', stream_icon: '' }));
const J = (res, o, st = 200) => { res.writeHead(st, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });

const api = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (u.pathname.startsWith('/api/v1/pair/') || u.pathname.startsWith('/api/v1/sender/')) { // repassa ao servidor real
    const r = await fetch('http://127.0.0.1:' + pairPort + u.pathname, { method: req.method, headers: { 'content-type': 'application/json', 'x-sender-token': senderToken }, body: req.method === 'POST' ? await body(req) : undefined });
    res.writeHead(r.status, { 'content-type': 'application/json', ...CORS }); return res.end(await r.text());
  }
  if (u.pathname.startsWith('/api/v1/license/')) {
    const b = JSON.parse(await body(req)), op = u.pathname.split('/').pop();
    globalThis.__lastLicense = b;
    if (op === 'trial' && licState === 'none') licState = 'trial_active';
    const st = licState, active = st === 'trial_active' || st === 'active';
    const payload = JSON.stringify({ v: 1, iid: b.installId, state: st, plan: active ? 'trial' : null, exp: active ? now + 7 * 864e5 : null, life: false, iat: Date.now(), grace: 24 * 36e5 });
    const out = { ok: true, state: st, plan: null, expiresAt: active ? now + 7 * 864e5 : null, lifetime: false, trialEligible: st === 'none', contact: 'Fale com a sua revenda no WhatsApp.', productName: 'Vionza Play', prices: { currency: 'BRL', annualCents: 2500, lifetimeCents: 7000 }, serverTime: Date.now() };
    if (active || st === 'expired') { out.token = Buffer.from(payload).toString('base64url'); out.sig = sign(payload); }
    return J(res, out);
  }
  if (u.pathname === '/__state') { if (u.searchParams.get('lic')) licState = u.searchParams.get('lic'); return J(res, { licState, last: globalThis.__lastLicense || null }); }
  if (u.pathname === '/__senderToken') return J(res, { token: senderToken, pairPort });
  if (u.pathname === '/player_api.php') {
    const a = u.searchParams.get('action');
    if (u.searchParams.get('username') !== 'joao') return J(res, { user_info: { auth: 0 } });
    if (!a) return J(res, { user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 99999) } });
    const cat = u.searchParams.get('category_id');
    if (a === 'get_live_categories') return J(res, [{ category_id: '1', category_name: 'Abertos' }, { category_id: '9', category_name: 'Destaques do Dia' }, { category_id: '2', category_name: 'Adultos XXX' }]);
    if (a === 'get_live_streams') return J(res, live.filter((x) => x.category_id === cat || (cat === '9' && x.stream_id === 1)));
    if (a === 'get_vod_categories') return J(res, [{ category_id: '5', category_name: 'Ação' }, { category_id: '6', category_name: 'Comédia' }]);
    if (a === 'get_vod_streams') return J(res, cat === '5' ? movies : []);
    if (a === 'get_series_categories') return J(res, [{ category_id: '7', category_name: 'Séries' }]);
    if (a === 'get_series') return J(res, [{ series_id: 50, name: 'Série Teste', cover: '', category_id: '7' }]);
    if (a === 'get_series_info') return J(res, { info: { name: 'Série Teste', plot: 'Uma série de exemplo para testar temporadas e episódios na TV.' }, episodes: { 1: [{ id: '501', episode_num: 1, title: 'Piloto', container_extension: 'webm' }, { id: '502', episode_num: 2, title: 'Segundo', container_extension: 'webm' }], 2: [{ id: '601', episode_num: 1, title: 'Volta', container_extension: 'webm' }] } });
    return J(res, []);
  }
  const m = /^\/(movie|series|live)\/[^/]+\/[^/]+\/.+$/.exec(u.pathname);
  if (m) { const f = path.join(here, 'clip.webm'), st = fs.statSync(f), r = req.headers.range;
    if (r) { const [a, b] = r.replace('bytes=', '').split('-'), s = Number(a), e = b ? Number(b) : st.size - 1; res.writeHead(206, { 'content-type': 'video/webm', 'content-range': `bytes ${s}-${e}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': e - s + 1, ...CORS }); return fs.createReadStream(f, { start: s, end: e }).pipe(res); }
    res.writeHead(200, { 'content-type': 'video/webm', 'content-length': st.size, 'accept-ranges': 'bytes', ...CORS }); return fs.createReadStream(f).pipe(res); }
  res.writeHead(404, CORS); res.end();
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));
const apiPort = api.address().port;

// app estático com config de teste
const dist = path.join(root, 'dist', 'app');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const web = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = u.pathname === '/' ? '/index.html' : u.pathname;
  if (p === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.VZ_CONFIG=' + JSON.stringify({ LICENSE_URL: 'http://127.0.0.1:' + apiPort, PAIR_URL: 'http://127.0.0.1:' + apiPort, LICENSE_PUBLIC_KEY: keys.publicB64, VERSION: '0.1.0', VERSION_CODE: 100 }) + ';'); }
  const f = path.join(dist, p.replace(/\.\./g, ''));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(fs.readFileSync(f));
});
await new Promise((r) => web.listen(0, '127.0.0.1', r));
console.log('READY ' + JSON.stringify({ web: web.address().port, api: apiPort, pair: pairPort, token: senderToken }));
