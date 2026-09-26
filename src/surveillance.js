'use strict';
// La surveillance de la partie (a7, code 1.0.5) : le launcher lit en direct le journal du jeu qu'il a lancé (les lignes
// que PortableMC lui transmet) et reconnaît ce qui arrive. Demande de Florian (25/09, par 5b) : un joueur ne doit JAMAIS
// se retrouver dans les menus de Minecraft (Solo, Multijoueur...). Dès que la connexion échoue ou se coupe, le launcher
// ferme le jeu proprement et dit pourquoi, en mots de joueur.
//
// Les marqueurs, lus dans les sources de Minecraft 1.21.1 et NeoForge 21.1.251, et vérifiés sur de vrais journaux (le
// passage en production de l'étape 6, le refus de Florian du 25/09) :
//   « Connecting to <adresse>, <port> »              ConnectScreen : le jeu part vers le serveur ;
//   « Sorting datapack list », « ... compatible »,   la connexion est acceptée (configuration, puis la partie) : 2 à 4 s
//   « Loaded N advancements », « [CHAT] »            après « Connecting to » en production ;
//   « Client disconnected with reason: <raison> »     ClientCommonPacketListenerImpl : coupé PENDANT la configuration ou
//                                                      la partie (expulsion, bannissement, arrêt du serveur, coupure,
//                                                      délai du /login, et le joueur qui quitte : « Fermeture en cours... ») ;
//   « Couldn't connect to server »                    ConnectScreen : serveur injoignable ;
//   « Starting integrated minecraft server »          un monde solo s'ouvre ;
//   « #@!@# Game crashed! Crash report saved to: #@!@# <chemin> »   un plantage.
// Un refus À L'ENTRÉE (liste blanche, bannissement, serveur complet) n'écrit RIEN dans le journal : le jeu montre
// seulement l'écran de déconnexion (ClientHandshakePacketListenerImpl.onDisconnect). D'où le « silence » : ni
// acceptation ni erreur quelques secondes après « Connecting to ». Le launcher demande alors au serveur la raison
// exacte (sonde_connexion.js), sans jamais relancer le jeu.
//
// Ce module ne fait qu'analyser : il rend des évènements, c'est partie.js qui agit.

const SILENCE_MS = 8000;      // sans acceptation ni erreur après « Connecting to » : refus probable, on demande au serveur
const BLOCAGE_MS = 60000;     // sans rien du tout après « Connecting to » : on arrête d'attendre
// Un plantage (code 1.0.7, texte de 00) : un seul endroit à connaître pour le joueur. Le rapport de plantage du jeu est
// recopié dans le dossier des journaux (partie.js), celui qu'ouvre le bouton des Réglages.
// Le staff se joint sur Discord ou par un ticket sur le site (décision de Florian, 25/09 : reglages.js, CONTACT).
const { CONTACT } = require('./reglages');
const CONTACT_FIN = CONTACT.replace(/^préviens le staff /, '');   // « sur Discord ou par un ticket sur le site de Casteria »
const TEXTE_PLANTAGE = "Le jeu a planté. Dans Réglages, clique sur Le journal du jeu (pour le staff), puis envoie le fichier le plus récent au staff, " + CONTACT_FIN + '.';
const ABSENCES_AVANT_QUITTE = 3; // connexion au serveur absente 3 fois de suite (2 s d'écart) : le joueur l'a quitté

const MARQUEURS_ENTREE = [
  /Sorting datapack list/, /CasinoUI\/\]: Serveur .* compatible/i, /Serveur .*\(protocole \d+\) : compatible/,
  /Loaded \d+ advancements/, /\[System\] \[CHAT\]/,
];

