#!/bin/sh
# Installe Casteria pour ce joueur, sans mot de passe administrateur :
#   - le launcher dans ~/.local/share/casteria-launcher ;
#   - Casteria dans le menu des applications, avec son icone ;
#   - puis il ouvre le launcher.
# Le relancer met l'installation a jour. « ./installer.sh --desinstaller » l'enleve (le jeu et les reglages, dans
# ~/.local/share/Casteria, restent). « --sans-lancer » installe sans ouvrir le launcher.
set -u
ICI="$(dirname "$(readlink -f "$0")")"
DONNEES="${XDG_DATA_HOME:-$HOME/.local/share}"
CIBLE="$DONNEES/casteria-launcher"
APPS="$DONNEES/applications"
ICONES="$DONNEES/icons/hicolor"
TAILLES="16 32 48 64 128 256"
LANCER=oui
MODE=installer
for a in "$@"; do
  case "$a" in
    --desinstaller) MODE=desinstaller ;;
    --sans-lancer) LANCER=non ;;
  esac
done

# Lance d'un double-clic, il n'a pas de terminal : le message final s'affiche alors dans une fenetre.
message() {
  titre="$1"
  texte="$2"
  echo "$texte"
  [ -t 1 ] && return 0
  if command -v zenity >/dev/null 2>&1; then
    zenity --info --title="$titre" --text="$texte" >/dev/null 2>&1
  elif command -v kdialog >/dev/null 2>&1; then
    kdialog --title "$titre" --msgbox "$texte" >/dev/null 2>&1
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send "$titre" "$texte" >/dev/null 2>&1
  fi
}

probleme() {
  message "Casteria" "$1"
  exit 1
}

if [ "$MODE" = desinstaller ]; then
  case "$CIBLE" in
    */casteria-launcher) rm -rf "$CIBLE" ;;
  esac
  rm -f "$APPS/casteria.desktop"
  for t in $TAILLES; do rm -f "$ICONES/${t}x${t}/apps/casteria.png"; done
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1
  message "Casteria" "Casteria est désinstallé. Ton jeu et tes réglages restent dans $DONNEES/Casteria."
  exit 0
fi

# Le PC : Linux 64 bits (x86_64), et une glibc 2.39 ou plus récente pour lancer le jeu.
[ "$(uname -m)" = x86_64 ] || probleme "Casteria pour Linux demande un PC 64 bits (x86_64). Ce PC est en $(uname -m)."
[ -f "$ICI/casteria" ] || probleme "Le fichier casteria est introuvable à côté de installer.sh : ouvre d'abord l'archive en entier."
glibc="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')"
if [ -n "$glibc" ]; then
  majeur="${glibc%%.*}"
  mineur="${glibc#*.}"
  mineur="${mineur%%.*}"
  if [ "$majeur" -lt 2 ] || { [ "$majeur" -eq 2 ] && [ "$mineur" -lt 39 ]; }; then
    probleme "Ton Linux est trop ancien pour lancer le jeu : il faut Ubuntu 24.04, Linux Mint 22, Fedora 40, Debian 13 ou plus récent."
  fi
fi

# Le launcher, copie a cote puis mis en place d'un coup (une ancienne installation est remplacee).
mkdir -p "$DONNEES" || probleme "Impossible de créer $DONNEES."
if [ "$ICI" != "$CIBLE" ]; then
  rm -rf "$CIBLE.nouveau"
  cp -R "$ICI/." "$CIBLE.nouveau" || probleme "La copie dans $CIBLE a échoué (place sur le disque ?)."
  rm -rf "$CIBLE.ancien"
  [ -d "$CIBLE" ] && mv "$CIBLE" "$CIBLE.ancien"
  mv "$CIBLE.nouveau" "$CIBLE" || probleme "L'installation dans $CIBLE a échoué."
  rm -rf "$CIBLE.ancien"
fi
for f in casteria chrome-sandbox chrome_crashpad_handler resources/bin/portablemc lancer-casteria.sh installer.sh; do
  [ -f "$CIBLE/$f" ] && chmod 755 "$CIBLE/$f"
done
for f in "$CIBLE"/*.so "$CIBLE"/*.so.*; do
  [ -f "$f" ] && chmod 755 "$f"
done

# L'icone, a toutes les tailles, et l'entree du menu des applications.
for t in $TAILLES; do
  if [ -f "$CIBLE/icones/${t}x${t}.png" ]; then
    mkdir -p "$ICONES/${t}x${t}/apps"
    cp "$CIBLE/icones/${t}x${t}.png" "$ICONES/${t}x${t}/apps/casteria.png"
  fi
done
mkdir -p "$APPS" || probleme "Impossible de créer $APPS."
cat > "$APPS/casteria.desktop" <<FIN
[Desktop Entry]
Type=Application
Name=Casteria
Comment=Casteria, un serveur Skyblock moddé : ton île, tes machines et des boss à affronter.
Exec="$CIBLE/lancer-casteria.sh" %U
Icon=casteria
Terminal=false
Categories=Game;
StartupWMClass=casteria
FIN
chmod 644 "$APPS/casteria.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$ICONES" >/dev/null 2>&1

if [ "$LANCER" = oui ]; then
  nohup "$CIBLE/lancer-casteria.sh" >/dev/null 2>&1 &
fi
message "Casteria" "Casteria est installé : tu le trouves dans le menu des applications. Tu peux maintenant supprimer ce dossier."
exit 0
