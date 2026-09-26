'use strict';
// Assemble une icône Windows (.ico) à partir de PNG carrés (16 à 256 px), chaque image rangée en PNG dans le fichier
// (le format que Windows lit depuis Vista).
// Usage : node outils/fabriquer_ico.js <sortie.ico> <image-16.png> <image-32.png> ...
const fs = require('fs');

const [sortie, ...images] = process.argv.slice(2);
if (!sortie || !images.length) { console.error('Usage : node outils/fabriquer_ico.js <sortie.ico> <png>...'); process.exit(2); }

const entrees = images.map(f => {
  const png = fs.readFileSync(f);
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error(f + " n'est pas un PNG");
  const l = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (l !== h || l > 256) throw new Error(f + ' : il faut une image carrée de 256 px au plus (' + l + 'x' + h + ')');
  return { png, taille: l };
}).sort((a, b) => a.taille - b.taille);

const entete = Buffer.alloc(6);
entete.writeUInt16LE(0, 0);
entete.writeUInt16LE(1, 2);
entete.writeUInt16LE(entrees.length, 4);
const repertoire = Buffer.alloc(16 * entrees.length);
let decalage = 6 + repertoire.length;
entrees.forEach((e, i) => {
  const o = i * 16;
  repertoire.writeUInt8(e.taille === 256 ? 0 : e.taille, o);
  repertoire.writeUInt8(e.taille === 256 ? 0 : e.taille, o + 1);
  repertoire.writeUInt8(0, o + 2);
  repertoire.writeUInt8(0, o + 3);
  repertoire.writeUInt16LE(1, o + 4);
  repertoire.writeUInt16LE(32, o + 6);
  repertoire.writeUInt32LE(e.png.length, o + 8);
  repertoire.writeUInt32LE(decalage, o + 12);
  decalage += e.png.length;
});
fs.writeFileSync(sortie, Buffer.concat([entete, repertoire, ...entrees.map(e => e.png)]));
console.log(sortie + ' : ' + entrees.map(e => e.taille).join(', ') + ' px, ' + decalage + ' octets');
