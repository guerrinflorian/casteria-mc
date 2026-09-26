'use strict';
// Fermer le jeu que le launcher a lancé (a7, code 1.0.5), PROPREMENT d'abord : demande de fermeture de sa fenêtre sous
// Windows (comme la croix : Minecraft s'arrête normalement), SIGTERM sous Mac et Linux. L'arrêt forcé seulement s'il
// tourne encore après le délai (8 s). Seul le processus du jeu (pid donné par PortableMC) est visé, jamais un autre Java.
const { execFile } = require('child_process');

function vivant(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function lancerCommande(cmd, args) {
  return new Promise(ok => execFile(cmd, args, { windowsHide: true, timeout: 10000 }, e => ok(!e)));
}

async function attendreFin(pid, delaiMs) {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    if (!vivant(pid)) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return !vivant(pid);
}

// Rend 'deja' (plus là), 'propre' (fermé à la demande) ou 'force' (arrêté de force), ou 'echec'.
async function fermerJeu(pid, { plateforme = process.platform, delaiMs = 8000, journal } = {}) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return 'echec';
  if (!vivant(pid)) return 'deja';
  if (plateforme === 'win32') {
    // CloseMainWindow : le message de fermeture de la fenêtre principale (WM_CLOSE), pas un arrêt.
    await lancerCommande('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      '$p = Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue; if ($p) { [void]$p.CloseMainWindow() }']);
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch (e) { /* déjà parti */ }
  }
  if (await attendreFin(pid, delaiMs)) { if (journal) journal.info('jeu fermé proprement (pid ' + pid + ')'); return 'propre'; }
  if (journal) journal.avert('le jeu ne se ferme pas : arrêt forcé (pid ' + pid + ')');
  if (plateforme === 'win32') await lancerCommande('taskkill', ['/PID', String(pid), '/T', '/F']);
  else { try { process.kill(pid, 'SIGKILL'); } catch (e) { /* déjà parti */ } }
  return (await attendreFin(pid, 3000)) ? 'force' : 'echec';
}

module.exports = { fermerJeu, vivant };
