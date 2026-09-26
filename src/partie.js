'use strict';
// Une partie : lire le manifeste, mettre les fichiers à jour, puis lancer le jeu.
// Le même enchaînement sert à la console (casteria.js) et à la fenêtre (electron/main.js) : seuls les signaux
// (progression, erreurs) sont affichés différemment.
const fs = require('fs');
const path = require('path');
const R = require('./reglages');
const { chargerManifeste } = require('./manifeste');
const { synchroniser } = require('./synchro');
const { argumentsJeu, lancer } = require('./lancement');
const PMC = require('./portablemc');
const { etatServeur } = require('./etat_serveur');
const { creerSurveillance } = require('./surveillance');
const { sonderConnexion } = require('./sonde_connexion');
const { fermerJeu } = require('./fermer_jeu');
const { connecteAuServeur } = require('./connexion_jeu');

const TEXTE_SERVEUR_FERME = 'Le serveur est fermé pour le moment, réessaie dans un instant.';

// Le ping du serveur, jusqu'à 3 fois (1,5 s entre deux) tant qu'il ne répond pas.
async function serveurRepond(serveur, { essais = 3, pauseMs = 1500, interroger = etatServeur } = {}) {
  let r = null;
  for (let i = 0; i < essais; i++) {
    r = await interroger({ adresse: serveur.adresse, port: serveur.port });
    if (r.etat === 'en-ligne') return r;
    if (i < essais - 1) await new Promise(ok => setTimeout(ok, pauseMs));
  }
  return r;
}

// Le rapport de plantage du jeu, recopié dans le dossier des journaux (plantage-<date>.txt) : le joueur n'a qu'un seul
// endroit à connaître, celui qu'ouvre le bouton « Le journal du jeu (pour le staff) » (proposition de 00, code 1.0.7).
function copierRapport(rapport, racine, journal) {
  try {
    const dossier = path.join(racine, 'journaux');
    fs.mkdirSync(dossier, { recursive: true });
    const cible = path.join(dossier, 'plantage-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.txt');
    fs.copyFileSync(rapport, cible);
    if (journal) journal.info('rapport de plantage recopié : ' + cible);
    return cible;
  } catch (e) {
    if (journal) journal.avert('rapport de plantage non recopié (' + e.message + ')');
    return null;
  }
}

// Le dernier pseudo VRAIMENT entré sur le serveur (connexion acceptée, lue dans le journal du jeu) : la référence de
// l'avertissement des majuscules. Jamais un pseudo seulement enregistré, ni un pseudo refusé.
function noterPseudoValide(racine, pseudo, journal) {
  try {
    const r = R.chargerReglages(racine);
    if (r.pseudo_valide === pseudo) return;
    R.enregistrerReglages(racine, Object.assign(r, { pseudo_valide: pseudo }));
  } catch (e) {
    if (journal) journal.avert('pseudo entré non noté : ' + e.message);
  }
}

function pourJoueur(message, code) {
  const e = new Error(message);
  e.pourJoueur = true;
  if (code) e.code = code;
  return e;
}

// La phrase à montrer au joueur : simple, sans nom de fichier ni détail technique (ceux-là vont dans le journal).
function messageJoueur(e) {
  switch (e && e.code) {
    case 'pseudo':
    case 'sans_manifeste':
      return e.message;
    case 'reseau':
    case 'introuvable':
      return 'Impossible de joindre le serveur des mises à jour : vérifie ta connexion internet, puis réessaie.';
    case 'signature_absente':
    case 'signature_fausse':
    case 'manifeste_refuse':
      return "Les fichiers reçus ne viennent pas de Casteria : rien n'a été installé. " + majuscule(R.CONTACT) + '.';
    case 'telechargement':
      if (e.fichierAbime) {
        return "Un fichier est arrivé abîmé : il n'a pas été installé. Réessaie dans quelques minutes, " +
          'et si ça recommence, ' + R.CONTACT + '.';
      }
      return (e.nombre > 1 ? e.nombre + " fichiers n'ont pas pu être téléchargés" : "Un fichier n'a pas pu être téléchargé") +
        ' : vérifie ta connexion internet, puis réessaie.';
    case 'fichier_verrouille':
      return 'Le jeu est encore ouvert : ferme-le, puis réessaie.';
    case 'dossier_etranger':
      return "Le dossier du jeu contient des fichiers qui ne viennent pas du launcher : il n'y touche pas. " + majuscule(R.CONTACT) + '.';
    case 'portablemc_absent':
    case 'portablemc_abime':
      return 'Il manque un morceau du launcher : réinstalle-le.';
    case 'lancement':
      return "Le jeu n'a pas pu démarrer : réessaie, et si ça recommence, " + R.CONTACT + '.';
    case 'systeme_trop_ancien':
      return R.TEXTE_LINUX_ANCIEN;
    default:
      return e && e.pourJoueur ? e.message : "Une erreur inattendue s'est produite : réessaie, et si ça recommence, " + R.CONTACT + '.';
  }
}
const majuscule = s => s.charAt(0).toUpperCase() + s.slice(1);

