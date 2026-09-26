'use strict';
// L'état du serveur en direct, par le « Server List Ping » du protocole Minecraft (ce que fait la liste des serveurs
// du jeu) : poignée de main, demande d'état, réponse JSON (joueurs, description, version), puis ping pour la latence.
// Jamais bloquant : un délai court, et un résultat clair dans tous les cas :
//   en-ligne     le serveur a répondu ;
//   hors-ligne   internet marche (le nom se résout) mais le serveur ne répond pas : il est fermé ou démarre ;
//   injoignable  le nom ne se résout pas : pas d'internet (ou le nom du serveur est faux).
const net = require('net');
const dns = require('dns');

const PROTOCOLE_1_21_1 = 767;
const DELAI_MS = 4000;
const TAILLE_MAX = 1024 * 1024;
const COULEURS = {
  0: 'black', 1: 'dark_blue', 2: 'dark_green', 3: 'dark_aqua', 4: 'dark_red', 5: 'dark_purple', 6: 'gold', 7: 'gray',
  8: 'dark_gray', 9: 'blue', a: 'green', b: 'aqua', c: 'red', d: 'light_purple', e: 'yellow', f: 'white',
};
const NOMS_COULEURS = new Set(Object.values(COULEURS));
const MOTIF_PSEUDO = /^[A-Za-z0-9_]{1,16}$/;

function varint(n) {
  const o = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    o.push(b);
  } while (n);
  return Buffer.from(o);
}
function chaine(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); }
function paquet(id, donnees) {
  const corps = Buffer.concat([varint(id), donnees || Buffer.alloc(0)]);
  return Buffer.concat([varint(corps.length), corps]);
}
// Lit un VarInt à la position p ; rend null s'il manque des octets.
function lireVarint(buf, p) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    if (p + i >= buf.length) return null;
    const b = buf[p + i];
    v |= (b & 0x7f) << (7 * i);
    if (!(b & 0x80)) return { valeur: v >>> 0, fin: p + i + 1 };
  }
  throw new Error('VarInt trop long');
}

// La description (« MOTD ») en morceaux { texte, couleur, gras, italique, souligne, barre } : composant JSON du jeu
// (text, color, bold..., extra) ou vieux codes « § ». La couleur est un nom Minecraft ou un #rrggbb, sinon null.
function morceauxDescription(desc) {
  const morceaux = [];
  function ajouter(texte, style) {
    if (!texte) return;
    // Les codes § dans un texte : chacun change la suite du texte.
    let courant = Object.assign({}, style);
    const parties = String(texte).split(/§([0-9a-fk-or])/i);
    for (let i = 0; i < parties.length; i++) {
      if (i % 2 === 1) {
        const c = parties[i].toLowerCase();
        if (COULEURS[c]) courant = Object.assign({}, style, { couleur: COULEURS[c], gras: false, italique: false, souligne: false, barre: false });
        else if (c === 'l') courant.gras = true;
        else if (c === 'o') courant.italique = true;
        else if (c === 'n') courant.souligne = true;
        else if (c === 'm') courant.barre = true;
        else if (c === 'r') courant = Object.assign({}, style);
        continue;
      }
      if (parties[i]) morceaux.push(Object.assign({ texte: parties[i] }, courant));
    }
  }
  function parcourir(noeud, heritage) {
    if (noeud == null) return;
    if (typeof noeud === 'string') { ajouter(noeud, heritage); return; }
    if (Array.isArray(noeud)) { noeud.forEach(n => parcourir(n, heritage)); return; }
    if (typeof noeud !== 'object') return;
    const style = Object.assign({}, heritage);
    if (typeof noeud.color === 'string') {
      style.couleur = NOMS_COULEURS.has(noeud.color) || /^#[0-9a-fA-F]{6}$/.test(noeud.color) ? noeud.color : null;
    }
    if (noeud.bold !== undefined) style.gras = !!noeud.bold;
    if (noeud.italic !== undefined) style.italique = !!noeud.italic;
    if (noeud.underlined !== undefined) style.souligne = !!noeud.underlined;
    if (noeud.strikethrough !== undefined) style.barre = !!noeud.strikethrough;
    ajouter(typeof noeud.text === 'string' ? noeud.text : '', style);
    if (Array.isArray(noeud.extra)) noeud.extra.forEach(n => parcourir(n, style));
  }
  parcourir(desc, { couleur: null, gras: false, italique: false, souligne: false, barre: false });
  // 300 caractères au plus : la description n'est pas un roman.
  let reste = 300;
  return morceaux.filter(m => { if (reste <= 0) return false; m.texte = m.texte.slice(0, reste); reste -= m.texte.length; return true; });
}

