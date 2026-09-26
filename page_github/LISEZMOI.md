# La page GitHub du dépôt casteria-mc (serveurmc-ae, 25/09/2026)

Ce dossier prépare ce que a7 publie sur https://github.com/guerrinflorian/casteria-mc :

| Fichier | Où il va |
|---|---|
| `README.md` | la page d'accueil du dépôt (branche `main`, à la racine) |
| `images/` | le dossier `images/` du dépôt (branche `main`) : le README les prend en chemins relatifs |
| `page_installateur.md` | le texte de la release `installateur` ; ses images pointent vers `raw.githubusercontent.com/.../main/images/`, donc on envoie d'abord `images/` sur `main`. L'outil de a7 ajoute les empreintes sha256 à la fin |

Les liens de téléchargement pointent vers les noms fixes de la release `installateur`
(`releases/download/installateur/Casteria-Installation.exe`, etc.) : ils donnent toujours la dernière version.

## Refaire

```
node page_github/fabrication/fabriquer_images.js   # images/ (Edge sans fenêtre, matières du launcher)
node page_github/fabrication/apercu.js             # apercus/ : le rendu des deux pages, en clair et en sombre
```

Les images viennent de nos matières : la prise de vue du palais de cc (`art/prises_de_vue/`), le logo, les boutons et
les polices du thème du launcher, une capture du launcher (`design/photos/launcher_accueil.png`) et une capture d'un
combat de boss (le banc de casinoboss). Aucun fichier de Mojang.
