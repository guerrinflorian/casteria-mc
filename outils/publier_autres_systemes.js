'use strict';
// Publie les paquets Mac et Linux du launcher (a7) dans la release « installateur », À CÔTÉ de l'installateur Windows,
// sous des noms fixes. Accord de Florian le 25/09/2026 (« publie mac et linux vas y c'est ok », dans la session de 5b).
//
// L'installateur Windows (Casteria-Installation.exe) ne doit JAMAIS changer (réputation SmartScreen) : l'outil ne
// l'envoie pas, ne l'efface pas, et vérifie son empreinte avant et après (celle de GitHub, puis un vrai téléchargement).
// Les paquets Mac et Linux, eux, peuvent être remplacés (un nouveau passage de 2e ou cc) : ils ne portent pas cette
// réputation. Chacun est vérifié contre son .sha256 (écrit par 2e et cc à côté du fichier) avant l'envoi, puis relu à
// l'adresse publique.
// Le texte de la page : JOUEURS_INSTALLATION.md (Windows), puis la page Mac et la page Linux des
// systèmes dont un fichier est publié, puis les empreintes.
//
// Usage : node outils/publier_autres_systemes.js --fichier <paquet> [--fichier <paquet>...] [--essai]
//           [--page-mac plateformes/mac/JOUEURS_MAC.md] [--page-linux plateformes/linux/PAGE_JOUEURS_LINUX.md]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./github');

const PROJET = path.join(__dirname, '..');
const EXE = 'Casteria-Installation.exe';
const EMPREINTE_EXE = '449e7f020a8f49f5e7ade778beb6d2d75afd92b1250f678c6a5dca805d62d087';
const PAQUETS = {
  'Casteria-mac-apple-silicon.zip': 'mac',
  'Casteria-mac-intel.zip': 'mac',
  'Casteria-Linux-x86_64.AppImage': 'linux',
  'Casteria-Linux-x86_64.tar.gz': 'linux',
  // Les paquets de cc pour la 1.0.6 (demande de Florian : « une version linux qui marchera à 100 % »).
  'Casteria-Linux-x86_64.deb': 'linux',
  'Casteria-Linux-x86_64.pacman': 'linux',
};

function lireArguments(liste) {
  const o = Object.assign({
    etiquette: 'installateur', fichiers: [],
    pageMac: path.join(PROJET, 'plateformes', 'mac', 'JOUEURS_MAC.md'),
    pageLinux: path.join(PROJET, 'plateformes', 'linux', 'PAGE_JOUEURS_LINUX.md'),
  }, G.PAR_DEFAUT);
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    const v = () => { if (i + 1 >= liste.length) throw new Error('valeur manquante après ' + a); return liste[++i]; };
    if (a === '--fichier') o.fichiers.push(v());
    else if (a === '--essai') o.essai = true;
    else if (a === '--texte-seulement') o.texteSeulement = true;
    else if (a === '--page-mac') o.pageMac = v();
    else if (a === '--page-linux') o.pageLinux = v();
    // La page complète écrite par ae (page_github/page_installateur.md) : prise telle quelle, empreintes ajoutées.
    else if (a === '--page') o.page = v();
    else if (['--jeton', '--depot', '--etiquette', '--api', '--envois', '--telechargements', '--patience'].includes(a)) o[a.slice(2)] = v();
    else throw new Error('option inconnue : ' + a);
  }
  if (!o.fichiers.length && !o.texteSeulement) throw new Error('il faut au moins un --fichier (ou --texte-seulement)');
  if (o.fichiers.length && o.texteSeulement) throw new Error('--texte-seulement ne prend pas de --fichier');
  return o;
}

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

