#!/bin/bash
# ============================================================
#  Le cas de l'ami : Hyprland, echelle 1,25 (serveurmc-14, 25/09/2026). En simple joueur :
#    hyprland_essai.sh <dossier photos> <launcher 1.0.4> <launcher 1.0.6>
#  Sans carte graphique ni ecran, Hyprland peut refuser de demarrer : on le dit tel quel (20 s au plus).
# ============================================================
set -u
S="$1"
AVANT="$2"
APRES="$3"
R="$S/rapport_hyprland.txt"
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export PATH="/opt/node-v20.20.2-linux-x64/bin:$PATH"
export XDG_RUNTIME_DIR=/tmp/xdg-hypr
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
D=/projet/plateformes/linux/docker
mkdir -p "$HOME/.config/hypr"
cat > "$HOME/.config/hypr/hyprland.conf" <<'FIN'
monitor = , 1920x1080, 0x0, 1.25
xwayland {
  enabled = true
}
misc {
  disable_hyprland_logo = true
  disable_splash_rendering = true
}
windowrulev2 = float, class:^(casteria)$
FIN
export XDG_SESSION_TYPE=wayland
export ELECTRON_OZONE_PLATFORM_HINT=wayland
HYPRLAND_HEADLESS_ONLY=1 WLR_BACKENDS=headless WLR_RENDERER=pixman LIBGL_ALWAYS_SOFTWARE=1 \
  Hyprland > "$S/hyprland.log" 2>&1 &
PID=$!
for i in $(seq 1 40); do
  ls "$XDG_RUNTIME_DIR"/hypr/*/.socket.sock >/dev/null 2>&1 && break
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
SIG="$(ls "$XDG_RUNTIME_DIR"/hypr 2>/dev/null | head -1)"
if [ -z "$SIG" ] || ! kill -0 "$PID" 2>/dev/null; then
  dire "   Hyprland ne demarre pas sans ecran ici. Fin de son journal :"
  grep -v "^$" "$S/hyprland.log" | tail -8 | cut -c1-200 | sed 's/^/      /' | tee -a "$R"
  kill "$PID" 2>/dev/null
  exit 0
fi
export HYPRLAND_INSTANCE_SIGNATURE="$SIG"
WAYLAND_DISPLAY="$(cd "$XDG_RUNTIME_DIR" && ls wayland-* 2>/dev/null | grep -v lock | head -1)"
export WAYLAND_DISPLAY
hyprctl output create headless >/dev/null 2>&1
sleep 1
dire "   Hyprland demarre : $(hyprctl monitors 2>/dev/null | grep -E 'Monitor|scale' | tr '\n' ' ' | cut -c1-200)"
for v in "a_104|$AVANT" "b_106|$APRES"; do
  nom="${v%%|*}"
  bin="${v#*|}"
  dire "== Hyprland 1,25, variante $nom"
  rm -rf "$HOME/.local/share/Casteria"
  hyprctl dispatch exec "env CASTERIA_SANS_MAJ=1 CASTERIA_DRY=1 $bin --no-sandbox --remote-debugging-port=9222 > $S/app_hyprland_$nom.log 2>&1" >/dev/null
  sleep 18
  hyprctl clients 2>/dev/null | grep -E "class|size|at:|xwayland" | sed 's/^/      /' | tee -a "$R"
  node --experimental-websocket "$D/cdp_mesure.js" 9222 2>&1 | sed 's/^/      /' | tee -a "$R"
  grim "$S/hyprland_125_$nom.png" 2>>"$R" && echo "      photo hyprland_125_$nom.png" | tee -a "$R"
  pkill -x casteria 2>/dev/null
  sleep 3
done
hyprctl dispatch exit >/dev/null 2>&1
dire "fini"
