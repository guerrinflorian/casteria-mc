#!/bin/bash
# ============================================================
#  Comparaison de variantes du launcher sous sway sans ecran, echelle par echelle (serveurmc-14, 25/09/2026, demande
#  de 5b et de a7). En simple joueur :
#    comparer_variantes.sh <prefixe> <dossier photos> "<echelles>" "nom|commande" ["nom|commande"...]
#  Pour chaque echelle et chaque variante : la plateforme prise (--ozone-platform), la fenetre vue par sway, ce que la
#  page voit d'elle-meme (facteur d'echelle, taille en pixels CSS, zoom), une photo. Ambiance de l'ami : session Wayland
#  et ELECTRON_OZONE_PLATFORM_HINT=wayland ; Xwayland actif (pour la variante forcee en X11).
# ============================================================
set -u
PREFIXE="$1"
S="$2"
ECHELLES="$3"
shift 3
R="$S/rapport_${PREFIXE}.txt"
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export PATH="/opt/node-v20.20.2-linux-x64/bin:$PATH"
export XDG_RUNTIME_DIR=/tmp/xdg-comparer-$PREFIXE
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
D=/projet/plateformes/linux/docker

XW="${XWAYLAND:-enable}"
cat > "$HOME/sway_comparer.conf" <<FIN
output HEADLESS-1 resolution 1920x1080 position 0 0 scale 1
xwayland $XW
default_border pixel 2
for_window [title="Casteria"] floating enable
for_window [app_id="casteria"] floating enable
for_window [class="casteria"] floating enable
FIN
unset DISPLAY
export XDG_SESSION_TYPE=wayland
export ELECTRON_OZONE_PLATFORM_HINT=wayland
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=1 \
  sway -c "$HOME/sway_comparer.conf" > "$S/sway_${PREFIXE}.log" 2>&1 &
for i in $(seq 1 20); do ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock >/dev/null 2>&1 && break; sleep 0.5; done
SWAYSOCK="$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -1)"
export SWAYSOCK
WAYLAND_DISPLAY="$(cd "$XDG_RUNTIME_DIR" && ls wayland-* 2>/dev/null | grep -v lock | head -1)"
export WAYLAND_DISPLAY
[ -n "$SWAYSOCK" ] && [ -n "$WAYLAND_DISPLAY" ] || { dire "ECHEC : sway ne demarre pas"; tail -5 "$S/sway_${PREFIXE}.log" >> "$R"; exit 1; }
dire "sway : $(sway --version 2>/dev/null | head -1), xwayland $XW"

k=0
for ech in $ECHELLES; do
  k=$((k + 1))
  # Numerote : une meme echelle peut revenir (1,25 trois fois de suite) sans ecraser les photos.
  e="${k}_${ech/./}"
  swaymsg output HEADLESS-1 scale "$ech" >/dev/null
  for v in "$@"; do
    nom="${v%%|*}"
    cmd="${v#*|}"
    dire "== echelle $ech, variante $nom : $cmd"
    rm -rf "$HOME/.local/share/Casteria"
    swaymsg exec "env CASTERIA_SANS_MAJ=1 CASTERIA_DRY=1 $cmd --remote-debugging-port=9222 > $S/app_${PREFIXE}_${e}_$nom.log 2>&1" >/dev/null
    sleep 16
    if pgrep -x casteria >/dev/null; then
      echo "      plateforme : $(ps -eo args | grep -o -- '--ozone-platform=[a-z0-9]*' | sort -u | tr '\n' ' ')" | tee -a "$R"
      swaymsg -t get_tree -r 2>/dev/null | node "$D/arbre_sway.js" | sed 's/^/      /' | tee -a "$R"
      node --experimental-websocket "$D/cdp_mesure.js" 9222 2>&1 | sed 's/^/      /' | tee -a "$R"
      echo "      processus avec WaylandFractionalScaleV1 dans leurs arguments : $(ps -eo args | grep -v grep | grep -c WaylandFractionalScaleV1)" | tee -a "$R"
      if [ "${cmd#*AppImage}" != "$cmd" ]; then
        echo "      lances par le fichier .AppImage : $(ps -eo args | grep -F 'Casteria-Linux-x86_64.AppImage' | grep -v -e grep -e comparer -e '^sh -c' -e '^bash' -e '^env ' | cut -c1-160 | tr '\n' ';')" | tee -a "$R"
      fi
    else
      echo "      LE LAUNCHER NE TOURNE PAS. Son journal :" | tee -a "$R"
      grep -v -i dbus "$S/app_${PREFIXE}_${e}_$nom.log" 2>/dev/null | head -8 | cut -c1-200 | sed 's/^/        /' | tee -a "$R"
    fi
    echo "      amorce.log (affichage) : $(grep -h 'affichage' "$HOME/.local/share/Casteria/journaux/amorce.log" 2>/dev/null | cut -c26- | tr '\n' ';')" | tee -a "$R"
    grim "$S/${PREFIXE}_${e}_$nom.png" 2>>"$R" && echo "      photo ${PREFIXE}_${e}_$nom.png" | tee -a "$R"
    pkill -x casteria 2>/dev/null
    sleep 3
  done
done
swaymsg exit >/dev/null 2>&1
dire "fini"
