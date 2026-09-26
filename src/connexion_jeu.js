'use strict';
// Le jeu est-il encore connecté au serveur ? (a7, code 1.0.5) La course du 25/09 l'a montré : « Déconnexion » dans le
// menu Échap n'écrit RIEN dans le journal du jeu (la connexion est lâchée sans passer par onDisconnect), et le joueur
// reste sur l'écran « Multijoueur ». Le launcher regarde donc la connexion TCP du processus du jeu vers l'adresse ET le
// port du serveur de Casteria (demande de 5b) : si elle disparaît, le joueur a quitté le serveur, par quelque chemin
// que ce soit.
//   Windows : netstat -ano -p TCP (toujours là) ;
//   Mac     : lsof -nP -a -p <pid> -iTCP -sTCP:ESTABLISHED (livré avec macOS) ;
//   Linux   : /proc/<pid>/net/tcp(6) et /proc/<pid>/fd (sans aucun outil).
// Rend true (connecté), false (plus de connexion) ou null (on ne sait pas : on ne conclut rien).
const fs = require('fs');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');

function executer(cmd, args) {
  return new Promise(ok => execFile(cmd, args, { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
    (e, sortie) => ok(e && !sortie ? null : String(sortie || ''))));
}

// Une adresse IP sous une forme comparable : IPv4 « 1.2.3.4 » (aussi pour « ::ffff:1.2.3.4 »), IPv6 développée.
function normaliserIp(ip) {
  let s = String(ip || '').trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase();
  const m = /^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s) || /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) return m[1];
  if (net.isIPv4(s)) return s;
  if (!net.isIPv6(s)) return s;
  const [avant, apres] = s.split('::');
  const g = x => (x ? x.split(':') : []);
  const a = g(avant);
  const b = apres === undefined ? [] : g(apres);
  const groupes = apres === undefined ? a : a.concat(Array(8 - a.length - b.length).fill('0'), b);
  const texte = groupes.map(x => parseInt(x, 16).toString(16)).join(':');
  // Une IPv4 dans une IPv6 écrite en hexadécimal (0:0:0:0:0:ffff:7f00:1).
  const mh = /^0:0:0:0:0:ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(texte);
  if (mh) {
    const h = parseInt(mh[1], 16), l = parseInt(mh[2], 16);
    return [h >> 8, h & 255, l >> 8, l & 255].join('.');
  }
  return texte;
}

function hote(adressePort) {
  const s = String(adressePort);
  return s.slice(0, s.lastIndexOf(':'));
}

// netstat -ano : « TCP    127.0.0.1:51234    127.0.0.1:25590    ESTABLISHED     24908 » (l'état est traduit selon la
// langue de Windows : on écarte seulement ce qui se ferme).
function lireNetstat(texte, pid, adresses, port) {
  for (const l of String(texte).split(/\r?\n/)) {
    const c = l.trim().split(/\s+/);
    if (c.length < 5 || c[0].toUpperCase() !== 'TCP') continue;
    if (Number(c[c.length - 1]) !== pid) continue;
    const distant = c[2];
    if (Number(distant.slice(distant.lastIndexOf(':') + 1)) !== port) continue;
    if (adresses && !adresses.has(normaliserIp(hote(distant)))) continue;
    if (/TIME_WAIT|CLOSE|FIN_WAIT|LAST_ACK/i.test(c[3])) continue;
    return true;
  }
  return false;
}

// lsof : « java 123 flo 45u IPv4 0x... 0t0 TCP 192.168.1.2:51234->1.2.3.4:25681 (ESTABLISHED) »
function lireLsof(texte, adresses, port) {
  for (const l of String(texte).split(/\r?\n/)) {
    const m = /->(\S+):(\d+)\s+\(ESTABLISHED\)/.exec(l);
    if (!m || Number(m[2]) !== port) continue;
    if (adresses && !adresses.has(normaliserIp(m[1]))) continue;
    return true;
  }
  return false;
}

// /proc/<pid>/net/tcp(6) : adresses en hexadécimal, mots de 32 bits dans l'ordre de la machine (petit-boutiste).
function ipProc(hex) {
  const mot = h => { const n = parseInt(h, 16); return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; };
  if (hex.length === 8) return mot(hex).join('.');
  const octets = [0, 8, 16, 24].flatMap(i => mot(hex.slice(i, i + 8)));
  const groupes = [];
  for (let i = 0; i < 16; i += 2) groupes.push(((octets[i] << 8) | octets[i + 1]).toString(16));
  return normaliserIp(groupes.join(':'));
}
function lireProcTcp(texte, adresses, port, inodes) {
  for (const l of String(texte).split(/\r?\n/)) {
    const c = l.trim().split(/\s+/);
    if (c.length < 10 || !/^[0-9A-Fa-f]+:[0-9A-Fa-f]{4}$/.test(c[2])) continue;
    const [ipHex, portHex] = c[2].split(':');
    if (parseInt(portHex, 16) !== port || c[3] !== '01' || !inodes.has(c[9])) continue;
    if (adresses && !adresses.has(ipProc(ipHex))) continue;
    return true;
  }
  return false;
}

// adresses : les IP du serveur (dns.lookup), ou null pour le port seul (nom introuvable).
async function connecteAuServeur({ pid, adresses, port, plateforme = process.platform, racineProc = '/proc' }) {
  if (!Number.isInteger(pid) || !Number.isInteger(port)) return null;
  const ips = adresses && adresses.length ? new Set(adresses.map(normaliserIp)) : null;
  if (plateforme === 'win32') {
    const t = await executer('netstat', ['-ano', '-p', 'TCP']);
    return t === null ? null : lireNetstat(t, pid, ips, port);
  }
  if (plateforme === 'darwin') {
    const t = await executer('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:ESTABLISHED']);
    return t === null ? null : lireLsof(t, ips, port);
  }
  if (plateforme === 'linux') {
    try {
      const dossierFd = path.join(racineProc, String(pid), 'fd');
      const inodes = new Set();
      for (const n of fs.readdirSync(dossierFd)) {
        try {
          const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(path.join(dossierFd, n)));
          if (m) inodes.add(m[1]);
        } catch (e) { /* un descripteur fermé entre-temps */ }
      }
      let t = '';
      for (const f of ['tcp', 'tcp6']) {
        try { t += fs.readFileSync(path.join(racineProc, String(pid), 'net', f), 'utf8') + '\n'; } catch (e) { /* pas d'IPv6 */ }
      }
      return lireProcTcp(t, ips, port, inodes);
    } catch (e) {
      return null;
    }
  }
  return null;
}

module.exports = { connecteAuServeur, lireNetstat, lireLsof, lireProcTcp, normaliserIp, ipProc };
