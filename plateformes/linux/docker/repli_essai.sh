#!/bin/bash
# ============================================================
#  Le chemin du repli X11 de a7 (code 1.0.6, commit 3380e7a), pour UN paquet (serveurmc-14, 25/09/2026, demandes de 5b
#  et de a7). En simple joueur :
#    repli_essai.sh <nom du paquet> <dossier photos> <commande du launcher...>
#  A. sway AVEC Xwayland, la note <racine>/electron/affichage.json {"x11": true} ecrite avant : relance en X11
#     (--ozone-platform=x11, fenetre xwayland), « affichage : X11 (note ...) » dans amorce.log.
#  B. sway SANS Xwayland (pas de DISPLAY), la meme note : fenetre Wayland (xdg_shell), la note effacee.
#  C. sway AVEC Xwayland, l'echec de Wayland force (le processus graphique tue des qu'il apparait) : « affichage Wayland
#     en echec (...) : redemarrage en X11 » dans amorce.log, puis la fenetre en X11.
#  D. sway SANS Xwayland, le meme echec : « pas de repli » dans amorce.log, pas de boucle ; puis D2, le demarrage
#     suivant : rien de casse (fenetre Wayland).
#  E. AppImage seulement : le bouton Redemarrer (par le port de debogage, redemarrer_cdp.js) : le launcher revient, relance
#     par le fichier .AppImage ($APPIMAGE).
# ============================================================
set -u
NOM="$1"
S="$2"
shift 2
R="$S/rapport_repli_$NOM.txt"
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export PATH="/opt/node-v20.20.2-linux-x64/bin:$PATH"
export XDG_RUNTIME_DIR=/tmp/xdg-repli-$NOM
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
DOCKER_DIR=/projet/plateformes/linux/docker
RACINE="${XDG_DATA_HOME:-$HOME/.local/share}/Casteria"
NOTE="$RACINE/electron/affichage.json"
JOURNAL="$RACINE/journaux/amorce.log"
CMD="$*"
EST_APPIMAGE=non
[ "${NOM#appimage}" != "$NOM" ] && EST_APPIMAGE=oui

demarrer_sway() {
  local xw="$1" i
  cat > "$HOME/sway_repli.conf" <<FIN
output HEADLESS-1 resolution 1920x1080 position 0 0 scale 1.25
xwayland $xw
default_border pixel 2
for_window [title="Casteria"] floating enable
for_window [app_id="casteria"] floating enable
for_window [class="casteria"] floating enable
FIN
  unset DISPLAY
  # La session de l'ami (Omarchy : Arch + Hyprland) : Wayland, et Electron pousse vers Wayland. Sans cela, Electron 44
  # prend X11 par Xwayland et le repli (qui n'agit qu'en Wayland) ne serait pas essaye.
  export XDG_SESSION_TYPE=wayland
  export ELECTRON_OZONE_PLATFORM_HINT=wayland
  WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=1 \
    sway -c "$HOME/sway_repli.conf" > "$S/sway_repli_${NOM}.log" 2>&1 &
  for i in $(seq 1 20); do
    ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock >/dev/null 2>&1 && break
    sleep 0.5
  done
  SWAYSOCK="$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -1)"
  export SWAYSOCK
  WAYLAND_DISPLAY="$(cd "$XDG_RUNTIME_DIR" && ls wayland-* 2>/dev/null | grep -v lock | head -1)"
  export WAYLAND_DISPLAY
  [ -n "$SWAYSOCK" ] && [ -n "$WAYLAND_DISPLAY" ] || { dire "    ECHEC : sway ne demarre pas (xwayland $xw)"; return 1; }
}

# Les processus d'Electron s'appellent « casteria » (le nom de l'executable) : pkill -x vise ce nom seul, jamais ce
# script dont la ligne de commande contient aussi le chemin du launcher.
arreter_sway() {
  pkill -x casteria 2>/dev/null
  sleep 3
  swaymsg exit >/dev/null 2>&1
  sleep 2
  rm -rf "$XDG_RUNTIME_DIR"/sway-ipc.* "$XDG_RUNTIME_DIR"/wayland-*
}

