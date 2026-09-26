# Le contrat entre la page (ae) et la logique (a7)

ae écrit `index.html` et `theme/` (theme.css, images, polices). a7 écrit `app.js`, `maquette.js`, `electron/main.js`,
`electron/preload.js` et `src/`. La page ne parle au launcher que par `window.casteria` (preload.js).

`app.js` lit et remplit les éléments ci-dessous. **Tous sont facultatifs** : un élément absent est ignoré. Le texte
d'un élément rempli par app.js est remplacé (textContent) : n'y mettez pas d'enfants à garder.

`index.html` charge, dans cet ordre et à la fin du body : `<script src="maquette.js"></script>` puis
`<script src="app.js"></script>`. La CSP autorise seulement 'self' (scripts, styles, polices) et `data:` pour les images.

## Les états, sur `<body>` (à styler)

| Attribut | Valeurs | Quand |
|---|---|---|
| `data-ecran` | `accueil`, `reglages`, `bienvenue` | l'écran affiché (bienvenue : pas encore de pseudo) |
| `data-etat` | `pret`, `maj`, `installation`, `lancement`, `en-jeu`, `erreur` | maj : vérification et téléchargement de nos fichiers ; installation : Minecraft et la première préparation du jeu ; en-jeu : la fenêtre est cachée pendant la partie |
| `data-serveur` | `inconnu`, `en-ligne`, `hors-ligne`, `injoignable` | inconnu : pendant le premier ping ; hors-ligne : serveur fermé ; injoignable : pas d'internet |
| `--progression` (variable CSS) | de 0 à 1 | la barre de progression |
| `data-maj-launcher` | absent, `telechargement`, `pret`, `installateur` | la mise à jour du launcher lui-même : absent quand il n'y en a pas ; telechargement : sa nouvelle version arrive (en fond, rien ne bloque) ; pret : elle est vérifiée, active au prochain démarrage ; installateur : la nouvelle version demande un nouveau moteur, donc de retélécharger l'installation |
| `--progression-launcher` (variable CSS) | de 0 à 1 | l'avancée du téléchargement de la nouvelle version du launcher |

## Les écrans

Chaque écran est un élément `[data-ecran-de="accueil"]`, `[data-ecran-de="reglages"]` ou `[data-ecran-de="bienvenue"]` :
app.js met `hidden` sur ceux qui ne sont pas affichés (prévoir `[hidden] { display: none }`).

## Les actions (des boutons, n'importe où)

| Élément | Effet |
|---|---|
| `[data-aller="reglages"]`, `[data-aller="accueil"]` | change d'écran |
| `[data-action="jouer"]` | lance tout ; app.js le met `disabled` s'il n'y a pas de pseudo ou pendant une partie, et lui pose `data-occupe="oui"` ou `"non"` |
| `#jouer-texte` (dans le bouton) | reçoit « JOUER » ou « EN ROUTE... » ; sans lui, c'est le bouton entier qui reçoit le texte |
| `[data-action="reduire"]`, `[data-action="fermer"]` | la barre de titre (fermer pendant une partie cache la fenêtre sans couper le jeu). La barre : `-webkit-app-region: drag`, ses boutons : `no-drag` |
| `[data-action="ouvrir-jeu"]`, `[data-action="ouvrir-journaux"]` | ouvre le dossier du jeu, ou celui des journaux |
| `[data-action="commencer"]` | écran bienvenue : enregistre le pseudo et passe à l'accueil (désactivé tant que le pseudo n'est pas bon) |
| `[data-action="redemarrer"]` | redémarre le launcher sur sa nouvelle version (à montrer avec `data-maj-launcher="pret"` ; sans effet pendant une partie) |
| `[data-action="nouvel-installateur"]` | ouvre, dans le navigateur, la page de l'installateur (à montrer avec `data-maj-launcher="installateur"`) |
| `#maj-launcher-texte` | « Une nouvelle version du launcher arrive : 45 % », « Une nouvelle version du launcher est prête. », ou « Une nouvelle version du launcher demande de retélécharger son installation. » |

## Accueil

