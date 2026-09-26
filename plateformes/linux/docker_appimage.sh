#!/bin/bash
# ============================================================
#  Le paquet LINUX du launcher Casteria (serveurmc-14, 25/09/2026), dans un conteneur ubuntu:22.04, d'une traite.
#
#  Lance par (PowerShell, depuis CasteriaLauncher) :
#    docker pull ubuntu:22.04
#    docker run --rm --shm-size=512m -v "${PWD}:/projet" -v "${PWD}\plateformes\linux\sortie_docker:/sortie" `
#      ubuntu:22.04 bash /projet/plateformes/linux/docker_appimage.sh
#
#  Il faut AVANT, sous Windows : l'application Linux depliee (plateformes/linux/sortie/linux-unpacked, faite par
#  electron-builder --linux dir avec plateformes/linux/electron-builder-linux.json) et Node 20 pour Linux dans
#  plateformes/linux/cache (sha256 verifie contre SHASUMS256.txt). Le projet n'est que LU : tout sort dans /sortie
#  (rapport.txt, l'AppImage, app.log, capture_xvfb_*.png).
# ============================================================
set -u
R=/sortie/rapport.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export DEBIAN_FRONTEND=noninteractive
NODE=node-v20.20.2-linux-x64
A=/work/sortie/Casteria-Linux-x86_64.AppImage
DEBUT=$(date +%s)

dire "1. les outils de base"
apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends ca-certificates xz-utils file procps >/dev/null
dire "   $(grep PRETTY_NAME /etc/os-release)"

dire "2. Node 20 (telecharge et verifie sous Windows)"
tar -xJf "/projet/plateformes/linux/cache/$NODE.tar.xz" -C /opt && export PATH="/opt/$NODE/bin:$PATH"
dire "   node $(node -v)"

dire "3. l'application depliee, copiee dans le conteneur, et ses DROITS poses (Windows n'en a pas)"
rm -rf /work && mkdir -p /work/sortie && cp -r /projet/plateformes/linux/sortie/linux-unpacked /work/linux-unpacked
cd /work/linux-unpacked || exit 1
find . -type d -exec chmod 755 {} + && find . -type f -exec chmod 644 {} +
chmod 755 casteria chrome_crashpad_handler chrome-sandbox resources/bin/portablemc
for f in *.so *.so.*; do [ -f "$f" ] && chmod 755 "$f"; done
node -e "const c=require('/projet/plateformes/linux/electron-builder-linux.json');c.directories.output='/work/sortie';require('fs').writeFileSync('/work/eb.json',JSON.stringify(c))"

dire "4. electron-builder : l'AppImage (outils appimage 1.0.3 : runtime statique, sans libfuse2)"
cd /projet || exit 1
node node_modules/electron-builder/cli.js --linux AppImage --x64 --config /work/eb.json --prepackaged /work/linux-unpacked 2>&1 | tail -15 | tee -a "$R"
[ -f "$A" ] || { dire "ECHEC : pas d'AppImage"; exit 1; }
cp "$A" /sortie/
(cd /sortie && sha256sum Casteria-Linux-x86_64.AppImage > Casteria-Linux-x86_64.AppImage.sha256)
dire "   fabrique en $(( $(date +%s) - DEBUT )) s depuis le debut"

dire "5. l'AppImage : type, taille, marque AppImage (octets 8 a 10 : A I 2), empreinte"
file "$A" | tee -a "$R"
ls -la "$A" | tee -a "$R"
od -An -c -j8 -N3 "$A" | tee -a "$R"
sha256sum "$A" | tee -a "$R"

