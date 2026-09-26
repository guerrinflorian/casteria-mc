# L'icône du launcher, nette à chaque taille (serveurmc-ae, 25/09/2026)

La tête du Dragon Ancien sur sa pièce d'or (le pixel art de Florian), en PNG transparents, un par taille demandée par
Windows : `final/icone_N.png` pour N = 16, 20, 24, 32, 40, 48, 60, 64, 72, 80, 96, 128, 256. a7 en fait le `.ico`.

## Pourquoi c'est net

- L'ancienne `icone_32.png` était une réduction lissée de l'original (445 couleurs) : agrandie, elle restait floue.
- L'original (`source.jpg`, 2048 x 2048) est un vrai pixel art : des cases de 32 px, donc une grille de 64 x 64
  (`grille.js` le vérifie). `extraire.js` en tire la grille propre : `maitre_64.json` et `maitre_64.png`, 21 couleurs,
  un dessin de 52 x 54 cases. Le fond n'est transparent que là où il touche le bord : le contour sombre et l'intérieur
  des cornes restent opaques.
- Chaque taille est une grille entière, agrandie d'un facteur entier : jamais de pixels de largeurs différentes, jamais
  de lissage (seulement de l'opaque ou du transparent).

| Image | Grille | Facteur |
|---|---|---|
| 256, 128 | 52 x 54 (le dessin de Florian, case pour case) | x4, x2 |
| 64, 60 | 52 x 54 | x1 |
| 96, 48 | 40 x 42 (réduction) | x2, x1 |
| 80, 40 | 34 x 35 | x2, x1 |
| 72 | 30 x 31 | x2 |
| 32 | 26 x 27 | x1 |
| 24, 20 | 20 x 20, dessinée à la main (`retouches.js`) | x1 |
| 16 | 16 x 16, dessinée à la main | x1 |

Les réductions sont faites par un vote : chaque case prend la couleur qui couvre le plus sa surface, avec un poids plus
fort pour ce qui doit survivre (les yeux, la gemme, les crocs, les contours). Le 60 (le Bureau de Windows à 125 %) est le
dessin de Florian, case pour case.

## Refaire

```
node design/icone/grille.js        # la grille de la source (cases de 32 px)
node design/icone/extraire.js      # maitre_64.json et maitre_64.png
node design/icone/tailles.js       # final/icone_N.png et final/planche_controle.png
```

`source.png` est `source.jpg` converti par Edge (Node ne lit pas le JPG) : ouvrir `source.html` dans Edge sans fenêtre,
à 2048 x 2048, avec `--screenshot`. Pour retoucher une petite taille : modifier sa grille dans `retouches.js` (les
lettres de la palette y sont expliquées), puis relancer `tailles.js`.
