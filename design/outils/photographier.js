'use strict';
// Photographie une maquette a 1100 x 700 avec Edge sans fenetre (le moteur d'Electron : Chromium).
// node outils/photographier.js <a|b> [scene] [sortie.png]
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs');
const [prop, scene, sortie] = process.argv.slice(2);
const page = 'file:///' + path.join(__dirname, '..', prop, 'index.html').replace(/\\/g, '/') + (scene ? '#' + scene : '');
const fichier = sortie || path.join(__dirname, '..', 'photos', 'proposition_' + prop + (scene ? '_' + scene : '') + '.png');
fs.mkdirSync(path.dirname(fichier), { recursive: true });
try {
  execFileSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'casteria_edge_ae'), '--window-size=1100,700', '--virtual-time-budget=3000',
    '--screenshot=' + fichier, page
  ], { stdio: 'pipe', timeout: 60000 });
} catch (e) { /* Edge ecrit sur stderr meme quand tout va bien */ }
console.log(fs.existsSync(fichier) ? fichier : 'ECHEC : pas de photo');
