# Sur Mac

Il faut **macOS 13 (Ventura) ou plus récent**.

## 1. Choisis le bon fichier

Ouvre le menu Pomme (en haut à gauche), puis **À propos de ce Mac** :

- si tu lis **« Puce Apple M1 »** (ou M2, M3, M4...), prends **Casteria-mac-apple-silicon.zip** ;
- si tu lis **« Processeur Intel »**, prends **Casteria-mac-intel.zip**.

## 2. Installe-le

1. Double-clique sur le fichier .zip téléchargé : **Casteria** apparaît à côté (Safari le fait parfois tout seul).
2. Fais glisser **Casteria** dans le dossier **Applications** (dans le Finder, colonne de gauche).

## 3. La première ouverture

Le launcher n'est pas encore signé par Apple. La première fois, ton Mac le bloque :
c'est normal, et cela n'arrive qu'une fois.

1. Double-clique sur **Casteria** dans Applications. Un message dit qu'Apple n'a pas pu vérifier Casteria.
   Clique sur **Terminé** (surtout pas sur « Placer dans la corbeille »).
2. Ouvre **Réglages Système** (menu Pomme), puis **Confidentialité et sécurité**.
3. Descends jusqu'à la partie **Sécurité** : tu y lis « Casteria a été bloqué pour protéger votre Mac ».
   Clique sur **Ouvrir quand même**, puis tape ton mot de passe (ou pose ton doigt sur Touch ID).
4. Un dernier message s'ouvre : clique sur **Ouvrir quand même**.

Ensuite, Casteria s'ouvre normalement, comme n'importe quelle application.

Sur macOS 14 ou plus ancien, il y a plus simple : **clic droit** (ou Ctrl + clic) sur Casteria, puis **Ouvrir**, puis
encore **Ouvrir**.

## Si ton Mac dit que « Casteria est endommagé »

Ne le mets pas à la corbeille : retélécharge le .zip et recommence à l'étape 2. Si le message revient, dis-le sur le
Discord (avec le modèle de ton Mac et ta version de macOS).

## Et ensuite

Le launcher fait tout le reste : il télécharge le jeu, les mods du serveur et le Java qu'il faut, la première fois
(quelques minutes), puis te fait entrer directement sur le serveur. Tu tapes ton `/login` en jeu. Ton dossier
Minecraft habituel n'est jamais touché : tout est rangé dans `~/Library/Application Support/Casteria`.
