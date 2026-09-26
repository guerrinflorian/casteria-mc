'use strict';
// LE PAQUET MAC DU LAUNCHER, étape 1 sur 3 : l'assemblage, SOUS WINDOWS (serveurmc-2e, 25/09/2026).
//   node plateformes/mac/fabriquer_mac.js [--arch arm64|x64|tous]
// electron-builder refuse de fabriquer pour macOS sous Windows (packager.js : « Build for macOS is supported only on
// macOS »), et Windows ne sait pas poser les liens symboliques des frameworks d'Electron. On fait donc ici, EN MÉMOIRE,
// ce que ferait electron-builder, à partir du zip officiel d'Electron pour darwin :
//   - Electron.app -> Casteria.app, l'exécutable Contents/MacOS/Casteria, les 4 « Casteria Helper*.app » (la doc
//     d'Electron l'exige quand l'exécutable change de nom), leurs Info.plist (identifiant fr.casteria.launcher...) ;
//   - Contents/Resources/app.asar (les « files » du champ build de package.json, le package.json nettoyé comme le fait
//     electron-builder), ElectronAsarIntegrity recalculé, l'icône casteria.icns en pixel art ;
//   - Contents/Resources/bin : portablemc du bon processeur (vérifié contre bin/empreintes.json, les empreintes des
//     archives officielles aux signatures PGP vérifiées), empreintes.json du paquet, la licence de PortableMC.
// La sortie : sortie/Casteria-<version>-mac-<arch>-a-signer.tar.gz (liens et droits Unix gardés) et
// sortie/Casteria-<version>-mac-<arch>.attendu.json (ce que la signature ne doit PAS changer).
// Étape 2 : signer.sh dans un conteneur Linux (rcodesign, signature ad hoc). Étape 3 : verifier_mac.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { lireZip, ecrireTarGz, completerDossiers } = require('./archives');
const { fabriquerIcns } = require('./icns');

const RACINE = path.resolve(__dirname, '..', '..');
const CACHE = path.join(__dirname, 'cache');
const SORTIE = path.join(__dirname, 'sortie');
const NM = path.join(RACINE, 'node_modules');
const asar = require(path.join(NM, '@electron', 'asar'));
const plist = require(path.join(NM, 'plist'));
const MARQUE_SHA = '__SHA256_LIVRE__';
// Les fichiers qu'electron-builder écarte toujours (ceux qui peuvent traîner ici).
const EXCLUS_TOUJOURS = [/(^|\/)\.DS_Store$/, /(^|\/)\._[^/]*$/, /(^|\/)\.git(ignore|attributes|keep)?$/, /(^|\/)thumbs\.db$/i, /(^|\/)desktop\.ini$/i];

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
/** Un Mach-O 64 bits (0xfeedfacf, écrit en petit-boutiste) ou « fat » (0xcafebabe, gros-boutiste). */
const estMachO = b => b.length >= 4 && (b.readUInt32LE(0) === 0xfeedfacf || b.readUInt32BE(0) === 0xcafebabe);

function telecharger(url, dest) {
  return new Promise((ok, ko) => {
    https.get(url, { headers: { 'User-Agent': 'casteria-fabrique-mac' } }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return telecharger(new URL(r.headers.location, url).toString(), dest).then(ok, ko); }
      if (r.statusCode !== 200) { r.resume(); return ko(new Error(url + ' : HTTP ' + r.statusCode)); }
      const f = fs.createWriteStream(dest + '.part');
      r.pipe(f);
      f.on('finish', () => f.close(() => { fs.renameSync(dest + '.part', dest); ok(); }));
      f.on('error', ko);
    }).on('error', ko);
  });
}

