'use strict';
// node design/outils/reduire_image.js <entree.png> <sortie.png> <largeur> : une image reduite (moyenne des pixels),
// pour regarder ou comparer de grandes prises de vue sans les ouvrir en entier.
const fs = require('fs'), zlib = require('zlib');
const { ecrirePng } = require('./png_simple');

// lire un PNG 8 bits RGB ou RGBA, non entrelace (les prises de vue du jeu)
function lirePng(fichier) {
  const b = fs.readFileSync(fichier);
  let o = 8, w = 0, h = 0, type = 6;
  const d = [];
  while (o < b.length) {
    const l = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8), c = b.slice(o + 8, o + 8 + l);
    if (t === 'IHDR') { w = c.readUInt32BE(0); h = c.readUInt32BE(4); type = c[9]; }
    if (t === 'IDAT') d.push(c);
    o += 12 + l;
  }
  const n = type === 6 ? 4 : 3, r = zlib.inflateSync(Buffer.concat(d)), ligne = w * n;
  const px = Buffer.alloc(w * h * 4);
  let prec = Buffer.alloc(ligne);
  for (let y = 0; y < h; y++) {
    const f = r[y * (ligne + 1)], cur = Buffer.from(r.slice(y * (ligne + 1) + 1, (y + 1) * (ligne + 1)));
    for (let i = 0; i < ligne; i++) {
      const a = i >= n ? cur[i - n] : 0, bb = prec[i], c = i >= n ? prec[i - n] : 0;
      let v = cur[i];
      if (f === 1) v += a; else if (f === 2) v += bb; else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) { const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : (pb <= pc ? bb : c); }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { for (let k = 0; k < 3; k++) px[(y * w + x) * 4 + k] = cur[x * n + k]; px[(y * w + x) * 4 + 3] = n === 4 ? cur[x * n + 3] : 255; }
    prec = cur;
  }
  return { w, h, px };
}
const [entree, sortie, largeur] = process.argv.slice(2);
const im = lirePng(entree), W = Number(largeur), k = im.w / W, H = Math.round(im.h / k), out = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const s = [0, 0, 0]; let n = 0;
  for (let j = Math.floor(y * k); j < Math.floor((y + 1) * k); j++) for (let i = Math.floor(x * k); i < Math.floor((x + 1) * k); i++) { const p = (j * im.w + i) * 4; s[0] += im.px[p]; s[1] += im.px[p + 1]; s[2] += im.px[p + 2]; n++; }
  out.push([Math.round(s[0] / n), Math.round(s[1] / n), Math.round(s[2] / n), 255]);
}
ecrirePng(sortie, W, H, out);
console.log(sortie + ' (' + W + 'x' + H + ')');
