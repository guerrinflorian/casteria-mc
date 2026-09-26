'use strict';
// Interroge un serveur Minecraft comme la liste des serveurs du jeu, et affiche ce que le launcher en voit.
// Usage : node outils/ping_serveur.js [adresse] [port]   (par défaut : le serveur de Casteria)
const R = require('../src/reglages');
const { etatServeur } = require('../src/etat_serveur');

const adresse = process.argv[2] || R.SERVEUR_PAR_DEFAUT.adresse;
const port = Number(process.argv[3] || R.SERVEUR_PAR_DEFAUT.port);
const debut = Date.now();
etatServeur({ adresse, port }).then(r => {
  console.log(adresse + ':' + port + ' en ' + (Date.now() - debut) + ' ms');
  console.log(JSON.stringify(r, null, 2));
});
