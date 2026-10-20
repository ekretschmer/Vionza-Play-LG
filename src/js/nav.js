/*
 * Navegação pelo controle remoto (setas + OK + Voltar). Elementos focáveis têm o atributo data-f e tabindex=-1.
 * Dentro de um "escopo" (tela ou janela aberta): a seta procura o vizinho mais próximo naquela direção.
 */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};
  var KEYS = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK_WEBOS: 461, BACK: 8, ESC: 27, PLAY: 415, PAUSE: 19, STOP: 413, FF: 417, RW: 412, CH_UP: 427, CH_DOWN: 428, PGUP: 33, PGDN: 34 };
  var scope = null, handler = null, backHandler = null, mediaHandler = null;

  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled && getComputedStyle(el).visibility !== 'hidden'; }
  function items() { return scope ? Array.prototype.filter.call(scope.querySelectorAll('[data-f]'), visible) : []; }
  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  /** Candidato mais próximo na direção; o eixo principal pesa menos que o transversal (alinha com a linha/coluna). */
  function pick(from, dir) {
    var a = from.getBoundingClientRect(), ca = center(a), best = null, bestScore = Infinity;
    items().forEach(function (el) {
      if (el === from) return;
      var b = el.getBoundingClientRect(), cb = center(b), dx = cb.x - ca.x, dy = cb.y - ca.y, main, cross;
      if (dir === 'left') { if (b.right > a.left + 4 && dx >= -2) return; main = a.left - b.right; cross = Math.abs(dy); }
      else if (dir === 'right') { if (b.left < a.right - 4 && dx <= 2) return; main = b.left - a.right; cross = Math.abs(dy); }
      else if (dir === 'up') { if (b.bottom > a.top + 4 && dy >= -2) return; main = a.top - b.bottom; cross = Math.abs(dx); }
      else { if (b.top < a.bottom - 4 && dy <= 2) return; main = b.top - a.bottom; cross = Math.abs(dx); }
      if (main < -4) return;
      var score = Math.max(main, 0) + cross * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    return best;
  }
  function focus(el) {
    if (!el) return false;
    var prev = scope && scope.querySelector('.focus'); if (prev) prev.classList.remove('focus');
    el.classList.add('focus');
    try { el.focus({ preventScroll: true }); } catch (e) { /* ok */ }
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ok */ }
    return true;
  }
  function setScope(root, first) {
    scope = root;
    var el = null;
    if (first) el = typeof first === 'string' ? root.querySelector(first) : first;
    if (!el || !visible(el)) el = items()[0];
    focus(el);
  }
  function current() { return scope ? scope.querySelector('.focus') || document.activeElement : null; }
  function isTextField(el) { return el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(button|checkbox|radio)$/.test(el.type || ''); }

  function onKey(e) {
    var k = e.keyCode, el = current();
    if (mediaHandler && mediaHandler(e)) { e.preventDefault(); return; }
    if (k === KEYS.BACK_WEBOS || k === KEYS.ESC || (k === KEYS.BACK && !isTextField(el))) { if (backHandler && backHandler(e)) e.preventDefault(); return; }
    if (isTextField(el) && (k === KEYS.LEFT || k === KEYS.RIGHT)) return; // cursor dentro do texto
    var dir = k === KEYS.LEFT ? 'left' : k === KEYS.RIGHT ? 'right' : k === KEYS.UP ? 'up' : k === KEYS.DOWN ? 'down' : null;
    if (dir) {
      e.preventDefault();
      if (handler && handler(dir, el, e) === true) return;
      var nx = el ? pick(el, dir) : items()[0];
      if (nx) focus(nx);
      return;
    }
    if (k === KEYS.ENTER && el && !isTextField(el)) { e.preventDefault(); el.click(); }
  }
  g.addEventListener('keydown', onKey, true);
  // mouse/ponteiro mágico da LG: acompanha o foco
  g.addEventListener('mouseover', function (e) { var t = e.target && e.target.closest && e.target.closest('[data-f]'); if (t && scope && scope.contains(t)) focus(t); }, true);

  VZ.nav = {
    KEYS: KEYS, focus: focus, setScope: setScope, items: items, pick: pick, current: current,
    onDir: function (fn) { handler = fn; }, onBack: function (fn) { backHandler = fn; }, onMedia: function (fn) { mediaHandler = fn; },
    get scope() { return scope; }
  };
})(typeof self !== 'undefined' ? self : global);
