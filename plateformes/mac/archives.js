'use strict';
// Les archives du paquet Mac, lues et écrites en mémoire, AVEC les liens symboliques et les droits Unix (2e, 25/09/2026).
// Windows ne sait pas créer les liens d'un .app (Electron Framework.framework/Versions/Current -> A...) sans le mode
// développeur : on ne les pose donc jamais sur le disque de Windows. Un arbre est une Map chemin -> entrée :
//   { type: 'fichier', mode: 0o644, donnees: Buffer }   { type: 'lien', cible: 'Versions/Current/...' }   { type: 'dossier', mode: 0o755 }
// Les chemins sont en « / », sans « / » final.
const zlib = require('zlib');

// ---------- zip : lecture (répertoire central, sans zip64 : on refuse une archive qui en aurait besoin) ----------

function lireZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error('zip : fin du répertoire central introuvable');
  const nombre = buf.readUInt16LE(fin + 10);
  const debut = buf.readUInt32LE(fin + 16);
  if (nombre === 0xffff || debut === 0xffffffff) throw new Error('zip64 non géré');
  const arbre = new Map();
  let o = debut;
  for (let n = 0; n < nombre; n++) {
    if (buf.readUInt32LE(o) !== 0x02014b50) throw new Error('zip : entrée centrale abîmée à ' + o);
    const faitPar = buf.readUInt16LE(o + 4) >> 8;
    const methode = buf.readUInt16LE(o + 10);
    const taillec = buf.readUInt32LE(o + 20);
    const taille = buf.readUInt32LE(o + 24);
    const ln = buf.readUInt16LE(o + 28), le = buf.readUInt16LE(o + 30), lc = buf.readUInt16LE(o + 32);
    const attrs = buf.readUInt32LE(o + 38);
    const local = buf.readUInt32LE(o + 42);
    const nom = buf.toString('utf8', o + 46, o + 46 + ln);
    o += 46 + ln + le + lc;
    if (taillec === 0xffffffff || taille === 0xffffffff || local === 0xffffffff) throw new Error('zip64 non géré : ' + nom);
    const unix = faitPar === 3 ? (attrs >>> 16) : 0;
    const lnl = buf.readUInt16LE(local + 26), lel = buf.readUInt16LE(local + 28);
    const brut = buf.subarray(local + 30 + lnl + lel, local + 30 + lnl + lel + taillec);
    const donnees = () => {
      const d = methode === 0 ? Buffer.from(brut) : methode === 8 ? zlib.inflateRawSync(brut) : null;
      if (!d) throw new Error('zip : méthode ' + methode + ' non gérée (' + nom + ')');
      if (d.length !== taille) throw new Error('zip : taille fausse pour ' + nom);
      return d;
    };
    const chemin = nom.replace(/\/+$/, '');
    if (!chemin) continue;
    const typeUnix = unix & 0o170000;
    if (nom.endsWith('/') || typeUnix === 0o040000) arbre.set(chemin, { type: 'dossier', mode: (unix & 0o7777) || 0o755 });
    else if (typeUnix === 0o120000) arbre.set(chemin, { type: 'lien', cible: donnees().toString('utf8') });
    else arbre.set(chemin, { type: 'fichier', mode: (unix & 0o7777) || 0o644, donnees: donnees() });
  }
  return arbre;
}

// ---------- zip : écriture, « fait par Unix », droits et liens dans les attributs externes ----------