// La raison d'une déconnexion, en français ou en anglais (le joueur peut changer la langue du jeu), et les textes que
// nos scripts du serveur envoient (af_moderation.js, connexion.js). Le premier cas qui correspond l'emporte.
const CAS = [
  { cas: 'quitte', rouge: false, motif: /^(Fermeture en cours|Quitting)/i,
    message: 'Tu as quitté Casteria. À bientôt !' },
  { cas: 'login_delai', rouge: true, motif: /mot de passe à temps/i,
    // (00 : un nouveau joueur tape /register, et c'est lui qui risque le plus de dépasser la minute)
    message: "Tu n'as pas tapé ton mot de passe à temps. Relance le jeu, puis tape-le dans la minute : /register la première fois, /login ensuite." },
  { cas: 'liste_blanche', rouge: true, motif: /liste blanche|white-?listed/i,
    message: "Le serveur n'a pas accepté ce pseudo. Vérifie son orthographe (majuscules comprises), ou demande au staff de t'ajouter, " + CONTACT_FIN + '.' },
  { cas: 'banni', rouge: true, motif: /banni|\bbanned\b/i,
    message: "Ce pseudo est banni de Casteria. Si tu penses que c'est une erreur, " + CONTACT + '.' },
  { cas: 'expulse', rouge: true, motif: /expulsé|\bkicked\b/i,
    message: "Un membre du staff t'a déconnecté du serveur. Tu peux revenir, mais respecte les règles." },
  { cas: 'double', rouge: true, motif: /depuis un autre emplacement|from another location/i,
    message: "Quelqu'un vient d'entrer sur Casteria avec ton pseudo, depuis un autre endroit." },
  { cas: 'complet', rouge: true, motif: /serveur est complet|server is full/i,
    message: 'Le serveur est complet pour le moment : réessaie dans quelques minutes.' },
  { cas: 'arret', rouge: true, motif: /^(Serveur fermé|Server closed)/i,
    message: "Le serveur redémarre ou s'est arrêté. Réessaie dans une minute." },
  { cas: 'inactif', rouge: true, motif: /immobile trop longtemps|idle for too long/i,
    message: "Tu es resté immobile trop longtemps : le serveur t'a déconnecté." },
  { cas: 'coupure', rouge: true,
    motif: /Délai de connexion expiré|Timed out|Connexion perdue|Connection lost|Fin du flux|End of stream|Internal Exception|Connection reset|IOException|Échec de connexion|Failed to connect/i,
    message: 'La connexion avec le serveur a été coupée (internet ou serveur). Réessaie dans un instant.' },
];

// Les clés de traduction que le serveur envoie au refus d'entrée (lues par la sonde, sans traduction).
const CLES = {
  'multiplayer.disconnect.not_whitelisted': 'liste_blanche',
  'multiplayer.disconnect.banned': 'banni', 'multiplayer.disconnect.banned.reason': 'banni',
  'multiplayer.disconnect.banned_ip.reason': 'banni', 'multiplayer.disconnect.ip_banned': 'banni',
  'multiplayer.disconnect.server_full': 'complet', 'multiplayer.disconnect.duplicate_login': 'double',
  'multiplayer.disconnect.server_shutdown': 'arret', 'multiplayer.disconnect.kicked': 'expulse',
  'disconnect.timeout': 'coupure', 'disconnect.lost': 'coupure',
};

function nettoyer(texte) {
  // Les codes de couleur « § » et les espaces en trop ; 300 caractères au plus.
  return String(texte || '').replace(/§[0-9a-fk-or]/gi, '').replace(/[ \t]+/g, ' ').trim().slice(0, 300);
}

function parCas(cas) { return CAS.find(c => c.cas === cas) || null; }

// Rend { cas, rouge, message, texte } pour la raison (texte du jeu, ou clé de traduction de la sonde).
function classerRaison(texte, cle) {
  const t = nettoyer(texte);
  const c = (cle && CLES[cle] && parCas(CLES[cle])) || CAS.find(x => x.motif.test(t));
  if (c) return { cas: c.cas, rouge: c.rouge, message: c.message, texte: t };
  // Une raison que le launcher ne connaît pas : celle du serveur, telle quelle (elle est écrite pour les joueurs).
  // L'en-tête « ✦ CASTERIA ✦ » de nos messages ne dit rien (« ? CASTERIA ? » si la sortie du jeu n'était pas en UTF-8).
  const premiere = t.split('\n').map(s => s.trim()).filter(s => s && !/^[✦?]\s*CASTERIA\s*[✦?]$/i.test(s)).join(' ');
  return {
    cas: 'autre', rouge: true, texte: t,
    message: premiere ? "Le serveur t'a déconnecté : « " + premiere.slice(0, 200) + ' »' : "Le serveur t'a déconnecté.",
  };
}

