'use strict';
// Le manifeste : la liste exacte des fichiers d'une mise en ligne (chemin, empreinte sha256, taille, adresse).
// Il est vérifié en entier AVANT toute écriture : un chemin qui sortirait du dossier du jeu, un dossier que le launcher
// n'a pas le droit de gérer ou une empreinte mal formée font refuser tout le manifeste.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AGENT } = require('./reglages');

// Les seuls dossiers que le launcher peut vider de ce que le manifeste ne liste pas.
const DOSSIERS_GERABLES = ['mods', 'kubejs/startup_scripts', 'kubejs/client_scripts', 'kubejs/assets'];
// Où un fichier du manifeste peut être posé (les dossiers gérés, plus des réglages imposés).
const RACINES_AUTORISEES = DOSSIERS_GERABLES.concat(['config', 'defaultconfigs']);

const MOTIF_SEGMENT = /^[A-Za-z0-9_+\-.]+$/;
const MOTIF_SHA256 = /^[0-9a-f]{64}$/;

function estHttp(s) { return /^https?:\/\//i.test(s); }

// Un chemin relatif, avec des « / », sans « . » ni « .. », sans lecteur ni barre oblique inverse.
function cheminSur(chemin) {
  if (typeof chemin !== 'string' || chemin === '' || chemin.length > 200) return false;
  return chemin.split('/').every(s => MOTIF_SEGMENT.test(s) && s !== '.' && s !== '..');
}

function dans(chemin, dossier) {
  return chemin.toLowerCase().startsWith(dossier.toLowerCase() + '/');
}

function validerManifeste(m) {
  const fautes = [];
  if (!m || typeof m !== 'object') throw new Error('Le manifeste est illisible.');
  if (m.format !== 1) fautes.push('format inconnu (' + m.format + ')');
  if (!Number.isInteger(m.mise_en_ligne)) fautes.push('numéro de mise en ligne absent');

  const jeu = m.jeu || {};
  if (!/^1\.\d+(\.\d+)?$/.test(String(jeu.minecraft || ''))) fautes.push('version de Minecraft invalide');
  if (!/^\d+\.\d+\.\d+(-beta)?$/.test(String(jeu.neoforge || ''))) fautes.push('version de NeoForge invalide');

  const srv = m.serveur || {};
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(String(srv.adresse || ''))) fautes.push('adresse du serveur invalide');
  if (!Number.isInteger(srv.port) || srv.port < 1 || srv.port > 65535) fautes.push('port du serveur invalide');

  if (!Array.isArray(m.dossiers_geres) || m.dossiers_geres.length === 0) fautes.push('aucun dossier géré');
  else {
    for (const d of m.dossiers_geres) {
      if (!DOSSIERS_GERABLES.includes(d)) fautes.push('dossier que le launcher ne gère pas : ' + d);
    }
  }

  if (!Array.isArray(m.fichiers) || m.fichiers.length === 0) fautes.push('aucun fichier');
  else {
    const vus = new Set();
    for (const f of m.fichiers) {
      const nom = f && f.chemin;
      if (!cheminSur(nom)) { fautes.push('chemin dangereux : ' + nom); continue; }
      if (!RACINES_AUTORISEES.some(r => dans(nom, r))) fautes.push('fichier hors des dossiers autorisés : ' + nom);
      if (vus.has(nom.toLowerCase())) fautes.push('fichier en double : ' + nom);
      vus.add(nom.toLowerCase());
      const sources = [f].concat(Array.isArray(f.autres) ? f.autres : []);
      for (const s of sources) {
        if (!MOTIF_SHA256.test(String(s.sha256 || ''))) fautes.push('empreinte invalide : ' + nom);
        if (!Number.isInteger(s.taille) || s.taille < 0) fautes.push('taille invalide : ' + nom);
        if (typeof s.url !== 'string' || s.url === '') fautes.push('adresse absente : ' + nom);
        else if (!estHttp(s.url) && !cheminSur(s.url)) fautes.push('adresse invalide : ' + nom);
      }
    }
  }

  // Les nouvelles datées : du texte seulement (la fenêtre l'affiche en textContent, jamais en HTML).
  const ligneSure = t => typeof t === 'string' && t.length > 0 && t.length <= 400 && !/[\u0000-\u001f]/.test(t);
  if (m.nouvelles !== undefined) {
    if (!Array.isArray(m.nouvelles) || m.nouvelles.length > 8) fautes.push('nouvelles invalides');
    else {
      for (const n of m.nouvelles) {
        const bonne = n && Number.isInteger(n.mise_en_ligne) && /^\d{4}-\d{2}-\d{2}$/.test(String(n.date)) &&
          Array.isArray(n.lignes) && n.lignes.length <= 5 && n.lignes.every(ligneSure);
        if (!bonne) { fautes.push('une nouvelle est invalide'); break; }
      }
    }
  }

  const premiers = m.premier_lancement || {};
  if (typeof premiers !== 'object' || Array.isArray(premiers)) fautes.push('premier_lancement invalide');
  else {
    for (const [nom, contenu] of Object.entries(premiers)) {
      if (!cheminSur(nom)) fautes.push('chemin dangereux (premier lancement) : ' + nom);
      else if (DOSSIERS_GERABLES.some(d => dans(nom, d))) fautes.push('premier lancement dans un dossier géré : ' + nom);
      if (typeof contenu !== 'string') fautes.push('contenu invalide (premier lancement) : ' + nom);
    }
  }

  if (fautes.length) {
    const e = new Error('Manifeste refusé : ' + fautes.slice(0, 5).join(' ; ') + (fautes.length > 5 ? ' ...' : ''));
    e.fautes = fautes;
    e.code = 'manifeste_refuse';
    throw e;
  }
  return m;
}