| id | Contenu |
|---|---|
| `serveur-etat` | « En ligne », « Serveur fermé pour le moment », « Pas de connexion internet », « Connexion au serveur... » |
| `serveur-joueurs` | « 3 joueurs sur 60 » (vide si le serveur ne répond pas) |
| `serveur-latence` | « 26 ms » |
| `serveur-motd` | la description du serveur : des `<span>` avec `data-couleur` (nom Minecraft : `gold`, `yellow`, `green`, `gray`, `dark_purple`... ou `hex`, avec la couleur dans la variable `--couleur`), et `data-gras`, `data-italique`, `data-souligne`, `data-barre` = `"oui"` ; `<br>` aux retours à la ligne |
| `serveur-noms` (une `<ul>`) | un `<li>` par joueur connecté (vrais pseudos seulement, 12 au plus : le serveur n'en montre pas plus), avec `data-pseudo`, `data-tete` (0 à 8, toujours le même pour un même pseudo : une des 9 têtes de base) et `title` = le pseudo ; `hidden` si personne ; `data-plus="15"` sur la liste quand il y a plus de joueurs connectés que de pseudos montrés (retiré sinon) |
| `nouvelles` | les nouvelles datées, la plus récente en haut ; `hidden` tant qu'il n'y en a pas |
| `modele-nouvelle` (un `<template>`) | le modèle d'UNE nouvelle ; app.js le clone et remplit `[data-champ="numero"]` (« 17 »), `[data-champ="titre"]` (« Mise en ligne 17 »), `[data-champ="date"]` (« 25/09/2026 », avec l'attribut `datetime` si c'est un `<time>`) et `[data-champ="lignes"]` (une `<ul>` : un `<li>` par ligne). La première (la plus récente) reçoit `data-recente="oui"` (les autres `"non"`) et, si le modèle est ou contient un `<details>`, elle seule est ouverte. Sans modèle : `<article><h3/><time/><ul/></article>` |
| `edition` | « Mise en ligne 17 » |
| `pseudo-affiche` | le pseudo du joueur |
| `etat` | la ligne d'état (« Téléchargement de Minecraft : 41 % »...) |
| `barre` | la barre de progression (app.js règle sa largeur ; `--progression` suffit si vous préférez) |
| `probleme` | un problème, sur sa ligne à lui ; `hidden` quand il n'y en a pas. Sur un système où le jeu ne peut pas se lancer (Linux trop ancien pour PortableMC, depuis la 1.0.3), il y reste dès l'ouverture, JOUER est grisé et `body` porte `data-bloque="oui"` (`"non"` sinon). Depuis la 1.0.5, la raison d'une partie arrêtée par le launcher (connexion refusée ou coupée, serveur arrêté, délai du /login, plantage) y arrive quand le jeu est fermé ; « Tu as quitté Casteria. À bientôt ! » va, lui, sur `etat` (pas de rouge) |
| `version` | « Launcher 0.1.0 » |

## Réglages

| id | Contenu |
|---|---|
| `pseudo` (input) | rempli avec le pseudo ; enregistré dès qu'il est bon (400 ms après la frappe) |
| `pseudo-aide` | votre phrase d'aide ; app.js y met l'erreur (avec `data-faux="oui"`) ou « Enregistré. », puis la remet |
| `pseudo-confirmer` (un bouton, `data-action="confirmer-pseudo"`, `hidden`) | depuis la 1.0.5 : montré quand le pseudo tapé ne diffère que par les majuscules du dernier pseudo VRAIMENT entré sur le serveur (« _FloSkyl_ n'est pas _Floskyl_ : c'est un autre joueur, sans ton île. » dans `pseudo-aide`, `data-faux="oui"`) ; le clic enregistre quand même. Absent : une boîte de confirmation du système |
| `memoire` (input range) | min 2 ; app.js règle max selon l'ordinateur et la valeur ; enregistré au relâchement |
| `memoire-valeur` | « 4 Go » |
| `memoire-aide` | « La valeur conseillée pour ton ordinateur. » ou « Conseillé pour ton ordinateur : 4 Go. » |

## Bienvenue

| id | Contenu |
|---|---|
| `bienvenue-pseudo` (input) | le premier pseudo (Entrée = « C'est parti ») |
| `bienvenue-aide` | votre phrase d'aide ; l'erreur s'y affiche (avec `data-faux="oui"`) |

## Les photos sans Electron

`maquette.js` imite le launcher quand la page est ouverte dans un navigateur. Les scènes, par l'adresse :
`#accueil`, `#telechargement`, `#installation`, `#erreur`, `#bienvenue`, `#reglages`, `#hors-ligne`, `#injoignable`,
`#longue` (beaucoup de nouvelles et de joueurs), `#maj-telechargement`, `#maj-pret`, `#maj-installateur`.
