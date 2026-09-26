#!/bin/bash
# ============================================================
#  Les paquets LINUX du launcher et leurs essais, dans UN conteneur ubuntu:24.04 (serveurmc-14, 25/09/2026).
#
#    docker run --rm --shm-size=1g -v "${PWD}:/projet" -v "${PWD}\plateformes\linux\sortie_docker:/sortie" `
#      ubuntu:24.04 bash /projet/plateformes/linux/docker/docker_linux.sh
#  (depuis CasteriaLauncher ; le projet n'est que LU, tout sort dans /sortie)
#
#  Il faut AVANT, sous Windows :
#    - plateformes/linux/sortie/linux-unpacked (npm run linux) et le .tar.gz (node plateformes/linux/faire_targz.js) ;
#    - Node 20 pour Linux dans plateformes/linux/cache ;
#    - l'AppImage de la version d'AVANT (le defaut) : AVANT_APPIMAGE plus bas.
#  Etapes : 1-2 outils et Node ; 3-4 l'AppImage, le .deb et le paquet Arch (electron-builder) ; 5 le .deb lu puis
#  installe ; 6 le .tar.gz installe par installer.sh en simple joueur ; 7 Wayland (sway, echelles 1,25 et 1,5, avant
#  et apres) ; 8 X11 (xvfb) ; 9 la desinstallation par installer.sh.
# ============================================================
set -u
R=/sortie/rapport_linux.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
export DEBIAN_FRONTEND=noninteractive
NODE=node-v20.20.2-linux-x64
L=/projet/plateformes/linux
AVANT_APPIMAGE="${AVANT_APPIMAGE:-$L/ancien/linux_1.0.4/Casteria-Linux-x86_64.AppImage}"
DEBUT=$(date +%s)
[ -f "$AVANT_APPIMAGE" ] || { dire "ECHEC : l'AppImage d'avant manque ($AVANT_APPIMAGE)"; exit 1; }
[ -f "$L/sortie/Casteria-Linux-x86_64.tar.gz" ] || { dire "ECHEC : le .tar.gz manque"; exit 1; }

dire "1. les outils ($(grep PRETTY_NAME /etc/os-release | cut -d= -f2), $(ldd --version | head -1))"
apt-get update -qq >/dev/null
apt-get install -y -qq --no-install-recommends ca-certificates xz-utils file procps binutils zstd libarchive-tools \
  desktop-file-utils >/dev/null

dire "2. Node 20"
tar -xJf "$L/cache/$NODE.tar.xz" -C /opt && export PATH="/opt/$NODE/bin:$PATH"

