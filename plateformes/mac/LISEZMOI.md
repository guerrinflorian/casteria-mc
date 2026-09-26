# Le paquet Mac du launcher (fabriqué sous Windows)

Écrit par serveurmc-2e le 25/09/2026, à la demande de 5b et de Florian (« sans tester, fais au mieux ») : personne n'a
de Mac. Tout se vérifie donc par des outils. Le projet est à a7 : ce dossier-ci est le seul que 2e écrit.

## Pourquoi pas electron-builder

electron-builder 26 refuse de fabriquer pour macOS sous Windows (`packager.js` : « Build for macOS is supported only on
macOS »). Surtout, le .app d'Electron contient 14 liens symboliques (`Versions/Current -> A`...) que Windows ne sait pas
poser sans le mode développeur. Or un .app sans ses liens a un sceau faux, et un Mac le dit « endommagé ». Les
liens ne touchent donc jamais le disque de Windows : les archives se lisent et s'écrivent en mémoire (`archives.js`).

## Les 3 étapes

```
node plateformes/mac/fabriquer_mac.js --arch tous
docker run --rm -v "<CasteriaLauncher>\plateformes\mac:/travail" alpine:3.20 sh /travail/signer.sh
node plateformes/mac/verifier_mac.js --arch tous
```

1. **`fabriquer_mac.js`** (Windows) : part du zip officiel d'Electron pour darwin (téléchargé dans `cache/`, vérifié par
   `node_modules/electron/checksums.json`), et fait ce que ferait electron-builder :
   - `Electron.app` devient `Casteria.app`, et `Contents/MacOS/Casteria` l'exécutable ;
   - les 4 Helpers sont renommés « Casteria Helper*.app » (la doc d'Electron l'exige quand l'exécutable change de nom) ;
   - les Info.plist reçoivent `fr.casteria.launcher`, la version de `package.json` et la catégorie Jeux ;
   - `app.asar` est fait avec les `files` du champ `build`, et un `package.json` nettoyé comme electron-builder le fait ;
     `ElectronAsarIntegrity` est recalculé ;
   - l'icône `casteria.icns` vient de l'icône finale d'ae, dessinée case par case (`design/icone/final` : 16, 32,
     64, 128 et 256 tels quels ; 512 et 1024 sont le 256 agrandi x2 et x4 sans lissage, par `icns.js`) ;
   - `Contents/Resources/bin/` reçoit le `portablemc` du bon processeur, vérifié contre `bin/empreintes.json` (la chaîne
     PGP de a7), la licence, et un `empreintes.json` propre au paquet.
   Sortie : `sortie/Casteria-<version>-mac-<arch>-a-signer.tar.gz`, qui garde les liens et les droits, et `.attendu.json`.
2. **`signer.sh`** (conteneur Linux, Docker) : signature **ad hoc** par rcodesign 0.29.0, dont le sha256 est vérifié.
   Sur Apple Silicon, un programme sans aucune signature ne démarre pas du tout. La signature ad hoc (des empreintes,
   sans identité) suffit pour démarrer, et Gatekeeper demande alors seulement « Ouvrir quand même ». Il n'y a pas de
   notarisation (compte Apple à 99 dollars par an).
   rcodesign re-signe TOUT Mach-O d'un bundle, `portablemc` compris : son sha256 change. Le script signe une fois,
   écrit le sha256 du `portablemc` livré dans le `empreintes.json` du paquet (la voie A choisie par a7 : son launcher lit
   `darwin-<arch>/portablemc`, champ `sha256`), puis signe une seconde fois pour sceller ce fichier.
3. **`verifier_mac.js`** (Windows) : la commande `verify` de rcodesign n'est pas fiable (lui-même le dit). Les contrôles
   sont donc refaits à la main :
   - chaque Mach-O : la signature ad hoc relue, chaque page de code re-hachée ; l'outil a d'abord été vérifié sur les 13
     binaires officiels d'Electron (49 140 pages pour le framework) ;
   - chaque bundle (l'app, 4 Helpers, 4 frameworks) : Info.plist et CodeResources liés à l'exécutable, chaque fichier
     scellé re-haché, chaque code imbriqué retrouvé par son cdhash, aucun fichier non scellé ;
   - `portablemc` : la preuve que seule la signature diffère de l'officiel (chaque segment identique octet pour octet) ;
   - rien d'autre n'a changé depuis l'assemblage (liens, dossiers, droits) ;
   - puis il écrit le zip final (liens et droits Unix dans les attributs, que l'Utilitaire d'archive de macOS
     respecte), le relit entrée par entrée, et donne son sha256.
   Sortie : `sortie/Casteria-<version>-mac-<arch>.zip`, `.zip.sha256` et `.rapport.json`.

## Ce qui reste impossible sans Mac

- **Lancer** l'application pour de vrai. Un essai sur une machine Mac de GitHub Actions (gratuite pour un dépôt public)
  le ferait. C'est la prochaine étape conseillée, avec l'accord de Florian.
- La notarisation (qui enlèverait l'avertissement de Gatekeeper) demande un compte Apple Developer.
- Un seul paquet universel (arm64 et x64 ensemble) demanderait `lipo` : il y a donc deux paquets.

Le texte pour les joueurs (choisir son paquet, l'avertissement de Gatekeeper) : `JOUEURS_MAC.md`.
