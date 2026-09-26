#!/usr/bin/env node
'use strict';
// Le launcher de Casteria, version console (prototype a) : met les fichiers du serveur à jour, puis lance le jeu.
// La fenêtre (Electron) viendra ensuite par-dessus les mêmes modules (src/).
const fs = require('fs');
const path = require('path');
const R = require('./src/reglages');
const { creerJournal } = require('./src/journal');
const { jouer, pourJoueur, messageJoueur } = require('./src/partie');

const AIDE = [
  'Le launcher de Casteria (prototype en console, version ' + R.VERSION + ')',
  '',
  'Utilisation : node casteria.js [options]',
  '  --pseudo <nom>          ton pseudo (gardé pour les fois suivantes)',
  '  --memoire <Go>          la mémoire du jeu, de 2 à 16 Go (sinon : réglée selon ton ordinateur)',
  '  --manifeste <adresse>   le manifeste des fichiers (adresse web ou fichier)',
  '  --racine <dossier>      le dossier du launcher (par défaut : ' + R.racineParDefaut() + ')',
  '  --commun <dossier>      le dossier du jeu de base et de Java (par défaut : <racine>/commun)',
  '  --portablemc <fichier>  PortableMC (par défaut : bin/<système>-<processeur>/ du projet)',
  '  --cle-publique <pem>    la clé qui vérifie la signature du manifeste',
  '  --verifier-seulement    met les fichiers à jour, sans lancer le jeu',
  '  --dry                   prépare tout, sans lancer le jeu (PortableMC --dry)',
  "  --sans-serveur          ouvre le menu du jeu au lieu d'entrer sur le serveur",
].join('\n');

function lireArguments(liste) {
  const o = {};
  const avecValeur = {
    '--pseudo': 'pseudo', '--memoire': 'memoire', '--manifeste': 'manifeste', '--racine': 'racine',
    '--commun': 'commun', '--portablemc': 'portablemc', '--cle-publique': 'clePublique',
  };
  const drapeaux = {
    '--verifier-seulement': 'verifierSeulement', '--dry': 'dry', '--sans-serveur': 'sansServeur',
    '--aide': 'aide', '-h': 'aide', '--help': 'aide',
  };
  for (let i = 0; i < liste.length; i++) {
    const a = liste[i];
    if (avecValeur[a]) {
      if (i + 1 >= liste.length) throw pourJoueur('Il manque une valeur après ' + a + '.');
      o[avecValeur[a]] = liste[++i];
    } else if (drapeaux[a]) o[drapeaux[a]] = true;
    else throw pourJoueur('Option inconnue : ' + a + ' (voir --aide).');
  }
  return o;
}