dire "6. extraite par son propre runtime (sans FUSE) : les droits, l'entree de bureau, AppRun"
cd /work && "$A" --appimage-extract >/dev/null 2>&1
S=squashfs-root
stat -c '%A %n' $S/AppRun $S/casteria $S/chrome_crashpad_handler $S/chrome-sandbox $S/libffmpeg.so $S/resources/bin/portablemc \
  $S/resources/app.asar $S/resources/bin/empreintes.json $S/*.desktop $S/.DirIcon 2>&1 | tee -a "$R"
echo "--- fichiers NON executables parmi les binaires ELF (doit etre vide) :" >> "$R"
find $S -type f ! -perm -u+x -exec sh -c 'file -b "$1" | grep -q ELF && echo "$1"' _ {} \; >> "$R"
echo "--- icones :" >> "$R"; find $S/usr/share/icons -type f >> "$R"
echo "--- l'entree de bureau :" >> "$R"; cat $S/*.desktop >> "$R"
echo "--- empreinte de PortableMC dans l'AppImage (attendu 18610960...d151) :" >> "$R"; sha256sum $S/resources/bin/portablemc >> "$R"

dire "7. les bibliotheques qui MANQUENT sur une Ubuntu 22.04 nue (un bureau les a presque toujours)"
ldd $S/casteria 2>&1 | grep "not found" | tee -a "$R"

dire "8. PortableMC repond (Linux x86_64)"
$S/resources/bin/portablemc --version 2>&1 | head -3 | tee -a "$R"

dire "9. la logique de a7 (src/portablemc.js) sur l'application extraite : empreinte, copie, chmod 755"
node -e "
const P=require('/projet/src/portablemc.js');
const livre=P.cheminLivre({installe:true,resources:'/work/squashfs-root/resources',projet:'/projet'});
const cible=P.preparer({livre,racine:'/work/racine_essai',empreintes:P.lireEmpreintes(livre)});
console.log('livre',livre);console.log('pret',cible,(require('fs').statSync(cible).mode&511).toString(8));
" 2>&1 | tee -a "$R"
/work/racine_essai/bin/portablemc --version 2>&1 | head -1 | tee -a "$R"

dire "10. les bibliotheques d'un bureau, et un ecran virtuel"
apt-get install -y -qq --no-install-recommends xvfb imagemagick libgtk-3-0 libnss3 libgbm1 libasound2 libxss1 libxshmfence1 \
  libdrm2 libxkbcommon0 libatk-bridge2.0-0 libcups2 fonts-dejavu-core util-linux x11-utils >/dev/null
dire "    manquantes apres : $(ldd $S/casteria 2>&1 | grep -c 'not found')"

dire "11. le lancement, en simple joueur (pas root), en mode d'essai CASTERIA_DRY=1, sous un ecran virtuel"
useradd -m joueur 2>/dev/null
cp "$A" /home/joueur/ && chown joueur:joueur /home/joueur/Casteria-Linux-x86_64.AppImage && chmod 755 /home/joueur/Casteria-Linux-x86_64.AppImage
if su joueur -c "unshare -Ur true" 2>/dev/null; then dire "    espaces de noms : oui (AppRun garde le bac a sable)"; else dire "    espaces de noms : non (AppRun ajoute --no-sandbox tout seul)"; fi
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
sleep 2
su joueur -c "cd ~ && DISPLAY=:99 CASTERIA_DRY=1 timeout 60 ./Casteria-Linux-x86_64.AppImage --appimage-extract-and-run > ~/app.log 2>&1" &
sleep 20
DISPLAY=:99 import -window root /sortie/capture_xvfb_20s.png 2>>"$R"
sleep 20
DISPLAY=:99 import -window root /sortie/capture_xvfb_40s.png 2>>"$R"
dire "    photos de l'ecran virtuel : capture_xvfb_20s.png et capture_xvfb_40s.png"
echo "--- les fenetres (nom et classe, pour StartupWMClass) :" >> "$R"; DISPLAY=:99 xwininfo -root -tree 2>&1 | grep -i -E "casteria|electron" | head -8 >> "$R"
echo "--- les processus du launcher a 40 s :" >> "$R"; ps -eo user,args | grep -i casteria | grep -v grep | cut -c1-200 >> "$R"
sleep 2
cp /home/joueur/app.log /sortie/app.log 2>/dev/null
echo "--- le dossier du launcher du joueur (~/.local/share/Casteria) :" >> "$R"
ls -la /home/joueur/.local/share/Casteria 2>&1 | head -20 >> "$R"
ls -la /home/joueur/.local/share/Casteria/bin 2>&1 | head -10 >> "$R"
pkill -f Casteria-Linux 2>/dev/null; pkill -f squashfs-root 2>/dev/null; sleep 2

T=/projet/plateformes/linux/sortie/Casteria-Linux-x86_64.tar.gz
if [ -f "$T" ]; then
  dire "12. la roue de secours .tar.gz : ouverte par le joueur, les droits, puis lancee par lancer-casteria.sh"
  su joueur -c "cd ~ && tar -xzf $T" 2>&1 | tee -a "$R"
  stat -c '%A %n' /home/joueur/Casteria-Linux-x86_64/casteria /home/joueur/Casteria-Linux-x86_64/chrome-sandbox \
    /home/joueur/Casteria-Linux-x86_64/resources/bin/portablemc /home/joueur/Casteria-Linux-x86_64/lancer-casteria.sh 2>&1 | tee -a "$R"
  su joueur -c "cd ~/Casteria-Linux-x86_64 && ./installer-raccourci.sh && cat ~/.local/share/applications/casteria.desktop" >> "$R" 2>&1
  su joueur -c "cd ~/Casteria-Linux-x86_64 && DISPLAY=:99 CASTERIA_DRY=1 timeout 30 ./lancer-casteria.sh > ~/app_targz.log 2>&1" &
  sleep 25
  DISPLAY=:99 import -window root /sortie/capture_targz_25s.png 2>>"$R"
  dire "    photo : capture_targz_25s.png"
  sleep 6
  cp /home/joueur/app_targz.log /sortie/app_targz.log 2>/dev/null
fi
dire "fini en $(( $(date +%s) - DEBUT )) s"
