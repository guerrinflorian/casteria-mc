'use strict';
// Le paquet .tar.gz du launcher pour Linux (serveurmc-14, 25/09/2026) : la roue de secours de l'AppImage.
// electron-builder, lancé depuis Windows, écrit un .tar.gz où tout est en 0644 (casteria, chrome-sandbox,
// PortableMC ne se lancent plus). Ce script écrit l'archive lui-même (format ustar), avec les droits posés à la main :
// dossiers 0755, fichiers 0644, et 0755 pour tout binaire ELF (repéré par ses 4 premiers octets) et les scripts .sh.
// Puis il RELIT l'archive écrite et vérifie chaque droit, et l'empreinte de PortableMC.
//
//   node plateformes/linux/faire_targz.js            (depuis CasteriaLauncher)
//   node plateformes/linux/faire_targz.js --verifier (relit seulement)
//
// Entrée : plateformes/linux/sortie/linux-unpacked (electron-builder --linux dir, config electron-builder-linux.json),
// plateformes/linux/targz (lancer-casteria.sh, installer.sh, LISEZMOI.txt), les icônes à toutes les tailles (icones/).
// Sortie : plateformes/linux/sortie/Casteria-Linux-x86_64.tar.gz, un seul dossier Casteria-Linux-x86_64/ dedans.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const ICI = __dirname;
const DEPLIE = path.join(ICI, 'sortie', 'linux-unpacked');
const SORTIE = path.join(ICI, 'sortie', 'Casteria-Linux-x86_64.tar.gz');
const RACINE = 'Casteria-Linux-x86_64';
const EMPREINTES = path.join(ICI, '..', '..', 'bin', 'empreintes.json');
const MTIME = Math.floor(Date.now() / 1000);

function estElf(chemin) {
  const fd = fs.openSync(chemin, 'r');
  try {
    const b = Buffer.alloc(4);
    return fs.readSync(fd, b, 0, 4, 0) === 4 && b[0] === 0x7f && b.toString('latin1', 1, 4) === 'ELF';
  } finally { fs.closeSync(fd); }
}

// La liste des entrées : { nom (dans l'archive), source (sur le disque, null pour un dossier), mode }.
function entrees() {
  const liste = [{ nom: RACINE + '/', source: null, mode: 0o755 }];
  function parcourir(dossier, prefixe) {
    const noms = fs.readdirSync(dossier).sort();
    for (const n of noms) {
      const c = path.join(dossier, n);
      const st = fs.lstatSync(c);
      if (st.isSymbolicLink()) throw new Error('lien symbolique inattendu : ' + c);
      if (st.isDirectory()) {
        liste.push({ nom: prefixe + n + '/', source: null, mode: 0o755 });
        parcourir(c, prefixe + n + '/');
      } else {
        liste.push({ nom: prefixe + n, source: c, mode: estElf(c) || n.endsWith('.sh') ? 0o755 : 0o644 });
      }
    }
  }
  parcourir(DEPLIE, RACINE + '/');
  for (const n of ['installer.sh', 'lancer-casteria.sh', 'LISEZMOI.txt']) {
    liste.push({ nom: RACINE + '/' + n, source: path.join(ICI, 'targz', n), mode: n.endsWith('.sh') ? 0o755 : 0o644 });
  }
  // Les icônes, que installer.sh pose dans le thème d'icônes du joueur.
  liste.push({ nom: RACINE + '/icones/', source: null, mode: 0o755 });
  for (const n of fs.readdirSync(path.join(ICI, 'icones')).filter(x => x.endsWith('.png')).sort()) {
    liste.push({ nom: RACINE + '/icones/' + n, source: path.join(ICI, 'icones', n), mode: 0o644 });
  }
  return liste;
}

function octal(n, largeur) { return n.toString(8).padStart(largeur - 1, '0') + '\0'; }

