'use strict';
// Fabrique et publie une nouvelle version du CODE du launcher (a7) dans la release « launcher » (étiquette fixe) du
// dépôt de Florian. L'installateur, lui, ne change pas : les launchers déjà installés téléchargent ce code, et l'amorce
// ne le démarre qu'après avoir vérifié la signature de Florian et l'empreinte de chaque fichier.
//
// Le code : package.json, electron/ (sans le contrat ni les logos réduits), src/. La version est celle de
// package.json : l'augmenter avant chaque publication. Le moteur est la version d'Electron de package.json ; s'il change,
// il faut un nouvel installateur (les launchers installés le diront au joueur).
//
// Usage : node outils/publier_code.js --sortie release_launcher --cle-privee <pem> [--essai]
//           [--jeton <fichier>] [--depot guerrinflorian/casteria-mc] [--etiquette launcher] [--cle-publique <pem>]
//           [--api ... --envois ... --telechargements ...]   (pour les essais : un faux GitHub)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const A = require('../amorce/choisir');
const G = require('./github');

const PROJET = path.join(__dirname, '..');
const EXCLUS = [/^electron\/fenetre\/CONTRAT_FENETRE\.md$/, /^electron\/icones\/logo-.*\.png$/];

function lireArguments(liste) {
  const o = Object.assign({ etiquette: 'launcher', projet: PROJET }, G.PAR_DEFAUT);
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    const v = () => { if (i + 1 >= liste.length) throw new Error('valeur manquante après ' + a); return liste[++i]; };
    if (a === '--sortie') o.sortie = v();
    else if (a === '--cle-privee') o.clePrivee = v();
    else if (a === '--cle-publique') o.clePublique = v();
    else if (a === '--essai') o.essai = true;
    else if (a === '--projet') o.projet = v();
    // Pour les essais seulement (des copies du projet modifiées exprès).
    else if (a === '--non-committe') o.nonCommitte = true;
    else if (['--jeton', '--depot', '--etiquette', '--api', '--envois', '--telechargements', '--patience'].includes(a)) o[a.slice(2)] = v();
    else throw new Error('option inconnue : ' + a);
  }
  if (!o.sortie || !o.clePrivee) throw new Error('il faut --sortie et --cle-privee');
  return o;
}

function lister(dossier, prefixe) {
  let res = [];
  for (const n of fs.readdirSync(dossier, { withFileTypes: true })) {
    const rel = prefixe + '/' + n.name;
    if (n.isDirectory()) res = res.concat(lister(path.join(dossier, n.name), rel));
    else res.push(rel);
  }
  return res;
}

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

