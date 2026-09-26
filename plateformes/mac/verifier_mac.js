'use strict';
// LE PAQUET MAC DU LAUNCHER, étape 3 sur 3 : vérifier la signature SANS Mac, puis écrire le zip final (serveurmc-2e,
// 25/09/2026).   node plateformes/mac/verifier_mac.js [--arch arm64|x64|tous]
// rcodesign le dit lui-même : sa commande « verify » n'est pas fiable. On refait donc les contrôles ici, à la main :
//   1. le .app signé contre ce que l'assemblage attendait (attendu.json) : seuls les Mach-O, les _CodeSignature et
//      empreintes.json ont le droit de changer ; liens, dossiers et droits identiques ;
//   2. chaque Mach-O : sa signature ad hoc relue (CodeDirectory), chaque page de code re-hachée, ses cases spéciales ;
//   3. chaque bundle (l'app, les 4 Helpers, les 4 frameworks) : son Info.plist et son CodeResources liés à son
//      exécutable, chaque fichier scellé re-haché, chaque code imbriqué retrouvé par son cdhash, rien de non scellé ;
//   4. portablemc : la preuve que seule la signature a changé (segments identiques octet pour octet), et
//      empreintes.json du paquet qui donne le sha256 du binaire livré ;
//   5. l'Info.plist, l'icône, ElectronAsarIntegrity, les Helpers, les liens des frameworks ;
//   6. le zip final (liens et droits Unix dans les attributs), relu entrée par entrée contre le .app signé.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { lireTarGz, ecrireZip, lireZip } = require('./archives');
const { lireIcns } = require('./icns');

const RACINE = path.resolve(__dirname, '..', '..');
const SORTIE = path.join(__dirname, 'sortie');
const plist = require(path.join(RACINE, 'node_modules', 'plist'));
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const estMachO = b => b.length >= 4 && (b.readUInt32LE(0) === 0xfeedfacf || b.readUInt32BE(0) === 0xcafebabe);

let echecs = [];
let controles = 0;
function verifier(ok, quoi) { controles++; if (!ok) echecs.push(quoi); return ok; }

// ---------- Mach-O et signature de code ----------

function lireMachO(buf, quoi) {
  if (buf.readUInt32BE(0) === 0xcafebabe) throw new Error(quoi + ' : binaire « fat », non géré ici');
  if (buf.readUInt32LE(0) !== 0xfeedfacf) throw new Error(quoi + ' : pas un Mach-O 64 bits');
  const ncmds = buf.readUInt32LE(16);
  const segments = [];
  let sig = null;
  let o = 32;
  const commandes = [];
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(o), taille = buf.readUInt32LE(o + 4);
    commandes.push(cmd);
    if (cmd === 0x19) segments.push({ nom: buf.toString('ascii', o + 8, o + 24).replace(/\0+$/, ''), fileoff: Number(buf.readBigUInt64LE(o + 40)), filesize: Number(buf.readBigUInt64LE(o + 48)) });
    if (cmd === 0x1d) sig = { dataoff: buf.readUInt32LE(o + 8), datasize: buf.readUInt32LE(o + 12) };
    o += taille;
  }
  return { cputype: buf.readUInt32LE(4), segments, sig, commandes };
}

