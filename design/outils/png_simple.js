'use strict';
// Ecrire une image PNG (RGBA 8 bits) sans rien installer : pixels = tableau de [r, g, b, a], ligne par ligne.
const fs = require('fs'), zlib = require('zlib');

const TABLE = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function morceau(type, donnees) {
  const t = Buffer.from(type, 'ascii'), l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(donnees.length);
  c.writeUInt32BE(crc32(Buffer.concat([t, donnees])));
  return Buffer.concat([l, t, donnees, c]);
}
function ecrirePng(fichier, w, h, pixels) {
  const brut = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    brut[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const p = pixels[y * w + x], o = y * (w * 4 + 1) + 1 + x * 4;
      brut[o] = p[0]; brut[o + 1] = p[1]; brut[o + 2] = p[2]; brut[o + 3] = p[3] === undefined ? 255 : p[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(fichier, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), morceau('IHDR', ihdr),
    morceau('IDAT', zlib.deflateSync(brut, { level: 9 })), morceau('IEND', Buffer.alloc(0))]));
}
module.exports = { ecrirePng };