// Une page de joueurs : ce qui suit la ligne « --- » s'il y a un en-tête de brouillon au-dessus ; chaque titre descend
// d'un niveau (la page de la release a déjà son titre) : « # » devient « ## », « ## » devient « ### ».
// Sans titre en tête (il était dans l'en-tête de brouillon), la page reçoit le sien.
function page(fichier, titre) {
  let t = fs.readFileSync(fichier, 'utf8').replace(/\r\n/g, '\n');
  const coupe = t.indexOf('\n---\n');
  if (/Brouillon|texte proposé/i.test(t.slice(0, coupe < 0 ? 0 : coupe))) t = t.slice(coupe + 5);
  t = t.trim().replace(/^(#{1,5}) /gm, '#$1 ');
  return /^## /.test(t) ? t : '## ' + titre + '\n\n' + t;
}

function empreinteGitHub(a) { return a && typeof a.digest === 'string' ? a.digest.replace(/^sha256:/, '') : null; }

async function principal() {
  const o = lireArguments(process.argv.slice(2));

  // 1. Les paquets, vérifiés ici avant tout envoi.
  const paquets = o.fichiers.map(f => {
    const nom = path.basename(f);
    if (!PAQUETS[nom]) throw new Error(nom + " n'est pas un nom de paquet prévu (" + Object.keys(PAQUETS).join(', ') + ')');
    const octets = fs.readFileSync(f);
    const sha = sha256(octets);
    const fichierSha = f + '.sha256';
    if (!fs.existsSync(fichierSha)) throw new Error(nom + ' : pas de ' + path.basename(fichierSha) + ' à côté du fichier');
    const attendu = fs.readFileSync(fichierSha, 'utf8').trim().split(/\s+/)[0].toLowerCase();
    if (attendu !== sha) throw new Error(nom + " : l'empreinte ne correspond pas à son .sha256 (" + sha + ' contre ' + attendu + ')');
    console.log(nom + ' : ' + (octets.length / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo, sha256 ' + sha + ' (= son .sha256).');
    return { nom, octets, sha, systeme: PAQUETS[nom] };
  });

  // 2. La release et l'installateur Windows, qui ne doit pas bouger.
  const jeton = G.lireJeton(o.jeton);
  if (!jeton && !o.essai) throw new Error('pas de jeton GitHub (' + o.jeton + ') : rien envoyé');
  const gh = G.creerClient(o, jeton);
  const release = await gh.release();
  if (!release) throw new Error("la release « " + o.etiquette + " » n'existe pas : l'installateur Windows doit être publié d'abord");
  const avant = await gh.fichiers(release.id);
  const exeAvant = avant.find(a => a.name === EXE);
  if (!exeAvant || empreinteGitHub(exeAvant) !== EMPREINTE_EXE) {
    throw new Error("l'installateur Windows publié n'a pas l'empreinte attendue (" + (exeAvant ? empreinteGitHub(exeAvant) : 'absent') + ') : rien envoyé');
  }
  console.log(EXE + ' publié : sha256 ' + EMPREINTE_EXE + ' (vérifié AVANT, par GitHub).');

  // 3. Le texte de la page : Windows, puis les systèmes dont un paquet est (ou sera) publié.
  const publies = new Map(avant.filter(a => PAQUETS[a.name]).map(a => [a.name, empreinteGitHub(a)]));
  for (const p of paquets) publies.set(p.nom, p.sha);
  const systemes = new Set([...publies.keys()].map(n => PAQUETS[n]));
  // Plus aucune « version d'essai » (décision de Florian, 25/09 au soir : Mac essayé sur un vrai Mac, Linux prouvé par
  // les essais de cc sur Ubuntu, Arch et Debian).
  const noms = ['**Windows**', systemes.has('mac') ? '**Mac**' : null, systemes.has('linux') ? '**Linux**' : null]
    .filter(Boolean);
  const plusieurs = noms.length > 1;
  let texte;
  if (o.page) {
    // La page d'ae, complète, telle quelle.
    texte = fs.readFileSync(o.page, 'utf8').replace(/\r\n/g, '\n').trim();
  } else {
    texte = (plusieurs ? 'Choisis ton système ci-dessous : ' + noms.slice(0, -1).join(', ') + ' ou ' + noms[noms.length - 1] + '.\n\n' : '') +
      fs.readFileSync(path.join(PROJET, 'JOUEURS_INSTALLATION.md'), 'utf8').trim()
        .replace(/^## Installer le launcher de Casteria$/m, plusieurs ? '## Sur Windows' : '## Installer le launcher de Casteria');
    if (systemes.has('mac')) texte += '\n\n---\n\n' + page(o.pageMac, 'Sur Mac');
    if (systemes.has('linux')) texte += '\n\n---\n\n' + page(o.pageLinux, 'Sur Linux');
  }
  texte += '\n\n---\nEmpreintes sha256 :\n- `' + EXE + '` : `' + EMPREINTE_EXE + '`\n' +
    [...publies].sort().map(([n, s]) => '- `' + n + '` : `' + s + '`').join('\n') + '\n';
  if (/[\u2013\u2014]/.test(texte)) throw new Error('la page contient un tiret long ou moyen : à corriger dans les pages sources');
  // Chaque lien de téléchargement de la page vise un fichier qui existe (déjà publié, ou envoyé maintenant) : jamais un
  // lien qui mène à une erreur (la crainte d'ae pour le .deb et le paquet Arch).
  const lies = [...texte.matchAll(/\/releases\/download\/([^/\s)"']+)\/([^\s)"'?#]+)/g)];
  const manquants = lies.filter(m => m[1] === o.etiquette && m[2] !== EXE && !publies.has(decodeURIComponent(m[2])))
    .map(m => m[2]).filter((n, i, t) => t.indexOf(n) === i);
  const autresReleases = lies.filter(m => m[1] !== o.etiquette).map(m => m[1] + '/' + m[2]);
  if (manquants.length) throw new Error('la page vise des fichiers absents de la release : ' + manquants.join(', ') + ' : rien envoyé');
  if (autresReleases.length) throw new Error('la page vise une autre release : ' + autresReleases.join(', ') + ' : à vérifier');

  const aEnvoyer = paquets.filter(p => {
    const a = avant.find(x => x.name === p.nom);
    return !(a && a.size === p.octets.length && empreinteGitHub(a) === p.sha);
  });
  console.log('À envoyer : ' + (aEnvoyer.map(p => p.nom).join(', ') || 'rien (déjà publiés à l’identique)') +
    ' ; texte de la page : ' + texte.length + ' caractères (Windows' + (systemes.has('mac') ? ', Mac' : '') + (systemes.has('linux') ? ', Linux' : '') + ').');
  if (o.essai) {
    fs.writeFileSync(path.join(PROJET, 'dist', 'page_installateur.apercu.md'), texte);
    console.log('Essai : rien envoyé. Le texte de la page est dans dist/page_installateur.apercu.md.');
    return 0;
  }

  // 4. Les envois (jamais l'installateur Windows), puis le texte de la page.
  for (const p of aEnvoyer) {
    const ancien = avant.find(a => a.name === p.nom);
    if (ancien) await gh.effacer(ancien.id);
    await gh.envoyer(release.id, p.nom, p.octets);
    console.log('  envoyé : ' + p.nom);
  }
  await gh.modifierTexte(release.id, texte);

  // 5. Relire : chaque paquet depuis l'adresse publique, et l'installateur Windows inchangé (GitHub, puis téléchargement).
  const publique = o.telechargements + '/' + o.depot + '/releases/download/' + o.etiquette + '/';
  const patience = o.patience === undefined ? 180 : Number(o.patience);
  let bon = true;
  for (const p of paquets) {
    const ok = await G.relire(publique + p.nom, b => sha256(b) === p.sha, patience);
    console.log((ok ? '  relu : ' : '  ÉCHEC DE LA RELECTURE : ') + p.nom);
    bon = bon && ok;
  }
  const apres = await gh.fichiers(release.id);
  const exeApres = apres.find(a => a.name === EXE);
  const exeIntact = exeApres && exeApres.id === exeAvant.id && empreinteGitHub(exeApres) === EMPREINTE_EXE;
  const exeTelecharge = sha256(Buffer.from(await (await fetch(publique + EXE, { headers: { 'User-Agent': 'casteria' } })).arrayBuffer()));
  const exeBon = exeIntact && exeTelecharge === EMPREINTE_EXE;
  console.log(exeBon ? EXE + ' inchangé APRÈS : même fichier chez GitHub, et le téléchargement donne ' + exeTelecharge + '.'
    : 'ALERTE : ' + EXE + ' a changé (' + (exeApres ? empreinteGitHub(exeApres) : 'absent') + ', téléchargé ' + exeTelecharge + ').');
  const relue = await gh.release();
  const texteBon = relue && relue.body.replace(/\r\n/g, '\n') === texte;
  console.log(texteBon ? 'Texte de la page à jour.' : 'ÉCHEC : le texte de la page ne correspond pas.');
  console.log('La page : ' + o.telechargements + '/' + o.depot + '/releases/tag/' + o.etiquette);
  return bon && exeBon && texteBon ? 0 : 1;
}

principal().then(c => { process.exitCode = c; }, e => { console.error('REFUSÉ : ' + e.message); process.exitCode = 1; });