dire "3. l'application depliee, et ses droits"
rm -rf /work && mkdir -p /work/sortie && cp -r "$L/sortie/linux-unpacked" /work/linux-unpacked
cd /work/linux-unpacked || exit 1
find . -type d -exec chmod 755 {} + && find . -type f -exec chmod 644 {} +
chmod 755 casteria chrome_crashpad_handler chrome-sandbox resources/bin/portablemc
for f in *.so *.so.*; do [ -f "$f" ] && chmod 755 "$f"; done
# Les icones du dossier Windows arrivent en 0777 : le .deb les posait telles quelles dans /usr/share/icons (un fichier
# que tout le monde pourrait modifier). Copiees ici en 0644, et la configuration pointe dessus.
mkdir -p /work/icones && cp "$L"/icones/*.png /work/icones/ && chmod 755 /work/icones && chmod 644 /work/icones/*.png
node -e "const c=require('$L/electron-builder-linux.json');c.directories.output='/work/sortie';c.linux.icon='/work/icones';require('fs').writeFileSync('/work/eb.json',JSON.stringify(c))"
echo "    version du code : $(node -e "console.log(JSON.parse(require('/projet/node_modules/@electron/asar').extractFile('/work/linux-unpacked/resources/app.asar','package.json')).version)" 2>&1)" | tee -a "$R"

if [ "${REUTILISER:-0}" = 1 ] && [ -f /sortie/paquets/Casteria-Linux-x86_64.deb ]; then
  # Les paquets d'un passage precedent (meme code, meme configuration), essayes tels quels : ce sont eux qui partent.
  dire "4. les paquets deja fabriques (REUTILISER=1), leurs empreintes verifiees"
  cp /sortie/paquets/Casteria-Linux-x86_64.* /work/sortie/
  (cd /work/sortie && sha256sum -c ./*.sha256) 2>&1 | sed 's/^/    /' | tee -a "$R"
else
dire "4. electron-builder : AppImage, deb, pacman"
cd /projet || exit 1
# electron-builder telecharge ses outils (appimage, fpm) sur github.com : on attend que le nom se resolve (le DNS du
# conteneur a rate une fois juste apres le demarrage de Docker, EAI_AGAIN), et on recommence jusqu'a 3 fois.
for i in $(seq 1 30); do getent hosts github.com >/dev/null && break; sleep 2; done
for tentative in 1 2 3; do
  node node_modules/electron-builder/cli.js --linux AppImage deb pacman --x64 --config /work/eb.json \
    --prepackaged /work/linux-unpacked 2>&1 | grep -v "^\s*$" | tail -25 | tee -a "$R"
  [ -f /work/sortie/Casteria-Linux-x86_64.AppImage ] && [ -f /work/sortie/Casteria-Linux-x86_64.deb ] && \
    [ -f /work/sortie/Casteria-Linux-x86_64.pacman ] && break
  dire "    tentative $tentative ratee : on recommence dans 10 s"
  sleep 10
done
fi
cd /work/sortie || exit 1
for p in Casteria-Linux-x86_64.AppImage Casteria-Linux-x86_64.deb Casteria-Linux-x86_64.pacman; do
  if [ -f "$p" ]; then
    sha256sum "$p" > "$p.sha256"
    cp "$p" "$p.sha256" /sortie/
    dire "    $p : $(stat -c %s "$p") octets, sha256 $(cut -c1-16 "$p.sha256")..."
  else
    dire "    $p : ABSENT"
  fi
done
cp "$L/sortie/Casteria-Linux-x86_64.tar.gz" /sortie/ && (cd /sortie && sha256sum Casteria-Linux-x86_64.tar.gz > Casteria-Linux-x86_64.tar.gz.sha256)

D=/work/sortie/Casteria-Linux-x86_64.deb
if [ -f "$D" ]; then
  dire "5. le .deb : son en-tete, ses droits, puis installe par apt (il tire ses dependances)"
  dpkg-deb -I "$D" | grep -E "Package|Version|Depends|Maintainer|Homepage|Installed-Size|Description" | tee -a "$R"
  dpkg-deb -c "$D" | grep -E "casteria$|chrome-sandbox|portablemc$|\.desktop|256x256" | tee -a "$R"
  echo "    fichiers du .deb que tout le monde peut modifier (doit etre vide) : $(dpkg-deb -c "$D" | grep -c '^-.......w.')" | tee -a "$R"
  # La commande de la page des joueurs, mot pour mot (en root dans le conteneur, donc sans sudo ; -y pour ne pas attendre).
  dire "    commande : cd /work/sortie && apt install -y ./Casteria-Linux-x86_64.deb"
  (cd /work/sortie && apt install -y ./Casteria-Linux-x86_64.deb) > /work/apt_deb.log 2>&1 && dire "    installe" || { dire "    INSTALLATION RATEE"; tail -20 /work/apt_deb.log | tee -a "$R"; }
  grep -c "^Setting up" /work/apt_deb.log | sed 's/^/    paquets poses par apt : /' | tee -a "$R"
  ls -la /usr/bin/casteria /opt/Casteria/casteria /opt/Casteria/chrome-sandbox /opt/Casteria/resources/bin/portablemc \
    /opt/Casteria/resources/apparmor-profile /usr/share/applications/casteria.desktop 2>&1 | tee -a "$R"
  ls /usr/share/icons/hicolor/*/apps/casteria.png 2>&1 | tee -a "$R"
  cat /usr/share/applications/casteria.desktop >> "$R"
  desktop-file-validate /usr/share/applications/casteria.desktop 2>&1 | sed 's/^/    validation : /' | tee -a "$R"
  echo "    bibliotheques manquantes : $(ldd /opt/Casteria/casteria | grep -c 'not found')" | tee -a "$R"
  # ldd -r fait aussi les liens des symboles : un libasound.so.2 sans les versions ALSA (liboss4-salsa, tire par une
  # dependance « libasound2 » virtuelle, 25/09) passait « 0 manquante » mais le launcher ne demarrait pas.
  echo "    symboles introuvables (ldd -r, doit etre 0) : $(ldd -r /opt/Casteria/casteria 2>&1 | grep -c 'undefined symbol')" | tee -a "$R"
  echo "    paquets salsa poses (doit etre 0) : $(dpkg -l | grep -c salsa)" | tee -a "$R"
  /opt/Casteria/resources/bin/portablemc --version 2>&1 | head -1 | sed 's/^/    /' | tee -a "$R"
fi

dire "6. le .tar.gz : ouvert par le joueur, installe par installer.sh (sans terminal, comme un double-clic)"
useradd -m joueur 2>/dev/null
mkdir -p /work/wl && chmod 777 /work/wl
dire "    commande : cd Casteria-Linux-x86_64 && ./installer.sh (en simple joueur, sans terminal)"
su joueur -c "mkdir -p ~/Telechargements && cd ~/Telechargements && tar -xzf /sortie/Casteria-Linux-x86_64.tar.gz && cd Casteria-Linux-x86_64 && ./installer.sh < /dev/null > /work/wl/installer.log 2>&1"
cat /work/wl/installer.log | sed 's/^/    installer.sh : /' | tee -a "$R"
H=/home/joueur/.local/share
stat -c '%A %n' $H/casteria-launcher/casteria $H/casteria-launcher/chrome-sandbox $H/casteria-launcher/resources/bin/portablemc \
  $H/casteria-launcher/lancer-casteria.sh $H/applications/casteria.desktop 2>&1 | tee -a "$R"
