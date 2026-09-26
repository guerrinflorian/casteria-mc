'use strict';
// Ce que voient les visiteurs du dépôt (a7, demande de Florian du 25/09 : tout ce qui est public parle aux joueurs) :
//   « joueurs » et « launcher » : le titre et le texte de github.js (RELEASES_PUBLIQUES), jamais « Latest » ;
//   « installateur » : « Latest » (c'est elle que la colonne du dépôt montre aux visiteurs).
// Rien dans le launcher ne lit /releases/latest (vérifié le 25/09) : il ne lit que les étiquettes fixes.
// Usage : node outils/releases_publiques.js [--essai]
const G = require('./github');

async function principal() {
  const essai = process.argv.includes('--essai');
  const jeton = G.lireJeton(G.PAR_DEFAUT.jeton);
  if (!jeton) throw new Error('pas de jeton GitHub : rien changé');
  const client = etiquette => G.creerClient(Object.assign({ etiquette }, G.PAR_DEFAUT), jeton);
  const h = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'casteria', 'Authorization': 'Bearer ' + jeton };
  const latest = async () => ((await (await fetch(G.PAR_DEFAUT.api + '/repos/' + G.PAR_DEFAUT.depot + '/releases/latest', { headers: h })).json()) || {}).tag_name;
  console.log('« Latest » aujourd’hui : ' + await latest());
  for (const etiquette of ['joueurs', 'launcher']) {
    const gh = client(etiquette);
    const r = await gh.release();
    const voulu = G.RELEASES_PUBLIQUES[etiquette];
    console.log('\n' + etiquette + ' : « ' + r.name + ' »\n  texte actuel : ' + String(r.body).replace(/\s+/g, ' ').slice(0, 160) +
      '\n  voulu : « ' + voulu.name + ' »\n  ' + voulu.body);
    if (!essai) console.log('  -> ' + await G.textesPublics(gh, r, etiquette));
  }
  const inst = await client('installateur').release();
  if (!essai) await client('installateur').modifierRelease(inst.id, { make_latest: 'true' });
  const apres = essai ? '(essai : rien changé)' : await latest();
  console.log('\n« Latest » ' + (essai ? 'voulue : installateur ' + apres : 'maintenant : ' + apres));
  return essai || apres === 'installateur' ? 0 : 1;
}

principal().then(c => { process.exitCode = c; }, e => { console.error('REFUSÉ : ' + e.message); process.exitCode = 1; });
