'use strict';
// L'affichage de la fenêtre selon le système (a7, code 1.0.6). Testable sans Linux : le système et l'environnement sont
// des paramètres.
//
// Linux, Wayland à une échelle fractionnaire (le 25/09, chez un ami de Florian : Arch + Hyprland, écran à 1,25) :
// Chromium 152 (Electron 44) annonce une fenêtre de 1120 x 720 mais dessine une surface 1,25 fois plus petite, coincée
// en haut à gauche. Le contournement, vérifié chez lui : disable-features=WaylandFractionalScaleV1, posé AVANT « ready »
// (l'amorce charge electron/main.js tout de suite : c'est à temps).
// Le repli X11 : si la fenêtre ne s'affiche pas en Wayland (ou si le processus graphique meurt au démarrage), le
// launcher le note dans <racine>/electron/affichage.json et redémarre avec --ozone-platform=x11 (XWayland). Ce choix
// ne peut PAS se faire depuis le code (Chromium choisit sa plateforme avant d'exécuter main.js) : c'est un vrai argument
// de la ligne de commande, redonné à chaque démarrage tant que la note existe.
const fs = require('fs');
const path = require('path');

const LARGEUR = 1100;
const HAUTEUR = 700;
const ARG_X11 = '--ozone-platform=x11';

// La page est dessinée pour 1 100 x 700 : le zoom la fait tenir dans la vraie taille de la fenêtre (un gestionnaire en
// mosaïque comme Hyprland impose sa taille), sans rien couper (ae centre la scène et étend le fond).
function zoomPour(largeur, hauteur) {
  if (!(largeur > 0) || !(hauteur > 0)) return 1;
  return Math.max(0.5, Math.min(largeur / LARGEUR, hauteur / HAUTEUR));
}

// Electron 44 prend-il Wayland ? Le même choix que lui (relevé par cc le 25/09) : X11 dès que DISPLAY existe, sauf si
// XDG_SESSION_TYPE=wayland ou ELECTRON_OZONE_PLATFORM_HINT=wayland ; Wayland seul s'il n'y a que WAYLAND_DISPLAY.
function sessionWayland(env) {
  if (!env.WAYLAND_DISPLAY) return false;
  const indice = String(env.ELECTRON_OZONE_PLATFORM_HINT || '').toLowerCase();
  if (indice === 'x11') return false;
  if (indice === 'wayland') return true;
  return !env.DISPLAY || /wayland/i.test(String(env.XDG_SESSION_TYPE || ''));
}

function fichierNote(racine) { return path.join(racine, 'electron', 'affichage.json'); }

function lireNote(racine) {
  try { return JSON.parse(fs.readFileSync(fichierNote(racine), 'utf8')) || {}; } catch (e) { return {}; }
}

function noterRepliX11(racine, raison) {
  try {
    fs.mkdirSync(path.dirname(fichierNote(racine)), { recursive: true });
    fs.writeFileSync(fichierNote(racine), JSON.stringify({ x11: true, raison, depuis: new Date().toISOString() }, null, 2));
  } catch (e) { /* sans la note, le prochain démarrage réessaiera Wayland : pas grave */ }
}

function effacerNote(racine) {
  try { fs.unlinkSync(fichierNote(racine)); } catch (e) { /* pas de note */ }
}

// XWayland est-il là ? Il pose DISPLAY. Sans lui (Hyprland permet « xwayland { enabled = false } »), X11 ferait mourir
// Chromium avant notre code, à chaque démarrage : le launcher ne s'ouvrirait plus jamais (relecture de 5b).
function x11Possible(env) { return !!env.DISPLAY; }

// Ce qu'il faut faire avant « ready » : { commutateurs: [[nom, valeur]], relancerX11, wayland, x11, note, effacerNote }.
//   relancerX11 : la note demande X11 mais l'argument manque : redémarrer avec lui avant d'ouvrir quoi que ce soit ;
//   effacerNote : la note demande X11 mais XWayland n'est pas là : on l'oublie et on reste en Wayland.
// Hyprland : le seul compositeur où couper WaylandFractionalScaleV1 est prouvé utile (le cas de l'ami). Sur un sway
// récent (Arch), cc a montré le 25/09 que ce réglage CASSE l'affichage (fenêtre de 550 x 361, page coupée).
function estHyprland(env) {
  return !!env.HYPRLAND_INSTANCE_SIGNATURE || /hyprland/i.test(String(env.XDG_CURRENT_DESKTOP || ''));
}

