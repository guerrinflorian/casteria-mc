'use strict';
// Met le dossier du jeu exactement à l'état du manifeste :
// 1. télécharge ce qui manque ou a changé, et vérifie l'empreinte sha256 avant de le mettre en place ;
// 2. range à part (dans .retires/) ce que les dossiers gérés contiennent en trop : fini les deux versions d'un mod ;
// 3. pose les fichiers du premier lancement (options.txt...) seulement s'ils n'existent pas.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');
const { AGENT } = require('./reglages');
const { estHttp, resoudre } = require('./manifeste');

const MARQUEUR = '.casteria-launcher';
const PARALLELES = 4;
const ESSAIS_PAR_SOURCE = 3;
const DELAI_FICHIER_MS = 5 * 60 * 1000;
const LOTS_RETIRES_GARDES = 5;

function erreur(code, message, cause) {
  const e = new Error(message);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

function versLocal(dossierJeu, chemin) {
  return path.join(dossierJeu, ...chemin.split('/'));
}

function listerFichiers(dossier, prefixe = '') {
  let res = [];
  let entrees;
  try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); } catch (e) {
    if (e.code === 'ENOENT') return res;
    throw e;
  }
  for (const n of entrees) {
    const rel = prefixe ? prefixe + '/' + n.name : n.name;
    if (n.isDirectory()) res = res.concat(listerFichiers(path.join(dossier, n.name), rel));
    else res.push(rel);
  }
  return res;
}

function sha256Fichier(fichier) {
  return new Promise((ok, ko) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(fichier)
      .on('data', d => h.update(d))
      .on('end', () => ok(h.digest('hex')))
      .on('error', ko);
  });
}

async function enParallele(taches, n) {
  let suivant = 0;
  const resultats = new Array(taches.length);
  async function ouvrier() {
    while (suivant < taches.length) {
      const k = suivant++;
      resultats[k] = await taches[k]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, taches.length) }, ouvrier));
  return resultats;
}

const pause = ms => new Promise(r => setTimeout(r, ms));

// Un dossier que le launcher n'a pas créé (le .minecraft d'un joueur, par erreur de réglage) n'est jamais touché,
// sauf s'il n'a encore rien dans les dossiers gérés.
function preparerDossier(dossierJeu, dossiersGeres) {
  const marqueur = path.join(dossierJeu, MARQUEUR);
  if (fs.existsSync(marqueur)) return;
  for (const d of dossiersGeres) {
    if (listerFichiers(versLocal(dossierJeu, d)).length) {
      throw erreur('dossier_etranger', 'Le dossier ' + dossierJeu + ' contient déjà des fichiers (' + d +
        ") qui ne viennent pas du launcher de Casteria : je n'y touche pas.");
    }
  }
  fs.mkdirSync(dossierJeu, { recursive: true });
  fs.writeFileSync(marqueur, 'Ce dossier est géré par le launcher de Casteria.\n');
}

async function etatLocal(dossierJeu, f) {
  const local = versLocal(dossierJeu, f.chemin);
  let st;
  try { st = fs.statSync(local); } catch (e) { return 'absent'; }
  if (!st.isFile()) return 'different';
  const acceptes = [f].concat(f.autres || []);
  if (!acceptes.some(s => s.taille === st.size)) return 'different';
  const sha = await sha256Fichier(local);
  return acceptes.some(s => s.sha256 === sha) ? 'ok' : 'different';
}

