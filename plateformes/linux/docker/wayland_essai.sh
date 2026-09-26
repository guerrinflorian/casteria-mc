#!/bin/bash
# ============================================================
#  L'ecran de l'ami de Florian, refait dans le conteneur (serveurmc-14, 25/09/2026) : un compositeur Wayland sans
#  ecran (sway, wlroots comme Hyprland), Xwayland actif, une sortie 1920x1080 a l'echelle 1,25 puis 1,5. Le launcher
#  y est lance par sway lui-meme (« swaymsg exec », comme un clic dans le menu), sans aucune option d'affichage :
#  il choisit seul Wayland ou X11, comme chez le joueur. Photos par grim.
#
#  Lance en simple joueur par docker_linux.sh :  wayland_essai.sh <launcher AVANT> <launcher APRES> <dossier photos>
#  Pour chaque echelle et chaque version : la fenetre telle qu'elle s'ouvre (flottante), puis mise en mosaique par sway
#  (redimensionnee de force a tout l'ecran), puis flottante et retaillee a 800 x 500.
# ============================================================
set -u
AVANT="$1"
APRES="$2"
S="$3"
R="$S/rapport_wayland.txt"
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export PATH="/opt/node-v20.20.2-linux-x64/bin:$PATH"
export XDG_RUNTIME_DIR=/tmp/xdg-joueur
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
ARBRE=/projet/plateformes/linux/docker/arbre_sway.js

cat > "$HOME/sway.conf" <<'FIN'
output HEADLESS-1 resolution 1920x1080 position 0 0 scale 1.25
xwayland enable
default_border pixel 2
for_window [title="Casteria"] floating enable
for_window [app_id="casteria"] floating enable
for_window [class="casteria"] floating enable
FIN

# Une vraie session Wayland (le gestionnaire de connexion pose XDG_SESSION_TYPE=wayland). Sans elle, Electron 44 prend
# X11 par Xwayland des que DISPLAY existe, et le defaut de l'ami ne se voit pas (essai du 25/09, 17:37).
export XDG_SESSION_TYPE=wayland
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=1 \
  sway -c "$HOME/sway.conf" > "$S/sway.log" 2>&1 &
for i in $(seq 1 20); do
  ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock >/dev/null 2>&1 && break
  sleep 0.5
done
SWAYSOCK="$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -1)"
export SWAYSOCK
WAYLAND_DISPLAY="$(cd "$XDG_RUNTIME_DIR" && ls wayland-* 2>/dev/null | grep -v lock | head -1)"
export WAYLAND_DISPLAY
if [ -z "$SWAYSOCK" ] || [ -z "$WAYLAND_DISPLAY" ]; then
  dire "ECHEC : sway ne demarre pas"
  tail -20 "$S/sway.log" >> "$R"
  exit 1
fi
dire "sway $(sway --version 2>/dev/null | head -1), socket $WAYLAND_DISPLAY"

photo() {
  grim "$S/$1.png" 2>>"$R" && dire "    photo $1.png" || dire "    photo $1 RATEE"
  swaymsg -t get_tree -r 2>/dev/null | node "$ARBRE" | sed 's/^/      /' | tee -a "$R"
}

# ambiance « ami » : ELECTRON_OZONE_PLATFORM_HINT=wayland, comme Omarchy (Arch + Hyprland) le pose pour toutes les
# applications ; « bureau » : la session Wayland seule (GNOME, KDE... sans cette variable).
essai() {
  local nom="$1" bin="$2" ech="$3" ambiance="$4" indice=""
  [ "$ambiance" = ami ] && indice="ELECTRON_OZONE_PLATFORM_HINT=wayland"
  dire "== $nom : echelle $ech, ambiance $ambiance, $bin"
  swaymsg output HEADLESS-1 scale "$ech" >/dev/null
  swaymsg -t get_outputs -r | grep -m1 -o '"scale": [0-9.]*' | sed 's/^/      sortie /' | tee -a "$R"
  rm -rf "$HOME/.local/share/Casteria"
  swaymsg exec "env $indice CASTERIA_SANS_MAJ=1 CASTERIA_DRY=1 $bin --no-sandbox > $S/app_$nom.log 2>&1" >/dev/null
  sleep 18
  echo "      plateforme choisie par le launcher : $(ps -eo args | grep -o -- '--ozone-platform[a-z-]*=[a-z0-9]*' | sort -u | tr '\n' ' ')" | tee -a "$R"
  photo "${nom}_1_ouverture"
  if ! pgrep -x casteria >/dev/null; then
    echo "      LE LAUNCHER NE TOURNE PAS. Son journal :" | tee -a "$R"
    grep -v -i "dbus" "$S/app_$nom.log" 2>/dev/null | head -8 | cut -c1-200 | sed 's/^/        /' | tee -a "$R"
  fi
  swaymsg '[title="Casteria"] floating disable' >/dev/null
  sleep 4
  photo "${nom}_2_mosaique"
  swaymsg '[title="Casteria"] floating enable, resize set 800 px 500 px, move position center' >/dev/null
  sleep 4
  photo "${nom}_3_petite"
  pkill -x casteria 2>/dev/null
  sleep 3
}


PREFIXE="${PREFIXE:-wayland}"
for ech in ${ECHELLES:-1.25 1.5}; do
  e="${ech/./}"
  essai "${PREFIXE}_${e}_avant" "$AVANT" "$ech" ami
  essai "${PREFIXE}_${e}_apres" "$APRES" "$ech" ami
done
[ -n "${SANS_BUREAU:-}" ] || essai "${PREFIXE}_125_apres_bureau" "$APRES" 1.25 bureau
swaymsg exit >/dev/null 2>&1
dire "fini"
