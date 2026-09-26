'use strict';
// Les réglages du launcher : les dossiers, le pseudo, la mémoire du jeu. Rangés dans <racine>/launcher.json.
const fs = require('fs');
const os = require('os');
const path = require('path');

// La version du code du launcher : celle de son package.json (une seule source).
const VERSION = require('../package.json').version;
const AGENT = 'casteria-launcher/' + VERSION;
const MOTIF_PSEUDO = /^[A-Za-z0-9_]{3,16}$/;
const DEFAUT = { pseudo: null, memoire_go: null, manifeste: null };

// L'adresse du manifeste des joueurs (décision de Florian, 25/09/2026) : la release « joueurs » de son dépôt GitHub.
// L'étiquette est fixe : l'adresse ne change jamais, seul le contenu de la release suit les mises en ligne.
const MANIFESTE_PAR_DEFAUT = 'https://github.com/guerrinflorian/casteria-mc/releases/download/joueurs/manifeste.json';
// La page où l'on télécharge l'installateur (fixe : le fichier d'installation ne change qu'avec un nouveau moteur).
const PAGE_INSTALLATEUR = 'https://github.com/guerrinflorian/casteria-mc/releases/tag/installateur';
// Le serveur de jeu, pour l'état en direct avant d'avoir lu le manifeste (le manifeste le redonne ensuite).
const SERVEUR_PAR_DEFAUT = { adresse: 'gm52-dc02.ouiheberg.com', port: 25681 };
// La clé publique qui vérifie la signature du manifeste (la clé privée est chez Florian : C:\Users\guerr\Casteria_cles).
const CLE_PUBLIQUE_PAR_DEFAUT = [
  '-----BEGIN PUBLIC KEY-----',
  'MCowBQYDK2VwAyEAQUp9If6rZVWRCcuG/g6rGbXsCpldCzwaeFKwqAAfKgI=',
  '-----END PUBLIC KEY-----',
  '',
].join('\n');

// Le dossier du launcher selon le système. LA MÊME RÈGLE que amorce/racine.js (vérifiée par outils/essais.js) : elle
// ne change jamais. Windows : %APPDATA%\Casteria ; Mac : ~/Library/Application Support/Casteria ;
// Linux : $XDG_DATA_HOME/Casteria, sinon ~/.local/share/Casteria. Jamais le .minecraft du joueur.
function racineParDefaut(plateforme = process.platform, env = process.env, maison = os.homedir()) {
  if (plateforme === 'win32') {
    return path.win32.join(env.APPDATA || path.win32.join(maison, 'AppData', 'Roaming'), 'Casteria');
  }
  if (plateforme === 'darwin') return path.posix.join(maison, 'Library', 'Application Support', 'Casteria');
  const xdg = env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.posix.join(maison, '.local', 'share');
  return path.posix.join(xdg, 'Casteria');
}

// Windows annonce un peu moins que la mémoire vendue : 15,6 Go pour 16 Go, 7,8 Go pour 8 Go.
function memoireConseillee(totalOctets) {
  const go = (totalOctets === undefined ? os.totalmem() : totalOctets) / 1024 ** 3;
  if (go >= 11.5) return 4;
  if (go >= 7) return 3;
  return 2;
}

// Rend null si le pseudo est bon, sinon la phrase à montrer au joueur.
function verifierPseudo(pseudo) {
  if (typeof pseudo !== 'string' || pseudo === '') return 'Choisis un pseudo.';
  if (pseudo.length < 3) return 'Ton pseudo est trop court : 3 caractères au moins.';
  if (pseudo.length > 16) return 'Ton pseudo est trop long : 16 caractères au plus.';
  if (!MOTIF_PSEUDO.test(pseudo)) {
    return 'Ton pseudo ne peut contenir que des lettres sans accent, des chiffres et le tiret du bas _.';
  }
  return null;
}

function verifierMemoire(go, plateforme = process.platform) {
  if (!Number.isInteger(go) || go < 2 || go > 16) return 'La mémoire du jeu se règle entre 2 et 16 Go.';
  const total = os.totalmem() / 1024 ** 3;
  if (go > total - 2) {
    const systeme = { darwin: 'macOS', linux: 'Linux' }[plateforme] || 'Windows';
    return "Ton ordinateur a " + total.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) +
      ' Go de mémoire : laisse au moins 2 Go à ' + systeme + '.';
  }
  return null;
}

// Linux : le PortableMC officiel (5.0.5) demande glibc 2.39 (relevé par cc le 25/09) : Ubuntu 24.04, Linux Mint 22,
// Fedora 40, Debian 13 ou plus récent. On ne recompile pas PortableMC (ce ne serait plus le binaire de son auteur) :
// sur un système plus ancien, le launcher le dit dès l'ouverture et grise JOUER (décision de 5b, 25/09).
// Comment joindre l'équipe (décision de Florian, 25/09) : le même bout de phrase dans tous les messages du launcher.
const CONTACT = 'préviens le staff sur Discord ou par un ticket sur le site de Casteria';
const GLIBC_MINIMUM = [2, 39];
const TEXTE_LINUX_ANCIEN = 'Ton Linux est trop ancien pour lancer le jeu : il faut Ubuntu 24.04, Linux Mint 22 ou plus récent.';

function glibcDuSysteme() {
  try { return process.report.getReport().header.glibcVersionRuntime; } catch (e) { return undefined; }
}

// Rend null si le jeu peut se lancer ici, sinon la phrase à montrer au joueur. Une version inconnue (musl, rapport
// indisponible) ne bloque pas : l'erreur du chargeur est alors reconnue au clic (lancement.js).
function systemeBloquant(plateforme = process.platform, glibc = plateforme === 'linux' ? glibcDuSysteme() : undefined) {
  if (plateforme !== 'linux' || typeof glibc !== 'string') return null;
  const [maj, min] = glibc.split('.').map(Number);
  if (!Number.isInteger(maj) || !Number.isInteger(min)) return null;
  const assez = maj > GLIBC_MINIMUM[0] || (maj === GLIBC_MINIMUM[0] && min >= GLIBC_MINIMUM[1]);
  return assez ? null : TEXTE_LINUX_ANCIEN;
}

function chargerReglages(racine) {
  const fichier = path.join(racine, 'launcher.json');
  try {
    return Object.assign({}, DEFAUT, JSON.parse(fs.readFileSync(fichier, 'utf8')));
  } catch (e) {
    if (e.code === 'ENOENT') return Object.assign({}, DEFAUT);
    // Un fichier abîmé ne doit pas bloquer le joueur : on repart des réglages par défaut.
    return Object.assign({}, DEFAUT);
  }
}

function enregistrerReglages(racine, reglages) {
  const fichier = path.join(racine, 'launcher.json');
  const provisoire = fichier + '.tmp';
  fs.writeFileSync(provisoire, JSON.stringify(reglages, null, 2) + '\n');
  fs.renameSync(provisoire, fichier);
}

module.exports = {
  VERSION, AGENT, MANIFESTE_PAR_DEFAUT, CLE_PUBLIQUE_PAR_DEFAUT, SERVEUR_PAR_DEFAUT, PAGE_INSTALLATEUR,
  racineParDefaut, memoireConseillee, verifierPseudo, verifierMemoire, chargerReglages, enregistrerReglages,
  TEXTE_LINUX_ANCIEN, systemeBloquant, CONTACT,
};
