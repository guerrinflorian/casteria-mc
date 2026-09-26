'use strict';
// Maquette : quand la page est ouverte HORS d'Electron (un navigateur, pour la dessiner et la photographier), elle
// imite le launcher. Dans Electron, preload.js a déjà donné window.casteria : ce fichier ne fait rien.
// Les scènes, par l'adresse : #accueil, #telechargement, #installation, #erreur, #bienvenue, #reglages, #hors-ligne,
// #injoignable, #longue (beaucoup de nouvelles et de joueurs), et la mise à jour du launcher : #maj-telechargement,
// #maj-pret, #maj-installateur ; #linux-ancien (un système où le jeu ne peut pas se lancer : JOUER grisé) ; les fins de
// partie (1.0.5) : #refus-liste, #login-delai, #quitte, et #serveur-ferme (refusé avant le lancement).
(function () {
  if (window.casteria) return;
  const scene = (location.hash || '#accueil').slice(1);
  let rappel = () => {};
  const verifier = p => {
    if (!p) return 'Choisis un pseudo.';
    if (p.length < 3) return 'Ton pseudo est trop court : 3 caractères au moins.';
    if (p.length > 16) return 'Ton pseudo est trop long : 16 caractères au plus.';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(p)) return 'Ton pseudo ne peut contenir que des lettres sans accent, des chiffres et le tiret du bas _.';
    return null;
  };
  // Les vraies lignes (00, relues par 5b), dans launcher/nouvelles/.
  const NOUVELLES = [
    { mise_en_ligne: 17, date: '2026-09-25', lignes: [
      "Ton animal apprivoisé oublié au palais n'est plus perdu : il retourne auprès de toi, sur ton île.",
    ] },
    { mise_en_ligne: 16, date: '2026-09-25', lignes: [
      "Nouvelle commande /etabli : l'Établi de Casteria partout où tu es, dès le niveau 45 (ou plus tôt avec /avantages ou la /boutique).",
      "Les points de vie s'affichent au-dessus des bêtes, des monstres et des boss.",
      'Choisis la couleur de ton pseudo dans la /boutique. La liste des joueurs est maintenant rangée par niveau.',
      "Dans la /boutique, les commandes s'achètent aussi pour toujours, et les œufs de bêtes exclusives par 3.",
    ] },
    { mise_en_ligne: 15, date: '2026-09-25', lignes: [
      'La /boutique est refaite : deux Pass de 14 jours, et les clés de toutes les caisses mystères.',
      'Les caisses mystères suivent ton niveau : leurs gains grandissent avec toi, et les gros lots sortent plus souvent.',
      "Nouveau dans la /boutique : 3 familiers et 3 bêtes exclusifs, comme le Phénix d'or et le Capybara doré. Plus aucun familier ne scintille.",
      'Sur ton île, un visiteur ne peut plus voler ni blesser tes bêtes.',
    ] },
  ];
  const MOTD = [
    { texte: '             ', couleur: null },
    { texte: '✦ CASTERIA ✦', couleur: 'gold', gras: true },
    { texte: ' · Skyblock 1.21.1\n   ', couleur: 'gray' },
    { texte: 'Ton île, tes machines, 15 boss : ', couleur: 'green' },
    { texte: 'bâtis ta fortune !', couleur: 'yellow' },
  ];
  // 12 joueurs : le plus que le serveur montre (players.sample) ; le compte total peut être plus grand.
  const NOMS = ['_Floskyl_', 'Blackhurt54', 'Lina_22', 'MaxLePro', 'Capy_Fan', 'Zelphyr', 'Nono_31', 'KiwiCraft', 'Tom_B',
    'Eliott', 'Mael_75', 'Roxane'];
  const serveur = {
    'hors-ligne': { etat: 'hors-ligne', raison: 'ECONNREFUSED' },
    injoignable: { etat: 'injoignable', raison: 'ENOTFOUND' },
  }[scene] || {
    etat: 'en-ligne', joueurs: { enLigne: scene === 'longue' ? 27 : NOMS.length, max: 60, noms: NOMS }, motd: MOTD,
    version: { nom: '1.21.1', protocole: 767 }, latenceMs: 38,
  };

  // Les fins de partie (textes de src/surveillance.js).
  const FINS = {
    'refus-liste': { cas: 'liste_blanche', rouge: true,
      message: "Le serveur n'a pas accepté ce pseudo. Vérifie son orthographe (majuscules comprises), ou demande au staff de t'ajouter, sur Discord ou par un ticket sur le site de Casteria." },
    'login-delai': { cas: 'login_delai', rouge: true,
      message: "Tu n'as pas tapé ton mot de passe à temps. Relance le jeu, puis tape-le dans la minute : /register la première fois, /login ensuite." },
    quitte: { cas: 'quitte', rouge: false, message: 'Tu as quitté Casteria. À bientôt !' },
  };

  window.casteria = {
    etat: async () => ({
      version: '1.0.0', pseudo: scene === 'bienvenue' ? '' : '_Floskyl_', memoireGo: null,
      memoireConseillee: 4, memoireTotaleGo: 15.6, enCours: false,
      majLauncher: {
        'maj-telechargement': { etat: 'telechargement', version: '1.0.1', part: 0.45 },
        'maj-pret': { etat: 'pret', version: '1.0.1' },
        'maj-installateur': { etat: 'installateur', version: '2.0.0' },
      }[scene] || null,
      bloque: scene === 'linux-ancien'
        ? 'Ton Linux est trop ancien pour lancer le jeu : il faut Ubuntu 24.04, Linux Mint 22 ou plus récent.' : null,
      pseudoValide: '_Floskyl_',
    }),
    apercu: async () => (scene === 'injoignable' ? null : { miseEnLigne: 17, nouvelles: NOUVELLES, serveur: null }),
    etatServeur: async () => serveur,
    verifierPseudo: async p => verifier(p),
    enregistrerReglages: async d => {
      const f = d.pseudo !== undefined ? verifier(d.pseudo) : null;
      return f ? { ok: false, champ: 'pseudo', message: f } : { ok: true };
    },
    jouer: () => new Promise(fin => {
      if (scene === 'erreur') {
        fin({ ok: false, message: "Un fichier n'a pas pu être téléchargé : vérifie ta connexion internet, puis réessaie." });
        return;
      }
      rappel({ type: 'manifeste', miseEnLigne: 17, minecraft: '1.21.1', neoforge: '21.1.251', signe: true, nouvelles: NOUVELLES });
      if (scene === 'telechargement') rappel({ type: 'maj_progres', octets: 2.3e6, octetsTotal: 3.5e6, fichiers: 150, fichiersTotal: 233 });
      else if (scene === 'installation') rappel({ type: 'telechargement_jeu', fait: 1830, total: 4362, octets: 262e6, octetsTotal: 624e6 });
      else if (FINS[scene]) {
        // La partie arrêtée par le launcher (1.0.5) : le message quand le jeu est fermé.
        rappel(Object.assign({ type: 'fin_partie' }, FINS[scene]));
        rappel({ type: 'jeu_ferme', code: 0 });
        fin({ ok: true, fin: FINS[scene] });
      } else if (scene === 'serveur-ferme') fin({ ok: false, message: 'Le serveur est fermé pour le moment, réessaie dans un instant.' });
      else fin({ ok: true });
      // Les scènes de progression restent figées pour la photo.
    }),
    ouvrirDossier: async () => '',
    reduire: async () => {},
    fermer: async () => {},
    redemarrer: async () => true,
    ouvrirInstallateur: async () => {},
    surSignal: f => { rappel = f; },
  };
  document.addEventListener('casteria-pret', () => {
    if (scene === 'reglages') document.querySelector('[data-aller="reglages"]') && document.querySelector('[data-aller="reglages"]').click();
    if (['telechargement', 'installation', 'erreur', 'serveur-ferme'].concat(Object.keys(FINS)).includes(scene)) {
      const b = document.querySelector('[data-action="jouer"]');
      if (b) b.click();
    }
  });
})();
