/* Informações da TV (webOS). Tudo opcional: fora da TV (testes/navegador) devolve valores genéricos. */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};

  /** { model, os } — só para o painel mostrar "qual aparelho é". Nada pessoal. */
  function info() {
    var model = '', os = 'webOS';
    try {
      var raw = (g.webOSSystem && g.webOSSystem.deviceInfo) || (g.PalmSystem && g.PalmSystem.deviceInfo) || null;
      var d = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (d) {
        model = d.modelName || d.model_name || '';
        if (d.version) os = 'webOS ' + d.version;
      }
    } catch (e) { /* sem informação */ }
    if (!model) model = 'LG TV';
    else if (!/^lg\b/i.test(model)) model = 'LG ' + model;
    return { model: model.slice(0, 60), os: os.slice(0, 30) };
  }

  /**
   * LGUDID (ID único do aparelho) pelo serviço da TV. Só funciona numa TV de verdade (webOS 3.0+); no emulador não.
   * Usa a ponte nativa do webOS (a mesma que a biblioteca webOSTV.js usa). Resolve null se não der em [ms].
   */
  function lgudid(ms) {
    return new Promise(function (resolve) {
      var done = false, finish = function (v) { if (!done) { done = true; resolve(v); } };
      setTimeout(function () { finish(null); }, ms || 3000);
      try {
        if (typeof g.PalmServiceBridge !== 'function') return finish(null);
        var b = new g.PalmServiceBridge();
        b.onservicecallback = function (msg) {
          try {
            var r = JSON.parse(msg), id = r && r.returnValue && r.idList && r.idList[0] && r.idList[0].idValue;
            finish(id ? String(id) : null);
          } catch (e) { finish(null); }
        };
        b.call('luna://com.webos.service.sm/deviceid/getIDs', JSON.stringify({ idType: ['LGUDID'] }));
      } catch (e) { finish(null); }
    });
  }

  VZ.device = { info: info, lgudid: lgudid };
  if (typeof module !== 'undefined') module.exports = VZ.device;
})(typeof self !== 'undefined' ? self : global);
