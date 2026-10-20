/* Utilidades sem dependências. Roda no navegador da TV (Chromium 68+, webOS 5) e no Node (testes). */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};
  var subtle = (g.crypto && g.crypto.subtle) || null;
  var enc = function (s) { return new TextEncoder().encode(s); };

  function b64uEncode(bytes) {
    var s = ''; var a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return g.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  /** base64 ou base64url, com ou sem preenchimento. Devolve null se inválido. */
  function b64Decode(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_+\/=-]*$/.test(str)) return null;
    var t = str.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (t.length % 4 === 1) return null;
    while (t.length % 4) t += '=';
    try { var bin = g.atob(t); var out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; } catch (e) { return null; }
  }
  function hex(bytes) { var a = new Uint8Array(bytes), s = ''; for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16); return s; }
  function randomBytes(n) { var a = new Uint8Array(n); g.crypto.getRandomValues(a); return a; }
  async function sha256Hex(str) { return hex(await subtle.digest('SHA-256', enc(str))); }

  /** Hash rápido e síncrono (só para IDs locais de itens; não é segurança). 16 caracteres hex. */
  function hash16(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
      h3 = Math.imul(h3 ^ c, 3266489917); h4 = Math.imul(h4 ^ c, 668265263);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    var u = function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); };
    return u(h1 ^ h3) + u(h2 ^ h4);
  }

  /** fetch com prazo (AbortController; AbortSignal.timeout não existe nas TVs mais antigas). */
  async function fetchTimeout(url, opts, ms, fetchFn) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 20000);
    try { return await (fetchFn || g.fetch.bind(g))(url, Object.assign({}, opts || {}, ctl ? { signal: ctl.signal } : {})); }
    finally { clearTimeout(timer); }
  }
  var HttpError = function (code, status) { var e = new Error(code); e.code = code; e.status = status || 0; return e; };
  /** Texto de uma URL com limite de tamanho. Nunca registra a URL (pode ter usuário e senha). */
  async function getText(url, o) {
    o = o || {};
    var u; try { u = new URL(url); } catch (e) { throw HttpError('invalid_url'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw HttpError('invalid_url');
    var res;
    try { res = await fetchTimeout(u.href, { redirect: 'follow' }, o.timeoutMs || 45000); }
    catch (e) { throw HttpError(e && e.name === 'AbortError' ? 'timeout' : 'offline'); }
    if (!res.ok) throw HttpError('http', res.status);
    var max = o.maxBytes || 40 * 1024 * 1024;
    var len = Number(res.headers.get('content-length')) || 0;
    if (len > max) throw HttpError('too_large');
    var text;
    try { text = await res.text(); } catch (e) { throw HttpError('offline'); }
    if (text.length > max) throw HttpError('too_large');
    return text;
  }

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  /** minúsculas e sem acento. */
  var fold = function (s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };

  VZ.util = { b64uEncode: b64uEncode, b64Decode: b64Decode, hex: hex, randomBytes: randomBytes, sha256Hex: sha256Hex, hash16: hash16, fetchTimeout: fetchTimeout, HttpError: HttpError, getText: getText, sleep: sleep, fold: fold, enc: enc };
  if (typeof module !== 'undefined') module.exports = VZ.util;
})(typeof self !== 'undefined' ? self : global);