async function jouer({
  racine, reglages, commun, portablemc, clePublique, verifierSeulement, dry, sansServeur, signal = () => {}, journal,
}) {
  const source = reglages.manifeste || R.MANIFESTE_PAR_DEFAUT;
  if (!source) throw pourJoueur('Le launcher ne sait pas où trouver les fichiers de Casteria : ' + R.CONTACT + '.', 'sans_manifeste');
  if (!verifierSeulement) {
    const faute = R.verifierPseudo(reglages.pseudo);
    if (faute) throw pourJoueur(faute, 'pseudo');
  }

  const { manifeste, base, signe } = await chargerManifeste({
    source, clePublique: clePublique || R.CLE_PUBLIQUE_PAR_DEFAUT,
  });
  journal.info('manifeste ' + source + ' : mise en ligne ' + manifeste.mise_en_ligne + ', ' +
    manifeste.fichiers.length + ' fichiers, ' + (signe ? 'signature vérifiée' : 'NON SIGNÉ'));
  signal({
    type: 'manifeste', miseEnLigne: manifeste.mise_en_ligne, minecraft: manifeste.jeu.minecraft,
    neoforge: manifeste.jeu.neoforge, signe, nouvelles: manifeste.nouvelles || [], serveur: manifeste.serveur,
  });

  // Avant tout : le serveur répond-il ? Sinon, le jeu ne se lance pas (le joueur finirait dans les menus). Deux
  // réessais courts avant de conclure, pour ne pas refuser à tort sur un raté du réseau.
  if (!verifierSeulement && !sansServeur && !dry) {
    signal({ type: 'verification_serveur' });
    const r = await serveurRepond(manifeste.serveur);
    journal.info('le serveur avant le lancement : ' + r.etat + (r.raison ? ' (' + r.raison + ')' : '') +
      (r.joueurs ? ', ' + r.joueurs.enLigne + ' joueurs' : ''));
    if (r.etat !== 'en-ligne') throw pourJoueur(TEXTE_SERVEUR_FERME, 'serveur_ferme');
  }

  const dossierJeu = path.join(racine, 'jeu');
  const bilan = await synchroniser({ manifeste, base, dossierJeu, signal, journal });
  if (verifierSeulement) return { bilan, resultat: null };

  const memoireGo = reglages.memoire_go || R.memoireConseillee();
  // Le binaire livré, vérifié ; sous Mac et Linux, recopié dans le dossier du launcher et marqué exécutable.
  const executable = PMC.preparer({ livre: portablemc, racine, empreintes: PMC.lireEmpreintes(portablemc) });
  const args = argumentsJeu({
    commun: commun || path.join(racine, 'commun'), jeu: dossierJeu, memoireGo, pseudo: reglages.pseudo,
    neoforge: manifeste.jeu.neoforge, serveur: sansServeur ? null : manifeste.serveur, dry: !!dry,
    marque: { nom: 'Casteria', version: R.VERSION },
  });
  journal.info('commande : ' + executable + ' ' + args.join(' '));
  signal({ type: 'depart', pseudo: reglages.pseudo, memoireGo });

  // Pendant la partie : le journal du jeu, lu en direct (surveillance.js). Connexion refusée ou coupée : le jeu est
  // fermé proprement et le joueur lit pourquoi. Jamais les menus de Minecraft.
  let pidJeu = null;
  let fin = null;
  const surveillance = creerSurveillance({
    surEvenement: ev => {
      if (ev.type === 'entree') {
        journal.info('connexion acceptée par le serveur : ' + reglages.pseudo);
        noterPseudoValide(racine, reglages.pseudo, journal);
        signal({ type: 'entre_serveur', pseudo: reglages.pseudo });
      } else if (ev.type === 'silence') {
        journal.info('aucune réponse du jeu après « Connecting to » : le launcher demande la raison au serveur');
        sonderConnexion({ adresse: manifeste.serveur.adresse, port: manifeste.serveur.port, pseudo: reglages.pseudo })
          .then(r => { journal.info('réponse du serveur à la sonde : ' + JSON.stringify(r)); surveillance.raisonServeur(r); });
      } else if (ev.type === 'fin') {
        fin = ev;
        journal.info('fin de la partie : ' + ev.cas + (ev.texte ? ' (« ' + ev.texte.replace(/\n/g, ' ') + ' »)' : ''));
        if (ev.cas === 'plantage' && ev.rapport) copierRapport(ev.rapport, racine, journal);
        signal({ type: 'fin_partie', cas: ev.cas, rouge: ev.rouge, message: ev.message });
        // Un plantage a déjà fermé le jeu ; sinon, on le ferme.
        if (ev.cas !== 'plantage' && pidJeu) {
          fermerJeu(pidJeu, { journal }).then(f => journal.info('fermeture du jeu : ' + f));
        }
      }
    },
  });
  const minuteur = setInterval(() => surveillance.tic(), 1000);
  // La connexion réseau du jeu vers l'adresse ET le port du serveur, toutes les 2 s une fois entré (connexion_jeu.js) :
  // « Déconnexion » dans le menu Échap n'écrit rien dans le journal du jeu.
  let adressesServeur = null;
  try {
    adressesServeur = (await require('dns').promises.lookup(manifeste.serveur.adresse, { all: true })).map(a => a.address);
  } catch (e) { journal.avert('adresse du serveur introuvable pour la surveillance : ' + (e.code || e.message)); }
  let verifEnCours = false;
  const minuteurReseau = setInterval(() => {
    if (verifEnCours || !pidJeu || surveillance.etat !== 'entre') return;
    verifEnCours = true;
    connecteAuServeur({ pid: pidJeu, adresses: adressesServeur, port: manifeste.serveur.port })
      .then(r => surveillance.connexionReseau(r), () => {})
      .then(() => { verifEnCours = false; });
  }, 2000);
  const signalPartie = s => { if (s.type === 'jeu_lance') pidJeu = s.pid; signal(s); };
  let resultat;
  try {
    resultat = await lancer({ portablemc: executable, args, signal: signalPartie, journal, surLigneJeu: (t, o) => surveillance.ligne(t, o) });
  } finally {
    clearInterval(minuteur);
    clearInterval(minuteurReseau);
  }
  journal.info('portablemc terminé : code ' + resultat.code + ', jeu ' + resultat.pidJeu +
    ', code du jeu ' + resultat.codeJeu);
  // Le launcher a arrêté la partie lui-même (et dit pourquoi) : ce n'est pas un échec du lancement.
  if (fin) return { bilan, resultat, fin };
  if (resultat.code !== 0 || resultat.erreurs.length) {
    const e = new Error(resultat.glibcManquante ? 'Le système est trop ancien (il manque glibc ' + resultat.glibcManquante + ').'
      : 'Le lancement a échoué.');
    e.code = resultat.glibcManquante ? 'systeme_trop_ancien' : 'lancement';
    e.resultat = resultat;
    throw e;
  }
  return { bilan, resultat };
}

// Ce que la fenêtre montre avant le clic sur Jouer : le numéro de la mise en ligne, les nouvelles datées et le serveur.
// Même vérification que pour jouer (signature comprise) ; sans internet, rien (la fenêtre n'affiche alors pas la liste).
async function apercu({ reglages, clePublique }) {
  const source = reglages.manifeste || R.MANIFESTE_PAR_DEFAUT;
  if (!source) return null;
  const { manifeste } = await chargerManifeste({ source, clePublique: clePublique || R.CLE_PUBLIQUE_PAR_DEFAUT });
  return { miseEnLigne: manifeste.mise_en_ligne, nouvelles: manifeste.nouvelles || [], serveur: manifeste.serveur };
}

module.exports = { jouer, apercu, pourJoueur, messageJoueur, serveurRepond, noterPseudoValide, copierRapport, TEXTE_SERVEUR_FERME };