/** Le zip officiel d'Electron pour darwin, vérifié contre le checksums.json du paquet electron (celui d'npm). */
async function zipElectron(arch) {
  const version = JSON.parse(fs.readFileSync(path.join(NM, 'electron', 'package.json'), 'utf8')).version;
  const nom = `electron-v${version}-darwin-${arch}.zip`;
  const attendu = JSON.parse(fs.readFileSync(path.join(NM, 'electron', 'checksums.json'), 'utf8'))[nom];
  if (!attendu) throw new Error(nom + ' absent de node_modules/electron/checksums.json');
  const f = path.join(CACHE, nom);
  if (!fs.existsSync(f)) {
    fs.mkdirSync(CACHE, { recursive: true });
    console.log('téléchargement de ' + nom + '...');
    await telecharger(`https://github.com/electron/electron/releases/download/v${version}/${nom}`, f);
  }
  const buf = fs.readFileSync(f);
  if (sha256(buf) !== attendu) throw new Error(nom + ' : empreinte fausse (' + sha256(buf) + ' au lieu de ' + attendu + ')');
  return { version, nom, buf };
}

// ---------- les fichiers de l'app (le champ build.files, comme electron-builder) ----------

function globVersRegex(g) {
  let r = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { r += g[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += g[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') r += '[^/]*';
    else if (c === '?') r += '[^/]';
    else r += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + r + '$');
}

function parcourir(dossier, rel, liste) {
  for (const n of fs.readdirSync(dossier, { withFileTypes: true })) {
    const r = rel ? rel + '/' + n.name : n.name;
    if (n.isDirectory()) parcourir(path.join(dossier, n.name), r, liste);
    else if (n.isFile()) liste.push(r);
  }
  return liste;
}

function fichiersDeLApp(build) {
  const pos = build.files.filter(p => !p.startsWith('!')).map(globVersRegex);
  const neg = build.files.filter(p => p.startsWith('!')).map(p => globVersRegex(p.slice(1)));
  const racines = [...new Set(build.files.filter(p => !p.startsWith('!')).map(p => p.split('/')[0]))];
  const tous = [];
  for (const r of racines) {
    const abs = path.join(RACINE, r);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isDirectory()) parcourir(abs, r, tous); else tous.push(r);
  }
  return tous.filter(f => pos.some(re => re.test(f)) && !neg.some(re => re.test(f)) && !EXCLUS_TOUJOURS.some(re => re.test(f))).sort();
}

/** Le package.json tel qu'electron-builder le met dans app.asar (vu dans dist/win-unpacked : sans scripts, devDependencies, build). */
function paquetNettoye(pj) {
  const c = {};
  for (const [k, v] of Object.entries(pj)) if (!['scripts', 'devDependencies', 'build', 'directories'].includes(k)) c[k] = v;
  return JSON.stringify(c, null, 2);
}

async function fabriquerAsar(pj, arch) {
  const liste = fichiersDeLApp(pj.build);
  const scene = path.join(SORTIE, 'tmp', 'app-' + arch);
  fs.rmSync(scene, { recursive: true, force: true });
  for (const f of liste) {
    fs.mkdirSync(path.join(scene, path.dirname(f)), { recursive: true });
    if (f === 'package.json') fs.writeFileSync(path.join(scene, f), paquetNettoye(pj));
    else fs.copyFileSync(path.join(RACINE, f), path.join(scene, f));
  }
  const dest = path.join(SORTIE, 'tmp', 'app-' + arch + '.asar');
  await asar.createPackageWithOptions(scene, dest, {});
  const donnees = fs.readFileSync(dest);
  const { headerString } = asar.getRawHeader(dest);
  return { donnees, liste, integrite: sha256(headerString) };
}

// ---------- l'assemblage ----------

function modifierPlist(arbre, chemin, f) {
  const e = arbre.get(chemin);
  if (!e || e.type !== 'fichier') throw new Error('Info.plist introuvable : ' + chemin);
  const o = plist.parse(e.donnees.toString('utf8'));
  f(o);
  arbre.set(chemin, { type: 'fichier', mode: e.mode, donnees: Buffer.from(plist.build(o) + '\n', 'utf8') });
}

async function assembler(arch) {
  const pj = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));
  const b = pj.build;
  const nom = b.productName || pj.productName;
  const id = b.appId;
  const version = pj.version;
  const A = nom + '.app';
  if (nom.length !== 'Electron'.length) console.log('(le nom « ' + nom + ' » n\'a pas la longueur de « Electron » : les chemins changent de longueur)');
  const electron = await zipElectron(arch);
  const src = lireZip(electron.buf);

  // Les Helpers du zip (Electron 44 : Helper, GPU, Renderer, Plugin), lus plutôt que supposés.
  const suffixes = [...src.keys()].map(k => /^Electron\.app\/Contents\/Frameworks\/Electron Helper((?: \([A-Za-z]+\))?)\.app$/.exec(k)).filter(Boolean).map(m => m[1]);
  if (suffixes.length < 4) throw new Error('Helpers attendus : 4, trouvés : ' + suffixes.length);

  const app = new Map();
  for (const [k, e] of src) {
    if (k === 'LICENSE') { app.set(A + '/Contents/Resources/LICENSE.electron.txt', e); continue; }
    if (k === 'LICENSES.chromium.html') { app.set(A + '/Contents/Resources/LICENSES.chromium.html', e); continue; }
    if (k !== 'Electron.app' && !k.startsWith('Electron.app/')) continue;
    let n = A + k.slice('Electron.app'.length);
    if (n === A + '/Contents/MacOS/Electron') n = A + '/Contents/MacOS/' + nom;
    n = n.replace(/^([^/]+\/Contents\/Frameworks\/)Electron Helper((?: \([A-Za-z]+\))?)\.app(\/Contents\/MacOS\/Electron Helper(?: \([A-Za-z]+\))?$)?/,
      (m, debut, suf, exe) => debut + nom + ' Helper' + suf + '.app' + (exe ? '/Contents/MacOS/' + nom + ' Helper' + suf : ''));
    if (/^[^/]+\/Contents\/Resources\/(default_app\.asar|electron\.icns)$/.test(n)) continue;
    app.set(n, e);
  }

  // Info.plist de l'app et des Helpers
  const asarApp = await fabriquerAsar(pj, arch);
  modifierPlist(app, A + '/Contents/Info.plist', o => {
    o.CFBundleDisplayName = nom;
    o.CFBundleName = nom;
    o.CFBundleExecutable = nom;
    o.CFBundleIdentifier = id;
    o.CFBundleIconFile = 'casteria.icns';
    o.CFBundleShortVersionString = version;
    o.CFBundleVersion = version;
    o.LSApplicationCategoryType = 'public.app-category.games';
    if (b.copyright) o.NSHumanReadableCopyright = b.copyright;
    o.ElectronAsarIntegrity = { 'Resources/app.asar': { algorithm: 'SHA256', hash: asarApp.integrite } };
  });
  for (const suf of suffixes) {
    const H = `${A}/Contents/Frameworks/${nom} Helper${suf}.app`;
    modifierPlist(app, H + '/Contents/Info.plist', o => {
      o.CFBundleName = nom + ' Helper' + suf;
      if ('CFBundleDisplayName' in o) o.CFBundleDisplayName = nom + ' Helper' + suf;
      o.CFBundleExecutable = nom + ' Helper' + suf;
      o.CFBundleIdentifier = id + '.helper';
    });
    if (!app.has(`${H}/Contents/MacOS/${nom} Helper${suf}`)) throw new Error('exécutable du Helper introuvable : ' + H);
  }

  // Ressources : app.asar, icône, PortableMC
  const R = A + '/Contents/Resources';
  app.set(R + '/app.asar', { type: 'fichier', mode: 0o644, donnees: asarApp.donnees });
  app.set(R + '/casteria.icns', { type: 'fichier', mode: 0o644, donnees: fabriquerIcns(path.join(RACINE, 'design', 'icone', 'final')).icns });
  const cle = `darwin-${arch}/portablemc`;
  const officielles = JSON.parse(fs.readFileSync(path.join(RACINE, 'bin', 'empreintes.json'), 'utf8'));
  const pmc = fs.readFileSync(path.join(RACINE, 'bin', `darwin-${arch}`, 'portablemc'));
  const off = officielles.fichiers[cle];
  if (!off || sha256(pmc) !== off.sha256 || pmc.length !== off.taille) throw new Error(cle + ' ne correspond pas à bin/empreintes.json (la chaîne PGP)');
  app.set(R + '/bin/portablemc', { type: 'fichier', mode: 0o755, donnees: pmc });
  app.set(R + '/bin/LICENSE-portablemc.txt', { type: 'fichier', mode: 0o644, donnees: fs.readFileSync(path.join(RACINE, 'bin', 'LICENSE-portablemc.txt')) });
  // L'empreinte du binaire LIVRÉ n'est connue qu'après la signature (rcodesign re-signe tout Mach-O d'un bundle) :
  // signer.sh remplace la marque, puis signe une seconde fois (accord de a7 : sa voie A).
  const empreintesPaquet = {
    portablemc: officielles.portablemc,
    source: officielles.source,
    note: 'Paquet Mac : rcodesign re-signe en ad hoc tout Mach-O du .app. sha256 est celui du binaire livré ; sha256_officiel celui de l\'archive officielle (PGP vérifiée). Seule la signature diffère (preuve segment par segment : verifier_mac.js).',
    fichiers: { [cle]: { sha256: MARQUE_SHA, sha256_officiel: off.sha256, taille_officielle: off.taille } }
  };
  app.set(R + '/bin/empreintes.json', { type: 'fichier', mode: 0o644, donnees: Buffer.from(JSON.stringify(empreintesPaquet, null, 2) + '\n', 'utf8') });

  completerDossiers(app);
  // Droits : chaque Mach-O (64 bits ou « fat ») doit pouvoir s'exécuter ; le zip officiel les donne en 755.
  for (const [k, e] of app) {
    if (e.type === 'fichier' && estMachO(e.donnees) && (e.mode & 0o755) !== 0o755) throw new Error('Mach-O sans droits 755 : ' + k);
  }

  fs.mkdirSync(SORTIE, { recursive: true });
  const base = `${nom}-${version}-mac-${arch}`;
  const tgz = ecrireTarGz(app);
  fs.writeFileSync(path.join(SORTIE, base + '-a-signer.tar.gz'), tgz);
  const attendu = { nom, id, version, arch, electron: electron.version, zipElectron: electron.nom, cle, portablemcOfficiel: off.sha256, asarIntegrite: asarApp.integrite, fichiersApp: asarApp.liste, entrees: {} };
  for (const [k, e] of app) attendu.entrees[k] = e.type === 'lien' ? { lien: e.cible } : e.type === 'dossier' ? { dossier: true } : { mode: e.mode.toString(8), sha256: sha256(e.donnees), taille: e.donnees.length };
  fs.writeFileSync(path.join(SORTIE, base + '.attendu.json'), JSON.stringify(attendu, null, 1));
  const n = { fichier: 0, dossier: 0, lien: 0 };
  for (const e of app.values()) n[e.type]++;
  console.log(`${base}-a-signer.tar.gz : ${(tgz.length / 1e6).toFixed(1)} Mo, ${n.fichier} fichiers, ${n.dossier} dossiers, ${n.lien} liens ; app.asar ${asarApp.liste.length} fichiers ; Helpers ${suffixes.map(s => '« ' + nom + ' Helper' + s + ' »').join(', ')}`);
  return base;
}

async function principal() {
  const i = process.argv.indexOf('--arch');
  const choix = i > 0 ? process.argv[i + 1] : 'tous';
  const archs = choix === 'tous' ? ['arm64', 'x64'] : [choix];
  for (const a of archs) {
    if (!['arm64', 'x64'].includes(a)) throw new Error('--arch arm64, x64 ou tous');
    await assembler(a);
  }
  fs.rmSync(path.join(SORTIE, 'tmp'), { recursive: true, force: true });
}

if (require.main === module) principal().catch(e => { console.error('ÉCHEC : ' + e.message); process.exit(1); });

module.exports = { fichiersDeLApp, globVersRegex, paquetNettoye };
