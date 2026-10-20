/*
 * Vinculação de lista — MESMO protocolo do app Android/Windows:
 *  - ID de 12 caracteres + chave de 6 números. Aqui nasce um par ECDH P-256 e o PIN; o PIN só autoriza quem envia.
 *  - Quem envia (página /enviar do servidor) cifra com ECDH + HKDF-SHA256 (salt = id, info = "vionza-ecdh-v1") + AES-256-GCM (AAD = id).
 *  - QR (opcional): chave AES-256 gerada aqui, no link depois do "#k=" (nunca vai ao servidor).
 * O servidor só guarda texto cifrado por poucos minutos e entrega uma vez.
 */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};
  var U = VZ.util || (typeof require !== 'undefined' ? require('./util') : null);
  var X = VZ.xtream || (typeof require !== 'undefined' ? require('./xtream') : null);
  var subtle = g.crypto.subtle;
  var INFO = 'vionza-ecdh-v1', POLL_MS = 2500, TTL_MS = 30 * 60000;

  async function newKeys() {
    var kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    var pubRaw = new Uint8Array(await subtle.exportKey('raw', kp.publicKey)); // 65 bytes, começa com 0x04
    return { privateKey: kp.privateKey, pubRaw: pubRaw };
  }
  function newPin() { var s = ''; var r = U.randomBytes(12); for (var i = 0; i < 6; i++) s += String(r[i * 2] % 10); return s; }
  var chunk = function (s, n, sep) { return (s.match(new RegExp('.{1,' + n + '}', 'g')) || []).join(sep); };
  var formatId = function (id) { return chunk(id, 4, '-'); };
  var formatPin = function (pin) { return chunk(pin, 3, ' '); };

  /** https sempre; http só para teste local. */
  function serverOk(b) {
    var s = String(b || '').trim();
    return /^https:\/\//i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s);
  }
  var qrUrl = function (b, id, keyBytes) { return b.replace(/\/+$/, '') + '/p/' + id + '#k=' + U.b64uEncode(keyBytes); };

  async function gcm(keyBytes, id, ct, iv) {
    var c = U.b64Decode(ct), n = U.b64Decode(iv);
    if (!c || !n || n.length !== 12 || c.length < 17) return null;
    try {
      var key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
      var plain = await subtle.decrypt({ name: 'AES-GCM', iv: n, additionalData: U.enc(id) }, key, c);
      return new TextDecoder().decode(plain);
    } catch (e) { return null; }
  }
  function decryptSym(keyBytes, id, ct, iv) { return keyBytes && keyBytes.length === 32 ? gcm(keyBytes, id, ct, iv) : Promise.resolve(null); }
  async function decryptRemote(privateKey, id, epk, ct, iv) {
    var raw = U.b64Decode(epk);
    if (!raw || raw.length !== 65 || raw[0] !== 4) return null;
    try {
      var peer = await subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      var secret = await subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
      var hk = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
      var key = new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: U.enc(id), info: U.enc(INFO) }, hk, 256));
      return gcm(key, id, ct, iv);
    } catch (e) { return null; }
  }

  /** Valida o JSON decifrado como o app Android (PairRules.parse). Null se inválido. */
  function parsePayload(json) {
    var o; try { o = JSON.parse(json); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    var type = o.type === 'm3u' || o.type === 'xtream' ? o.type : null; if (!type) return null;
    var raw = String(o.url == null ? '' : o.url).trim(), user = String(o.user == null ? '' : o.user).trim(), pass = String(o.pass == null ? '' : o.pass);
    if (!raw) return null;
    if (type === 'xtream' && (!user || !pass)) return null;
    var url;
    try {
      if (type === 'xtream') url = X.base(raw);
      else { var u = new URL(raw); if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; url = raw; }
    } catch (e) { return null; }
    var name = String(o.name == null ? '' : o.name).replace(/[\x00-\x1f\x7f]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 30);
    return { type: type, name: name, url: url, user: type === 'xtream' ? user : '', pass: type === 'xtream' ? pass : '' };
  }

  function createClient(base, fetchFn) {
    var f = fetchFn || g.fetch.bind(g);
    async function post(path, body, slow) {
      var r = await U.fetchTimeout(base.replace(/\/+$/, '') + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, slow ? 60000 : 20000, f);
      var j = {}; try { j = await r.json(); } catch (e) { /* sem corpo */ }
      return { status: r.status, body: j };
    }
    return {
      async create(pubRaw, pin) {
        var r = await post('/api/v1/pair/create', { pub: U.b64uEncode(pubRaw), pin: pin }, true);
        if (r.status !== 200 || !r.body.id || !r.body.pollToken) throw new Error('create_failed');
        return { id: String(r.body.id), pollToken: String(r.body.pollToken), expiresInSec: Number(r.body.expiresInSec) || 600 };
      },
      /** null = aguardando; objeto = chegou; lança 'gone' se expirou. */
      async poll(id, token) {
        var r = await post('/api/v1/pair/' + id + '/poll', { pollToken: token });
        if (r.status === 404) throw new Error('gone');
        if (r.status === 429) return null;
        if (r.status !== 200) throw new Error('poll_failed');
        if (r.body.state !== 'ready') return null;
        return { ct: String(r.body.ct || ''), iv: String(r.body.iv || ''), epk: r.body.epk ? String(r.body.epk) : null };
      }
    };
  }

  /** Uma sessão de vinculação: cria no servidor (tolera servidor "acordando"), mostra ID/chave e espera a entrega. */
  function PairFlow(base, opts) {
    opts = opts || {};
    this.base = base; this.client = opts.client || createClient(base, opts.fetch);
    this.sleep = opts.sleep || U.sleep; this.now = opts.now || Date.now; this.pollMs = opts.pollMs == null ? POLL_MS : opts.pollMs;
    this.cancelled = false; this.session = null;
  }
  PairFlow.prototype.start = async function (onWaking) {
    if (!serverOk(this.base)) throw new Error('server_not_https');
    var keys = await newKeys(), pin = newPin(), sym = U.randomBytes(32), last;
    for (var i = 0; i < 3 && !this.cancelled; i++) {
      try {
        var s = await this.client.create(keys.pubRaw, pin);
        this.session = { id: s.id, pollToken: s.pollToken, sym: sym, keys: keys, pin: pin, expiresAtMs: this.now() + Math.min(s.expiresInSec * 1000, TTL_MS) };
        return this.view();
      } catch (e) { last = e; if (i < 2) { if (onWaking) onWaking(); await this.sleep(3000); } }
    }
    throw last || new Error('create_failed');
  };
  PairFlow.prototype.view = function () {
    var s = this.session;
    return { id: s.id, idText: formatId(s.id), pinText: formatPin(s.pin), qr: qrUrl(this.base, s.id, s.sym), expiresAtMs: s.expiresAtMs };
  };
  PairFlow.prototype.cancel = function () { this.cancelled = true; };
  /** Resolve com o payload validado; rejeita com 'expired' | 'cancelled' | 'bad_payload' | 'network'. */
  PairFlow.prototype.wait = async function () {
    var s = this.session, fails = 0;
    while (!this.cancelled) {
      if (this.now() >= s.expiresAtMs) throw new Error('expired');
      try {
        var d = await this.client.poll(s.id, s.pollToken);
        fails = 0;
        if (d) {
          var txt = d.epk ? await decryptRemote(s.keys.privateKey, s.id, d.epk, d.ct, d.iv) : await decryptSym(s.sym, s.id, d.ct, d.iv);
          var p = txt && parsePayload(txt);
          if (!p) throw new Error('bad_payload');
          return p;
        }
      } catch (e) {
        if (e.message === 'gone') throw new Error('expired');
        if (e.message === 'bad_payload') throw e;
        if (++fails >= 5) throw new Error('network');
      }
      await this.sleep(this.pollMs);
    }
    throw new Error('cancelled');
  };

  VZ.pairing = { INFO: INFO, newKeys: newKeys, newPin: newPin, formatId: formatId, formatPin: formatPin, serverOk: serverOk, qrUrl: qrUrl, decryptSym: decryptSym, decryptRemote: decryptRemote, parsePayload: parsePayload, createClient: createClient, PairFlow: PairFlow };
  if (typeof module !== 'undefined') module.exports = VZ.pairing;
})(typeof self !== 'undefined' ? self : global);
