'use strict';
// Le pixel art source (2048 x 2048, cases de 32 px) -> la grille propre 64 x 64 :
// la mediane du centre de chaque case (le bruit du JPG s'efface), puis les couleurs voisines regroupees en une palette,
// puis le fond (le brun tres sombre autour de la piece) rendu transparent. Ecrit maitre_64.png et maitre_64.json.
const fs = require('fs'), path = require('path');
const { lirePng } = require('../outils/png_lire');
const { ecrirePng } = require('../outils/png_simple');
const im = lirePng(path.join(__dirname, 'source.png'));
const N = 64, C = 32;

const mediane = v => { const s = v.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
const cases = [];
for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
  const r = [], g = [], b = [];
  for (let y = cy * C + 8; y < cy * C + 24; y++) for (let x = cx * C + 8; x < cx * C + 24; x++) {
    const p = im.pixels[y * im.w + x]; r.push(p[0]); g.push(p[1]); b.push(p[2]);
  }
  cases.push([mediane(r), mediane(g), mediane(b)]);
}

// regrouper les couleurs proches (le JPG donne des nuances d'une meme couleur)
const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 * .3 + (a[1] - b[1]) ** 2 * .59 + (a[2] - b[2]) ** 2 * .11);
const SEUIL = Number(process.argv[2] || 11);
const groupes = [];
for (const c of cases) {
  let g = groupes.find(x => dist(x.c, c) < SEUIL);
  if (!g) { g = { c: c.slice(), s: [0, 0, 0], n: 0 }; groupes.push(g); }
  g.s[0] += c[0]; g.s[1] += c[1]; g.s[2] += c[2]; g.n++;
}
for (const g of groupes) g.c = g.s.map(v => Math.round(v / g.n));
const idx = cases.map(c => { let bi = 0, bd = 1e9; groupes.forEach((g, i) => { const d = dist(g.c, c); if (d < bd) { bd = d; bi = i; } }); return bi; });

// le fond : la couleur des coins, mais seulement la ou elle touche le bord (remplissage en 4 directions). Le contour
// sombre autour de la tete et l'interieur des cornes ont presque la meme couleur : ils restent opaques.
const fond = idx[0];
const dehors = new Uint8Array(N * N);
const pile = [];
for (let k = 0; k < N; k++) pile.push(k, (N - 1) * N + k, k * N, k * N + N - 1);
while (pile.length) {
  const k = pile.pop();
  if (dehors[k] || idx[k] !== fond) continue;
  dehors[k] = 1;
  const x = k % N, y = Math.floor(k / N);
  if (x > 0) pile.push(k - 1); if (x < N - 1) pile.push(k + 1); if (y > 0) pile.push(k - N); if (y < N - 1) pile.push(k + N);
}
const hexa = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
const palette = groupes.map(g => hexa(g.c));
const pixels = idx.map((i, k) => dehors[k] ? [0, 0, 0, 0] : [...groupes[i].c, 255]);
ecrirePng(path.join(__dirname, 'maitre_64.png'), N, N, pixels);

// le cadre du dessin
let x0 = N, y0 = N, x1 = -1, y1 = -1;
idx.forEach((i, k) => { if (!dehors[k]) { const x = k % N, y = Math.floor(k / N); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
const lettres = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const grille = [];
for (let y = 0; y < N; y++) { let l = ''; for (let x = 0; x < N; x++) { const i = idx[y * N + x]; l += dehors[y * N + x] ? '.' : (i === fond ? '#' : lettres[i]); } grille.push(l); }
fs.writeFileSync(path.join(__dirname, 'maitre_64.json'), JSON.stringify({ palette, fond, grille, cadre: { x0, y0, x1, y1 }, note: "# = la couleur du fond, mais a l interieur (opaque)" }, null, 1));
console.log('couleurs : ' + groupes.length + ' (fond : ' + palette[fond] + ')  cadre : ' + x0 + ',' + y0 + ' a ' + x1 + ',' + y1 + ' (' + (x1 - x0 + 1) + ' x ' + (y1 - y0 + 1) + ')');
groupes.forEach((g, i) => console.log('  ' + lettres[i] + ' ' + palette[i] + ' x' + g.n));
console.log(grille.slice(y0, y1 + 1).map(l => l.slice(x0, x1 + 1)).join('\n'));