function entete(nom, taille, mode, estDossier) {
  const h = Buffer.alloc(512, 0);
  let nomCourt = nom;
  let prefixe = '';
  if (Buffer.byteLength(nom) > 100) {
    const coupe = nom.lastIndexOf('/', nom.length - 2);
    prefixe = nom.slice(0, coupe);
    nomCourt = nom.slice(coupe + 1);
    if (Buffer.byteLength(nomCourt) > 100 || Buffer.byteLength(prefixe) > 155) throw new Error('nom trop long : ' + nom);
  }
  h.write(nomCourt, 0, 100, 'utf8');
  h.write(octal(mode, 8), 100, 8, 'latin1');
  h.write(octal(0, 8), 108, 8, 'latin1');
  h.write(octal(0, 8), 116, 8, 'latin1');
  h.write(octal(taille, 12), 124, 12, 'latin1');
  h.write(octal(MTIME, 12), 136, 12, 'latin1');
  h.write('        ', 148, 8, 'latin1');
  h.write(estDossier ? '5' : '0', 156, 1, 'latin1');
  h.write('ustar\0', 257, 6, 'latin1');
  h.write('00', 263, 2, 'latin1');
  h.write(prefixe, 345, 155, 'utf8');
  let somme = 0;
  for (let i = 0; i < 512; i++) somme += h[i];
  h.write(somme.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
  return h;
}

async function* blocs(liste) {
  for (const e of liste) {
    if (!e.source) { yield entete(e.nom, 0, e.mode, true); continue; }
    const taille = fs.statSync(e.source).size;
    yield entete(e.nom, taille, e.mode, false);
    for await (const morceau of fs.createReadStream(e.source, { highWaterMark: 1 << 20 })) yield morceau;
    const reste = taille % 512;
    if (reste) yield Buffer.alloc(512 - reste, 0);
  }
  yield Buffer.alloc(1024, 0);
}

// Relit l'archive : chaque en-tête (somme de contrôle), chaque droit, et l'empreinte de PortableMC.
function verifier(attendu) {
  const tar = zlib.gunzipSync(fs.readFileSync(SORTIE));
  const lus = new Map();
  let pos = 0;
  let pmc = null;
  while (pos + 512 <= tar.length) {
    const h = tar.subarray(pos, pos + 512);
    if (h.every(o => o === 0)) break;
    const stocke = parseInt(h.toString('latin1', 148, 156).replace(/\0.*$/s, '').trim(), 8);
    let somme = 0;
    for (let i = 0; i < 512; i++) somme += (i >= 148 && i < 156) ? 32 : h[i];
    if (somme !== stocke) throw new Error('somme de contrôle fausse à ' + pos);
    const cz = (d, f) => h.toString('utf8', d, f).replace(/\0.*$/s, '');
    const prefixe = cz(345, 500);
    const nom = (prefixe ? prefixe + '/' : '') + cz(0, 100);
    const mode = parseInt(cz(100, 108), 8);
    const taille = parseInt(cz(124, 136), 8);
    const type = h.toString('latin1', 156, 157);
    const corps = tar.subarray(pos + 512, pos + 512 + taille);
    if (nom === RACINE + '/resources/bin/portablemc') pmc = crypto.createHash('sha256').update(corps).digest('hex');
    const elf = type === '0' && taille >= 4 && corps[0] === 0x7f && corps.toString('latin1', 1, 4) === 'ELF';
    lus.set(nom, { mode, taille, type, elf });
    pos += 512 + Math.ceil(taille / 512) * 512;
  }
  const fautes = [];
  if (attendu) {
    for (const e of attendu) {
      const l = lus.get(e.nom);
      if (!l) fautes.push('absent : ' + e.nom);
      else if (l.mode !== e.mode) fautes.push('droits ' + l.mode.toString(8) + ' au lieu de ' + e.mode.toString(8) + ' : ' + e.nom);
    }
    if (lus.size !== attendu.length) fautes.push(lus.size + ' entrées lues pour ' + attendu.length + ' écrites');
  }
  for (const [nom, l] of lus) {
    if (l.elf && l.mode !== 0o755) fautes.push('binaire non exécutable : ' + nom);
    if (!nom.startsWith(RACINE + '/')) fautes.push('hors du dossier : ' + nom);
  }
  const doivent = ['casteria', 'chrome-sandbox', 'chrome_crashpad_handler', 'resources/bin/portablemc', 'lancer-casteria.sh', 'installer.sh'];
  for (const n of doivent) {
    const l = lus.get(RACINE + '/' + n);
    if (!l || l.mode !== 0o755) fautes.push('doit être en 0755 : ' + n);
  }
  let attenduPmc = null;
  try { attenduPmc = JSON.parse(fs.readFileSync(EMPREINTES, 'utf8')).fichiers['linux-x64/portablemc'].sha256; } catch (e) { /* liste absente */ }
  if (!attenduPmc) fautes.push('empreinte attendue de PortableMC introuvable dans bin/empreintes.json');
  else if (pmc !== attenduPmc) fautes.push('PortableMC : empreinte ' + pmc + ' au lieu de ' + attenduPmc);
  const executables = [...lus].filter(([, l]) => l.mode === 0o755 && l.type === '0').map(([n]) => n.slice(RACINE.length + 1));
  console.log('Relu : ' + lus.size + ' entrées, ' + (tar.length / 1048576).toFixed(1) + ' Mo sans compression.');
  console.log('En 0755 : ' + executables.join(', '));
  console.log('PortableMC : ' + pmc);
  if (fautes.length) { console.log('FAUTES (' + fautes.length + ') :\n  ' + fautes.join('\n  ')); process.exitCode = 1; }
  else console.log('0 faute : droits, sommes de contrôle et empreinte de PortableMC bons.');
}

async function principal() {
  if (process.argv.includes('--verifier')) { verifier(null); return; }
  if (!fs.existsSync(path.join(DEPLIE, 'casteria'))) throw new Error('pas d\'application dépliée dans ' + DEPLIE);
  const liste = entrees();
  await pipeline(Readable.from(blocs(liste)), zlib.createGzip({ level: 9 }), fs.createWriteStream(SORTIE));
  const st = fs.statSync(SORTIE);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(SORTIE)).digest('hex');
  // L'empreinte à côté du paquet (format de sha256sum), que a7 publie avec lui.
  fs.writeFileSync(SORTIE + '.sha256', sha + '  ' + path.basename(SORTIE) + '\n');
  console.log('Écrit : ' + SORTIE + ' (' + (st.size / 1048576).toFixed(1) + ' Mo, sha256 ' + sha + ', et son .sha256)');
  verifier(liste);
}

principal().catch(e => { console.error('ÉCHEC : ' + e.message); process.exitCode = 1; });
