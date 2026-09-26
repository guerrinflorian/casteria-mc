'use strict';
// Les matieres des maquettes du launcher (serveurmc-ae, 25/09/2026), tirees du serveur, jamais inventees :
//  - les polices de casinoui (Fredoka, Lilita One : licence OFL, leurs textes copies a cote) ;
//  - les textures des ecrans du serveur (parchemin, cadre en bois a coins dores, ruban rouge, boutons, onglets) ;
//  - le logo de Florian reduit a 512 px (moyenne 4 x 4, alpha premultiplie) ;
//  - les tetes des 9 skins par defaut de Minecraft (visage + chapeau, 8 x 8) ;
//  - les icones pixel de nos objets (pepite, eclat des credits, cles, castérium, oeuf, livre, horloge...) ;
//  - la photo du palais pour le fond.
// node outils/preparer_matieres.js   (depuis design_ae)
const fs = require('fs'), path = require('path');
const SMC = 'C:/Users/guerr/OneDrive/Bureau/DEV/PERSO/ServeurMC';
const { lirePng, ecrirePng } = require(SMC + '/outils/png');
const PJ = require(SMC + '/outils/police_jeu');
const AP = require(SMC + '/outils/ecran_apercu');
const ICI = path.join(__dirname, '..', 'commun');
const UI = SMC + '/dev_mods/casinoui-projet/src/main/resources/assets/casinoui';
const dossier = d => { fs.mkdirSync(path.join(ICI, d), { recursive: true }); return path.join(ICI, d); };

// 1. les polices
for (const f of ['fredoka.ttf', 'lilita_one.ttf', 'ofl_fredoka.txt', 'ofl_lilita_one.txt']) fs.copyFileSync(path.join(UI, 'font', f), path.join(dossier('polices'), f));

// 2. les textures des ecrans
for (const f of ['parchemin.png', 'sprites/cadre.png', 'sprites/carte.png', 'sprites/ruban.png', 'sprites/bouton_or.png', 'sprites/bouton_vert.png', 'sprites/bouton_bois.png',
  'sprites/bouton_rouge.png', 'sprites/bouton_inactif.png', 'sprites/onglet.png', 'sprites/onglet_actif.png', 'sprites/case.png']) {
  fs.copyFileSync(path.join(UI, 'textures/gui', f), path.join(dossier('textures'), path.basename(f)));
}

// 2 bis. des planches du jeu (le bois des barres : une vraie matiere de Minecraft, pas un degrade)
for (const n of ['spruce_planks', 'dark_oak_planks', 'stripped_dark_oak_log']) {
  fs.writeFileSync(path.join(dossier('textures'), n + '.png'), PJ.lireJar('assets/minecraft/textures/block/' + n + '.png'));
}

// 3. le logo, 2048 -> 512
{
  const src = lirePng(path.join(__dirname, '..', '..', 'art', 'logo-casteria-2048.png'));
  const k = src.w / 512, W = 512, H = Math.round(src.h / k), px = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      const c = src.pixels[(y * k + j) * src.w + x * k + i];
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; n++;
    }
    px.push(a ? [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / n)] : [0, 0, 0, 0]);
  }
  ecrirePng(path.join(ICI, 'logo-512.png'), W, H, px);
}

// 4. les tetes des skins par defaut (le visage 8 x 8 en (8, 8), le chapeau en (40, 8) par-dessus)
for (const n of ['steve', 'alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'sunny', 'zuri']) {
  const s = lirePng(PJ.lireJar('assets/minecraft/textures/entity/player/wide/' + n + '.png'));
  const px = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const f = s.pixels[(8 + y) * s.w + 8 + x], c = s.pixels[(8 + y) * s.w + 40 + x];
    px.push(c[3] > 0 ? c : f);
  }
  ecrirePng(path.join(dossier('tetes'), n + '.png'), 8, 8, px);
}

// 5. les icones de nos objets (celles de l'inventaire : ecran_apercu.icone)
const ICONES = {
  pepite: 'minecraft:gold_nugget', credits: 'minecraft:amethyst_shard', cle_vote: 'casinoblocs:cle_vote', cle_rare: 'casinoblocs:cle_rare',
  cle_royale: 'casinoblocs:cle_tres_rare', cle_tresor: 'casinoblocs:cle_legendaire', casterium: 'casinium:lingot_casinium', eclat_casterium: 'casinium:eclat_casinium',
  oeuf: 'casinoanimaux:capybara_dore_spawn_egg', livre: 'minecraft:writable_book', horloge: 'minecraft:clock', boussole: 'minecraft:compass',
  coffre: 'minecraft:chest', etabli: 'casinoatelier:etabli', diamant: 'minecraft:diamond', emeraude: 'minecraft:emerald', carte: 'minecraft:filled_map',
  lanterne: 'minecraft:lantern', comparateur: 'minecraft:comparator', herbe: 'minecraft:grass_block', plume: 'minecraft:feather',
  lingot_or: 'minecraft:gold_ingot', epee: 'minecraft:diamond_sword', poubelle: 'minecraft:lava_bucket'
};
// le coeur des points de vie : un sprite de l'interface du jeu
fs.writeFileSync(path.join(dossier('icones'), 'coeur.png'), PJ.lireJar('assets/minecraft/textures/gui/sprites/hud/heart/full.png'));
for (const nom in ICONES) {
  const img = AP.icone(ICONES[nom]);
  if (!img) { console.log('introuvable : ' + ICONES[nom]); continue; }
  ecrirePng(path.join(dossier('icones'), nom + '.png'), img.w, img.h, img.pixels);
}

// 6. le fond : une photo du palais (course du 25/09, sans l'interface du jeu)
fs.copyFileSync(SMC + '/photos_exclusifs/course_spawn_17/spawn_17_14/s06_perroquet_et_chien_au_palais.png', path.join(ICI, 'fond_palais.png'));
console.log('matieres pretes dans ' + ICI);
