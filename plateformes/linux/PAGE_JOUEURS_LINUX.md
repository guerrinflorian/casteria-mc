# Casteria sous Linux

Casteria, un serveur Skyblock moddé : ton île, tes machines et des boss à affronter.

## Avant tout : il faut un Linux récent

Un PC 64 bits avec **Ubuntu 24.04** ou plus récent, **Linux Mint 22**, **Debian 13**, **Fedora 40**, **Arch** ou
**Manjaro**... Sur un Linux plus ancien (Ubuntu 22.04, Linux Mint 21, Debian 12), le launcher s'ouvre, mais le jeu
ne peut pas démarrer.

## Ubuntu, Linux Mint, Debian, Pop!_OS, Zorin : le fichier .deb

1. Télécharge **Casteria-Linux-x86_64.deb**.
2. Double-clique dessus : la logithèque s'ouvre. Clique sur **Installer**, puis donne ton mot de passe.
   (Si rien ne s'ouvre : clic droit sur le fichier, **Ouvrir avec**, **Installation de paquets**. Ou, dans un
   terminal : `sudo apt install ./Casteria-Linux-x86_64.deb`)
3. Casteria est dans le menu des applications.

## Arch, Manjaro, EndeavourOS : le paquet Arch

Dans un terminal, dans le dossier du fichier : `sudo pacman -U Casteria-Linux-x86_64.pacman`

## Les autres Linux (Fedora...) : le fichier .tar.gz et son installateur

1. Télécharge **Casteria-Linux-x86_64.tar.gz**, puis ouvre-le (clic droit, **Extraire ici**).
2. Dans le dossier **Casteria-Linux-x86_64**, double-clique sur **installer.sh** (ou clic droit, **Lancer comme un
   programme**). Sinon, dans un terminal ouvert dans ce dossier : `./installer.sh`
3. Casteria est dans le menu des applications, et le launcher s'ouvre. Pas besoin de mot de passe.

## Pour ceux qui connaissent : l'AppImage

1. Télécharge **Casteria-Linux-x86_64.AppImage**.
2. Clic droit sur le fichier, **Propriétés**, **Permissions**, coche **Autoriser l'exécution**.
   (Ou dans un terminal : `chmod +x Casteria-Linux-x86_64.AppImage`)
3. Double-clique dessus.

## Un souci ?

Préviens l'équipe du serveur, avec le nom de ton Linux (Ubuntu, Mint, Fedora...) : on corrige vite. Ton jeu et tes
réglages sont rangés dans `~/.local/share/Casteria`.
