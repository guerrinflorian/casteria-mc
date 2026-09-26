#!/bin/bash
# ============================================================
#  Arch (sway recent) : 4 variantes du launcher, echelles 1, 1,25, 1,5 et 2 (serveurmc-14, 25/09/2026, demandes de 5b
#  et de a7). a) 1.0.4 publie ; b) paquet Arch 1.0.6 tel quel ; c) 1.0.6 SANS disable-features=WaylandFractionalScaleV1
#  (copie retouchee dans le conteneur seulement, rien ne part de la) ; d) 1.0.6 forcee en X11 (--ozone-platform=x11).
#  Puis un essai de Hyprland sans ecran (1.0.4 puis 1.0.6), s'il demarre ici.
#    docker run --rm --shm-size=1g -v "${PWD}:/projet" -v "${PWD}\plateformes\linux\sortie_docker:/sortie" archlinux:latest `
#      bash /projet/plateformes/linux/docker/docker_arch_wayland.sh
# ============================================================
set -u
R=/sortie/rapport_arch_wayland.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
L=/projet/plateformes/linux
DEBUT=$(date +%s)
dire "1. $(grep PRETTY_NAME /etc/os-release | cut -d= -f2) : le paquet Arch, sway, grim, Xwayland"
pacman -Syu --noconfirm > /tmp/syu.log 2>&1
(cd /sortie && pacman -U --noconfirm Casteria-Linux-x86_64.pacman) > /tmp/u.log 2>&1 || { dire "pacman -U RATE"; tail -5 /tmp/u.log | tee -a "$R"; }
pacman -S --noconfirm --needed sway grim xorg-xwayland ttf-dejavu procps-ng xz > /tmp/sway.log 2>&1 || tail -5 /tmp/sway.log | tee -a "$R"
setcap -r "$(command -v sway)" 2>/dev/null
dire "   versions : $(pacman -Q sway xorg-xwayland 2>/dev/null | tr '\n' ' ') $(pacman -Qs '^wlroots' 2>/dev/null | grep -o 'wlroots[0-9.]* [0-9.-]*' | tr '\n' ' ')"
tar -xJf "$L/cache/node-v20.20.2-linux-x64.tar.xz" -C /opt
export PATH="/opt/node-v20.20.2-linux-x64/bin:$PATH"
useradd -m joueur 2>/dev/null
mkdir -p /work/avant /work/wl && chmod 777 /work/wl

# a) la 1.0.4 publiee, extraite de son AppImage
cd /work/avant && cp "$L/ancien/linux_1.0.4/Casteria-Linux-x86_64.AppImage" a.AppImage && chmod 755 a.AppImage && ./a.AppImage --appimage-extract >/dev/null 2>&1
# c) la 1.0.6 sans le commutateur : l'app.asar deplie, la ligne qui ajoute WaylandFractionalScaleV1 retiree
cp -a /opt/Casteria /work/c && cd /work/c/resources && node /projet/node_modules/@electron/asar/bin/asar.js extract app.asar app && mv app.asar app.asar.origine
echo "    variante c : lignes qui ajoutent WaylandFractionalScaleV1 AVANT retouche : $(grep -c "liste.push('WaylandFractionalScaleV1')" app/src/affichage.js)" | tee -a "$R"
sed -i "/liste.push('WaylandFractionalScaleV1')/d" app/src/affichage.js
echo "    variante c : APRES retouche : $(grep -c "liste.push('WaylandFractionalScaleV1')" app/src/affichage.js)" | tee -a "$R"
chmod -R a+rX /work/avant /work/c

dire "2. les 4 variantes sous sway, echelles 1, 1,25, 1,5 et 2"
su joueur -c "bash $L/docker/comparer_variantes.sh arch /work/wl '1 1.25 1.5 2' \
  'a_104|/work/avant/squashfs-root/casteria --no-sandbox' \
  'b_106|/usr/bin/casteria --no-sandbox' \
  'c_106_sans_commutateur|/work/c/casteria --no-sandbox' \
  'd_106_x11|/usr/bin/casteria --no-sandbox --ozone-platform=x11'" 2>&1 | tee -a "$R"

dire "3. Hyprland sans ecran (1.0.4 puis 1.0.6 a 1,25), s'il demarre dans ce conteneur"
pacman -S --noconfirm --needed hyprland > /tmp/hypr.log 2>&1 || { dire "   hyprland ne s'installe pas"; tail -3 /tmp/hypr.log | tee -a "$R"; }
if command -v Hyprland >/dev/null; then
  setcap -r "$(command -v Hyprland)" 2>/dev/null
  dire "   $(pacman -Q hyprland 2>/dev/null)"
  su joueur -c "bash $L/docker/hyprland_essai.sh /work/wl /work/avant/squashfs-root/casteria /usr/bin/casteria" 2>&1 | tee -a "$R"
fi
cp /work/wl/*.png /work/wl/*.log /work/wl/rapport_*.txt /sortie/ 2>/dev/null
dire "fini en $(( $(date +%s) - DEBUT )) s"