/** La signature d'un Mach-O : { cd, cdhash, identifiant, drapeaux, speciales: {n: hex}, blobs } ; vérifie les pages. */
function lireSignature(buf, quoi) {
  const m = lireMachO(buf, quoi);
  if (!m.sig) return null;
  const sb = buf.subarray(m.sig.dataoff, m.sig.dataoff + m.sig.datasize);
  if (sb.readUInt32BE(0) !== 0xfade0cc0) throw new Error(quoi + ' : superblob de signature abîmé');
  const n = sb.readUInt32BE(8);
  const blobs = {};
  for (let i = 0; i < n; i++) {
    const type = sb.readUInt32BE(12 + i * 8), off = sb.readUInt32BE(16 + i * 8);
    blobs[type] = sb.subarray(off, off + sb.readUInt32BE(off + 4));
  }
  const cd = blobs[0];
  if (!cd || cd.readUInt32BE(0) !== 0xfade0c02) throw new Error(quoi + ' : pas de CodeDirectory');
  const version = cd.readUInt32BE(8), drapeaux = cd.readUInt32BE(12), hashOffset = cd.readUInt32BE(16), identOffset = cd.readUInt32BE(20);
  const nSpeciales = cd.readUInt32BE(24), nCode = cd.readUInt32BE(28);
  let codeLimit = cd.readUInt32BE(32);
  const hashSize = cd[36], hashType = cd[37], pageSize = 1 << cd[39];
  if (version >= 0x20300 && codeLimit === 0) codeLimit = Number(cd.readBigUInt64BE(56));
  const algo = hashType === 2 ? 'sha256' : hashType === 1 ? 'sha1' : null;
  if (!algo) throw new Error(quoi + ' : type d\'empreinte ' + hashType + ' non géré');
  const h = b => crypto.createHash(algo).update(b).digest().subarray(0, hashSize);
  let pagesFausses = 0;
  for (let i = 0; i < nCode; i++) {
    const page = buf.subarray(i * pageSize, Math.min((i + 1) * pageSize, codeLimit));
    if (!h(page).equals(cd.subarray(hashOffset + i * hashSize, hashOffset + (i + 1) * hashSize))) pagesFausses++;
  }
  const speciales = {};
  for (let k = 1; k <= nSpeciales; k++) speciales[k] = cd.subarray(hashOffset - k * hashSize, hashOffset - (k - 1) * hashSize).toString('hex');
  const identifiant = cd.toString('utf8', identOffset, cd.indexOf(0, identOffset));
  const couvert = nCode * pageSize >= codeLimit && (nCode - 1) * pageSize < codeLimit && codeLimit === m.sig.dataoff;
  return {
    algo, hashSize, drapeaux, identifiant, nCode, pagesFausses, couvert, speciales, blobs,
    cdhash: crypto.createHash(algo).update(cd).digest().subarray(0, 20).toString('hex'),
    exigences: blobs[2] ? h(blobs[2]).toString('hex') : null,
    hSpecial: b => h(b).toString('hex'),
  };
}

// ---------- les bundles et leur CodeResources ----------

/** Les bundles à contrôler : l'app, ses Helpers (.app dans Frameworks), ses frameworks (racine Versions/A). */
function bundles(arbre, A) {
  const r = [{ racine: A + '/Contents', exe: null, plist: A + '/Contents/Info.plist', nom: A }];
  for (const k of arbre.keys()) {
    let m = /^[^/]+\/Contents\/Frameworks\/([^/]+)\.app$/.exec(k);
    if (m) r.push({ racine: k + '/Contents', exe: null, plist: k + '/Contents/Info.plist', nom: m[1] + '.app' });
    m = /^[^/]+\/Contents\/Frameworks\/([^/]+)\.framework$/.exec(k);
    if (m) r.push({ racine: k + '/Versions/A', exe: k + '/Versions/A/' + m[1], plist: k + '/Versions/A/Resources/Info.plist', nom: m[1] + '.framework', framework: k });
  }
  for (const b of r) {
    if (!b.exe) {
      const p = plist.parse(arbre.get(b.plist).donnees.toString('utf8'));
      b.exe = b.racine + '/MacOS/' + p.CFBundleExecutable;
    }
  }
  return r;
}

