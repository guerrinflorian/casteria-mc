'use strict';
// La fenêtre du launcher : le processus principal d'Electron.
// Tout le travail passe par les modules de src/ (les mêmes que la console) ; la page ne reçoit que des données et des
// signaux. Elle n'a aucun accès à Node (contextIsolation, sandbox) : elle ne parle qu'à travers preload.js, et chaque
// demande est revérifiée ici.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../src/reglages');
const { creerJournal } = require('../src/journal');
const { jouer, apercu, messageJoueur } = require('../src/partie');
const { etatServeur } = require('../src/etat_serveur');
const { chercherMaj, installerMaj, CODE_PAR_DEFAUT } = require('../src/code_launcher');

// L'amorce qui a démarré ce code (amorce/amorce.js) : sa version, et ses fonctions de vérification.
const AMORCE = global.casteriaAmorce || null;

// Pour les essais : des dossiers d'essai, et le mode --dry (variables d'environnement). Dans l'application installée,
// le manifeste et la clé ne se changent JAMAIS : les fichiers du jeu (des mods, donc du code) ne s'installent qu'avec
// la signature de Florian. L'adresse du code (CASTERIA_CODE) peut changer : l'amorce revérifie tout avec sa clé.
const DEV = {
  racine: process.env.CASTERIA_RACINE,
  manifeste: app.isPackaged ? undefined : process.env.CASTERIA_MANIFESTE,
  clePublique: app.isPackaged ? undefined : process.env.CASTERIA_CLE_PUBLIQUE,
  commun: process.env.CASTERIA_COMMUN,
  code: process.env.CASTERIA_CODE,
  // CASTERIA_DRY=1 : le bouton Jouer prépare tout (PortableMC --dry) sans lancer le jeu, donc sans Java.
  dry: process.env.CASTERIA_DRY === '1',
  // CASTERIA_SANS_MAJ=1 : pas de recherche de mise à jour du code (essais).
  sansMaj: process.env.CASTERIA_SANS_MAJ === '1',
};
// Le dossier du launcher : celui de l'amorce qui a démarré ce code (ils ne peuvent pas diverger), sinon la même règle.
const RACINE = DEV.racine ? path.resolve(DEV.racine) : (AMORCE ? AMORCE.racine : R.racineParDefaut());
// Les données d'Electron (cache...) rangées dans le dossier du launcher, à part des fichiers du jeu.
app.setPath('userData', path.join(RACINE, 'electron'));
// Dans l'application installée, PortableMC est dans resources/bin ; pendant le développement, dans launcher/bin.
// Le PortableMC livré (bin/<système>-<processeur>/ dans le projet, resources/bin/ une fois installé) ; src/partie.js le
// vérifie et, sous Mac et Linux, le recopie dans le dossier du launcher en le marquant exécutable.
const PORTABLEMC = require('../src/portablemc').cheminLivre({
  installe: app.isPackaged, resources: process.resourcesPath, projet: path.join(__dirname, '..'),
});

