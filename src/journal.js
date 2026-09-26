'use strict';
// Le journal du launcher : un fichier par lancement dans <racine>/journaux, les 10 derniers gardés.
const fs = require('fs');
const path = require('path');

const GARDES = 10;

function creerJournal(dossier) {
  fs.mkdirSync(dossier, { recursive: true });
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fichier = path.join(dossier, 'launcher-' + horodatage + '.log');
  const flux = fs.createWriteStream(fichier, { flags: 'a' });

  // Les anciens journaux au-delà des 10 derniers sont retirés (ils sont à nous : launcher-*.log).
  const anciens = fs.readdirSync(dossier).filter(n => /^launcher-.*\.log$/.test(n)).sort();
  for (const n of anciens.slice(0, Math.max(0, anciens.length - GARDES))) {
    try { fs.unlinkSync(path.join(dossier, n)); } catch (e) { /* un journal ouvert ailleurs reste */ }
  }
  // Les rapports de plantage recopiés (partie.js) : les 5 derniers.
  const plantages = fs.readdirSync(dossier).filter(n => /^plantage-.*\.txt$/.test(n)).sort();
  for (const n of plantages.slice(0, Math.max(0, plantages.length - 5))) {
    try { fs.unlinkSync(path.join(dossier, n)); } catch (e) { /* rien */ }
  }

  function ecrire(niveau, texte) {
    flux.write(new Date().toISOString() + ' [' + niveau + '] ' + texte + '\n');
  }
  return {
    fichier,
    info: t => ecrire('INFO', t),
    avert: t => ecrire('AVERT', t),
    erreur: t => ecrire('ERREUR', t),
    fermer: () => new Promise(fin => flux.end(fin)),
  };
}

module.exports = { creerJournal };