ls $H/icons/hicolor/*/apps/casteria.png 2>&1 | tee -a "$R"
cat $H/applications/casteria.desktop >> "$R"
desktop-file-validate $H/applications/casteria.desktop 2>&1 | sed 's/^/    validation : /' | tee -a "$R"

apt-get install -y -qq --no-install-recommends sway grim xwayland xvfb imagemagick x11-utils fonts-dejavu-core >/dev/null
APRES_BIN="${APRES_BIN:-/opt/Casteria/casteria}"
if [ ! -x "$APRES_BIN" ]; then
  APRES_BIN="$H/casteria-launcher/casteria"
  dire "    le .deb n'est pas installe : l'APRES prend le launcher installe par installer.sh ($APRES_BIN)"
fi
DOCKER_DIR=/projet/plateformes/linux/docker
if [ "${SUITE:-}" = 107 ]; then
  # La 1.0.7 de a7 (« X11 des que DISPLAY existe ») : demandes de 5b et de a7 du 25/09 vers 18:20.
  cp /work/sortie/Casteria-Linux-x86_64.AppImage /home/joueur/ && chown joueur:joueur /home/joueur/Casteria-Linux-x86_64.AppImage
  chmod 755 /home/joueur/Casteria-Linux-x86_64.AppImage
  dire "7. Omarchy (ELECTRON_OZONE_PLATFORM_HINT=wayland) AVEC Xwayland : la relance en X11, echelles 1,25 et 1,5"
  su joueur -c "XWAYLAND=enable bash $DOCKER_DIR/comparer_variantes.sh u107_xw /work/wl '1.25 1.5' \
    'deb|/usr/bin/casteria --no-sandbox' \
    'appimage|env APPIMAGE_EXTRACT_AND_RUN=1 /home/joueur/Casteria-Linux-x86_64.AppImage' \
    'targz|$H/casteria-launcher/lancer-casteria.sh'" 2>&1 | tee -a "$R"
  dire "7b. SANS Xwayland : Wayland natif (1,25 trois fois : l'ecran noir de la variante c), puis 1,5"
  su joueur -c "XWAYLAND=disable bash $DOCKER_DIR/comparer_variantes.sh u107_sans_xw /work/wl '1.25 1.25 1.25 1.5' \
    'deb|/usr/bin/casteria --no-sandbox'" 2>&1 | tee -a "$R"
  dire "7c. la mise a jour du code (1.0.8 de a7, signee par la CLE D'ESSAI) puis deux redemarrages"
  # Le launcher d'essai : la 1.0.7 installee, l'app.asar deplie, et la cle publique d'essai a la place de celle de
  # Florian dans l'amorce (consigne de a7). Dans ce conteneur seulement : rien ne part de la.
  cp -a /opt/Casteria /work/essai_maj && cd /work/essai_maj/resources && node /projet/node_modules/@electron/asar/bin/asar.js extract app.asar app && mv app.asar app.asar.origine
  sed -i "s|MCowBQYDK2VwAyEAQUp9If6rZVWRCcuG/g6rGbXsCpldCzwaeFKwqAAfKgI=|MCowBQYDK2VwAyEAKSYbcPIPiUj5EIPbDfmcLDJ1WxnurACCPkb9K+eNgcw=|" app/amorce/amorce.js
  echo "    cle d'essai dans l'amorce : $(grep -c 'MCowBQYDK2VwAyEAKSYbcPIPiUj5EIPbDfmcLDJ1WxnurACCPkb9K+eNgcw=' app/amorce/amorce.js) ; cle de Florian : $(grep -c 'MCowBQYDK2VwAyEAQUp9If6rZVWRCcuG' app/amorce/amorce.js)" | tee -a "$R"
  chmod -R a+rX /work/essai_maj
  node "$DOCKER_DIR/serveur_code.js" /projet/plateformes/linux/code_essai 8765 > /work/wl/serveur_code.log 2>&1 &
  SERVEUR_PID=$!
  sleep 1
  su joueur -c "bash $DOCKER_DIR/maj_essai.sh /work/wl /work/essai_maj/casteria http://127.0.0.1:8765/code.json" 2>&1 | tee -a "$R"
  echo "    demandes servies : $(grep -c '^200' /work/wl/serveur_code.log) (404 : $(grep -c '^404' /work/wl/serveur_code.log))" | tee -a "$R"
  kill "$SERVEUR_PID" 2>/dev/null
else
dire "7. Wayland : sway sans ecran, Xwayland, echelles 1,25 et 1,5, AVANT (1.0.4 publie) puis APRES"
mkdir -p /work/avant && cd /work/avant && cp "$AVANT_APPIMAGE" a.AppImage && chmod 755 a.AppImage && ./a.AppImage --appimage-extract >/dev/null 2>&1
chmod -R a+rX /work/avant
su joueur -c "bash /projet/plateformes/linux/docker/wayland_essai.sh /work/avant/squashfs-root/casteria $APRES_BIN /work/wl" 2>&1 | tee -a "$R"
fi

dire "8. X11 (xvfb) : APRES, puis le launcher installe par installer.sh (lancer-casteria.sh)"
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
sleep 2
su joueur -c "rm -rf ~/.local/share/Casteria; DISPLAY=:99 CASTERIA_SANS_MAJ=1 CASTERIA_DRY=1 timeout 30 $APRES_BIN --no-sandbox > /work/wl/app_x11_apres.log 2>&1" &
sleep 20
DISPLAY=:99 import -window root /work/wl/x11_apres.png 2>>"$R" && dire "    photo x11_apres.png"
echo "    plateforme : $(ps -eo args | grep -o -- '--ozone-platform[a-z-]*=[a-z0-9]*' | sort -u | tr '\n' ' ')" | tee -a "$R"
sleep 12
su joueur -c "rm -rf ~/.local/share/Casteria; DISPLAY=:99 CASTERIA_SANS_MAJ=1 CASTERIA_DRY=1 timeout 30 ~/.local/share/casteria-launcher/lancer-casteria.sh > /work/wl/app_x11_targz.log 2>&1" &
sleep 20
DISPLAY=:99 import -window root /work/wl/x11_targz.png 2>>"$R" && dire "    photo x11_targz.png"
sleep 12
pkill -x casteria 2>/dev/null
pkill Xvfb 2>/dev/null
sleep 2

if [ "${SUITE:-}" != 107 ]; then
dire "8b. le chemin du repli X11, paquet par paquet (avec puis sans Xwayland) : AppImage, .deb, .tar.gz"
REPLI=/projet/plateformes/linux/docker/repli_essai.sh
if [ -f /work/sortie/Casteria-Linux-x86_64.AppImage ]; then
  cp /work/sortie/Casteria-Linux-x86_64.AppImage /home/joueur/ && chown joueur:joueur /home/joueur/Casteria-Linux-x86_64.AppImage
  chmod 755 /home/joueur/Casteria-Linux-x86_64.AppImage
  # Pas de FUSE dans un conteneur : APPIMAGE_EXTRACT_AND_RUN=1 fait extraire puis lancer par le runtime, qui garde $APPIMAGE.
  su joueur -c "bash $REPLI appimage /work/wl env APPIMAGE_EXTRACT_AND_RUN=1 /home/joueur/Casteria-Linux-x86_64.AppImage" 2>&1 | tee -a "$R"
fi
[ -x /usr/bin/casteria ] && su joueur -c "bash $REPLI deb /work/wl /usr/bin/casteria --no-sandbox" 2>&1 | tee -a "$R"
[ -x "$H/casteria-launcher/lancer-casteria.sh" ] && su joueur -c "bash $REPLI targz /work/wl $H/casteria-launcher/lancer-casteria.sh" 2>&1 | tee -a "$R"
fi

dire "9. les desinstallations"
pkill -x casteria 2>/dev/null
sleep 2
dire "    commande : ~/.local/share/casteria-launcher/installer.sh --desinstaller (en simple joueur)"
su joueur -c "~/.local/share/casteria-launcher/installer.sh --desinstaller < /dev/null" 2>&1 | sed 's/^/    /' | tee -a "$R"
ls -d $H/casteria-launcher $H/applications/casteria.desktop $H/icons/hicolor/256x256/apps/casteria.png 2>&1 | sed 's/^/    reste ? /' | tee -a "$R"
if [ -f /usr/share/applications/casteria.desktop ]; then
  dire "    commande : apt remove -y casteria"
  apt remove -y casteria > /work/apt_remove.log 2>&1 && dire "    desinstalle" || { dire "    DESINSTALLATION RATEE"; tail -10 /work/apt_remove.log | tee -a "$R"; }
  ls -d /opt/Casteria /usr/bin/casteria /usr/share/applications/casteria.desktop 2>&1 | sed 's/^/    reste ? /' | tee -a "$R"
fi

cp /work/wl/*.png /work/wl/*.log /work/wl/rapport_*.txt /sortie/ 2>/dev/null
dire "fini en $(( $(date +%s) - DEBUT )) s"