function controlerBundle(arbre, b, tous) {
  const exe = arbre.get(b.exe);
  if (!verifier(exe && exe.type === 'fichier', b.nom + ' : exécutable principal présent (' + b.exe + ')')) return;
  const s = lireSignature(exe.donnees, b.exe);
  const cr = arbre.get(b.racine + '/_CodeSignature/CodeResources');
  if (!verifier(s && cr, b.nom + ' : signé, avec un CodeResources')) return;
  verifier(s.speciales[1] === s.hSpecial(arbre.get(b.plist).donnees), b.nom + ' : l\'Info.plist est bien celui que la signature scelle (case -1)');
  verifier(s.speciales[3] === s.hSpecial(cr.donnees), b.nom + ' : le CodeResources est bien celui que la signature scelle (case -3)');
  const res = plist.parse(cr.donnees.toString('utf8'));
  const f2 = res.files2 || {};
  let scelles = 0, imbriques = 0, liens = 0;
  const couverts = new Set();
  for (const [rel, v] of Object.entries(f2)) {
    const chemin = b.racine + '/' + rel;
    const e = arbre.get(chemin);
    if (v.symlink !== undefined) { liens++; verifier(e && e.type === 'lien' && e.cible === v.symlink, b.nom + ' : lien scellé ' + rel); couverts.add(chemin); continue; }
    if (v.cdhash) {
      imbriques++;
      let cible = chemin;
      const sous = tous.find(x => x.racine === chemin + '/Contents' || x.framework === chemin);
      if (sous) cible = sous.exe;
      const eb = arbre.get(cible);
      const sn = eb && eb.type === 'fichier' ? lireSignature(eb.donnees, cible) : null;
      verifier(sn && sn.cdhash === Buffer.from(v.cdhash).toString('hex'), b.nom + ' : code imbriqué ' + rel + ' retrouvé par son cdhash');
      couverts.add(chemin);
      continue;
    }
    const attendu = v.hash2 ? Buffer.from(v.hash2).toString('hex') : Buffer.isBuffer(v) ? null : null;
    if (!e || e.type !== 'fichier') { verifier(v.optional === true, b.nom + ' : fichier scellé présent ' + rel); continue; }
    verifier(attendu && attendu === sha256(e.donnees), b.nom + ' : fichier scellé intact ' + rel);
    scelles++;
    couverts.add(chemin);
  }
  // Rien de non scellé : chaque fichier ou lien sous la racine est scellé, dans un code imbriqué, ou est la signature,
  // l'exécutable principal ou l'Info.plist (scellés par les cases spéciales).
  // Les règles rules2 du CodeResources : pour chaque chemin, la règle de plus fort poids qui s'y applique décide ;
  // « omit » écarte le fichier du sceau exprès (Apple : Info.plist, PkgInfo, .DS_Store...).
  const regles = Object.entries(res.rules2 || {}).map(([motif, v]) => ({ re: new RegExp(motif), omit: v && v.omit === true, poids: (v && v.weight) || 1 }));
  const omis = rel => {
    let meilleure = null;
    for (const r of regles) if (r.re.test(rel) && (!meilleure || r.poids > meilleure.poids)) meilleure = r;
    return !!(meilleure && meilleure.omit);
  };
  const imbriquesRacines = [...couverts].filter(c => tous.some(x => x.racine === c + '/Contents' || x.framework === c));
  const nonScelles = [];
  let nOmis = 0;
  for (const [k, e] of arbre) {
    if (e.type === 'dossier' || !k.startsWith(b.racine + '/')) continue;
    if (k === b.exe || k === b.plist || k.startsWith(b.racine + '/_CodeSignature/') || couverts.has(k)) continue;
    if (imbriquesRacines.some(c => k.startsWith(c + '/'))) continue;
    if (omis(k.slice(b.racine.length + 1))) { nOmis++; continue; }
    nonScelles.push(k.slice(b.racine.length + 1));
  }
  verifier(nonScelles.length === 0, b.nom + ' : aucun fichier non scellé' + (nonScelles.length ? ' (' + nonScelles.slice(0, 5).join(', ') + (nonScelles.length > 5 ? '...' : '') + ')' : ''));
  return { nom: b.nom, identifiant: s.identifiant, drapeaux: s.drapeaux, scelles, imbriques, liens, omis: nOmis };
}

// ---------- la preuve pour portablemc ----------

/**
 * La preuve que rcodesign n'a changé que la signature de portablemc. Un Mach-O signé de nouveau ne peut différer que :
 *   - dans l'en-tête : ncmds et sizeofcmds, si une commande LC_CODE_SIGNATURE est ajoutée (l'officiel x64 n'en a pas) ;
 *   - dans la commande du segment __LINKEDIT : vmsize et filesize (la signature est au bout de ce segment) ;
 *   - dans LC_CODE_SIGNATURE elle-même, et dans les octets de la signature, à la fin du fichier.
 * Tout le reste doit être identique octet pour octet : l'en-tête (hors ces deux champs), chaque autre commande de
 * chargement, puis tout le fichier depuis la fin des commandes jusqu'à l'ancienne signature (ou l'ancienne fin du
 * fichier) : le code (__TEXT), les données (__DATA...) et le début de __LINKEDIT.
 */
