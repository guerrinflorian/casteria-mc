'use strict';
// Sert un dossier tel quel en HTTP local (serveurmc-14, 25/09/2026) : le code d'essai de a7 (code.json et ses fichiers
// a plat), pour que le launcher du conteneur se mette a jour comme chez un joueur. Lecture seule.
//   node serveur_code.js <dossier> <port>
const http = require('http');
const fs = require('fs');
const path = require('path');
const dossier = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 8765);
http.createServer((req, res) => {
  const nom = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  const chemin = path.join(dossier, nom);
  if (!chemin.startsWith(dossier + path.sep) || !fs.existsSync(chemin) || !fs.statSync(chemin).isFile()) {
    console.log('404 ' + req.url);
    res.writeHead(404);
    res.end();
    return;
  }
  console.log('200 ' + req.url);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
  fs.createReadStream(chemin).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('code servi sur http://127.0.0.1:' + port + '/'));
