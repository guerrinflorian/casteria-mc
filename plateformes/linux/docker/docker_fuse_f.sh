#!/bin/bash
# ============================================================
#  Le cas F seul, avec FUSE (serveurmc-14, 25/09/2026) : la relance X11 de l'AppImage tuee pour de bon (4 s de pkill),
#  puis le demarrage suivant. Attendu (garde-fou de a7) : la marque relance_x11_en_cours.json reste, et au demarrage
#  suivant « affichage : la relance X11 precedente n'a jamais montre de fenetre : plus de relance, Wayland natif ».
#    docker run --rm --shm-size=1g --device /dev/fuse --cap-add SYS_ADMIN -v "${PWD}:/projet" `
#      -v "${PWD}\plateformes\linux\sortie_docker:/sortie" ubuntu:24.04 bash /projet/plateformes/linux/docker/docker_fuse_f.sh
# ============================================================
set -u
R=/sortie/rapport_fuse_f.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export DEBIAN_FRONTEND=noninteractive
L=/projet/plateformes/linux
apt-get update -qq >/dev/null
(cd /sortie && apt-get install -y -qq --no-install-recommends ./Casteria-Linux-x86_64.deb fuse3 sway grim xwayland procps \
  fonts-dejavu-core xz-utils) > /tmp/apt.log 2>&1 || tail -5 /tmp/apt.log | tee -a "$R"
tar -xJf "$L/cache/node-v20.20.2-linux-x64.tar.xz" -C /opt
useradd -m joueur 2>/dev/null
cp /sortie/Casteria-Linux-x86_64.AppImage /home/joueur/ && chown joueur:joueur /home/joueur/Casteria-Linux-x86_64.AppImage
chmod 755 /home/joueur/Casteria-Linux-x86_64.AppImage
mkdir -p /work/wl && chmod 777 /work/wl
dire "le cas F, AppImage par FUSE (sha256 $(sha256sum /sortie/Casteria-Linux-x86_64.AppImage | cut -c1-16)...)"
su joueur -c "CAS=F bash $L/docker/repli_essai.sh appimage_fuse_f /work/wl /home/joueur/Casteria-Linux-x86_64.AppImage" 2>&1 | tee -a "$R"
cp /work/wl/*.png /work/wl/*.log /work/wl/rapport_*.txt /sortie/ 2>/dev/null
dire "fini"