function prouverPortablemc(officiel, livre) {
  const lignes = [];
  let ok = true;
  const note = (bon, texte) => { lignes.push(texte + (bon ? '' : ' : DIFFÉRENT')); ok = ok && bon; };
  // l'en-tête (32 octets), sans ncmds (16) ni sizeofcmds (20)
  const entete = b => Buffer.concat([b.subarray(0, 16), b.subarray(24, 32)]);
  note(entete(officiel).equals(entete(livre)), 'en-tête Mach-O identique (hors ncmds et sizeofcmds)');
  const commandes = b => {
    const n = b.readUInt32LE(16), r = [];
    let o = 32;
    for (let i = 0; i < n; i++) { const t = b.readUInt32LE(o + 4); r.push({ cmd: b.readUInt32LE(o), octets: b.subarray(o, o + t) }); o += t; }
    return r;
  };
  const ca = commandes(officiel).filter(c => c.cmd !== 0x1d), cb = commandes(livre).filter(c => c.cmd !== 0x1d);
  let pareilles = ca.length === cb.length;
  for (let i = 0; pareilles && i < ca.length; i++) {
    const x = ca[i].octets, y = cb[i].octets;
    const linkedit = ca[i].cmd === 0x19 && x.toString('ascii', 8, 24).replace(/\0+$/, '') === '__LINKEDIT';
    // __LINKEDIT : tout sauf vmsize (octets 32 à 40) et filesize (octets 48 à 56)
    const masque = z => linkedit ? Buffer.concat([z.subarray(0, 32), z.subarray(40, 48), z.subarray(56)]) : z;
    pareilles = x.length === y.length && masque(x).equals(masque(y));
  }
  note(pareilles, ca.length + ' commandes de chargement identiques (hors LC_CODE_SIGNATURE, et les tailles de __LINKEDIT)');
  const cmdsA = officiel.readUInt32LE(20), cmdsB = livre.readUInt32LE(20);
  // une commande ajoutée doit l'être dans le rembourrage de l'en-tête (des zéros dans l'officiel)
  if (cmdsB > cmdsA) note(officiel.subarray(32 + cmdsA, 32 + cmdsB).every(x => x === 0), 'LC_CODE_SIGNATURE ajoutée dans le rembourrage de l\'en-tête (' + (cmdsB - cmdsA) + ' octets à zéro dans l\'officiel)');
  const a = lireMachO(officiel, 'portablemc officiel');
  const finCode = a.sig ? a.sig.dataoff : officiel.length;
  const debut = 32 + Math.max(cmdsA, cmdsB);
  note(officiel.subarray(debut, finCode).equals(livre.subarray(debut, finCode)), (finCode - debut) + ' octets identiques depuis la fin des commandes jusqu\'à ' + (a.sig ? 'l\'ancienne signature' : 'l\'ancienne fin du fichier') + ' (le code, les données, le début de __LINKEDIT)');
  lignes.push('signature : ' + (a.sig ? a.sig.datasize + ' octets remplacés' : 'ajoutée') + ', fichier ' + officiel.length + ' -> ' + livre.length + ' octets');
  return { ok, lignes };
}

// ---------- l'essentiel ----------

function asarEntete(buf) {
  const taille = buf.readUInt32LE(12);
  return buf.toString('utf8', 16, 16 + taille);
}

