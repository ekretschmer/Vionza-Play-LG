import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const J = (f) => require(path.join(here, '../src/js', f));
const U = J('util.js'), R = J('rules.js'), M = J('m3u.js'), X = J('xtream.js'), P = J('pairing.js'), L = J('license.js');
const subtle = globalThis.crypto.subtle;

test('util: base64url, hash16 estável, fold', () => {
  const b = new Uint8Array([251, 255, 0, 1, 2]);
  assert.equal(U.b64uEncode(b), Buffer.from(b).toString('base64url'));
  assert.deepEqual(Array.from(U.b64Decode(Buffer.from(b).toString('base64url'))), Array.from(b));
  assert.equal(U.b64Decode('a$b'), null); assert.equal(U.b64Decode('abcde'), null);
  assert.equal(U.hash16('a'), U.hash16('a')); assert.notEqual(U.hash16('a'), U.hash16('b')); assert.match(U.hash16('x'), /^[0-9a-f]{16}$/);
  assert.equal(U.fold('Ação ÉÍ'), 'acao ei');
});

test('regras: adulto, A–Z natural, destaques', () => {
  assert.equal(R.adultByMetadata('Adultos XXX', ''), true);
  assert.equal(R.adultByMetadata('Adult Swim', ''), false);
  assert.equal(R.adultByMetadata('Filmes +18', ''), true);
  assert.equal(R.adultByMetadata('Esportes', 'ESPN'), false);
  assert.deepEqual(R.sortedBy(['Z', 'a10', 'a2', 'Ábaco'], (x) => x), ['a2', 'a10', 'Ábaco', 'Z']);
  assert.deepEqual(R.adultLast(['Adultos', 'Filmes', 'Séries'], (x) => x), ['Filmes', 'Séries', 'Adultos']);
  assert.equal(R.featured(['A', 'Destaques do Dia'], (x) => x), 'Destaques do Dia');
});

test('m3u: itens, grupos, tipo, EPG, erros', () => {
  const txt = '#EXTM3U url-tvg="http://e.com/x.xml"\n#EXTINF:-1 tvg-id="g1" tvg-logo="http://l/1.png" group-title="Canais, HD",Globo HD\nhttp://s/live/1.ts\n#EXTINF:-1 group-title="Filmes",Matrix\nhttp://s/movie/u/p/2.mp4\nhttp://s/solto.mp4\n';
  const r = M.parse(txt);
  assert.equal(r.items.length, 3); assert.deepEqual(r.epgUrls, ['http://e.com/x.xml']);
  assert.equal(r.items[0].name, 'Globo HD'); assert.equal(r.items[0].group, 'Canais, HD'); assert.equal(r.items[0].kind, 'live'); assert.equal(r.items[0].logo, 'http://l/1.png');
  assert.equal(r.items[1].kind, 'movie'); assert.equal(r.items[2].name, 'solto.mp4'); assert.equal(r.items[2].group, 'Outros');
  const code = (t) => { try { M.parse(t); } catch (e) { return e.code; } };
  assert.equal(code(''), 'empty_list'); assert.equal(code('olá mundo'), 'bad_format'); assert.equal(code('#EXTM3U\n#EXT-X-TARGETDURATION:6\n'), 'hls_manifest'); assert.equal(code('#EXTM3U\n'), 'empty_items');
});

