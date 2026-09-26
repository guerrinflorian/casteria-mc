#!/bin/bash
# ============================================================
#  Le piege de a7 (1.0.7) : une mise a jour du code, puis deux redemarrages, dans l'ambiance d'Omarchy avec Xwayland
#  (la relance en X11 a chaque demarrage). En simple joueur (serveurmc-14, 25/09/2026) :
#    maj_essai.sh <dossier photos> <launcher d'essai (cle d'essai dans l'amorce)> <adresse de code.json>
#  Attendu dans amorce.log : « code 1.0.8 verifie : il demarre (essai) », « affichage : relance en X11 », le meme essai
#  dans le processus relance, puis « code 1.0.8 confirme ». JAMAIS « n'a pas demarre : refusee ».
# ============================================================
set -u
S="$1"
BIN="$2"
CODE="$3"
P="${4:-maj}"
R="$S/rapport_$P.txt"
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export PATH="/opt/node-v20.20.2-linux-x64/bin:$PATH"
export XDG_RUNTIME_DIR=/tmp/xdg-maj
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
D=/projet/plateformes/linux/docker
RACINE="$HOME/.local/share/Casteria"
cat > "$HOME/sway_maj.conf" <<'FIN'
output HEADLESS-1 resolution 1920x1080 position 0 0 scale 1.25
xwayland enable
default_border pixel 2
for_window [title="Casteria"] floating enable
for_window [app_id="casteria"] floating enable
for_window [class="casteria"] floating enable
FIN
unset DISPLAY
export XDG_SESSION_TYPE=wayland
export ELECTRON_OZONE_PLATFORM_HINT=wayland
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 WLR_HEADLESS_OUTPUTS=1 \
  sway -c "$HOME/sway_maj.conf" > "$S/sway_maj.log" 2>&1 &
for i in $(seq 1 20); do ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock >/dev/null 2>&1 && break; sleep 0.5; done
SWAYSOCK="$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock 2>/dev/null | head -1)"
export SWAYSOCK
WAYLAND_DISPLAY="$(cd "$XDG_RUNTIME_DIR" && ls wayland-* 2>/dev/null | grep -v lock | head -1)"
export WAYLAND_DISPLAY
[ -n "$SWAYSOCK" ] && [ -n "$WAYLAND_DISPLAY" ] || { dire "ECHEC : sway ne demarre pas"; exit 1; }
rm -rf "$RACINE"

etat() {
  local quoi="$1"
  echo "      plateforme : $(ps -eo args | grep -o -- '--ozone-platform=[a-z0-9]*' | sort -u | tr '\n' ' ')" | tee -a "$R"
  echo "      page : $(node --experimental-websocket "$D/cdp_mesure.js" 9222 texte 2>&1 | cut -c1-400)" | tee -a "$R"
  echo "      codes dans la racine : $(ls "$RACINE/code" 2>/dev/null | tr '\n' ' ')" | tee -a "$R"
  echo "      processus casteria : $(pgrep -x casteria | wc -l) ; lances par un .AppImage : $(ps -eo args | grep -F '.AppImage' | grep -v -e grep -e maj_essai -e '^sh -c' -e '^bash' -e '^env ' | cut -c1-140 | tr '\n' ';')" | tee -a "$R"
  grim "$S/${P}_$quoi.png" 2>>"$R" && echo "      photo ${P}_$quoi.png" | tee -a "$R"
}

lancer() {
  swaymsg exec "env CASTERIA_DRY=1 CASTERIA_CODE=$CODE $BIN --no-sandbox --remote-debugging-port=9222 > $S/app_${P}_$1.log 2>&1" >/dev/null
}

dire "== 1er demarrage (le code 1.0.8 se telecharge)"
lancer 1
sleep 30
etat 1_premier

dire "== le bouton Redemarrer"
node --experimental-websocket "$D/redemarrer_cdp.js" 9222 2>&1 | sed 's/^/      /' | tee -a "$R"
sleep 30
etat 2_apres_redemarrer
if ! pgrep -x casteria >/dev/null; then
  # Un ancien code (1.0.4) peut ne pas revenir apres Redemarrer (la relance d'Electron sous FUSE) : le joueur le
  # rouvre alors lui-meme. On le fait aussi, et on le dit.
  dire "   le launcher n'est PAS revenu apres Redemarrer : le joueur le rouvre a la main"
  lancer 2b
  sleep 30
  etat 2b_rouvert_a_la_main
fi

dire "== fermer, puis relancer encore une fois"
pkill -x casteria 2>/dev/null
sleep 4
lancer 3
sleep 30
etat 3_relance

dire "== amorce.log complet"
sed 's/^/      /' "$RACINE/journaux/amorce.log" 2>/dev/null | cut -c1-220 | tee -a "$R"
echo "      lignes « refusee » (doit etre 0) : $(grep -c 'refusée' "$RACINE/journaux/amorce.log" 2>/dev/null)" | tee -a "$R"
pkill -x casteria 2>/dev/null
sleep 2
swaymsg exit >/dev/null 2>&1
dire "fini"