function controler(arch) {
  echecs = [];
  controles = 0;
  const fichiers = fs.readdirSync(SORTIE).filter(f => f.endsWith('-mac-' + arch + '.attendu.json'));
  if (fichiers.length !== 1) throw new Error('attendu.json introuvable pour ' + arch + ' (lancer fabriquer_mac.js)');
  const attendu = JSON.parse(fs.readFileSync(path.join(SORTIE, fichiers[0]), 'utf8'));
  const base = fichiers[0].replace('.attendu.json', '');
  const signeF = path.join(SORTIE, base + '-signe.tar.gz');
  if (!fs.existsSync(signeF)) throw new Error(base + '-signe.tar.gz absent (lancer signer.sh dans le conteneur)');
  const S = lireTarGz(fs.readFileSync(signeF));
  const A = attendu.nom + '.app';

  // 1. rien d'autre n'a changé
  let changes = 0;
  for (const [k, e] of Object.entries(attendu.entrees)) {
    const s = S.get(k);
    if (!verifier(!!s, 'présent après signature : ' + k)) continue;
    if (e.lien !== undefined) verifier(s.type === 'lien' && s.cible === e.lien, 'lien intact : ' + k);
    else if (e.dossier) verifier(s.type === 'dossier', 'dossier intact : ' + k);
    else {
      verifier(s.type === 'fichier' && s.mode.toString(8) === e.mode, 'droits intacts (' + e.mode + ') : ' + k);
      if (s.type === 'fichier' && sha256(s.donnees) !== e.sha256) {
        changes++;
        verifier(estMachO(s.donnees) || k.endsWith('/Contents/Resources/bin/empreintes.json'), 'seuls les Mach-O et empreintes.json changent : ' + k);
      }
    }
  }
  for (const k of S.keys()) if (!attendu.entrees[k]) verifier(/\/_CodeSignature(\/CodeResources)?$/.test(k), 'seule la signature s\'ajoute : ' + k);

  // 2. chaque Mach-O : signature ad hoc et pages
  const machos = [...S].filter(([k, e]) => e.type === 'fichier' && estMachO(e.donnees));
  const resumeMachO = [];
  for (const [k, e] of machos) {
    const s = lireSignature(e.donnees, k);
    if (!verifier(!!s, 'signé : ' + k)) continue;
    verifier(s.drapeaux & 0x2, 'signature ad hoc (drapeau 0x2) : ' + k);
    verifier(s.pagesFausses === 0 && s.couvert, 'chaque page re-hachée (' + s.nCode + ' pages) : ' + k);
    if (s.exigences) verifier(s.speciales[2] === s.exigences, 'exigences scellées (case -2) : ' + k);
    verifier((e.mode & 0o755) === 0o755, 'droits 755 : ' + k);
    resumeMachO.push(k.replace(A + '/Contents/', '') + ' : ' + s.identifiant + ', ' + s.algo + ', ' + s.nCode + ' pages');
  }

  // 3. les bundles
  const tous = bundles(S, A);
  const resumeBundles = tous.map(b => controlerBundle(S, b, tous)).filter(Boolean);

  // 4. portablemc
  const cle = attendu.cle;
  const officiel = fs.readFileSync(path.join(RACINE, 'bin', cle));
  const livre = S.get(A + '/Contents/Resources/bin/portablemc').donnees;
  verifier(sha256(officiel) === attendu.portablemcOfficiel, 'portablemc officiel inchangé depuis l\'assemblage');
  const preuve = prouverPortablemc(officiel, livre);
  verifier(preuve.ok, 'portablemc : seule la signature diffère de l\'officiel');
  const emp = JSON.parse(S.get(A + '/Contents/Resources/bin/empreintes.json').donnees.toString('utf8'));
  verifier(emp.fichiers && emp.fichiers[cle] && emp.fichiers[cle].sha256 === sha256(livre), 'empreintes.json du paquet : le sha256 du portablemc livré sous « ' + cle + ' »');
  verifier(emp.fichiers[cle].sha256_officiel === attendu.portablemcOfficiel, 'empreintes.json du paquet : l\'officiel gardé à côté');
  verifier(!JSON.stringify(emp).includes('__SHA256_LIVRE__'), 'empreintes.json du paquet : plus de marque');
  const sPmc = lireSignature(livre, 'portablemc');
  verifier(sPmc && (sPmc.drapeaux & 0x2), 'portablemc livré : signé ad hoc');

  // 5. Info.plist, icône, asar, Helpers, frameworks
  const ip = plist.parse(S.get(A + '/Contents/Info.plist').donnees.toString('utf8'));
  verifier(ip.CFBundleExecutable === attendu.nom && S.get(A + '/Contents/MacOS/' + attendu.nom), 'CFBundleExecutable « ' + ip.CFBundleExecutable + ' » présent dans Contents/MacOS');
  verifier(ip.CFBundleIdentifier === attendu.id, 'CFBundleIdentifier ' + ip.CFBundleIdentifier);
  verifier(ip.CFBundleShortVersionString === attendu.version && ip.CFBundleVersion === attendu.version, 'version ' + ip.CFBundleShortVersionString);
  verifier(ip.CFBundlePackageType === 'APPL', 'CFBundlePackageType APPL');
  const icone = S.get(A + '/Contents/Resources/' + ip.CFBundleIconFile);
  verifier(icone && lireIcns(icone.donnees).length === 10, 'icône ' + ip.CFBundleIconFile + ' lisible (10 images)');
  const asarF = S.get(A + '/Contents/Resources/app.asar');
  verifier(ip.ElectronAsarIntegrity && ip.ElectronAsarIntegrity['Resources/app.asar'].hash === sha256(asarEntete(asarF.donnees)), 'ElectronAsarIntegrity = l\'en-tête de app.asar');
  verifier(!S.has(A + '/Contents/Resources/default_app.asar'), 'plus de default_app.asar');
  for (const suf of ['', ' (GPU)', ' (Renderer)', ' (Plugin)']) {
    const H = `${A}/Contents/Frameworks/${attendu.nom} Helper${suf}.app`;
    const hp = S.get(H + '/Contents/Info.plist');
    const p = hp && plist.parse(hp.donnees.toString('utf8'));
    verifier(p && p.CFBundleExecutable === `${attendu.nom} Helper${suf}` && S.get(`${H}/Contents/MacOS/${attendu.nom} Helper${suf}`), 'Helper « ' + attendu.nom + ' Helper' + suf + ' » cohérent');
  }
  for (const fw of ['Electron Framework', 'Mantle', 'ReactiveObjC', 'Squirrel']) {
    const c = S.get(`${A}/Contents/Frameworks/${fw}.framework/Versions/Current`);
    verifier(c && c.type === 'lien' && c.cible === 'A', fw + '.framework : Versions/Current -> A');
  }

  // 6. le zip final
  const zip = ecrireZip(S);
  const zipF = path.join(SORTIE, base + '.zip');
  fs.writeFileSync(zipF, zip);
  const Z = lireZip(fs.readFileSync(zipF));
  let zipOk = Z.size === S.size;
  for (const [k, e] of S) {
    const z = Z.get(k);
    if (!z || z.type !== e.type) { zipOk = false; break; }
    if (e.type === 'lien' && z.cible !== e.cible) zipOk = false;
    if (e.type === 'fichier' && (z.mode !== e.mode || !z.donnees.equals(e.donnees))) zipOk = false;
  }
  verifier(zipOk, 'zip relu : chaque entrée, chaque droit, chaque lien identiques au .app signé');
  const exeZ = Z.get(A + '/Contents/MacOS/' + attendu.nom);
  verifier(exeZ && exeZ.mode === 0o755, 'zip : l\'exécutable principal garde ses droits 755');
  const shaZip = sha256(zip);
  fs.writeFileSync(zipF + '.sha256', shaZip + '  ' + path.basename(zipF) + '\n');
  // Le nom public, fixe (accord de a7 : comme l'installateur Windows, il ne change plus ; le code se met à jour seul).
  const nomPublic = { arm64: 'Casteria-mac-apple-silicon.zip', x64: 'Casteria-mac-intel.zip' }[arch];
  fs.writeFileSync(path.join(SORTIE, nomPublic), zip);
  fs.writeFileSync(path.join(SORTIE, nomPublic + '.sha256'), shaZip + '  ' + nomPublic + '\n');

  const rapport = {
    paquet: path.basename(zipF), taille: zip.length, sha256: shaZip, controles, echecs,
    machO: resumeMachO.length, bundles: resumeBundles, portablemc: { officiel: attendu.portablemcOfficiel, livre: sha256(livre), preuve: preuve.lignes },
    changesParLaSignature: changes,
  };
  fs.writeFileSync(path.join(SORTIE, base + '.rapport.json'), JSON.stringify(rapport, null, 1));
  console.log(`\n== ${base} : ${echecs.length ? 'ÉCHEC' : 'OK'}, ${controles} contrôles, ${echecs.length} en échec`);
  console.log(`   ${machos.length} Mach-O signés ad hoc et re-hachés page par page ; ${changes} fichiers changés par la signature (les Mach-O et empreintes.json)`);
  for (const b of resumeBundles) console.log(`   ${b.nom} : ${b.identifiant}, ${b.scelles} fichiers scellés, ${b.imbriques} codes imbriqués, ${b.liens} liens, ${b.omis} écartés par les règles (PkgInfo...)`);
  console.log('   portablemc : ' + preuve.lignes.join(' ; '));
  console.log(`   ${path.basename(zipF)} (public : ${nomPublic}) : ${(zip.length / 1e6).toFixed(1)} Mo, sha256 ${shaZip}`);
  for (const e of echecs.slice(0, 30)) console.log('   ÉCHEC : ' + e);
  return echecs.length === 0;
}

if (require.main === module) {
  const i = process.argv.indexOf('--arch');
  const choix = i > 0 ? process.argv[i + 1] : 'tous';
  let ok = true;
  for (const a of choix === 'tous' ? ['arm64', 'x64'] : [choix]) {
    try { ok = controler(a) && ok; } catch (e) { console.error('ÉCHEC ' + a + ' : ' + e.message); ok = false; }
  }
  process.exit(ok ? 0 : 1);
}

module.exports = { lireSignature, lireMachO, prouverPortablemc };