lancer() {
  swaymsg exec "env CASTERIA_SANS_MAJ=1 CASTERIA_DRY=1 $CMD $* > $S/app_repli_${NOM}_$ETIQUETTE.log 2>&1" >/dev/null
}

# Tue le processus graphique des qu'il apparait (avant que la page ne reponde), une seule fois.
saboter_gpu() {
  local i
  for i in $(seq 1 250); do
    if pgrep -f -- "--type=gpu-process" >/dev/null; then
      pkill -KILL -f -- "--type=gpu-process"
      echo "      processus graphique tue apres $((i * 20)) ms" | tee -a "$R"
      return 0
    fi
    sleep 0.02
  done
  echo "      processus graphique jamais vu en 5 s" | tee -a "$R"
}

releve() {
  local nom_photo="$1"
  echo "      plateforme(s) : $(ps -eo args | grep -o -- '--ozone-platform[a-z-]*=[a-z0-9]*' | sort -u | tr '\n' ' ')" | tee -a "$R"
  echo "      note : $(cat "$NOTE" 2>/dev/null | tr -d '\n' || true)$([ -f "$NOTE" ] || echo 'absente')" | tee -a "$R"
  if [ "$EST_APPIMAGE" = oui ]; then
    echo "      processus lances par le fichier .AppImage :" | tee -a "$R"
    ps -eo args | grep -F "Casteria-Linux-x86_64.AppImage" | grep -v -e grep -e repli_essai -e "^sh -c" -e "^bash" | cut -c1-200 | sed 's/^/        /' | tee -a "$R"
    echo "      dossiers de l'AppImage : $(ls -d /tmp/appimage_extracted_* /tmp/.mount_* 2>/dev/null | tr '\n' ' ')" | tee -a "$R"
    echo "      d'ou tournent les processus casteria : $(for p in $(pgrep -x casteria); do readlink /proc/$p/exe; done | sort -u | tr '\n' ' ')" | tee -a "$R"
  fi
  if ! pgrep -x casteria >/dev/null; then
    echo "      LE LAUNCHER NE TOURNE PAS. Son journal :" | tee -a "$R"
    grep -v -i "dbus" "$S/app_repli_${NOM}_$ETIQUETTE.log" 2>/dev/null | head -8 | cut -c1-200 | sed 's/^/        /' | tee -a "$R"
  fi
  grim "$S/repli_${NOM}_$nom_photo.png" 2>>"$R" && echo "      photo repli_${NOM}_$nom_photo.png" | tee -a "$R"
  swaymsg -t get_tree -r 2>/dev/null | node "$DOCKER_DIR/arbre_sway.js" | sed 's/^/      /' | tee -a "$R"
  echo "      amorce.log (affichage) :" | tee -a "$R"
  grep -h "affichage" "$JOURNAL" 2>/dev/null | sed 's/^/        /' | tee -a "$R"
}

cas_note() {
  local lettre="$1" xw="$2"
  ETIQUETTE="$lettre"
  dire "== $NOM, cas $lettre : sway xwayland $xw, la note {\"x11\": true} ecrite avant le demarrage"
  demarrer_sway "$xw" || return
  rm -rf "$RACINE" && mkdir -p "$RACINE/electron" && printf '{"x11": true}\n' > "$NOTE"
  lancer
  sleep 22
  releve "$lettre"
  arreter_sway
}

cas_echec() {
  local lettre="$1" xw="$2" essai
  for essai in 1 2; do
    ETIQUETTE="$lettre$essai"
    dire "== $NOM, cas $lettre (essai $essai) : sway xwayland $xw, echec de Wayland force"
    demarrer_sway "$xw" || return
    rm -rf "$RACINE"
    lancer
    saboter_gpu
    sleep 30
    if grep -q "affichage Wayland en" "$JOURNAL" 2>/dev/null || [ "$essai" = 2 ]; then
      releve "$lettre"
      echo "      lignes « affichage » dans amorce.log : $(grep -c 'affichage' "$JOURNAL" 2>/dev/null)" | tee -a "$R"
      break
    fi
    echo "      la page a repondu avant le sabotage (rien dans amorce.log) : on recommence" | tee -a "$R"
    arreter_sway
  done
  if [ "$xw" = disable ]; then
    pkill -x casteria 2>/dev/null
    sleep 3
    ETIQUETTE="${lettre}2"
    dire "== $NOM, cas ${lettre}2 : le demarrage suivant, toujours sans Xwayland"
    lancer
    sleep 22
    releve "${lettre}2"
  fi
  arreter_sway
}

