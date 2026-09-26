'use strict';
// node design/icone/zoom.js <sortie.png> <taille> [taille...] : les icones finales agrandies (x16 pour 16, etc.), cote a
// cote sur un damier, a la meme hauteur d'affichage, pour les retoucher a la main.
const path = require('path');
const { lirePng } = require('../outils/png_lire');
const { ecrirePng } = require('../outils/png_simple');
const [sortie, ...tailles] = process.argv.slice(2);
const HAUT = 320, M = 16;
const imgs = tailles.map(n => ({ n: Number(n), i: lirePng(path.join(__dirname, 'final', 'icone_' + n + '.png')) }));
const W = imgs.reduce((s, x) => s + Math.floor(HAUT / x.n) * x.n + M, M), H = HAUT + 2 * M;
const px = new Array(W * H).fill(null).map(() => [60, 60, 66, 255]);
let ox = M;
for (const { n, i } of imgs) {
  const k = Math.floor(HAUT / n);
  for (let y = 0; y < n * k; y++) for (let x = 0; x < n * k; x++) {
    const c = i.pixels[Math.floor(y / k) * n + Math.floor(x / k)];
    const damier = ((Math.floor(x / k) + Math.floor(y / k)) % 2) ? [205, 205, 205, 255] : [232, 232, 232, 255];
    px[(M + y) * W + ox + x] = c[3] ? c : damier;
  }
  ox += n * k + M;
}
ecrirePng(sortie, W, H, px);
