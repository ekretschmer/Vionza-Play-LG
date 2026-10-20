/*
 * Player: usa o player nativo da TV quando ele toca o formato (mais leve, decodifica por hardware);
 * hls.js (HLS) e mpegts.js (MPEG-TS ao vivo) entram quando o nativo não resolve. Troca sozinho de motor uma vez se der erro.
 */
(function (g) {
  'use strict';
  var VZ = g.VZ = g.VZ || {};

  function kindOf(url, live) {
    var p = String(url).split('?')[0].toLowerCase();
    if (/\.m3u8$/.test(p)) return 'hls';
    if (/\.ts$/.test(p) || (live && !/\.(mp4|mkv|avi|mov|webm)$/.test(p))) return 'ts';
    return 'file';
  }

  function create(video, hooks) {
    hooks = hooks || {};
    var hls = null, mpt = null, cur = null, tried = {};
    function destroy() {
      if (hls) { try { hls.destroy(); } catch (e) { /* ok */ } hls = null; }
      if (mpt) { try { mpt.pause(); mpt.unload(); mpt.detachMediaElement(); mpt.destroy(); } catch (e) { /* ok */ } mpt = null; }
      try { video.pause(); } catch (e) { /* ok */ }
      video.removeAttribute('src'); try { video.load(); } catch (e) { /* ok */ }
    }
    function fail(code) { if (hooks.onError) hooks.onError(code); }

    var engines = {
      native: function (url) { video.src = url; var p = video.play(); if (p && p.catch) p.catch(function () { /* o usuário aperta OK */ }); },
      hls: function (url) {
        if (!g.Hls || !g.Hls.isSupported()) return false;
        hls = new g.Hls({ maxBufferLength: 20, backBufferLength: 10, enableWorker: true, lowLatencyMode: false, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 3, fragLoadingMaxRetry: 3 });
        hls.on(g.Hls.Events.ERROR, function (ev, data) {
          if (!data || !data.fatal) return;
          if (data.type === g.Hls.ErrorTypes.NETWORK_ERROR) { try { hls.startLoad(); } catch (e) { fail('network'); } tried.hlsNet = (tried.hlsNet || 0) + 1; if (tried.hlsNet > 3) fail('network'); }
          else if (data.type === g.Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); } catch (e) { fail('media'); } }
          else fail('media');
        });
        hls.loadSource(url); hls.attachMedia(video);
        hls.on(g.Hls.Events.MANIFEST_PARSED, function () { var p = video.play(); if (p && p.catch) p.catch(function () { /* ok */ }); });
        return true;
      },
      mpegts: function (url) {
        if (!g.mpegts || !g.mpegts.getFeatureList().mseLivePlayback) return false;
        mpt = g.mpegts.createPlayer({ type: 'mpegts', isLive: true, url: url }, { enableWorker: true, liveBufferLatencyChasing: true, lazyLoadMaxDuration: 30 });
        mpt.on(g.mpegts.Events.ERROR, function () { fail('media'); });
        mpt.attachMediaElement(video); mpt.load();
        var p = mpt.play(); if (p && p.catch) p.catch(function () { /* ok */ });
        return true;
      }
    };
    /** Ordem de tentativa por formato. HLS: nativo primeiro se a TV diz que toca; senão hls.js. */
    function plan(url, live) {
      var k = kindOf(url, live), nativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');
      if (k === 'hls') return nativeHls ? ['native', 'hls'] : ['hls', 'native'];
      if (k === 'ts') return ['native', 'mpegts'];
      return ['native'];
    }
    var m = {
      kindOf: kindOf, plan: plan,
      play: function (url, o) {
        o = o || {}; destroy(); tried = {}; cur = { url: url, live: !!o.live, steps: plan(url, !!o.live), i: 0, resume: o.resume || 0 };
        if (cur.resume > 0) { var once = function () { video.removeEventListener('loadedmetadata', once); try { video.currentTime = cur.resume; } catch (e) { /* ok */ } }; video.addEventListener('loadedmetadata', once); }
        m._next();
      },
      /** Tenta o próximo motor da lista (usado ao começar e quando o atual dá erro). Devolve false se acabou. */
      _next: function () {
        if (!cur) return false;
        while (cur.i < cur.steps.length) {
          var name = cur.steps[cur.i++], ok = engines[name](cur.url);
          if (ok !== false) { cur.engine = name; return true; }
        }
        fail('unsupported'); return false;
      },
      /** Erro do elemento <video>: tenta outro motor; se não houver, avisa. */
      onVideoError: function () {
        if (!cur) return;
        var url = cur.url, resume = cur.resume, steps = cur.steps, i = cur.i, live = cur.live;
        if (i < steps.length) { var keep = { url: url, live: live, steps: steps, i: i, resume: video.currentTime || resume }; destroy(); cur = keep; m._next(); }
        else fail('media');
      },
      stop: function () { cur = null; destroy(); },
      toggle: function () { if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () { /* ok */ }); } else video.pause(); },
      seek: function (d) { if (cur && !cur.live && isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + d)); },
      get engine() { return cur && cur.engine; }
    };
    video.addEventListener('error', function () { m.onVideoError(); });
    return m;
  }
  VZ.player = { create: create, kindOf: kindOf };
  if (typeof module !== 'undefined') module.exports = VZ.player;
})(typeof self !== 'undefined' ? self : global);
