#!/bin/bash
# ============================================================
#  Pourquoi l'AppImage monte par FUSE ne revient pas apres la relance X11 (serveurmc-14, 25/09/2026) : on suit ses
#  processus toutes les 0,2 s pendant 10 s (le relauncher d'Electron, les montages /tmp/.mount_*).
#    docker run --rm --shm-size=1g --device /dev/fuse --cap-add SYS_ADMIN -v "${PWD}:/projet" `
#      -v "${PWD}\plateformes\linux\sortie_docker:/sortie" ubuntu:24.04 bash /projet/plateformes/linux/docker/docker_fuse_diag.sh
# ============================================================
set -u
R=/sortie/rapport_fuse_diag.txt
: > "$R"
dire() { echo "[$(date +%T.%N | cut -c1-12)] $*" | tee -a "$R"; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null
(cd /sortie && apt-get install -y -qq --no-install-recommends ./Casteria-Linux-x86_64.deb fuse3 sway xwayland procps \
  fonts-dejavu-core) > /tmp/apt.log 2>&1 || tail -5 /tmp/apt.log | tee -a "$R"
useradd -m joueur 2>/dev/null
cp /sortie/Casteria-Linux-x86_64.AppImage /home/joueur/ && chown joueur:joueur /home/joueur/Casteria-Linux-x86_64.AppImage
chmod 755 /home/joueur/Casteria-Linux-x86_64.AppImage
cat > /home/joueur/diag.sh <<'FIN'
#!/bin/bash
export XDG_RUNTIME_DIR=/tmp/xdg-diag
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
printf 'output HEADLESS-1 resolution 1920x1080 scale 1.25\nxwayland enable\n' > ~/sway.conf
export XDG_SESSION_TYPE=wayland ELECTRON_OZONE_PLATFORM_HINT=wayland
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 sway -c ~/sway.conf > /tmp/sway_diag.log 2>&1 &
for i in $(seq 1 20); do ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock >/dev/null 2>&1 && break; sleep 0.5; done
export SWAYSOCK="$(ls "$XDG_RUNTIME_DIR"/sway-ipc.*.sock | head -1)"
swaymsg exec "env CASTERIA_SANS_MAJ=1 CASTERIA_DRY=1 /home/joueur/Casteria-Linux-x86_64.AppImage > /tmp/app_diag.log 2>&1" >/dev/null
precedent=""
for i in $(seq 1 50); do
  etat="$(ps -eo pid,ppid,stat,args | grep -E 'casteria|Casteria-Linux|relauncher' | grep -v -e grep -e diag.sh | sed 's/ --[a-z-]*=[^ ]*//g' | cut -c1-150 | sort)"
  montages="$(mount | grep -o '/tmp/.mount_[A-Za-z0-9]*' | tr '\n' ' ')"
  bloc="$etat | montages : $montages"
  if [ "$bloc" != "$precedent" ]; then
    echo "--- a $((i * 200)) ms : montages : ${montages:-aucun}"
    echo "$etat"
    precedent="$bloc"
  fi
  sleep 0.2
done
sleep 10
echo "--- a 20 s : $(pgrep -x casteria | wc -l) processus casteria ; montages : $(mount | grep -o '/tmp/.mount_[A-Za-z0-9]*' | tr '\n' ' ')"
echo "--- journal de l'application :"
grep -v -i dbus /tmp/app_diag.log | head -12
echo "--- amorce.log :"
cat ~/.local/share/Casteria/journaux/amorce.log 2>/dev/null
FIN
chmod 755 /home/joueur/diag.sh
dire "suivi des processus de l'AppImage (FUSE, Xwayland, ambiance Omarchy)"
su joueur -c "bash ~/diag.sh" 2>&1 | tee -a "$R"
dire "fini"
