'use strict';
// Photographie les Reglages dans l'etat « majuscules » (le texte rouge d'app.js, le bouton « Changer quand meme »),
// sur une copie temporaire de index.html (retiree apres la photo), avec la scene #reglages de maquette.js.
// Le champ montre ce que le joueur vient de TAPER (_FloSkyl_) ; le pseudo deja connu, le dernier vraiment entre sur le
// serveur, est _Floskyl_. La phrase nomme d'abord ce qui est tape, puis le pseudo connu. Dans la copie, le champ change
// d'id : app.js ne le remplit plus avec le pseudo enregistre.
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const FEN = path.join(__dirname, '..', '..', 'electron', 'fenetre');
const TAPE = '_FloSkyl_', CONNU = '_Floskyl_';
let html = fs.readFileSync(path.join(FEN, 'index.html'), 'utf8');
html = html.replace(/<p class="aide" id="pseudo-aide">[^<]*<\/p>/,
  '<p class="aide" id="pseudo-aide-essai" data-faux="oui">' + TAPE + ' n\'est pas ' + CONNU + ' : c\'est un autre joueur, sans ton île.</p>')
  .replace('<input id="pseudo" ', '<input id="pseudo-essai" value="' + TAPE + '" ')
  .replace('data-action="confirmer-pseudo" hidden>', 'data-action="confirmer-pseudo">');
// sans animations ni transitions : la photo ne tombe jamais pendant l'apparition de l'ecran (la CSP refuse le style en
// ligne, d'ou une petite feuille a part)
const essaiCss = path.join(FEN, '_essai_pseudo.css');
fs.writeFileSync(essaiCss, '*, *::before, *::after { animation: none !important; transition: none !important; }\n');
html = html.replace('<link rel="stylesheet" href="theme/theme.css">', '<link rel="stylesheet" href="theme/theme.css">\n  <link rel="stylesheet" href="_essai_pseudo.css">');
const essai = path.join(FEN, '_essai_pseudo.html');
fs.writeFileSync(essai, html);
const sortie = path.join(__dirname, '..', 'photos', 'launcher_reglages_majuscules.png');
try {
  execFileSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--user-data-dir=' + path.join(os.tmpdir(), 'casteria_edge_ae'), '--window-size=1100,700',
    '--virtual-time-budget=9000', '--screenshot=' + sortie, 'file:///' + essai.split(path.sep).join('/') + '#reglages'], { stdio: 'pipe', timeout: 60000 });
} catch (e) { /* Edge ecrit sur stderr meme quand tout va bien */ }
fs.unlinkSync(essai);
fs.unlinkSync(essaiCss);
console.log(fs.existsSync(sortie) ? sortie : 'ECHEC : pas de photo');
