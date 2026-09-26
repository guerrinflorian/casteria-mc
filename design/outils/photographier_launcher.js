'use strict';
// Photographie la VRAIE page du launcher (fenetre\index.html, avec maquette.js) a 1100 x 700, par Edge sans fenetre.
// node outils/photographier_launcher.js <scene> [sortie.png]
const { execFileSync } = require('child_process');
const path = require('path'), fs = require('fs');
const [scene, sortie] = process.argv.slice(2);
const page = 'file:///' + path.join(__dirname, '..', '..', 'electron', 'fenetre', 'index.html').split(path.sep).join('/') + '#' + (scene || 'accueil');
const fichier = sortie || path.join(__dirname, '..', 'photos', 'launcher_' + (scene || 'accueil') + '.png');
fs.mkdirSync(path.dirname(fichier), { recursive: true });
try {
  execFileSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--user-data-dir=' + path.join(require('os').tmpdir(), 'casteria_edge_ae'), '--window-size=1100,700', '--virtual-time-budget=9000',
    '--screenshot=' + fichier, page
  ], { stdio: 'pipe', timeout: 60000 });
} catch (e) { /* Edge ecrit sur stderr meme quand tout va bien */ }
console.log(fs.existsSync(fichier) ? fichier : 'ECHEC : pas de photo');
