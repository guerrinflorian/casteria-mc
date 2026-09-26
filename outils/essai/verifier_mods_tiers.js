// Cherche l'adresse officielle (Modrinth) de chaque jar tiers, par son empreinte exacte, puis retelecharge
// le fichier depuis cette adresse et verifie qu'il est identique octet pour octet (sha256).
// Usage : node verifier_mods_tiers.js <dossier des mods> <jar> [<jar>...]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'casteria-launcher/0.1 (test)';
const dossier = process.argv[2];
const jars = process.argv.slice(3);

function hash(buf, algo) { return crypto.createHash(algo).update(buf).digest('hex'); }

async function json(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(url + ' : HTTP ' + r.status);
  return r.json();
}

async function verifier(nom) {
  const buf = fs.readFileSync(path.join(dossier, nom));
  const sha1 = hash(buf, 'sha1');
  const sha256 = hash(buf, 'sha256');
  const v = await json('https://api.modrinth.com/v2/version_file/' + sha1 + '?algorithm=sha1');
  if (!v) return { nom, sha256, modrinth: null };
  const f = v.files.find(x => x.hashes.sha1 === sha1);
  const projet = await json('https://api.modrinth.com/v2/project/' + v.project_id);
  // Retelecharger depuis l'adresse officielle et comparer
  const r = await fetch(f.url, { headers: { 'User-Agent': UA } });
  const distant = Buffer.from(await r.arrayBuffer());
  return {
    nom, sha256, taille: buf.length,
    modrinth: {
      projet: projet.slug, titre: projet.title, licence: projet.license && projet.license.id,
      version: v.version_number, id_version: v.id, statut: v.status, loaders: v.loaders, jeu: v.game_versions,
      fichier: f.filename, url: f.url, identique: hash(distant, 'sha256') === sha256,
    },
  };
}

(async () => {
  const res = [];
  for (const j of jars) {
    try { res.push(await verifier(j)); } catch (e) { res.push({ nom: j, erreur: String(e) }); }
  }
  console.log(JSON.stringify(res, null, 2));
})();
