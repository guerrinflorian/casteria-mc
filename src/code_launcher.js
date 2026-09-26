'use strict';
// La mise à jour du CODE du launcher (a7), pendant que le launcher tourne. L'installateur, lui, ne change pas : le
// fichier que le joueur a téléchargé une fois garde sa réputation SmartScreen (décision de 5b, 25/09).
//
// 1. chercherMaj : lit code.json et sa signature dans la release « launcher » ; garde la version seulement si la
//    signature est celle de Florian, si elle est PLUS récente que le code qui tourne, si elle n'a pas déjà été refusée,
//    et si elle convient au moteur Electron installé (sinon, il faut un nouvel installateur).
// 2. installerMaj : télécharge chaque fichier dans un dossier provisoire (code/<version>.part-...), vérifie chacun,
//    y pose code.json et sa signature, revérifie TOUT le dossier comme le fera l'amorce, puis le renomme
//    code/<version> et écrit l'état en dernier (fichier provisoire puis renommage). Une coupure à n'importe quel moment
//    laisse l'ancienne version active. Rien n'est exécuté ici : c'est l'amorce qui démarrera la nouvelle version au
//    prochain lancement, après l'avoir revérifiée.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('./reglages');

const CODE_PAR_DEFAUT = 'https://github.com/guerrinflorian/casteria-mc/releases/download/launcher/code.json';
const DELAI_MS = 60000;

function erreur(code, message) { const e = new Error(message); e.code = code; return e; }

// Sous Windows, l'antivirus tient parfois un instant ce qu'on vient d'écrire : on réessaie avant d'abandonner.
async function renommer(de, vers) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(de, vers); return; } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || i >= 20) throw e;
      await new Promise(r => setTimeout(r, 100));
    }
  }
}
const estHttp = s => /^https?:\/\//i.test(s);

async function lire(source) {
  if (!estHttp(source)) return fs.readFileSync(source);
  const r = await fetch(source, { headers: { 'User-Agent': R.AGENT, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(DELAI_MS) });
  if (r.status === 404) throw erreur('introuvable', 'introuvable : ' + source);
  if (!r.ok) throw erreur('reseau', 'HTTP ' + r.status + ' pour ' + source);
  return Buffer.from(await r.arrayBuffer());
}
function resoudre(url, base) {
  if (estHttp(url)) return url;
  if (estHttp(base)) return new URL(url, base).href;
  return path.join(path.dirname(base), ...url.split('/'));
}

// outils : les fonctions de l'amorce (global.casteriaAmorce), ou celles d'amorce/choisir.js avec une clé (essais).
// Le fichier signé unique (depuis la 1.0.3) : code.signe.json = { format: 1, contenu: "<code.json exact>", signature }.
// Le code et sa signature arrivent ensemble (GitHub met 20 à 30 s à propager un remplacement). Absent : l'ancien couple.
async function lireSigne(source) {
  if (/\.json$/i.test(source)) {
    let brut = null;
    try { brut = await lire(source.replace(/\.json$/i, '.signe.json')); } catch (e) {
      if (e.code !== 'introuvable' && e.code !== 'ENOENT') throw e;
    }
    if (brut) {
      let env = null;
      try { env = JSON.parse(brut.toString('utf8')); } catch (e) { /* illisible */ }
      if (!env || env.format !== 1 || typeof env.contenu !== 'string' || typeof env.signature !== 'string') {
        throw erreur('signature_fausse', 'code.signe.json illisible');
      }
      return { octets: Buffer.from(env.contenu, 'utf8'), sig: env.signature };
    }
  }
  const octets = await lire(source);
  let sig;
  try { sig = (await lire(source + '.sig')).toString('utf8'); } catch (e) { throw erreur('signature_absente', 'code.json sans signature'); }
  return { octets, sig };
}

async function chercherMaj({ source = CODE_PAR_DEFAUT, outils, versionActuelle, moteur, etat }) {
  const { octets, sig } = await lireSigne(source);
  if (!outils.verifierSignature(octets, sig)) throw erreur('signature_fausse', 'la signature de code.json est fausse');
  const m = outils.validerCode(JSON.parse(octets.toString('utf8')));
  if (outils.comparerVersions(m.version, versionActuelle) <= 0) return null;
  if (etat && etat.refusees && etat.refusees.includes(m.version)) return null;
  if (m.moteur !== moteur) return { manifeste: m, moteurDifferent: true };
  return { manifeste: m, octets, sig, source };
}

async function installerMaj({ racine, maj, outils, surProgres = () => {} }) {
  const m = maj.manifeste;
  const dossierCode = path.join(racine, 'code');
  const final = path.join(dossierCode, m.version);
  fs.mkdirSync(dossierCode, { recursive: true });

  // Déjà là et intacte (une coupure juste avant d'écrire l'état) : il ne reste qu'à écrire l'état.
  let dejaLa = false;
  try { outils.verifierDossier(final); dejaLa = true; } catch (e) { /* à télécharger */ }

  if (!dejaLa) {
    const provisoire = path.join(dossierCode, m.version + '.part-' + crypto.randomBytes(4).toString('hex'));
    fs.mkdirSync(provisoire);
    const total = m.fichiers.reduce((s, f) => s + f.taille, 0);
    let fait = 0;
    for (const f of m.fichiers) {
      const contenu = await lire(resoudre(f.url, maj.source));
      if (contenu.length !== f.taille || crypto.createHash('sha256').update(contenu).digest('hex') !== f.sha256) {
        throw erreur('empreinte', 'fichier du code abîmé : ' + f.chemin);
      }
      const cible = path.join(provisoire, ...f.chemin.split('/'));
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.writeFileSync(cible, contenu);
      fait += f.taille;
      surProgres(fait / total);
    }
    fs.writeFileSync(path.join(provisoire, 'code.json'), maj.octets);
    fs.writeFileSync(path.join(provisoire, 'code.json.sig'), maj.sig);
    // La même vérification que l'amorce au démarrage : si elle échoue ici, rien n'est activé.
    outils.verifierDossier(provisoire);
    if (fs.existsSync(final)) await renommer(final, final + '.abime-' + crypto.randomBytes(4).toString('hex'));
    await renommer(provisoire, final);
  }

  // L'état en dernier : c'est lui qui rend la version active au prochain démarrage.
  const etat = outils.lireEtat();
  if (etat.actuelle !== m.version) {
    etat.precedente = etat.actuelle;
    etat.actuelle = m.version;
  }
  etat.essai = null;
  outils.ecrireEtat(etat);
  nettoyer(dossierCode, [etat.actuelle, etat.precedente]);
  return m.version;
}

// Seules la version active et la précédente sont gardées (et les restes de téléchargements coupés sont retirés).
function nettoyer(dossierCode, garder) {
  for (const n of fs.readdirSync(dossierCode)) {
    const p = path.join(dossierCode, n);
    if (!fs.statSync(p).isDirectory() || garder.includes(n)) continue;
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* un dossier encore ouvert partira la fois suivante */ }
  }
}

module.exports = { CODE_PAR_DEFAUT, chercherMaj, installerMaj };
