'use strict';
// Essai de bout en bout de la mise à jour du CODE du launcher, dans la vraie fenêtre Electron, sans Java :
// une copie du launcher en 1.0.0 (son amorce réglée sur une CLÉ D'ESSAI : la clé de Florian ne signe jamais d'essai)
// trouve une 1.0.1 sur un hébergement local, la télécharge, affiche « prête » ; au clic sur Redémarrer, l'amorce
// revérifie et démarre la 1.0.1. Photos et journal de l'amorce à la fin.
// Usage : node outils/essai/maj_launcher_e2e.js   (dossier d'essai : essais/<horodatage>-e2e/)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execFileSync, execFile } = require('child_process');

const PROJET = path.join(__dirname, '..', '..');
const H = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const ICI = path.join(PROJET, 'essais', H + '-e2e');
const PORT_CDP = 9334;
const PHOTOS = process.argv[2] || 'C:/Users/guerr/test-launcher/captures/fenetre';
// Asynchrone : l'hébergement local tourne dans CE processus, il doit pouvoir répondre pendant qu'on attend la fenêtre.
const pilote = (...a) => new Promise(ok => {
  execFile(process.execPath, [path.join(__dirname, 'piloter_fenetre.js'), String(PORT_CDP), ...a], { encoding: 'utf8' },
    (e, sortie) => ok(String(sortie || '').trim() || (e ? 'ERREUR ' + e.message : '')));
});
const pause = ms => new Promise(r => setTimeout(r, ms));

function copier(de, vers) {
  fs.mkdirSync(vers, { recursive: true });
  for (const n of fs.readdirSync(de, { withFileTypes: true })) {
    if (n.isDirectory()) copier(path.join(de, n.name), path.join(vers, n.name));
    else fs.copyFileSync(path.join(de, n.name), path.join(vers, n.name));
  }
}
function copieDuLauncher(dossier, version, clePub) {
  for (const d of ['amorce', 'electron', 'src']) copier(path.join(PROJET, d), path.join(dossier, d));
  const p = JSON.parse(fs.readFileSync(path.join(PROJET, 'package.json'), 'utf8'));
  p.version = version;
  fs.writeFileSync(path.join(dossier, 'package.json'), JSON.stringify(p, null, 2));
  // La clé de l'amorce remplacée par la clé d'essai (la seule différence avec le vrai launcher).
  const cle = clePub.split('\n').filter(l => l && !l.startsWith('-----'))[0];
  const f = path.join(dossier, 'amorce', 'amorce.js');
  const avant = fs.readFileSync(f, 'utf8');
  const apres = avant.replace('MCowBQYDK2VwAyEAQUp9If6rZVWRCcuG/g6rGbXsCpldCzwaeFKwqAAfKgI=', cle);
  if (apres === avant) throw new Error("la clé de l'amorce n'a pas été trouvée");
  fs.writeFileSync(f, apres);
}
async function attendrePage(secondes) {
  const fin = Date.now() + secondes * 1000;
  while (Date.now() < fin) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT_CDP + '/json')).json(); if (l.some(x => x.type === 'page')) return true; } catch (e) { /* pas encore */ }
    await pause(500);
  }
  return false;
}

