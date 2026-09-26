'use strict';
// Fabrique le manifeste d'une mise en ligne à partir du paquet des joueurs (Downloads/POUR_LES_JOUEURS_mise_en_ligne_N).
//
// Ce qui sort, dans le dossier d'hébergement (--sortie), à plat : c'est exactement le contenu de la release
// « joueurs » du dépôt GitHub (outils/publier_github.js l'envoie) :
//   manifeste.json (+ .sig)             le manifeste courant, celui que lit le launcher
//   manifeste-<N>.json (+ .sig)         la copie de chaque mise en ligne (pour revenir en arrière)
//   <sha256>                            NOS fichiers seulement, nommés par leur empreinte : jamais écrasés
// Les mods des autres auteurs (tiers.json) ne sont pas copiés : le manifeste pointe vers leur site officiel.
//
// Usage : node outils/fabriquer_manifeste.js --paquet <dossier> --sortie <dossier> --mise-en-ligne <N>
//           [--cle-privee <pem>] [--tiers <tiers.json>] [--sans-verifier-tiers]
//           [--serveur gm52-dc02.ouiheberg.com:25681] [--minecraft 1.21.1] [--neoforge 21.1.251]
//           [--nouveautes <fichier>]   (sinon « Ce qui change » est tiré du LISEZMOI du paquet)
//           [--sans-nouvelle]   (une retouche sans rien à annoncer aux joueurs, règle de Florian : aucune ligne pour
//                                cette mise en ligne, l'historique reste ; jamais le LISEZMOI en secours)
//           [--reprendre-nouvelles <ancien paquet>]...   (la première fois : l'historique des nouvelles datées)
//           [--nouvelles-depuis <N>]   (oublie les nouvelles des mises en ligne avant N)
//           [--dossier-nouvelles <dossier>]   (par défaut nouvelles/ : mise_en_ligne_<N>.txt, écrites pour les joueurs)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validerManifeste } = require('../src/manifeste');
const { listerFichiers } = require('../src/synchro');
const { AGENT } = require('../src/reglages');

// Nos mods : ils partent sur notre hébergement.
const NOS_MODS = /^(casino[a-z]*|casinium|upgrader|coinflip)-/i;
// Les dossiers kubejs du joueur (casino_api.js est pour le serveur SEULEMENT).
const KUBEJS_JOUEUR = ['kubejs/startup_scripts', 'kubejs/client_scripts', 'kubejs/assets'];
const INTERDITS = ['kubejs/startup_scripts/casino_api.js'];
// Ce qu'une instance neuve reçoit une seule fois (ensuite, ce sont les réglages du joueur).
// tutorialStep:none : pas de conseil « Bougez avec Z, Q, S et D » à la première partie (5b, 25/09 après l'étape 6).
const OPTIONS_PREMIER_LANCEMENT = [
  'version:3955', 'onboardAccessibility:false', 'lang:fr_fr', 'skipMultiplayerWarning:true', 'tutorialStep:none',
].join('\n') + '\n';

function lireArguments(liste) {
  const o = { tiers: path.join(__dirname, '..', 'tiers.json'), serveur: 'gm52-dc02.ouiheberg.com:25681',
    dossierNouvelles: path.join(__dirname, '..', 'nouvelles'),
    minecraft: '1.21.1', neoforge: '21.1.251', verifierTiers: true };
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    const v = () => { if (i + 1 >= liste.length) throw new Error('valeur manquante après ' + a); return liste[++i]; };
    if (a === '--paquet') o.paquet = v();
    else if (a === '--sortie') o.sortie = v();
    else if (a === '--mise-en-ligne') o.miseEnLigne = Number(v());
    else if (a === '--cle-privee') o.clePrivee = v();
    else if (a === '--tiers') o.tiers = v();
    else if (a === '--sans-verifier-tiers') o.verifierTiers = false;
    else if (a === '--serveur') o.serveur = v();
    else if (a === '--minecraft') o.minecraft = v();
    else if (a === '--neoforge') o.neoforge = v();
    else if (a === '--nouveautes') o.nouveautes = v();
    else if (a === '--sans-nouvelle') o.sansNouvelle = true;
    else if (a === '--reprendre-nouvelles') (o.reprendre = o.reprendre || []).push(v());
    else if (a === '--nouvelles-depuis') o.depuis = Number(v());
    else if (a === '--dossier-nouvelles') o.dossierNouvelles = v();
    else throw new Error('option inconnue : ' + a);
  }
  if (!o.paquet || !o.sortie || !Number.isInteger(o.miseEnLigne)) {
    throw new Error('il faut --paquet, --sortie et --mise-en-ligne <N>');
  }
  return o;
}

