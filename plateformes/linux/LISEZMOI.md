# Le launcher pour Linux (serveurmc-14, 25/09/2026)

Le paquet Linux x86_64 du launcher : un AppImage, et un .tar.gz de secours. Tout est dans ce dossier ; le reste du
projet n'est que LU (amorce, clé, src, package.json : a7).

## Ce qu'il y a ici

| Fichier | Rôle |
|---|---|
| `electron-builder-linux.json` | la configuration Linux (cibles `dir` et `AppImage`, icônes, entrée de bureau, PortableMC linux-x64 dans `resources/bin`) |
| `icones/` | les icônes finales de a7 (`design/icone/final`), en 16, 32, 48, 64, 128 et 256 |
| `docker_appimage.sh` | le passage dans un conteneur ubuntu:22.04 : fabrique l'AppImage, le vérifie, le lance sous un écran virtuel |
| `docker_essai_2404.sh` | après lui, dans ubuntu:24.04 : PortableMC répond, et le launcher s'affiche sur un Linux récent |
| `faire_targz.js` | écrit le .tar.gz avec les bons droits, puis le relit (droits, sommes de contrôle, empreinte de PortableMC) |
| `targz/` | ce qui s'ajoute au .tar.gz : `lancer-casteria.sh`, `installer-raccourci.sh`, `LISEZMOI.txt` |
| `cache/` | Node 20 pour Linux (sha256 vérifié contre SHASUMS256.txt de nodejs.org), pour le conteneur |
| `sortie/` | `linux-unpacked` (l'application dépliée) et le .tar.gz |
| `sortie_docker/` | l'AppImage, `rapport.txt`, les photos et les journaux du passage dans Docker |
| `PAGE_JOUEURS_LINUX.md` | le texte proposé pour la page des joueurs |
| `ancien/` | les versions remplacées (jamais supprimées) |

## Refaire le paquet

1. Sous Windows, depuis CasteriaLauncher :
   `node node_modules/electron-builder/cli.js --linux dir --x64 --config plateformes/linux/electron-builder-linux.json`
   (la cible `dir` marche depuis Windows ; l'AppImage non : mksquashfs n'existe que pour Linux et Mac).
2. Le .tar.gz : `node plateformes/linux/faire_targz.js` (il doit finir par « 0 faute »). Chaque paquet sort avec
   son `.sha256` à côté (format de sha256sum), que a7 publie avec lui : faire_targz.js et docker_appimage.sh
   l'écrivent eux-mêmes. Ne pas prendre le .tar.gz
   d'electron-builder fait sous Windows : tout y est en 0644, casteria et PortableMC ne se lancent plus.
3. L'AppImage : Docker (après accord de 5b, une séance courte), depuis CasteriaLauncher :
   ```
   docker pull ubuntu:22.04
   docker run --rm --shm-size=512m -v "${PWD}:/projet" -v "${PWD}\plateformes\linux\sortie_docker:/sortie" ubuntu:22.04 bash /projet/plateformes/linux/docker_appimage.sh
   ```
   Durée mesurée : 179 s. Il faut environ 2 Go de mémoire libre : elle est descendue à 0,72 Go pendant le lancement
   sous l'écran virtuel.

## Ce que le passage du 25/09 (15:00) a montré

- L'AppImage est fabriqué par electron-builder (outils appimage 1.0.3, runtime statique : pas de libfuse2) :
  122 Mo, marque AppImage « AI 2 ». Son propre runtime l'ouvre sans FUSE.
- Les droits une fois extrait : AppRun, casteria, chrome-sandbox, chrome_crashpad_handler, libffmpeg.so et
  resources/bin/portablemc en 0755. L'empreinte de PortableMC est celle de bin/empreintes.json.
  Six bibliothèques ajoutées par electron-builder dans usr/lib (libnotify, libXtst, libXss...) sont en 0644 : ce
  n'est pas un problème, le chargeur de Linux n'a pas besoin du droit d'exécution pour une bibliothèque.
- Sur une Ubuntu 22.04 nue, il manque 26 bibliothèques d'un bureau (GTK 3, NSS, X11, ALSA...) : un vrai bureau les a.
  Après leur installation : 0 manquante.
- Lancé en simple joueur sous un écran virtuel (1280 x 800), l'AppImage ET le .tar.gz ouvrent l'écran d'accueil
  (« Bienvenue sur Casteria ! », le choix du pseudo) : `sortie_docker/capture_xvfb_40s.png`, `capture_targz_25s.png`.
  Le dossier `~/.local/share/Casteria` se crée (code, electron, journaux). Seuls des messages D-Bus sont écrits (il
  n'y a pas de D-Bus dans un conteneur).
- Le bac à sable de Chromium : dans Docker, les espaces de noms d'utilisateur sont fermés, et l'AppRun a ajouté
  `--no-sandbox` tout seul (il essaie `unshare -Ur true`). `lancer-casteria.sh` fait pareil. Sur un bureau où ils
  sont ouverts, le bac à sable est gardé.
- La classe de la fenêtre est `casteria` (en minuscules) : l'entrée de bureau dit donc `StartupWMClass=casteria`,
  pour que la barre des tâches relie la fenêtre à son icône.

## Le 2e passage (25/09, 15:25, code 1.0.4, commit dc695c8 de a7)

- Les textes de Florian : l'entrée de bureau de l'AppImage dit `Comment=Casteria, un serveur Skyblock moddé : ton
  île, tes machines et des boss à affronter.`, `StartupWMClass=casteria`, `X-AppImage-Version=1.0.4`. Aucun texte
  refusé dans le code, le .desktop, les scripts ni le LISEZMOI. PortableMC n'est plus nommé que par son binaire et sa
  licence (`resources/bin/LICENSE-portablemc.txt`, que sa licence GPL oblige à livrer).
- L'AppImage : sha256 `00b695268307d9c32a368e5c2c36f84718639c47e9deea330552296c7e4c8ab6` (122 381 569 octets).
  Le .tar.gz : sha256 `e8151df0c1d28fce8ae159475f26658d39d33215f7d199445e8ce7c34da930b3` (130 251 173 octets).
- `docker_essai_2404.sh` (ubuntu:24.04, glibc 2.39, 91 s) : PortableMC y répond (« portablemc 5.0.5 »), il ne manque
  aucune bibliothèque une fois celles d'un bureau posées, et l'écran d'accueil s'affiche
  (`sortie_docker/capture_2404_30s.png`). Les erreurs à la fin de son journal viennent de l'arrêt par `timeout`.
- Le message « Linux trop ancien » de a7 ne se voit pas sur les photos : le premier lancement montre le choix du
  pseudo.
- `src/portablemc.js` (a7) marche sur l'application extraite : empreinte vérifiée, copie dans `<racine>/bin` en 0755.

## Le point bloquant : PortableMC demande un Linux récent

PortableMC 5.0.5 pour Linux (le binaire officiel, signature vérifiée) ne démarre pas sur Ubuntu 22.04 :
« version `GLIBC_2.39' not found ». Il a été compilé sur un système récent et demande glibc 2.39 (`pidfd_spawnp`,
`pidfd_getpid`) et 2.38 (`__isoc23_sscanf`, `__isoc23_strtol`). 5.0.2 demande aussi 2.39, et aucune version 5.x ne
publie de binaire musl (statique).

Il marche donc sur Ubuntu 24.04 et plus récent, Linux Mint 22, Fedora 40, Debian 13, Arch ; il ne marche PAS sur
Ubuntu 22.04, Linux Mint 21, Debian 12 ni Fedora 39. Le launcher, lui, s'ouvre partout (photo) : c'est au clic sur
Jouer que ça casse.

Les choix, pour a7 et 5b (proposition : 1 tout de suite, 2 si des joueurs sont sur un Linux plus ancien) :
1. Garder le PortableMC officiel, dire « Linux récent » sur la page (déjà dans le texte proposé), et que le launcher
   l'explique au joueur : si PortableMC écrit « GLIBC_2. » en échouant, afficher « Ton Linux est trop ancien pour
   lancer le jeu : il faut Ubuntu 24.04, Linux Mint 22, Fedora 40, Debian 13 ou plus récent. » (code de a7, dans
   src/partie.js ou main.js ; on peut aussi lancer `portablemc --version` au démarrage sous Linux pour le dire avant
   le clic).
2. Compiler PortableMC 5.0.5 nous-mêmes depuis ses sources pour `x86_64-unknown-linux-musl` (un binaire statique qui
   marche sur tous les Linux), dans Docker. Ce ne serait plus le binaire signé par l'auteur : son empreinte irait dans
   bin/empreintes.json avec la recette de compilation. Décision de a7 (et du propriétaire).
3. Demander à l'auteur de PortableMC un binaire musl ou compilé sur un système plus ancien.

## Propositions pour a7 (ton code, je n'y ai pas touché)

- Dans package.json : un script `"linux": "electron-builder --linux dir --x64 --config plateformes/linux/electron-builder-linux.json"`,
  si tu veux l'avoir sous la main.
- electron-builder conseille `desktopName` dans package.json (avec `linux.syncDesktopName`) pour relier la fenêtre à
  son entrée de bureau sous Wayland. Sans lui, `StartupWMClass=casteria` suffit sous X11.
- Le message « Linux trop ancien » ci-dessus.
