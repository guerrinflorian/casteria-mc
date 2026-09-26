#!/bin/bash
# ============================================================
#  Ubuntu 24.04 (sway 1.9) : la 1.0.6 telle quelle (b) et forcee en X11 (d), echelles 1, 1,25, 1,5 et 2 (serveurmc-14,
#  25/09/2026, demande de 5b : la voie X11 marche-t-elle partout ?).
#    docker run --rm --shm-size=1g -v "${PWD}:/projet" -v "${PWD}\plateformes\linux\sortie_docker:/sortie" ubuntu:24.04 `
#      bash /projet/plateformes/linux/docker/docker_ubuntu_variantes.sh
# ============================================================
set -u
R=/sortie/rapport_ubuntu_variantes.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export DEBIAN_FRONTEND=noninteractive
L=/projet/plateformes/linux
DEBUT=$(date +%s)
dire "1. $(grep PRETTY_NAME /etc/os-release | cut -d= -f2) : le .deb, sway, grim, Xwayland"
apt-get update -qq >/dev/null
(cd /sortie && apt-get install -y -qq --no-install-recommends ./Casteria-Linux-x86_64.deb sway grim xwayland procps \
  fonts-dejavu-core xz-utils ca-certificates) > /tmp/apt.log 2>&1 || { dire "apt a echoue"; tail -8 /tmp/apt.log | tee -a "$R"; }
echo "    symboles introuvables (ldd -r) : $(ldd -r /opt/Casteria/casteria 2>&1 | grep -c 'undefined symbol')" | tee -a "$R"
tar -xJf "$L/cache/node-v20.20.2-linux-x64.tar.xz" -C /opt
useradd -m joueur 2>/dev/null
mkdir -p /work/wl && chmod 777 /work/wl
dire "2. b) et d) sous sway 1.9, echelles 1, 1,25, 1,5 et 2"
su joueur -c "bash $L/docker/comparer_variantes.sh ubuntu /work/wl '1 1.25 1.5 2' \
  'b_106|/usr/bin/casteria --no-sandbox' \
  'd_106_x11|/usr/bin/casteria --no-sandbox --ozone-platform=x11'" 2>&1 | tee -a "$R"
cp /work/wl/*.png /work/wl/*.log /work/wl/rapport_*.txt /sortie/ 2>/dev/null
dire "fini en $(( $(date +%s) - DEBUT )) s"
