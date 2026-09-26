'use strict';
// Publie l'installateur du launcher (a7) dans la release « installateur » (étiquette fixe) du dépôt de Florian, sous
// un nom FIXE : Casteria-Installation.exe. Décision de 5b validée par Florian (25/09) : ce fichier se publie UNE fois
// et ne change plus (sans signature de code, la réputation SmartScreen s'attache à l'empreinte du fichier). Il ne se
// republie que si le moteur Electron doit changer : l'outil refuse alors sans --remplacer.
// Le texte de la release est JOUEURS_INSTALLATION.md (ce que les joueurs lisent sur la page de téléchargement).
//
// Usage : node outils/publier_installateur.js [--essai] [--remplacer] [--fichier dist/Casteria-Installation.exe]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./github');

const PROJET = path.join(__dirname, '..');
const NOM = 'Casteria-Installation.exe';

function lireArguments(liste) {
  const o = Object.assign({ etiquette: 'installateur', fichier: path.join(PROJET, 'dist', NOM) }, G.PAR_DEFAUT);
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    const v = () => { if (i + 1 >= liste.length) throw new Error('valeur manquante après ' + a); return liste[++i]; };
    if (a === '--essai') o.essai = true;
    else if (a === '--remplacer') o.remplacer = true;
    else if (['--fichier', '--jeton', '--depot', '--etiquette', '--api', '--envois', '--telechargements'].includes(a)) o[a.slice(2)] = v();
    else throw new Error('option inconnue : ' + a);
  }
  return o;
}

async function principal() {
  const o = lireArguments(process.argv.slice(2));
  const octets = fs.readFileSync(o.fichier);
  const sha = crypto.createHash('sha256').update(octets).digest('hex');
  const version = JSON.parse(fs.readFileSync(path.join(PROJET, 'package.json'), 'utf8'));
  console.log(NOM + ' : ' + (octets.length / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo, sha256 ' + sha +
    ', code ' + version.version + ', moteur Electron ' + version.devDependencies.electron + '.');
  const texte = fs.readFileSync(path.join(PROJET, 'JOUEURS_INSTALLATION.md'), 'utf8') +
    '\n\n---\nEmpreinte sha256 de ' + NOM + ' : `' + sha + '`\n';

  const jeton = G.lireJeton(o.jeton);
  if (!jeton && !o.essai) throw new Error('pas de jeton GitHub (' + o.jeton + ') : rien envoyé');
  const gh = G.creerClient(o, jeton, "Installer le launcher de Casteria", texte);
  let release = await gh.release();
  const deja = release ? await gh.fichiers(release.id) : [];
  const ancien = deja.find(a => a.name === NOM);
  if (ancien && !o.remplacer) {
    throw new Error("un installateur est déjà publié : il ne change pas (réputation SmartScreen). Seul un nouveau moteur justifie --remplacer");
  }
  console.log(release ? 'Release « installateur » : ' + deja.length + ' fichier(s).' : 'Release « installateur » absente : elle sera créée.');
  if (o.essai) { console.log('Essai : rien envoyé.'); return 0; }

  if (!release) release = await gh.creerRelease();
  if (ancien) await gh.effacer(ancien.id);
  await gh.envoyer(release.id, NOM, octets);
  const publique = o.telechargements + '/' + o.depot + '/releases/download/' + o.etiquette + '/' + NOM;
  const lu = Buffer.from(await (await fetch(publique)).arrayBuffer());
  const bon = crypto.createHash('sha256').update(lu).digest('hex') === sha;
  console.log(bon ? 'Publié : ' + publique + ' (empreinte vérifiée).' : "ÉCHEC DE LA RELECTURE : l'adresse publique ne donne pas le fichier envoyé.");
  return bon ? 0 : 1;
}

principal().then(c => { process.exitCode = c; }, e => { console.error('REFUSÉ : ' + e.message); process.exitCode = 1; });