async function lireOctets(source) {
  if (estHttp(source)) {
    let r;
    try {
      r = await fetch(source, {
        headers: { 'User-Agent': AGENT, 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      // Pas d'internet, nom introuvable, délai dépassé : fetch ne donne pas de code, on en met un.
      const err = new Error('Réseau injoignable pour ' + source + ' : ' + ((e.cause && e.cause.code) || e.name || e.message));
      err.code = 'reseau';
      throw err;
    }
    if (!r.ok) {
      const e = new Error('HTTP ' + r.status + ' pour ' + source);
      e.code = r.status === 404 ? 'introuvable' : 'reseau';
      throw e;
    }
    return Buffer.from(await r.arrayBuffer());
  }
  return fs.readFileSync(source);
}

// La signature est un fichier <manifeste>.sig : la signature Ed25519 des octets exacts du manifeste, en base64.
function verifierSignature(octets, signatureBase64, clePubliquePem) {
  const cle = crypto.createPublicKey(clePubliquePem);
  const sig = Buffer.from(String(signatureBase64).trim(), 'base64');
  return crypto.verify(null, octets, cle, sig);
}

// Sur GitHub, une release ne remplace pas un fichier d'un coup (on efface, puis on renvoie) : pendant ces quelques
// secondes, le manifeste peut manquer ou ne plus aller avec sa signature. On réessaie donc deux fois avant de refuser.
const ESSAIS_MANIFESTE = 3;
const PAUSE_MANIFESTE_MS = 2000;

async function chargerManifeste({ source, clePublique }) {
  for (let essai = 1; ; essai++) {
    try {
      return await chargerUneFois({ source, clePublique });
    } catch (e) {
      const passager = ['introuvable', 'signature_absente', 'signature_fausse'].includes(e.code);
      if (!estHttp(source) || !passager || essai >= ESSAIS_MANIFESTE) throw e;
      await new Promise(r => setTimeout(r, PAUSE_MANIFESTE_MS));
    }
  }
}

// Le fichier signé unique (depuis la 1.0.3) : { format: 1, contenu: "<le manifeste, texte exact>", signature: "<base64>" }.
// Le manifeste et sa signature arrivent ENSEMBLE : pendant que GitHub propage une nouvelle mise en ligne (20 à 30 s),
// on reçoit l'ancien ou le nouveau, jamais un mélange des deux. Son adresse : celle du manifeste, en .signe.json.
// Absent (hébergement plus ancien) : on revient au couple manifeste.json + manifeste.json.sig.
function adresseEnveloppe(source) { return source.replace(/\.json$/i, '.signe.json'); }

async function lireEnveloppe(source) {
  if (!/\.json$/i.test(source)) return null;
  let brut;
  try { brut = await lireOctets(adresseEnveloppe(source)); } catch (e) {
    if (e.code === 'introuvable' || e.code === 'ENOENT') return null;
    throw e;
  }
  let env;
  try { env = JSON.parse(brut.toString('utf8')); } catch (e) { env = null; }
  if (!env || env.format !== 1 || typeof env.contenu !== 'string' || typeof env.signature !== 'string') {
    const err = new Error('Le fichier signé est illisible : refusé.');
    err.code = 'signature_fausse';
    throw err;
  }
  return { octets: Buffer.from(env.contenu, 'utf8'), sig: env.signature };
}

async function chargerUneFois({ source, clePublique }) {
  const enveloppe = await lireEnveloppe(source);
  const octets = enveloppe ? enveloppe.octets : await lireOctets(source);
  let signe = false;
  if (clePublique) {
    let sig;
    if (enveloppe) sig = enveloppe.sig;
    else {
      try { sig = (await lireOctets(source + '.sig')).toString('utf8'); } catch (e) {
        const err = new Error("Le manifeste n'est pas signé : refusé.");
        err.code = 'signature_absente';
        throw err;
      }
    }
    if (!verifierSignature(octets, sig, clePublique)) {
      const err = new Error('La signature du manifeste est fausse : refusé.');
      err.code = 'signature_fausse';
      throw err;
    }
    signe = true;
  }
  let m;
  try { m = JSON.parse(octets.toString('utf8')); } catch (e) {
    const err = new Error("Le manifeste n'est pas du JSON valide.");
    err.code = 'manifeste_refuse';
    throw err;
  }
  validerManifeste(m);
  const base = estHttp(source) ? source : path.dirname(path.resolve(source));
  return { manifeste: m, base, signe };
}

// Une adresse relative se lit à partir de l'emplacement du manifeste (web ou dossier local).
function resoudre(url, base) {
  if (estHttp(url)) return url;
  if (estHttp(base)) return new URL(url, base).href;
  return path.join(base, ...url.split('/'));
}

module.exports = {
  DOSSIERS_GERABLES, estHttp, cheminSur, validerManifeste, chargerManifeste, verifierSignature, resoudre, adresseEnveloppe,
};
