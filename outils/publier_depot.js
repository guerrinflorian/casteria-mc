'use strict';
// Publie la page du dépôt GitHub (a7) : le README.md et le dossier images/ d'ae, sur la branche main de
// guerrinflorian/casteria-mc, par l'API « Contents » (un commit par fichier changé ; un fichier identique n'est pas
// renvoyé). Demande de Florian (25/09), relue par 5b.
//
// Avant tout envoi : chaque image citée par le README est dans le dossier, et chaque lien de téléchargement
// (releases/download/installateur/<nom>) vise un fichier qui existe dans la release. Après : chaque fichier relu à son
// adresse publique (raw.githubusercontent.com), et chaque lien de téléchargement qui répond.
//
// Usage : node outils/publier_depot.js [--dossier page_github] [--essai]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./github');
const R = require('../src/reglages');

const PROJET = path.join(__dirname, '..');

function lireArguments(liste) {
  const o = Object.assign({ dossier: path.join(PROJET, 'page_github'), branche: 'main' }, G.PAR_DEFAUT);
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    const v = () => { if (i + 1 >= liste.length) throw new Error('valeur manquante après ' + a); return liste[++i]; };
    if (a === '--dossier') o.dossier = v();
    else if (a === '--essai') o.essai = true;
    else if (['--jeton', '--depot', '--branche', '--patience'].includes(a)) o[a.slice(2)] = v();
    else throw new Error('option inconnue : ' + a);
  }
  return o;
}

const shaGit = b => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + b.length + '\0'), b])).digest('hex');

async function principal() {
  const o = lireArguments(process.argv.slice(2));
  const jeton = G.lireJeton(o.jeton);
  if (!jeton) throw new Error('pas de jeton GitHub (' + o.jeton + ') : rien envoyé');
  const h = { 'Accept': 'application/vnd.github+json', 'User-Agent': R.AGENT, 'Authorization': 'Bearer ' + jeton, 'X-GitHub-Api-Version': '2022-11-28' };
  const api = (methode, url, corps) => fetch(o.api + '/repos/' + o.depot + url, {
    method: methode, headers: Object.assign({ 'Content-Type': 'application/json' }, h), body: corps ? JSON.stringify(corps) : undefined,
  });

  // 1. Les fichiers : README.md et images/*.
  const fichiers = [{ chemin: 'README.md', local: path.join(o.dossier, 'README.md') }];
  for (const n of fs.readdirSync(path.join(o.dossier, 'images')).sort()) {
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(n)) fichiers.push({ chemin: 'images/' + n, local: path.join(o.dossier, 'images', n) });
  }
  for (const f of fichiers) { f.octets = fs.readFileSync(f.local); f.sha = shaGit(f.octets); }
  const readme = fichiers[0].octets.toString('utf8');
  if (/[\u2013\u2014]/.test(readme)) throw new Error('le README contient un tiret long ou moyen');

  // 2. Les images citées sont là ; les liens de téléchargement visent des fichiers publiés.
  const images = [...readme.matchAll(/src="(images\/[^"]+)"/g)].map(m => m[1]);
  const absentes = images.filter(c => !fichiers.some(f => f.chemin === c));
  if (absentes.length) throw new Error('images citées mais absentes : ' + absentes.join(', '));
  const rel = await (await api('GET', '/releases/tags/installateur')).json();
  const assets = new Set(((await (await api('GET', '/releases/' + rel.id + '/assets?per_page=100')).json()) || []).map(a => a.name));
  const liens = [...new Set([...readme.matchAll(/\/releases\/download\/installateur\/([^\s)"'?#]+)/g)].map(m => decodeURIComponent(m[1])))];
  const manquants = liens.filter(n => !assets.has(n));
  if (manquants.length) throw new Error('le README vise des fichiers absents de la release : ' + manquants.join(', ') + ' : rien envoyé');
  console.log('README : ' + images.length + ' images citées, toutes là ; ' + liens.length + ' liens de téléchargement, tous publiés.');

  // 3. Ce qui change sur la branche.
  const aEnvoyer = [];
  for (const f of fichiers) {
    const r = await api('GET', '/contents/' + f.chemin + '?ref=' + o.branche);
    f.distant = r.status === 200 ? (await r.json()).sha : null;
    if (f.distant !== f.sha) aEnvoyer.push(f);
  }
  console.log('À envoyer sur ' + o.branche + ' : ' + (aEnvoyer.map(f => f.chemin + (f.distant ? ' (remplacé)' : ' (nouveau)')).join(', ') || 'rien (identique)'));
  if (o.essai) { console.log('Essai : rien envoyé.'); return 0; }

  for (const f of aEnvoyer) {
    const corps = { message: 'Page du dépôt : ' + f.chemin + ' (ae, relu par 5b)', content: f.octets.toString('base64'), branch: o.branche };
    if (f.distant) corps.sha = f.distant;
    const r = await api('PUT', '/contents/' + f.chemin, corps);
    if (!r.ok) throw new Error('envoi de ' + f.chemin + ' refusé : HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    console.log('  envoyé : ' + f.chemin);
  }

  // 4. Relire à l'adresse publique, et chaque lien de téléchargement.
  const patience = o.patience === undefined ? 180 : Number(o.patience);
  let bon = true;
  for (const f of fichiers) {
    const url = 'https://raw.githubusercontent.com/' + o.depot + '/' + o.branche + '/' + f.chemin;
    const ok = await G.relire(url, b => shaGit(b) === f.sha, patience);
    if (!ok) { console.log('  ÉCHEC DE LA RELECTURE : ' + url); bon = false; }
  }
  console.log(bon ? fichiers.length + ' fichiers relus à leur adresse publique.' : 'Des fichiers ne sont pas relus.');
  for (const n of liens) {
    const r = await fetch(o.telechargements + '/' + o.depot + '/releases/download/installateur/' + encodeURIComponent(n), { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': R.AGENT } });
    console.log('  lien ' + n + ' : HTTP ' + r.status);
    if (!r.ok) bon = false;
  }
  console.log('La page : https://github.com/' + o.depot);
  return bon ? 0 : 1;
}

principal().then(c => { process.exitCode = c; }, e => { console.error('REFUSÉ : ' + e.message); process.exitCode = 1; });
