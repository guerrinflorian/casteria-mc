#!/usr/bin/env bash
# Attend que le jeu lance par le test arrive au menu (ou meure). Une seule ligne de resultat.
# Usage : attendre_menu.sh <dossier du jeu (mc-dir)> <sortie de portablemc> <secondes max>
JEU="$1"; SORTIE="$2"; MAX="${3:-300}"
LOG="$JEU/logs/latest.log"
OUT="$(dirname "$0")"
debut=$(date +%s)
vu_java=0
while true; do
  t=$(( $(date +%s) - debut ))
  etat=$(powershell -NoProfile -ExecutionPolicy Bypass -File "$OUT/mon_jeu.ps1" trouver 2>/dev/null | tr -d '\r')
  if [ "$etat" != "AUCUN" ] && [ -n "$etat" ]; then vu_java=1; fi
  if [ -f "$LOG" ] && grep -q -E "Crash Report|Game crashed|Crash report saved|Failed to start the minecraft server|Mod loading has failed" "$LOG"; then
    echo "ECHEC_JEU apres ${t}s : $(grep -m1 -E "Crash Report|Game crashed|Crash report saved|Mod loading has failed" "$LOG")"; exit 1
  fi
  if [ "$vu_java" = 1 ] && [ "$etat" = "AUCUN" ]; then
    echo "JEU_FERME apres ${t}s (sans menu ?) ; fin de la sortie portablemc : $(tail -c 400 "$SORTIE" | tr '\r\n' '  ')"; exit 1
  fi
  if [ "$vu_java" = 0 ] && [ -f "$SORTIE" ] && grep -q -E "FAILED|\[ ERROR|error_" "$SORTIE"; then
    echo "ECHEC_PORTABLEMC apres ${t}s : $(tr '\r' '\n' < "$SORTIE" | grep -m3 -E "FAILED|ERROR|error_" | tr '\n' ' ')"; exit 1
  fi
  if [ -f "$LOG" ] && grep -q "Sound engine started" "$LOG"; then
    echo "MENU_PRET apres ${t}s : $etat"; exit 0
  fi
  if [ "$t" -ge "$MAX" ]; then echo "DELAI_DEPASSE ${MAX}s : $etat"; exit 2; fi
  sleep 3
done
