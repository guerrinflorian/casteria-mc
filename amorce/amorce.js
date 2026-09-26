'use strict';
// L'amorce du launcher (a7) : le point d'entrée d'Electron (package.json « main »). Elle est livrée avec l'installateur
// et ne se met JAMAIS à jour toute seule. Elle choisit quel code du launcher démarrer (voir choisir.js) : la dernière
// version téléchargée et revérifiée à l'instant (signature de Florian + empreinte de chaque fichier), sinon la
// précédente, sinon le code livré avec l'installateur. Puis elle le démarre.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const A = require('./choisir');
const { racinePour } = require('./racine');

// La clé publique de Florian (la même que pour les fichiers du jeu). Elle ne change qu'avec un nouvel installateur.
const CLE_PUBLIQUE = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAQUp9If6rZVWRCcuG/g6rGbXsCpldCzwaeFKwqAAfKgI=',
  '-----END PUBLIC KEY-----',
  '',
].join('\n');

const EMBARQUE = path.join(__dirname, '..');
const VERSION_EMBARQUEE = require('../package.json').version;
const MOTEUR = process.versions.electron;
// Le dossier du launcher selon le système (racine.js) ; CASTERIA_RACINE pour les essais. Sous Windows, c'est
// %APPDATA%\Casteria, comme l'amorce de l'installateur 1.0.0 déjà publié (app.getPath('appData') + Casteria).
const RACINE = process.env.CASTERIA_RACINE ? path.resolve(process.env.CASTERIA_RACINE) : racinePour();

function journal(texte) {
  try {
    fs.mkdirSync(path.join(RACINE, 'journaux'), { recursive: true });
    fs.appendFileSync(path.join(RACINE, 'journaux', 'amorce.log'), new Date().toISOString() + ' ' + texte + '\n');
  } catch (e) { /* le journal ne doit jamais empêcher de démarrer */ }
}

let choix;
try {
  choix = A.choisirCode({
    racine: RACINE, embarque: EMBARQUE, versionEmbarquee: VERSION_EMBARQUEE, moteur: MOTEUR, clePublique: CLE_PUBLIQUE, journal,
  });
} catch (e) {
  journal('choix impossible (' + e.message + ") : code de l'installateur");
  choix = { base: EMBARQUE, version: VERSION_EMBARQUEE, embarquee: true, raisons: [e.message] };
}

// Ce que le code démarré peut utiliser : où il est, sa version, et de quoi confirmer son démarrage ou installer une
// mise à jour (les fonctions de vérification restent celles de l'amorce).
global.casteriaAmorce = {
  racine: RACINE,
  base: choix.base,
  version: choix.version,
  embarquee: choix.embarquee,
  versionEmbarquee: VERSION_EMBARQUEE,
  moteur: MOTEUR,
  clePublique: CLE_PUBLIQUE,
  confirmer: () => { if (!choix.embarquee) { A.confirmer(RACINE, choix.version); journal('code ' + choix.version + ' confirmé'); } },
  verifierDossier: dossier => A.verifierDossier(dossier, CLE_PUBLIQUE),
  validerCode: A.validerCode,
  verifierSignature: (octets, sig) => A.verifierSignature(octets, sig, CLE_PUBLIQUE),
  comparerVersions: A.comparerVersions,
  lireEtat: () => A.lireEtat(RACINE),
  ecrireEtat: etat => A.ecrireEtat(RACINE, etat),
};

try {
  require(path.join(choix.base, 'electron', 'main.js'));
} catch (e) {
  journal('le code ' + choix.version + ' a planté au démarrage : ' + (e.stack || e.message));
  if (!choix.embarquee) {
    // Refusé tout de suite, et on redémarre sur la version d'avant (ou celle de l'installateur).
    A.refuser(RACINE, choix.version);
    // Dans un AppImage lancé par FUSE, app.relaunch ne marche pas (son « relauncher » part du montage /tmp/.mount_xxx,
    // démonté quand on sort : essai de cc du 25/09). On lance le fichier .AppImage lui-même, détaché, sans les chemins
    // de l'ancien montage (même règle que src/affichage.js, lancementAppImage).
    if (process.env.APPIMAGE) {
      const ancien = process.env.APPDIR || '';
      const env = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'].includes(k)) continue;
        if (ancien && typeof v === 'string' && v.includes(ancien)) {
          const reste = v.split(':').filter(p => !p.includes(ancien)).join(':');
          if (reste) env[k] = reste;
        } else env[k] = v;
      }
      try { app.releaseSingleInstanceLock(); } catch (e2) { /* pas de verrou pris */ }
      try {
        require('child_process').spawn(process.env.APPIMAGE, process.argv.slice(1),
          { detached: true, stdio: 'ignore', env, cwd: process.env.HOME || undefined }).unref();
      } catch (e2) { journal('relance de l’AppImage impossible : ' + e2.message); }
    } else app.relaunch();
    app.exit(0);
  } else {
    throw e;
  }
}