test('xtream: base, autenticação, pastas e itens por pasta, URLs só na hora de tocar', async () => {
  assert.equal(X.base('meu.srv:8080/get.php?username=a'), 'http://meu.srv:8080');
  assert.equal(X.base('https://x.com/c/'), 'https://x.com/c');
  assert.throws(() => X.base('ftp://x.com'));
  const conn = { type: 'xtream', url: 'http://srv:8081', user: 'jo ao', pass: 'p&s' };
  const calls = [];
  const getText = async (url) => {
    calls.push(url);
    if (!url.includes('action=')) return JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: String(Math.floor(Date.now() / 1000) + 99999) } });
    if (url.includes('get_live_categories')) return JSON.stringify([{ category_id: '1', category_name: 'Abertos' }, { category_id: '2', category_name: 'Adultos' }]);
    if (url.includes('get_live_streams&category_id=1')) return JSON.stringify([{ stream_id: 10, name: 'Globo', stream_icon: 'http://i/g.png', epg_channel_id: 'globo.br' }, { stream_id: '', name: 'x' }]);
    if (url.includes('get_vod_streams')) return JSON.stringify([{ stream_id: 7, name: 'Matrix', container_extension: 'mkv', is_adult: '0' }]);
    if (url.includes('get_series_info')) return JSON.stringify({ info: { name: 'Série X', plot: 'p' }, episodes: { 2: [{ id: '22', episode_num: 1, title: 'E1', container_extension: 'mp4', info: { duration_secs: 60 } }], 1: [{ id: '11', episode_num: 2, title: 'B' }, { id: '10', episode_num: 1, title: 'A' }] } });
    return 'x';
  };
  assert.equal((await X.authenticate(getText, conn)).status, 'Active');
  const cats = await X.categories(getText, conn, 'live'); assert.deepEqual(cats.map((c) => c.name), ['Abertos', 'Adultos']);
  const its = await X.items(getText, conn, 'live', cats[0]);
  assert.equal(its.length, 1); assert.equal(its[0].sid, '10'); assert.equal(its[0].group, 'Abertos');
  assert.ok(!JSON.stringify(its).includes('p&s') && !JSON.stringify(its).includes('jo%20ao'), 'itens não guardam usuário/senha');
  assert.equal(X.playUrl(conn, its[0]), 'http://srv:8081/live/jo%20ao/p%26s/10.m3u8');
  const mv = await X.items(getText, conn, 'movie', { id: '5', name: 'Filmes' });
  assert.equal(X.playUrl(conn, mv[0]), 'http://srv:8081/movie/jo%20ao/p%26s/7.mkv'); assert.equal(mv[0].adultFlag, false);
  const si = await X.seriesInfo(getText, conn, '9');
  assert.equal(si.title, 'Série X'); assert.deepEqual(si.seasons.map((s) => s.number), [1, 2]); assert.deepEqual(si.seasons[0].episodes.map((e) => e.title), ['A', 'B']);
  assert.ok(si.seasons[1].episodes[0].url.endsWith('/series/jo%20ao/p%26s/22.mp4'));
  const bad = async () => JSON.stringify({ user_info: { auth: 0 } });
  await assert.rejects(() => X.authenticate(bad, conn), (e) => e.code === 'xt_auth');
  const old = async () => JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: '1000' } });
  await assert.rejects(() => X.authenticate(old, conn), (e) => e.code === 'xt_expired');
});

// ---------- vinculação: interoperabilidade com o SERVIDOR REAL ----------
const serverDir = process.env.VIONZA_SERVER_DIR || path.resolve(here, '../../vionza-server');
const haveServer = fs.existsSync(path.join(serverDir, 'src/server.js'));
async function startServer() {
  const { spawn } = await import('node:child_process');
  const port = 20000 + Math.floor(Math.random() * 20000), token = 'tok_' + crypto.randomBytes(16).toString('hex');
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], { cwd: serverDir, env: { ...process.env, PAIR_ONLY: '1', PORT: String(port), SENDER_TOKEN: token, NODE_ENV: 'development' }, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(base + '/api/v1/pair/ABCDEFGHJKMN/state'); if (r.status) break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  return { base, token, stop: () => child.kill() };
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function senderEncrypt(tvPubB64, id, payload) {
  const tvPub = await subtle.importKey('raw', Buffer.from(tvPubB64, 'base64url'), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: tvPub }, eph.privateKey, 256);
  const hk = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const enc = new TextEncoder();
  const aes = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(id), info: enc.encode('vionza-ecdh-v1') }, hk, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const epk = await subtle.exportKey('raw', eph.publicKey), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(id) }, aes, enc.encode(JSON.stringify(payload)));
  return { epk: b64u(epk), ct: b64u(ct), iv: b64u(iv) };
}
const jpost = async (base, p, body, headers = {}) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };

test('vinculação: payload validado como no Android', () => {
  assert.deepEqual(P.parsePayload('{"v":1,"type":"xtream","name":"A\\nB","url":"srv:81/get.php?x=1","user":"u","pass":"p"}'), { type: 'xtream', name: 'A B', url: 'http://srv:81', user: 'u', pass: 'p' });
  assert.equal(P.parsePayload('{"v":2,"type":"m3u","url":"http://x"}'), null);
  assert.equal(P.parsePayload('{"v":1,"type":"xtream","url":"http://x","user":"","pass":"p"}'), null);
  assert.equal(P.parsePayload('{"v":1,"type":"m3u","url":"ftp://x"}'), null);
  assert.equal(P.serverOk('http://a.com'), false); assert.equal(P.serverOk('https://a.com'), true); assert.equal(P.serverOk('http://localhost:3000'), true);
});

test('vinculação: decifra QR (AES-GCM) e rejeita id/adulteração', async () => {
  const key = crypto.randomBytes(32), id = 'ABCDEFGHJKMN', iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); c.setAAD(Buffer.from(id));
  const ct = Buffer.concat([c.update('olá'), c.final(), c.getAuthTag()]);
  assert.equal(await P.decryptSym(new Uint8Array(key), id, b64u(ct), b64u(iv)), 'olá');
  assert.equal(await P.decryptSym(new Uint8Array(key), 'OUTROID12345', b64u(ct), b64u(iv)), null);
  const bad = Buffer.from(ct); bad[0] ^= 1;
  assert.equal(await P.decryptSym(new Uint8Array(key), id, b64u(bad), b64u(iv)), null);
});

