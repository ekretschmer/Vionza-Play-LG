/* Vionza Play para LG webOS — telas e fluxo. A lógica pesada está nos módulos ao lado (testados em Node). */
(function () {
  'use strict';
  var VZ = window.VZ, C = window.VZ_CONFIG || {}, U = VZ.util, R = VZ.rules, X = VZ.xtream, M = VZ.m3u, P = VZ.pairing, N = VZ.nav, K = N.KEYS;
  var COPYRIGHT = '© 2026 Vionza Play Entretenimento. Todos os direitos reservados.';
  var CHUNK = 48;

  // ---------- armazenamento (cai para memória se o localStorage falhar) ----------
  var mem = {};
  var storage = {
    getItem: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return mem[k] == null ? null : mem[k]; } },
    setItem: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { mem[k] = String(v); } },
    removeItem: function (k) { try { window.localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
  };
  var store = VZ.store.create(storage);
  var lic = VZ.license.create({ baseUrl: C.LICENSE_URL, publicKey: C.LICENSE_PUBLIC_KEY, storage: storage, device: VZ.device, appVersion: C.VERSION || '0', appCode: C.VERSION_CODE || 0 });

  // ---------- DOM ----------
  // Chromium das TVs mais antigas não tem replaceChildren: este troca o conteúdo aceitando listas e null.
  Element.prototype.vzSet = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
    var el = this;
    (function add(list) { Array.prototype.forEach.call(list, function (c) { if (Array.isArray(c)) add(c); else if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }); })(arguments);
  };
  /** background-image seguro: qualquer caractere que possa fechar o url('...') é codificado. */
  function cssUrl(u) { return "url('" + String(u).replace(/[^A-Za-z0-9\-._~:\/?#\[\]@!$&*+,;=%]/g, function (c) { return '%' + ('0' + c.charCodeAt(0).toString(16)).slice(-2); }).replace(/'/g, '%27') + "')"; }
  function h(tag, attrs) {
    var e = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'f') { e.setAttribute('data-f', ''); e.tabIndex = -1; if (typeof v === 'function') e.addEventListener('click', v); }
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    });
    (function add(list) { list.forEach(function (c) { if (Array.isArray(c)) add(c); else if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }); })(kids);
    return e;
  }
  var $app = document.getElementById('app'), $video = document.getElementById('video'), $toast = document.getElementById('toast');
  var screens = {};
  ['license', 'pair', 'manual', 'home', 'series', 'settings', 'player'].forEach(function (n) { var s = h('div', { class: 'screen', id: n }); $app.appendChild(s); screens[n] = s; });
  var $modal = h('div', { class: 'modal' }); $app.appendChild($modal);
  var $busy = null;
  var current = null, modalOpen = false;

  function toast(msg, ms) { $toast.textContent = msg; $toast.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { $toast.style.display = 'none'; }, ms || 3000); }
  function busy(msg) {
    if ($busy) $busy.remove();
    $busy = h('div', { class: 'load' }, h('div', { class: 'spin' }), h('span', { text: msg || 'Carregando…' }));
    $app.appendChild($busy);
    var el = $busy; return function () { if (el.parentNode) el.remove(); if ($busy === el) $busy = null; };
  }
  function show(name, first) {
    Object.keys(screens).forEach(function (k) { screens[k].classList.toggle('on', k === name); });
    current = name; document.body.classList.toggle('playing', name === 'player');
    N.setScope(screens[name], first);
  }
  var money = function (cents, cur) { try { return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: cur || 'BRL' }); } catch (e) { return 'R$ ' + (cents / 100).toFixed(2).replace('.', ','); } };

  var ERRORS = {
    hls_manifest: 'Este link é o vídeo de um único canal, não uma lista. Use o link da lista M3U com vários itens.',
    bad_format: 'O conteúdo desse endereço não parece ser uma lista M3U. Confira o link.', empty_list: 'A lista veio vazia.', empty_items: 'A lista foi lida, mas não tem nenhum item para reproduzir.',
    xt_format: 'O servidor respondeu em formato inesperado. Confira se é um servidor Xtream Codes.', xt_auth: 'Usuário ou senha inválidos.', xt_empty: 'A conta conectou, mas não tem canais, filmes nem séries.',
    xt_truncated: 'A resposta do servidor veio incompleta. Tente de novo.', offline: 'Sem conexão com o servidor. Verifique a internet e o endereço.', timeout: 'O servidor demorou demais para responder.',
    too_large: 'A lista é grande demais para esta TV. Use uma lista Xtream (carrega por pasta).', invalid_url: 'Endereço inválido. Use um link http ou https.', series_format: 'O servidor respondeu em formato inesperado ao abrir a série.'
  };
  function errText(e) {
    var c = e && e.code;
    if (c === 'http') return e.status === 401 || e.status === 403 ? 'O servidor recusou o acesso (HTTP ' + e.status + '). Confira usuário, senha e link.' : 'O servidor respondeu com erro (HTTP ' + e.status + ').';
    if (c === 'xt_expired' || c === 'xt_inactive') return e.message;
    return ERRORS[c] || 'Não foi possível carregar a lista.';
  }

  // ---------- janelas ----------
  var modalPrevScope = null;
  /** ask({title,text,input,buttons}) -> Promise<{value,text}>. Voltar = valor 'cancel'. */
  function ask(o) {
    return new Promise(function (resolve) {
      modalPrevScope = N.scope; modalOpen = true;
      var input = o.input ? h('input', { class: 'field-in', type: o.input.type || 'text', placeholder: o.input.placeholder || '', maxlength: o.input.max || 80, inputmode: o.input.numeric ? 'numeric' : null, f: true, style: 'width:100%;height:84px;border-radius:16px;background:#121915;padding:0 28px;font-size:32px;margin:14px 0 8px;text-align:center' }) : null;
      var done = function (v) { modalOpen = false; $modal.classList.remove('on'); $modal.vzSet(); if (modalPrevScope) N.setScope(modalPrevScope, '.focus'); resolve({ value: v, text: input ? input.value : '' }); };
      ask.cancel = function () { done('cancel'); };
      var btns = (o.buttons || [{ label: 'OK', value: 'ok', cls: 'pri' }]).map(function (b) { return h('button', { class: 'btn ' + (b.cls || ''), f: function () { done(b.value); }, text: b.label }); });
      $modal.vzSet(h('div', { class: 'box' }, h('h2', { text: o.title || '' }), o.text ? h('p', { text: o.text }) : null, input, h('div', { class: 'row' }, btns)));
      $modal.classList.add('on'); N.setScope($modal, input || btns[0]);
    });
  }
  ask.cancel = function () {};
  async function askPin(title) { var r = await ask({ title: title || 'Senha do controle parental', input: { type: 'password', numeric: true, max: 8, placeholder: 'Senha' }, buttons: [{ label: 'Confirmar', value: 'ok', cls: 'pri' }, { label: 'Cancelar', value: 'cancel' }] }); return r.value === 'ok' ? r.text : null; }

  // ---------- tela de licença ----------
  var licenseNetError = null;
  var WHY = {
    no_license: ['Ative o seu acesso', 'Este aparelho ainda não tem licença.'], expired: ['Licença vencida', 'Renove com a sua revenda para continuar assistindo.'], suspended: ['Licença suspensa', 'Fale com a sua revenda.'],
    revoked: ['Acesso bloqueado', 'Fale com a sua revenda.'], pending: ['Aguardando liberação', 'Assim que a revenda liberar, toque em Verificar.'], unauthorized: ['Aparelho não autorizado', 'Fale com a sua revenda.'],
    offline_too_long: ['Conecte à internet', 'Faz tempo que a licença não é confirmada. Conecte a TV à internet e toque em Verificar.'], clock: ['Confira a data e hora da TV', 'Ajuste a data e a hora nas configurações da TV e toque em Verificar.']
  };
  async function showLicense() {
    var d = lic.decision(), info = lic.lastInfo() || {}, id = await lic.installId();
    var why = d.why === 'ok' ? 'no_license' : d.why, t = WHY[why] || WHY.no_license, scr = screens.license;
    var prices = info.prices || {}, priceLine = prices.annualCents > 0 ? money(prices.annualCents, prices.currency) + ' por ano · vitalício ' + money(prices.lifetimeCents, prices.currency) : '';
    var msg = h('div', { class: 'msg', text: licenseNetError ? (licenseNetError.code === 'network' ? 'Sem conexão com o servidor de licença.' : 'Não foi possível falar com o servidor de licença.') : '' });
    if (licenseNetError) msg.classList.add('err');
    var again = async function () {
      var off = busy('Verificando…');
      try { var r = await lic.check(); licenseNetError = null; if (r.trialEligible && !lic.decision().allowed) await lic.startTrial(); } catch (e) { licenseNetError = e; }
      off();
      if (lic.decision().allowed) startApp(); else showLicense();
    };
    scr.vzSet(h('div', { class: 'center' },
      h('div', { class: 'logo' }, h('i'), h('b', { text: info.productName || 'Vionza Play' })),
      h('h1', { text: t[0] }), h('p', { class: 'muted', style: 'margin-top:12px', text: t[1] }),
      h('div', { class: 'muted', style: 'margin-top:34px;font-size:26px', text: 'ID deste aparelho' }), h('div', { class: 'bigid', text: id }),
      priceLine ? h('div', { class: 'pill g', text: priceLine }) : null,
      info.contact ? h('p', { class: 'muted', style: 'margin-top:22px', text: info.contact }) : null, msg,
      h('div', { class: 'row' },
        info.trialEligible ? h('button', { class: 'btn pri', text: 'Começar teste grátis', f: async function () { var off = busy('Iniciando teste…'); try { await lic.startTrial(); licenseNetError = null; } catch (e) { licenseNetError = e; } off(); if (lic.decision().allowed) startApp(); else showLicense(); } }) : null,
        h('button', { class: 'btn' + (info.trialEligible ? '' : ' pri'), text: 'Verificar', f: again }))));
    show('license', '.btn');
  }

  // ---------- fonte de dados (M3U inteira em memória; Xtream por pasta) ----------
  var conn = null, source = null;
  function m3uSource(c) {
    var by = { live: {}, movie: {}, series: {} }, order = { live: [], movie: [], series: [] };
    return {
      type: 'm3u',
      async init() {
        var res = M.parse(await U.getText(c.url, { maxBytes: 60 * 1024 * 1024 }));
        res.items.forEach(function (it) { var k = by[it.kind]; if (!k[it.group]) { k[it.group] = []; order[it.kind].push(it.group); } k[it.group].push(it); });
        this.counts = { live: res.items.filter(function (i) { return i.kind === 'live'; }).length, movie: res.items.filter(function (i) { return i.kind === 'movie'; }).length, series: res.items.filter(function (i) { return i.kind === 'series'; }).length };
      },
      async categories(kind) { return order[kind].map(function (g) { return { id: g, name: g, count: by[kind][g].length }; }); },
      async items(kind, cat) { return by[kind][cat.id] || []; },
      playUrl: function (it) { return it.url; }
    };
  }
  function xtSource(c) {
    var cats = {}, cache = [], getText = function (u) { return U.getText(u, { maxBytes: 40 * 1024 * 1024 }); };
    return {
      type: 'xtream',
      async init() {
        await X.authenticate(getText, c);
        var n = 0, self = this; self.counts = {};
        for (var i = 0, ks = ['live', 'movie', 'series']; i < ks.length; i++) { cats[ks[i]] = await X.categories(getText, c, ks[i]); self.counts[ks[i]] = cats[ks[i]].length; n += cats[ks[i]].length; }
        if (!n) { var e = new Error('xt_empty'); e.code = 'xt_empty'; throw e; }
      },
      async categories(kind) { return cats[kind] || []; },
      async items(kind, cat) {
        var key = kind + '|' + cat.id, hit = cache.filter(function (x) { return x.key === key; })[0];
        if (hit) return hit.items;
        var items = await X.items(getText, c, kind, cat);
        cache.push({ key: key, items: items }); if (cache.length > 6) cache.shift(); // memória da TV é pequena
        return items;
      },
      playUrl: function (it) { return X.playUrl(c, it); }
    };
  }
  async function openConnection(c) {
    var s = c.type === 'xtream' ? xtSource(c) : m3uSource(c);
    await s.init(); conn = c; source = s;
  }

  // ---------- vincular ----------
  var flow = null;
  async function showPair() {
    if (flow) flow.cancel();
    var scr = screens.pair, hasConn = store.state.connections.length > 0;
    var idEl = h('div', { class: 'bigid', text: '…' }), pinEl = h('div', { class: 'bigid', style: 'font-size:80px;color:#fff', text: '…' }), qrEl = h('div', { class: 'qr hidden' }), msg = h('div', { class: 'msg', text: 'Gerando o código…' });
    var sender = (C.PAIR_URL || '').replace(/\/+$/, '') + '/enviar';
    scr.vzSet(h('div', { class: 'center' },
      h('div', { class: 'logo' }, h('i'), h('b', { text: 'Vionza Play' })),
      h('h2', { text: 'Vincule a sua lista' }),
      h('div', { class: 'pairbox' },
        h('div', {}, h('div', { class: 'muted', style: 'font-size:26px', text: 'ID' }), idEl, h('div', { class: 'muted', style: 'font-size:26px', text: 'Chave' }), pinEl),
        qrEl,
        h('div', { class: 'steps', style: 'text-align:left;max-width:560px' }, h('div', {}, '1. No celular ou computador, abra'), h('div', {}, h('b', { text: sender.replace(/^https?:\/\//, '') })), h('div', {}, '2. Digite o ID e a chave'), h('div', {}, '3. Envie a sua lista'))),
      msg,
      h('div', { class: 'row', style: 'margin-top:20px' },
        h('button', { class: 'btn', text: 'Digitar a lista aqui', f: function () { flow && flow.cancel(); showManual(); } }),
        hasConn ? h('button', { class: 'btn', text: 'Voltar', f: function () { flow && flow.cancel(); showHome(); } }) : null)));
    show('pair', '.btn');
    var f = new P.PairFlow(C.PAIR_URL || '', {}); flow = f;
    try {
      var v = await f.start(function () { msg.textContent = 'Acordando o servidor… aguarde alguns segundos.'; });
      if (flow !== f) return;
      idEl.textContent = v.idText; pinEl.textContent = v.pinText; msg.textContent = 'Aguardando você enviar a lista…';
      if (window.qrcode) { try { var q = window.qrcode(0, 'M'); q.addData(v.qr); q.make(); var img = new Image(); img.src = q.createDataURL(6, 0); qrEl.vzSet(img); qrEl.classList.remove('hidden'); } catch (e) { /* sem QR: ID e chave bastam */ } }
      var payload = await f.wait();
      if (flow !== f) return;
      msg.textContent = 'Lista recebida. Carregando…';
      var off = busy('Carregando a lista…');
      try { var saved = store.addConnection(payload); await openConnection(saved); off(); showHome(); }
      catch (e) { off(); msg.textContent = errText(e); msg.className = 'msg err'; }
    } catch (e) {
      if (flow !== f) return;
      var m = e.message; msg.className = 'msg err';
      msg.textContent = m === 'server_not_https' ? 'O endereço do servidor de vinculação não está configurado.' : m === 'expired' ? 'O código expirou. Volte e abra de novo.' : m === 'cancelled' ? '' : 'Não foi possível falar com o servidor. Verifique a internet.';
    }
  }
  function showManual() {
    var scr = screens.manual, type = 'xtream';
    var name = h('input', { type: 'text', maxlength: 30, f: true, placeholder: 'Ex.: Minha lista' }), url = h('input', { type: 'text', maxlength: 400, f: true, placeholder: 'http://servidor:porta' });
    var user = h('input', { type: 'text', maxlength: 100, f: true }), pass = h('input', { type: 'password', maxlength: 100, f: true });
    var fu = h('label', { class: 'field' }, h('span', { text: 'Usuário' }), user), fp = h('label', { class: 'field' }, h('span', { text: 'Senha' }), pass);
    var msg = h('div', { class: 'msg' });
    var bX = h('button', { class: 'btn pri', text: 'Xtream (usuário e senha)', f: function () { setType('xtream'); } }), bM = h('button', { class: 'btn', text: 'Link M3U', f: function () { setType('m3u'); } });
    function setType(t) { type = t; bX.classList.toggle('pri', t === 'xtream'); bM.classList.toggle('pri', t === 'm3u'); fu.classList.toggle('hidden', t !== 'xtream'); fp.classList.toggle('hidden', t !== 'xtream'); url.placeholder = t === 'xtream' ? 'http://servidor:porta' : 'http://exemplo.com/lista.m3u'; }
    scr.vzSet(h('div', { class: 'center' }, h('h2', { text: 'Adicionar lista' }),
      h('div', { class: 'seg', style: 'margin-top:18px' }, bX, bM),
      h('label', { class: 'field' }, h('span', { text: 'Nome (opcional)' }), name), h('label', { class: 'field' }, h('span', { text: 'Endereço' }), url), fu, fp, msg,
      h('div', { class: 'row', style: 'margin-top:20px' },
        h('button', { class: 'btn pri', text: 'Conectar', f: async function () {
          msg.className = 'msg'; msg.textContent = '';
          var c = { type: type, name: name.value.trim(), url: url.value.trim(), user: user.value.trim(), pass: pass.value };
          try {
            if (!c.url) { var e0 = new Error('url'); e0.code = 'invalid_url'; throw e0; }
            if (type === 'xtream') { if (!c.user || !c.pass) { var e1 = new Error('c'); e1.code = 'xt_auth'; throw e1; } c.url = X.base(c.url); } else { var u2 = new URL(c.url); if (!/^https?:$/.test(u2.protocol)) { var e2 = new Error('u'); e2.code = 'invalid_url'; throw e2; } c.user = ''; c.pass = ''; }
          } catch (e) { msg.className = 'msg err'; msg.textContent = errText(e.code ? e : { code: 'invalid_url' }); return; }
          var off = busy('Conectando…');
          try { var tmp = Object.assign({ id: 'tmp' }, c); await openConnection(tmp); var saved = store.addConnection(c); conn = saved; off(); showHome(); }
          catch (e) { off(); msg.className = 'msg err'; msg.textContent = errText(e); }
        } }),
        h('button', { class: 'btn', text: 'Voltar', f: function () { showPair(); } }))));
    setType('xtream'); show('manual', 'input');
  }

  // ---------- início ----------
  var hs = { tab: 'live', cats: [], catIdx: 0, items: [], shown: 0, query: '', ctx: null };
  var TABS = [['live', 'Ao vivo'], ['movie', 'Filmes'], ['series', 'Séries'], ['fav', 'Favoritos'], ['cont', 'Continuar'], ['set', 'Ajustes']];
  var adultOn = false;
  var catOk = function (name) { return adultOn || !R.adultByMetadata(name, ''); };
  var itemOk = function (it) { return adultOn || !R.isAdult(it); };

  function tabAvailable(k) {
    if (k === 'live' || k === 'movie' || k === 'series') return !source || !source.counts || source.counts[k] > 0;
    return true;
  }
  async function showHome(tab) {
    if (!conn || !source) { var c = store.defaultConnection(); if (!c) return showPair(); var off = busy('Carregando a lista…'); try { await openConnection(c); } catch (e) { off(); toast(errText(e), 6000); return showPair(); } off(); }
    hs.tab = tab || hs.tab || 'live'; if (!tabAvailable(hs.tab)) hs.tab = ['live', 'movie', 'series'].filter(tabAvailable)[0] || 'fav';
    drawHome();
    if (hs.tab === 'set') return showSettings();
    await loadTab(true);
  }
  function drawHome() {
    var scr = screens.home;
    var tabs = h('div', { class: 'tabs' }, TABS.filter(function (t) { return tabAvailable(t[0]); }).map(function (t) { return h('button', { class: 'tab' + (hs.tab === t[0] ? ' on' : ''), text: t[1], 'data-tab': t[0], f: function () { goTab(t[0]); } }); }));
    scr.vzSet(h('div', { class: 'top' }, h('div', { class: 'brand' }, h('i'), 'Vionza Play'), tabs),
      h('div', { class: 'cats', id: 'cats' }), h('div', { class: 'main', id: 'main' }),
      h('div', { class: 'hint' }, h('span', {}, h('b', { text: 'OK' }), ' abrir'), h('span', {}, h('b', { text: 'Amarelo' }), ' favoritar'), h('span', {}, h('b', { text: 'Voltar' }), ' sair')));
  }
  async function goTab(t) {
    if (t === 'set') { hs.tab = 'set'; return showSettings(); }
    hs.tab = t; hs.catIdx = 0; hs.query = ''; drawHome(); await loadTab(true);
  }
  var $ = function (id) { return document.getElementById(id); };

  async function loadTab(focusFirst) {
    var kind = hs.tab, cats = $('cats'), main = $('main');
    if (kind === 'fav' || kind === 'cont') {
      cats.classList.add('hidden'); main.style.left = '40px';
      var list = kind === 'fav' ? store.state.favorites.filter(function (f) { return f.connId === conn.id || conn.id === 'tmp'; }) : store.continueList();
      hs.items = list.filter(itemOk); hs.cats = []; renderMain(); show('home', focusFirst ? '.card' : '.tab.on'); if (!hs.items.length) N.focus(screens.home.querySelector('.tab.on')); return;
    }
    cats.classList.remove('hidden'); main.style.left = '500px';
    var off = busy('Carregando as pastas…');
    try { hs.cats = (await source.categories(kind)).filter(function (c) { return catOk(c.name); }); }
    catch (e) { off(); toast(errText(e), 5000); hs.cats = []; }
    off();
    if (store.state.settings.sortAlpha && kind !== 'live') hs.cats = R.adultLast(R.sortedBy(hs.cats, function (c) { return c.name; }), function (c) { return c.name; });
    else hs.cats = R.adultLast(hs.cats, function (c) { return c.name; });
    if (kind === 'live' && !hs.catIdx) { var ft = R.featured(hs.cats, function (c) { return c.name; }); if (ft) hs.catIdx = hs.cats.indexOf(ft); }
    renderCats();
    await selectCat(hs.catIdx, focusFirst);
  }
  function renderCats() {
    var box = $('cats'); box.vzSet(hs.cats.map(function (c, i) {
      return h('button', { class: 'cat' + (i === hs.catIdx ? ' on' : ''), 'data-i': i, f: function () { selectCat(i, true); } }, h('span', { class: 't', text: c.name }), c.count != null ? h('span', { class: 'n', text: String(c.count) }) : null);
    }));
    if (!hs.cats.length) box.appendChild(h('div', { class: 'muted', style: 'padding:20px', text: 'Nenhuma pasta.' }));
  }
  async function selectCat(i, focusFirst) {
    if (!hs.cats.length) { hs.items = []; renderMain(); show('home', '.tab.on'); return; }
    hs.catIdx = i = Math.max(0, Math.min(i, hs.cats.length - 1)); hs.query = '';
    var cat = hs.cats[i], off = busy('Abrindo ' + cat.name + '…'), items = [];
    try { items = await source.items(hs.tab, cat); } catch (e) { toast(errText(e), 5000); }
    off();
    items = items.filter(itemOk);
    if (store.state.settings.sortAlpha && hs.tab !== 'live') items = R.sortedBy(items, function (x) { return x.name; });
    hs.items = items;
    Array.prototype.forEach.call(document.querySelectorAll('#cats .cat'), function (el, k) { el.classList.toggle('on', k === i); });
    renderMain();
    show('home', focusFirst && hs.items.length ? '.card' : '#cats .cat.on');
  }
  var shownItems = [];
  function renderMain() {
    var main = $('main'), live = hs.tab === 'live';
    var search = h('input', { class: 'search', type: 'text', f: true, placeholder: 'Buscar nesta pasta…', value: hs.query, maxlength: 60 });
    search.addEventListener('change', function () { hs.query = search.value.trim(); renderGrid(); N.focus(search); });
    var grid = h('div', { class: 'grid ' + (live ? 'live' : 'poster'), id: 'grid' });
    main.vzSet(hs.tab === 'fav' || hs.tab === 'cont' ? null : search, grid);
    if (hs.tab === 'fav' || hs.tab === 'cont') grid.style.height = '100%';
    renderGrid();
  }
  function filtered() {
    var q = R.norm(hs.query).trim();
    return q ? hs.items.filter(function (i) { return R.norm(i.name).indexOf(q) >= 0; }) : hs.items;
  }
  function cardFor(it) {
    var live = it.kind === 'live', fav = store.isFav(it.id), p = store.state.progress[it.id];
    var img = h('div', { class: 'img', style: it.logo ? 'background-image:' + cssUrl(it.logo) : null, text: it.logo ? '' : (live ? '📺' : '🎬') });
    var card = h('button', { class: 'card', f: function () { openItem(it); }, 'data-id': it.id }, img, h('div', { class: 'nm', text: it.name }), fav ? h('span', { class: 'star', text: '★' }) : null,
      p && hs.tab === 'cont' ? h('i', { class: 'pg', style: 'width:' + Math.round(p.pos / p.dur * 100) + '%' }) : null);
    card._item = it; return card;
  }
  function renderGrid() {
    var grid = $('grid'); if (!grid) return;
    shownItems = filtered(); hs.shown = Math.min(CHUNK, shownItems.length);
    grid.vzSet(shownItems.slice(0, hs.shown).map(cardFor));
    var old = screens.home.querySelector('.empty'); if (old) old.remove();
    if (!shownItems.length) screens.home.appendChild(h('div', { class: 'empty', text: hs.tab === 'fav' ? 'Nenhum favorito ainda. Aperte o botão amarelo em um item.' : hs.tab === 'cont' ? 'Nada para continuar.' : hs.query ? 'Nada encontrado.' : 'Esta pasta está vazia.' }));
  }
  function moreCards() {
    var grid = $('grid'); if (!grid || hs.shown >= shownItems.length) return false;
    var next = shownItems.slice(hs.shown, hs.shown + CHUNK); hs.shown += next.length; next.forEach(function (it) { grid.appendChild(cardFor(it)); }); return true;
  }
  function itemFromEntry(it) { // favoritos/continuar guardam uma cópia enxuta
    return it;
  }
  async function openItem(it) {
    if (it.kind === 'series' && (it.sid || it.seriesId) && source.type === 'xtream') return showSeries(it);
    var list = hs.tab === 'live' || it.kind === 'live' ? shownItems.filter(function (x) { return x.kind === 'live'; }) : null;
    playItem(it, { list: list, idx: list ? list.indexOf(it) : -1 });
  }

  // ---------- série ----------
  var ser = null;
  async function showSeries(it) {
    var off = busy('Abrindo a série…'), info;
    try { info = await X.seriesInfo(function (u) { return U.getText(u, { maxBytes: 20 * 1024 * 1024 }); }, conn, it.sid); } catch (e) { off(); toast(errText(e), 5000); return; }
    off();
    if (!info.seasons.length) { toast('Esta série não tem episódios.', 4000); return; }
    ser = { item: it, info: info, season: 0 }; drawSeries(true);
  }
  function drawSeries(first) {
    var scr = screens.series, i = ser.info, it = ser.item;
    var seasons = h('div', { class: 'seasons' }, i.seasons.map(function (s, k) { return h('button', { class: 'cat' + (k === ser.season ? ' on' : ''), f: function () { ser.season = k; drawSeries(false); N.focus(scr.querySelector('.ep')); }, 'data-k': k }, h('span', { class: 't', text: 'Temporada ' + s.number }), h('span', { class: 'n', text: String(s.episodes.length) })); }));
    var eps = h('div', { class: 'eps' }, i.seasons[ser.season].episodes.map(function (e, k) {
      var p = store.state.progress[e.id];
      return h('button', { class: 'ep', f: function () { playEpisode(k); } }, h('span', { class: 'nm', text: e.num + '. ' + e.title }), h('span', { class: 'dim', text: store.resume(e.id) ? 'Continuar' : '' }), p ? h('i', { class: 'pg', style: 'width:' + Math.round(p.pos / p.dur * 100) + '%' }) : null);
    }));
    var fav = h('button', { class: 'btn sm', text: store.isFav(it.id) ? '★ Favorito' : '☆ Favoritar', f: function () { var on = store.toggleFav(it, conn.id); fav.textContent = on ? '★ Favorito' : '☆ Favoritar'; } });
    scr.className = 'screen series' + (current === 'series' ? ' on' : '');
    scr.vzSet(h('div', { class: 'head' }, h('div', { class: 'cover', style: (i.cover || it.logo) ? 'background-image:' + cssUrl(i.cover || it.logo) : null }),
      h('div', { class: 'info' }, h('h1', { text: i.title || it.name }), h('p', { text: i.plot || '' }), h('div', { style: 'margin-top:18px' }, fav))), seasons, eps);
    show('series', first ? '.ep' : '.ep');
    scr.classList.add('series');
  }
  function playEpisode(k) {
    var s = ser.info.seasons[ser.season], e = s.episodes[k];
    playItem({ id: e.id, name: (ser.info.title || ser.item.name) + ' · T' + s.number + 'E' + e.num + ' ' + e.title, kind: 'episode', url: e.url, logo: e.logo || ser.item.logo }, { episodes: s.episodes, epIdx: k, back: 'series' });
  }

  // ---------- player ----------
  var pl = VZ.player.create($video, { onError: function (code) { playerError(code); } });
  var pctx = null, ovlTimer = null, progTimer = null;
  function playItem(it, o) {
    o = o || {};
    var url = it.url || (source ? source.playUrl(it) : null);
    if (!url) { toast('Não foi possível abrir este item.', 3000); return; }
    var live = it.kind === 'live';
    pctx = { item: it, live: live, list: o.list || null, idx: o.idx == null ? -1 : o.idx, episodes: o.episodes || null, epIdx: o.epIdx, back: o.back || (hs.tab === 'set' ? 'home' : 'home'), url: url };
    var scr = screens.player;
    scr.vzSet(h('div', { class: 'buf spin' }), h('div', { class: 'ovl' }, h('div', { class: 'ttl', id: 'ptl' }), h('div', { class: 'sub', id: 'psub' }), h('div', { class: 'bar' }, h('i', { id: 'pbar' }))),
      h('div', { class: 'err' }, h('div', { id: 'perr', text: '' }), h('div', { class: 'row' }, h('button', { class: 'btn pri', text: 'Tentar de novo', f: function () { startPlayback(); } }), h('button', { class: 'btn', text: 'Voltar', f: exitPlayer }))));
    scr.className = 'screen on wait'; show('player'); scr.classList.add('wait');
    startPlayback();
  }
  function startPlayback() {
    var c = pctx; if (!c) return; var scr = screens.player;
    scr.classList.remove('bad'); scr.classList.add('wait');
    $('ptl').textContent = c.item.name; $('psub').textContent = c.live ? 'Ao vivo' : '';
    pl.play(c.url, { live: c.live, resume: c.live ? 0 : store.resume(c.item.id) });
    showOverlay(5000); clearInterval(progTimer);
    progTimer = setInterval(function () {
      if (!c.live && $video.duration > 0) { store.recordProgress(c.item.id, $video.currentTime, $video.duration, { name: c.item.name, logo: c.item.logo || null, kind: c.item.kind === 'episode' ? 'episode' : 'movie', sid: c.item.sid || null, ext: c.item.ext || null, url: c.item.kind === 'episode' || source.type === 'm3u' ? c.url : null, connId: conn && conn.id }); var b = $('pbar'); if (b) b.style.width = Math.round($video.currentTime / $video.duration * 100) + '%'; }
    }, 10000);
  }
  function showOverlay(ms) { var scr = screens.player; scr.classList.add('show'); clearTimeout(ovlTimer); ovlTimer = setTimeout(function () { scr.classList.remove('show'); }, ms || 4000); }
  function playerError(code) {
    var scr = screens.player; scr.classList.remove('wait'); scr.classList.add('bad'); scr.classList.remove('show');
    var m = { network: 'Falha de rede ao carregar o vídeo.', media: 'Esta TV não conseguiu reproduzir este vídeo.', unsupported: 'Formato não suportado nesta TV.' }[code] || 'Não foi possível reproduzir.';
    $('perr').textContent = m; N.setScope(scr, '.btn');
  }
  function exitPlayer() {
    clearInterval(progTimer); clearTimeout(ovlTimer); pl.stop();
    if (pctx && !pctx.live && $video.duration > 0) { /* progresso já salvo pelo temporizador */ }
    var back = pctx && pctx.back; pctx = null; screens.player.className = 'screen';
    if (back === 'series' && ser) { show('series', '.ep'); } else { show('home', '#grid .card.focus, #grid .card'); }
  }
  function zap(d) {
    if (!pctx || !pctx.live || !pctx.list || pctx.idx < 0) return;
    var n = pctx.idx + d; if (n < 0 || n >= pctx.list.length) return;
    var it = pctx.list[n], url = source.playUrl(it); if (!url) return;
    pctx.idx = n; pctx.item = it; pctx.url = url; startPlayback();
  }
  $video.addEventListener('playing', function () { screens.player.classList.remove('wait', 'bad'); });
  $video.addEventListener('waiting', function () { if (current === 'player') screens.player.classList.add('wait'); });
  $video.addEventListener('ended', function () {
    if (!pctx || pctx.live) return;
    store.recordProgress(pctx.item.id, 1, 1, null);
    if (pctx.episodes && pctx.epIdx + 1 < pctx.episodes.length) { var e = pctx.episodes[pctx.epIdx + 1]; pctx.epIdx++; pctx.item = { id: e.id, name: (ser.info.title || '') + ' · ' + e.title, kind: 'episode', url: e.url, logo: e.logo }; pctx.url = e.url; startPlayback(); }
    else exitPlayer();
  });

  // ---------- ajustes ----------
  function showSettings() {
    var scr = screens.settings, st = store.state, d = lic.decision(), info = lic.lastInfo() || {}, left = lic.daysLeft();
    var licText = !lic.configured ? 'Sem trava de licença' : !d.allowed ? 'Sem licença ativa' : info.lifetime ? 'Vitalícia' : info.state === 'trial_active' ? 'Teste grátis' + (left != null ? ' · ' + left + ' dia(s)' : '') : 'Ativa' + (left != null ? ' · ' + left + ' dia(s)' : '');
    var rows = [];
    rows.push(h('div', { class: 'sgroup', text: 'Listas' }));
    st.connections.forEach(function (c) {
      rows.push(h('div', { class: 'srow' }, h('button', { class: 'btn sm', style: 'min-width:0;flex:1;justify-content:flex-start;background:none', f: async function () { var off = busy('Carregando a lista…'); try { store.state.defaultConn = c.id; store.save(); source = null; conn = null; await openConnection(c); off(); showHome('live'); } catch (e) { off(); toast(errText(e), 5000); } } }, h('span', { text: store.displayName(c) }), h('small', { text: (c.type === 'xtream' ? 'Xtream' : 'M3U') + (conn && conn.id === c.id ? ' · em uso' : '') })),
        h('button', { class: 'btn sm dng', text: 'Excluir', f: async function () {
          if (st.parental) { var pin = await askPin(); if (pin == null) return; if (!(await store.verifyPin(pin))) return toast('Senha incorreta.'); }
          var r = await ask({ title: 'Excluir esta lista?', text: store.displayName(c), buttons: [{ label: 'Excluir', value: 'ok', cls: 'dng' }, { label: 'Cancelar', value: 'cancel' }] });
          if (r.value !== 'ok') return; store.removeConnection(c.id); if (conn && conn.id === c.id) { conn = null; source = null; } if (!store.state.connections.length) showPair(); else showSettings();
        } })));
    });
    rows.push(h('button', { class: 'srow', f: function () { showPair(); } }, h('span', { text: 'Vincular nova lista (ID e chave)' })));
    rows.push(h('button', { class: 'srow', f: function () { showManual(); } }, h('span', { text: 'Adicionar lista digitando' })));
    rows.push(h('div', { class: 'sgroup', text: 'Preferências' }));
    rows.push(h('button', { class: 'srow', f: async function () {
      if (adultOn) { adultOn = false; toast('Conteúdo adulto escondido.'); return showSettings(); }
      if (!store.state.parental) {
        var r = await ask({ title: 'Crie uma senha', text: 'De 4 a 8 números. Ela protege o conteúdo adulto e a exclusão de listas.', input: { type: 'password', numeric: true, max: 8, placeholder: 'Nova senha' }, buttons: [{ label: 'Salvar', value: 'ok', cls: 'pri' }, { label: 'Cancelar', value: 'cancel' }] });
        if (r.value !== 'ok') return; try { await store.setPin(r.text); } catch (e) { return toast('A senha deve ter de 4 a 8 números.'); }
      } else { var pin = await askPin(); if (pin == null) return; if (!(await store.verifyPin(pin))) return toast('Senha incorreta.'); }
      adultOn = true; toast('Conteúdo adulto liberado até fechar o app.'); showSettings();
    } }, h('span', { text: 'Conteúdo adulto' }), h('small', { text: adultOn ? 'Liberado' : 'Escondido' })));
    rows.push(h('button', { class: 'srow', f: function () { st.settings.sortAlpha = !st.settings.sortAlpha; store.save(); showSettings(); } }, h('span', { text: 'Filmes e séries em ordem A–Z' }), h('small', { text: st.settings.sortAlpha ? 'Ligado' : 'Desligado' })));
    rows.push(h('div', { class: 'sgroup', text: 'Licença' }));
    rows.push(h('button', { class: 'srow', f: async function () { if (!lic.configured) return; var off = busy('Verificando…'); try { await lic.check(); } catch (e) { off(); return toast('Sem conexão com o servidor de licença.'); } off(); if (!lic.decision().allowed) showLicense(); else showSettings(); } }, h('span', { text: licText }), h('small', { text: 'ID ' }), h('span', { class: 'dim', id: 'sid', text: '' })));
    rows.push(h('div', { class: 'sgroup', text: 'Sobre' }));
    rows.push(h('div', { class: 'srow' }, h('span', { text: 'Vionza Play ' + (C.VERSION || '') }), h('small', { text: COPYRIGHT })));
    rows.push(h('button', { class: 'srow', f: function () { showHome(hs.tab === 'set' ? 'live' : hs.tab); } }, h('span', { text: '← Voltar ao início' })));
    scr.vzSet(h('div', { class: 'set' }, h('h2', { text: 'Ajustes' }), rows));
    lic.installId().then(function (id) { var e = $('sid'); if (e) e.textContent = id; });
    show('settings', '.srow, .btn');
  }

  // ---------- teclas ----------
  N.onBack(function () {
    if (modalOpen) { ask.cancel(); return true; }
    if (current === 'player') { exitPlayer(); return true; }
    if (current === 'series') { show('home', '#grid .card'); return true; }
    if (current === 'settings') { showHome(hs.tab === 'set' ? 'live' : hs.tab); return true; }
    if (current === 'manual') { showPair(); return true; }
    if (current === 'pair') { if (store.state.connections.length) showHome(); else exitApp(); return true; }
    if (current === 'home') { ask({ title: 'Sair do Vionza Play?', buttons: [{ label: 'Sair', value: 'ok', cls: 'pri' }, { label: 'Ficar', value: 'cancel' }] }).then(function (r) { if (r.value === 'ok') exitApp(); }); return true; }
    exitApp(); return true;
  });
  function exitApp() { try { if (window.webOS && window.webOS.platformBack) return window.webOS.platformBack(); if (window.PalmSystem && window.PalmSystem.platformBack) return window.PalmSystem.platformBack(); window.close(); } catch (e) { /* ok */ } }
  N.onMedia(function (e) {
    var k = e.keyCode;
    if (current === 'player' && !screens.player.classList.contains('bad') && !modalOpen) {
      if (k === K.ENTER || k === K.PLAY || k === K.PAUSE) { if (k === K.PLAY) $video.play(); else if (k === K.PAUSE) $video.pause(); else pl.toggle(); showOverlay(); return true; }
      if (k === K.LEFT) { pl.seek(-15); showOverlay(); return true; }
      if (k === K.RIGHT) { pl.seek(15); showOverlay(); return true; }
      if (k === K.RW) { pl.seek(-60); showOverlay(); return true; }
      if (k === K.FF) { pl.seek(60); showOverlay(); return true; }
      if (k === K.UP || k === K.CH_UP) { if (pctx && pctx.live) zap(-1); else showOverlay(); return true; }
      if (k === K.DOWN || k === K.CH_DOWN) { if (pctx && pctx.live) zap(1); else showOverlay(); return true; }
      if (k === K.STOP) { exitPlayer(); return true; }
      return false;
    }
    if (k === 405 && current === 'home' && !modalOpen) { // botão amarelo: favoritar o item em foco
      var el = N.current(); var it = el && el._item; if (!it) return false;
      var on = store.toggleFav(it, conn && conn.id); el.classList.toggle('has-fav', on);
      var star = el.querySelector('.star'); if (on && !star) el.appendChild(h('span', { class: 'star', text: '★' })); if (!on && star) star.remove();
      toast(on ? 'Adicionado aos favoritos' : 'Removido dos favoritos', 1500); if (hs.tab === 'fav' && !on) { hs.items = hs.items.filter(function (x) { return x.id !== it.id; }); var nx = N.pick(el, 'right') || N.pick(el, 'left'); renderGrid(); if (nx && nx._item) { var again = screens.home.querySelector('[data-id="' + nx._item.id + '"]'); if (again) N.focus(again); } else N.focus(screens.home.querySelector('.tab.on')); }
      return true;
    }
    return false;
  });
  N.onDir(function (dir, el) {
    if (current !== 'home' || !el) return false;
    if (dir === 'down' && el._item && !N.pick(el, 'down') && moreCards()) { var nx = N.pick(el, 'down'); if (nx) N.focus(nx); return true; }
    if (dir === 'right' && el.classList.contains('cat')) { var first = screens.home.querySelector('#grid .card'); if (first) { N.focus(first); return true; } }
    if (dir === 'left' && el._item && !N.pick(el, 'left') && hs.cats.length) { var c = screens.home.querySelector('#cats .cat.on'); if (c) { N.focus(c); return true; } }
    if (dir === 'down' && el.classList.contains('tab')) { var t = hs.cats.length ? screens.home.querySelector('#cats .cat.on') : screens.home.querySelector('#grid .card'); if (t) { N.focus(t); return true; } }
    return false;
  });

  // ---------- licença em segundo plano ----------
  setInterval(function () {
    if (!lic.configured || current === 'license' || current == null) return;
    var go = function () { if (!lic.decision().allowed) { pl.stop(); clearInterval(progTimer); pctx = null; screens.player.className = 'screen'; showLicense(); } };
    if (lic.isStale(10 * 60000)) lic.revalidate().then(go); else go();
  }, 60000);

  // ---------- início do app ----------
  async function startApp() {
    var c = store.defaultConnection();
    if (!c) return showPair();
    var off = busy('Carregando a sua lista…');
    try { await openConnection(c); off(); showHome(hs.tab === 'set' ? 'live' : 'live'); }
    catch (e) {
      off(); toast(errText(e), 7000);
      if (e && (e.code === 'xt_auth' || e.code === 'xt_expired' || e.code === 'xt_inactive')) showPair(); else { conn = null; source = null; showSettings(); }
    }
  }
  async function boot() {
    var off = busy('Iniciando…');
    try {
      await lic.load();
      if (lic.configured) {
        try { var info = await lic.check(); licenseNetError = null; if (info.trialEligible && !lic.decision().allowed) await lic.startTrial(); } catch (e) { licenseNetError = e; }
      }
    } catch (e) { licenseNetError = e; }
    off();
    if (!lic.decision().allowed) return showLicense();
    startApp();
  }
  window.addEventListener('error', function () { /* nunca derruba a TV com tela branca: o erro fica no console */ });
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
  VZ.app = { show: show, store: store, lic: lic, _h: h, ask: ask };
})();