// Télécharge (ou copie) une source vers un fichier provisoire, en calculant l'empreinte au passage.
async function recupererSource(source, provisoire, surOctets) {
  const h = crypto.createHash('sha256');
  let n = 0;
  if (estHttp(source.adresse)) {
    const r = await fetch(source.adresse, {
      headers: { 'User-Agent': AGENT },
      signal: AbortSignal.timeout(DELAI_FICHIER_MS),
    });
    if (!r.ok) throw erreur('reseau', 'HTTP ' + r.status);
    const sortie = fs.createWriteStream(provisoire);
    try {
      for await (const morceau of r.body) {
        n += morceau.length;
        if (n > source.taille) throw erreur('taille', 'fichier plus gros que prévu');
        h.update(morceau);
        surOctets(morceau.length);
        if (!sortie.write(morceau)) await once(sortie, 'drain');
      }
    } finally {
      await new Promise(fin => sortie.end(fin));
    }
  } else {
    const octets = fs.readFileSync(source.adresse);
    n = octets.length;
    h.update(octets);
    fs.writeFileSync(provisoire, octets);
    surOctets(n);
  }
  const sha = h.digest('hex');
  if (n !== source.taille || sha !== source.sha256) {
    throw erreur('empreinte', 'empreinte fausse (attendu ' + source.sha256.slice(0, 12) + ', reçu ' + sha.slice(0, 12) + ')');
  }
}

async function installerFichier(f, dossierJeu, base, dossierProvisoire, surOctets, journal) {
  const sources = [f].concat(f.autres || []).map(s => ({
    adresse: resoudre(s.url, base), sha256: s.sha256, taille: s.taille,
  }));
  // Nom unique : deux fichiers identiques (deux textures pareilles) peuvent se télécharger en même temps.
  const provisoire = path.join(dossierProvisoire, crypto.randomBytes(8).toString('hex') + '.part');
  const echecs = [];
  for (const source of sources) {
    for (let essai = 1; essai <= ESSAIS_PAR_SOURCE; essai++) {
      let recu = 0;
      try {
        await recupererSource(source, provisoire, k => { recu += k; surOctets(k); });
        const final = versLocal(dossierJeu, f.chemin);
        fs.mkdirSync(path.dirname(final), { recursive: true });
        // Sous Windows, l'antivirus tient parfois un instant un fichier qu'on vient d'écrire : on réessaie deux secondes
        // avant de conclure que le jeu, ouvert, le tient vraiment.
        for (let k = 0; ; k++) {
          try { fs.renameSync(provisoire, final); break; } catch (e) {
            const tenu = e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES';
            if (tenu && k < 20) { await pause(100); continue; }
            if (tenu) throw erreur('fichier_verrouille', 'Le fichier ' + f.chemin + ' est utilisé : ferme le jeu, puis relance.', e);
            throw e;
          }
        }
        journal.info('installé ' + f.chemin + ' depuis ' + source.adresse);
        return source.adresse;
      } catch (e) {
        surOctets(-recu);
        try { fs.unlinkSync(provisoire); } catch (e2) { /* rien à retirer */ }
        if (e.code === 'fichier_verrouille') throw e;
        echecs.push({ texte: source.adresse + ' (essai ' + essai + ') : ' + e.message, code: e.code || 'reseau' });
        journal.avert('échec ' + f.chemin + ' : ' + source.adresse + ' (essai ' + essai + ') : ' + e.message);
        // Une empreinte fausse ne s'arrange pas en réessayant la même source.
        if (e.code === 'empreinte' || e.code === 'taille') break;
        if (essai < ESSAIS_PAR_SOURCE) await pause(1000 * essai);
      }
    }
  }
  const e = erreur('telechargement', 'Impossible de récupérer ' + f.chemin + ' : ' + echecs.map(x => x.texte).join(' | '));
  // Toutes les sources ont donné un fichier faux (et pas un souci de réseau) : ce n'est pas la connexion du joueur.
  e.fichierAbime = echecs.every(x => x.code === 'empreinte' || x.code === 'taille');
  throw e;
}

// Les fichiers en trop sont déplacés dans .retires/<horodatage>/ (un mod ajouté par le joueur n'est pas perdu),
// et seuls les 5 derniers lots sont gardés.
function ranger(dossierJeu, chemins, journal) {
  if (!chemins.length) return;
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const lot = path.join(dossierJeu, '.retires', horodatage);
  for (const c of chemins) {
    const cible = versLocal(lot, c);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.renameSync(versLocal(dossierJeu, c), cible);
    journal.info('retiré ' + c + ' (rangé dans ' + cible + ')');
  }
  const lots = fs.readdirSync(path.join(dossierJeu, '.retires')).sort();
  for (const ancien of lots.slice(0, Math.max(0, lots.length - LOTS_RETIRES_GARDES))) {
    fs.rmSync(path.join(dossierJeu, '.retires', ancien), { recursive: true, force: true });
  }
}

