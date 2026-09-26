#!/usr/bin/env bash
# Étape 6 : suit le journal du jeu du test et ne montre que les lignes utiles (connexion, chat du serveur, refus,
# déconnexion, plantage, fermeture). Usage : surveiller_connexion.sh <dossier du jeu>
LOG="$1/logs/latest.log"
tail -n +1 -F "$LOG" 2>/dev/null | grep -E --line-buffered \
  'Sound engine started|Connecting to|\[CHAT\]|isconnect|ismatch|refused|ost connection|Failed to connect|Crash|kicked|Kicked|Stopping!|Timed out'
