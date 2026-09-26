# Le launcher de Casteria

Le launcher des joueurs du serveur Casteria (Minecraft 1.21.1, NeoForge 21.1.251). Commencé le 25/09/2026 par
serveurmc-a7 (la logique) et serveurmc-ae (le design), sur les décisions de Florian. Il est construit sur
**PortableMC 5.0.5** (verdict du test du 25/09 : `C:\Users\guerr\test-launcher\RAPPORT_TEST_PORTABLEMC.md`).

## Ce qu'il fait

À l'ouverture, il montre l'état du serveur en direct (en ligne, joueurs, description, latence) et les nouvelles
datées des dernières mises en ligne. Au clic sur **JOUER** :

1. il lit le **manifeste** de la dernière mise en ligne sur GitHub, vérifie sa **signature** (Ed25519, clé de Florian),
   puis tout son contenu avant d'écrire quoi que ce soit (chemins, dossiers autorisés, empreintes) ;
2. il met le dossier du jeu **exactement** à l'état du manifeste : il télécharge ce qui manque ou a changé et vérifie
   son sha256 ; il range à part (`jeu/.retires/`) ce qui est en trop dans `mods/` et les dossiers kubejs du joueur (pas
   de mods perso : décision de Florian) ; il pose `options.txt` au premier lancement seulement (français, sans écran
   d'accueil, sans le conseil de déplacement) ;
3. il lance **PortableMC** : Minecraft, NeoForge et le Java de Mojang s'installent au besoin (une fois), puis le jeu
   entre directement sur le serveur. Le joueur tape son `/login` en jeu : le launcher ne connaît aucun mot de passe.

Rien ne touche au `.minecraft` du joueur : tout est dans `%APPDATA%\Casteria` (`commun\` : le jeu de base et Java ;
`jeu\` : l'instance ; `journaux\` ; `launcher.json` : le pseudo et la mémoire). Un dossier que le launcher n'a pas créé
n'est jamais modifié.

## Le projet

| Chemin | Contenu | À qui |
|---|---|---|
| `src/` | la logique commune : réglages, manifeste, synchronisation, lancement, état du serveur, une partie | a7 |
| `casteria.js` | la version console (`node casteria.js --aide`) | a7 |
| `electron/main.js`, `electron/preload.js` | la fenêtre : le processus principal et le seul passage vers la page | a7 |
| `electron/fenetre/app.js`, `maquette.js` | la logique de la page, et son imitation pour les photos sans Electron | a7 |
| `electron/fenetre/index.html`, `theme/` | le design (« Le soir sur l'île », choisi par Florian) | ae |
| `electron/fenetre/CONTRAT_FENETRE.md` | le contrat entre la page et la logique (id, data-*, états) | les deux |
| `design/` | les propositions A et B d'ae, les matières (`commun/`), ses outils | ae |
| `nouvelles/mise_en_ligne_N.txt` | « Ce qui change », écrit pour les joueurs (00, relu par 5b) | 00 |
| `tiers.json` | l'adresse officielle et l'empreinte des mods des autres auteurs | a7 |
| `amorce/` | l'amorce : le point d'entrée livré avec l'installateur, qui choisit et vérifie le code à lancer | a7 |
| `outils/` | fabriquer et publier une mise en ligne, le code du launcher, l'installateur ; les clés, l'icône, le ping, les essais | a7 |
| `outils/essai/` | les outils des essais en vrai jeu (captures de fenêtre, pilotage de la fenêtre...) | a7 |
| `art/` | le logo de Florian (2048 px) et son icône en pixel art | Florian |
| `release_joueurs/` | la sortie de la dernière mise en ligne (copie de la release GitHub ; hors de git) | |
| `bin/portablemc.exe` | PortableMC 5.0.5 (hors de git : à retélécharger, voir plus bas) | |

## Une mise en ligne (par la tête pensante, après l'accord de Florian)

```
cd C:\Users\guerr\OneDrive\Bureau\DEV\PERSO\CasteriaLauncher
rem 1. 00 écrit nouvelles\mise_en_ligne_N.txt (une ligne par point, 140 caractères au plus), relu par 5b
node outils\fabriquer_manifeste.js --paquet C:\Users\guerr\Downloads\POUR_LES_JOUEURS_mise_en_ligne_N --sortie release_joueurs --mise-en-ligne N --cle-privee C:\Users\guerr\Casteria_cles\cle_privee.pem
node outils\publier_github.js --dossier release_joueurs --essai
node outils\publier_github.js --dossier release_joueurs
node casteria.js --racine <un dossier vide> --verifier-seulement
```

- `fabriquer_manifeste.js` refuse un mod inconnu, un jar tiers qui ne correspond plus à `tiers.json` et `casino_api.js`.
  Nos fichiers sortent à plat, nommés par leur empreinte ; les mods tiers ne sont jamais copiés (KubeJS, Rhino, LibX et
  Skyblock Builder se téléchargent sur Modrinth, CurseForge en secours pour KubeJS). « Ce qui change » vient de
  `nouvelles/mise_en_ligne_N.txt` ; sans ce fichier, du LISEZMOI du paquet, en secours et avec un avertissement.
  L'historique garde les 5 dernières mises en ligne (`--nouvelles-depuis N` pour en oublier).
- `publier_github.js` vérifie tout AVANT d'envoyer (signature qui va avec la clé du launcher, empreintes, pas de retour
  en arrière sans `--retour-arriere`), envoie nos fichiers, puis le manifeste courant en dernier, et relit l'adresse
  publique en patientant jusqu'à 180 s (GitHub a mis plus de 90 s pour le code 1.0.3). Jeton : `C:\Users\guerr\Casteria_cles\github_token.txt`.
- **Le fichier signé unique** (depuis le code 1.0.3) : `manifeste.signe.json` = `{ format: 1, contenu: "<manifeste.json
  exact>", signature: "<base64>" }`, et de même `code.signe.json` pour le code du launcher. GitHub met 20 à 30 s à
  propager le remplacement d'un fichier (constaté le 25/09 à la publication du code 1.0.2) : deux fichiers séparés
  peuvent arriver l'un de la nouvelle version, l'autre de l'ancienne, et la signature paraît fausse. Un seul fichier
  arrive entier, ancien ou nouveau. Les launchers 1.0.3 et plus le lisent en premier ; l'ancien couple `.json` + `.sig`
  reste publié pour les launchers plus anciens (et sert si le fichier signé unique manque, jamais s'il est faux).
- L'hébergement : la release à étiquette fixe `joueurs` du dépôt public `guerrinflorian/casteria-mc` ; le launcher lit
  `https://github.com/guerrinflorian/casteria-mc/releases/download/joueurs/manifeste.json`. Première publication : la
  mise en ligne 17, le 25/09/2026 à 13:40.
- Les clés : `C:\Users\guerr\Casteria_cles\` (voir son LISEZMOI.txt). La clé publique est écrite dans `src/reglages.js`.

## L'installateur et la mise à jour du launcher lui-même

Décision de 5b, validée par Florian le 25/09/2026 : **le fichier que le joueur télécharge ne change jamais**. Sans
signature de code, la réputation SmartScreen s'attache à l'empreinte du fichier : un installateur qui changerait à
chaque version repartirait de zéro. Donc :

- **L'installateur** `Casteria-Installation.exe` (NSIS en un clic, pour l'utilisateur seul, sans droits
  d'administrateur, raccourcis Bureau et menu Démarrer) se fabrique par `npm run installateur` (sortie : `dist/`) et se
  publie UNE fois dans la release à étiquette fixe `installateur` : `node outils\publier_installateur.js` (d'abord
  `--essai`). L'outil refuse d'en remplacer un déjà publié, sauf `--remplacer` (un nouveau moteur seulement). Le texte de
  la page est `JOUEURS_INSTALLATION.md` (dont l'avertissement SmartScreen : « Informations complémentaires », puis
  « Exécuter quand même »). La désinstallation retire le programme, les raccourcis et `%APPDATA%\Casteria` (le jeu du
  launcher), jamais le `.minecraft` (vérifié le 25/09).
- **Publié le 25/09/2026 vers 14:30** (accord écrit de Florian, « oui publié installateur », dans la session de 5b) :
  https://github.com/guerrinflorian/casteria-mc/releases/tag/installateur (la page à donner aux joueurs), fichier
  `Casteria-Installation.exe`, 115 366 112 octets, sha256
  `449e7f020a8f49f5e7ade778beb6d2d75afd92b1250f678c6a5dca805d62d087` (code 1.0.0, moteur Electron 44.4.5, amorce du
  commit ad40ecd). **Ce fichier ne doit plus changer** : c'est lui qui gagne la réputation SmartScreen. Téléchargement
  de contrôle fait : même empreinte.
- **Le code du launcher** (`electron/`, `src/`, `package.json`) se met à jour tout seul : augmenter `version` dans
  `package.json`, puis `node outils\publier_code.js --sortie release_launcher --cle-privee C:\Users\guerr\Casteria_cles\cle_privee.pem`
  (d'abord `--essai`) : release à étiquette fixe `launcher`. Le launcher télécharge la nouvelle version en fond, la
  vérifie, et l'active au démarrage suivant (bande « prête » et bouton Redémarrer).
- **L'amorce** (`amorce/`, livrée avec l'installateur, jamais mise à jour toute seule) choisit à chaque démarrage le
  code à lancer : la dernière version téléchargée APRÈS avoir revérifié la signature de Florian et l'empreinte de chaque
  fichier, sinon la précédente, sinon le code de l'installateur. Une version qui plante ou ne répond pas au premier
  démarrage est refusée pour de bon (retour à la précédente). Rien ne s'exécute sans signature valide, même en cas
  d'erreur réseau ou de coupure au milieu d'une mise à jour. Essais : `outils/essais.js` (partie 14) et
  `outils/essai/maj_launcher_e2e.js` (la vraie fenêtre : 1.0.0 trouve 1.0.1, « prête », Redémarrer, 1.0.1 démarre).
- **Le moteur** est Electron 44.4.5 (Chromium et Node compris), figé dans l'installateur. C'est acceptable parce que la
  fenêtre ne charge que des fichiers locaux vérifiés (CSP, isolation, aucun code distant non signé). À revoir : tous
  les 6 mois, ou dès qu'une faille grave d'Electron touche une page locale. Changer de moteur = une nouvelle version du
  code qui le demande (les launchers installés affichent alors « retélécharger son installation ») et un nouvel
  installateur (`--remplacer`), qui repart de zéro pour SmartScreen.
- **Une vraie signature de code** (pour que Windows ne prévienne plus) : voir « Reste à décider ».

## Mac et Linux (versions d'essai, demande de Florian du 25/09/2026)

Le code est commun ; seul le moteur (Electron) et PortableMC changent par système. 2e fait le paquet Mac
(`plateformes/mac/`, voir son LISEZMOI : trois commandes, dont une dans Docker), cc le paquet Linux
(`plateformes/linux/` : AppImage dans Docker ubuntu:22.04, et un .tar.gz de secours) ; a7 reste le propriétaire du
projet et publie.

- **La publication** : `node outils\publier_autres_systemes.js --fichier <paquet> ...` (d'abord `--essai`, qui écrit
  le texte de la page dans `dist/page_installateur.apercu.md`). Noms fixes : `Casteria-mac-apple-silicon.zip`,
  `Casteria-mac-intel.zip`, `Casteria-Linux-x86_64.AppImage`, `Casteria-Linux-x86_64.tar.gz`, chacun vérifié contre
  son `.sha256`. L'outil n'envoie ni n'efface JAMAIS `Casteria-Installation.exe` : il vérifie son empreinte avant et
  après (celle de GitHub, puis un vrai téléchargement). Le texte de la page : une ligne pour choisir son système,
  `JOUEURS_INSTALLATION.md` (« Sur Windows »), puis `plateformes/mac/JOUEURS_MAC.md` et
  `plateformes/linux/PAGE_JOUEURS_LINUX.md` (sans son en-tête de brouillon), puis les empreintes.
  `--texte-seulement` ne change que le texte de la page (aucun fichier).
- **Mac publié le 25/09/2026 vers 15:35** (accord de Florian : « publie mac et linux vas y c'est ok », dans la session
  de 5b) : `Casteria-mac-apple-silicon.zip` (sha256 `6f0ce63d...`) et `Casteria-mac-intel.zip` (`370e1106...`), code
  1.0.2 dedans (il passe tout seul à la dernière version). `.exe` inchangé, vérifié. **Essayé par Florian sur le Mac
  d'un ami** le même jour (« ça marche niquel ») : la page dit maintenant « Sur Mac », sans « version d'essai »
  (les étapes « Ouvrir quand même » restent). Seul Linux garde « version d'essai ».
- **Linux publié le 25/09/2026 vers 15:50**, après un premier passage retenu (la config écrivait encore « lance le
  jeu avec PortableMC », refusé par Florian) : cc l'a refait avec le code 1.0.4 et la description courte de Florian
  (.desktop compris). `Casteria-Linux-x86_64.AppImage` (sha256 `00b69526...`) et `Casteria-Linux-x86_64.tar.gz`
  (`e8151df0...`). `.exe` inchangé, vérifié. Refaire : `npm run linux` n'est que l'étape `dir` ; l'AppImage se fait
  dans Docker (`plateformes/linux/docker_appimage.sh`, avec un créneau de 5b), le tar.gz par `faire_targz.js`.
- **Publié le 25/09/2026 vers 19:30** (feu vert de 5b, pages relues par 00 et ae) : le code 1.0.7 (commit 7322516 ;
  la 1.0.6 n'a jamais été publiée), les 4 paquets Linux de cc faits sur ce commit (AppImage `e1470c23...`, .deb
  `7ed3e45a...`, Arch .pacman `622f83e1...`, .tar.gz avec installer.sh `d08b42c4...`), la page de la release
  « installateur » d'ae (`page_github/page_installateur.md`, par `publier_autres_systemes.js --texte-seulement
  --page`), le README et `images/` sur main (`outils/publier_depot.js`), les titres et textes publics des releases
  « joueurs » et « launcher », et « Latest » = installateur (`outils/releases_publiques.js`). Contrôle : 17 adresses
  sur 17 en 200, `.exe` et paquets Mac inchangés, une 1.0.5 Windows installée passe seule en 1.0.7.
- **L'affichage sous Linux, ce qui est EN LIGNE (1.0.7)** : X11 (XWayland) dès que DISPLAY existe, point (relance
  avec `--ozone-platform=x11` ; `ELECTRON_OZONE_PLATFORM_HINT`, qu'Omarchy pose partout, n'est pas écouté). Wayland natif
  seulement sans XWayland (ou `CASTERIA_WAYLAND=1`, porte d'essai dite nulle part), avec `WaylandFractionalScaleV1`
  coupé SOUS HYPRLAND seulement (il casse le sway récent d'Arch : essais de cc). Avant la relance X11 du démarrage,
  main.js se confirme auprès de l'amorce (sinon, essai jamais confirmé : chaque mise à jour serait refusée). Sous
  AppImage, jamais `app.relaunch` (son « relauncher » part du montage FUSE, démonté à notre sortie) : spawn du fichier
  `.AppImage` lui-même, verrou rendu, sans les chemins de l'ancien montage (l'ancien runtime reste en vie tant que la
  nouvelle instance tourne : quelques Mo, tout se ferme avec le launcher). Garde-fou : marque « relance X11 en cours »,
  effacée par la page ; restée au démarrage suivant, plus jamais de relance ici (`x11Impossible`), Wayland natif.
  L'amorce 1.0.4 des AppImage déjà installés relance encore par `app.relaunch` après un plantage, et leur ancien
  bouton Redémarrer ne revient pas (la page d'ae le dit : rouvrir le launcher). Le texte ci-dessous décrit la 1.0.6.
- **L'affichage sous Linux** (code 1.0.6, `src/affichage.js`) : chez un ami de Florian (Arch + Hyprland, Wayland,
  écran à 1,25), Chromium 152 annonçait 1120 x 720 mais dessinait une surface 1,25 fois plus petite, coincée en haut
  à gauche. Correctif vérifié chez lui : `disable-features=WaylandFractionalScaleV1`, posé en haut de
  `electron/main.js` (l'amorce le charge avant « ready » : c'est à temps, sans toucher à l'amorce). Repli X11 : si la
  page n'a pas répondu en 20 s en Wayland (ou si le processus graphique meurt avant), le launcher le note dans
  `<racine>/electron/affichage.json`, se confirme auprès de l'amorce, et redémarre avec `--ozone-platform=x11` (un
  vrai argument : Chromium choisit sa plateforme avant d'exécuter main.js). Seulement si XWayland est là (DISPLAY) : sinon la note est oubliée et on reste en Wayland (jamais de launcher qui ne démarre plus). Dans un AppImage, toute relance (repli, Redémarrer, amorce) part du fichier AppImage (APPIMAGE), pas du montage /tmp/.mount_xxx. En X11 à cause de la note, amorce.log le dit à chaque démarrage. La page s'adapte à la taille imposée par
  un gestionnaire en mosaïque : zoom = min(largeur / 1100, hauteur / 700), 0,5 au moins ; la scène d'ae (1100 x 700)
  est centrée et le fond s'étend. `CASTERIA_ESSAI_TAILLE=800x600` (hors installation) l'essaie sous Windows, qui ne
  laisse pas redimensionner la fenêtre de l'extérieur.
- **Linux trop ancien** : le PortableMC officiel demande glibc 2.39 (Ubuntu 24.04, Linux Mint 22, Fedora 40, Debian 13
  ou plus récent). Depuis le code 1.0.3, le launcher le dit dès l'ouverture et grise JOUER (`R.systemeBloquant`,
  `CASTERIA_ESSAI_GLIBC=2.35` pour le simuler hors installation) ; au clic, l'erreur du chargeur est aussi reconnue.
  On ne recompile pas PortableMC (ce ne serait plus le binaire de son auteur) : à revoir si des joueurs le demandent.

- **Le dossier du launcher** (jamais le `.minecraft`) : Windows `%APPDATA%\Casteria` ; Mac
  `~/Library/Application Support/Casteria` ; Linux `$XDG_DATA_HOME/Casteria`, sinon `~/.local/share/Casteria`. La même
  règle dans `amorce/racine.js` (figée) et `src/reglages.js` ; l'essai 15 vérifie qu'elles s'accordent.
- **PortableMC 5.0.5** par système et processeur, signatures PGP vérifiées : `bin/win32-x64/portablemc.exe`,
  `bin/linux-x64/portablemc` (ELF x86_64), `bin/darwin-x64/portablemc` (Mach-O x86_64, sans signature : les Mac Intel ne
  l'exigent pas), `bin/darwin-arm64/portablemc` (Mach-O arm64, déjà signé « ad hoc » à la fabrication : ne pas le
  re-signer). Empreintes : `bin/empreintes.json`. Dans un paquet : `resources/bin/portablemc[.exe]` et
  `resources/bin/empreintes.json`. `src/portablemc.js` le vérifie ; sous Mac et Linux, il le recopie octet par octet
  (sans attribut de quarantaine) dans `<dossier du launcher>/bin/portablemc`, en chmod 755 (AppImage en lecture seule,
  droits perdus depuis Windows).
- **La mise à jour du code** : la même amorce et la même clé partout.
- **L'icône de la fenêtre** : `.ico` sous Windows, `electron/icones/icone-256.png` ailleurs.
- Sans Mac ni Linux ici, tout est vérifié par des outils : essai 15 (`process.platform` simulé), lecture des binaires
  (types, signature Mach-O), et les contrôles de 2e et cc sur leurs paquets.

## Jamais les menus de Minecraft (code 1.0.5, demande de Florian du 25/09/2026)

Un joueur ne doit JAMAIS se retrouver dans les menus du jeu (Solo, Multijoueur...). Le 25/09, Florian s'est retrouvé
renvoyé au menu, avec « _FloSkyl_ » au lieu de « _Floskyl_ » (en mode hors ligne, un autre joueur, refusé par la
liste blanche).

- **Avant le lancement** (`partie.js`, `serveurRepond`) : le ping du serveur, jusqu'à 3 essais à 1,5 s d'écart. S'il
  ne répond pas, le jeu ne se lance pas : « Le serveur est fermé pour le moment, réessaie dans un instant. »
- **Pendant la partie** (`src/surveillance.js`) : le journal du jeu, lu en direct (les lignes que PortableMC
  transmet). Les marqueurs ont été lus dans les sources de Minecraft 1.21.1 et NeoForge 21.1.251, puis vérifiés sur de
  vrais journaux (le passage en production de l'étape 6, le refus de Florian). Connexion acceptée : « Sorting datapack
  list », la ligne « compatible » de casinoui, « Loaded N advancements » ou le chat. Coupure pendant la configuration
  ou la partie : « Client disconnected with reason: ... ». Serveur injoignable : « Couldn't connect to server ». Monde
  solo : « Starting integrated minecraft server ». Plantage : « #@!@# Game crashed! Crash report saved to: ... ». Les
  raisons sont reconnues en français, en anglais et avec les textes de nos scripts (bannissement, expulsion, délai du
  /login).
- **Le refus à l'entrée n'écrit RIEN** dans le journal du jeu (liste blanche, bannissement, serveur complet :
  `ClientHandshakePacketListenerImpl.onDisconnect`). Si rien n'arrive 8 s après « Connecting to », la sonde
  (`src/sonde_connexion.js`) demande la raison au serveur : poignée de main « login », puis « Login Start » avec le
  pseudo. Elle lit la clé du refus (`multiplayer.disconnect.not_whitelisted`...) et raccroche si le serveur accepte.
  Sans aucune réponse du jeu au bout de 60 s, on abandonne.
- **La fermeture** (`src/fermer_jeu.js`) : la demande de fermeture de la fenêtre du jeu sous Windows (comme la croix),
  SIGTERM sous Mac et Linux, puis l'arrêt forcé seulement après 8 s. Seul le processus lancé par PortableMC est visé.
  La fenêtre du launcher revient au premier plan avec la raison, en mots de joueur (`surveillance.js`, `CAS`).
- **La sortie du jeu en UTF-8** (`-Dstdout.encoding=UTF-8`, `lancement.js`) : sous Windows, elle suivait la page de
  code cp1252. « ✦ » devenait « ? », et PortableMC jetait toute ligne accentuée, dont la raison d'un renvoi. NeoForge
  écrit en texte brut (fil `_stdout_`) : un message sur plusieurs lignes arrive en plusieurs lignes, et
  `surveillance.js` les rassemble jusqu'à la ligne suivante du journal.
- **« Déconnexion » dans le menu Échap n'écrit RIEN** dans le journal du jeu : le joueur restait sur l'écran
  « Multijoueur ». Après l'entrée, `src/connexion_jeu.js` regarde toutes les 2 s la connexion TCP du processus du jeu
  vers l'adresse ET le port du serveur (netstat sous Windows, lsof sur Mac, /proc sous Linux). Absente 3 fois de
  suite : « Tu as quitté Casteria. À bientôt ! », et le jeu est fermé. Une raison lue dans le journal passe avant.
- **La course en vrai jeu** (25/09, serveur d'essai de cc avec directauth et liste blanche, un vrai Minecraft à
  2 Go lancé par la vraie fenêtre, pilote `C:\Users\guerr\test-launcher\course_105\course.js`) : refus de la liste
  blanche, renvoi après 60 s sans /login, « Déconnexion » dans le menu Échap (le clic est envoyé à la fenêtre du jeu,
  à 427, 383 sur 854 x 480 : NeoForge ajoute une ligne « Mods »), arrêt du serveur. Chaque fois, le jeu est fermé
  proprement en moins d'une seconde et la fenêtre revient devant avec la bonne phrase. La croix du jeu : il se ferme
  seul, « À bientôt sur Casteria ! ».
- **Le pseudo** : `pseudo_valide` dans `launcher.json` est le dernier pseudo VRAIMENT entré sur le serveur (noté
  à la connexion acceptée, jamais à l'enregistrement). Dans Réglages, un pseudo qui ne diffère de lui que par les
  majuscules demande « Changer quand même » (bouton `pseudo-confirmer` d'ae). Sans référence, seulement la phrase
  d'aide sur les majuscules.

## Les essais

- `node outils/essais.js` : 166 vérifications (dont la mise à jour du code du launcher, et Mac et Linux simulés), sans lancer Java, dans `essais/<horodatage>/` : installation, deuxième
  passage, réparation, manifestes modifiés, non signés ou dangereux, fichier abîmé, dossier étranger, mise à jour, pas
  d'internet, pseudo et mémoire, PortableMC en `--dry`, publication sur un faux GitHub, état du serveur sur un faux
  serveur Minecraft, et les phrases que lit le joueur.
- `node outils/ping_serveur.js` : l'état du vrai serveur, comme le voit le launcher.
- La fenêtre sans Java : `npm install` (Electron 44.4.5 ; le programme se télécharge à la première utilisation,
  vérifié par checksums.json), puis, depuis Git Bash :
  `CASTERIA_DRY=1 CASTERIA_RACINE=<dossier d'essai> CASTERIA_COMMUN=C:/Users/guerr/test-launcher/mc ./node_modules/.bin/electron . --remote-debugging-port=9333`
  et `node outils/essai/piloter_fenetre.js 9333 photo <png>` (ou `eval`, `attendre`). `CASTERIA_MANIFESTE` et
  `CASTERIA_CLE_PUBLIQUE` pour un manifeste d'essai.
- Les photos sans Electron : `maquette.js` imite le launcher dans Edge (scènes `#accueil`, `#telechargement`,
  `#installation`, `#erreur`, `#bienvenue`, `#reglages`, `#hors-ligne`, `#injoignable`, `#longue`).
- Un vrai lancement de Minecraft (Java) : seulement avec le créneau donné par la tête pensante.
- PortableMC : https://github.com/theorzr/portablemc/releases/tag/v5.0.5, `portablemc-5.0.5-windows-x86_64-msvc.zip`,
  signature PGP à vérifier (empreinte `F659 B0F0 B84A 26CA C635 D729 48CA EE8D C345 6B2F`), `portablemc.exe` dans `bin/`.

## Pièges connus

- Sans `--main-dir`, PortableMC écrit dans le `.minecraft` du joueur : le launcher donne toujours ses dossiers.
- L'installation de NeoForge lance Java (les processeurs de l'installateur), même avec `--dry`.
- La sortie `--output machine` de PortableMC n'échappe que `\n` et `\t`, pas la barre oblique inverse : on ne
  « dé-échappe » jamais un chemin Windows.
- Le KubeJS de Modrinth et celui de CurseForge ont le même code mais pas les mêmes octets (l'heure de compilation dans
  MANIFEST.MF) : le manifeste accepte les deux empreintes.
- PortableMC garde la main tant que le jeu tourne : le launcher reste ouvert (caché) pendant la partie.
- Arrivé par le launcher, le joueur entre directement sur le serveur : la minute de `/login` de DirectAuth commence tout
  de suite.
- Le projet est dans un dossier OneDrive (OneDrive est arrêté) : s'il redémarre, `node_modules` (382 Mo) serait
  synchronisé.

## Reste à décider

- Une vraie signature de code, pour que Windows ne prévienne plus (relevé du 25/09/2026, sources Microsoft Learn,
  « Code signing options for Windows app developers », et revendeurs Sectigo) :
  - certificat OV (Sectigo, DigiCert...) : environ 150 à 300 $ par an, clé sur un jeton matériel obligatoire ; même
    signé, SmartScreen prévient encore tant que la réputation n'est pas faite (depuis 2024, l'EV n'y change plus rien) ;
  - Azure Artifact Signing (Microsoft, ex-Trusted Signing) : environ 9,99 $ par mois, mais ouvert aux particuliers des
    États-Unis et du Canada seulement (aux organisations de l'UE, oui : il faudrait une structure, association ou
    société) ;
  - SignPath Foundation : gratuit, si le launcher devient un logiciel libre (code public, licence reconnue, aucun
    composant propriétaire).
- Plus de fichiers de Mojang dans le thème (ae les a redessinés le 25/09) ; les matières des anciennes maquettes
  restent hors de git.