const sha256 = octets => crypto.createHash('sha256').update(octets).digest('hex');

// « Ce qui change » pour la fenêtre du launcher, tiré du LISEZMOI du paquet (écrit, lui, pour une mise à jour à la main) :
// pour chaque point, les premières phrases (60 caractères au moins), sans « casinoui 1.4.6 : » ni « : OBLIGATOIRE »
// (le launcher met tout à jour lui-même), sans les points « ne change pas » ; 5 lignes au plus.
function extraireNouveautes(lisezmoi) {
  const lignes = lisezmoi.split(/\r?\n/);
  const debut = lignes.findIndex(l => /^Ce qui change depuis/i.test(l.trim()));
  if (debut < 0) return [];
  const points = [];
  for (let i = debut + 1; i < lignes.length; i++) {
    const l = lignes[i];
    if (/^\s*$/.test(l)) break;
    const m = l.match(/^\s*-\s+(.*)$/);
    if (m) points.push(m[1].trim());
    else if (points.length) points[points.length - 1] += ' ' + l.trim();
  }
  return points
    .filter(p => !/ne changen?t? pas/.test(p))
    .map(p => {
      // Le LISEZMOI finit ses points par « ; » précédé d'une espace, à la française.
      let t = p.replace(/\s*[;.]\s*$/, '');
      t = t.replace(/^[A-Za-z]+ \d+(\.\d+)+ : /, '');
      t = t.replace(/\s*:\s*OBLIGATOIRE$/i, '');
      // Les phrases écrites pour une mise à jour à la main (mod, .minecraft, .toml, .jar, conseillé, obligatoire)
      // ne parlent pas au joueur du launcher (relecture de 00).
      const phrases = t.split(/(?<=\.)\s+/).filter(s => !/\bmods?\b|\.minecraft|\.toml|\.jar|conseill|obligatoire/i.test(s));
      if (!phrases.length) return null;
      // Les premières phrases, jusqu'à 60 caractères au moins (« La garde du palais. » seul ne dirait rien), sans
      // dépasser 140 caractères quand c'est possible : une phrase n'est jamais coupée.
      let garde = phrases[0];
      for (let k = 1; k < phrases.length && garde.length < 60 && garde.length + 1 + phrases[k].length <= 140; k++) {
        garde += ' ' + phrases[k];
      }
      t = garde.replace(/\.$/, '');
      return t.charAt(0).toUpperCase() + t.slice(1) + '.';
    })
    .filter(Boolean)
    .slice(0, 5);
}

// Les lignes écrites pour les joueurs (00, relues par 5b) : nouvelles/mise_en_ligne_<N>.txt, une ligne par point.
function lignesEcrites(dossier, n) {
  const f = path.join(dossier, 'mise_en_ligne_' + n + '.txt');
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 5);
}

// La date et le numéro d'une mise en ligne, lus sur la première ligne du LISEZMOI :
// « METTRE A JOUR CASTERIA (version du 25/09/2026, mise en ligne 17) ».
function enteteLisezmoi(lisezmoi) {
  const d = lisezmoi.match(/version du (\d{2})\/(\d{2})\/(\d{4})/);
  const n = lisezmoi.match(/mise en ligne (\d+)/i);
  return { date: d ? d[3] + '-' + d[2] + '-' + d[1] : null, miseEnLigne: n ? Number(n[1]) : null };
}

// Les nouvelles d'un ancien paquet (pour remplir l'historique la première fois).
function nouvellesDuPaquet(paquet) {
  const lisezmoi = fs.readFileSync(path.join(paquet, 'LISEZMOI.txt'), 'utf8');
  const e = enteteLisezmoi(lisezmoi);
  if (!e.miseEnLigne || !e.date) throw new Error(paquet + " : le LISEZMOI ne donne pas la date et le numéro de la mise en ligne");
  return { mise_en_ligne: e.miseEnLigne, date: e.date, lignes: extraireNouveautes(lisezmoi) };
}