const mo = n => (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
// En français, 0 et 1 prennent le singulier : « 1 téléchargé », « 0 retiré », « 2 retirés ».
const accord = (n, singulier, pluriel) => n + ' ' + (n <= 1 ? singulier : pluriel);
const pourcent = (a, b) => (b ? Math.floor(100 * a / b) : 100) + ' %';

// L'affichage : une ligne qui se réécrit dans un vrai terminal, des paliers de 10 % sinon.
function creerAffichage() {
  const tty = process.stdout.isTTY;
  let ligneOuverte = false;
  const paliers = {};
  function progres(cle, texte, part) {
    if (tty) {
      process.stdout.write('\r' + texte.padEnd(78));
      ligneOuverte = true;
      return;
    }
    const palier = Math.floor(part * 10);
    if (paliers[cle] === palier) return;
    paliers[cle] = palier;
    console.log(texte);
  }
  function dire(texte) {
    if (ligneOuverte) { process.stdout.write('\n'); ligneOuverte = false; }
    console.log(texte);
  }
  const MESSAGES_ERREURS = {
    error_download: 'Un téléchargement a échoué : vérifie ta connexion internet, puis relance.',
    error_download_entry: 'Un téléchargement a échoué : vérifie ta connexion internet, puis relance.',
    error_reqwest: 'Le réseau ne répond pas : vérifie ta connexion internet, puis relance.',
    error_jvm_not_found: "Java n'a pas pu être installé : relance, et si ça recommence, " + R.CONTACT + '.',
    error_io: "Un fichier n'a pas pu être écrit : vérifie la place libre sur ton disque.",
  };
  function signal(e) {
    switch (e.type) {
      case 'manifeste':
        dire('Casteria, mise en ligne ' + e.miseEnLigne + ' (Minecraft ' + e.minecraft + ', NeoForge ' + e.neoforge + ')' +
          (e.signe ? ', manifeste signé.' : ', manifeste NON signé (prototype).'));
        for (const n of e.nouvelles.slice(0, 1)) {
          dire('Ce qui change (mise en ligne ' + n.mise_en_ligne + ', ' + n.date.split('-').reverse().join('/') + ') :\n  - ' +
            n.lignes.join('\n  - '));
        }
        break;
      case 'depart':
        dire('Pseudo ' + e.pseudo + ', mémoire du jeu ' + e.memoireGo + ' Go.');
        break;
      case 'verification':
        progres('verif', 'Vérification des fichiers : ' + e.fait + '/' + e.total, e.fait / e.total);
        break;
      case 'maj_debut':
        dire('Mise à jour : ' + accord(e.fichiers, 'fichier', 'fichiers') + ' à télécharger (' + mo(e.octetsTotal) + ').');
        break;
      case 'maj_progres':
        progres('maj', 'Téléchargement des fichiers de Casteria : ' + pourcent(e.octets, e.octetsTotal) +
          ' (' + e.fichiers + '/' + e.fichiersTotal + ')', e.octetsTotal ? e.octets / e.octetsTotal : 1);
        break;
      case 'retire':
        dire('Retiré (en trop) : ' + e.chemin);
        break;
      case 'maj_fin':
        dire('Fichiers à jour : ' + accord(e.fichiers, 'vérifié', 'vérifiés') + ', ' +
          accord(e.installes, 'téléchargé', 'téléchargés') + ', ' + accord(e.retires.length, 'retiré', 'retirés') +
          (e.poses.length ? ', ' + accord(e.poses.length, 'réglage posé', 'réglages posés') + ' (premier lancement)' : '') + '.');
        break;
      case 'telechargement_jeu':
        progres('jeu', 'Téléchargement de Minecraft : ' + pourcent(e.octets, e.octetsTotal) +
          ' (' + e.fait + '/' + e.total + ')', e.octetsTotal ? e.octets / e.octetsTotal : 1);
        break;
      case 'installation_neoforge':
        dire('Installation de NeoForge (une seule fois, environ une minute)...');
        break;
      case 'neoforge_installe':
        dire('NeoForge est installé.');
        break;
      case 'java':
        dire('Java ' + e.version + ' prêt.');
        break;
      case 'lancement':
        dire('Lancement du jeu...');
        break;
      case 'jeu_lance':
        dire('Le jeu est lancé. Bon jeu sur Casteria !');
        break;
      case 'jeu_ferme':
        dire(e.code === 0 ? 'Le jeu est fermé.' : "Le jeu s'est arrêté avec le code " + e.code + '.');
        break;
      case 'verification_serveur':
        dire('Le serveur est-il ouvert ? Vérification...');
        break;
      case 'entre_serveur':
        dire('Le serveur a accepté ' + e.pseudo + '.');
        break;
      case 'fin_partie':
        dire(e.message);
        break;
      case 'erreur_portablemc':
        dire(MESSAGES_ERREURS[e.code] || 'PortableMC a rencontré une erreur (' + e.code + ').');
        break;
      default:
    }
  }
  return { dire, signal };
}

async function principal() {
  const opts = lireArguments(process.argv.slice(2));
  if (opts.aide) { console.log(AIDE); return 0; }
  const affichage = creerAffichage();

  const racine = path.resolve(opts.racine || R.racineParDefaut());
  fs.mkdirSync(racine, { recursive: true });
  const journal = creerJournal(path.join(racine, 'journaux'));
  journal.info('launcher ' + R.VERSION + ', racine ' + racine + ', arguments : ' + process.argv.slice(2).join(' '));
  try {
    const reglages = R.chargerReglages(racine);
    if (opts.pseudo !== undefined) {
      const faute = R.verifierPseudo(opts.pseudo);
      if (faute) throw pourJoueur(faute);
      reglages.pseudo = opts.pseudo;
    }
    if (opts.memoire !== undefined) {
      const go = Number(opts.memoire);
      const faute = R.verifierMemoire(go);
      if (faute) throw pourJoueur(faute);
      reglages.memoire_go = go;
    }
    if (opts.manifeste) reglages.manifeste = opts.manifeste;
    if (!reglages.manifeste && !R.MANIFESTE_PAR_DEFAUT) {
      throw pourJoueur("Aucun manifeste : donne son adresse avec --manifeste (l'hébergement n'est pas encore choisi).");
    }
    if (!reglages.pseudo && !opts.verifierSeulement) throw pourJoueur('Donne ton pseudo : --pseudo TonPseudo');
    R.enregistrerReglages(racine, reglages);

    await jouer({
      racine, reglages,
      commun: opts.commun ? path.resolve(opts.commun) : null,
      portablemc: path.resolve(opts.portablemc || require('./src/portablemc').cheminLivre({ installe: false, projet: __dirname })),
      clePublique: opts.clePublique ? fs.readFileSync(opts.clePublique, 'utf8') : null,
      verifierSeulement: !!opts.verifierSeulement, dry: !!opts.dry, sansServeur: !!opts.sansServeur,
      signal: affichage.signal, journal,
    });
    if (opts.dry) affichage.dire('Tout est prêt (essai sans lancer le jeu).');
    return 0;
  } catch (e) {
    journal.erreur((e.code ? '[' + e.code + '] ' : '') + (e.stack || e.message));
    const phrase = messageJoueur(e);
    affichage.dire(phrase);
    // La console sert aussi à l'équipe : le détail technique suit (la fenêtre, elle, le garde dans le journal).
    if (e.message && e.message !== phrase) affichage.dire('(détail : ' + e.message + ')');
    affichage.dire('Le journal : ' + journal.fichier);
    return 1;
  } finally {
    await journal.fermer();
  }
}

// Une option mal écrite est refusée avant l'ouverture du journal : on le dit simplement.
principal().then(code => { process.exitCode = code; }, e => {
  console.log(e.pourJoueur ? e.message : "Une erreur inattendue s'est produite : " + e.message);
  process.exitCode = 1;
});
