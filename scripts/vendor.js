'use strict';
// Copia os players (hls.js, mpegts.js) e o gerador de QR de node_modules para src/vendor. Roda no `npm install`.
const fs = require('node:fs'), path = require('node:path');
const out = path.join(__dirname, '../src/vendor');
fs.mkdirSync(out, { recursive: true });
const files = [['hls.js/dist/hls.min.js', 'hls.min.js'], ['mpegts.js/dist/mpegts.js', 'mpegts.js'], ['qrcode-generator/qrcode.js', 'qrcode.js']];
let missing = 0;
for (const [from, to] of files) {
  const src = path.join(__dirname, '../node_modules', from);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, to)); else { missing++; console.warn('[vendor] não encontrado:', from, '(rode npm install)'); }
}
if (!missing) console.log('[vendor] bibliotecas copiadas.');
