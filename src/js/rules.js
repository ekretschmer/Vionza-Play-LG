/* Regras puras (iguais às do app Android/Windows): conteúdo adulto, ordem alfabética, "Destaques do dia". */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};
  function norm(s) {
    var t = String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9À-￿]+/g, ' ').trim();
    return ' ' + (t || ' ') + ' ';
  }
  var PLUS_18 = /(\+\s?18\b|\b18\s?\+)/;
  var mentions18 = function (t) { return String(t).indexOf('18') >= 0 && PLUS_18.test(String(t).toLowerCase()); };
  var ADULT_GROUP = ['adult', 'adults', 'adulto', 'adultos', 'adulta', 'adultas', 'xxx', 'porn', 'porno', 'pornografia', 'pornografico', 'erotic', 'erotica', 'erotico', 'eroticos', 'erotique', 'hentai', 'sexo', 'sex', 'mature', 'adultes', 'erotismo', '18 plus', 'mais 18', 'maiores 18', 'over 18', 'for adults', 'so adultos', 'xxx adult'].map(norm);
  var ADULT_NAME = ['xxx', 'porn', 'porno', 'pornografia', 'hentai', 'erotic', 'erotico', 'erotica', 'playboy', 'hustler', 'penthouse', 'brazzers', 'redlight', 'dorcel', 'sextreme', 'sexyhot', 'sex hot', 'sexy hot', 'sexprive', 'adult only', 'adults only'].map(norm);
  var NOT_ADULT = ['adult swim'].map(norm);
  var has = function (list, t) { return list.some(function (x) { return t.indexOf(x) >= 0; }); };

  function adultByMetadata(group, name) {
    var gg = norm(group), n = name ? norm(name) : '  ';
    if (has(NOT_ADULT, gg) || has(NOT_ADULT, n)) return false;
    if (mentions18(group) || mentions18(name || '')) return true;
    if (has(ADULT_GROUP, gg)) return true;
    return has(ADULT_NAME, n);
  }
  function isAdult(item) {
    if (item.adultFlag === true) return true;
    if (item.adultFlag === false) return adultByMetadata(item.group, '');
    return adultByMetadata(item.group, item.name);
  }
  function alphaKey(name) {
    var base = String(name == null ? '' : name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^[^a-z0-9À-￿]+/, '');
    return base.replace(/\d+/g, function (d) { return ('000000000000' + d.replace(/^0+/, '')).slice(-12); });
  }
  function sortedBy(list, name) {
    return list.map(function (x) { return [alphaKey(name(x)), x]; }).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }).map(function (p) { return p[1]; });
  }
  function adultLast(rows, label) {
    var normal = [], adult = [];
    rows.forEach(function (r) { (adultByMetadata(label(r), '') ? adult : normal).push(r); });
    return normal.concat(adult);
  }
  var isFeatured = function (label) { return alphaKey(label).indexOf('destaques do dia') === 0; };
  var featured = function (rows, label) { for (var i = 0; i < rows.length; i++) if (isFeatured(label(rows[i]))) return rows[i]; return null; };

  VZ.rules = { norm: norm, adultByMetadata: adultByMetadata, isAdult: isAdult, alphaKey: alphaKey, sortedBy: sortedBy, adultLast: adultLast, isFeatured: isFeatured, featured: featured };
  if (typeof module !== 'undefined') module.exports = VZ.rules;
})(typeof self !== 'undefined' ? self : global);
