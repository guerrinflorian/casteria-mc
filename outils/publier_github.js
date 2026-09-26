'use strict';
// Publie une mise en ligne dans la release « joueurs » du dépôt GitHub de Florian (l'hébergement du launcher).
// Le dossier donné (--dossier) est la sortie de fabriquer_manifeste.js : manifeste.json (+ .sig), manifeste-N.json
// (+ .sig), le fichier signé unique manifeste.signe.json (+ manifeste-N.signe.json) et nos fichiers nommés par leur
// empreinte.
//
// Avant d'envoyer QUOI QUE CE SOIT, l'outil vérifie :
//   - que le manifeste est valide et que sa signature va avec la clé publique écrite dans le launcher ;
//   - que chacun de nos fichiers est là, avec la bonne empreinte et la bonne taille (ou déjà publié) ;
//   - qu'on ne revient pas à une mise en ligne plus ancienne que celle publiée (sauf --retour-arriere).
// Puis : nos fichiers d'abord, les copies numérotées ensuite, et le manifeste courant EN DERNIER (le fichier signé
// unique, puis l'ancien couple pour les launchers d'avant la 1.0.3). Enfin, il relit depuis l'adresse publique ce que
// liront les joueurs, en patientant jusqu'à 180 s (--patience <secondes>) : GitHub met de 20 s à plus de 90 s à propager.
//
// Usage : node outils/publier_github.js --dossier <sortie de fabriquer_manifeste> [--essai] [--retour-arriere]
//           [--jeton <fichier>]   (par défaut C:\Users\guerr\Casteria_cles\github_token.txt ; jamais affiché)
//           [--depot guerrinflorian/casteria-mc] [--etiquette joueurs]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('../src/reglages');
const { validerManifeste, verifierSignature, estHttp } = require('../src/manifeste');

function lireArguments(liste) {
  const o = {
    depot: 'guerrinflorian/casteria-mc', etiquette: 'joueurs', jeton: 'C:/Users/guerr/Casteria_cles/github_token.txt',
    api: 'https://api.github.com', envois: 'https://uploads.github.com', telechargements: 'https://github.com',
  };
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    const v = () => { if (i + 1 >= liste.length) throw new Error('valeur manquante après ' + a); return liste[++i]; };
    if (a === '--dossier') o.dossier = v();
    else if (a === '--essai') o.essai = true;
    else if (a === '--retour-arriere') o.retour = true;
    else if (a === '--jeton') o.jeton = v();
    else if (a === '--depot') o.depot = v();
    else if (a === '--etiquette') o.etiquette = v();
    // Pour les essais seulement : un faux GitHub local.
    else if (a === '--api') o.api = v();
    else if (a === '--envois') o.envois = v();
    else if (a === '--telechargements') o.telechargements = v();
    else if (a === '--cle-publique') o.clePublique = v();
    else if (a === '--patience') o.patience = Number(v());
    else throw new Error('option inconnue : ' + a);
  }
  if (!o.dossier) throw new Error('il faut --dossier <sortie de fabriquer_manifeste>');
  return o;
}

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

const G = require('./github');
const relire = G.relire;
// Le titre et le texte publics (demande de Florian : pour les joueurs, sans nom d'outil ni de personne).
const creerClient = (o, jeton) => G.creerClient(o, jeton, G.RELEASES_PUBLIQUES.joueurs.name, G.RELEASES_PUBLIQUES.joueurs.body);

