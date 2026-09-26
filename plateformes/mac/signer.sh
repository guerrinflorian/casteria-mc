#!/bin/sh
# LE PAQUET MAC DU LAUNCHER, étape 2 sur 3 : la signature ad hoc, dans un conteneur Linux (serveurmc-2e, 25/09/2026).
# Pourquoi Linux : le .app d'Electron a des liens symboliques (Versions/Current -> A...) que Windows ne sait pas poser
# sans le mode développeur, et rcodesign signe un .app posé sur un disque. Lancement, depuis Windows :
#   docker run --rm -v "<CasteriaLauncher>\plateformes\mac:/travail" alpine:3.20 sh /travail/signer.sh
# Entrée : sortie/*-a-signer.tar.gz (fabriquer_mac.js). Sortie : sortie/*-signe.tar.gz et le journal de rcodesign.
# Pas de certificat : « rcodesign sign » sans clé fait une signature AD HOC (des empreintes, sans identité), ce qui
# suffit pour qu'un Mac Apple Silicon accepte de lancer le programme. Pas de notarisation (compte Apple payant).
set -eu
cd /travail
RCTGZ=cache/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz
echo "dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002  $RCTGZ" | sha256sum -c -
mkdir -p /opt/rc
tar -xzf "$RCTGZ" -C /opt/rc
RC=$(find /opt/rc -type f -name rcodesign | head -n 1)
"$RC" --version
for f in sortie/*-a-signer.tar.gz; do
  base=$(basename "$f" -a-signer.tar.gz)
  rm -rf /tmp/app
  mkdir -p /tmp/app
  tar -xzf "$f" -C /tmp/app
  APP=$(find /tmp/app -maxdepth 1 -name '*.app' | head -n 1)
  echo "== $base : $(basename "$APP")"
  # 1re signature : rcodesign re-signe aussi Contents/Resources/bin/portablemc (tout Mach-O d'un bundle).
  "$RC" sign "$APP" > "/tmp/journal_1.txt" 2>&1 || { cat /tmp/journal_1.txt; exit 1; }
  # L'empreinte du portablemc LIVRÉ va dans empreintes.json, puis la 2e signature scelle ce fichier à jour.
  SHA=$(sha256sum "$APP/Contents/Resources/bin/portablemc" | cut -d' ' -f1)
  grep -q __SHA256_LIVRE__ "$APP/Contents/Resources/bin/empreintes.json"
  sed -i "s/__SHA256_LIVRE__/$SHA/" "$APP/Contents/Resources/bin/empreintes.json"
  "$RC" sign "$APP" > "/tmp/journal_2.txt" 2>&1 || { cat /tmp/journal_2.txt; exit 1; }
  SHA2=$(sha256sum "$APP/Contents/Resources/bin/portablemc" | cut -d' ' -f1)
  if [ "$SHA" != "$SHA2" ]; then echo "ECHEC : portablemc a change entre les deux signatures ($SHA puis $SHA2)"; exit 1; fi
  cat /tmp/journal_1.txt /tmp/journal_2.txt > "sortie/$base-journal-signature.txt"
  "$RC" print-signature-info "$APP/Contents/MacOS/$(basename "$APP" .app)" > "sortie/$base-signature-principale.txt" 2>&1 || true
  (cd /tmp/app && tar -czf "/travail/sortie/$base-signe.tar.gz" "$(basename "$APP")")
  echo "SIGNE $base (portablemc livre : $SHA)"
done
echo "FIN SIGNATURE"
