'use strict';
// La sonde d'entrée (a7, code 1.0.5) : quand le jeu reste muet après « Connecting to » (un refus à l'entrée n'écrit rien
// dans le journal du jeu, voir surveillance.js), le launcher demande au serveur la raison exacte, comme le fait le jeu :
// poignée de main (état « login »), puis « Login Start » avec le pseudo. Le serveur répond :
//   Disconnect (0x00)        refusé : un composant texte JSON (« translate »: « multiplayer.disconnect.not_whitelisted »...) ;
//   Set Compression (0x03),  accepté : la sonde raccroche aussitôt (elle ne va jamais plus loin que l'entrée) ;
//   Login Success (0x02)...
// Elle ne sert QUE quand le vrai jeu vient d'être refusé : le serveur la refuse alors pour la même raison, sans
// effet. Protocole 767 (Minecraft 1.21.1).
const net = require('net');
const crypto = require('crypto');
const { varint, paquet, lireVarint, PROTOCOLE_1_21_1 } = require('./etat_serveur');

const DELAI_MS = 5000;

function chaine(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); }

// L'UUID « hors ligne » que le serveur donne à un pseudo : md5("OfflinePlayer:" + pseudo), version 3.
function uuidHorsLigne(pseudo) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + pseudo, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  return h;
}

// Un composant texte du jeu : sa première clé de traduction, et un texte à plat (les clés restent telles quelles).
function lireComposant(json) {
  let c;
  try { c = JSON.parse(json); } catch (e) { return { cle: null, texte: String(json).slice(0, 300) }; }
  let cle = null;
  const morceaux = [];
  (function parcourir(n) {
    if (n == null) return;
    if (typeof n === 'string') { morceaux.push(n); return; }
    if (Array.isArray(n)) { n.forEach(parcourir); return; }
    if (typeof n !== 'object') return;
    if (typeof n.translate === 'string') {
      if (!cle) cle = n.translate;
      morceaux.push(n.translate);
      if (Array.isArray(n.with)) n.with.forEach(w => { morceaux.push(' '); parcourir(w); });
    }
    if (typeof n.text === 'string') morceaux.push(n.text);
    if (Array.isArray(n.extra)) n.extra.forEach(parcourir);
  })(c);
  return { cle, texte: morceaux.join('').slice(0, 300) };
}

function sonderConnexion({ adresse, port, pseudo, delaiMs = DELAI_MS }) {
  return new Promise(ok => {
    let recu = Buffer.alloc(0);
    let fini = false;
    const s = net.connect({ host: adresse, port });
    const fin = r => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      s.destroy();
      ok(r);
    };
    const minuteur = setTimeout(() => fin({ etat: 'erreur', raison: 'délai dépassé' }), delaiMs);
    s.on('connect', () => {
      const poignee = Buffer.concat([varint(PROTOCOLE_1_21_1), chaine(adresse), Buffer.from([port >> 8, port & 0xff]), varint(2)]);
      s.write(Buffer.concat([paquet(0x00, poignee), paquet(0x00, Buffer.concat([chaine(pseudo), uuidHorsLigne(pseudo)]))]));
    });
    s.on('data', d => {
      recu = Buffer.concat([recu, d]);
      if (recu.length > 65536) { fin({ etat: 'erreur', raison: 'réponse trop grosse' }); return; }
      try {
        const l = lireVarint(recu, 0);
        if (!l || recu.length < l.fin + l.valeur) return;
        const corps = recu.subarray(l.fin, l.fin + l.valeur);
        const id = lireVarint(corps, 0);
        if (id.valeur === 0x00) {
          const t = lireVarint(corps, id.fin);
          const { cle, texte } = lireComposant(corps.subarray(t.fin, t.fin + t.valeur).toString('utf8'));
          fin({ etat: 'refuse', cle, texte });
        } else {
          // Compression, succès, chiffrement ou requête d'un mod : le serveur a laissé entrer ce pseudo.
          fin({ etat: 'accepte', paquet: id.valeur });
        }
      } catch (e) {
        fin({ etat: 'erreur', raison: 'réponse illisible' });
      }
    });
    s.on('error', e => fin({ etat: 'erreur', raison: e.code || e.message }));
    s.on('close', () => fin({ etat: 'erreur', raison: 'connexion fermée sans réponse' }));
  });
}

module.exports = { sonderConnexion, uuidHorsLigne, lireComposant };
