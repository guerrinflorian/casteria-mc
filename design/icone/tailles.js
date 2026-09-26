'use strict';
// Les icones du launcher a chaque taille de Windows, NETTES : chaque taille est une grille entiere, agrandie d'un
// facteur entier (jamais de pixels de largeurs differentes, jamais de lissage).
//  - le dessin de reference : la grille 64 x 64 du pixel art de Florian (extraire.js), soit 52 x 54 cases de dessin ;
//  - les grilles plus petites sont des REDUCTIONS par vote : chaque case prend la couleur qui couvre le plus sa surface,
//    avec un poids plus fort pour ce qui doit survivre (les yeux, la gemme, les crocs, les contours) ;
//  - les tres petites (14 pour le 16) sont retouchees a la main dans retouches.js.
// node design/icone/tailles.js  ->  design/icone/final/icone_N.png, et la planche de controle.
const fs = require('fs'), path = require('path');
const { ecrirePng } = require('../outils/png_simple');
const M = JSON.parse(fs.readFileSync(path.join(__dirname, 'maitre_64.json'), 'utf8'));
const RETOUCHES = fs.existsSync(path.join(__dirname, 'retouches.js')) ? require('./retouches.js') : {};
const { x0, y0, x1, y1 } = M.cadre;
const SW = x1 - x0 + 1, SH = y1 - y0 + 1;
const lettres = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const src = [];
for (let y = y0; y <= y1; y++) src.push(M.grille[y].slice(x0, x1 + 1));

// le poids de chaque couleur dans le vote (par sa lettre ; # = le brun du fond, a l'interieur)
const POIDS = {
  '.': 1,                                     // le vide autour : garde la silhouette
  b: 1.5, '#': 0.8, i: 0.9,                  // les cornes (noir, brun, violet noir)
  c: 1.4, d: 1.5,                             // le contour et le liseré rouge de la piece
  e: 1, f: 1, g: 1.1, h: 1,                   // l'or
  m: 1.35, r: 1.4, q: 1.15, k: 1.2,           // les contours violets de la tete
  l: 1, j: 1,                                 // le violet
  t: 5, s: 2.2, u: 3,                         // les yeux, les crocs
  n: 3, o: 2.2, p: 2.6                        // la gemme
};
function reduire(W, H) {
  const g = [];
  for (let ty = 0; ty < H; ty++) {
    let ligne = '';
    for (let tx = 0; tx < W; tx++) {
      const ax = tx * SW / W, bx = (tx + 1) * SW / W, ay = ty * SH / H, by = (ty + 1) * SH / H;
      const score = {};
      for (let sy = Math.floor(ay); sy < Math.ceil(by); sy++) for (let sx = Math.floor(ax); sx < Math.ceil(bx); sx++) {
        const surf = (Math.min(bx, sx + 1) - Math.max(ax, sx)) * (Math.min(by, sy + 1) - Math.max(ay, sy));
        if (surf <= 0) continue;
        const s = src[sy][sx];
        score[s] = (score[s] || 0) + surf * (POIDS[s] || 1);
      }
      let best = '.', bs = -1;
      for (const s in score) if (score[s] > bs) { bs = score[s]; best = s; }
      ligne += best;
    }
    g.push(ligne);
  }
  return g;
}
const couleur = s => {
  if (s === '.') return [0, 0, 0, 0];
  const h = s === '#' ? M.palette[M.fond] : M.palette[lettres.indexOf(s)];
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
};
// une grille dans une image N x N, agrandie d'un facteur entier, centree
function composer(N, g, k) {
  const gw = g[0].length, gh = g.length, ox = Math.floor((N - gw * k) / 2), oy = Math.floor((N - gh * k) / 2);
  if (ox < 0 || oy < 0) throw new Error('trop grand pour ' + N + ' : ' + gw + 'x' + gh + ' x' + k);
  const px = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gx = Math.floor((x - ox) / k), gy = Math.floor((y - oy) / k);
    px.push(gx >= 0 && gy >= 0 && gx < gw && gy < gh && x >= ox && y >= oy ? couleur(g[gy][gx]) : [0, 0, 0, 0]);
  }
  return px;
}
const grilleDe = w => {
  if (w === SW) return src;
  const cle = 'g' + w;
  if (RETOUCHES[cle]) return RETOUCHES[cle];
  return reduire(w, Math.round(w * SH / SW));
};

// la taille de l'image -> [largeur de la grille, facteur] (le dessin occupe environ 80 a 90 % de l'image)
const PLAN = { 256: [52, 4], 128: [52, 2], 96: [40, 2], 80: [34, 2], 72: [30, 2], 64: [52, 1], 60: [52, 1], 48: [40, 1], 40: [34, 1], 32: [26, 1], 24: [20, 1], 20: [20, 1], 16: [16, 1] };
const FINAL = path.join(__dirname, 'final');
fs.mkdirSync(FINAL, { recursive: true });
const images = {};
for (const N of Object.keys(PLAN).map(Number).sort((a, b) => b - a)) {
  const [w, k] = PLAN[N];
  const g = grilleDe(w);
  images[N] = composer(N, g, k);
  ecrirePng(path.join(FINAL, 'icone_' + N + '.png'), N, N, images[N]);
  console.log('icone_' + N + '.png : grille ' + g[0].length + ' x ' + g.length + ', x' + k);
}
// les grilles reduites en texte (pour les retoucher a la main)
const textes = {};
for (const w of [40, 34, 30, 26, 20, 17, 14]) textes['g' + w] = grilleDe(w);
fs.writeFileSync(path.join(__dirname, 'grilles_reduites.json'), JSON.stringify(textes, null, 1));

// la planche de controle : chaque taille a sa vraie taille, puis agrandie x4 (les petites), sur fond clair et sombre
{
  const tailles = Object.keys(PLAN).map(Number).sort((a, b) => a - b);
  const M1 = 12, zoom = N => (N <= 48 ? 4 : (N <= 96 ? 2 : 1));
  const largeur = tailles.reduce((s, N) => s + N * zoom(N) + M1, M1);
  const hBande = M1 + 256 + M1 + 256 + M1;
  const W = Math.max(largeur, tailles.reduce((s, N) => s + N + M1, M1)), H = hBande * 2;
  const px = new Array(W * H).fill(null).map((_, i) => Math.floor(i / W) < hBande ? [243, 241, 236, 255] : [32, 30, 30, 255]);
  const poser = (img, N, k, ox, oy) => {
    for (let y = 0; y < N * k; y++) for (let x = 0; x < N * k; x++) {
      const c = img[Math.floor(y / k) * N + Math.floor(x / k)];
      if (!c[3]) continue;
      const i = (oy + y) * W + ox + x, f = px[i], a = c[3] / 255;
      px[i] = [0, 1, 2].map(j => Math.round(c[j] * a + f[j] * (1 - a))).concat(255);
    }
  };
  for (const [bande, oyb] of [[0, 0], [1, hBande]]) {
    let x = M1;
    for (const N of tailles) { poser(images[N], N, 1, x, oyb + M1 + 256 - N); x += N + M1; }   // la vraie taille
    x = M1;
    for (const N of tailles) { const k = zoom(N); poser(images[N], N, k, x, oyb + M1 + 256 + M1 + 256 - N * k); x += N * k + M1; }
  }
  ecrirePng(path.join(FINAL, 'planche_controle.png'), W, H, px);
  console.log('planche_controle.png : ' + W + ' x ' + H);
}