// L'affichage sous Linux (src/affichage.js), AVANT « ready » : Wayland à échelle fractionnaire, et le repli X11.
const AF = require('../src/affichage');
const AFFICHAGE = AF.decider({
  plateforme: process.platform, env: process.env, argv: process.argv, racine: RACINE,
  featuresDesactivees: app.commandLine.getSwitchValue('disable-features'),
});
for (const [nom, valeur] of AFFICHAGE.commutateurs) app.commandLine.appendSwitch(nom, valeur);
function noterAmorce(texte) {
  try {
    fs.mkdirSync(path.join(RACINE, 'journaux'), { recursive: true });
    fs.appendFileSync(path.join(RACINE, 'journaux', 'amorce.log'), new Date().toISOString() + ' ' + texte + '\n');
  } catch (e) { /* le journal ne doit jamais empêcher de démarrer */ }
}
// Redémarrer Electron (relance X11, bouton Redémarrer). Dans un AppImage : JAMAIS app.relaunch (son « relauncher »
// part du montage /tmp/.mount_xxx, qui disparaît avec nous : aucune fenêtre, essai de cc avec FUSE). On lance le
// fichier .AppImage lui-même, détaché, après avoir rendu le verrou « un seul launcher » (sinon le nouveau pourrait se
// croire en double et se fermer).
function relancer(args) {
  if (process.env.APPIMAGE) {
    const l = AF.lancementAppImage(process.env, args || process.argv.slice(1));
    try { app.releaseSingleInstanceLock(); } catch (e) { /* pas de verrou pris */ }
    try {
      require('child_process').spawn(l.commande, l.args, l.options).unref();
    } catch (e) {
      noterAmorce('relance de l’AppImage impossible : ' + e.message);
    }
    app.exit(0);
    return;
  }
  app.relaunch(AF.optionsRelance(process.env, args));
  app.exit(0);
}
// La note X11 sans XWayland (pas de DISPLAY) : on l'oublie, on reste en Wayland (jamais de démarrage impossible).
if (AFFICHAGE.effacerNote) {
  AF.effacerNote(RACINE);
  noterAmorce('affichage : note X11 effacée (pas de XWayland ici), Wayland');
}
// En X11 à cause de la note : dit à chaque démarrage (un launcher flou chez un joueur se comprend ainsi).
if (AFFICHAGE.x11 && AFFICHAGE.note) {
  noterAmorce('affichage : X11 (note du ' + (AFFICHAGE.note.depuis || 'date inconnue') + ' : ' + (AFFICHAGE.note.raison || 'raison inconnue') + ')');
}
// X11 d'abord (Linux avec XWayland) : redémarrer tout de suite avec --ozone-platform=x11 (rien n'est encore ouvert).
// PIÈGE : l'amorce a marqué ce code « en essai », et un essai jamais confirmé est REFUSÉ au démarrage suivant. Sans la
// confirmation ci-dessous, chaque mise à jour du code serait jetée par ce redémarrage. Aucune sûreté n'est perdue :
// l'amorce du processus relancé remet sa propre marque d'essai, et c'est lui (en X11) qui doit montrer la page.
// Garde-fou (5b) : une relance X11 d'avant n'a jamais montré de fenêtre. Plus jamais de relance ici : Wayland natif.
if (AFFICHAGE.relanceEchouee) {
  AF.noterX11Impossible(RACINE, 'la relance X11 n’a jamais montré de fenêtre');
  AF.effacerMarqueRelance(RACINE);
  noterAmorce('affichage : la relance X11 précédente n’a jamais montré de fenêtre : plus de relance, Wayland natif');
}
const RELANCE_X11 = AFFICHAGE.relancerX11;
if (RELANCE_X11) {
  if (AMORCE) AMORCE.confirmer();
  AF.poserMarqueRelance(RACINE);
  noterAmorce('affichage : relance en X11 (XWayland), l’essai du code reprend dans le processus relancé');
  relancer(AF.argumentsX11(process.argv));
}

let fenetre = null;
let enCours = false;
// Le serveur à interroger : celui du manifeste dès qu'il est lu, sinon celui par défaut.
let serveur = Object.assign({}, R.SERVEUR_PAR_DEFAUT);
let dernierEtat = null;

// Un seul launcher à la fois : deux mises à jour en même temps se disputeraient les fichiers.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!fenetre) return;
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.show();
  fenetre.focus();
});

