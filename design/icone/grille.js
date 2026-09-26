'use strict';
// Retrouve la grille du pixel art source (2048 x 2048) : l'energie des changements de couleur par colonne et par ligne,
// puis le pas et le decalage qui la collent le mieux.
const path = require('path');
const { lirePng } = require('../outils/png_lire');
const im = lirePng(path.join(__dirname, 'source.png'));
const W = im.w, H = im.h, P = im.pixels;
const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
const col = new Float64Array(W), lig = new Float64Array(H);
for (let y = 0; y < H; y++) for (let x = 1; x < W; x++) col[x] += diff(P[y * W + x], P[y * W + x - 1]);
for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) lig[y] += diff(P[y * W + x], P[(y - 1) * W + x]);
function meilleur(e, n) {
  let best = null;
  for (let pas = 24; pas <= 40; pas += 0.05) for (let dec = 0; dec < pas; dec += 0.5) {
    let s = 0, k = 0;
    for (let v = dec; v < n; v += pas) { const i = Math.round(v); if (i > 0 && i < n) { s += e[i]; k++; } }
    const m = s / k;
    if (!best || m > best.m) best = { pas: +pas.toFixed(2), dec, m };
  }
  return best;
}
console.log('W', W, 'H', H);
console.log('colonnes', meilleur(col, W));
console.log('lignes', meilleur(lig, H));