const TABLE_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(b) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = TABLE_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Un zip lisible par l'Utilitaire d'archive de macOS : dossiers d'abord, liens stockés tels quels (leur cible). */
function ecrireZip(arbre) {
  const morceaux = [];
  const central = [];
  let o = 0;
  const dateDos = (0 << 11) | (0 << 5) | 0;      // 00:00:00
  const jourDos = ((2026 - 1980) << 9) | (9 << 5) | 25;  // 25/09/2026 : des octets identiques d'une fabrication à l'autre
  for (const chemin of trier(arbre)) {
    const e = arbre.get(chemin);
    let nom = chemin, donnees, mode, methode = 0;
    if (e.type === 'dossier') { nom += '/'; donnees = Buffer.alloc(0); mode = 0o040000 | (e.mode || 0o755); }
    else if (e.type === 'lien') { donnees = Buffer.from(e.cible, 'utf8'); mode = 0o120000 | 0o755; }
    else { donnees = e.donnees; mode = 0o100000 | e.mode; }
    const crc = crc32(donnees);
    let stocke = donnees;
    if (e.type === 'fichier' && donnees.length > 64) {
      const d = zlib.deflateRawSync(donnees, { level: 9 });
      if (d.length < donnees.length) { stocke = d; methode = 8; }
    }
    const nomB = Buffer.from(nom, 'utf8');
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(methode, 8);
    l.writeUInt16LE(dateDos, 10); l.writeUInt16LE(jourDos, 12); l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(stocke.length, 18); l.writeUInt32LE(donnees.length, 22); l.writeUInt16LE(nomB.length, 26); l.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE((3 << 8) | 30, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(methode, 10); c.writeUInt16LE(dateDos, 12); c.writeUInt16LE(jourDos, 14); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(stocke.length, 20); c.writeUInt32LE(donnees.length, 24); c.writeUInt16LE(nomB.length, 28);
    c.writeUInt32LE(((mode << 16) | (e.type === 'dossier' ? 0x10 : 0)) >>> 0, 38); c.writeUInt32LE(o, 42);
    if (o + 30 + nomB.length + stocke.length > 0xffffffff) throw new Error('zip : plus de 4 Go, zip64 non géré');
    morceaux.push(l, nomB, stocke);
    central.push(c, nomB);
    o += 30 + nomB.length + stocke.length;
  }
  const rep = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(arbre.size, 8); fin.writeUInt16LE(arbre.size, 10);
  fin.writeUInt32LE(rep.length, 12); fin.writeUInt32LE(o, 16);
  if (arbre.size > 0xffff) throw new Error('zip : trop d\'entrées, zip64 non géré');
  return Buffer.concat([...morceaux, rep, fin]);
}

// ---------- tar (ustar, avec l'en-tête PAX pour les noms longs), gzip ----------

function octal(n, longueur) { return n.toString(8).padStart(longueur - 1, '0') + '\0'; }

function enTete(nom, taille, mode, type, cible) {
  const h = Buffer.alloc(512);
  let prefixe = '';
  let court = nom;
  if (Buffer.byteLength(nom) > 100) {
    const i = nom.lastIndexOf('/', 154);
    if (i > 0 && Buffer.byteLength(nom.slice(i + 1)) <= 100 && Buffer.byteLength(nom.slice(0, i)) <= 155) { prefixe = nom.slice(0, i); court = nom.slice(i + 1); }
    else return null;
  }
  if (cible && Buffer.byteLength(cible) > 100) return null;
  h.write(court, 0, 100, 'utf8');
  h.write(octal(mode, 8), 100, 'ascii');
  h.write(octal(0, 8), 108, 'ascii');
  h.write(octal(0, 8), 116, 'ascii');
  h.write(octal(taille, 12), 124, 'ascii');
  h.write(octal(Math.floor(Date.UTC(2026, 8, 25) / 1000), 12), 136, 'ascii');
  h.write('        ', 148, 'ascii');
  h.write(type, 156, 'ascii');
  if (cible) h.write(cible, 157, 100, 'utf8');
  h.write('ustar\0', 257, 'ascii');
  h.write('00', 263, 'ascii');
  h.write(prefixe, 345, 155, 'utf8');
  let somme = 0;
  for (let i = 0; i < 512; i++) somme += h[i];
  h.write(octal(somme, 7) + ' ', 148, 'ascii');
  return h;
}

function pax(nom, cible) {
  const champs = [];
  const ligne = (k, v) => {
    const corps = ' ' + k + '=' + v + '\n';
    let n = Buffer.byteLength(corps) + 1;
    while (String(n).length + Buffer.byteLength(corps) !== n) n = String(n).length + Buffer.byteLength(corps);
    return n + corps;
  };
  champs.push(ligne('path', nom));
  if (cible) champs.push(ligne('linkpath', cible));
  const d = Buffer.from(champs.join(''), 'utf8');
  return [enTete('PaxHeader', d.length, 0o644, 'x', ''), d, Buffer.alloc((512 - (d.length % 512)) % 512)];
}

function ecrireTarGz(arbre) {
  const morceaux = [];
  for (const chemin of trier(arbre)) {
    const e = arbre.get(chemin);
    const nom = e.type === 'dossier' ? chemin + '/' : chemin;
    const type = e.type === 'dossier' ? '5' : e.type === 'lien' ? '2' : '0';
    const mode = e.type === 'lien' ? 0o755 : e.mode;
    const donnees = e.type === 'fichier' ? e.donnees : Buffer.alloc(0);
    let h = enTete(nom, donnees.length, mode, type, e.type === 'lien' ? e.cible : '');
    if (!h) { morceaux.push(...pax(nom, e.type === 'lien' ? e.cible : '')); h = enTete(nom.slice(-99).replace(/^[^/]*\//, ''), donnees.length, mode, type, e.type === 'lien' ? e.cible.slice(0, 99) : ''); }
    morceaux.push(h, donnees, Buffer.alloc((512 - (donnees.length % 512)) % 512));
  }
  morceaux.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(morceaux), { level: 6 });
}

function lireTarGz(buf) {
  const t = zlib.gunzipSync(buf);
  const arbre = new Map();
  let o = 0;
  let paxNom = null, paxCible = null, longNom = null, longCible = null;
  while (o + 512 <= t.length) {
    const h = t.subarray(o, o + 512);
    if (h.every(x => x === 0)) break;
    const champ = (a, b) => h.toString('utf8', a, b).replace(/\0.*$/s, '');
    const taille = parseInt(champ(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const donnees = t.subarray(o + 512, o + 512 + taille);
    o += 512 + Math.ceil(taille / 512) * 512;
    if (type === 'x') {
      for (const l of donnees.toString('utf8').split('\n')) {
        const m = /^\d+ ([^=]+)=(.*)$/.exec(l);
        if (m && m[1] === 'path') paxNom = m[2];
        if (m && m[1] === 'linkpath') paxCible = m[2];
      }
      continue;
    }
    if (type === 'g') continue;
    if (type === 'L') { longNom = donnees.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === 'K') { longCible = donnees.toString('utf8').replace(/\0.*$/s, ''); continue; }
    const prefixe = champ(345, 500);
    let nom = paxNom || longNom || (prefixe ? prefixe + '/' : '') + champ(0, 100);
    const cible = paxCible || longCible || champ(157, 257);
    paxNom = paxCible = longNom = longCible = null;
    nom = nom.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!nom || nom === '.') continue;
    const mode = parseInt(champ(100, 108).trim() || '0', 8) & 0o7777;
    if (type === '5') arbre.set(nom, { type: 'dossier', mode });
    else if (type === '2') arbre.set(nom, { type: 'lien', cible });
    else if (type === '0' || type === '\0' || type === '7') arbre.set(nom, { type: 'fichier', mode, donnees: Buffer.from(donnees) });
    else throw new Error('tar : type « ' + type + ' » non géré (' + nom + ')');
  }
  return arbre;
}

/** Les chemins dans un ordre stable : chaque dossier avant son contenu. */
function trier(arbre) {
  return [...arbre.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Ajoute les dossiers parents manquants (un zip ou un tar peut ne pas les lister). */
function completerDossiers(arbre) {
  for (const chemin of [...arbre.keys()]) {
    const parts = chemin.split('/');
    for (let i = 1; i < parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      if (!arbre.has(p)) arbre.set(p, { type: 'dossier', mode: 0o755 });
    }
  }
  return arbre;
}

module.exports = { lireZip, ecrireZip, ecrireTarGz, lireTarGz, completerDossiers, trier, crc32 };