test('servidor real: ID + chave (ECDH) entrega a lista à TV LG', { skip: !haveServer && 'servidor não encontrado' }, async () => {
  const srv = await startServer();
  try {
    const flow = new P.PairFlow(srv.base, { pollMs: 50 });
    const v = await flow.start();
    assert.match(v.id, /^[A-HJKMNP-Z2-9]{12}$/); assert.match(v.pinText, /^\d{3} \d{3}$/); assert.match(v.idText, /^\w{4}-\w{4}-\w{4}$/);
    const pin = v.pinText.replace(' ', ''), H = { 'x-sender-token': srv.token };
    const bad = await jpost(srv.base, '/api/v1/sender/lookup', { id: v.id, pin: pin === '000000' ? '111111' : '000000' }, H);
    assert.equal(bad.body.error, 'bad_pin');
    const lk = await jpost(srv.base, '/api/v1/sender/lookup', { id: v.id, pin }, H);
    assert.equal(lk.status, 200);
    const sealed = await senderEncrypt(lk.body.pub, v.id, { v: 1, type: 'xtream', name: 'Cliente', url: 'http://srv.example:8080', user: 'joao', pass: 'segredo' });
    assert.equal((await jpost(srv.base, '/api/v1/sender/submit', { id: v.id, pin, ...sealed }, H)).body.ok, true);
    assert.deepEqual(await flow.wait(), { type: 'xtream', name: 'Cliente', url: 'http://srv.example:8080', user: 'joao', pass: 'segredo' });
  } finally { srv.stop(); }
});

test('servidor real: QR (chave no #k=) entrega a lista à TV LG', { skip: !haveServer && 'servidor não encontrado' }, async () => {
  const srv = await startServer();
  try {
    const flow = new P.PairFlow(srv.base, { pollMs: 50 });
    const v = await flow.start();
    const keyB64 = new URL(v.qr).hash.replace('#k=', '');
    const key = await subtle.importKey('raw', Buffer.from(keyB64, 'base64url'), 'AES-GCM', false, ['encrypt']), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(v.id) }, key, new TextEncoder().encode(JSON.stringify({ v: 1, type: 'm3u', name: 'QR', url: 'https://x.com/a.m3u' })));
    const r = await jpost(srv.base, '/api/v1/pair/' + v.id + '/submit', { ct: b64u(ct), iv: b64u(iv) });
    assert.ok(r.status === 200 || r.status === 204 || r.body.ok, 'submit ' + r.status + JSON.stringify(r.body));
    assert.deepEqual(await flow.wait(), { type: 'm3u', name: 'QR', url: 'https://x.com/a.m3u', user: '', pass: '' });
  } finally { srv.stop(); }
});

// ---------- licença ----------
const S = await import(path.join(serverDir, 'src/crypto.js'));
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('licença: DER -> raw e verificação da assinatura do servidor', async () => {
  const k = S.generateSigningKeys(), sign = S.makeSigner(k.privateB64);
  for (let i = 0; i < 30; i++) { // várias assinaturas: cobre r/s com zero à esquerda e bit alto
    const payload = JSON.stringify({ v: 1, iid: 'AAAA-BBBB-CCCC', state: 'active', plan: 'annual', exp: Date.now() + 1e9, life: false, iat: Date.now(), grace: 86400000, n: i });
    const p = await L.verify(k.publicB64, b64u(payload), sign(payload));
    assert.ok(p && p.installId === 'AAAA-BBBB-CCCC' && p.state === 'active', 'assinatura ' + i);
  }
  const payload = JSON.stringify({ iid: 'X', state: 'active', iat: 1 }), sig = sign(payload);
  assert.equal(await L.verify(k.publicB64, b64u(payload + ' '), sig), null, 'payload adulterado');
  assert.equal(await L.verify(S.generateSigningKeys().publicB64, b64u(payload), sig), null, 'outra chave');
  assert.equal(await L.verify(k.publicB64, b64u(payload), 'AAAA'), null);
});

