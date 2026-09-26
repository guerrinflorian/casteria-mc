#!/bin/bash
# ============================================================
#  Le .deb du launcher sur Debian 13 (serveurmc-14, 25/09/2026) : apt resout-il ses dependances ? (simulation, rien
#  n'est installe). A lancer APRES docker_linux.sh :
#    docker run --rm -v "${PWD}:/projet" -v "${PWD}\plateformes\linux\sortie_docker:/sortie" debian:trixie `
#      bash /projet/plateformes/linux/docker/docker_debian.sh
# ============================================================
set -u
R=/sortie/rapport_debian.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export DEBIAN_FRONTEND=noninteractive
D=/sortie/Casteria-Linux-x86_64.deb
[ -f "$D" ] || { dire "ECHEC : pas de .deb dans /sortie"; exit 1; }
dire "1. $(grep PRETTY_NAME /etc/os-release | cut -d= -f2), $(ldd --version | head -1)"
apt-get update -qq >/dev/null
dire "2. apt-get install --simulate du .deb"
if apt-get install --simulate -y "$D" > /tmp/sim.log 2>&1; then
  dire "    les dependances se resolvent : $(grep -c '^Inst ' /tmp/sim.log) paquets seraient poses"
  grep -E "^Inst (libgtk-3|libnss3|libasound2|libgbm1|libatspi|casteria)" /tmp/sim.log | cut -c1-120 | tee -a "$R"
else
  dire "    ECHEC de la resolution"
  tail -20 /tmp/sim.log | tee -a "$R"
fi
dire "fini"
