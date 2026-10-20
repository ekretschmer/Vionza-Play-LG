/* Leitura de lista M3U (#EXTM3U/#EXTINF). Mesmas regras do app Android. */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};
  var U = VZ.util || (typeof require !== 'undefined' ? require('./util') : null);
  var DEFAULT_GROUP = 'Outros';
  var EPG_KEYS = ['url-tvg', 'x-tvg-url', 'tvg-url', 'url-epg', 'epg-url', 'x-epg-url'];
  var HLS_TAGS = ['#EXT-X-TARGETDURATION', '#EXT-X-MEDIA-SEQUENCE', '#EXT-X-STREAM-INF', '#EXT-X-ENDLIST', '#EXT-X-PLAYLIST-TYPE'];

  function ListError(code, message) { var e = new Error(message || code); e.code = code; return e; }

  function detectKind(group, url) {
    var gg = U.fold(group), u = url.toLowerCase(), path = u.split('?')[0];
    if (u.indexOf('/series/') >= 0 || gg.indexOf('serie') >= 0) return 'series';
    if (u.indexOf('/movie/') >= 0 || gg.indexOf('filme') >= 0 || gg.indexOf('movie') >= 0 || gg.indexOf('vod') >= 0 || gg.indexOf('cinema') >= 0 ||
        /\.(mp4|mkv|avi)$/.test(path)) return 'movie';
    return 'live';
  }
  function attrs(head) {
    var a = {}, re = /([A-Za-z0-9_\-]+)\s*=\s*"([^"]*)"/g, m;
    while ((m = re.exec(head))) a[m[1].toLowerCase()] = m[2].trim();
    return a;
  }
  function epgUrlsFromHeader(header) {
    var a = {}, re = /([A-Za-z0-9_\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"',]+))/g, m;
    while ((m = re.exec(header))) a[m[1].toLowerCase()] = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4] || '';
    var raw = ''; for (var i = 0; i < EPG_KEYS.length; i++) { if (a[EPG_KEYS[i]] && a[EPG_KEYS[i]].trim()) { raw = a[EPG_KEYS[i]]; break; } }
    if (!raw) return [];
    var seen = {}, out = [];
    raw.split(/[,; ]/).forEach(function (s) { s = s.trim(); if (/^https?:\/\//i.test(s) && !seen[s]) { seen[s] = 1; out.push(s); } });
    return out.slice(0, 3);
  }
  function parseExtinf(line) {
    var body = line.slice(line.indexOf(':') + 1), inQ = false, comma = -1;
    for (var i = 0; i < body.length; i++) { var c = body[i]; if (c === '"') inQ = !inQ; else if (c === ',' && !inQ) { comma = i; break; } }
    var head = comma >= 0 ? body.slice(0, comma) : body;
    var title = comma >= 0 ? body.slice(comma + 1).trim() : '';
    var a = attrs(head);
    return { name: title || a['tvg-name'] || null, tvgId: a['tvg-id'] || null, logo: a['tvg-logo'] || null, group: a['group-title'] || null };
  }
  function nameFromUrl(url) {
    var last = url.split('?')[0].replace(/\/+$/, '').split('/').pop() || '', d = last;
    try { d = decodeURIComponent(last); } catch (e) { /* mantém */ }
    return d || 'Sem nome';
  }

  /** Devolve { items, epgUrls }. Item: { id, name, logo, group, kind, url }. Lança erro com .code legível. */
  function parse(text) {
    var groups = {}, items = [], epgUrls = [], sawAny = false, sawHeader = false, sawExtinf = false, pending = null, pendingGroup = null;
    var lines = String(text).replace(/^﻿/, '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      sawAny = true;
      if (line.charAt(0) === '#') {
        var up = line.toUpperCase();
        if (up.indexOf('#EXTM3U') === 0) { sawHeader = true; epgUrls = epgUrlsFromHeader(line); }
        else if (up.indexOf('#EXTINF') === 0) { sawExtinf = true; pending = parseExtinf(line); }
        else if (up.indexOf('#EXTGRP:') === 0) pendingGroup = line.slice(line.indexOf(':') + 1).trim() || null;
        else if (HLS_TAGS.some(function (t) { return up.indexOf(t) === 0; })) throw ListError('hls_manifest');
        continue;
      }
      if (!sawHeader && !sawExtinf) throw ListError('bad_format');
      if (line.indexOf('://') < 0) continue;
      var p = pending;
      var name = (p && p.name) || nameFromUrl(line);
      var g0 = ((p && p.group) || pendingGroup || '').trim() || DEFAULT_GROUP;
      var group = groups[g0] || (groups[g0] = g0);
      items.push({ id: U.hash16(line + '|' + name), name: name, logo: (p && p.logo) || null, group: group, url: line, kind: detectKind(group, line) });
      pending = null; pendingGroup = null;
    }
    if (!sawAny) throw ListError('empty_list');
    if (!sawHeader && !sawExtinf) throw ListError('bad_format');
    if (!items.length) throw ListError('empty_items');
    return { items: items, epgUrls: epgUrls };
  }

  VZ.m3u = { DEFAULT_GROUP: DEFAULT_GROUP, ListError: ListError, detectKind: detectKind, parse: parse, epgUrlsFromHeader: epgUrlsFromHeader };
  if (typeof module !== 'undefined') module.exports = VZ.m3u;
})(typeof self !== 'undefined' ? self : global);
