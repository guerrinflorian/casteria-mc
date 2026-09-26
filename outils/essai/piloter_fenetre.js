'use strict';
// Pilote la fenêtre Electron du launcher pendant les essais, par le port de débogage de Chromium (127.0.0.1 seulement,
// lancé avec --remote-debugging-port) : exécuter du JavaScript dans la page, la photographier. Ne touche ni la souris
// ni le clavier de Florian.
// Usage : node piloter_fenetre.js <port> eval "<js>"   |   node piloter_fenetre.js <port> photo <fichier.png>
//         node piloter_fenetre.js <port> attendre "<js qui rend vrai>" <secondes>
const fs = require('fs');

const [port, action, arg, arg2] = process.argv.slice(2);

async function page() {
  const liste = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const p = liste.find(x => x.type === 'page');
  if (!p) throw new Error('aucune page');
  return p.webSocketDebuggerUrl;
}

function client(url) {
  return new Promise((ok, ko) => {
    const ws = new WebSocket(url);
    let id = 0;
    const attentes = new Map();
    ws.onmessage = m => {
      const d = JSON.parse(m.data);
      if (d.id && attentes.has(d.id)) { attentes.get(d.id)(d); attentes.delete(d.id); }
    };
    ws.onerror = e => ko(new Error('websocket : ' + (e.message || 'erreur')));
    ws.onopen = () => ok({
      envoyer: (method, params) => new Promise(r => { const k = ++id; attentes.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); }),
      fermer: () => ws.close(),
    });
  });
}

async function evaluer(c, js) {
  const r = await c.envoyer('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result && r.result.result ? r.result.result.value : undefined;
}

(async () => {
  const c = await client(await page());
  try {
    if (action === 'eval') console.log(JSON.stringify(await evaluer(c, arg)));
    else if (action === 'photo') {
      const r = await c.envoyer('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
      console.log('photo ' + arg);
    } else if (action === 'attendre') {
      const fin = Date.now() + Number(arg2 || 60) * 1000;
      for (;;) {
        if (await evaluer(c, arg)) { console.log('OK'); break; }
        if (Date.now() > fin) { console.log('DELAI_DEPASSE'); process.exitCode = 2; break; }
        await new Promise(r => setTimeout(r, 300));
      }
    } else throw new Error('action inconnue : ' + action);
  } finally { c.fermer(); }
})().catch(e => { console.error('ERREUR ' + e.message); process.exitCode = 1; });
