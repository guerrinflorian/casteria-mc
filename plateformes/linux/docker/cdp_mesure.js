'use strict';
// Ce que la page du launcher voit d'elle-même (serveurmc-14, 25/09/2026), par le port de débogage de Chromium : le
// facteur d'échelle (devicePixelRatio), la taille de la fenêtre en pixels CSS, et le zoom appliqué par le launcher.
// Node 20 : node --experimental-websocket cdp_mesure.js 9222
const port = process.argv[2] || '9222';
// « texte » : le texte visible de la page (pour lire « Launcher 1.0.x » et la bande de mise à jour).
const TEXTE = `(document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 700)`;
const EXPRESSION = process.argv[3] === 'texte' ? TEXTE : `JSON.stringify({
  facteur: window.devicePixelRatio,
  largeur: window.innerWidth, hauteur: window.innerHeight,
  ecran: screen.width + 'x' + screen.height,
  zoomRacine: getComputedStyle(document.documentElement).zoom,
  zoomCorps: document.body ? getComputedStyle(document.body).zoom : null,
  transformScene: (document.querySelector('[data-scene], .scene, #scene') || {}).style ? getComputedStyle(document.querySelector('[data-scene], .scene, #scene')).transform : null
})`;

async function principal() {
  const liste = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const page = liste.find(p => p.type === 'page');
  if (!page) { console.log('aucune page'); process.exit(1); }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: EXPRESSION, returnByValue: true } }));
  ws.onmessage = e => {
    const r = JSON.parse(String(e.data));
    console.log('page : ' + ((r.result && r.result.result && r.result.result.value) || JSON.stringify(r).slice(0, 200)));
    process.exit(0);
  };
  ws.onerror = () => { console.log('liaison en erreur'); process.exit(1); };
  setTimeout(() => { console.log('pas de reponse'); process.exit(1); }, 8000);
}
principal().catch(e => { console.log('mesure impossible : ' + e.message); process.exit(1); });