test('licença: decisão (vencimento, tolerância offline, relógio)', () => {
  const p = { installId: 'I', state: 'active', plan: 'annual', expiresAt: 10_000_000, lifetime: false, issuedAt: 1_000_000, graceMs: 100_000 };
  const rx = { session: 's', perf: 50, wall: 1_000_000 };
  const ctx = (o) => Object.assign({ session: 's', perf: 50, wall: 1_000_000, wallFloor: 1_000_000 }, o);
  assert.equal(L.decide(p, rx, ctx({})).allowed, true);
  assert.equal(L.decide(p, rx, ctx({ perf: 50 + 100_001 })).why, 'offline_too_long');
  assert.equal(L.decide({ ...p, graceMs: 99e9 }, rx, ctx({ perf: 50 + 9_000_001 })).why, 'expired');
  assert.equal(L.decide({ ...p, lifetime: true, expiresAt: null, graceMs: 99e9 }, rx, ctx({ perf: 50 + 9e9 })).allowed, true);
  const other = ctx({ session: 'novo', perf: 1 });
  assert.equal(L.decide(p, rx, { ...other, wall: 999_000 }).why, 'clock', 'relógio voltou');
  assert.equal(L.decide(p, rx, { ...other, wall: 1_050_000 }).allowed, true, 'reinício: relógio de parede coerente');
  assert.equal(L.decide({ ...p, state: 'revoked' }, rx, ctx({})).why, 'revoked');
  assert.equal(L.decide(null, null, ctx({})).why, 'no_license');
});

test('licença: fluxo completo com o servidor simulado (assina de verdade)', async () => {
  const k = S.generateSigningKeys(), sign = S.makeSigner(k.privateB64);
  let state = 'none', t0 = 1_800_000_000_000, requests = [];
  const fetchFn = async (url, opts) => {
    const body = JSON.parse(opts.body); requests.push({ url, body });
    const op = url.split('/').pop();
    if (op === 'trial') state = 'trial_active';
    const payload = JSON.stringify({ v: 1, iid: body.installId, state, plan: state === 'trial_active' ? 'trial' : null, exp: state === 'trial_active' ? t0 + 7 * 864e5 : null, life: false, iat: t0, grace: 24 * 36e5 });
    const out = { ok: true, state, plan: null, expiresAt: null, lifetime: false, trialEligible: state === 'none', contact: 'Fale com a revenda', prices: { annualCents: 2500, lifetimeCents: 7000 }, token: b64u(payload), sig: sign(payload), serverTime: t0 };
    if (state === 'none') { out.token = ''; out.sig = ''; }
    return new Response(JSON.stringify(out), { status: 200 });
  };
  let wall = t0, perf = 1000;
  const lic = L.create({ baseUrl: 'https://lic.example', publicKey: k.publicB64, storage: mem(), device: { info: () => ({ model: 'LG OLED55C1', os: 'webOS 6.0' }), lgudid: async () => 'ABC-LGUDID-123' }, appVersion: '0.1.0', appCode: 1, now: () => wall, perf: () => perf, fetch: fetchFn });
  await lic.load();
  assert.equal(lic.decision().allowed, false);
  const id = await lic.installId(); assert.match(id, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  const id2 = await L.create({ baseUrl: 'x', publicKey: 'x', storage: mem(), device: { lgudid: async () => 'ABC-LGUDID-123' } }).installId();
  assert.equal(id, id2, 'o mesmo LGUDID gera o mesmo ID (reinstalar não reinicia o teste)');
  let info = await lic.check(); assert.equal(info.state, 'none'); assert.equal(info.trialEligible, true); assert.equal(info.prices.annualCents, 2500);
  assert.equal(requests[0].body.platform, 'webos'); assert.equal(requests[0].body.model, 'LG OLED55C1'); assert.equal(requests[0].body.secret.length, 64);
  info = await lic.startTrial(); assert.equal(info.state, 'trial_active');
  assert.equal(lic.decision().allowed, true); assert.equal(lic.daysLeft(), 7);
  perf += 25 * 3600_000; assert.equal(lic.decision().why, 'offline_too_long');
  perf = 1000; wall += 8 * 864e5; assert.equal(lic.decision().allowed, true, 'mesma sessão: mexer no relógio não adianta nem atrapalha');
  // resposta com assinatura de outro aparelho é recusada
  const forged = L.create({ baseUrl: 'https://lic.example', publicKey: k.publicB64, storage: mem(), device: {}, now: () => wall, perf: () => perf, fetch: async (u, o) => { const b = JSON.parse(o.body); const pl = JSON.stringify({ v: 1, iid: 'FFFF-FFFF-FFFF', state: 'active', exp: null, life: true, iat: wall, grace: 1e12 }); return new Response(JSON.stringify({ ok: true, state: 'active', token: b64u(pl), sig: sign(pl) })); } });
  await assert.rejects(() => forged.check(), (e) => e.code === 'bad_signature'); assert.equal(forged.decision().allowed, false);
  // http recusado
  await assert.rejects(() => L.create({ baseUrl: 'http://x.com', publicKey: k.publicB64, storage: mem(), device: {} }).check(), (e) => e.code === 'insecure_url');
  // sem configuração: não bloqueia
  assert.equal(L.create({ baseUrl: '', publicKey: '', storage: mem() }).decision().allowed, true);
});
