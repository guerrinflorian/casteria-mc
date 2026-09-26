'use strict';
// Des boss de Casteria en portrait de groupe, dessines par nos propres modeles (ServeurMC\outils\boss_modeles\, lus
// seulement) et notre moteur de rendu, sans arene : une image qui n'est qu'a nous. Fond transparent (rendu sur noir
// puis sur blanc), pour la poser ensuite sur un ciel (images.html, bloc #boss).
// ATTENTION : ne jamais charger outils\boss_modeles.js lui-meme : lance sans argument, il reecrit les sources Java et
// les textures de casinoboss. On charge seulement les fichiers de modeles, commun.js et rendu.js.
// node page_github/fabrication/boss_groupe.js  ->  page_github/fabrication/boss_groupe.png
const fs = require('fs'), path = require('path');
const { ecrirePng } = require('../../design/outils/png_simple');
const BM = 'C:/Users/guerr/OneDrive/Bureau/DEV/PERSO/ServeurMC/outils/boss_modeles';
const C = require(BM + '/commun');
const R = require(BM + '/rendu');

// [fichier, nom du modele, x, z, tourne (degres)] : le Dragon Ancien (celui du logo) au fond, les autres devant
const GROUPE = [
  ['dragon_ancien.js', 'dragon_ancien', 0.4, -8, 32],
  ['yeti_glaces.js', 'yeti_glaces', -7.4, -1.2, 30],
  ['oni_samourai.js', 'oni_samourai', -3.8, 0.8, 16],
  ['djinn_sables.js', 'djinn_sables', 3.8, 0.8, -16],
  ['kraken_abysses.js', 'kraken_abysses', 7.6, -1.2, -28]
];
const scene = [];
for (const [f, nom, x, z, yaw] of GROUPE) {
  const liste = require(path.join(BM, f));
  const m = (Array.isArray(liste) ? liste : [liste]).find(k => k.nom === nom);
  if (!m) throw new Error('modele introuvable : ' + nom);
  C.rangerUV(m);
  const tex = C.texturesDe(m);
  scene.push({ modele: m, textures: tex, pose: C.poseAnim((m.anims || {}).repos, 0.3), position: [x, 0, z], yaw, echelle: m.echelle || 1, couches: Object.keys(m.couches || {}) });
}
const W = 1600, H = 700;
const cad = f => ({ yaw: 0, pitch: 6, distance: 18.5, cible: [0, 3.2, -1.5], fov: 40, sol: false, fond: [f, f] });
const noir = R.rendreVue(scene, cad([0, 0, 0]), W, H, 2);
const blanc = R.rendreVue(scene, cad([255, 255, 255]), W, H, 2);
const px = noir.map((n, i) => {
  const b = blanc[i], a = Math.max(0, Math.min(1, 1 - ((b[0] - n[0]) + (b[1] - n[1]) + (b[2] - n[2])) / 765));
  return a < 0.02 ? [0, 0, 0, 0] : [Math.min(255, Math.round(n[0] / a)), Math.min(255, Math.round(n[1] / a)), Math.min(255, Math.round(n[2] / a)), Math.round(a * 255)];
});
ecrirePng(path.join(__dirname, 'boss_groupe.png'), W, H, px);
console.log('boss_groupe.png : ' + W + ' x ' + H);
