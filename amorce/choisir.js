'use strict';
// Le choix du code du launcher (a7). Ce fichier fait partie de l'AMORCE : il est livré avec l'installateur et ne se met
// jamais à jour tout seul (seul un nouvel installateur le change). Il ne dépend que de Node.
//
// Le code du launcher (electron/, src/, package.json) peut se mettre à jour : chaque version téléchargée est rangée dans
// <racine>/code/<version>/ avec son manifeste signé (code.json + code.json.sig). À CHAQUE démarrage, avant d'exécuter
// quoi que ce soit, l'amorce revérifie la signature (clé de Florian) et l'empreinte de chaque fichier. Au moindre doute,
// elle prend la version précédente, puis le code livré avec l'installateur. Rien ne s'exécute sans signature valide.
//
// Retour en arrière : avant de démarrer une version téléchargée, l'amorce note « essai en cours ». Le code confirme
// quand la page a répondu (confirmer()). Si le démarrage suivant trouve un essai jamais confirmé, cette version est
// refusée pour de bon.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RACINES_CODE = ['electron/', 'src/'];
const FICHIERS_CODE = ['package.json'];
const MOTIF_SEGMENT = /^[A-Za-z0-9_+\-.]+$/;
const MOTIF_VERSION = /^\d+\.\d+\.\d+$/;

function erreur(code, message) { const e = new Error(message); e.code = code; return e; }

function comparerVersions(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

function cheminSur(c) {
  return typeof c === 'string' && c.length > 0 && c.length <= 200 &&
    c.split('/').every(s => MOTIF_SEGMENT.test(s) && s !== '.' && s !== '..');
}

// Le manifeste du code : { format: 1, type: 'code-launcher', version, moteur, date, fichiers: [{chemin, sha256, taille, url}] }
function validerCode(m) {
  const fautes = [];
  if (!m || m.format !== 1 || m.type !== 'code-launcher') fautes.push("ce n'est pas un manifeste de code du launcher");
  else {
    if (!MOTIF_VERSION.test(String(m.version))) fautes.push('version invalide');
    if (!MOTIF_VERSION.test(String(m.moteur))) fautes.push('version du moteur invalide');
    if (!Array.isArray(m.fichiers) || !m.fichiers.length) fautes.push('aucun fichier');
    else {
      const vus = new Set();
      for (const f of m.fichiers) {
        const c = f && f.chemin;
        if (!cheminSur(c)) { fautes.push('chemin dangereux : ' + c); continue; }
        if (!FICHIERS_CODE.includes(c) && !RACINES_CODE.some(r => c.startsWith(r))) fautes.push('fichier hors du code : ' + c);
        if (vus.has(c.toLowerCase())) fautes.push('fichier en double : ' + c);
        vus.add(c.toLowerCase());
        if (!/^[0-9a-f]{64}$/.test(String(f.sha256))) fautes.push('empreinte invalide : ' + c);
        if (!Number.isInteger(f.taille) || f.taille < 0) fautes.push('taille invalide : ' + c);
        if (typeof f.url !== 'string' || !(/^https:\/\//.test(f.url) || cheminSur(f.url))) fautes.push('adresse invalide : ' + c);
      }
      for (const oblig of ['package.json', 'electron/main.js', 'electron/preload.js']) {
        if (!vus.has(oblig)) fautes.push('fichier indispensable absent : ' + oblig);
      }
    }
  }
  if (fautes.length) throw erreur('code_refuse', 'Code du launcher refusé : ' + fautes.slice(0, 4).join(' ; '));
  return m;
}

function verifierSignature(octets, signatureBase64, clePubliquePem) {
  try {
    return crypto.verify(null, octets, crypto.createPublicKey(clePubliquePem), Buffer.from(String(signatureBase64).trim(), 'base64'));
  } catch (e) {
    return false;
  }
}

// Vérifie une version rangée dans un dossier : signature, manifeste, puis chaque fichier (taille et sha256).
// Rend le manifeste, ou lève une erreur. Ne modifie rien.
function verifierDossier(dossier, clePublique) {
  let octets, sig;
  try {
    octets = fs.readFileSync(path.join(dossier, 'code.json'));
    sig = fs.readFileSync(path.join(dossier, 'code.json.sig'), 'utf8');
  } catch (e) { throw erreur('code_incomplet', 'manifeste du code absent dans ' + dossier); }
  if (!verifierSignature(octets, sig, clePublique)) throw erreur('signature_fausse', 'signature du code fausse dans ' + dossier);
  const m = validerCode(JSON.parse(octets.toString('utf8')));
  for (const f of m.fichiers) {
    const local = path.join(dossier, ...f.chemin.split('/'));
    let contenu;
    try { contenu = fs.readFileSync(local); } catch (e) { throw erreur('code_incomplet', 'fichier absent : ' + f.chemin); }
    if (contenu.length !== f.taille || crypto.createHash('sha256').update(contenu).digest('hex') !== f.sha256) {
      throw erreur('code_abime', 'fichier abîmé : ' + f.chemin);
    }
  }
  return m;
}

// L'état des versions : <racine>/code/etat.json = { actuelle, precedente, refusees: [], essai: { version, debut } }
function cheminEtat(racine) { return path.join(racine, 'code', 'etat.json'); }
function lireEtat(racine) {
  try {
    const e = JSON.parse(fs.readFileSync(cheminEtat(racine), 'utf8'));
    return { actuelle: e.actuelle || null, precedente: e.precedente || null, refusees: Array.isArray(e.refusees) ? e.refusees : [], essai: e.essai || null };
  } catch (e) {
    return { actuelle: null, precedente: null, refusees: [], essai: null };
  }
}
// Sous Windows, un fichier qu'on vient d'écrire est parfois tenu un instant (l'antivirus le lit) : le renommage échoue
// (EPERM, EBUSY). On réessaie pendant une demi-seconde avant d'abandonner.
function renommerAvecEssais(de, vers) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(de, vers); return; } catch (e) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code) || i >= 9) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

