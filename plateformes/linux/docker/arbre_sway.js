'use strict';
// Lit « swaymsg -t get_tree -r » sur l'entrée standard et écrit, pour chaque fenêtre « Casteria » : son type
// (xdg_shell = Wayland natif, xwayland = X11 par XWayland), son app_id ou sa classe, flottante ou non, et ses tailles
// (rect : la place donnée par sway ; window_rect : le contenu ; geometry : ce que la fenêtre a demandé).
let s = '';
process.stdin.on('data', d => { s += d; }).on('end', () => {
  let arbre;
  try { arbre = JSON.parse(s); } catch (e) { console.log('arbre illisible : ' + e.message); return; }
  const trouves = [];
  (function parcourir(n, flottant) {
    if (n.name === 'Casteria' || n.app_id === 'casteria' || (n.window_properties && n.window_properties.class === 'casteria')) {
      trouves.push({ n, flottant });
    }
    for (const c of n.nodes || []) parcourir(c, false);
    for (const c of n.floating_nodes || []) parcourir(c, true);
  })(arbre, false);
  if (!trouves.length) { console.log('aucune fenetre Casteria dans sway'); return; }
  const r = x => (x ? x.width + 'x' + x.height + '+' + x.x + '+' + x.y : '?');
  for (const { n, flottant } of trouves) {
    console.log('fenetre « ' + n.name + ' » : ' + (n.shell || '?') + ', app_id ' + (n.app_id || '-') +
      ', classe ' + ((n.window_properties && n.window_properties.class) || '-') + ', ' + (flottant ? 'flottante' : 'en mosaique') +
      ', rect ' + r(n.rect) + ', window_rect ' + r(n.window_rect) + ', geometry ' + r(n.geometry));
  }
});
