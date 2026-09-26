'use strict';
// Le dossier du launcher (le jeu, son code téléchargé, ses journaux), selon le système (a7). Fait partie de l'amorce :
// il ne doit JAMAIS changer, sinon un launcher installé ne retrouverait plus ses fichiers. src/reglages.js a la même
// règle (le code téléchargé n'a pas accès à l'amorce) ; outils/essais.js vérifie qu'elles donnent le même résultat.
// Jamais le .minecraft du joueur.
//   Windows : %APPDATA%\Casteria
//   Mac     : ~/Library/Application Support/Casteria
//   Linux   : $XDG_DATA_HOME/Casteria, sinon ~/.local/share/Casteria
const path = require('path');
const os = require('os');

function racinePour(plateforme = process.platform, env = process.env, maison = os.homedir()) {
  if (plateforme === 'win32') {
    return path.win32.join(env.APPDATA || path.win32.join(maison, 'AppData', 'Roaming'), 'Casteria');
  }
  if (plateforme === 'darwin') return path.posix.join(maison, 'Library', 'Application Support', 'Casteria');
  // XDG : seulement un chemin absolu compte (la norme dit d'ignorer un chemin relatif).
  const xdg = env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.posix.join(maison, '.local', 'share');
  return path.posix.join(xdg, 'Casteria');
}

module.exports = { racinePour };