// Écriture sûre : un fichier provisoire, puis un renommage (une coupure ne laisse jamais un état à moitié écrit).
// Si le renommage reste impossible, on écrit directement : au pire, une coupure à cet instant rend l'état illisible, et
// l'amorce repart alors du code de l'installateur (jamais d'un code non vérifié).
function ecrireEtat(racine, etat) {
  fs.mkdirSync(path.join(racine, 'code'), { recursive: true });
  const f = cheminEtat(racine);
  const contenu = JSON.stringify(etat, null, 2);
  fs.writeFileSync(f + '.tmp', contenu);
  try {
    renommerAvecEssais(f + '.tmp', f);
  } catch (e) {
    fs.writeFileSync(f, contenu);
    try { fs.unlinkSync(f + '.tmp'); } catch (e2) { /* il partira à la prochaine écriture */ }
  }
}

// Le choix au démarrage. Rend { base, version, embarquee, raisons[] } : base est le dossier du code à démarrer.
function choisirCode({ racine, embarque, versionEmbarquee, moteur, clePublique, journal = () => {} }) {
  const etat = lireEtat(racine);
  const raisons = [];
  // Un essai jamais confirmé : cette version n'a pas démarré, elle est refusée pour de bon.
  if (etat.essai && etat.essai.version) {
    raisons.push('la version ' + etat.essai.version + " n'a pas démarré : refusée");
    if (!etat.refusees.includes(etat.essai.version)) etat.refusees.push(etat.essai.version);
    etat.essai = null;
  }
  const candidates = [etat.actuelle, etat.precedente].filter((v, i, t) => v && t.indexOf(v) === i);
  for (const v of candidates) {
    if (!MOTIF_VERSION.test(v)) continue;
    if (etat.refusees.includes(v)) { raisons.push(v + ' : refusée'); continue; }
    if (comparerVersions(v, versionEmbarquee) <= 0) { raisons.push(v + " : pas plus récente que celle de l'installateur"); continue; }
    const dossier = path.join(racine, 'code', v);
    // Seule une vérification ratée refuse une version (jamais une écriture de fichier qui échoue).
    let m;
    try {
      m = verifierDossier(dossier, clePublique);
      if (m.version !== v) throw erreur('code_refuse', 'le dossier ' + v + ' contient la version ' + m.version);
    } catch (e) {
      raisons.push(v + ' : ' + e.message);
      if (!etat.refusees.includes(v)) etat.refusees.push(v);
      continue;
    }
    if (m.moteur !== moteur) { raisons.push(v + ' : demande le moteur ' + m.moteur + ' (installé : ' + moteur + ')'); continue; }
    etat.essai = { version: v, debut: new Date().toISOString() };
    try {
      ecrireEtat(racine, etat);
    } catch (e) {
      // Sans la marque d'essai, le retour en arrière automatique ne jouera pas pour CE démarrage ; la version reste
      // vérifiée (signature et empreintes), donc sûre à démarrer.
      journal("marque d'essai impossible à écrire (" + e.message + ')');
    }
    journal('code ' + v + ' vérifié : il démarre (essai)');
    return { base: dossier, version: v, embarquee: false, raisons };
  }
  try { ecrireEtat(racine, etat); } catch (e) { /* un disque plein ne doit pas empêcher de démarrer */ }
  journal("code de l'installateur (" + versionEmbarquee + ')' + (raisons.length ? ' : ' + raisons.join(' | ') : ''));
  return { base: embarque, version: versionEmbarquee, embarquee: true, raisons };
}

// Le code démarré a répondu : l'essai est réussi.
function confirmer(racine, version) {
  const etat = lireEtat(racine);
  if (etat.essai && etat.essai.version === version) {
    etat.essai = null;
    ecrireEtat(racine, etat);
  }
}

// Le code démarré a planté avant de répondre : refusé tout de suite.
function refuser(racine, version) {
  const etat = lireEtat(racine);
  if (!etat.refusees.includes(version)) etat.refusees.push(version);
  if (etat.essai && etat.essai.version === version) etat.essai = null;
  ecrireEtat(racine, etat);
}

module.exports = {
  comparerVersions, cheminSur, validerCode, verifierSignature, verifierDossier, lireEtat, ecrireEtat,
  choisirCode, confirmer, refuser,
};