async function synchroniser({ manifeste, base, dossierJeu, signal = () => {}, journal }) {
  const debut = Date.now();
  preparerDossier(dossierJeu, manifeste.dossiers_geres);
  const dossierProvisoire = path.join(dossierJeu, '.telechargements');
  fs.mkdirSync(dossierProvisoire, { recursive: true });
  for (const reste of fs.readdirSync(dossierProvisoire)) fs.unlinkSync(path.join(dossierProvisoire, reste));

  // 1. L'état de chaque fichier
  const fichiers = manifeste.fichiers;
  let verifies = 0;
  const etats = await enParallele(fichiers.map(f => async () => {
    const e = await etatLocal(dossierJeu, f);
    verifies++;
    signal({ type: 'verification', fait: verifies, total: fichiers.length });
    return e;
  }), PARALLELES);
  const aInstaller = fichiers.filter((f, i) => etats[i] !== 'ok');

  // 2. Les téléchargements
  const octetsTotal = aInstaller.reduce((s, f) => s + f.taille, 0);
  let octets = 0;
  let installes = 0;
  const sources = {};
  if (aInstaller.length) {
    signal({ type: 'maj_debut', fichiers: aInstaller.length, octetsTotal });
    const echecs = [];
    await enParallele(aInstaller.map(f => async () => {
      try {
        const depuis = await installerFichier(f, dossierJeu, base, dossierProvisoire, k => {
          octets += k;
          signal({ type: 'maj_progres', octets, octetsTotal, fichiers: installes, fichiersTotal: aInstaller.length });
        }, journal);
        installes++;
        const site = estHttp(depuis) ? new URL(depuis).host : 'dossier local';
        sources[site] = (sources[site] || 0) + 1;
        signal({ type: 'maj_progres', octets, octetsTotal, fichiers: installes, fichiersTotal: aInstaller.length });
      } catch (e) {
        echecs.push(e);
      }
    }), PARALLELES);
    if (echecs.length) {
      const verrou = echecs.find(e => e.code === 'fichier_verrouille');
      if (verrou) throw verrou;
      const e = erreur('telechargement', echecs.length + ' fichier(s) impossible(s) à récupérer. ' + echecs[0].message);
      e.echecs = echecs;
      e.nombre = echecs.length;
      e.fichierAbime = echecs.every(x => x.fichierAbime);
      throw e;
    }
  }

  // 3. Ce qui est en trop dans les dossiers gérés
  const connus = new Set(fichiers.map(f => f.chemin.toLowerCase()));
  const enTrop = [];
  for (const d of manifeste.dossiers_geres) {
    for (const rel of listerFichiers(versLocal(dossierJeu, d))) {
      const chemin = d + '/' + rel;
      if (!connus.has(chemin.toLowerCase())) enTrop.push(chemin);
    }
  }
  ranger(dossierJeu, enTrop, journal);
  for (const c of enTrop) signal({ type: 'retire', chemin: c });

  // 4. Les fichiers du premier lancement (jamais écrasés : ce sont ensuite les réglages du joueur)
  const poses = [];
  for (const [chemin, contenu] of Object.entries(manifeste.premier_lancement || {})) {
    const local = versLocal(dossierJeu, chemin);
    if (fs.existsSync(local)) continue;
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, contenu);
    poses.push(chemin);
    journal.info('premier lancement : posé ' + chemin);
  }

  const bilan = {
    fichiers: fichiers.length, installes, retires: enTrop, poses, octets, sources, duree_ms: Date.now() - debut,
  };
  signal(Object.assign({ type: 'maj_fin' }, bilan));
  return bilan;
}

module.exports = { MARQUEUR, synchroniser, listerFichiers, sha256Fichier };
