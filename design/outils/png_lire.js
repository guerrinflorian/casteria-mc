'use strict';
// Lire une image PNG sans rien installer : { w, h, pixels: [[r, g, b, a], ...] }. 8 bits par canal (gris, RGB, RGBA,
// gris + alpha) et palettes de 1, 2, 4 ou 8 bits (avec tRNS), non entrelace : les images du jeu et des outils.
const fs = require('fs'), zlib = require('zlib');

function lirePng(fichier) {
  const b = fs.readFileSync(fichier);
  let o = 8, w = 0, h = 0, prof = 8, type = 6, palette = null, trns = null;
  const d = [];
  while (o < b.length) {
    const l = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8), c = b.slice(o + 8, o + 8 + l);
    if (t === 'IHDR') { w = c.readUInt32BE(0); h = c.readUInt32BE(4); prof = c[8]; type = c[9]; if (c[12]) throw new Error('PNG entrelace non lu : ' + fichier); }
    if (t === 'PLTE') palette = c;
    if (t === 'tRNS') trns = c;
    if (t === 'IDAT') d.push(c);
    o += 12 + l;
  }
  const canaux = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const bpp = Math.max(1, Math.ceil(canaux * prof / 8)), ligne = Math.ceil(w * canaux * prof / 8);
  const r = zlib.inflateSync(Buffer.concat(d));
  let prec = Buffer.alloc(ligne);
  const pixels = [];
  for (let y = 0; y < h; y++) {
    const f = r[y * (ligne + 1)], cur = Buffer.from(r.slice(y * (ligne + 1) + 1, (y + 1) * (ligne + 1)));
    for (let i = 0; i < ligne; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, bb = prec[i], c = i >= bpp ? prec[i - bpp] : 0;
      let v = cur[i];
      if (f === 1) v += a; else if (f === 2) v += bb; else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) { const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : (pb <= pc ? bb : c); }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      if (type === 3) {
        const parOctet = 8 / prof, octet = cur[Math.floor(x / parOctet)], dec = (parOctet - 1 - (x % parOctet)) * prof;
        const k = prof === 8 ? cur[x] : (octet >> dec) & ((1 << prof) - 1);
        pixels.push([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255]);
      } else if (type === 6) pixels.push([cur[x * 4], cur[x * 4 + 1], cur[x * 4 + 2], cur[x * 4 + 3]]);
      else if (type === 2) pixels.push([cur[x * 3], cur[x * 3 + 1], cur[x * 3 + 2], 255]);
      else if (type === 4) pixels.push([cur[x * 2], cur[x * 2], cur[x * 2], cur[x * 2 + 1]]);
      else pixels.push([cur[x], cur[x], cur[x], 255]);
    }
    prec = cur;
  }
  return { w, h, pixels };
}
module.exports = { lirePng };
