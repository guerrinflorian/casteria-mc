'use strict';
// Le client GitHub des outils de publication (a7) : une release à étiquette fixe, ses fichiers, envoyer, effacer.
// Le jeton (limité au dépôt de Florian) vient de GITHUB_TOKEN ou d'un fichier ; il n'est jamais affiché.
const fs = require('fs');
const R = require('../src/reglages');

const PAR_DEFAUT = {
  depot: 'guerrinflorian/casteria-mc', jeton: 'C:/Users/guerr/Casteria_cles/github_token.txt',
  api: 'https://api.github.com', envois: 'https://uploads.github.com', telechargements: 'https://github.com',
};

function lireJeton(fichier) {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return fs.existsSync(fichier) ? fs.readFileSync(fichier, 'utf8').trim() : null;
}

// o : { depot, etiquette, api, envois } ; titre et texte : ceux de la release si elle doit être créée.
function creerClient(o, jeton, titre, texte) {
  const entetes = { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': R.AGENT };
  if (jeton) entetes.Authorization = 'Bearer ' + jeton;
  async function appel(methode, url, corps, type) {
    const h = Object.assign({}, entetes);
    if (corps !== undefined) h['Content-Type'] = type || 'application/json';
    const r = await fetch(url, {
      method: methode, headers: h, signal: AbortSignal.timeout(600000),
      body: corps === undefined ? undefined : (type ? corps : JSON.stringify(corps)),
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(methode + ' ' + url.replace(/\?.*$/, '') + ' : HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r.status === 204 ? {} : r.json();
  }
  const base = o.api + '/repos/' + o.depot;
  return {
    release: () => appel('GET', base + '/releases/tags/' + encodeURIComponent(o.etiquette)),
    creerRelease: () => appel('POST', base + '/releases', {
      tag_name: o.etiquette, name: titre, draft: false, prerelease: false, make_latest: 'false', body: texte,
    }),
    async fichiers(idRelease) {
      const tous = [];
      for (let page = 1; ; page++) {
        const lot = await appel('GET', base + '/releases/' + idRelease + '/assets?per_page=100&page=' + page);
        tous.push(...(lot || []));
        if (!lot || lot.length < 100) return tous;
      }
    },
    envoyer: (idRelease, nom, octets) => appel('POST', o.envois + '/repos/' + o.depot + '/releases/' + idRelease +
      '/assets?name=' + encodeURIComponent(nom), octets, 'application/octet-stream'),
    effacer: idFichier => appel('DELETE', base + '/releases/assets/' + idFichier),
    // Le texte de la page de la release (seulement le texte : le titre et l'étiquette ne changent pas).
    modifierTexte: (idRelease, corps) => appel('PATCH', base + '/releases/' + idRelease, { body: corps }),
    // Le titre, le texte, et « Latest » (make_latest : 'true' ou 'false') d'une release.
    modifierRelease: (idRelease, champs) => appel('PATCH', base + '/releases/' + idRelease, champs),
  };
}

// Ce que voient les visiteurs du dépôt (demande de Florian, 25/09 : tout ce qui est public parle aux joueurs, sans nom
// d'outil ni de personne). Les releases « joueurs » et « launcher » ne sont pas pour eux : un titre simple, un texte qui
// les renvoie vers l'installateur, et jamais « Latest » (c'est « installateur » qui l'est).
const PAGE_INSTALLATEUR = 'https://github.com/guerrinflorian/casteria-mc/releases/tag/installateur';
// (texte relu par 00 : « rien à télécharger ici »)
const TEXTE_POUR_JOUEURS = "Ces fichiers sont téléchargés tout seuls par le launcher de Casteria : tu n'as rien à télécharger ici. " +
  'Pour jouer, va sur [Installer le launcher de Casteria](' + PAGE_INSTALLATEUR + ').';
const RELEASES_PUBLIQUES = {
  joueurs: { name: 'Fichiers du jeu (le launcher s’en occupe)', body: TEXTE_POUR_JOUEURS, make_latest: 'false' },
  launcher: { name: 'Mises à jour du launcher (automatiques)', body: TEXTE_POUR_JOUEURS, make_latest: 'false' },
};

// Remet le titre et le texte publics d'une release s'ils ont changé (et jamais « Latest »). Rend ce qui a été fait.
async function textesPublics(gh, release, etiquette) {
  const voulu = RELEASES_PUBLIQUES[etiquette];
  if (!voulu || !release) return 'rien à faire';
  if (release.name === voulu.name && String(release.body || '').replace(/\r\n/g, '\n') === voulu.body) return 'titre et texte déjà bons';
  await gh.modifierRelease(release.id, voulu);
  return 'titre et texte remis : « ' + voulu.name + ' »';
}

// Le fichier signé unique : le contenu exact et sa signature ensemble (voir src/manifeste.js, lireEnveloppe).
function enveloppe(octets, signature) {
  return Buffer.from(JSON.stringify({ format: 1, contenu: octets.toString('utf8'), signature: String(signature).trim() }) + '\n');
}

// Relire l'adresse publique jusqu'à ce qu'elle donne ce qu'on a envoyé : GitHub met 20 à 30 s à propager un
// remplacement (constaté le 25/09), et plus de 90 s pour le code 1.0.3. Une lecture toutes les 5 s.
async function relire(url, bon, secondes = 180) {
  const fin = Date.now() + secondes * 1000;
  for (;;) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': R.AGENT, 'Cache-Control': 'no-cache' } });
      if (r.ok && bon(Buffer.from(await r.arrayBuffer()))) return true;
    } catch (e) { /* on réessaie */ }
    if (Date.now() > fin) return false;
    await new Promise(ok => setTimeout(ok, 5000));
  }
}

module.exports = {
  PAR_DEFAUT, lireJeton, creerClient, enveloppe, relire, RELEASES_PUBLIQUES, TEXTE_POUR_JOUEURS, PAGE_INSTALLATEUR, textesPublics,
};