function creerFenetre() {
  // CASTERIA_ESSAI_TAILLE=800x600 (hors installation) : une autre taille, comme celle qu'impose un gestionnaire en
  // mosaïque sous Linux (Windows, lui, ne laisse pas changer la taille d'une fenêtre non redimensionnable).
  const essai = !app.isPackaged && /^(\d+)x(\d+)$/.exec(process.env.CASTERIA_ESSAI_TAILLE || '');
  fenetre = new BrowserWindow({
    width: essai ? Number(essai[1]) : 1100, height: essai ? Number(essai[2]) : 700,
    useContentSize: true, resizable: false, maximizable: false, fullscreenable: false,
    // Sans le cadre de Windows : la page dessine sa propre barre de titre (ae). thickFrame garde l'ombre de Windows.
    frame: false, title: 'Casteria', backgroundColor: '#1d1512', show: false,
    // L'icône de la fenêtre : .ico sous Windows, PNG ailleurs (le Mac prend celle du paquet).
    icon: path.join(__dirname, 'icones', process.platform === 'win32' ? 'casteria.ico' : 'icone-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  fenetre.loadFile(path.join(__dirname, 'fenetre', 'index.html'));
  fenetre.once('ready-to-show', () => fenetre.show());
  // La page tient toujours dans la vraie taille de la fenêtre (un gestionnaire en mosaïque impose la sienne) : zoom
  // = min(largeur / 1100, hauteur / 700), recalculé à chaque changement. Le zoom du joueur (Ctrl + molette, Ctrl +/-)
  // est bloqué, pour que rien ne le dérègle.
  const ajusterZoom = () => {
    if (!fenetre || fenetre.isDestroyed()) return;
    const [l, h] = fenetre.getContentSize();
    const z = AF.zoomPour(l, h);
    if (Math.abs(fenetre.webContents.getZoomFactor() - z) > 0.001) fenetre.webContents.setZoomFactor(z);
  };
  fenetre.on('resize', ajusterZoom);
  fenetre.webContents.on('did-finish-load', () => { fenetre.webContents.setVisualZoomLevelLimits(1, 1); ajusterZoom(); });
  fenetre.webContents.on('zoom-changed', () => setImmediate(ajusterZoom));
  fenetre.webContents.on('before-input-event', (e, i) => {
    if ((i.control || i.meta) && ['+', '-', '=', '0', 'Add', 'Subtract'].includes(i.key)) e.preventDefault();
  });
  surveillerAffichage();
  // La fenêtre n'ouvre jamais de page web : un lien part dans le navigateur du joueur.
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  fenetre.webContents.on('will-navigate', e => e.preventDefault());
}

// Linux en Wayland : si la page n'a pas répondu en 20 s (ou si le processus graphique meurt avant), repli X11. Le
// code a bien démarré (ce n'est pas lui qui est en cause) : il est confirmé auprès de l'amorce AVANT de redémarrer,
// sinon elle le refuserait au démarrage suivant.
let affichageOk = false;
let minuteurAffichage = null;
function repliX11(raison) {
  if (affichageOk || !AFFICHAGE.wayland) return;
  // Sans XWayland (pas de DISPLAY), X11 ne démarrerait jamais : on reste en Wayland, et on le dit.
  if (!AF.x11Possible(process.env)) { noterAmorce('affichage Wayland en échec (' + raison + '), et pas de XWayland : pas de repli'); return; }
  // X11 déjà connu pour ne jamais montrer de fenêtre ici : on n'y retourne pas (jamais de boucle).
  if (AFFICHAGE.x11Refuse) { noterAmorce('affichage Wayland en échec (' + raison + '), mais X11 aussi a échoué ici : pas de repli'); return; }
  AF.noterRepliX11(RACINE, raison);
  noterAmorce('affichage Wayland en échec (' + raison + ') : redémarrage en X11');
  if (AMORCE) AMORCE.confirmer();
  AF.poserMarqueRelance(RACINE);
  relancer(AF.argumentsX11(process.argv));
}
function surveillerAffichage() {
  if (!AFFICHAGE.wayland) return;
  // La page appelle « etat » dès qu'elle tourne : c'est lui qui arrête ce minuteur.
  minuteurAffichage = setTimeout(() => repliX11('la fenêtre ne s’est pas affichée en 20 s'), 20000);
  app.on('child-process-gone', (e, d) => {
    if (d.type === 'GPU' && !affichageOk && d.reason !== 'clean-exit') repliX11('processus graphique : ' + d.reason);
  });
}

function envoyer(s) {
  if (fenetre && !fenetre.isDestroyed()) fenetre.webContents.send('signal', s);
}

function reglagesDuJour() {
  const reglages = R.chargerReglages(RACINE);
  if (DEV.manifeste) reglages.manifeste = DEV.manifeste;
  return reglages;
}
const clePublique = () => (DEV.clePublique ? fs.readFileSync(DEV.clePublique, 'utf8') : null);

// Un système où le jeu ne peut pas se lancer (Linux trop ancien pour PortableMC) : dit dès l'ouverture, JOUER grisé.
// CASTERIA_ESSAI_GLIBC (hors installation) simule une version de glibc pour les essais.
const SYSTEME_BLOQUANT = process.env.CASTERIA_ESSAI_GLIBC && !app.isPackaged
  ? R.systemeBloquant('linux', process.env.CASTERIA_ESSAI_GLIBC) : R.systemeBloquant();

ipcMain.handle('etat', () => {
  // La page a répondu : ce code démarre bien, l'amorce le garde (sinon elle le refuserait au prochain lancement).
  if (AMORCE) AMORCE.confirmer();
  // Et l'affichage marche (Linux en Wayland : pas de repli X11 ; une relance X11 a bien montré sa fenêtre).
  affichageOk = true;
  clearTimeout(minuteurAffichage);
  AF.effacerMarqueRelance(RACINE);
  const reglages = R.chargerReglages(RACINE);
  return {
    version: R.VERSION, pseudo: reglages.pseudo || '', memoireGo: reglages.memoire_go,
    // Le dernier pseudo vraiment entré sur le serveur (la référence de l'avertissement des majuscules).
    pseudoValide: reglages.pseudo_valide || '',
    memoireConseillee: R.memoireConseillee(), memoireTotaleGo: os.totalmem() / 1024 ** 3, enCours,
    majLauncher, bloque: SYSTEME_BLOQUANT,
  };
});

// ---- La mise à jour du code du launcher (l'installateur, lui, ne change pas) ----
let majLauncher = null;
async function chercherMiseAJour() {
  if (!AMORCE || DEV.sansMaj) return;
  const outils = {
    verifierSignature: AMORCE.verifierSignature, validerCode: AMORCE.validerCode, comparerVersions: AMORCE.comparerVersions,
    verifierDossier: AMORCE.verifierDossier, lireEtat: AMORCE.lireEtat, ecrireEtat: AMORCE.ecrireEtat,
  };
  const journal = creerJournal(path.join(RACINE, 'journaux'));
  try {
    const maj = await chercherMaj({
      source: DEV.code || CODE_PAR_DEFAUT, outils, versionActuelle: AMORCE.version, moteur: AMORCE.moteur, etat: AMORCE.lireEtat(),
    });
    if (!maj) { journal.info('code du launcher à jour (' + AMORCE.version + ')'); return; }
    if (maj.moteurDifferent) {
      journal.info('la version ' + maj.manifeste.version + ' du launcher demande un nouvel installateur');
      majLauncher = { etat: 'installateur', version: maj.manifeste.version };
      envoyer({ type: 'maj_launcher', etat: 'installateur', version: maj.manifeste.version });
      return;
    }
    envoyer({ type: 'maj_launcher', etat: 'telechargement', version: maj.manifeste.version, part: 0 });
    await installerMaj({
      racine: RACINE, maj, outils,
      surProgres: part => envoyer({ type: 'maj_launcher', etat: 'telechargement', version: maj.manifeste.version, part }),
    });
    journal.info('code du launcher ' + maj.manifeste.version + ' téléchargé et vérifié : actif au prochain démarrage');
    majLauncher = { etat: 'pret', version: maj.manifeste.version };
    envoyer({ type: 'maj_launcher', etat: 'pret', version: maj.manifeste.version });
  } catch (err) {
    // Pas d'internet, signature fausse, fichier abîmé : rien n'est activé, le launcher continue tel quel.
    journal.avert('mise à jour du launcher abandonnée : ' + (err.code ? '[' + err.code + '] ' : '') + err.message);
  } finally {
    await journal.fermer();
  }
}

// Redémarrer sur la nouvelle version (jamais pendant une partie).
ipcMain.handle('redemarrer', () => {
  if (enCours) return false;
  relancer();
  return true;
});
// Un nouveau moteur demande un nouvel installateur : la page de téléchargement, dans le navigateur du joueur.
ipcMain.handle('ouvrir-installateur', () => shell.openExternal(R.PAGE_INSTALLATEUR));

ipcMain.handle('verifier-pseudo', (e, pseudo) => R.verifierPseudo(String(pseudo || '')));

// Les réglages (pseudo, mémoire) s'enregistrent dès qu'ils sont bons ; une valeur refusée n'est pas enregistrée.
ipcMain.handle('enregistrer-reglages', (e, demande) => {
  const d = demande || {};
  fs.mkdirSync(RACINE, { recursive: true });
  const reglages = R.chargerReglages(RACINE);
  if (d.pseudo !== undefined) {
    const faute = R.verifierPseudo(String(d.pseudo));
    if (faute) return { ok: false, champ: 'pseudo', message: faute };
    reglages.pseudo = String(d.pseudo);
  }
  if (d.memoireGo !== undefined) {
    const go = d.memoireGo === null ? null : Number(d.memoireGo);
    if (go !== null) {
      const faute = R.verifierMemoire(go);
      if (faute) return { ok: false, champ: 'memoire', message: faute };
    }
    reglages.memoire_go = go;
  }
  R.enregistrerReglages(RACINE, reglages);
  return { ok: true };
});

// Le numéro de la mise en ligne, les nouvelles datées et le serveur, pour l'accueil. Sans internet : null.
ipcMain.handle('apercu', async () => {
  try {
    const a = await apercu({ reglages: reglagesDuJour(), clePublique: clePublique() });
    if (a && a.serveur) serveur = { adresse: a.serveur.adresse, port: a.serveur.port };
    return a;
  } catch (err) {
    return null;
  }
});

// L'état du serveur en direct. Pas plus d'un ping toutes les 10 s, quoi que demande la page.
ipcMain.handle('etat-serveur', async () => {
  if (dernierEtat && Date.now() - dernierEtat.quand < 10000) return dernierEtat.etat;
  const etat = await etatServeur(serveur);
  dernierEtat = { quand: Date.now(), etat };
  return etat;
});

ipcMain.handle('jouer', async () => {
  if (enCours) return { ok: false, message: 'Le jeu est déjà en route.' };
  if (SYSTEME_BLOQUANT) return { ok: false, message: SYSTEME_BLOQUANT };
  const reglages = reglagesDuJour();
  const faute = R.verifierPseudo(reglages.pseudo);
  if (faute) return { ok: false, message: faute };

  const journal = creerJournal(path.join(RACINE, 'journaux'));
  enCours = true;
  const signal = s => {
    // La fenêtre se cache pendant la partie et revient quand le jeu se ferme (PortableMC garde la main pendant la
    // partie : le launcher doit rester ouvert).
    if (s.type === 'jeu_lance' && fenetre) fenetre.hide();
    if (s.type === 'jeu_ferme') ramener();
    if (s.type === 'manifeste' && s.serveur) serveur = { adresse: s.serveur.adresse, port: s.serveur.port };
    envoyer(s);
  };
  try {
    const r = await jouer({
      racine: RACINE, reglages, portablemc: PORTABLEMC, commun: DEV.commun || null, dry: DEV.dry,
      clePublique: clePublique(), signal, journal,
    });
    // fin : le launcher a arrêté la partie lui-même (connexion refusée ou coupée, le joueur a quitté...).
    return { ok: true, dry: DEV.dry, fin: r && r.fin ? { cas: r.fin.cas, rouge: r.fin.rouge, message: r.fin.message } : null };
  } catch (err) {
    journal.erreur((err.code ? '[' + err.code + '] ' : '') + (err.stack || err.message));
    // Le joueur lit une phrase simple ; le détail technique reste dans le journal.
    return { ok: false, message: messageJoueur(err), journal: journal.fichier };
  } finally {
    enCours = false;
    ramener();
    await journal.fermer();
  }
});

// La fenêtre revient au premier plan quand le jeu se ferme (Windows refuse parfois de donner la main à une fenêtre
// cachée : « toujours devant » un instant, puis normal).
function ramener() {
  if (!fenetre || fenetre.isDestroyed()) return;
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.show();
  fenetre.setAlwaysOnTop(true);
  fenetre.focus();
  fenetre.moveTop();
  setTimeout(() => { if (fenetre && !fenetre.isDestroyed()) fenetre.setAlwaysOnTop(false); }, 400);
}

ipcMain.handle('ouvrir-dossier', (e, quoi) => {
  const cible = quoi === 'journaux' ? path.join(RACINE, 'journaux') : path.join(RACINE, 'jeu');
  fs.mkdirSync(cible, { recursive: true });
  return shell.openPath(cible);
});

// La barre de titre dessinée par la page.
ipcMain.handle('reduire', () => { if (fenetre) fenetre.minimize(); });
ipcMain.handle('fermer', () => {
  if (!fenetre) return;
  // Pendant une partie, fermer cache seulement la fenêtre : le jeu continue, et elle revient à sa fermeture.
  if (enCours) fenetre.hide();
  else fenetre.close();
});

// Sous Windows, une fois installé : les raccourcis et l'inscription corrigés par le code (l'installateur ne change pas).
async function integrerWindows() {
  // CASTERIA_SANS_INTEGRATION=1 : pour les essais de l'application installée, sans toucher aux vrais raccourcis.
  if (process.platform !== 'win32' || !app.isPackaged || process.env.CASTERIA_SANS_INTEGRATION === '1') return;
  const journal = creerJournal(path.join(RACINE, 'journaux'));
  try {
    await require('../src/integration_windows').integrer({
      shell, racine: RACINE, exe: process.execPath, iconeSource: path.join(__dirname, 'icones', 'casteria.ico'),
      version: R.VERSION, bureau: app.getPath('desktop'), appData: app.getPath('appData'), journal,
    });
  } catch (err) {
    journal.avert('intégration Windows impossible : ' + err.message);
  } finally {
    await journal.fermer();
  }
}

app.whenReady().then(() => {
  if (RELANCE_X11) return;
  creerFenetre();
  integrerWindows();
  // La recherche de mise à jour attend que la fenêtre soit là, et ne bloque rien.
  setTimeout(chercherMiseAJour, 3000);
});
// Fermer la fenêtre pendant une partie ne coupe pas le jeu : le launcher attend qu'il se ferme.
app.on('window-all-closed', () => { if (!enCours) app.quit(); });
