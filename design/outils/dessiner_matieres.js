'use strict';
// Nos propres matieres en pixel art, dessinees ici (aucun fichier de Mojang) : les planches de la pancarte, le rondin des
// batons du parchemin, et 9 tetes de joueurs. Dans le meme esprit que le jeu, mais a nous : un launcher publie ne doit
// livrer aucune texture de Minecraft.
// node design/outils/dessiner_matieres.js   ->  design\commun\dessins\ (planches.png, rondin.png, tetes\tete_0..8.png)
const fs = require('fs'), path = require('path');
const { ecrirePng } = require('./png_simple');
const SORTIE = path.join(__dirname, '..', 'commun', 'dessins');
fs.mkdirSync(path.join(SORTIE, 'tetes'), { recursive: true });

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const teinte = (c, k) => [Math.round(Math.min(255, c[0] * k)), Math.round(Math.min(255, c[1] * k)), Math.round(Math.min(255, c[2] * k)), 255];
// un hasard qui donne toujours le meme dessin
function hasard(graine) { let s = graine >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---------- les planches (16 x 16) : 4 planches de 4 pixels, joints decales, fil du bois, deux clous ----------
{
  const r = hasard(7);
  const bases = [hex('#7c5431'), hex('#74502e'), hex('#7f5733'), hex('#6f4b2b')];
  const joints = [5, 12, 2, 9];
  const px = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const p = Math.floor(y / 4), dans = y % 4;
    let c = bases[p];
    if (dans === 0) c = teinte(c, 1.16);             // le haut de la planche prend la lumiere
    if (dans === 3) c = teinte(c, .62);              // le joint entre deux planches
    const f = r();
    if (dans > 0 && dans < 3 && f < .16) c = teinte(c, .86);   // le fil du bois
    if (dans > 0 && dans < 3 && f > .95) c = teinte(c, 1.08);
    if (x === joints[p] && dans < 3) c = teinte(bases[p], .58);  // le bout de la planche
    if (x === (joints[p] + 1) % 16 && dans < 3) c = teinte(bases[p], 1.12);
    px.push(c);
  }
  // deux clous
  for (const [x, y] of [[1, 1], [14, 9]]) { px[y * 16 + x] = hex('#3a2a1f'); px[y * 16 + x + 1] = hex('#8c7a64'); }
  ecrirePng(path.join(SORTIE, 'planches.png'), 16, 16, px);
}

// ---------- le rondin (16 x 16, se repete en largeur) : du bois ecorce, veines dans la longueur ----------
{
  const r = hasard(21);
  const rangs = ['#5b3a24', '#4e311d', '#5f3e27', '#533520', '#482d1a', '#5a3923', '#4c301c', '#62412a', '#553621', '#4a2f1b', '#5d3c25', '#50331f', '#463019', '#58381f', '#4f321e', '#442a17'].map(hex);
  const px = [];
  for (let y = 0; y < 16; y++) {
    const debut = Math.floor(r() * 16), long = 3 + Math.floor(r() * 5), clair = r() < .5;
    for (let x = 0; x < 16; x++) {
      let c = rangs[y];
      if (((x - debut + 16) % 16) < long) c = teinte(c, clair ? 1.14 : .8);
      px.push(c);
    }
  }
  ecrirePng(path.join(SORTIE, 'rondin.png'), 16, 16, px);
}

// ---------- 9 tetes (8 x 8) : peau, cheveux, coiffure, yeux, et un detail ----------
const PEAUX = ['#f1c6a1', '#e3ab7f', '#c98e5e', '#a06a45', '#704832'].map(hex);
const TETES = [
  { peau: 0, cheveux: '#5a3a22', coiffure: 'court', yeux: '#3a6fd0' },
  { peau: 1, cheveux: '#c98a3a', coiffure: 'long', yeux: '#3f8f4f' },
  { peau: 3, cheveux: '#1f1a17', coiffure: 'court', yeux: '#5a3a1e' },
  { peau: 0, cheveux: '#e2c16a', coiffure: 'frange', yeux: '#3a6fd0' },
  { peau: 2, cheveux: '#2b1d14', coiffure: 'long', yeux: '#5a3a1e' },
  { peau: 4, cheveux: '#1a1411', coiffure: 'casquette', yeux: '#5a3a1e', casquette: '#b5352b' },
  { peau: 1, cheveux: '#8a3b1c', coiffure: 'frange', yeux: '#3f8f4f', taches: true },
  { peau: 2, cheveux: '#3b2616', coiffure: 'casquette', yeux: '#6a4fa0', casquette: '#3f7fb6' },
  { peau: 3, cheveux: '#d9d2c3', coiffure: 'court', yeux: '#3a6fd0', barbe: true }
];
TETES.forEach((t, n) => {
  const peau = PEAUX[t.peau], cheveux = hex(t.cheveux), px = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px.push(y === 7 ? teinte(peau, .9) : peau);
  const mettre = (x, y, c) => { px[y * 8 + x] = c; };
  // les cheveux
  for (let x = 0; x < 8; x++) { mettre(x, 0, cheveux); mettre(x, 1, x % 3 === 1 ? teinte(cheveux, 1.15) : cheveux); }
  if (t.coiffure === 'court') { mettre(0, 2, cheveux); mettre(7, 2, cheveux); }
  if (t.coiffure === 'frange') { for (const x of [0, 1, 2, 7]) mettre(x, 2, cheveux); mettre(0, 3, cheveux); }
  if (t.coiffure === 'long') { for (let y = 2; y < 8; y++) { mettre(0, y, cheveux); mettre(7, y, y > 5 ? teinte(cheveux, .85) : cheveux); } mettre(1, 2, cheveux); mettre(6, 2, cheveux); }
  if (t.coiffure === 'casquette') {
    const k = hex(t.casquette);
    for (let x = 0; x < 8; x++) { mettre(x, 0, k); mettre(x, 1, x === 3 ? teinte(k, 1.3) : k); }
    for (let x = 0; x < 5; x++) mettre(x, 2, teinte(k, .7));   // la visiere
    mettre(7, 2, cheveux);
  }
  // les yeux : le blanc a l'exterieur, la couleur a l'interieur (comme le regard du jeu, mais nos couleurs)
  const blanc = hex('#f4f1ea'), oeil = hex(t.yeux);
  mettre(1, 4, blanc); mettre(2, 4, oeil); mettre(5, 4, oeil); mettre(6, 4, blanc);
  // les sourcils, le nez, la bouche
  mettre(2, 3, teinte(cheveux, .9)); mettre(5, 3, teinte(cheveux, .9));
  mettre(3, 5, teinte(peau, .88)); mettre(4, 5, teinte(peau, .88));
  for (let x = 3; x < 5; x++) mettre(x, 6, hex('#8e4b3c'));
  if (t.taches) { mettre(1, 5, teinte(peau, .8)); mettre(6, 5, teinte(peau, .8)); }
  if (t.barbe) { for (let x = 1; x < 7; x++) mettre(x, 7, cheveux); mettre(2, 6, cheveux); mettre(5, 6, cheveux); mettre(1, 6, cheveux); mettre(6, 6, cheveux); }
  ecrirePng(path.join(SORTIE, 'tetes', 'tete_' + n + '.png'), 8, 8, px);
});
console.log('dessins ecrits dans ' + SORTIE);
