'use strict';
// L'icône du Mac (casteria.icns) à partir de l'icône finale d'ae, dessinée case par case (design/icone/final, 16 à
// 256 px, voir design/icone/LISEZMOI.md), sans aucun lissage : 512 et 1024 sont le 256 (le dessin de Florian, case pour
// case, x4) agrandi au plus proche voisin (x2, x4). 2e, 25/09/2026.
// Les types ICNS sont ceux qu'écrit iconutil pour un .iconset complet (PNG dans chaque entrée) :
//   icp4 16, ic11 16@2x (32), icp5 32, ic12 32@2x (64), ic07 128, ic13 128@2x (256), ic08 256, ic14 256@2x (512),
//   ic09 512, ic10 512@2x (1024).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { crc32 } = require('./archives');

/** Un PNG RGBA 8 bits sans entrelacement (le format des images de Florian) -> { l, h, px } (px : RGBA). */
function lirePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('pas un PNG');
  let o = 8, l = 0, h = 0, idat = [];
  while (o < buf.length) {
    const n = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + n);
    if (t === 'IHDR') {
      l = d.readUInt32BE(0); h = d.readUInt32BE(4);
      if (d[8] !== 8 || d[9] !== 6 || d[12] !== 0) throw new Error('PNG non géré : il faut du RGBA 8 bits sans entrelacement');
    } else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    o += 12 + n;
  }
  const brut = zlib.inflateSync(Buffer.concat(idat));
  const ligne = l * 4, px = Buffer.alloc(ligne * h);
  for (let y = 0; y < h; y++) {
    const f = brut[y * (ligne + 1)], src = brut.subarray(y * (ligne + 1) + 1, (y + 1) * (ligne + 1));
    for (let x = 0; x < ligne; x++) {
      const a = x >= 4 ? px[y * ligne + x - 4] : 0, b = y > 0 ? px[(y - 1) * ligne + x] : 0, c = x >= 4 && y > 0 ? px[(y - 1) * ligne + x - 4] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error('PNG : filtre ' + f + ' inconnu');
      px[y * ligne + x] = v & 0xff;
    }
  }
  return { l, h, px };
}

function morceau(type, donnees) {
  const t = Buffer.from(type, 'ascii'), n = Buffer.alloc(4), c = Buffer.alloc(4);
  n.writeUInt32BE(donnees.length, 0);
  c.writeUInt32BE(crc32(Buffer.concat([t, donnees])), 0);
  return Buffer.concat([n, t, donnees, c]);
}

function ecrirePng(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.l, 0); ihdr.writeUInt32BE(img.h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const ligne = img.l * 4, brut = Buffer.alloc((ligne + 1) * img.h);
  for (let y = 0; y < img.h; y++) img.px.copy(brut, y * (ligne + 1) + 1, y * ligne, (y + 1) * ligne);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), morceau('IHDR', ihdr),
    morceau('IDAT', zlib.deflateSync(brut, { level: 9 })), morceau('IEND', Buffer.alloc(0))]);
}

/** Agrandi au plus proche voisin, facteur entier. */
function agrandir(img, k) {
  const l = img.l * k, h = img.h * k, px = Buffer.alloc(l * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < l; x++) img.px.copy(px, (y * l + x) * 4, ((Math.floor(y / k)) * img.l + Math.floor(x / k)) * 4, ((Math.floor(y / k)) * img.l + Math.floor(x / k)) * 4 + 4);
  return { l, h, px };
}

/** Le plus petit facteur k tel que l'image soit un agrandissement exact par k (1 si ce n'en est pas un). */
function facteurPixel(img) {
  for (const k of [16, 8, 4, 2]) {
    if (img.l % k) continue;
    let ok = true;
    for (let y = 0; y < img.h && ok; y++) for (let x = 0; x < img.l && ok; x++) {
      const a = (y * img.l + x) * 4, b = (Math.floor(y / k) * k * img.l + Math.floor(x / k) * k) * 4;
      if (img.px.readUInt32BE(a) !== img.px.readUInt32BE(b)) ok = false;
    }
    if (ok) return k;
  }
  return 1;
}

/** Fabrique le .icns ; rend { icns, rapport }. */
function fabriquerIcns(dossierPng) {
  const png = t => fs.readFileSync(path.join(dossierPng, 'icone_' + t + '.png'));
  const img256 = lirePng(png(256));
  if (img256.l !== 256 || img256.h !== 256) throw new Error('icone_256.png doit faire 256 x 256');
  const p512 = ecrirePng(agrandir(img256, 2)), p1024 = ecrirePng(agrandir(img256, 4));
  const entrees = [['icp4', png(16)], ['ic11', png(32)], ['icp5', png(32)], ['ic12', png(64)], ['ic07', png(128)],
    ['ic13', png(256)], ['ic08', png(256)], ['ic14', p512], ['ic09', p512], ['ic10', p1024]];
  for (const [type, p] of entrees) {
    const i = lirePng(p), attendu = { icp4: 16, ic11: 32, icp5: 32, ic12: 64, ic07: 128, ic13: 256, ic08: 256, ic14: 512, ic09: 512, ic10: 1024 }[type];
    if (i.l !== attendu || i.h !== attendu) throw new Error(type + ' : ' + i.l + ' px au lieu de ' + attendu);
  }
  const corps = entrees.map(([type, p]) => { const e = Buffer.alloc(8); e.write(type, 0, 'ascii'); e.writeUInt32BE(8 + p.length, 4); return Buffer.concat([e, p]); });
  const total = 8 + corps.reduce((s, b) => s + b.length, 0);
  const tete = Buffer.alloc(8); tete.write('icns', 0, 'ascii'); tete.writeUInt32BE(total, 4);
  return { icns: Buffer.concat([tete, ...corps]), rapport: '10 images (16 à 1024 px), le 256 est une grille agrandie x' + facteurPixel(img256) + ', 512 et 1024 agrandis sans lissage' };
}

/** Relit un .icns : [{ type, l, h }]. */
function lireIcns(buf) {
  if (buf.toString('ascii', 0, 4) !== 'icns' || buf.readUInt32BE(4) !== buf.length) throw new Error('icns abîmé');
  const r = [];
  for (let o = 8; o < buf.length;) {
    const type = buf.toString('ascii', o, o + 4), n = buf.readUInt32BE(o + 4);
    const i = lirePng(buf.subarray(o + 8, o + n));
    r.push({ type, l: i.l, h: i.h });
    o += n;
  }
  return r;
}

module.exports = { fabriquerIcns, lireIcns, lirePng, ecrirePng, agrandir };

if (require.main === module) {
  const { icns, rapport } = fabriquerIcns(process.argv[2] || path.join(__dirname, '..', '..', 'design', 'icone', 'final'));
  const sortie = process.argv[3] || path.join(__dirname, 'sortie', 'casteria.icns');
  fs.mkdirSync(path.dirname(sortie), { recursive: true });
  fs.writeFileSync(sortie, icns);
  console.log(sortie + ' : ' + icns.length + ' octets, ' + rapport);
  console.log(lireIcns(icns).map(e => e.type + ' ' + e.l).join(', '));
}
