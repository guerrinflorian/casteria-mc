'use strict';
// Crée la paire de clés Ed25519 qui signe le manifeste. La clé PRIVÉE reste chez Florian (jamais dans git, jamais
// sur l'hébergement) ; la clé publique est inscrite dans le launcher (src/reglages.js, CLE_PUBLIQUE_PAR_DEFAUT).
// Usage : node outils/creer_cles.js <dossier>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dossier = process.argv[2];
if (!dossier) { console.error('Usage : node outils/creer_cles.js <dossier>'); process.exit(2); }
const privee = path.join(dossier, 'cle_privee.pem');
const publique = path.join(dossier, 'cle_publique.pem');
if (fs.existsSync(privee) || fs.existsSync(publique)) {
  console.error('Des clés existent déjà dans ' + dossier + ' : je ne les écrase pas.');
  process.exit(1);
}
fs.mkdirSync(dossier, { recursive: true });
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(privee, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
fs.writeFileSync(publique, publicKey.export({ type: 'spki', format: 'pem' }));
console.log('Clés créées : ' + privee + ' (à garder secrète) et ' + publique + '.');
