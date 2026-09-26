#!/bin/bash
# ============================================================
#  L'AppImage comme chez un vrai joueur (FUSE), apres le correctif de a7 (relance par spawn detache de $APPIMAGE et la
#  marque « relance X11 en cours ») : serveurmc-14, 25/09/2026, demandes de 5b. A lancer APRES docker_linux.sh.
#    docker run --rm --shm-size=1g --device /dev/fuse --cap-add SYS_ADMIN -v "${PWD}:/projet" `
#      -v "${PWD}\plateformes\linux\sortie_docker:/sortie" ubuntu:24.04 bash /projet/plateformes/linux/docker/docker_fuse2.sh
#  1. le nouvel AppImage monte par FUSE : cas A a F de repli_essai.sh (F : la relance X11 tuee, la marque doit la
#     rattraper au demarrage suivant) ;
#  2. un AppImage 1.0.4 DEJA installe (le 1.0.4 publie, la cle d'essai de a7 dans son amorce, reconstruit par
#     electron-builder depuis ce dossier : pas de squashfs fait a la main) qui recoit le nouveau code par la mise a
#     jour (code_essai de a7), puis deux redemarrages.
# ============================================================
set -u
R=/sortie/rapport_fuse2.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export DEBIAN_FRONTEND=noninteractive
L=/projet/plateformes/linux
D=$L/docker
DEBUT=$(date +%s)
A=/sortie/Casteria-Linux-x86_64.AppImage
[ -f "$A" ] || { dire "ECHEC : pas d'AppImage dans /sortie"; exit 1; }
dire "1. $(grep PRETTY_NAME /etc/os-release | cut -d= -f2) ; /dev/fuse : $(ls -la /dev/fuse 2>&1 | cut -c1-40)"
apt-get update -qq >/dev/null
(cd /sortie && apt-get install -y -qq --no-install-recommends ./Casteria-Linux-x86_64.deb fuse3 sway grim xwayland procps \
  fonts-dejavu-core xz-utils ca-certificates file) > /tmp/apt.log 2>&1 || { dire "apt a echoue"; tail -8 /tmp/apt.log | tee -a "$R"; }
tar -xJf "$L/cache/node-v20.20.2-linux-x64.tar.xz" -C /opt
export PATH="/opt/node-v20.20.2-linux-x64/bin:$PATH"
useradd -m joueur 2>/dev/null
cp "$A" /home/joueur/ && chown joueur:joueur /home/joueur/Casteria-Linux-x86_64.AppImage && chmod 755 /home/joueur/Casteria-Linux-x86_64.AppImage
mkdir -p /work/wl && chmod 777 /work/wl
echo "    sha256 de l'AppImage essaye : $(sha256sum "$A" | cut -c1-16)..." | tee -a "$R"

dire "2. le nouvel AppImage, monte par FUSE : cas A a F"
su joueur -c "bash $D/repli_essai.sh appimage_fuse /work/wl /home/joueur/Casteria-Linux-x86_64.AppImage" 2>&1 | tee -a "$R"

dire "3. un AppImage 1.0.4 d'essai (cle d'essai), reconstruit par electron-builder"
mkdir -p /work/a104 && cd /work/a104 && cp "$L/ancien/linux_1.0.4/Casteria-Linux-x86_64.AppImage" a.AppImage && chmod 755 a.AppImage
./a.AppImage --appimage-extract >/dev/null 2>&1
mkdir -p /work/app104
(cd squashfs-root && for f in * ; do case "$f" in AppRun|usr|*.desktop|casteria.png) ;; *) cp -a "$f" /work/app104/ ;; esac; done)
cd /work/app104/resources && node /projet/node_modules/@electron/asar/bin/asar.js extract app.asar app && mv app.asar /work/app104_asar_origine
echo "    version du code 1.0.4 d'essai : $(node -e "console.log(require('/work/app104/resources/app/package.json').version)")" | tee -a "$R"
sed -i "s|MCowBQYDK2VwAyEAQUp9If6rZVWRCcuG/g6rGbXsCpldCzwaeFKwqAAfKgI=|MCowBQYDK2VwAyEAKSYbcPIPiUj5EIPbDfmcLDJ1WxnurACCPkb9K+eNgcw=|" app/amorce/amorce.js
echo "    cle d'essai dans l'amorce 1.0.4 : $(grep -c 'MCowBQYDK2VwAyEAKSYbcPIPiUj5EIPbDfmcLDJ1WxnurACCPkb9K+eNgcw=' app/amorce/amorce.js) ; cle de Florian : $(grep -c 'MCowBQYDK2VwAyEAQUp9If6rZVWRCcuG' app/amorce/amorce.js)" | tee -a "$R"
cd /work/app104 && find . -type d -exec chmod 755 {} + && find . -type f -exec chmod 644 {} +
chmod 755 casteria chrome_crashpad_handler chrome-sandbox resources/bin/portablemc
for f in *.so *.so.*; do [ -f "$f" ] && chmod 755 "$f"; done
mkdir -p /work/icones && cp "$L"/icones/*.png /work/icones/ && chmod 644 /work/icones/*.png
node -e "const c=require('$L/electron-builder-linux.json');c.directories.output='/work/sortie104';c.linux.icon='/work/icones';c.appImage.artifactName='Casteria-104-essai.AppImage';require('fs').writeFileSync('/work/eb104.json',JSON.stringify(c))"
for i in $(seq 1 30); do getent hosts github.com >/dev/null && break; sleep 2; done
cd /projet && node node_modules/electron-builder/cli.js --linux AppImage --x64 --config /work/eb104.json --prepackaged /work/app104 2>&1 | grep -E "building|rror" | tee -a "$R"
if [ -f /work/sortie104/Casteria-104-essai.AppImage ]; then
  cp /work/sortie104/Casteria-104-essai.AppImage /home/joueur/ && chown joueur:joueur /home/joueur/Casteria-104-essai.AppImage && chmod 755 /home/joueur/Casteria-104-essai.AppImage
  dire "4. l'AppImage 1.0.4 d'essai recoit le nouveau code (code_essai de a7), par FUSE, puis deux redemarrages"
  echo "    code servi : $(node -e "console.log(require('$L/code_essai/code.json').version)")" | tee -a "$R"
  node "$D/serveur_code.js" "$L/code_essai" 8765 > /work/wl/serveur_code104.log 2>&1 &
  SERVEUR_PID=$!
  sleep 1
  su joueur -c "bash $D/maj_essai.sh /work/wl /home/joueur/Casteria-104-essai.AppImage http://127.0.0.1:8765/code.json maj104" 2>&1 | tee -a "$R"
  echo "    demandes servies : $(grep -c '^200' /work/wl/serveur_code104.log) (404 : $(grep -c '^404' /work/wl/serveur_code104.log))" | tee -a "$R"
  kill "$SERVEUR_PID" 2>/dev/null
else
  dire "   l'AppImage 1.0.4 d'essai n'a pas pu etre fabrique"
fi
cp /work/wl/*.png /work/wl/*.log /work/wl/rapport_*.txt /sortie/ 2>/dev/null
dire "fini en $(( $(date +%s) - DEBUT )) s"
