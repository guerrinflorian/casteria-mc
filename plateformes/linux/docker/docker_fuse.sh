#!/bin/bash
# ============================================================
#  L'AppImage comme chez un vrai joueur : monte par FUSE (serveurmc-14, 25/09/2026, demande de 5b). A lancer APRES
#  docker_linux.sh (il prend /sortie/Casteria-Linux-x86_64.AppImage et le .deb, qui tire les bibliotheques d'un bureau) :
#    docker run --rm --shm-size=1g --device /dev/fuse --cap-add SYS_ADMIN -v "${PWD}:/projet" `
#      -v "${PWD}\plateformes\linux\sortie_docker:/sortie" ubuntu:24.04 bash /projet/plateformes/linux/docker/docker_fuse.sh
#  (des options de « docker run » seulement : aucun reglage de Docker n'est touche)
#  Puis le chemin du repli X11 (repli_essai.sh appimage_fuse) : la relance doit partir de $APPIMAGE, et la fenetre relancee
#  doit tenir quand le premier processus demonte son dossier.
# ============================================================
set -u
R=/sortie/rapport_fuse.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export DEBIAN_FRONTEND=noninteractive
DEBUT=$(date +%s)
A=/sortie/Casteria-Linux-x86_64.AppImage
[ -f "$A" ] || { dire "ECHEC : pas d'AppImage dans /sortie"; exit 1; }
dire "1. $(grep PRETTY_NAME /etc/os-release | cut -d= -f2) ; /dev/fuse : $(ls -la /dev/fuse 2>&1)"
apt-get update -qq >/dev/null
(cd /sortie && apt-get install -y -qq --no-install-recommends ./Casteria-Linux-x86_64.deb fuse3 sway grim xwayland procps \
  fonts-dejavu-core xz-utils ca-certificates) > /tmp/apt.log 2>&1 || { dire "    apt a echoue"; tail -8 /tmp/apt.log | tee -a "$R"; }
tar -xJf /projet/plateformes/linux/cache/node-v20.20.2-linux-x64.tar.xz -C /opt
useradd -m joueur 2>/dev/null
cp "$A" /home/joueur/ && chown joueur:joueur /home/joueur/Casteria-Linux-x86_64.AppImage && chmod 755 /home/joueur/Casteria-Linux-x86_64.AppImage
mkdir -p /work/wl && chmod 777 /work/wl

dire "2. FUSE marche-t-il pour un simple joueur ? (--appimage-mount)"
su joueur -c "timeout 8 /home/joueur/Casteria-Linux-x86_64.AppImage --appimage-mount" > /tmp/mount.log 2>&1 &
sleep 4
head -3 /tmp/mount.log | sed 's/^/    /' | tee -a "$R"
mount | grep -c "fuse" | sed 's/^/    montages fuse : /' | tee -a "$R"
sleep 5

if grep -q "^/tmp/.mount_" /tmp/mount.log; then
  dire "3. le repli X11 de l'AppImage monte par FUSE (avec puis sans Xwayland)"
  su joueur -c "bash /projet/plateformes/linux/docker/repli_essai.sh appimage_fuse /work/wl /home/joueur/Casteria-Linux-x86_64.AppImage" 2>&1 | tee -a "$R"
else
  dire "3. FUSE ne monte pas dans ce conteneur : essai du repli par FUSE impossible ici (voir ci-dessus)"
fi
cp /work/wl/*.png /work/wl/*.log /work/wl/rapport_*.txt /sortie/ 2>/dev/null
dire "fini en $(( $(date +%s) - DEBUT )) s"
