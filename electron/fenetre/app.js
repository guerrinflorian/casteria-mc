'use strict';
// La logique de la page du launcher (a7). Le dessin est à ae (index.html et theme/) : les deux se parlent par le
// contrat CONTRAT_FENETRE.md (des id, des data-*). Tout élément du contrat est facultatif : absent, il est ignoré.
// La page ne touche à aucun fichier : elle demande au launcher par window.casteria (preload.js).
(function () {
  const api = window.casteria;
  const corps = document.body;
  const $ = id => document.getElementById(id);
  const tous = sel => Array.from(document.querySelectorAll(sel));
  const ecrire = (id, t) => { const e = $(id); if (e) e.textContent = t; };
  const accord = (n, un, plusieurs) => n + ' ' + (n <= 1 ? un : plusieurs);
  const pourcent = (a, b) => (b ? Math.min(100, Math.floor(100 * a / b)) : 100);
  const mo = n => (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
  const dateFr = iso => String(iso || '').split('-').reverse().join('/');

  let conseillee = 4;
  let pseudo = '';
  let occupe = false;
  let bloque = null; // la phrase qui dit pourquoi le jeu ne peut pas se lancer sur ce système (Linux trop ancien)
  let pseudoValide = ''; // le dernier pseudo VRAIMENT entré sur le serveur (jamais un pseudo refusé)
  let pseudoEnAttente = null; // un pseudo qui ne diffère de pseudoValide que par les majuscules, en attente d'accord
  let finPartie = null;

  // ---- Les écrans et les états (data-* sur body, que le thème peut styler) ----
  function ecran(nom) {
    corps.dataset.ecran = nom;
    for (const e of tous('[data-ecran-de]')) e.hidden = e.dataset.ecranDe !== nom;
  }
  function etat(nom) { corps.dataset.etat = nom; majBoutonJouer(); }
  function progression(part) {
    const p = Math.max(0, Math.min(1, part));
    corps.style.setProperty('--progression', String(p));
    const barre = $('barre');
    if (barre) barre.style.width = Math.round(p * 100) + '%';
  }
  function montrerEtat(texte, part) { ecrire('etat', texte); if (part !== undefined) progression(part); }
  function montrerProbleme(texte) {
    const e = $('probleme');
    if (!e) return;
    e.textContent = texte || '';
    e.hidden = !texte;
  }
  function majBoutonJouer() {
    const pret = !occupe && !!pseudo && !bloque;
    for (const b of tous('[data-action="jouer"]')) {
      b.disabled = !pret;
      b.dataset.occupe = occupe ? 'oui' : 'non';
    }
    const t = occupe ? 'EN ROUTE...' : 'JOUER';
    if ($('jouer-texte')) ecrire('jouer-texte', t);
    else for (const b of tous('[data-action="jouer"]')) b.textContent = t;
  }

  // ---- L'état du serveur en direct (ping du protocole Minecraft, toutes les 30 s) ----
  const TEXTES_SERVEUR = {
    inconnu: 'Connexion au serveur...',
    'en-ligne': 'En ligne',
    'hors-ligne': 'Serveur fermé pour le moment',
    injoignable: 'Pas de connexion internet',
  };
  function montrerServeur(r) {
    const e = r ? r.etat : 'inconnu';
    corps.dataset.serveur = e;
    ecrire('serveur-etat', TEXTES_SERVEUR[e] || '');
    const j = r && r.joueurs;
    ecrire('serveur-joueurs', j && j.enLigne !== null ? accord(j.enLigne, 'joueur', 'joueurs') + ' sur ' + j.max : '');
    ecrire('serveur-latence', r && Number.isInteger(r.latenceMs) ? r.latenceMs + ' ms' : '');
    // La description : des morceaux colorés, en textContent (jamais du HTML venu du serveur).
    const motd = $('serveur-motd');
    if (motd) {
      motd.textContent = '';
      for (const m of (r && r.motd) || []) {
        m.texte.split('\n').forEach((bout, i) => {
          if (i > 0) motd.appendChild(document.createElement('br'));
          if (!bout) return;
          const s = document.createElement('span');
          s.textContent = bout;
          if (m.couleur) {
            if (m.couleur.startsWith('#')) { s.dataset.couleur = 'hex'; s.style.setProperty('--couleur', m.couleur); }
            else s.dataset.couleur = m.couleur;
          }
          for (const k of ['gras', 'italique', 'souligne', 'barre']) if (m[k]) s.dataset[k] = 'oui';
          motd.appendChild(s);
        });
      }
    }
    const noms = $('serveur-noms');
    if (noms) {
      noms.textContent = '';
      for (const n of (j && j.noms) || []) {
        const li = document.createElement('li');
        li.textContent = n;
        li.dataset.pseudo = n;
        li.dataset.tete = String(teteDe(n));
        li.title = n;
        noms.appendChild(li);
      }
      noms.hidden = !(j && j.noms && j.noms.length);
      // Plus de joueurs connectés que de pseudos montrés (le serveur en montre 12 au plus) : « +15 » dans le thème.
      const plus = j && j.noms && Number.isInteger(j.enLigne) ? j.enLigne - j.noms.length : 0;
      if (plus > 0) noms.dataset.plus = String(plus);
      else delete noms.dataset.plus;
    }
  }
  async function rafraichirServeur() {
    if (document.hidden || corps.dataset.etat === 'en-jeu') return;
    try { montrerServeur(await api.etatServeur()); } catch (e) { /* le prochain essai dans 30 s */ }
  }

  // ---- Les nouvelles datées ----
  function montrerNouvelles(miseEnLigne, nouvelles) {
    if (miseEnLigne) ecrire('edition', 'Mise en ligne ' + miseEnLigne);
    const boite = $('nouvelles');
    if (!boite || !nouvelles || !nouvelles.length) return;
    boite.textContent = '';
    const modele = $('modele-nouvelle');
    nouvelles.forEach((n, i) => {
      let el;
      if (modele && modele.content) {
        el = modele.content.firstElementChild.cloneNode(true);
      } else {
        el = document.createElement('article');
        el.innerHTML = '<h3 data-champ="titre"></h3><time data-champ="date"></time><ul data-champ="lignes"></ul>';
      }
      // La plus récente : ouverte, et marquée (le thème lui donne un sceau rouge, les autres un sceau d'or).
      el.dataset.recente = i === 0 ? 'oui' : 'non';
      const details = el.matches('details') ? el : el.querySelector('details');
      if (details) details.open = i === 0;
      const champ = nom => el.querySelector('[data-champ="' + nom + '"]');
      if (champ('numero')) champ('numero').textContent = String(n.mise_en_ligne);
      if (champ('titre')) champ('titre').textContent = 'Mise en ligne ' + n.mise_en_ligne;
      if (champ('date')) { champ('date').textContent = dateFr(n.date); champ('date').setAttribute('datetime', n.date); }
      const ul = champ('lignes');
      if (ul) {
        for (const t of n.lignes) {
          const li = document.createElement('li');
          li.textContent = t;
          ul.appendChild(li);
        }
      }
      boite.appendChild(el);
    });
    boite.hidden = false;
  }

  // Une des 9 têtes de base de Minecraft, toujours la même pour un même pseudo (somme simple des caractères).
  function teteDe(nom) {
    let h = 0;
    for (const c of nom) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 9;
  }

  // ---- Le pseudo et la mémoire ----
  async function verifierPseudo(champ, aide, texteAide) {
    const valeur = champ.value;
    const faute = await api.verifierPseudo(valeur);
    const montrer = !!(faute && valeur);
    if (aide) { aide.textContent = montrer ? faute : texteAide; aide.dataset.faux = montrer ? 'oui' : 'non'; }
    return !faute;
  }
  // Le pseudo, en mode hors ligne, fait le joueur : « _FloSkyl_ » n'est pas « _Floskyl_ » (autre UUID, pas d'île).
  // La référence est le dernier pseudo vraiment entré sur le serveur ; sans elle, aucun avertissement rouge.
  function autreJoueur(v) {
    return !!pseudoValide && v !== pseudoValide && v.toLowerCase() === pseudoValide.toLowerCase();
  }
  function demanderConfirmation(v, aide) {
    const phrase = v + " n'est pas " + pseudoValide + " : c'est un autre joueur, sans ton île.";
    pseudoEnAttente = v;
    if (aide) { aide.textContent = phrase; aide.dataset.faux = 'oui'; }
    const bouton = $('pseudo-confirmer');
    if (bouton) { bouton.hidden = false; return; }
    // Sans le bouton du thème : la boîte de confirmation du système.
    if (window.confirm(phrase + ' Changer quand même ?')) enregistrerPseudo(v, aide);
  }
  function cacherConfirmation() {
    pseudoEnAttente = null;
    const bouton = $('pseudo-confirmer');
    if (bouton) bouton.hidden = true;
  }
  async function enregistrerPseudo(v, aide) {
    cacherConfirmation();
    const r = await api.enregistrerReglages({ pseudo: v });
    if (!r.ok) return;
    pseudo = v;
    montrerPseudo();
    if (aide) { aide.textContent = 'Enregistré.'; aide.dataset.faux = 'non'; }
  }
  function confirmerPseudo() {
    const champ = $('pseudo');
    if (pseudoEnAttente && champ && champ.value === pseudoEnAttente) enregistrerPseudo(pseudoEnAttente, $('pseudo-aide'));
  }
  function montrerPseudo() {
    ecrire('pseudo-affiche', pseudo);
    if ($('pseudo') && document.activeElement !== $('pseudo')) $('pseudo').value = pseudo;
    majBoutonJouer();
  }
  function afficherMemoire() {
    const c = $('memoire');
    if (!c) return;
    const go = Number(c.value);
    ecrire('memoire-valeur', go + ' Go');
    ecrire('memoire-aide', go === conseillee ? 'La valeur conseillée pour ton ordinateur.' : 'Conseillé pour ton ordinateur : ' + conseillee + ' Go.');
  }

  // ---- La mise à jour du launcher lui-même (son code ; l'installateur ne change pas) ----
  function montrerMajLauncher(m) {
    if (!m) { delete corps.dataset.majLauncher; return; }
    corps.dataset.majLauncher = m.etat;
    const textes = {
      telechargement: 'Une nouvelle version du launcher arrive : ' + Math.round((m.part || 0) * 100) + ' %',
      pret: 'Une nouvelle version du launcher est prête.',
      installateur: 'Une nouvelle version du launcher demande de retélécharger son installation.',
    };
    ecrire('maj-launcher-texte', textes[m.etat] || '');
    corps.style.setProperty('--progression-launcher', String(m.part || (m.etat === 'pret' ? 1 : 0)));
  }

  // ---- Jouer ----
  const MESSAGES_ERREURS = {
    error_download: 'Un téléchargement a échoué : vérifie ta connexion internet, puis réessaie.',
    error_download_entry: 'Un téléchargement a échoué : vérifie ta connexion internet, puis réessaie.',
    error_reqwest: 'Internet ne répond pas : vérifie ta connexion, puis réessaie.',
    // (le même contact que src/reglages.js, CONTACT : la page ne peut pas le charger)
    error_jvm_not_found: "Un morceau du jeu n'a pas pu être installé : réessaie, et si ça recommence, préviens le staff sur Discord ou par un ticket sur le site de Casteria.",
    error_io: "Un fichier n'a pas pu être écrit : vérifie qu'il reste de la place sur ton ordinateur.",
  };
  function surSignal(s) {
    switch (s.type) {
      case 'manifeste':
        etat('maj');
        montrerNouvelles(s.miseEnLigne, s.nouvelles);
        break;
      case 'verification':
        etat('maj');
        montrerEtat('Vérification de tes fichiers : ' + s.fait + ' sur ' + s.total, s.fait / s.total);
        break;
      case 'maj_debut':
        montrerEtat('Mise à jour : ' + mo(s.octetsTotal) + ' à télécharger.', 0);
        break;
      case 'maj_progres':
        montrerEtat('Téléchargement des fichiers de Casteria : ' + pourcent(s.octets, s.octetsTotal) + ' %',
          s.octetsTotal ? s.octets / s.octetsTotal : 1);
        break;
      case 'maj_fin':
        montrerEtat('Tes fichiers sont à jour.', 1);
        break;
      case 'telechargement_jeu':
        etat('installation');
        montrerEtat('Téléchargement de Minecraft : ' + pourcent(s.octets, s.octetsTotal) + ' %',
          s.octetsTotal ? s.octets / s.octetsTotal : 1);
        break;
      case 'installation_neoforge':
        etat('installation');
        montrerEtat('Première préparation du jeu (une seule fois, environ une minute)...', 1);
        break;
      case 'depart':
      case 'lancement':
        etat('lancement');
        montrerEtat('Lancement du jeu...', 1);
        break;
      case 'jeu_lance':
        etat('en-jeu');
        montrerEtat('Bon jeu sur Casteria !', 1);
        break;
      case 'verification_serveur':
        montrerEtat('Le serveur est-il ouvert ? Vérification...', 0);
        break;
      case 'entre_serveur':
        // La référence de l'avertissement des majuscules : le dernier pseudo vraiment entré sur le serveur.
        pseudoValide = s.pseudo || pseudoValide;
        break;
      case 'fin_partie':
        // Le launcher arrête la partie (connexion refusée ou coupée, le joueur a quitté...) : la raison s'affiche
        // quand le jeu est fermé.
        finPartie = s;
        break;
      case 'jeu_ferme':
        if (finPartie) afficherFin(finPartie);
        else {
          etat(s.code === 0 ? 'pret' : 'erreur');
          montrerEtat(s.code === 0 ? 'À bientôt sur Casteria !'
            : "Le jeu s'est fermé d'un coup. Si ça recommence, préviens le staff sur Discord ou par un ticket sur le site de Casteria (code " + s.code + ').', 0);
        }
        rafraichirServeur();
        break;
      case 'maj_launcher':
        montrerMajLauncher(s);
        break;
      case 'erreur_portablemc':
        // Jamais de code anglais pour le joueur (il est dans le journal).
        montrerProbleme(MESSAGES_ERREURS[s.code] ||
          "Le jeu n'a pas pu démarrer : réessaie, et si ça recommence, préviens le staff sur Discord ou par un ticket sur le site de Casteria.");
        break;
      default:
    }
  }
  // La raison de la fin de partie : sur la ligne rouge (un problème) ou sur la ligne d'état (le joueur a quitté).
  function afficherFin(f) {
    if (f.rouge) {
      etat('erreur');
      montrerProbleme(f.message);
      montrerEtat("La partie s'est arrêtée.", 0);
    } else {
      etat('pret');
      montrerProbleme('');
      montrerEtat(f.message, 0);
    }
  }
  async function jouer() {
    if (occupe || !pseudo || bloque) return;
    occupe = true;
    finPartie = null;
    etat('maj');
    montrerProbleme('');
    montrerEtat('Préparation...', 0);
    const r = await api.jouer();
    occupe = false;
    if (!r.ok) {
      etat('erreur');
      montrerProbleme(r.message);
      montrerEtat("Le jeu n'a pas été lancé.", 0);
    } else if (r.fin) {
      afficherFin(r.fin);
    } else if (r.dry) {
      etat('pret');
      montrerEtat("Tout est prêt (essai : le jeu n'a pas été lancé).", 1);
    } else if (corps.dataset.etat !== 'erreur') etat('pret');
    majBoutonJouer();
  }

  // ---- Les branchements ----
  function brancher() {
    api.surSignal(surSignal);
    document.addEventListener('click', ev => {
      const aller = ev.target.closest('[data-aller]');
      if (aller) { ecran(aller.dataset.aller); return; }
      const action = ev.target.closest('[data-action]');
      if (!action || action.disabled) return;
      const a = action.dataset.action;
      if (a === 'jouer') jouer();
      else if (a === 'reduire') api.reduire();
      else if (a === 'fermer') api.fermer();
      else if (a === 'ouvrir-jeu') api.ouvrirDossier('jeu');
      else if (a === 'ouvrir-journaux') api.ouvrirDossier('journaux');
      else if (a === 'commencer') commencer();
      else if (a === 'redemarrer') api.redemarrer();
      else if (a === 'nouvel-installateur') api.ouvrirInstallateur();
      else if (a === 'confirmer-pseudo') confirmerPseudo();
    });

    // Réglages : le pseudo s'enregistre dès qu'il est bon (un pseudo refusé n'est pas enregistré).
    const champ = $('pseudo');
    const aide = $('pseudo-aide');
    const texteAide = aide ? aide.textContent : '';
    let minuteur = null;
    if (champ) {
      champ.addEventListener('input', () => {
        clearTimeout(minuteur);
        cacherConfirmation();
        minuteur = setTimeout(async () => {
          if (!(await verifierPseudo(champ, aide, texteAide))) return;
          // Seules les majuscules changent par rapport au pseudo déjà entré sur le serveur : c'est un autre joueur.
          if (autreJoueur(champ.value)) { demanderConfirmation(champ.value, aide); return; }
          await enregistrerPseudo(champ.value, aide);
        }, 400);
      });
    }
    const curseur = $('memoire');
    if (curseur) {
      curseur.addEventListener('input', afficherMemoire);
      curseur.addEventListener('change', () => api.enregistrerReglages({ memoireGo: Number(curseur.value) }));
    }

    // Bienvenue : le premier pseudo.
    const champB = $('bienvenue-pseudo');
    const aideB = $('bienvenue-aide');
    const texteAideB = aideB ? aideB.textContent : '';
    if (champB) {
      champB.addEventListener('input', async () => {
        const ok = await verifierPseudo(champB, aideB, texteAideB);
        for (const b of tous('[data-action="commencer"]')) b.disabled = !ok;
      });
      champB.addEventListener('keydown', ev => { if (ev.key === 'Enter') commencer(); });
    }
    for (const b of tous('[data-action="commencer"]')) b.disabled = true;

    setInterval(rafraichirServeur, 30000);
    document.addEventListener('visibilitychange', rafraichirServeur);
  }
  async function commencer() {
    const champB = $('bienvenue-pseudo');
    if (!champB) return;
    const r = await api.enregistrerReglages({ pseudo: champB.value });
    if (!r.ok) { const a = $('bienvenue-aide'); if (a) { a.textContent = r.message; a.dataset.faux = 'oui'; } return; }
    pseudo = champB.value;
    montrerPseudo();
    ecran('accueil');
  }

  async function demarrer() {
    corps.dataset.serveur = 'inconnu';
    etat('pret');
    const e = await api.etat();
    ecrire('version', 'Launcher ' + e.version);
    pseudo = e.pseudo;
    pseudoValide = e.pseudoValide || '';
    conseillee = e.memoireConseillee;
    const c = $('memoire');
    if (c) {
      c.max = String(Math.max(2, Math.min(16, Math.floor(e.memoireTotaleGo - 2))));
      c.value = String(e.memoireGo || conseillee);
    }
    afficherMemoire();
    montrerPseudo();
    montrerServeur(null);
    montrerMajLauncher(e.majLauncher);
    ecran(pseudo ? 'accueil' : 'bienvenue');
    brancher();
    bloque = e.bloque || null;
    corps.dataset.bloque = bloque ? 'oui' : 'non';
    majBoutonJouer();
    if (bloque) {
      montrerProbleme(bloque);
      montrerEtat("Le jeu ne peut pas se lancer sur cet ordinateur.", 0);
    } else montrerEtat('Prêt.', 0);
    // Les deux demandes réseau en même temps, sans rien bloquer.
    rafraichirServeur();
    api.apercu().then(a => { if (a) montrerNouvelles(a.miseEnLigne, a.nouvelles); }).catch(() => {});
    document.dispatchEvent(new Event('casteria-pret'));
  }
  demarrer();
})();
