/* Dados do usuário (listas, favoritos, progresso, senha parental) em localStorage. Sem sentido fora da TV: só este app lê. */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};
  var U = VZ.util || (typeof require !== 'undefined' ? require('./util') : null);
  var KEY = 'vz_state_v1', MAX_CONN = 10, MAX_FAV = 500, MAX_PROGRESS = 200;

  function empty() { return { v: 1, connections: [], defaultConn: null, favorites: [], progress: {}, parental: null, settings: { sortAlpha: true } }; }

  function create(storage) {
    var st = empty();
    try { var raw = storage.getItem(KEY); if (raw) { var o = JSON.parse(raw); if (o && o.v === 1) st = Object.assign(empty(), o); } } catch (e) { st = empty(); }
    if (!Array.isArray(st.connections)) st.connections = [];
    if (!Array.isArray(st.favorites)) st.favorites = [];
    if (!st.progress || typeof st.progress !== 'object') st.progress = {};
    st.settings = Object.assign({ sortAlpha: true }, st.settings || {});
    function save() { try { storage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* sem espaço: segue só em memória */ } }
    var api = {
      state: st, save: save,
      defaultConnection: function () { for (var i = 0; i < st.connections.length; i++) if (st.connections[i].id === st.defaultConn) return st.connections[i]; return st.connections[0] || null; },
      displayName: function (c) { if (c.name) return c.name; try { return new URL(/^https?:/i.test(c.url) ? c.url : 'http://' + c.url).hostname; } catch (e) { return 'lista'; } },
      addConnection: function (c) {
        var ex = st.connections.filter(function (x) { return x.type === c.type && x.url === c.url && x.user === c.user; })[0];
        if (ex) { ex.name = c.name || ex.name; ex.pass = c.pass; st.defaultConn = ex.id; save(); return ex; }
        if (st.connections.length >= MAX_CONN) throw new Error('too_many');
        var n = st.connections.reduce(function (a, x) { return Math.max(a, Number(String(x.id).replace('c', '')) || 0); }, 0) + 1;
        var conn = { id: 'c' + n, name: String(c.name || '').slice(0, 30), type: c.type, url: c.url, user: c.user || '', pass: c.pass || '' };
        st.connections.push(conn); st.defaultConn = conn.id; save(); return conn;
      },
      removeConnection: function (id) {
        st.connections = st.connections.filter(function (c) { return c.id !== id; });
        st.favorites = st.favorites.filter(function (f) { return f.connId !== id; });
        if (st.defaultConn === id) st.defaultConn = st.connections.length ? st.connections[0].id : null;
        save();
      },
      isFav: function (id) { return st.favorites.some(function (f) { return f.id === id; }); },
      /** Guarda uma cópia enxuta do item (sem usuário/senha): a lista da TV é carregada por pasta, então o item precisa ir junto. */
      toggleFav: function (item, connId) {
        var i = -1; st.favorites.forEach(function (f, k) { if (f.id === item.id) i = k; });
        if (i >= 0) st.favorites.splice(i, 1);
        else {
          st.favorites.unshift({ id: item.id, name: item.name, logo: item.logo || null, kind: item.kind, group: item.group || '', sid: item.sid || null, ext: item.ext || null, url: item.url || null, adultFlag: item.adultFlag, connId: connId });
          if (st.favorites.length > MAX_FAV) st.favorites.length = MAX_FAV;
        }
        save(); return i < 0;
      },
      /** Ponto onde parou (VOD). Passou de 95% = terminou. [meta] = { name, logo, kind, url?, ... } para reabrir depois. */
      recordProgress: function (id, pos, dur, meta, now) {
        if (!(dur > 0) || !(pos >= 0)) return;
        if (pos / dur >= 0.95) { delete st.progress[id]; save(); return; }
        st.progress[id] = Object.assign({}, meta || {}, { pos: Math.floor(pos), dur: Math.floor(dur), at: now || Date.now() });
        var ids = Object.keys(st.progress);
        if (ids.length > MAX_PROGRESS) ids.sort(function (a, b) { return st.progress[a].at - st.progress[b].at; }).slice(0, ids.length - MAX_PROGRESS).forEach(function (k) { delete st.progress[k]; });
        save();
      },
      resume: function (id) { var p = st.progress[id]; return p && p.pos / p.dur > 0.03 && p.pos / p.dur < 0.95 ? p.pos : 0; },
      continueList: function () {
        return Object.keys(st.progress).filter(function (k) { var p = st.progress[k]; return p.pos / p.dur > 0.03 && p.pos / p.dur < 0.95; })
          .sort(function (a, b) { return st.progress[b].at - st.progress[a].at; }).map(function (k) { return Object.assign({ id: k }, st.progress[k]); });
      },
      // ---- senha do controle parental (PBKDF2; nunca em texto puro) ----
      async _hashPin(pin, saltBytes) {
        var key = await g.crypto.subtle.importKey('raw', U.enc(pin), 'PBKDF2', false, ['deriveBits']);
        return U.hex(await g.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 60000 }, key, 256));
      },
      async setPin(pin) {
        if (!/^\d{4,8}$/.test(pin)) throw new Error('bad_pin');
        var salt = U.randomBytes(16); st.parental = { salt: U.hex(salt), hash: await api._hashPin(pin, salt) }; save();
      },
      async verifyPin(pin) {
        if (!st.parental || typeof pin !== 'string') return false;
        var salt = new Uint8Array(st.parental.salt.match(/../g).map(function (h) { return parseInt(h, 16); }));
        return (await api._hashPin(pin, salt)) === st.parental.hash;
      },
      clearPin: function () { st.parental = null; save(); }
    };
    return api;
  }
  VZ.store = { create: create, KEY: KEY };
  if (typeof module !== 'undefined') module.exports = VZ.store;
})(typeof self !== 'undefined' ? self : global);
