#!/bin/bash
# ============================================================
#  Le paquet Arch du launcher, installe pour de vrai dans archlinux:latest (serveurmc-14, 25/09/2026).
#  A lancer APRES docker_linux.sh (il prend /sortie/Casteria-Linux-x86_64.pacman) :
#    docker run --rm -v "${PWD}:/projet" -v "${PWD}\plateformes\linux\sortie_docker:/sortie" archlinux:latest `
#      bash /projet/plateformes/linux/docker/docker_arch.sh
#  pacman -U tire les dependances declarees, puis ldd dit s'il manque encore une bibliotheque : 0 prouve que la liste
#  « depends » de electron-builder-linux.json suffit.
# ============================================================
set -u
R=/sortie/rapport_arch.txt
: > "$R"
dire() { echo "[$(date +%T)] $*" | tee -a "$R"; }
P=/sortie/Casteria-Linux-x86_64.pacman
DEBUT=$(date +%s)
[ -f "$P" ] || { dire "ECHEC : pas de paquet Arch dans /sortie"; exit 1; }

dire "1. $(grep PRETTY_NAME /etc/os-release | cut -d= -f2)"
dire "2. le paquet : son en-tete et ses droits"
pacman -Qip "$P" 2>&1 | grep -E "^(Name|Version|Depends On|Installed Size|Packager|URL|Description|Architecture)" | tee -a "$R"
bsdtar -tvf "$P" 2>/dev/null | grep -E "casteria$|chrome-sandbox|portablemc$|\.desktop|256x256" | tee -a "$R"
echo "    fichiers du paquet que tout le monde peut modifier (doit etre 0) : $(bsdtar -tvf "$P" 2>/dev/null | grep -c '^-.......w.')" | tee -a "$R"

dire "3. le systeme a jour, puis pacman -U (il tire les dependances)"
pacman -Syu --noconfirm > /tmp/syu.log 2>&1 || { dire "    mise a jour ratee"; tail -5 /tmp/syu.log | tee -a "$R"; }
# La commande de la page des joueurs, mot pour mot (en root, donc sans sudo ; --noconfirm pour ne pas attendre).
dire "    commande : cd /sortie && pacman -U --noconfirm Casteria-Linux-x86_64.pacman"
(cd /sortie && pacman -U --noconfirm Casteria-Linux-x86_64.pacman) > /tmp/u.log 2>&1 && dire "    installe" || { dire "    INSTALLATION RATEE"; tail -20 /tmp/u.log | tee -a "$R"; }
grep -E "^Packages|^Paquets|installing" /tmp/u.log | head -3 | tee -a "$R"
ls -la /usr/bin/casteria /opt/Casteria/casteria /opt/Casteria/chrome-sandbox /opt/Casteria/resources/bin/portablemc \
  /usr/share/applications/casteria.desktop 2>&1 | tee -a "$R"
ls /usr/share/icons/hicolor/*/apps/casteria.png 2>&1 | tee -a "$R"
grep -E "^(Exec|Comment|StartupWMClass|Icon)=" /usr/share/applications/casteria.desktop | tee -a "$R"

dire "4. bibliotheques manquantes apres l'installation (doit etre 0)"
ldd /opt/Casteria/casteria 2>&1 | grep "not found" | tee -a "$R"
echo "    manquantes : $(ldd /opt/Casteria/casteria 2>&1 | grep -c 'not found')" | tee -a "$R"
echo "    symboles introuvables (ldd -r, doit etre 0) : $(ldd -r /opt/Casteria/casteria 2>&1 | grep -c 'undefined symbol')" | tee -a "$R"
echo "    $(ldd --version | head -1)" | tee -a "$R"
/opt/Casteria/resources/bin/portablemc --version 2>&1 | head -1 | sed 's/^/    /' | tee -a "$R"

dire "4b. le chemin du repli X11 du paquet Arch (sway avec puis sans Xwayland)"
pacman -S --noconfirm --needed sway grim xorg-xwayland ttf-dejavu procps-ng xz > /tmp/sway.log 2>&1 || { dire "    sway ne s'installe pas"; tail -5 /tmp/sway.log | tee -a "$R"; }
# Le sway d'Arch porte une capacite de fichier (cap_sys_nice) que Docker ne donne pas : l'executer echoue en
# « Operation not permitted » (essai du 25/09). Dans ce conteneur d'essai seulement, on la lui retire.
setcap -r "$(command -v sway)" 2>/dev/null
echo "    capacites de sway apres : $(getcap "$(command -v sway)" 2>/dev/null || true)" | tee -a "$R"
tar -xJf /projet/plateformes/linux/cache/node-v20.20.2-linux-x64.tar.xz -C /opt
useradd -m joueur 2>/dev/null
mkdir -p /work/wl && chmod 777 /work/wl
if [ -x /usr/bin/casteria ] && [ "${SUITE:-}" = 107 ]; then
  # La 1.0.7 de a7 (« X11 des que DISPLAY existe ») sur le sway recent d'Arch (1.12), ambiance d'Omarchy.
  dire "    1.0.7 AVEC Xwayland : la relance en X11, echelles 1,25 et 1,5"
  su joueur -c "XWAYLAND=enable bash /projet/plateformes/linux/docker/comparer_variantes.sh a107_xw /work/wl '1.25 1.5' \
    'pacman|/usr/bin/casteria --no-sandbox'" 2>&1 | tee -a "$R"
  dire "    1.0.7 SANS Xwayland : Wayland natif, 1,25 trois fois puis 1,5"
  su joueur -c "XWAYLAND=disable bash /projet/plateformes/linux/docker/comparer_variantes.sh a107_sans_xw /work/wl '1.25 1.25 1.25 1.5' \
    'pacman|/usr/bin/casteria --no-sandbox'" 2>&1 | tee -a "$R"
elif [ -x /usr/bin/casteria ]; then
  su joueur -c "bash /projet/plateformes/linux/docker/repli_essai.sh pacman /work/wl /usr/bin/casteria --no-sandbox" 2>&1 | tee -a "$R"
fi
cp /work/wl/*.png /work/wl/*.log /work/wl/rapport_*.txt /sortie/ 2>/dev/null

dire "5. la desinstallation"
dire "    commande : pacman -R --noconfirm casteria"
pacman -R --noconfirm casteria > /tmp/r.log 2>&1 && dire "    desinstalle" || { dire "    DESINSTALLATION RATEE"; tail -10 /tmp/r.log | tee -a "$R"; }
ls -d /opt/Casteria /usr/bin/casteria /usr/share/applications/casteria.desktop 2>&1 | sed 's/^/    reste ? /' | tee -a "$R"
dire "fini en $(( $(date +%s) - DEBUT )) s"
