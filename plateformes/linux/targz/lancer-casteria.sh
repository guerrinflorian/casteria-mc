#!/bin/sh
# Lance le launcher Casteria (version .tar.gz pour Linux).
# Le bac a sable de Chromium a besoin des espaces de noms d'utilisateur. S'ils sont fermes (Ubuntu 24.04 et
# suivantes, certains Debian), on lance sans lui, comme le fait l'AppImage.
ICI="$(dirname "$(readlink -f "$0")")"
if unshare -Ur true 2>/dev/null; then
  exec "$ICI/casteria" "$@"
else
  exec "$ICI/casteria" --no-sandbox "$@"
fi
