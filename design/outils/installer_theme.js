'use strict';
// Copie dans le theme du launcher (electron\fenetre\theme\) les matieres que theme.css utilise.
// node design/outils/installer_theme.js
// Rien de Mojang ici : les planches, le rondin et les tetes sont dessines par nous (design\outils\dessiner_matieres.js,
// dans design\commun\dessins\) ; les textures d'ecran sont celles de casinoui (le serveur) ; les polices sont libres (OFL).
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..');
const COMMUN = path.join(RACINE, 'design', 'commun');
const THEME = path.join(RACINE, 'electron', 'fenetre', 'theme');
const copier = (de, vers) => { fs.mkdirSync(path.dirname(path.join(THEME, vers)), { recursive: true }); fs.copyFileSync(path.join(COMMUN, de), path.join(THEME, vers)); };

for (const f of ['fredoka.ttf', 'lilita_one.ttf', 'ofl_fredoka.txt', 'ofl_lilita_one.txt']) copier('polices/' + f, 'polices/' + f);
// les textures des ecrans du serveur (casinoui)
for (const f of ['parchemin.png', 'bouton_vert.png', 'bouton_bois.png', 'bouton_or.png', 'bouton_inactif.png', 'bouton_rouge.png', 'case.png']) copier('textures/' + f, 'images/' + f);
// nos dessins
copier('dessins/planches.png', 'images/planches.png');
copier('dessins/rondin.png', 'images/rondin.png');
for (const f of fs.readdirSync(path.join(COMMUN, 'dessins', 'tetes'))) copier('dessins/tetes/' + f, 'images/tetes/' + f);
copier('logo-512.png', 'images/logo-512.png');
// le fond : la prise de vue de cc si elle est la (art\prises_de_vue\fond.png), sinon la photo de la course du 25/09
const prise = path.join(RACINE, 'art', 'prises_de_vue', 'fond.png');
if (fs.existsSync(prise)) fs.copyFileSync(prise, path.join(THEME, 'images', 'fond.png'));
else copier('fond_palais.png', 'images/fond.png');
// l'icone pixel de Florian (la tete du dragon sur une piece d'or), pour la barre de titre
fs.copyFileSync(path.join(RACINE, 'art', 'icone_pixel', 'icone_32.png'), path.join(THEME, 'images', 'icone-32.png'));
console.log('theme installe dans ' + THEME);