// La machine à états. surEvenement reçoit :
//   { type: 'connexion' }                      le jeu part vers le serveur
//   { type: 'entree' }                         la connexion est acceptée (le pseudo est bon)
//   { type: 'fin', cas, rouge, message, ... }  la partie doit s'arrêter (le jeu est à fermer, sauf un plantage)
//   { type: 'silence' }                        refus probable à l'entrée : demander la raison au serveur
// tic(maintenant) se lance chaque seconde : il repère le silence et le blocage.
function creerSurveillance({ surEvenement, horloge = Date.now }) {
  let etat = 'demarrage';          // demarrage, connexion, silence, entre, fini
  let depuis = 0;
  let fin = null;
  // La raison d'une déconnexion, en cours de lecture : la sortie brute du jeu donne un message sur plusieurs lignes en
  // plusieurs lignes (« ✦ CASTERIA ✦ », « », « Tu n'as pas entré ton mot de passe à temps. »). Elle se termine à la
  // prochaine ligne du journal (« [15:59:49] [... »), à un évènement structuré, ou au tic suivant (0,7 s).
  let raison = null;
  let absences = 0;
  let vueConnectee = false;
  const finir = f => {
    if (fin) return;
    fin = f;
    etat = 'fini';
    surEvenement(Object.assign({ type: 'fin' }, f));
  };
  const terminerRaison = () => {
    if (!raison) return;
    const r = raison;
    raison = null;
    finir(classerRaison(r.texte));
  };
  return {
    get etat() { return etat; },
    get fin() { return fin; },
    ligne(brute, options) {
      const suiteBrute = !!(options && options.brute);
      if (raison) {
        const b = String(brute || '');
        if (suiteBrute && !/^\s*\[\d{2}:\d{2}:\d{2}\] \[/.test(b) && !/#@[!?]@#/.test(b)) {
          raison.texte += '\n' + b;
          return;
        }
        terminerRaison();
      }
      if (fin && fin.cas !== 'quitte') return;
      // PortableMC échappe les retours à la ligne des messages : on les rend pour l'analyse. Mais il n'échappe pas les
      // « \ » : un chemin Windows (C:\Users\nathan\...) se lit donc dans la ligne BRUTE, jamais dans la ligne rendue.
      const brut = String(brute || '');
      const texte = brut.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      let m;
      if ((m = /#@!@# Game crashed! Crash report saved to: #@!@#\s*(.+)$/.exec(brut))) {
        fin = null;
        finir({ cas: 'plantage', rouge: true, rapport: m[1].trim(),
          message: TEXTE_PLANTAGE });
        return;
      }
      if (/#@\?@# Game crashed!/.test(texte)) {
        fin = null;
        finir({ cas: 'plantage', rouge: true, rapport: null,
          message: TEXTE_PLANTAGE });
        return;
      }
      if (fin) return;
      if (/Connecting to .+, \d+/.test(texte)) {
        etat = 'connexion';
        depuis = horloge();
        surEvenement({ type: 'connexion' });
        return;
      }
      if ((m = /Client disconnected with reason: ([\s\S]*)$/.exec(texte))) {
        // Une ligne brute : la suite de la raison peut arriver sur les lignes suivantes.
        if (suiteBrute) { raison = { texte: m[1], depuis: horloge() }; return; }
        finir(classerRaison(m[1]));
        return;
      }
      if (/Couldn't connect to server|Unknown host/i.test(texte)) {
        finir(Object.assign(parCas('coupure'), { cas: 'injoignable',
          message: 'Impossible de joindre le serveur : il est peut-être fermé, ou ta connexion internet est coupée. Réessaie dans un instant.' }));
        return;
      }
      if (/Starting integrated minecraft server/.test(texte)) {
        finir({ cas: 'solo', rouge: true, message: "Casteria se joue sur le serveur : le jeu solo ne s'ouvre pas depuis le launcher." });
        return;
      }
      if ((etat === 'connexion' || etat === 'silence') && MARQUEURS_ENTREE.some(r => r.test(texte))) {
        etat = 'entre';
        surEvenement({ type: 'entree' });
      }
    },
    tic() {
      if (raison && horloge() - raison.depuis >= 700) terminerRaison();
      if (fin || (etat !== 'connexion' && etat !== 'silence')) return;
      const ecoule = horloge() - depuis;
      if (etat === 'connexion' && ecoule >= SILENCE_MS) {
        etat = 'silence';
        surEvenement({ type: 'silence' });
      } else if (etat === 'silence' && ecoule >= BLOCAGE_MS) {
        finir({ cas: 'bloque', rouge: true, message: "La connexion au serveur n'a pas abouti. Réessaie dans un instant." });
      }
    },
    // La connexion réseau du jeu vers le serveur (connexion_jeu.js), toutes les 2 s après l'entrée. « Déconnexion »
    // dans le menu Échap n'écrit rien dans le journal : seule la connexion qui disparaît le dit. Une coupure d'une
    // ou deux secondes ne compte pas : il faut 3 absences de suite (demande de 5b). null : on ne sait pas, rien.
    connexionReseau(presente) {
      if (fin || raison || etat !== 'entre' || presente === null || presente === undefined) return;
      if (presente) { absences = 0; vueConnectee = true; return; }
      if (!vueConnectee) return;
      if (++absences >= ABSENCES_AVANT_QUITTE) finir(Object.assign({}, parCas('quitte'), { cas: 'quitte', texte: 'connexion au serveur fermée' }));
    },
    // La réponse de la sonde (sonde_connexion.js) après un silence.
    raisonServeur(r) {
      if (fin || etat !== 'silence' || !r || r.etat !== 'refuse') return;
      finir(classerRaison(r.texte, r.cle));
    },
  };
}

module.exports = { creerSurveillance, classerRaison, SILENCE_MS, BLOCAGE_MS, CAS, TEXTE_PLANTAGE };
