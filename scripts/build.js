'use strict';
// Monta dist/app (a pasta que o ares-package empacota): código + config + appinfo + ícones.
// Configuração: vionza.config.json (ou variáveis de ambiente VZ_LICENSE_URL, VZ_PAIR_URL, VZ_LICENSE_PUBLIC_KEY).
const fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..'), dist = path.join(root, 'dist', 'app');
const cfgFile = path.join(root, 'vionza.config.json');
const file = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cfg = {
  LICENSE_URL: (process.env.VZ_LICENSE_URL || file.LICENSE_URL || '').trim(),
  PAIR_URL: (process.env.VZ_PAIR_URL || file.PAIR_URL || '').trim(),
  LICENSE_PUBLIC_KEY: (process.env.VZ_LICENSE_PUBLIC_KEY || file.LICENSE_PUBLIC_KEY || '').trim(),
};
const version = pkg.version;
const code = version.split('.').reduce((a, n) => a * 100 + Number(n), 0);
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src'), dist, { recursive: true });
fs.rmSync(path.join(dist, 'vendor', '.gitkeep'), { force: true });
fs.writeFileSync(path.join(dist, 'config.js'), 'window.VZ_CONFIG = ' + JSON.stringify({ ...cfg, VERSION: version, VERSION_CODE: code }) + ';\n');
const info = JSON.parse(fs.readFileSync(path.join(root, 'webos', 'appinfo.json'), 'utf8')); info.version = version;
fs.writeFileSync(path.join(dist, 'appinfo.json'), JSON.stringify(info, null, 2));
for (const f of ['icon.png', 'largeIcon.png']) fs.copyFileSync(path.join(root, 'webos', f), path.join(dist, f));
const warn = [];
for (const v of ['hls.min.js', 'mpegts.js', 'qrcode.js']) if (!fs.existsSync(path.join(dist, 'vendor', v))) warn.push(v);
if (warn.length) console.warn('[build] FALTAM bibliotecas em src/vendor:', warn.join(', '), '— rode `npm install` antes (o player de HLS/TS depende delas).');
if (cfg.LICENSE_URL && !cfg.LICENSE_PUBLIC_KEY) console.warn('[build] LICENSE_URL preenchida mas LICENSE_PUBLIC_KEY vazia: a trava de licença fica DESLIGADA.');
if (!cfg.PAIR_URL) console.warn('[build] PAIR_URL vazia: a vinculação por ID e chave não vai funcionar.');
console.log('[build] pronto: dist/app (versão ' + version + ', licença ' + (cfg.LICENSE_URL && cfg.LICENSE_PUBLIC_KEY ? 'ligada' : 'desligada') + ')');