async function principal() {
  const o = lireArguments(process.argv.slice(2));
  const lire = nom => fs.readFileSync(path.join(o.dossier, nom));

  // 1. Tout vérifier ici, avant le moindre envoi.
  const octetsManifeste = lire('manifeste.json');
  const manifeste = JSON.parse(octetsManifeste.toString('utf8'));
  validerManifeste(manifeste);
  const n = manifeste.mise_en_ligne;
  const cle = o.clePublique ? fs.readFileSync(o.clePublique, 'utf8') : R.CLE_PUBLIQUE_PAR_DEFAUT;
  if (!fs.existsSync(path.join(o.dossier, 'manifeste.json.sig'))) throw new Error("le manifeste n'est pas signé");
  const signature = lire('manifeste.json.sig');
  if (!verifierSignature(octetsManifeste, signature.toString('utf8'), cle)) {
    throw new Error('la signature ne va pas avec la clé publique du launcher : les joueurs refuseraient ce manifeste');
  }
  if (!lire('manifeste-' + n + '.json').equals(octetsManifeste)) throw new Error('manifeste-' + n + '.json diffère de manifeste.json');
  // Le fichier signé unique (launchers 1.0.3 et plus) : le même manifeste, la même signature, rien d'autre.
  if (!fs.existsSync(path.join(o.dossier, 'manifeste.signe.json'))) {
    throw new Error('manifeste.signe.json absent : refaire le manifeste avec fabriquer_manifeste.js');
  }
  const octetsEnveloppe = lire('manifeste.signe.json');
  const env = JSON.parse(octetsEnveloppe.toString('utf8'));
  if (env.format !== 1 || !Buffer.from(String(env.contenu), 'utf8').equals(octetsManifeste) ||
      String(env.signature).trim() !== signature.toString('utf8').trim()) {
    throw new Error('manifeste.signe.json ne va pas avec manifeste.json et sa signature');
  }
  if (!lire('manifeste-' + n + '.signe.json').equals(octetsEnveloppe)) throw new Error('manifeste-' + n + '.signe.json diffère de manifeste.signe.json');
  const nosFichiers = new Map();
  for (const f of manifeste.fichiers) {
    if (!estHttp(f.url)) nosFichiers.set(f.url, f);
  }
  for (const [nom, f] of nosFichiers) {
    if (nom !== f.sha256) throw new Error('le fichier ' + f.chemin + " n'est pas nommé par son empreinte");
  }
  console.log('Mise en ligne ' + n + ' : manifeste valide, signature vérifiée avec la clé du launcher, ' +
    nosFichiers.size + ' fichiers à nous (les mods tiers restent sur leur site).');

  // 2. L'état de la release
  let jeton = process.env.GITHUB_TOKEN || null;
  if (!jeton && fs.existsSync(o.jeton)) jeton = fs.readFileSync(o.jeton, 'utf8').trim();
  if (!jeton && !o.essai) throw new Error('pas de jeton GitHub (' + o.jeton + ') : rien envoyé');
  const gh = creerClient(o, jeton);
  let release = await gh.release();
  const deja = release ? await gh.fichiers(release.id) : [];
  const parNom = new Map(deja.map(a => [a.name, a]));
  console.log(release ? 'Release « ' + o.etiquette + ' » : ' + deja.length + ' fichiers déjà publiés.'
    : 'Release « ' + o.etiquette + ' » absente : elle sera créée.');

  const actuel = parNom.get('manifeste.json');
  if (actuel) {
    const r = await fetch(actuel.browser_download_url, { headers: { 'User-Agent': R.AGENT } });
    const enLigne = JSON.parse(await r.text());
    console.log("En ligne aujourd'hui : la mise en ligne " + enLigne.mise_en_ligne + '.');
    if (enLigne.mise_en_ligne > n && !o.retour) {
      throw new Error('la release a déjà la mise en ligne ' + enLigne.mise_en_ligne + ' : pour revenir à la ' + n + ', ajoute --retour-arriere');
    }
  }

  const aEnvoyer = [];
  for (const [nom, f] of nosFichiers) {
    const a = parNom.get(nom);
    if (a && a.size === f.taille) continue;
    if (a) throw new Error('le fichier publié ' + nom + " n'a pas la bonne taille : à regarder à la main");
    const octets = lire(nom);
    if (octets.length !== f.taille || sha256(octets) !== f.sha256) throw new Error('le fichier local ' + nom + ' est abîmé');
    aEnvoyer.push({ nom, octets });
  }
  const numerotes = ['manifeste-' + n + '.json', 'manifeste-' + n + '.json.sig', 'manifeste-' + n + '.signe.json']
    .filter(nom => !parNom.has(nom));
  const volume = aEnvoyer.reduce((s, x) => s + x.octets.length, 0);
  console.log('À envoyer : ' + aEnvoyer.length + ' fichier(s) (' + (volume / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) +
    ' Mo), ' + numerotes.length + ' copie(s) numérotée(s), puis manifeste.signe.json, manifeste.json.sig et manifeste.json.');
  if (deja.length + aEnvoyer.length + numerotes.length > 900) {
    console.log('ATTENTION : la release approche de la limite de GitHub (1 000 fichiers) : faire du ménage.');
  }
  if (o.essai) { console.log('Essai : rien envoyé.'); return 0; }

  // 3. Les envois, dans l'ordre
  if (!release) release = await gh.creerRelease();
  let faits = 0;
  for (let i = 0; i < aEnvoyer.length; i += 4) {
    await Promise.all(aEnvoyer.slice(i, i + 4).map(async x => { await gh.envoyer(release.id, x.nom, x.octets); faits++; }));
    process.stdout.write('\r  fichiers envoyés : ' + faits + '/' + aEnvoyer.length);
  }
  if (aEnvoyer.length) process.stdout.write('\n');
  for (const nom of numerotes) await gh.envoyer(release.id, nom, lire(nom));
  // Le fichier signé unique d'abord (les launchers 1.0.3 et plus ne lisent que lui), puis l'ancien couple.
  for (const nom of ['manifeste.signe.json', 'manifeste.json.sig', 'manifeste.json']) {
    const ancien = parNom.get(nom);
    if (ancien) await gh.effacer(ancien.id);
    await gh.envoyer(release.id, nom, lire(nom));
  }
  console.log('Page de la release : ' + await G.textesPublics(gh, release, o.etiquette) + '.');

  // 4. Relire ce que liront les joueurs, depuis l'adresse publique (GitHub met 20 à 30 s à propager un remplacement)
  const publique = o.telechargements + '/' + o.depot + '/releases/download/' + o.etiquette + '/';
  const patience = o.patience === undefined ? 180 : o.patience;
  const bonEnv = await relire(publique + 'manifeste.signe.json', b => b.equals(octetsEnveloppe), patience);
  const bonManifeste = await relire(publique + 'manifeste.json', b => b.equals(octetsManifeste), patience);
  const bonSig = await relire(publique + 'manifeste.json.sig', b => verifierSignature(octetsManifeste, b.toString('utf8'), cle), patience);
  const bon = bonEnv && bonManifeste && bonSig;
  console.log(bon ? 'Publié : ' + publique + 'manifeste.signe.json (et l’ancien couple) est la mise en ligne ' + n + ', signature vérifiée.'
    : "ÉCHEC DE LA RELECTURE : l'adresse publique ne donne pas ce qui a été envoyé (" +
      [bonEnv ? null : 'manifeste.signe.json', bonManifeste ? null : 'manifeste.json', bonSig ? null : 'manifeste.json.sig']
        .filter(Boolean).join(', ') + ').');
  return bon ? 0 : 1;
}

principal().then(c => { process.exitCode = c; }, e => { console.error('REFUSÉ : ' + e.message); process.exitCode = 1; });
