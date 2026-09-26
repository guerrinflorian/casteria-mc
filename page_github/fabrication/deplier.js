'use strict';
// Le texte d'une release GitHub garde chaque retour a la ligne comme un vrai saut de ligne (le README, lui, non) :
// un paragraphe coupe a 120 caracteres dans le fichier s'affichait coupe au milieu sur la page. Cet outil remet chaque
// paragraphe et chaque element de liste sur UNE ligne (les blocs HTML, titres, lignes --- et lignes vides ne bougent pas).
// node page_github/fabrication/deplier.js page_github/page_installateur.md
const fs = require('fs');
const f = process.argv[2];
const lignes = fs.readFileSync(f, 'utf8').replace(/\r/g, '').split('\n');
const debutBloc = l => !l.trim() || /^\s*</.test(l) || /^#{1,6} /.test(l) || /^---+\s*$/.test(l) || /^\s*(\d+\.|-) /.test(l);
const out = [];
let dansHtml = false;
for (const l of lignes) {
  // un bloc HTML (<p ...> ... </p>) reste tel quel, jusqu'a la ligne vide
  if (/^\s*</.test(l)) dansHtml = true;
  if (!l.trim()) dansHtml = false;
  const prec = out.length ? out[out.length - 1] : '';
  const suite = !dansHtml && l.trim() && !debutBloc(l) && prec.trim() && !/^\s*</.test(prec) && !/^#{1,6} /.test(prec) && !/^---+\s*$/.test(prec);
  if (suite) out[out.length - 1] = prec.replace(/\s+$/, '') + ' ' + l.trim();
  else out.push(l);
}
fs.writeFileSync(f, out.join('\n'));
console.log(f + ' : ' + lignes.length + ' lignes -> ' + out.length);