function lireReponse(json) {
  const r = JSON.parse(json);
  const j = r.players || {};
  const noms = (Array.isArray(j.sample) ? j.sample : [])
    .map(x => x && typeof x.name === 'string' ? x.name : '')
    .filter(n => MOTIF_PSEUDO.test(n))
    .slice(0, 12);
  return {
    joueurs: {
      enLigne: Number.isInteger(j.online) ? j.online : null,
      max: Number.isInteger(j.max) ? j.max : null,
      noms,
    },
    motd: morceauxDescription(r.description),
    version: r.version ? { nom: String(r.version.name || '').slice(0, 60), protocole: Number(r.version.protocol) || null } : null,
  };
}

function resoudre(adresse) {
  return new Promise((ok, ko) => {
    const minuteur = setTimeout(() => ko(Object.assign(new Error('délai DNS'), { code: 'ETIMEOUT' })), DELAI_MS);
    dns.lookup(adresse, (e, ip) => { clearTimeout(minuteur); if (e) ko(e); else ok(ip); });
  });
}

function interroger(ip, adresse, port) {
  return new Promise((ok, ko) => {
    const debut = Date.now();
    let recu = Buffer.alloc(0);
    let etat = null;
    let pingEnvoye = 0;
    const s = net.connect({ host: ip, port });
    let fini = false;
    const fin = (e, v) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      s.destroy();
      if (e) ko(e); else ok(v);
    };
    const minuteur = setTimeout(() => {
      // Pas de réponse au ping : on garde l'état déjà reçu, sans la latence.
      if (etat) fin(null, Object.assign(etat, { latenceMs: null }));
      else fin(Object.assign(new Error('délai dépassé'), { code: 'ETIMEDOUT' }));
    }, DELAI_MS);
    s.on('connect', () => {
      const poignee = Buffer.concat([varint(PROTOCOLE_1_21_1), chaine(adresse), Buffer.from([port >> 8, port & 0xff]), varint(1)]);
      s.write(Buffer.concat([paquet(0x00, poignee), paquet(0x00)]));
    });
    s.on('data', d => {
      recu = Buffer.concat([recu, d]);
      if (recu.length > TAILLE_MAX) { fin(Object.assign(new Error('réponse trop grosse'), { code: 'EPROTO' })); return; }
      try {
        for (;;) {
          const l = lireVarint(recu, 0);
          if (!l || recu.length < l.fin + l.valeur) return;
          const corps = recu.subarray(l.fin, l.fin + l.valeur);
          recu = recu.subarray(l.fin + l.valeur);
          const id = lireVarint(corps, 0);
          if (id.valeur === 0x00 && !etat) {
            const t = lireVarint(corps, id.fin);
            etat = lireReponse(corps.subarray(t.fin, t.fin + t.valeur).toString('utf8'));
            etat.reponseMs = Date.now() - debut;
            const charge = Buffer.alloc(8);
            charge.writeBigInt64BE(BigInt(Date.now()));
            pingEnvoye = Date.now();
            s.write(paquet(0x01, charge));
          } else if (id.valeur === 0x01 && etat) {
            fin(null, Object.assign(etat, { latenceMs: Date.now() - pingEnvoye }));
            return;
          }
        }
      } catch (e) {
        fin(Object.assign(new Error('réponse illisible : ' + e.message), { code: 'EPROTO' }));
      }
    });
    s.on('error', e => fin(e));
    s.on('close', () => {
      if (etat) fin(null, Object.assign(etat, { latenceMs: etat.latenceMs === undefined ? null : etat.latenceMs }));
      else fin(Object.assign(new Error('connexion fermée sans réponse'), { code: 'ECONNRESET' }));
    });
  });
}

async function etatServeur({ adresse, port }) {
  const verifieA = new Date().toISOString();
  let ip;
  try { ip = await resoudre(adresse); } catch (e) {
    return { etat: 'injoignable', raison: e.code || e.message, verifieA };
  }
  try {
    const r = await interroger(ip, adresse, port);
    return Object.assign({ etat: 'en-ligne', verifieA }, r);
  } catch (e) {
    return { etat: 'hors-ligne', raison: e.code || e.message, verifieA };
  }
}

module.exports = { etatServeur, morceauxDescription, lireReponse, varint, paquet, lireVarint, PROTOCOLE_1_21_1 };