// Linux : X11 (XWayland) dès que DISPLAY existe, POINT (décision de 5b, après l'essai de cc sur Arch). En X11,
// Chromium ne négocie pas d'échelle fractionnaire avec le compositeur : pas de fenêtre et de page de tailles
// différentes ; un peu de flou à 1,25 vaut mieux qu'une page coupée. ELECTRON_OZONE_PLATFORM_HINT=wayland n'est PAS
// écouté : Omarchy (le système de l'ami de Florian) le pose pour toutes les applications, ce n'est pas un choix du
// joueur. Wayland natif seulement sans XWayland, ou par notre porte d'essai CASTERIA_WAYLAND=1 (dite nulle part).
function decider({ plateforme, env, argv, racine, featuresDesactivees = '' }) {
  const r = { commutateurs: [], relancerX11: false, wayland: false, x11: false, note: null, effacerNote: false, relanceEchouee: false };
  if (plateforme !== 'linux') return r;
  r.x11 = argv.some(a => a === ARG_X11 || a === '--ozone-platform=X11');
  const note = lireNote(racine);
  if (note.x11) r.note = note;
  if (note.x11 && !x11Possible(env)) r.effacerNote = true;
  const choixElectron = sessionWayland(env);
  const imposeWayland = env.CASTERIA_WAYLAND === '1';
  // Une relance X11 d'avant qui n'a jamais montré de fenêtre (la marque est restée) : plus jamais de relance ici.
  if (!r.x11 && marqueRelancePresente(racine)) r.relanceEchouee = true;
  const x11Refuse = !!(note.x11Impossible || r.relanceEchouee);
  r.x11Refuse = x11Refuse;
  if (!r.x11 && choixElectron && x11Possible(env) && !imposeWayland && !x11Refuse) r.relancerX11 = true;
  r.wayland = !r.x11 && !r.relancerX11 && choixElectron;
  if (r.wayland && estHyprland(env)) {
    const liste = String(featuresDesactivees || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!liste.includes('WaylandFractionalScaleV1')) liste.push('WaylandFractionalScaleV1');
    r.commutateurs.push(['disable-features', liste.join(',')]);
  }
  return r;
}

// Les arguments du redémarrage en X11 : ceux de maintenant (sans le programme), plus --ozone-platform=x11 (une fois).
function argumentsX11(argv) {
  return argv.slice(1).filter(a => !/^--ozone-platform=/.test(a)).concat([ARG_X11]);
}

// Dans un AppImage lancé par FUSE (le vrai cas d'un joueur), app.relaunch() ne marche PAS, même avec execPath :
// Electron passe par un processus « relauncher » lancé depuis le montage /tmp/.mount_xxx, qui meurt quand le runtime
// démonte ce dossier à la sortie du premier processus (essai de cc du 25/09 : aucune fenêtre après la relance X11).
// On lance donc nous-mêmes le fichier .AppImage (sur le disque ; il monte son propre FUSE), détaché, avec un
// environnement sans ce qui pointe dans l'ancien montage.
function lancementAppImage(env, args) {
  const ancien = env.APPDIR || '';
  const propre = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'APPDIR' || k === 'APPIMAGE' || k === 'ARGV0' || k === 'OWD') continue;
    if (ancien && typeof v === 'string' && v.includes(ancien)) {
      // Les listes de chemins (LD_LIBRARY_PATH, PATH, XDG_DATA_DIRS...) : seulement les morceaux de l'ancien montage.
      const reste = v.split(':').filter(p => !p.includes(ancien)).join(':');
      if (reste) propre[k] = reste;
      continue;
    }
    propre[k] = v;
  }
  return { commande: env.APPIMAGE, args, options: { detached: true, stdio: 'ignore', env: propre, cwd: env.HOME || undefined } };
}

// Le garde-fou contre toute relance qui meurt (demande de 5b) : une marque « relance X11 en cours » est écrite avant
// de relancer, et la page qui répond l'efface. Encore là au démarrage suivant : la relance n'a jamais montré de
// fenêtre. On ne relance plus jamais (noté dans affichage.json), on reste en Wayland natif, et aucun démarrage ne peut
// devenir impossible, quelle que soit la cause.
function fichierMarque(racine) { return path.join(racine, 'electron', 'relance_x11_en_cours.json'); }
function poserMarqueRelance(racine) {
  try {
    fs.mkdirSync(path.dirname(fichierMarque(racine)), { recursive: true });
    fs.writeFileSync(fichierMarque(racine), JSON.stringify({ depuis: new Date().toISOString() }));
  } catch (e) { /* sans marque, pas de garde-fou pour cette fois */ }
}
function effacerMarqueRelance(racine) { try { fs.unlinkSync(fichierMarque(racine)); } catch (e) { /* pas de marque */ } }
function marqueRelancePresente(racine) { return fs.existsSync(fichierMarque(racine)); }
function noterX11Impossible(racine, raison) {
  try {
    fs.mkdirSync(path.dirname(fichierNote(racine)), { recursive: true });
    fs.writeFileSync(fichierNote(racine), JSON.stringify({ x11Impossible: true, raison, depuis: new Date().toISOString() }, null, 2));
  } catch (e) { /* au pire, la marque reviendra et le même garde-fou rejouera */ }
}

// Le redémarrage d'Electron hors AppImage (app.relaunch). Sous AppImage : lancementAppImage, ci-dessus.
function optionsRelance(env, args) {
  const o = {};
  if (args) o.args = args;
  if (env.APPIMAGE) o.execPath = env.APPIMAGE;
  return o;
}

module.exports = {
  zoomPour, decider, argumentsX11, optionsRelance, lancementAppImage, noterRepliX11,
  poserMarqueRelance, effacerMarqueRelance, marqueRelancePresente, noterX11Impossible, lireNote, effacerNote, x11Possible, sessionWayland, estHyprland,
  LARGEUR, HAUTEUR, ARG_X11,
};
