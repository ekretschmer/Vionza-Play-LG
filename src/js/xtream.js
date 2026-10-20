/*
 * Xtream Codes (player_api.php). Na TV a memória é pequena: NADA de baixar a lista inteira.
 * Carrega só as pastas (categorias) e, ao abrir uma pasta, só os itens dela (get_*_streams&category_id=).
 * Os itens não guardam usuário/senha: o endereço de reprodução é montado na hora de tocar (playUrl).
 */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};
  var U = VZ.util || (typeof require !== 'undefined' ? require('./util') : null);
  var M = VZ.m3u || (typeof require !== 'undefined' ? require('./m3u') : null);
  var ListError = M.ListError;
  var enc = encodeURIComponent;
  var str = function (o, k) { return o && o[k] != null ? String(o[k]) : ''; };

  function withScheme(raw) {
    var s = String(raw).trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) throw new Error('bad_url');
    return 'http://' + s;
  }
  /** Endereço base: sem barra final e sem .php colado (ex.: get.php?username=...). Lança se inválido. */
  function base(raw) {
    var u = new URL(withScheme(raw));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad_url');
    var path = u.pathname || '';
    if (/\.php$/i.test(path.split('/').pop())) path = path.slice(0, path.lastIndexOf('/'));
    path = path.replace(/\/+$/, '');
    return u.protocol + '//' + u.host + path;
  }
  var apiUrl = function (c, q) { return base(c.url) + '/player_api.php?username=' + enc(c.user) + '&password=' + enc(c.pass) + (q || ''); };
  var xmltvUrl = function (c) { return base(c.url) + '/xmltv.php?username=' + enc(c.user) + '&password=' + enc(c.pass); };

  async function authenticate(getText, c, now) {
    var text = await getText(apiUrl(c)), ui;
    try { ui = JSON.parse(text).user_info; } catch (e) { ui = null; }
    if (!ui) throw ListError('xt_format');
    if (str(ui, 'auth') !== '1') throw ListError('xt_auth');
    var exp = Number(str(ui, 'exp_date')) || null, status = str(ui, 'status');
    if (exp != null && exp * 1000 < (now || Date.now())) { var e = ListError('xt_expired', 'Sua conta expirou em ' + new Date(exp * 1000).toLocaleDateString('pt-BR') + '.'); throw e; }
    if (status && status.toLowerCase() !== 'active') throw ListError('xt_inactive', 'A conta não está ativa (' + status + ').');
    return { status: status, exp: exp };
  }
  function arr(text) {
    if (String(text).replace(/^\s+/, '').charAt(0) !== '[') return null;
    try { return JSON.parse(text); } catch (e) { throw ListError('xt_truncated'); }
  }

  var KIND_ACTIONS = {
    live: ['get_live_categories', 'get_live_streams'],
    movie: ['get_vod_categories', 'get_vod_streams'],
    series: ['get_series_categories', 'get_series']
  };
  /** Pastas de um tipo: [{ id, name }] na ordem do servidor. */
  async function categories(getText, c, kind) {
    var list = arr(await getText(apiUrl(c, '&action=' + KIND_ACTIONS[kind][0]))) || [];
    var out = [];
    list.forEach(function (x) { var id = str(x, 'category_id'), name = str(x, 'category_name').trim(); if (id) out.push({ id: id, name: name || M.DEFAULT_GROUP }); });
    return out;
  }
  /** Itens de uma pasta. Cada item: { id, name, logo, kind, group, sid, ext }. */
  async function items(getText, c, kind, cat) {
    var list = arr(await getText(apiUrl(c, '&action=' + KIND_ACTIONS[kind][1] + '&category_id=' + enc(cat.id)))) || [];
    var host = ''; try { host = new URL(withScheme(c.url)).hostname; } catch (e) { /* vazio */ }
    var out = [];
    list.forEach(function (s) {
      var sid = kind === 'series' ? str(s, 'series_id') : str(s, 'stream_id'), name = str(s, 'name').trim();
      if (!sid || !name) return;
      var adult = str(s, 'is_adult');
      out.push({
        id: U.hash16('xt|' + host + '|' + kind + '|' + sid), name: name, kind: kind, group: cat.name, sid: sid,
        logo: (kind === 'series' ? str(s, 'cover') : str(s, 'stream_icon')) || null,
        ext: str(s, 'container_extension').replace(/[^A-Za-z0-9]/g, '') || 'mp4',
        tvgId: str(s, 'epg_channel_id') || null,
        adultFlag: adult === '1' ? true : adult === '0' ? false : undefined
      });
    });
    return out;
  }
  /** Endereço de reprodução (só na hora de tocar). Séries usam o endereço do episódio. */
  function playUrl(c, item) {
    var b = base(c.url), u = enc(c.user), p = enc(c.pass);
    if (item.kind === 'live') return b + '/live/' + u + '/' + p + '/' + item.sid + '.m3u8';
    if (item.kind === 'movie') return b + '/movie/' + u + '/' + p + '/' + item.sid + '.' + (item.ext || 'mp4');
    return null;
  }
  function parseSeriesInfo(text, c) {
    var j; try { j = JSON.parse(text); } catch (e) { return null; }
    if (!j || typeof j !== 'object' || !j.episodes) return null;
    var b = base(c.url), u = enc(c.user), p = enc(c.pass), seasons = [];
    var eps = Array.isArray(j.episodes) ? { 1: j.episodes } : j.episodes;
    Object.keys(eps).forEach(function (key) {
      var list = Array.isArray(eps[key]) ? eps[key] : [];
      var episodes = [];
      list.forEach(function (e, i) {
        var id = str(e, 'id'); if (!id) return;
        var ext = str(e, 'container_extension').replace(/[^A-Za-z0-9]/g, '') || 'mp4', info = e.info || {};
        episodes.push({ id: U.hash16('xtep|' + id), num: Number(str(e, 'episode_num')) || i + 1, title: str(e, 'title') || 'Episódio ' + (i + 1), logo: str(info, 'movie_image') || null, durationSec: Number(str(info, 'duration_secs')) || 0, url: b + '/series/' + u + '/' + p + '/' + id + '.' + ext });
      });
      episodes.sort(function (x, y) { return x.num - y.num; });
      if (episodes.length) seasons.push({ number: Number(key) || seasons.length + 1, episodes: episodes });
    });
    seasons.sort(function (x, y) { return x.number - y.number; });
    var info = j.info || {};
    return { title: str(info, 'name'), plot: str(info, 'plot'), cover: str(info, 'cover') || null, seasons: seasons };
  }
  async function seriesInfo(getText, c, sid) {
    var id = String(sid).replace(/[^A-Za-z0-9_-]/g, '');
    var r = parseSeriesInfo(await getText(apiUrl(c, '&action=get_series_info&series_id=' + enc(id))), c);
    if (!r) throw ListError('series_format');
    return r;
  }

  VZ.xtream = { base: base, withScheme: withScheme, apiUrl: apiUrl, xmltvUrl: xmltvUrl, authenticate: authenticate, categories: categories, items: items, playUrl: playUrl, parseSeriesInfo: parseSeriesInfo, seriesInfo: seriesInfo };
  if (typeof module !== 'undefined') module.exports = VZ.xtream;
})(typeof self !== 'undefined' ? self : global);
