'use strict';
// Appuie sur le bouton « Redémarrer » du launcher sans clic (serveurmc-14, 25/09/2026) : par le port de débogage de
// Chromium (le launcher lancé avec --remote-debugging-port=<port>), la page appelle window.casteria.redemarrer(), comme
// le bouton. Node 20 : lancer avec --experimental-websocket.
//   node --experimental-websocket redemarrer_cdp.js 9222
const port = process.argv[2] || '9222';

async function principal() {
  const liste = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const page = liste.find(p => p.type === 'page');
  if (!page) { console.log('aucune page sur le port ' + port); process.exit(1); }
  console.log('page : ' + page.title + ' (' + page.url.slice(0, 80) + ')');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () => ws.send(JSON.stringify({
    id: 1, method: 'Runtime.evaluate',
    params: { expression: 'window.casteria.redemarrer()', awaitPromise: true, returnByValue: true },
  }));
  ws.onmessage = e => { console.log('reponse : ' + String(e.data).slice(0, 200)); process.exit(0); };
  ws.onclose = () => { console.log('liaison fermee : le launcher s’est arrete pour redemarrer'); process.exit(0); };
  ws.onerror = () => { console.log('liaison en erreur'); process.exit(1); };
  setTimeout(() => { console.log('pas de reponse en 10 s'); process.exit(1); }, 10000);
}

principal().catch(e => { console.log('echec : ' + e.message); process.exit(1); });
