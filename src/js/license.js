/*
 * Licença — MESMO protocolo do Android (LicenseManager/LicenseCore): o servidor assina um token (ECDSA P-256, SHA-256, DER)
 * e o app só aceita o que a assinatura confere. O app nunca decide "premium" sozinho.
 * Tudo injetável (armazenamento, relógio, fetch) para testar em Node.
 */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};
  var U = VZ.util || (typeof require !== 'undefined' ? require('./util') : null);
  var subtle = g.crypto.subtle;
  var CLOCK_SLACK_MS = 120000;
  var OK_STATES = { trial_active: 1, active: 1 };

  /** DER (SEQUENCE{INTEGER r, INTEGER s}) -> r||s de 64 bytes (formato do WebCrypto). */
  function derToRaw(der) {
    var p = 0;
    if (der[p++] !== 0x30) return null;
    var l = der[p++]; if (l & 0x80) { var n = l & 0x7f; l = 0; while (n--) l = (l << 8) | der[p++]; }
    var out = new Uint8Array(64);
    for (var k = 0; k < 2; k++) {
      if (der[p++] !== 0x02) return null;
      var len = der[p++], v = der.subarray(p, p + len); p += len;
      while (v.length > 32 && v[0] === 0) v = v.subarray(1);
      if (v.length > 32) return null;
      out.set(v, k * 32 + (32 - v.length));
    }
    return out;
  }
  function parse(json) {
    var o; try { o = JSON.parse(json); } catch (e) { return null; }
    if (!o || typeof o.iid !== 'string' || typeof o.state !== 'string' || typeof o.iat !== 'number') return null;
    return { installId: o.iid, state: o.state, plan: o.plan || null, expiresAt: typeof o.exp === 'number' ? o.exp : null, lifetime: o.life === true || o.life === 1, issuedAt: o.iat, graceMs: Math.max(0, Number(o.grace) || 0) };
  }
  /** Verifica a assinatura e lê o conteúdo. Null se qualquer coisa não bater. */
  async function verify(publicKeyB64, tokenB64u, sigB64u) {
    try {
      var payloadBytes = U.b64Decode(tokenB64u), sig = U.b64Decode(sigB64u), keyBytes = U.b64Decode(publicKeyB64);
      if (!payloadBytes || !sig || !keyBytes) return null;
      var raw = derToRaw(sig); if (!raw) return null;
      var key = await subtle.importKey('spki', keyBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      var ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, payloadBytes);
      return ok ? parse(new TextDecoder().decode(payloadBytes)) : null;
    } catch (e) { return null; }
  }
  var whyOf = function (state) {
    return { trial_active: 'ok', active: 'ok', expired: 'expired', suspended: 'suspended', revoked: 'revoked', pending: 'pending', device_unauthorized: 'unauthorized' }[state] || 'no_license';
  };
  /** "Agora" do servidor sem confiar no relógio: mesma sessão usa o relógio monotônico; depois só aceita relógio que não voltou. */
  function estimateServerNow(p, r, ctx) {
    if (r.session === ctx.session && ctx.perf >= r.perf) return p.issuedAt + (ctx.perf - r.perf);
    if (ctx.wall >= r.wall && ctx.wall >= ctx.wallFloor - CLOCK_SLACK_MS) return p.issuedAt + (ctx.wall - r.wall);
    return null;
  }
  function decide(p, r, ctx) {
    if (!p || !r) return { allowed: false, why: 'no_license' };
    var st = whyOf(p.state); if (st !== 'ok') return { allowed: false, why: st };
    var now = estimateServerNow(p, r, ctx); if (now == null) return { allowed: false, why: 'clock' };
    if (!p.lifetime) { if (p.expiresAt == null) return { allowed: false, why: 'no_license' }; if (now >= p.expiresAt) return { allowed: false, why: 'expired' }; }
    if (now > p.issuedAt + p.graceMs) return { allowed: false, why: 'offline_too_long' };
    return { allowed: true, why: 'ok' };
  }
  function daysLeft(p, now) { if (p.lifetime || p.expiresAt == null) return null; var ms = p.expiresAt - now; return ms <= 0 ? 0 : Math.floor((ms + 86399999) / 86400000); }

  var fmtId = function (hex12) { return hex12.slice(0, 4) + '-' + hex12.slice(4, 8) + '-' + hex12.slice(8, 12); };

  /**
   * cfg: { baseUrl, publicKey, storage (getItem/setItem/removeItem), device: { info(), lgudid() }, appVersion, appCode,
   *        now(), perf(), fetch }
   */
  function create(cfg) {
    var store = cfg.storage, now = cfg.now || Date.now, perf = cfg.perf || function () { return g.performance.now(); };
    var session = U.hex(U.randomBytes(6)), K = 'vz_lic_';
    var get = function (k) { try { return store.getItem(K + k); } catch (e) { return null; } };
    var set = function (k, v) { try { store.setItem(K + k, v); } catch (e) { /* sem espaço */ } };
    var del = function (k) { try { store.removeItem(K + k); } catch (e) { /* ok */ } };
    var floor = function () { return Number(get('floor')) || 0; };
    var m = {
      configured: !!(cfg.baseUrl && cfg.publicKey),
      /** ID fixo desta TV (AAAA-BBBB-CCCC). Nasce do LGUDID (sobrevive a reinstalar o app); sem ele, aleatório. Só o derivado sai da TV. */
      async installId() {
        var id = get('id'); if (id) return id;
        var raw = cfg.device && cfg.device.lgudid ? await cfg.device.lgudid() : null, hex;
        hex = raw ? (await U.sha256Hex('vionza-lg|' + raw)).slice(0, 12) : U.hex(U.randomBytes(6));
        id = fmtId(hex.toUpperCase()); set('id', id); return id;
      },
      secret() { var s = get('secret'); if (!s) { s = U.hex(U.randomBytes(32)); set('secret', s); } return s; },
      async _call(op) {
        if (!m.configured) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
        var base = cfg.baseUrl.replace(/\/+$/, '');
        if (!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(base)) throw Object.assign(new Error('insecure_url'), { code: 'insecure_url' });
        var di = cfg.device && cfg.device.info ? cfg.device.info() : {};
        var body = { installId: await m.installId(), secret: m.secret(), platform: 'webos', appVersion: cfg.appVersion, appCode: cfg.appCode, model: di.model, os: di.os };
        var res, text;
        try {
          res = await U.fetchTimeout(base + '/api/v1/license/' + op, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }, 15000, cfg.fetch);
          text = await res.text();
        } catch (e) { throw Object.assign(new Error('network'), { code: 'network' }); }
        var j; try { j = JSON.parse(text); } catch (e) { throw Object.assign(new Error('server'), { code: res && res.status >= 500 ? 'server' : 'bad_response' }); }
        if (!j.ok) throw Object.assign(new Error(j.error || 'server'), { code: j.error || 'server' });
        return m._store(j);
      },
      check() { return m._call('check'); },
      startTrial() { return m._call('trial'); },
      /** Revalida em segundo plano; falha de rede é silenciosa (vale a tolerância offline). */
      async revalidate() { try { await m.check(); return true; } catch (e) { return false; } },
      async _store(j) {
        var token = j.token || '', sig = j.sig || '';
        var payload = token && sig ? await verify(cfg.publicKey, token, sig) : null;
        var id = await m.installId();
        if (payload && payload.installId === id && payload.state === j.state) {
          set('token', token); set('sig', sig); set('rx', JSON.stringify({ session: session, perf: perf(), wall: now() }));
        } else {
          del('token'); del('sig'); del('rx');
          if (token) throw Object.assign(new Error('bad_signature'), { code: 'bad_signature' }); // diz ter licença mas não é autêntica
        }
        var w = now(); set('floor', String(Math.max(floor(), w)));
        set('info', JSON.stringify({ state: j.state, plan: j.plan || null, expiresAt: j.expiresAt == null ? null : j.expiresAt, lifetime: !!j.lifetime, trialEligible: !!j.trialEligible, contact: j.contact || '', renewalMessage: j.renewalMessage || '', productName: j.productName || 'Vionza Play', prices: j.prices || {}, serverTime: j.serverTime || 0, minVersionCode: j.minVersionCode || 0, updateMessage: j.updateMessage || '' }));
        return m.lastInfo();
      },
      lastInfo() { try { return JSON.parse(get('info')); } catch (e) { return null; } },
      _loaded() {
        var t = get('token'), s = get('sig'), r; try { r = JSON.parse(get('rx')); } catch (e) { r = null; }
        return { token: t, sig: s, rx: r };
      },
      /** Acesso agora, só com o que está guardado (rápido, síncrono usa o último payload verificado em memória). */
      decision() {
        if (!m.configured) return { allowed: true, why: 'ok' };
        var p = m._payload; var l = m._loaded();
        return decide(p, l.rx, { session: session, perf: perf(), wall: now(), wallFloor: floor() });
      },
      /** Carrega do armazenamento (re-verifica a assinatura) — chamar ao abrir o app, antes de decision(). */
      async load() {
        var l = m._loaded();
        m._payload = l.token && l.sig ? await verify(cfg.publicKey, l.token, l.sig) : null;
        if (m._payload && m._payload.installId !== await m.installId()) m._payload = null;
        var w = now(); if (w > floor()) set('floor', String(w));
        return m;
      },
      daysLeft() { var p = m._payload, l = m._loaded(); if (!p || !l.rx) return null; var n = estimateServerNow(p, l.rx, { session: session, perf: perf(), wall: now(), wallFloor: floor() }); return n == null ? null : daysLeft(p, n); },
      isStale(ms) { return !m._lastOkPerf || perf() - m._lastOkPerf > (ms || 10 * 60000); },
      _payload: null
    };
    var origStore = m._store;
    m._store = async function (j) { var r = await origStore(j); await m.load(); m._lastOkPerf = perf(); return r; };
    return m;
  }

  VZ.license = { create: create, verify: verify, derToRaw: derToRaw, decide: decide, parse: parse, whyOf: whyOf, daysLeft: daysLeft };
  if (typeof module !== 'undefined') module.exports = VZ.license;
})(typeof self !== 'undefined' ? self : global);
