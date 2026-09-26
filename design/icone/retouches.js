'use strict';
// Les grilles dessinees a la main pour les toutes petites tailles (tailles.js les prend a la place des reductions).
// Les lettres sont celles de la palette du dessin de reference (maitre_64.json) :
//   b noir (contour des cornes)  i violet noir (cornes)  # brun sombre  c brun (contour de la piece)  d rouge (liseré)
//   e or clair  f or  g or sombre  h or de la face  j violet clair  k l violet  m q r contours violets
//   n o p la gemme  s t les yeux (clair, blanc)  u les crocs  . transparent
module.exports = {
  // 16 x 16 : l'essentiel lisible (l'anneau d'or, les cornes, la tete violette, les deux yeux blancs, la gemme, les crocs)
  g16: [
    '.b............b.',
    '.bb..cccccc..bb.',
    '..bbceeeeeecbb..',
    '..cbbmmppmmbbc..',
    '..cebmlnplmbec..',
    '.cemjlloolljmec.',
    '.cfmstmllmtsmfc.',
    '.cfhmmljjlmmhfc.',
    '.cfhhmljjlmhhfc.',
    '.cfhhmllllmhhfc.',
    '.cfhhmrllrmhhfc.',
    '..cfhmullumhfc..',
    '..cffhmmmmhffc..',
    '...cfeeeeeefc...',
    '.....cccccc.....',
    '................'
  ],
  // 20 x 20 : le meme dessin, un cran plus riche (les joues a pointes, les narines, le menton)
  g20: [
    '..b..............b..',
    '..bb...cccccc...bb..',
    '...bbceeeeeeeecbb...',
    '...cbbehhmmhhebbc...',
    '...cebbmmppmmbbec...',
    '..cehmjllnplljmhfc..',
    '..cemjlljoojlljmfc..',
    '.cehmlstmllmtslmhfc.',
    '.cehmlmmljjlmmlmhfc.',
    '.cfhhmllljjlllmhhfc.',
    '.cfhhhmlljjllmhhhfc.',
    '.cfhhhmllllllmhhhfc.',
    '.cfhhhmlrllrlmhhhfc.',
    '..cfhhmullllumhhfc..',
    '..cffhhmmmmmmhhffc..',
    '...cfehhmllmhhefc...',
    '....cfeehmmheefc....',
    '.....cffeeeeffc.....',
    '.......cccccc.......',
    '....................'
  ]
};
