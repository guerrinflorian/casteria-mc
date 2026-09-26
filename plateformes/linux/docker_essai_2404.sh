#!/bin/bash
# ============================================================
#  L'AppImage du launcher Casteria sur un Linux RECENT (ubuntu:24.04, glibc 2.39), serveurmc-14, 25/09/2026.
#  A lancer APRES docker_appimage.sh (il prend l'AppImage qu'il a mis dans /sortie). Ecrit rapport_2404.txt et
#  capture_2404_*.png dans /sortie. Ici PortableMC doit repondre, et le launcher ne doit PAS dire « Linux trop ancien ».
#
#    docker run --rm --shm-size=512m -v "${PWD}\plateformes\linux\sortie_docker:/sortie" ubuntu:24.04 bash /sortie/docker_essai_2404.sh
#  (le script est recopie dans sortie_docker juste avant)
# ============================================================
set -u
R=/sortie/rapport_2404.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export DEBIAN_FRONTEND=noninteractive
A=/sortie/Casteria-Linux-x86_64.AppImage
DEBUT=$(date +%s)
[ -f "$A" ] || { dire "ECHEC : pas d'AppImage dans /sortie"; exit 1; }

dire "1. $(grep PRETTY_NAME /etc/os-release), $(ldd --version | head -1)"
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends ca-certificates procps xvfb imagemagick x11-utils fonts-dejavu-core \
  libgtk-3-0t64 libnss3 libgbm1 libasound2t64 libxss1 libxshmfence1 libdrm2 libxkbcommon0 libatk-bridge2.0-0t64 libcups2t64 >/dev/null

dire "2. l'AppImage extraite : PortableMC repond ici (glibc 2.39)"
mkdir -p /work && cp "$A" /work/ && cd /work && ./Casteria-Linux-x86_64.AppImage --appimage-extract >/dev/null 2>&1
squashfs-root/resources/bin/portablemc --version 2>&1 | head -2 | tee -a "$R"
echo "    manquantes : $(ldd squashfs-root/casteria 2>&1 | grep -c 'not found')" | tee -a "$R"

dire "3. le lancement en simple joueur, CASTERIA_DRY=1, sous un ecran virtuel"
useradd -m joueur 2>/dev/null
cp "$A" /home/joueur/ && chown joueur:joueur /home/joueur/Casteria-Linux-x86_64.AppImage && chmod 755 /home/joueur/Casteria-Linux-x86_64.AppImage
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
sleep 2
su joueur -c "cd ~ && DISPLAY=:99 CASTERIA_DRY=1 timeout 45 ./Casteria-Linux-x86_64.AppImage --appimage-extract-and-run > ~/app.log 2>&1" &
sleep 30
DISPLAY=:99 import -window root /sortie/capture_2404_30s.png 2>>"$R"
dire "    photo : capture_2404_30s.png"
echo "--- les fenetres :" >> "$R"; DISPLAY=:99 xwininfo -root -tree 2>&1 | grep -i casteria | head -4 >> "$R"
sleep 16
grep -v -i "dbus" /home/joueur/app.log | head -20 >> "$R"
dire "fini en $(( $(date +%s) - DEBUT )) s"