cas_redemarrer() {
  ETIQUETTE=E
  dire "== $NOM, cas E : le bouton Redemarrer (sway avec Xwayland, demarrage normal)"
  demarrer_sway enable || return
  rm -rf "$RACINE"
  lancer --remote-debugging-port=9222
  sleep 22
  echo "      avant : $(pgrep -x casteria | wc -l) processus casteria, $(ps -eo args | grep -F 'Casteria-Linux-x86_64.AppImage' | grep -v -e grep -e repli_essai -e '^sh -c' -e '^bash' | wc -l) lance(s) par le .AppImage" | tee -a "$R"
  node --experimental-websocket "$DOCKER_DIR/redemarrer_cdp.js" 9222 2>&1 | sed 's/^/      /' | tee -a "$R"
  sleep 25
  releve "E_apres_redemarrer"
  arreter_sway
}

# F (demande de 5b, 25/09 vers 19:00) : la relance X11 tuee des qu'elle apparait (elle ne montre jamais de fenetre) ;
# au demarrage suivant, la marque de a7 doit l'avoir notee, et une fenetre doit s'ouvrir.
cas_relance_tuee() {
  local i
  ETIQUETTE=F
  dire "== $NOM, cas F : sway avec Xwayland, la relance X11 tuee des qu'elle apparait"
  demarrer_sway enable || return
  rm -rf "$RACINE"
  lancer
  # La relance est tuee des qu'elle apparait, et encore pendant 4 s (le runtime AppImage, puis tous les processus
  # d'Electron, portent --ozone-platform=x11) : elle ne doit jamais montrer de fenetre.
  local vue=0 tues=0
  for i in $(seq 1 250); do
    if pgrep -f -- "--ozone-platform=x11" >/dev/null; then
      [ "$vue" = 0 ] && echo "      relance X11 vue apres $((i * 20)) ms" | tee -a "$R"
      vue=1
      pkill -KILL -f -- "--ozone-platform=x11" && tues=$((tues + 1))
    fi
    [ "$vue" = 1 ] && [ "$i" -gt 200 ] && break
    sleep 0.02
  done
  echo "      coups de pkill : $tues" | tee -a "$R"
  sleep 6
  echo "      processus casteria restants : $(pgrep -x casteria | wc -l) ; relances X11 restantes : $(pgrep -f -- '--ozone-platform=x11' | wc -l)" | tee -a "$R"
  echo "      marque de relance : $(ls "$RACINE"/electron/relance_x11_en_cours.json 2>/dev/null || echo absente)" | tee -a "$R"
  echo "      amorce.log (affichage) : $(grep -h 'affichage' "$JOURNAL" 2>/dev/null | cut -c26- | tr '\n' ';')" | tee -a "$R"
  pkill -x casteria 2>/dev/null
  sleep 2
  ETIQUETTE=F2
  dire "== $NOM, cas F2 : le demarrage suivant"
  lancer
  sleep 22
  releve "F2"
  arreter_sway
}

# CAS="F" (par exemple) ne fait que ces cas-la ; par defaut, tous.
for c in ${CAS:-A B C D E F}; do
  case "$c" in
    A) cas_note A enable ;;
    B) cas_note B disable ;;
    C) cas_echec C enable ;;
    D) cas_echec D disable ;;
    E) [ "$EST_APPIMAGE" = oui ] && cas_redemarrer ;;
    F) [ "$EST_APPIMAGE" = oui ] && cas_relance_tuee ;;
  esac
done
dire "fini"
