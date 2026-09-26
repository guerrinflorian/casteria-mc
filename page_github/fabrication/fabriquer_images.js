'use strict';
// Fabrique les images de la page GitHub (page_github\images\) : chaque bloc de images.html, photographie par Edge sans
// fenetre, sur fond transparent, puis rogne au bloc et reenregistre en PNG compresse.
// node page_github/fabrication/fabriquer_images.js
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const { lirePng } = require('../../design/outils/png_lire');
const { ecrirePng } = require('../../design/outils/png_simple');
const PAGE = 'file:///' + path.join(__dirname, 'images.html').split(path.sep).join('/');
const SORTIE = path.join(__dirname, '..', 'images');
fs.mkdirSync(SORTIE, { recursive: true });

// [bloc, fenetre (largeur, hauteur), echelle, fichier, largeur finale]
const IMAGES = [
  ['banniere', 1280, 520, 1, 'banniere.png', 1280],
  ['launcher', 1180, 840, 1, 'launcher.png', 1180],
  ['boss', 960, 400, 1, 'boss.png', 960],
  ['bouton-windows', 352, 108, 2, 'bouton_windows.png'],
  ['bouton-mac', 352, 108, 2, 'bouton_mac.png'],
  ['bouton-linux', 352, 108, 2, 'bouton_linux.png'],
  ['sceau-1', 84, 84, 2, 'etape_1.png'],
  ['sceau-2', 84, 84, 2, 'etape_2.png'],
  ['sceau-3', 84, 84, 2, 'etape_3.png']
];
const tmp = path.join(os.tmpdir(), 'casteria_page_github');
fs.mkdirSync(tmp, { recursive: true });
for (const [bloc, w, h, k, fichier] of IMAGES) {
  const brut = path.join(tmp, bloc + '.png');
  try { fs.unlinkSync(brut); } catch (e) { /* rien */ }
  try {
    execFileSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--force-device-scale-factor=' + k, '--default-background-color=00000000', '--allow-file-access-from-files',
      '--user-data-dir=' + path.join(os.tmpdir(), 'casteria_edge_ae'), '--window-size=' + w + ',' + h, '--virtual-time-budget=4000',
      '--screenshot=' + brut, PAGE + '#' + bloc], { stdio: 'pipe', timeout: 60000 });
  } catch (e) { /* Edge ecrit sur stderr meme quand tout va bien */ }
  if (!fs.existsSync(brut)) { console.log('ECHEC ' + bloc); continue; }
  // rogner au dessin (les pixels non transparents), avec une marge de 2 px
  const im = lirePng(brut);
  let x0 = im.w, y0 = im.h, x1 = -1, y1 = -1;
  im.pixels.forEach((p, i) => { if (p[3] > 0) { const x = i % im.w, y = Math.floor(i / im.w); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } });
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(im.w - 1, x1 + 2); y1 = Math.min(im.h - 1, y1 + 2);
  const W = x1 - x0 + 1, H = y1 - y0 + 1, px = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px.push(im.pixels[y * im.w + x]);
  ecrirePng(path.join(SORTIE, fichier), W, H, px);
  console.log(fichier + ' : ' + W + ' x ' + H + ', ' + Math.round(fs.statSync(path.join(SORTIE, fichier)).size / 1024) + ' Ko');
}