(async () => {
  fs.mkdirSync(ICI, { recursive: true });
  console.log('Essai dans ' + ICI);
  execFileSync(process.execPath, [path.join(PROJET, 'outils', 'creer_cles.js'), path.join(ICI, 'cles')]);
  const clePub = fs.readFileSync(path.join(ICI, 'cles', 'cle_publique.pem'), 'utf8');
  copieDuLauncher(path.join(ICI, 'app_100'), '1.0.0', clePub);
  copieDuLauncher(path.join(ICI, 'projet_101'), '1.0.1', clePub);
  // La fabrication seulement : l'adresse de l'API est morte exprès (aucun contact avec GitHub), donc l'outil s'arrête
  // en erreur APRÈS avoir écrit la version signée.
  try {
    execFileSync(process.execPath, [path.join(PROJET, 'outils', 'publier_code.js'), '--projet', path.join(ICI, 'projet_101'),
      '--sortie', path.join(ICI, 'hebergement', 'code_101'), '--cle-privee', path.join(ICI, 'cles', 'cle_privee.pem'),
      '--cle-publique', path.join(ICI, 'cles', 'cle_publique.pem'), '--essai', '--api', 'http://127.0.0.1:9', '--jeton', path.join(ICI, 'rien')],
    { stdio: 'ignore' });
  } catch (e) { /* attendu */ }
  if (!fs.existsSync(path.join(ICI, 'hebergement', 'code_101', 'code.json.sig'))) throw new Error("la version 1.0.1 n'a pas été fabriquée");

  const srv = http.createServer((req, res) => {
    const p = path.resolve(path.join(ICI, 'hebergement'), '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    fs.readFile(p, (e, b) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200); res.end(b); } });
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const env = Object.assign({}, process.env, {
    CASTERIA_RACINE: path.join(ICI, 'racine'), CASTERIA_COMMUN: 'C:/Users/guerr/test-launcher/mc', CASTERIA_DRY: '1',
    CASTERIA_CODE: 'http://127.0.0.1:' + srv.address().port + '/code_101/code.json',
  });
  fs.mkdirSync(path.join(ICI, 'racine'), { recursive: true });
  fs.writeFileSync(path.join(ICI, 'racine', 'launcher.json'), JSON.stringify({ pseudo: 'TestFlo', memoire_go: null, manifeste: null }));
  const electron = path.join(PROJET, 'node_modules', 'electron', 'dist', 'electron.exe');
  spawn(electron, [path.join(ICI, 'app_100'), '--remote-debugging-port=' + PORT_CDP], { env, detached: true, stdio: 'ignore' }).unref();

  const res = [];
  const ok = (nom, v, d) => { res.push((v ? 'OK     ' : 'ÉCHEC  ') + nom + (v ? '' : ' : ' + d)); };
  ok('la fenêtre 1.0.0 s\'ouvre', await attendrePage(30));
  // La version s'écrit quand la fenêtre a reçu l'état : on l'attend, comme après le redémarrage.
  const v0 = await pilote('attendre', "/1\\.0\\.0/.test((document.getElementById('version')||{}).textContent||'')", '30');
  ok('version affichée 1.0.0', v0 === 'OK', v0);
  const pret = await pilote('attendre', "document.body.dataset.majLauncher==='pret'", '40');
  ok('la 1.0.1 est téléchargée, vérifiée : bande « prête »', pret === 'OK', pret);
  await pause(800);
  await pilote('photo', PHOTOS + '/e2e_maj_prete.png');
  ok('texte de la bande', /nouvelle version du launcher est prête/.test(await pilote('eval', "(document.getElementById('maj-launcher-texte')||{}).textContent")));
  try { await pilote('eval', "document.querySelector('[data-action=redemarrer]').click(),1"); } catch (e) { /* la page part avec le redémarrage */ }
  await pause(4000);
  ok('le launcher redémarre', await attendrePage(30));
  const v = await pilote('attendre', "/1\\.0\\.1/.test((document.getElementById('version')||{}).textContent||'')", '30');
  ok('après le redémarrage : « Launcher 1.0.1 »', v === 'OK', v);
  await pause(800);
  await pilote('photo', PHOTOS + '/e2e_apres_redemarrage.png');
  await pause(1500);
  const journal = fs.readFileSync(path.join(ICI, 'racine', 'journaux', 'amorce.log'), 'utf8');
  ok("l'amorce a revérifié et démarré 1.0.1, puis l'a confirmée", /code 1\.0\.1 vérifié : il démarre/.test(journal) && /code 1\.0\.1 confirmé/.test(journal), journal);
  try { await pilote('eval', "document.querySelector('[data-action=fermer]').click(),1"); } catch (e) { /* fermé */ }
  srv.close();
  console.log(res.join('\n'));
  console.log('\nJournal de l\'amorce :\n' + journal);
  process.exitCode = res.some(l => l.startsWith('ÉCHEC')) ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