async function telecharger(url) {
  const r = await fetch(url, { headers: { 'User-Agent': AGENT }, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' pour ' + url);
  return Buffer.from(await r.arrayBuffer());
}

async function principal() {
  const o = lireArguments(process.argv.slice(2));
  const [adresse, port] = o.serveur.split(':');
  const tiers = JSON.parse(fs.readFileSync(o.tiers, 'utf8')).fichiers;
  const fautes = [];
  const fichiers = [];
  const aCopier = [];
  const bilan = { nos_mods: 0, mods_tiers: 0, kubejs: 0, octets_heberges: 0 };

  // Les mods
  const mods = listerFichiers(path.join(o.paquet, 'mods'));
  for (const nom of mods.sort()) {
    const local = path.join(o.paquet, 'mods', nom);
    const octets = fs.readFileSync(local);
    const sha = sha256(octets);
    if (nom.includes('/') || !nom.endsWith('.jar')) { fautes.push('fichier inattendu dans mods : ' + nom); continue; }
    if (tiers[nom]) {
      const sources = tiers[nom].sources;
      if (!sources.some(s => s.sha256 === sha)) {
        fautes.push(nom + " : le jar du paquet ne correspond à aucune source de tiers.json (mets tiers.json à jour)");
        continue;
      }
      if (o.verifierTiers) {
        for (const s of sources) {
          const recu = await telecharger(s.url);
          if (sha256(recu) !== s.sha256 || recu.length !== s.taille) {
            fautes.push(nom + ' : la source ' + s.site + ' ne donne pas le fichier attendu (' + s.url + ')');
          } else console.log('  vérifié ' + nom + ' sur ' + s.site);
        }
      }
      const [principale, ...secours] = sources;
      const entree = { chemin: 'mods/' + nom, sha256: principale.sha256, taille: principale.taille, url: principale.url };
      if (secours.length) entree.autres = secours.map(s => ({ url: s.url, sha256: s.sha256, taille: s.taille }));
      fichiers.push(entree);
      bilan.mods_tiers++;
    } else if (NOS_MODS.test(nom)) {
      fichiers.push({ chemin: 'mods/' + nom, sha256: sha, taille: octets.length, url: sha });
      aCopier.push({ local, sha });
      bilan.nos_mods++;
      bilan.octets_heberges += octets.length;
    } else {
      fautes.push('mod inconnu : ' + nom + " (ajoute-le à tiers.json, ou à NOS_MODS si c'est un mod maison)");
    }
  }

  // Les fichiers kubejs du joueur
  const autresKubejs = listerFichiers(path.join(o.paquet, 'kubejs'))
    .map(r => 'kubejs/' + r)
    .filter(c => !KUBEJS_JOUEUR.some(d => c.startsWith(d + '/')));
  for (const c of autresKubejs) fautes.push('fichier kubejs inattendu (pas pour le joueur ?) : ' + c);
  for (const d of KUBEJS_JOUEUR) {
    for (const rel of listerFichiers(path.join(o.paquet, ...d.split('/'))).sort()) {
      const chemin = d + '/' + rel;
      if (INTERDITS.includes(chemin)) { fautes.push(chemin + ' est pour le serveur seulement'); continue; }
      const local = path.join(o.paquet, ...chemin.split('/'));
      const octets = fs.readFileSync(local);
      const sha = sha256(octets);
      fichiers.push({ chemin, sha256: sha, taille: octets.length, url: sha });
      aCopier.push({ local, sha });
      bilan.kubejs++;
      bilan.octets_heberges += octets.length;
    }
  }

  if (fautes.length) {
    console.error("REFUSÉ, rien n'est écrit :\n  " + fautes.join('\n  '));
    return 1;
  }

  // Ce qui change : écrit à la main (--nouveautes, une ligne par point) ou tiré du LISEZMOI du paquet.
  const cheminLisezmoi = path.join(o.paquet, 'LISEZMOI.txt');
  const lisezmoi = fs.existsSync(cheminLisezmoi) ? fs.readFileSync(cheminLisezmoi, 'utf8') : '';
  // L'ordre (décision de 5b) : --nouveautes, puis nouvelles/mise_en_ligne_N.txt, et le LISEZMOI en secours seulement.
  let lignes = [];
  let origine = 'aucune';
  const ecrites = lignesEcrites(o.dossierNouvelles, o.miseEnLigne);
  if (o.sansNouvelle) {
    // Rien à annoncer (une retouche « futile » ou technique, règle de Florian) : les nouvelles d'avant restent en tête.
    lignes = [];
    origine = 'aucune (--sans-nouvelle : rien à annoncer aux joueurs pour cette mise en ligne)';
  } else if (o.nouveautes) {
    lignes = fs.readFileSync(o.nouveautes, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 5);
    origine = o.nouveautes;
  } else if (ecrites) {
    lignes = ecrites;
    origine = 'nouvelles/mise_en_ligne_' + o.miseEnLigne + '.txt';
  } else if (lisezmoi) {
    lignes = extraireNouveautes(lisezmoi);
    origine = 'LISEZMOI (SECOURS : à faire écrire pour les joueurs dans nouvelles/mise_en_ligne_' + o.miseEnLigne + '.txt)';
  }
  console.log('« Ce qui change » de la mise en ligne ' + o.miseEnLigne + ' : ' + origine);
  const date = enteteLisezmoi(lisezmoi).date || new Date().toISOString().slice(0, 10);

  // Les nouvelles datées : celle-ci, puis celles du manifeste déjà publié dans --sortie, et celles des anciens paquets
  // donnés par --reprendre-nouvelles (la première fois). Une par mise en ligne, les plus récentes d'abord, 5 au plus.
  const parNumero = new Map();
  for (const p of o.reprendre || []) { const n = nouvellesDuPaquet(p); parNumero.set(n.mise_en_ligne, n); }
  const precedent = path.join(o.sortie, 'manifeste.json');
  if (fs.existsSync(precedent)) {
    for (const n of JSON.parse(fs.readFileSync(precedent, 'utf8')).nouvelles || []) {
      if (n.mise_en_ligne < o.miseEnLigne) parNumero.set(n.mise_en_ligne, n);
    }
  }
  parNumero.set(o.miseEnLigne, { mise_en_ligne: o.miseEnLigne, date, lignes });
  // Les lignes écrites pour les joueurs remplacent aussi celles des mises en ligne précédentes.
  for (const n of parNumero.values()) {
    const e = n.mise_en_ligne === o.miseEnLigne ? null : lignesEcrites(o.dossierNouvelles, n.mise_en_ligne);
    if (e) n.lignes = e;
  }
  const nouvelles = [...parNumero.values()]
    .filter(n => n.mise_en_ligne <= o.miseEnLigne && n.mise_en_ligne >= (o.depuis || 0) && n.lignes.length)
    .sort((a, b) => b.mise_en_ligne - a.mise_en_ligne)
    .slice(0, 5);
  console.log('Les nouvelles (à relire) :');
  for (const n of nouvelles) console.log('  mise en ligne ' + n.mise_en_ligne + ' du ' + n.date + ' :\n    ' + n.lignes.join('\n    '));

  const manifeste = {
    format: 1,
    mise_en_ligne: o.miseEnLigne,
    date: new Date().toISOString(),
    serveur: { nom: 'Casteria', adresse, port: Number(port) },
    jeu: { minecraft: o.minecraft, neoforge: o.neoforge },
    nouvelles,
    dossiers_geres: ['mods'].concat(KUBEJS_JOUEUR),
    premier_lancement: { 'options.txt': OPTIONS_PREMIER_LANCEMENT },
    fichiers,
  };
  validerManifeste(manifeste);

  // Nos fichiers, à plat, nommés par leur empreinte (un fichier déjà là n'est pas réécrit).
  let copies = 0;
  fs.mkdirSync(o.sortie, { recursive: true });
  for (const { local, sha } of aCopier) {
    const cible = path.join(o.sortie, sha);
    if (fs.existsSync(cible)) continue;
    fs.copyFileSync(local, cible);
    copies++;
  }
  const octets = Buffer.from(JSON.stringify(manifeste, null, 2) + '\n');
  const ecrire = (nom, contenu) => fs.writeFileSync(path.join(o.sortie, nom), contenu);
  ecrire('manifeste-' + o.miseEnLigne + '.json', octets);
  ecrire('manifeste.json', octets);
  if (o.clePrivee) {
    const cle = crypto.createPrivateKey(fs.readFileSync(o.clePrivee, 'utf8'));
    const sig = crypto.sign(null, octets, cle).toString('base64') + '\n';
    ecrire('manifeste-' + o.miseEnLigne + '.json.sig', sig);
    ecrire('manifeste.json.sig', sig);
    // Le fichier signé unique (launchers 1.0.3 et plus) ; les deux fichiers d'avant restent pour les plus anciens.
    const env = require('./github').enveloppe(octets, sig);
    ecrire('manifeste-' + o.miseEnLigne + '.signe.json', env);
    ecrire('manifeste.signe.json', env);
  }
  console.log('Manifeste de la mise en ligne ' + o.miseEnLigne + ' : ' + fichiers.length + ' fichiers (' +
    bilan.nos_mods + ' mods maison, ' + bilan.mods_tiers + ' mods tiers par leur site officiel, ' + bilan.kubejs +
    ' fichiers kubejs), ' + (bilan.octets_heberges / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) +
    ' Mo sur notre hébergement, ' + copies +
    ' fichier(s) nouveau(x) copié(s), ' + (o.clePrivee ? 'signé' : 'NON signé') + '.');
  return 0;
}

principal().then(c => { process.exitCode = c; }, e => { console.error('ERREUR : ' + e.message); process.exitCode = 1; });