async function principal() {
  const o = lireArguments(process.argv.slice(2));
  // Ce qui part est ce qui est committé : l'outil lit les fichiers du dossier, et une autre session peut y avoir un
  // travail en cours (le 25/09, la page d'ae qui s'adapte à la taille a failli partir avec la 1.0.5).
  if (fs.existsSync(path.join(o.projet, '.git')) && !o.nonCommitte) {
    const etat = require('child_process').execFileSync('git', ['-C', o.projet, 'status', '--porcelain', '--', 'package.json', 'electron', 'src'],
      { encoding: 'utf8' }).trim();
    if (etat) {
      throw new Error("des changements non committés dans ce qui part (package.json, electron/, src/) : committe-les, ou publie un export du commit (git archive HEAD package.json electron src) avec --projet\n" + etat);
    }
  }
  const paquet = JSON.parse(fs.readFileSync(path.join(o.projet, 'package.json'), 'utf8'));
  const version = paquet.version;
  const moteur = (paquet.devDependencies || {}).electron;

  // 1. La fabrication
  const chemins = ['package.json']
    .concat(lister(path.join(o.projet, 'electron'), 'electron'), lister(path.join(o.projet, 'src'), 'src'))
    .filter(c => !EXCLUS.some(r => r.test(c)))
    .sort();
  fs.mkdirSync(o.sortie, { recursive: true });
  const fichiers = [];
  for (const c of chemins) {
    const octets = fs.readFileSync(path.join(o.projet, ...c.split('/')));
    const s = sha256(octets);
    fichiers.push({ chemin: c, sha256: s, taille: octets.length, url: s });
    if (!fs.existsSync(path.join(o.sortie, s))) fs.writeFileSync(path.join(o.sortie, s), octets);
  }
  const manifeste = { format: 1, type: 'code-launcher', version, moteur, date: new Date().toISOString(), fichiers };
  A.validerCode(manifeste);
  const octets = Buffer.from(JSON.stringify(manifeste, null, 2) + '\n');
  const sig = crypto.sign(null, octets, crypto.createPrivateKey(fs.readFileSync(o.clePrivee, 'utf8'))).toString('base64') + '\n';
  // Le fichier signé unique (launchers 1.0.3 et plus) et l'ancien couple (pour les launchers d'avant).
  const env = G.enveloppe(octets, sig);
  for (const [nom, contenu] of [['code.json', octets], ['code.json.sig', sig], ['code.signe.json', env],
    ['code-' + version + '.json', octets], ['code-' + version + '.json.sig', sig], ['code-' + version + '.signe.json', env]]) {
    fs.writeFileSync(path.join(o.sortie, nom), contenu);
  }
  const cle = o.clePublique ? fs.readFileSync(o.clePublique, 'utf8') : require('../src/reglages').CLE_PUBLIQUE_PAR_DEFAUT;
  if (!A.verifierSignature(octets, sig, cle)) throw new Error("la signature ne va pas avec la clé publique du launcher : rien n'est publié");
  const taille = fichiers.reduce((t, f) => t + f.taille, 0);
  console.log('Code du launcher ' + version + ' (moteur Electron ' + moteur + ') : ' + fichiers.length + ' fichiers, ' +
    (taille / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo, signé.');

  // 2. La publication
  const jeton = G.lireJeton(o.jeton);
  if (!jeton && !o.essai) throw new Error('pas de jeton GitHub (' + o.jeton + ') : rien envoyé');
  // Le titre et le texte publics (demande de Florian : pour les joueurs, sans nom d'outil ni de personne).
  const gh = G.creerClient(o, jeton, G.RELEASES_PUBLIQUES.launcher.name, G.RELEASES_PUBLIQUES.launcher.body);
  let release = await gh.release();
  const deja = release ? await gh.fichiers(release.id) : [];
  const parNom = new Map(deja.map(a => [a.name, a]));
  const actuel = parNom.get('code.json');
  if (actuel) {
    const enLigne = JSON.parse(await (await fetch(actuel.browser_download_url)).text());
    console.log("En ligne aujourd'hui : le code " + enLigne.version + '.');
    // Les launchers refusent une version qui n'est pas plus récente : on ne la publie pas.
    if (A.comparerVersions(version, enLigne.version) <= 0) {
      throw new Error('la version ' + version + " n'est pas plus récente que " + enLigne.version + ' : augmente la version dans package.json');
    }
  }
  const aEnvoyer = fichiers.filter(f => !parNom.has(f.url)).filter((f, i, t) => t.findIndex(x => x.url === f.url) === i);
  console.log('À envoyer : ' + aEnvoyer.length + ' fichier(s), les copies numérotées, puis code.signe.json, code.json.sig et code.json.');
  if (o.essai) { console.log('Essai : rien envoyé.'); return 0; }

  if (!release) release = await gh.creerRelease();
  for (const f of aEnvoyer) await gh.envoyer(release.id, f.url, fs.readFileSync(path.join(o.sortie, f.url)));
  for (const nom of ['code-' + version + '.json', 'code-' + version + '.json.sig', 'code-' + version + '.signe.json']) {
    if (!parNom.has(nom)) await gh.envoyer(release.id, nom, fs.readFileSync(path.join(o.sortie, nom)));
  }
  // Le fichier signé unique d'abord (les launchers 1.0.3 et plus ne lisent que lui), puis l'ancien couple.
  for (const nom of ['code.signe.json', 'code.json.sig', 'code.json']) {
    const ancien = parNom.get(nom);
    if (ancien) await gh.effacer(ancien.id);
    await gh.envoyer(release.id, nom, fs.readFileSync(path.join(o.sortie, nom)));
  }
  console.log('Page de la release : ' + await G.textesPublics(gh, release, o.etiquette) + '.');
  // Relire ce que liront les launchers : GitHub met 20 s à plus de 90 s à propager un remplacement : 180 s au plus.
  const publique = o.telechargements + '/' + o.depot + '/releases/download/' + o.etiquette + '/';
  const patience = o.patience === undefined ? 180 : Number(o.patience);
  const bonEnv = await G.relire(publique + 'code.signe.json', b => b.equals(env), patience);
  const bonCode = await G.relire(publique + 'code.json', b => b.equals(octets), patience);
  const bonSig = await G.relire(publique + 'code.json.sig', b => A.verifierSignature(octets, b.toString('utf8'), cle), patience);
  const bon = bonEnv && bonCode && bonSig;
  console.log(bon ? 'Publié : ' + publique + 'code.signe.json (et l’ancien couple) est le code ' + version + ', signature vérifiée.'
    : "ÉCHEC DE LA RELECTURE : l'adresse publique ne donne pas ce qui a été envoyé (" +
      [bonEnv ? null : 'code.signe.json', bonCode ? null : 'code.json', bonSig ? null : 'code.json.sig'].filter(Boolean).join(', ') + ').');
  return bon ? 0 : 1;
}

principal().then(c => { process.exitCode = c; }, e => { console.error('REFUSÉ : ' + e.message); process.exitCode = 1; });
