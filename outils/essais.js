'use strict';
// Les essais du prototype, SANS lancer Java (un seul Minecraft à la fois sur le PC : les créneaux sont donnés par la
// tête pensante). Tout se passe dans essais/<horodatage>/ (dans le projet) : rien n'est effacé, chaque passage a son dossier.
//
// Usage : node outils/essais.js [--paquet <dossier du paquet des joueurs>] [--commun <dossier déjà installé>]
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

const LAUNCHER = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (nom, defaut) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : defaut; };
const PAQUET = opt('--paquet', 'C:/Users/guerr/Downloads/POUR_LES_JOUEURS_mise_en_ligne_15');
// Un Minecraft + NeoForge déjà installé (1,1 Go, celui du test du 25/09) : le --dry de PortableMC n'y lance pas Java.
const COMMUN = opt('--commun', process.env.CASTERIA_ESSAI_COMMUN || 'C:/Users/guerr/test-launcher/mc');
// Pour simuler une mise en ligne : le casinoui du moment dans ServeurMC/mods (lu seulement, jamais modifié).
const MODS_SERVEURMC = 'C:/Users/guerr/OneDrive/Bureau/DEV/PERSO/ServeurMC/mods';
function casinouiRecent() {
  try {
    const nom = fs.readdirSync(MODS_SERVEURMC).find(n => /^casinoui-neoforge-.*\.jar$/.test(n) && !n.includes('1.4.4+'));
    return nom ? path.join(MODS_SERVEURMC, nom) : null;
  } catch (e) { return null; }
}

const H = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// Chaque passage a son dossier dans le projet (essais/, ignoré par git) : rien n'est effacé.
const ICI = path.join(LAUNCHER, 'essais', H);
fs.mkdirSync(ICI, { recursive: true });

let reussis = 0;
const echecs = [];
function verifier(nom, ok, detail) {
  if (ok) { reussis++; console.log('  OK     ' + nom); } else { echecs.push(nom); console.log('  ÉCHEC  ' + nom + (detail ? ' : ' + detail : '')); }
}

const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function executer(script, liste) {
  return new Promise(ok => {
    const p = spawn(process.execPath, [script].concat(liste), { cwd: LAUNCHER });
    let sortie = '';
    p.stdout.on('data', d => { sortie += d; });
    p.stderr.on('data', d => { sortie += d; });
    p.on('close', code => ok({ code, sortie }));
  });
}
const launcher = liste => executer(path.join(LAUNCHER, 'casteria.js'), liste);

// Un petit hébergement local : sert essais/<horodatage>/ et compte les demandes.
const demandes = [];
const serveur = http.createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  demandes.push(chemin);
  const p = path.resolve(ICI, '.' + chemin);
  if (!p.startsWith(ICI + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(p, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Length': st.size });
    fs.createReadStream(p).pipe(res);
  });
});

// Chaque fichier du manifeste est-il en place, avec une empreinte acceptée ? Rien en trop dans les dossiers gérés ?
function controlerJeu(dossierJeu, manifeste) {
  const fautes = [];
  const connus = new Set();
  for (const f of manifeste.fichiers) {
    connus.add(f.chemin.toLowerCase());
    const local = path.join(dossierJeu, ...f.chemin.split('/'));
    if (!fs.existsSync(local)) { fautes.push('absent ' + f.chemin); continue; }
    const sha = sha256(local);
    if (![f].concat(f.autres || []).some(s => s.sha256 === sha)) fautes.push('différent ' + f.chemin);
  }
  const { listerFichiers } = require('../src/synchro');
  for (const d of manifeste.dossiers_geres) {
    for (const rel of listerFichiers(path.join(dossierJeu, ...d.split('/')))) {
      if (!connus.has((d + '/' + rel).toLowerCase())) fautes.push('en trop ' + d + '/' + rel);
    }
  }
  return fautes;
}

function copierDossier(de, vers) {
  fs.mkdirSync(vers, { recursive: true });
  for (const n of fs.readdirSync(de, { withFileTypes: true })) {
    if (n.isDirectory()) copierDossier(path.join(de, n.name), path.join(vers, n.name));
    else fs.copyFileSync(path.join(de, n.name), path.join(vers, n.name));
  }
}

function signer(octets) {
  const cle = crypto.createPrivateKey(fs.readFileSync(path.join(ICI, 'cles', 'cle_privee.pem'), 'utf8'));
  return crypto.sign(null, octets, cle).toString('base64') + '\n';
}

// Un faux GitHub : juste ce que publier_github.js utilise (release par étiquette, liste, envoi, effacement,
// téléchargement public). Les écritures demandent un jeton, comme le vrai.
function fauxGitHub() {
  const fichiers = new Map();
  let release = null;
  let prochainId = 100;
  const ecritures = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const morceaux = [];
    req.on('data', d => morceaux.push(d));
    req.on('end', () => {
      const corps = Buffer.concat(morceaux);
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      const ecrit = req.method !== 'GET';
      if (ecrit && !/^Bearer .+/.test(req.headers.authorization || '')) return json(401, { message: 'Requires authentication' });
      if (ecrit) ecritures.push(req.method + ' ' + u.pathname + (u.searchParams.get('name') ? ' ' + u.searchParams.get('name') : ''));
      const base = 'http://127.0.0.1:' + srv.address().port;
      const vue = a => ({ id: a.id, name: a.name, size: a.octets.length, browser_download_url: base + '/o/r/releases/download/joueurs/' + a.name });
      let m;
      if (req.method === 'GET' && u.pathname === '/repos/o/r/releases/tags/joueurs') return release ? json(200, release) : json(404, {});
      if (req.method === 'POST' && u.pathname === '/repos/o/r/releases') {
        const c = JSON.parse(corps.toString() || '{}');
        release = { id: 1, tag_name: 'joueurs', name: c.name, body: c.body, make_latest: c.make_latest };
        return json(201, release);
      }
      if (req.method === 'PATCH' && u.pathname === '/repos/o/r/releases/1' && release) {
        Object.assign(release, JSON.parse(corps.toString() || '{}'));
        return json(200, release);
      }
      if (req.method === 'GET' && u.pathname === '/repos/o/r/releases/1/assets') {
        const page = Number(u.searchParams.get('page') || 1);
        return json(200, [...fichiers.values()].slice((page - 1) * 100, page * 100).map(vue));
      }
      if (req.method === 'POST' && u.pathname === '/repos/o/r/releases/1/assets') {
        const nom = u.searchParams.get('name');
        if (fichiers.has(nom)) return json(422, { message: 'already_exists' });
        const a = { id: prochainId++, name: nom, octets: corps };
        fichiers.set(nom, a);
        return json(201, vue(a));
      }
      if (req.method === 'DELETE' && (m = u.pathname.match(/^\/repos\/o\/r\/releases\/assets\/(\d+)$/))) {
        for (const [nom, a] of fichiers) if (a.id === Number(m[1])) fichiers.delete(nom);
        res.writeHead(204); return res.end();
      }
      if (req.method === 'GET' && (m = u.pathname.match(/^\/o\/r\/releases\/download\/joueurs\/(.+)$/))) {
        const a = fichiers.get(decodeURIComponent(m[1]));
        if (!a) return json(404, {});
        res.writeHead(200, { 'Content-Length': a.octets.length }); return res.end(a.octets);
      }
      json(404, {});
    });
  });
  return { srv, fichiers, ecritures, get release() { return release; } };
}

async function essaisPublication(CLE) {
  const gh = fauxGitHub();
  await new Promise(ok => gh.srv.listen(0, '127.0.0.1', ok));
  const GH = 'http://127.0.0.1:' + gh.srv.address().port;
  const publier = (dossier, plus, jeton = 'jeton-essai') => new Promise(ok => {
    const p = spawn(process.execPath, [path.join(LAUNCHER, 'outils', 'publier_github.js'), '--dossier', dossier,
      '--depot', 'o/r', '--api', GH, '--envois', GH, '--telechargements', GH, '--cle-publique', CLE,
      '--jeton', path.join(ICI, 'pas_de_jeton.txt'), '--patience', '10'].concat(plus || []),
    { cwd: LAUNCHER, env: Object.assign({}, process.env, { GITHUB_TOKEN: jeton }) });
    let sortie = '';
    p.stdout.on('data', d => { sortie += d; });
    p.stderr.on('data', d => { sortie += d; });
    p.on('close', code => ok({ code, sortie }));
  });
  const cles = path.join(ICI, 'cles', 'cle_privee.pem');
  const fabriquer = (sortie, n, cle) => executer(path.join(LAUNCHER, 'outils', 'fabriquer_manifeste.js'),
    ['--paquet', PAQUET, '--sortie', sortie, '--mise-en-ligne', String(n), '--sans-verifier-tiers', '--cle-privee', cle]);

  const d20 = path.join(ICI, 'publication_20');
  let r = await fabriquer(d20, 20, cles);
  verifier('manifeste 20 fabriqué pour la publication', r.code === 0, r.sortie);

  r = await publier(d20, ['--essai']);
  verifier('--essai : le plan est montré, rien envoyé', r.code === 0 && /rien envoyé/.test(r.sortie) && gh.ecritures.length === 0, r.sortie);

  r = await publier(d20, [], '');
  verifier('sans jeton : refusé, rien envoyé', r.code === 1 && /pas de jeton/.test(r.sortie) && gh.ecritures.length === 0, r.sortie);

  r = await publier(d20, []);
  const blobs = fs.readdirSync(d20).filter(n => /^[0-9a-f]{64}$/.test(n)).length;
  verifier('publication réussie et relue depuis l\'adresse publique', r.code === 0 && /Publié : .*mise en ligne 20, signature vérifiée/.test(r.sortie), r.sortie);
  verifier('la release a nos ' + blobs + ' fichiers et les 6 fichiers du manifeste (dont le fichier signé unique)',
    gh.fichiers.size === blobs + 6 && gh.fichiers.has('manifeste.signe.json') && gh.fichiers.has('manifeste-20.signe.json'), String(gh.fichiers.size));
  const envois = gh.ecritures.filter(e => e.startsWith('POST /repos/o/r/releases/1/assets'));
  verifier('nos fichiers d\'abord, puis le fichier signé unique, la signature et le manifeste courant en tout dernier',
    envois.length === blobs + 6 && envois[envois.length - 3].endsWith(' manifeste.signe.json') &&
    envois[envois.length - 2].endsWith(' manifeste.json.sig') && envois[envois.length - 1].endsWith(' manifeste.json') &&
    envois.slice(0, blobs).every(e => /\s[0-9a-f]{64}$/.test(e)), envois.slice(-6).join(' | '));

  const G = require('./github');
  verifier('la release « joueurs » : titre et texte pour les joueurs (ni nom d\'outil ni de personne), jamais « Latest »',
    gh.release && gh.release.name === 'Fichiers du jeu (le launcher s’en occupe)' && gh.release.body === G.TEXTE_POUR_JOUEURS &&
    gh.release.make_latest === 'false' &&
    // (hors des adresses : celle du dépôt porte forcément le nom du compte GitHub)
    !/outils|publier|Florian|clé/i.test((gh.release.name + gh.release.body).replace(/https?:\/\/\S+/g, '')), JSON.stringify(gh.release));
  const racine = path.join(ICI, 'racine_G');
  r = await launcher(['--racine', racine, '--verifier-seulement', '--cle-publique', CLE,
    '--manifeste', GH + '/o/r/releases/download/joueurs/manifeste.json']);
  verifier('un launcher installe tout depuis la release', r.code === 0 && /233 vérifiés, 233 téléchargés/.test(r.sortie), r.sortie.slice(-300));

  const avant = gh.ecritures.length;
  r = await publier(d20, []);
  verifier('republier la même : 0 fichier envoyé, seuls les 3 fichiers du manifeste courant sont remplacés',
    r.code === 0 && /À envoyer : 0 fichier/.test(r.sortie) && gh.ecritures.length - avant === 6, r.sortie);

  // Un dossier sans le fichier signé unique (fabriqué avant la 1.0.3) : refusé avant tout envoi.
  const dSans = path.join(ICI, 'publication_sans_enveloppe');
  copierDossier(d20, dSans);
  fs.renameSync(path.join(dSans, 'manifeste.signe.json'), path.join(dSans, 'manifeste.signe.json.retire'));
  const avantSans = gh.ecritures.length;
  r = await publier(dSans, []);
  verifier('sans manifeste.signe.json : refusé avant tout envoi',
    r.code === 1 && /manifeste\.signe\.json absent/.test(r.sortie) && gh.ecritures.length === avantSans, r.sortie);

  const d14 = path.join(ICI, 'publication_14');
  await fabriquer(d14, 14, cles);
  const avant14 = gh.ecritures.length;
  r = await publier(d14, []);
  verifier('revenir à une mise en ligne plus ancienne : refusé sans --retour-arriere',
    r.code === 1 && /--retour-arriere/.test(r.sortie) && gh.ecritures.length === avant14, r.sortie);

  await executer(path.join(LAUNCHER, 'outils', 'creer_cles.js'), [path.join(ICI, 'autre_cle')]);
  const dFaux = path.join(ICI, 'publication_fausse_cle');
  await fabriquer(dFaux, 21, path.join(ICI, 'autre_cle', 'cle_privee.pem'));
  const avantFaux = gh.ecritures.length;
  r = await publier(dFaux, []);
  verifier('manifeste signé par une autre clé : refusé avant tout envoi',
    r.code === 1 && /ne va pas avec la clé publique du launcher/.test(r.sortie) && gh.ecritures.length === avantFaux, r.sortie);

  gh.srv.close();
}

// Un faux serveur Minecraft qui répond au « Server List Ping » comme le vrai (ou pas du tout, selon le mode).
async function essaisEtatServeur() {
  const net = require('net');
  const { etatServeur, paquet, lireVarint } = require('../src/etat_serveur');
  const reponse = {
    version: { name: '1.21.1', protocol: 767 },
    players: { max: 60, online: 3, sample: [{ name: '_Floskyl_', id: 'x' }, { name: '§6Pub pour un autre serveur', id: 'y' }, { name: 'Blackhurt54', id: 'z' }] },
    description: { text: '', extra: [{ text: '✦ CASTERIA ✦', color: 'gold', bold: true }, { text: ' §aen vert§r normal', color: 'gray' }, { text: 'faux', color: 'javascript:alert(1)' }] },
  };
  function faux(mode) {
    const srv = net.createServer(s => {
      if (mode === 'muet') return;
      let recu = Buffer.alloc(0);
      s.on('data', d => {
        recu = Buffer.concat([recu, d]);
        for (;;) {
          const l = lireVarint(recu, 0);
          if (!l || recu.length < l.fin + l.valeur) return;
          const corps = recu.subarray(l.fin, l.fin + l.valeur);
          recu = recu.subarray(l.fin + l.valeur);
          const id = lireVarint(corps, 0).valeur;
          if (id === 0x00 && corps.length === 1) {
            const json = Buffer.from(JSON.stringify(reponse), 'utf8');
            const { varint } = require('../src/etat_serveur');
            s.write(paquet(0x00, Buffer.concat([varint(json.length), json])));
          } else if (id === 0x01) s.write(paquet(0x01, corps.subarray(1)));
        }
      });
    });
    return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(srv)));
  }
  const bon = await faux('normal');
  let r = await etatServeur({ adresse: '127.0.0.1', port: bon.address().port });
  verifier('en ligne : 3 joueurs sur 60, version 1.21.1', r.etat === 'en-ligne' && r.joueurs.enLigne === 3 && r.joueurs.max === 60 && r.version.protocole === 767, JSON.stringify(r).slice(0, 200));
  verifier('les pseudos : seulement les vrais (la publicité en § est écartée)', JSON.stringify(r.joueurs.noms) === '["_Floskyl_","Blackhurt54"]', JSON.stringify(r.joueurs.noms));
  const texte = r.motd.map(m => m.texte).join('');
  const or = r.motd.find(m => m.texte === '✦ CASTERIA ✦');
  const vert = r.motd.find(m => m.texte === 'en vert');
  const faussecouleur = r.motd.find(m => m.texte === 'faux');
  verifier('la description en morceaux colorés (composants et codes §)',
    texte === '✦ CASTERIA ✦ en vert normalfaux' && or && or.couleur === 'gold' && or.gras && vert && vert.couleur === 'green' && faussecouleur && faussecouleur.couleur === null,
    JSON.stringify(r.motd));
  verifier('la latence est mesurée', Number.isInteger(r.latenceMs) && r.latenceMs >= 0, String(r.latenceMs));
  bon.close();

  const muet = await faux('muet');
  const t0 = Date.now();
  r = await etatServeur({ adresse: '127.0.0.1', port: muet.address().port });
  verifier('un serveur qui ne répond pas : hors ligne en moins de 5 s', r.etat === 'hors-ligne' && Date.now() - t0 < 5000, JSON.stringify(r) + ' ' + (Date.now() - t0) + ' ms');
  muet.close();

  r = await etatServeur({ adresse: '127.0.0.1', port: 1 });
  verifier('un port fermé : hors ligne (serveur fermé)', r.etat === 'hors-ligne' && r.raison === 'ECONNREFUSED', JSON.stringify(r));
  r = await etatServeur({ adresse: 'nexistepas.invalid', port: 25565 });
  verifier('un nom introuvable : injoignable (pas d\'internet)', r.etat === 'injoignable', JSON.stringify(r));
}

// La mise à jour du CODE du launcher : les vrais modules (amorce/choisir.js, src/code_launcher.js), des versions
// fabriquées par outils/publier_code.js (en --essai, contre un faux GitHub) et servies par l'hébergement local.
async function essaisCodeLauncher(BASE, CLE) {
  const A = require('../amorce/choisir');
  const C = require('../src/code_launcher');
  const clePub = fs.readFileSync(CLE, 'utf8');
  const clePriv = path.join(ICI, 'cles', 'cle_privee.pem');
  const gh = fauxGitHub();
  await new Promise(ok => gh.srv.listen(0, '127.0.0.1', ok));
  const GH = 'http://127.0.0.1:' + gh.srv.address().port;

  async function fabriquer(version, nom, options = {}) {
    const projet = path.join(ICI, 'projet_' + nom);
    copierDossier(path.join(LAUNCHER, 'electron'), path.join(projet, 'electron'));
    copierDossier(path.join(LAUNCHER, 'src'), path.join(projet, 'src'));
    const p = JSON.parse(fs.readFileSync(path.join(LAUNCHER, 'package.json'), 'utf8'));
    p.version = version;
    if (options.moteur) p.devDependencies.electron = options.moteur;
    fs.writeFileSync(path.join(projet, 'package.json'), JSON.stringify(p, null, 2));
    return executer(path.join(LAUNCHER, 'outils', 'publier_code.js'), ['--projet', projet, '--sortie', path.join(ICI, nom),
      '--cle-privee', options.clePrivee || clePriv, '--cle-publique', options.clePublique || CLE, '--essai',
      '--depot', 'o/r', '--api', GH, '--envois', GH, '--telechargements', GH, '--jeton', path.join(ICI, 'pas_de_jeton.txt')]);
  }
  const racine = path.join(ICI, 'racine_code');
  const outils = {
    verifierSignature: (o, s) => A.verifierSignature(o, s, clePub), validerCode: A.validerCode, comparerVersions: A.comparerVersions,
    verifierDossier: d => A.verifierDossier(d, clePub), lireEtat: () => A.lireEtat(racine), ecrireEtat: e => A.ecrireEtat(racine, e),
  };
  const choisir = () => A.choisirCode({ racine, embarque: LAUNCHER, versionEmbarquee: '1.0.0', moteur: '44.4.5', clePublique: clePub });
  const chercher = (nom, actuelle) => C.chercherMaj({ source: BASE + '/' + nom + '/code.json', outils, versionActuelle: actuelle, moteur: '44.4.5', etat: A.lireEtat(racine) });
  const versionDe = base => JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8')).version;

  let r = await fabriquer('1.0.1', 'code_101');
  verifier('code 1.0.1 fabriqué et signé', r.code === 0 && /Code du launcher 1\.0\.1/.test(r.sortie) && /rien envoyé/.test(r.sortie), r.sortie);
  let choix = choisir();
  verifier("sans mise à jour : l'amorce démarre le code de l'installateur", choix.embarquee && choix.base === LAUNCHER);

  // 1. Une vraie mise à jour, puis son premier démarrage confirmé.
  let maj = await chercher('code_101', '1.0.0');
  verifier('1.0.1 trouvée (signature de la clé, plus récente)', maj && maj.manifeste.version === '1.0.1' && !maj.moteurDifferent);
  await C.installerMaj({ racine, maj, outils });
  choix = choisir();
  verifier("l'amorce démarre 1.0.1, revérifiée, en essai", !choix.embarquee && versionDe(choix.base) === '1.0.1' && A.lireEtat(racine).essai.version === '1.0.1');
  A.confirmer(racine, '1.0.1');
  verifier('démarrage confirmé : essai effacé, 1.0.1 reste active', A.lireEtat(racine).essai === null && versionDe(choisir().base) === '1.0.1');
  A.confirmer(racine, '1.0.1');

  // 1 bis. Linux « X11 d'abord » : main.js relance le launcher AVANT que la page réponde. Sans la confirmation faite
  // juste avant la relance, l'amorce du processus relancé refuserait la version (essai jamais confirmé).
  choisir();
  const sansConfirmer = JSON.parse(JSON.stringify(A.lireEtat(racine)));
  A.confirmer(racine, '1.0.1');                    // ce que fait main.js avant relancer(... --ozone-platform=x11)
  choix = choisir();                               // le processus relancé
  verifier('relance en X11 avant la page : la version n\'est pas refusée, et le processus relancé refait son essai',
    sansConfirmer.essai && versionDe(choix.base) === '1.0.1' && !A.lireEtat(racine).refusees.includes('1.0.1') &&
    A.lireEtat(racine).essai && A.lireEtat(racine).essai.version === '1.0.1', JSON.stringify(A.lireEtat(racine)));
  A.confirmer(racine, '1.0.1');
  const mainJs = fs.readFileSync(path.join(LAUNCHER, 'electron', 'main.js'), 'utf8');
  const blocRelance = mainJs.slice(mainJs.indexOf('if (RELANCE_X11) {'), mainJs.indexOf('if (RELANCE_X11) {') + 400);
  verifier('main.js confirme auprès de l\'amorce AVANT la relance X11 du démarrage',
    blocRelance.indexOf('AMORCE.confirmer()') > 0 && blocRelance.indexOf('AMORCE.confirmer()') < blocRelance.indexOf('relancer('), blocRelance.slice(0, 200));

  // 2. Une signature fausse : rien n'est téléchargé.
  verifier('le fichier signé unique code.signe.json est fabriqué avec le code',
    fs.existsSync(path.join(ICI, 'code_101', 'code.signe.json')) && fs.existsSync(path.join(ICI, 'code_101', 'code-1.0.1.signe.json')));
  copierDossier(path.join(ICI, 'code_101'), path.join(ICI, 'code_faux'));
  const brut = fs.readFileSync(path.join(ICI, 'code_faux', 'code.json'), 'utf8');
  fs.writeFileSync(path.join(ICI, 'code_faux', 'code.json'), brut.replace('"version": "1.0.1"', '"version": "1.0.9"'));
  const envCode = JSON.parse(fs.readFileSync(path.join(ICI, 'code_faux', 'code.signe.json'), 'utf8'));
  envCode.contenu = envCode.contenu.replace('"version": "1.0.1"', '"version": "1.0.9"');
  fs.writeFileSync(path.join(ICI, 'code_faux', 'code.signe.json'), JSON.stringify(envCode));
  let e = null;
  try { await chercher('code_faux', '1.0.1'); } catch (x) { e = x; }
  verifier('signature fausse : refusée, rien installé', e && e.code === 'signature_fausse' && !fs.existsSync(path.join(racine, 'code', '1.0.9')), e && e.message);
  // Sans fichier signé unique (release d'avant la 1.0.3) : l'ancien couple est lu, et vérifié pareil.
  fs.renameSync(path.join(ICI, 'code_faux', 'code.signe.json'), path.join(ICI, 'code_faux', 'code.signe.json.retire'));
  e = null;
  try { await chercher('code_faux', '1.0.1'); } catch (x) { e = x; }
  verifier('sans code.signe.json : l\'ancien couple est lu, sa signature fausse refusée', e && e.code === 'signature_fausse', e && e.message);

  // 3. Un fichier tronqué sur l'hébergement : la version n'est pas activée.
  await fabriquer('1.0.2', 'code_102');
  const m102 = JSON.parse(fs.readFileSync(path.join(ICI, 'code_102', 'code.json'), 'utf8'));
  const blob = m102.fichiers.find(f => f.chemin === 'electron/main.js').url;
  const contenu = fs.readFileSync(path.join(ICI, 'code_102', blob));
  fs.writeFileSync(path.join(ICI, 'code_102', blob), contenu.subarray(0, contenu.length - 100));
  maj = await chercher('code_102', '1.0.1');
  e = null;
  try { await C.installerMaj({ racine, maj, outils }); } catch (x) { e = x; }
  verifier("fichier tronqué : refusé, 1.0.2 n'est pas activée, 1.0.1 reste",
    e && e.code === 'empreinte' && !fs.existsSync(path.join(racine, 'code', '1.0.2')) && A.lireEtat(racine).actuelle === '1.0.1' && versionDe(choisir().base) === '1.0.1', e && e.message);
  A.confirmer(racine, '1.0.1');

  // 4. Une version plus ancienne : ignorée.
  await fabriquer('1.0.0', 'code_100');
  verifier('version plus ancienne (1.0.0 quand 1.0.1 tourne) : ignorée', (await chercher('code_100', '1.0.1')) === null);

  // 5. Coupure au milieu du remplacement : le dossier est posé, mais l'état n'est pas écrit.
  await fabriquer('1.0.3', 'code_103');
  maj = await chercher('code_103', '1.0.1');
  e = null;
  try {
    await C.installerMaj({ racine, maj, outils: Object.assign({}, outils, { ecrireEtat: () => { throw new Error('coupure de courant'); } }) });
  } catch (x) { e = x; }
  verifier("coupure avant l'état : l'ancienne version (1.0.1) reste active", e && versionDe(choisir().base) === '1.0.1', e && e.message);
  A.confirmer(racine, '1.0.1');
  await C.installerMaj({ racine, maj, outils });
  verifier('au passage suivant, 1.0.3 est seulement activée (déjà là et intacte)', A.lireEtat(racine).actuelle === '1.0.3' && A.lireEtat(racine).precedente === '1.0.1');

  // 6. Un fichier abîmé après coup dans la version active : l'amorce prend la précédente.
  fs.appendFileSync(path.join(racine, 'code', '1.0.3', 'src', 'partie.js'), '\n// abîmé');
  choix = choisir();
  verifier("fichier abîmé dans 1.0.3 : l'amorce la refuse et démarre 1.0.1", versionDe(choix.base) === '1.0.1' && A.lireEtat(racine).refusees.includes('1.0.3'), JSON.stringify(choix.raisons));

  // 7. Une version qui ne démarre jamais (essai jamais confirmé) : refusée au lancement suivant.
  choix = choisir();
  verifier("1.0.1 en essai, jamais confirmée : au lancement suivant elle est refusée, le code de l'installateur démarre",
    choisir().embarquee && A.lireEtat(racine).refusees.includes('1.0.1'), JSON.stringify(A.lireEtat(racine)));

  // 8. Un autre moteur : il faut un nouvel installateur.
  await fabriquer('1.1.0', 'code_110', { moteur: '45.0.0' });
  maj = await chercher('code_110', '1.0.0');
  verifier('moteur différent (45.0.0) : le launcher demande un nouvel installateur, rien installé', maj && maj.moteurDifferent === true);

  // 9. Du code signé par une autre clé, déposé directement sur le disque : jamais démarré.
  await fabriquer('1.2.0', 'code_120', { clePrivee: path.join(ICI, 'autre_cle', 'cle_privee.pem'), clePublique: path.join(ICI, 'autre_cle', 'cle_publique.pem') });
  const m120 = JSON.parse(fs.readFileSync(path.join(ICI, 'code_120', 'code.json'), 'utf8'));
  const dossier120 = path.join(racine, 'code', '1.2.0');
  for (const f of m120.fichiers) {
    fs.mkdirSync(path.dirname(path.join(dossier120, ...f.chemin.split('/'))), { recursive: true });
    fs.copyFileSync(path.join(ICI, 'code_120', f.url), path.join(dossier120, ...f.chemin.split('/')));
  }
  fs.copyFileSync(path.join(ICI, 'code_120', 'code.json'), path.join(dossier120, 'code.json'));
  fs.copyFileSync(path.join(ICI, 'code_120', 'code.json.sig'), path.join(dossier120, 'code.json.sig'));
  const etat = A.lireEtat(racine);
  A.ecrireEtat(racine, Object.assign(etat, { actuelle: '1.2.0' }));
  choix = choisir();
  verifier("code signé par une autre clé : refusé, le code de l'installateur démarre", choix.embarquee && A.lireEtat(racine).refusees.includes('1.2.0'), JSON.stringify(choix.raisons));

  gh.srv.close();
}

// Mac et Linux sans Mac ni Linux : les fonctions reçoivent le système en paramètre (process.platform simulé).
function essaisPlateformes() {
  const R = require('../src/reglages');
  const { racinePour } = require('../amorce/racine');
  const PMC = require('../src/portablemc');

  // 1. Le dossier du launcher, par système, identique entre l'amorce (figée) et le code (qui se met à jour).
  const cas = [
    ['win32', { APPDATA: 'C:\\Users\\flo\\AppData\\Roaming' }, 'C:\\Users\\flo', 'C:\\Users\\flo\\AppData\\Roaming\\Casteria'],
    ['win32', {}, 'C:\\Users\\flo', 'C:\\Users\\flo\\AppData\\Roaming\\Casteria'],
    ['darwin', {}, '/Users/flo', '/Users/flo/Library/Application Support/Casteria'],
    ['linux', {}, '/home/flo', '/home/flo/.local/share/Casteria'],
    ['linux', { XDG_DATA_HOME: '/data/flo' }, '/home/flo', '/data/flo/Casteria'],
    ['linux', { XDG_DATA_HOME: 'relatif/mal' }, '/home/flo', '/home/flo/.local/share/Casteria'],
  ];
  for (const [p, env, maison, attendu] of cas) {
    const a = racinePour(p, env, maison);
    const b = R.racineParDefaut(p, env, maison);
    verifier('dossier du launcher ' + p + (env.XDG_DATA_HOME ? ' (XDG ' + env.XDG_DATA_HOME + ')' : '') + ' : ' + attendu, a === attendu && b === attendu, a + ' / ' + b);
  }
  verifier('jamais le .minecraft', cas.every(([p, env, m]) => !/minecraft/i.test(racinePour(p, env, m))));
  verifier("sous Windows, l'amorce donne le même dossier que celle de l'installateur 1.0.0 publié (%APPDATA%\\Casteria)",
    racinePour('win32', { APPDATA: process.env.APPDATA }, os.homedir()) === path.win32.join(process.env.APPDATA || '', 'Casteria'));

  // 2. Le bon PortableMC par système et processeur, livré et vérifié.
  const empreintes = JSON.parse(fs.readFileSync(path.join(LAUNCHER, 'bin', 'empreintes.json'), 'utf8'));
  const attendus = {
    'win32-x64': ['portablemc.exe', 'MZ'], 'linux-x64': ['portablemc', 'ELF'], 'darwin-x64': ['portablemc', 'Mach-O x86_64'], 'darwin-arm64': ['portablemc', 'Mach-O arm64'],
  };
  const genre = b => (b[0] === 0x4d && b[1] === 0x5a ? 'MZ' : b.readUInt32BE(0) === 0x7f454c46 ? 'ELF'
    : b.readUInt32BE(0) === 0xcffaedfe ? 'Mach-O ' + (b.readUInt32LE(4) === 0x01000007 ? 'x86_64' : b.readUInt32LE(4) === 0x0100000c ? 'arm64' : '?') : '?');
  for (const [d, [nom, type]] of Object.entries(attendus)) {
    const [p, arch] = d.split('-');
    const livre = PMC.cheminLivre({ installe: false, projet: LAUNCHER, plateforme: p, arch });
    const installe = PMC.cheminLivre({ installe: true, resources: p === 'win32' ? 'C:\\App\\resources' : '/App/Contents/Resources', plateforme: p, arch });
    const octets = fs.existsSync(livre) ? fs.readFileSync(livre) : Buffer.alloc(4);
    const e = empreintes.fichiers[d + '/' + nom];
    verifier(d + ' : ' + nom + ' (' + type + '), empreinte relevée, chemin installé ' + installe,
      genre(octets) === type && e && e.sha256 === crypto.createHash('sha256').update(octets).digest('hex') &&
      installe === (p === 'win32' ? 'C:\\App\\resources\\bin\\portablemc.exe' : '/App/Contents/Resources/bin/portablemc'), genre(octets) + ' ' + livre);
  }

  // 3. Sous Linux (simulé) : la copie exécutable dans le dossier du launcher, refaite seulement si besoin.
  const racine = path.join(ICI, 'racine_linux');
  const livreLinux = PMC.cheminLivre({ installe: false, projet: LAUNCHER, plateforme: 'linux', arch: 'x64' });
  const exe = PMC.preparer({ livre: livreLinux, racine, plateforme: 'linux', arch: 'x64', empreintes });
  const date1 = fs.statSync(exe).mtimeMs;
  verifier('Linux : PortableMC recopié dans <racine>/bin/portablemc, à l\'identique',
    exe === path.posix.join(racine, 'bin', 'portablemc') && sha256(exe) === empreintes.fichiers['linux-x64/portablemc'].sha256, exe);
  if (process.platform !== 'win32') verifier('Linux : droits 755', (fs.statSync(exe).mode & 0o777) === 0o755);
  PMC.preparer({ livre: livreLinux, racine, plateforme: 'linux', arch: 'x64', empreintes });
  verifier('Linux : au lancement suivant, la copie à jour n\'est pas réécrite', fs.statSync(exe).mtimeMs === date1);
  let e = null;
  const faux = JSON.parse(JSON.stringify(empreintes));
  faux.fichiers['linux-x64/portablemc'].sha256 = '0'.repeat(64);
  try { PMC.preparer({ livre: livreLinux, racine, plateforme: 'linux', arch: 'x64', empreintes: faux }); } catch (x) { e = x; }
  verifier('un PortableMC livré qui n\'a pas son empreinte : refusé', e && e.code === 'portablemc_abime');
  verifier('Windows : utilisé en place, sans copie (comme l\'installateur publié)',
    PMC.preparer({ livre: PMC.cheminLivre({ installe: false, projet: LAUNCHER, plateforme: 'win32', arch: 'x64' }), racine, plateforme: 'win32', arch: 'x64', empreintes })
      === PMC.cheminLivre({ installe: false, projet: LAUNCHER, plateforme: 'win32', arch: 'x64' }));

  // 4. La mémoire conseillée, pareille partout (os.totalmem).
  verifier('mémoire conseillée : 16 Go donne 4, 8 Go donne 3, 4 Go donne 2',
    R.memoireConseillee(15.6 * 1024 ** 3) === 4 && R.memoireConseillee(7.8 * 1024 ** 3) === 3 && R.memoireConseillee(3.9 * 1024 ** 3) === 2);

  // 5. Le code : aucun chemin propre à Windows écrit en dur (hors de la branche Windows de src/portablemc.js).
  const fautes = [];
  for (const dossier of ['src', 'electron', 'amorce']) {
    // Les modules propres à Windows (integration_windows.js : le registre s'écrit avec des « \ ») sont exclus.
    for (const rel of require('../src/synchro').listerFichiers(path.join(LAUNCHER, dossier)).filter(f => f.endsWith('.js') && !/windows/.test(f))) {
      const lignes = fs.readFileSync(path.join(LAUNCHER, dossier, rel), 'utf8').split('\n');
      lignes.forEach((l, i) => {
        const code = l.replace(/\/\/.*$/, '');
        // Les expressions /\\n/g et /\\t/g (les retours à la ligne échappés par PortableMC) ne sont pas des chemins.
        const sansEchappements = code.replace(/\/\\\\[nt]\/g/g, '');
        if (/\\\\/.test(sansEchappements) && !/win32/.test(code)) fautes.push(dossier + '/' + rel + ':' + (i + 1) + ' barre oblique inverse');
        if (/\.exe\b/.test(code) && !(dossier === 'src' && rel === 'portablemc.js' && /win32/.test(code))) fautes.push(dossier + '/' + rel + ':' + (i + 1) + ' .exe');
        if (/%APPDATA%|\.bat\b|cmd\.exe/i.test(code)) fautes.push(dossier + '/' + rel + ':' + (i + 1) + ' chemin Windows');
      });
    }
  }
  verifier('aucun « \\ », « .exe », « .bat » ni %APPDATA% écrit en dur dans le code', fautes.length === 0, fautes.join(', '));
  verifier('l\'icône PNG de la fenêtre (Mac, Linux) est là', fs.existsSync(path.join(LAUNCHER, 'electron', 'icones', 'icone-256.png')));

  // 5 bis. L'affichage (code 1.0.6) : Wayland à échelle fractionnaire, le repli X11, le zoom de la page.
  const AF = require('../src/affichage');
  verifier('zoom de la page : 1 à 1 100 x 700, la plus petite des deux échelles, jamais sous 0,5',
    AF.zoomPour(1100, 700) === 1 && AF.zoomPour(2200, 1400) === 2 && Math.abs(AF.zoomPour(1920, 1080) - 1080 / 700) < 1e-9 &&
    Math.abs(AF.zoomPour(800, 600) - 800 / 1100) < 1e-9 && AF.zoomPour(300, 200) === 0.5 && AF.zoomPour(0, 0) === 1);
  const racineAf = path.join(ICI, 'racine_affichage');
  // Les environnements : Wayland seul (pas de XWayland), Wayland avec XWayland (DISPLAY), X11 pur, Hyprland, Arch sway.
  const wl = { WAYLAND_DISPLAY: 'wayland-1', XDG_SESSION_TYPE: 'wayland' };
  const wlX = Object.assign({ DISPLAY: ':0' }, wl);
  const hypr = Object.assign({ HYPRLAND_INSTANCE_SIGNATURE: 'abc', XDG_CURRENT_DESKTOP: 'Hyprland' }, wl);
  const d = (env, argv, plus) => AF.decider(Object.assign({ plateforme: 'linux', env, argv: argv || ['casteria'], racine: racineAf }, plus || {}));
  const dW = AF.decider({ plateforme: 'win32', env: wlX, argv: ['x'], racine: racineAf });
  verifier('Windows et Mac : aucun réglage d\'affichage', dW.commutateurs.length === 0 && !dW.relancerX11 && !dW.wayland);
  verifier('Electron 44 : X11 dès que DISPLAY existe, sauf XDG_SESSION_TYPE=wayland ou l\'indice wayland ; Wayland s\'il est seul',
    AF.sessionWayland(wl) && AF.sessionWayland(wlX) && !AF.sessionWayland({ DISPLAY: ':0', WAYLAND_DISPLAY: 'w' }) &&
    AF.sessionWayland({ DISPLAY: ':0', WAYLAND_DISPLAY: 'w', ELECTRON_OZONE_PLATFORM_HINT: 'wayland' }) &&
    !AF.sessionWayland({ WAYLAND_DISPLAY: 'w', ELECTRON_OZONE_PLATFORM_HINT: 'x11' }) && !AF.sessionWayland({ DISPLAY: ':0' }) &&
    AF.sessionWayland({ WAYLAND_DISPLAY: 'w' }));
  const dWx = d(wlX);
  verifier('X11 D\'ABORD (demande de 5b) : Wayland avec XWayland : relance en --ozone-platform=x11, aucun réglage Wayland',
    dWx.relancerX11 && !dWx.wayland && dWx.commutateurs.length === 0, JSON.stringify(dWx));
  const dRel = d(wlX, ['casteria', AF.ARG_X11]);
  verifier('déjà relancé en X11 : on reste (pas de boucle)', dRel.x11 && !dRel.relancerX11 && !dRel.wayland);
  const dSeul = d(wl, null, { featuresDesactivees: 'Foo' });
  verifier('Wayland sans XWayland (pas de DISPLAY) : Wayland natif, sans le réglage hors Hyprland (il casse le sway d\'Arch)',
    dSeul.wayland && !dSeul.relancerX11 && dSeul.commutateurs.length === 0, JSON.stringify(dSeul));
  const dHy = d(hypr, null, { featuresDesactivees: 'Foo' });
  verifier('Hyprland sans XWayland : Wayland natif AVEC disable-features=WaylandFractionalScaleV1 (le cas de l\'ami)',
    dHy.wayland && JSON.stringify(dHy.commutateurs) === '[["disable-features","Foo,WaylandFractionalScaleV1"]]', JSON.stringify(dHy));
  const dHyX = d(Object.assign({ DISPLAY: ':1' }, hypr));
  verifier('Hyprland avec XWayland : X11 d\'abord, comme partout', dHyX.relancerX11 && !dHyX.wayland);
  const omarchy = Object.assign({ ELECTRON_OZONE_PLATFORM_HINT: 'wayland' }, hypr, { DISPLAY: ':1' });
  const dOm = d(omarchy);
  verifier('Omarchy (ELECTRON_OZONE_PLATFORM_HINT=wayland pour toutes les applications) avec XWayland : X11 quand même (décision de 5b)',
    dOm.relancerX11 && !dOm.wayland && dOm.commutateurs.length === 0, JSON.stringify(dOm));
  const dPorte = d(Object.assign({ CASTERIA_WAYLAND: '1' }, wlX));
  verifier('seule notre porte d\'essai CASTERIA_WAYLAND=1 garde Wayland natif avec XWayland', !dPorte.relancerX11 && dPorte.wayland);
  const dX = d({ DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' });
  verifier('X11 pur : rien à faire', !dX.relancerX11 && !dX.wayland && dX.commutateurs.length === 0);
  verifier('les arguments de la relance : ceux de maintenant, plus --ozone-platform=x11 une seule fois',
    JSON.stringify(AF.argumentsX11(['casteria', '--un', '--ozone-platform=wayland'])) === '["--un","--ozone-platform=x11"]');
  AF.noterRepliX11(racineAf, 'essai');
  const dNoteSansX = d(wl);
  const dNoteAvecX = d(wlX);
  verifier('une note X11 sans XWayland : oubliée, Wayland natif (jamais de démarrage impossible) ; avec XWayland : X11',
    dNoteSansX.effacerNote && dNoteSansX.wayland && !dNoteSansX.relancerX11 && dNoteAvecX.relancerX11 && !dNoteAvecX.effacerNote,
    JSON.stringify([dNoteSansX, dNoteAvecX]));
  AF.effacerNote(racineAf);
  verifier('la note effacée', !AF.lireNote(racineAf).x11);
  // L'AppImage avec FUSE (essai de cc) : jamais app.relaunch, le fichier .AppImage relancé lui-même, sans l'ancien montage.
  const lanc = AF.lancementAppImage({ APPIMAGE: '/home/j/C.AppImage', APPDIR: '/tmp/.mount_ab', LD_LIBRARY_PATH: '/tmp/.mount_ab/usr/lib:/usr/lib',
    PATH: '/tmp/.mount_ab/usr/bin:/usr/bin', XDG_DATA_DIRS: '/tmp/.mount_ab/usr/share', HOME: '/home/j', DISPLAY: ':0' }, ['--no-sandbox', AF.ARG_X11]);
  verifier('AppImage : on lance le fichier .AppImage, détaché, sans APPDIR ni aucun chemin de l\'ancien montage /tmp/.mount_xxx',
    lanc.commande === '/home/j/C.AppImage' && lanc.options.detached && lanc.options.env.LD_LIBRARY_PATH === '/usr/lib' &&
    lanc.options.env.PATH === '/usr/bin' && !('XDG_DATA_DIRS' in lanc.options.env) && !('APPDIR' in lanc.options.env) &&
    lanc.options.env.DISPLAY === ':0' && lanc.options.cwd === '/home/j' && JSON.stringify(lanc.args) === '["--no-sandbox","--ozone-platform=x11"]',
    JSON.stringify(lanc));
  const mainAf = fs.readFileSync(path.join(LAUNCHER, 'electron', 'main.js'), 'utf8');
  const fRel = mainAf.slice(mainAf.indexOf('function relancer('), mainAf.indexOf('function relancer(') + 900);
  verifier('main.js : sous AppImage, relancer lance le fichier (spawn) après avoir rendu le verrou, jamais app.relaunch',
    fRel.indexOf('process.env.APPIMAGE') > 0 && fRel.indexOf('releaseSingleInstanceLock') < fRel.indexOf('spawn(') &&
    fRel.indexOf('spawn(') < fRel.indexOf('app.relaunch('), fRel.slice(0, 300));
  const amorceAf = fs.readFileSync(path.join(LAUNCHER, 'amorce', 'amorce.js'), 'utf8');
  verifier('l\'amorce (nouveaux paquets) : après un plantage sous AppImage, spawn du fichier, plus d\'app.relaunch avec APPIMAGE',
    /if \(process\.env\.APPIMAGE\) \{[\s\S]*spawn\(process\.env\.APPIMAGE/.test(amorceAf) && !/app\.relaunch\(\{ execPath: process\.env\.APPIMAGE/.test(amorceAf));
  // Le garde-fou de 5b : une relance X11 qui n'a jamais montré de fenêtre ne se refait plus jamais.
  AF.poserMarqueRelance(racineAf);
  const dEch = d(wlX);
  verifier('la marque « relance X11 en cours » encore là au démarrage suivant : plus de relance, Wayland natif',
    dEch.relanceEchouee && !dEch.relancerX11 && dEch.wayland && dEch.x11Refuse, JSON.stringify(dEch));
  const dDansX11 = d(wlX, ['casteria', AF.ARG_X11]);
  verifier('le processus relancé en X11 ne prend pas la marque pour un échec (c\'est lui qui doit l\'effacer)', !dDansX11.relanceEchouee && dDansX11.x11);
  AF.noterX11Impossible(racineAf, 'essai');
  AF.effacerMarqueRelance(racineAf);
  const dApres = d(wlX);
  verifier('ensuite, « X11 impossible » est retenu : jamais plus de relance ici', !dApres.relancerX11 && dApres.wayland && dApres.x11Refuse);
  AF.effacerNote(racineAf);
  const blocDebut = mainAf.slice(mainAf.indexOf('if (RELANCE_X11) {'), mainAf.indexOf('if (RELANCE_X11) {') + 500);
  verifier('main.js : la marque est posée AVANT la relance, et la page qui répond (« etat ») l\'efface',
    blocDebut.indexOf('poserMarqueRelance') > 0 && blocDebut.indexOf('poserMarqueRelance') < blocDebut.indexOf('relancer(') &&
    /ipcMain\.handle\('etat'[\s\S]{0,700}effacerMarqueRelance\(RACINE\)/.test(mainAf));
  verifier('AppImage : la relance part du fichier AppImage (pas du montage /tmp/.mount_xxx) ; ailleurs, rien de changé',
    AF.optionsRelance({ APPIMAGE: '/home/flo/Casteria.AppImage' }, ['--ozone-platform=x11']).execPath === '/home/flo/Casteria.AppImage' &&
    JSON.stringify(AF.optionsRelance({ APPIMAGE: '/a' }, ['--x']).args) === '["--x"]' &&
    AF.optionsRelance({}, undefined).execPath === undefined && AF.optionsRelance({}, undefined).args === undefined);
  const mainJs = fs.readFileSync(path.join(LAUNCHER, 'electron', 'main.js'), 'utf8');
  const amorceJs = fs.readFileSync(path.join(LAUNCHER, 'amorce', 'amorce.js'), 'utf8');
  verifier('aucun app.relaunch() direct dans main.js (tout passe par relancer) ; l\'amorce gère l\'AppImage',
    (mainJs.match(/app\.relaunch\(/g) || []).length === 1 && /APPIMAGE/.test(amorceJs));

  // 6. Linux trop ancien pour PortableMC (glibc 2.39 au moins) : dit dès l'ouverture, JOUER grisé.
  const glibcs = [['linux', '2.35', true], ['linux', '2.38', true], ['linux', '2.39', false], ['linux', '2.40', false],
    ['linux', '3.0', false], ['linux', undefined, false], ['linux', 'bizarre', false], ['win32', '2.10', false], ['darwin', undefined, false]];
  const mauvais = glibcs.filter(([p, g, attendu]) => (R.systemeBloquant(p, g) === R.TEXTE_LINUX_ANCIEN) !== attendu || (!attendu && R.systemeBloquant(p, g) !== null));
  verifier('glibc sous 2.39 : bloqué avec la phrase pour le joueur ; 2.39 et plus, inconnue, Windows, Mac : rien',
    mauvais.length === 0, JSON.stringify(mauvais));
  verifier('cet ordinateur (' + process.platform + ') n\'est pas bloqué', process.platform === 'linux' || R.systemeBloquant() === null);
  if (os.totalmem() / 1024 ** 3 < 18) {
    verifier('la mémoire trop haute nomme le bon système (Windows, macOS, Linux)',
      /à Windows\.$/.test(R.verifierMemoire(16, 'win32')) && /à macOS\.$/.test(R.verifierMemoire(16, 'darwin')) &&
      /à Linux\.$/.test(R.verifierMemoire(16, 'linux')), R.verifierMemoire(16, 'darwin'));
  }
}

// La surveillance de la partie (code 1.0.5) : jamais les menus de Minecraft. Les lignes sont celles de vrais journaux
// (le passage en production de l'étape 6, le refus de Florian du 25/09), telles que PortableMC les transmet.
async function essaisSurveillance(BASE, CLE) {
  const S = require('../src/surveillance');
  const { sonderConnexion, uuidHorsLigne, lireComposant } = require('../src/sonde_connexion');
  const { fermerJeu, vivant } = require('../src/fermer_jeu');
  const P = require('../src/partie');
  const R = require('../src/reglages');
  const net = require('net');
  const { lireVarint, paquet, varint } = require('../src/etat_serveur');

  // 1. Les raisons, en français, en anglais, et les textes de nos scripts du serveur.
  const raisons = [
    ['Fermeture en cours...', 'quitte', false], ['Quitting', 'quitte', false],
    ["✦ CASTERIA ✦\n\nTu n'as pas entré ton mot de passe à temps.\nReviens, et tape-le dans la minute qui suit ton arrivée.", 'login_delai', true],
    ["Vous n'êtes pas sur la liste blanche de ce serveur !", 'liste_blanche', true], ['You are not white-listed on this server!', 'liste_blanche', true],
    ["Tu es banni de Casteria.\n\nRaison : triche\nDurée : sans fin\n\nSi tu penses que c'est une erreur, parles-en au fondateur du serveur.", 'banni', true],
    ['Vous êtes banni(e) de ce serveur.\nRaison : Banni(e) par un opérateur', 'banni', true], ['You are banned from this server', 'banni', true],
    ['Tu as été expulsé de Casteria.\n\nRaison : spam\n\nTu peux revenir, mais respecte les règles.', 'expulse', true],
    ['Expulsé(e) par un opérateur', 'expulse', true], ['Kicked by an operator', 'expulse', true],
    ['Vous êtes déjà connecté(e) depuis un autre emplacement', 'double', true], ['You logged in from another location', 'double', true],
    ['Le serveur est complet !', 'complet', true], ['The server is full!', 'complet', true],
    ['Serveur fermé', 'arret', true], ['Server closed', 'arret', true],
    ['Vous avez été immobile trop longtemps !', 'inactif', true],
    ['Délai de connexion expiré', 'coupure', true], ['Timed out', 'coupure', true], ['Connexion perdue', 'coupure', true],
    ['Internal Exception: java.net.SocketException: Connection reset', 'coupure', true],
  ];
  const fausses = raisons.filter(([t, cas, rouge]) => { const c = S.classerRaison(t); return c.cas !== cas || c.rouge !== rouge || !c.message; });
  verifier('les ' + raisons.length + ' raisons de déconnexion (français, anglais, nos scripts) reconnues', fausses.length === 0,
    fausses.map(f => f[0] + ' -> ' + S.classerRaison(f[0]).cas).join(' | '));
  const inconnue = S.classerRaison('✦ CASTERIA ✦\n\nUne raison que le launcher ne connaît pas.');
  verifier('une raison inconnue : celle du serveur, telle quelle (sans la ligne ✦ CASTERIA ✦)',
    inconnue.cas === 'autre' && inconnue.message === "Le serveur t'a déconnecté : « Une raison que le launcher ne connaît pas. »", inconnue.message);
  verifier('le refus lu par la sonde (clé de traduction) : liste blanche, banni, complet',
    S.classerRaison('x', 'multiplayer.disconnect.not_whitelisted').cas === 'liste_blanche' &&
    S.classerRaison('x', 'multiplayer.disconnect.banned.reason').cas === 'banni' &&
    S.classerRaison('x', 'multiplayer.disconnect.server_full').cas === 'complet');
  const tirets = S.CAS.filter(c => /[\u2013\u2014]/.test(c.message));
  verifier('aucun tiret long ni moyen dans les phrases pour le joueur', tirets.length === 0);

  // 2. La machine à états, sur de vraies lignes.
  function suivre(lignes, pas) {
    let t = 0;
    const evs = [];
    const s = S.creerSurveillance({ surEvenement: e => evs.push(e), horloge: () => t });
    for (const l of lignes) {
      if (typeof l === 'number') { t += l; s.tic(); } else if (l && l.sonde) s.raisonServeur(l.sonde); else s.ligne(l);
      if (pas) pas(s);
    }
    return { evs, s };
  }
  const CONNEXION = 'Connecting to gm52-dc02.ouiheberg.com, 25681';
  let r = suivre([CONNEXION, 'Sorting datapack list to load data correctly.', 'Serveur Casino Island UI 1.4.6 (protocole 4) : compatible',
    '[System] [CHAT]  Content de te revoir, _Floskyl_ !\\n Pour jouer, entre ton mot de passe :',
    "Client disconnected with reason: ✦ CASTERIA ✦\\n\\nTu n'as pas entré ton mot de passe à temps.\\nReviens, et tape-le dans la minute qui suit ton arrivée."]);
  verifier('étape 6 : connexion, entrée acceptée (une fois), puis le délai du /login', JSON.stringify(r.evs.map(e => e.type + (e.cas ? ':' + e.cas : ''))) ===
    '["connexion","entree","fin:login_delai"]', JSON.stringify(r.evs));
  // La course 1.0.5 du 25/09 : la sortie brute du jeu (« _stdout_ ») donne la raison en plusieurs lignes.
  {
    let t = 0;
    const evs = [];
    const s = S.creerSurveillance({ surEvenement: e => evs.push(e), horloge: () => t });
    const brute = { brute: true };
    s.ligne('[15:58:45] [Render thread/INFO] [minecraft/ConnectScreen]: ' + CONNEXION, brute);
    s.ligne('[15:58:46] [Render thread/INFO] [de.me.sk.SkyblockBuilder/]: Sorting datapack list to load data correctly.', brute);
    s.ligne('[15:59:48] [Render thread/WARN] [minecraft/ClientCommonPacketListenerImpl]: Client disconnected with reason: ✦ CASTERIA ✦', brute);
    s.ligne('', brute);
    s.ligne("Tu n'as pas entré ton mot de passe à temps.", brute);
    s.ligne('Reviens, et tape-le dans la minute qui suit ton arrivée.', brute);
    const avant = evs.length;
    s.ligne('[15:59:49] [Render thread/INFO] [minecraft/Minecraft]: Stopping!', brute);
    verifier('course 1.0.5 : la raison en plusieurs lignes brutes, lue jusqu\'à la ligne suivante du journal (délai du /login)',
      avant === 2 && evs[2] && evs[2].cas === 'login_delai', JSON.stringify(evs));
    const evs2 = [];
    let t2 = 0;
    const s2 = S.creerSurveillance({ surEvenement: e => evs2.push(e), horloge: () => t2 });
    s2.ligne('[15:59:48] [Render thread/WARN] [x]: Client disconnected with reason: Serveur fermé', brute);
    t2 += 1000;
    s2.tic();
    verifier('la raison brute se termine aussi au tic suivant (rien d\'autre dans le journal)', evs2[0] && evs2[0].cas === 'arret', JSON.stringify(evs2));
    verifier('« ? CASTERIA ? » seul (sortie mal encodée) : pas de message vide ni d\'en-tête montré au joueur',
      S.classerRaison('? CASTERIA ?').message === "Le serveur t'a déconnecté.");
  }
  r = suivre([CONNEXION, 5000, 3000, { sonde: { etat: 'refuse', cle: 'multiplayer.disconnect.not_whitelisted', texte: 'multiplayer.disconnect.not_whitelisted' } },
    'Sorting datapack list to load data correctly.', 'Starting integrated minecraft server version 1.21.1']);
  verifier('le refus de Florian : silence après 8 s, la sonde dit « liste blanche », puis plus rien ne compte (même le solo)',
    JSON.stringify(r.evs.map(e => e.type + (e.cas ? ':' + e.cas : ''))) === '["connexion","silence","fin:liste_blanche"]' &&
    /majuscules comprises/.test(r.evs[2].message), JSON.stringify(r.evs));
  r = suivre([CONNEXION, 8000, { sonde: { etat: 'accepte' } }, 30000, 22000]);
  verifier('rien après « Connecting to », le serveur accepte la sonde : on attend, puis on abandonne à 60 s',
    JSON.stringify(r.evs.map(e => e.type + (e.cas ? ':' + e.cas : ''))) === '["connexion","silence","fin:bloque"]', JSON.stringify(r.evs));
  r = suivre([CONNEXION, 3000, 'Sorting datapack list to load data correctly.', 60000]);
  verifier('une entrée lente (3 s) : ni silence ni abandon', JSON.stringify(r.evs.map(e => e.type)) === '["connexion","entree"]', JSON.stringify(r.evs));
  r = suivre([CONNEXION, "Couldn't connect to server"]);
  verifier('serveur injoignable pendant la connexion', r.evs[1] && r.evs[1].cas === 'injoignable' && r.evs[1].rouge, JSON.stringify(r.evs));
  r = suivre(['Starting integrated minecraft server version 1.21.1']);
  verifier('un monde solo qui s\'ouvre : la partie s\'arrête', r.evs[0] && r.evs[0].cas === 'solo', JSON.stringify(r.evs));
  r = suivre([CONNEXION, 'Sorting datapack list to load data correctly.', 'Client disconnected with reason: Fermeture en cours...',
    '#@!@# Game crashed! Crash report saved to: #@!@# C:\\Users\\nathan\\AppData\\Roaming\\Casteria\\jeu\\crash-reports\\crash-2026-09-25_15.00.00-client.txt']);
  const plantage = r.evs.find(e => e.cas === 'plantage');
  verifier('un plantage (même après « quitter ») : le chemin du rapport, intact (C:\\Users\\nathan\\...)',
    plantage && plantage.rapport === 'C:\\Users\\nathan\\AppData\\Roaming\\Casteria\\jeu\\crash-reports\\crash-2026-09-25_15.00.00-client.txt' &&
    plantage.message === S.TEXTE_PLANTAGE, plantage && plantage.rapport);
  // Code 1.0.7 : le rapport recopié dans le dossier des journaux (un seul endroit pour le joueur).
  {
    const racineP = path.join(ICI, 'racine_plantage');
    const rapport = path.join(ICI, 'crash-2026-09-25_15.00.00-client.txt');
    fs.writeFileSync(rapport, '---- Minecraft Crash Report ----\n');
    const copie = P.copierRapport(rapport, racineP);
    verifier('plantage : le rapport recopié dans journaux/plantage-<date>.txt, à l\'identique ; la phrase renvoie au bouton des Réglages',
      copie && path.dirname(copie) === path.join(racineP, 'journaux') && /plantage-.*\.txt$/.test(copie) &&
      fs.readFileSync(copie, 'utf8') === fs.readFileSync(rapport, 'utf8') && /Le journal du jeu \(pour le staff\)/.test(S.TEXTE_PLANTAGE) &&
      // le bouton porte bien ce nom dans la fenêtre (index.html d'ae)
      fs.readFileSync(path.join(LAUNCHER, 'electron', 'fenetre', 'index.html'), 'utf8').includes('>Le journal du jeu (pour le staff)</button>'), copie);
    verifier('un rapport introuvable ne casse rien', P.copierRapport(path.join(ICI, 'absent.txt'), racineP) === null);
  }
  r = suivre([CONNEXION, 'Sorting datapack list to load data correctly.', 'Client disconnected with reason: Fermeture en cours...', 'Stopping!']);
  verifier('le joueur quitte : « Tu as quitté Casteria. À bientôt ! », sans rouge',
    r.evs[2] && r.evs[2].cas === 'quitte' && !r.evs[2].rouge && r.evs[2].message === 'Tu as quitté Casteria. À bientôt !', JSON.stringify(r.evs));

  // 2 bis. « Déconnexion » dans le menu Échap n'écrit rien (course du 25/09) : la connexion réseau du jeu le dit.
  const CJ = require('../src/connexion_jeu');
  const ns = '  TCP    127.0.0.1:51234    127.0.0.1:25590    ESTABLISHED     24908\n  TCP    127.0.0.1:51235    127.0.0.1:25590    TIME_WAIT       0\n' +
    '  TCP    [::ffff:10.0.0.5]:5000    [::ffff:51.77.1.2]:25681    ÉTABLIE     777\n  TCP    10.0.0.5:5001    8.8.8.8:25681    ESTABLISHED     24908';
  verifier('netstat : la connexion du jeu (pid) vers l\'adresse ET le port du serveur, même en IPv6 et en Windows français',
    CJ.lireNetstat(ns, 24908, new Set(['127.0.0.1']), 25590) && !CJ.lireNetstat(ns, 1, new Set(['127.0.0.1']), 25590) &&
    !CJ.lireNetstat(ns, 24908, new Set(['51.77.1.2']), 25681) && CJ.lireNetstat(ns, 777, new Set(['51.77.1.2']), 25681));
  verifier('lsof (Mac) : seule une connexion établie vers le serveur compte',
    CJ.lireLsof('java 1 f 4u IPv4 0x 0t0 TCP 192.168.1.2:51234->51.77.1.2:25681 (ESTABLISHED)', new Set(['51.77.1.2']), 25681) &&
    !CJ.lireLsof('java 1 f 4u IPv4 0x 0t0 TCP 192.168.1.2:51234->8.8.8.8:25681 (ESTABLISHED)', new Set(['51.77.1.2']), 25681));
  const proc = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' +
    '   0: 0100007F:C822 0100007F:63F6 01 00000000:00000000 00:00000000 00000000  1000        0 12345 1 0 20 4 30 10 -1';
  verifier('/proc (Linux) : adresse et port en hexadécimal, état 01, et la socket bien à ce processus (inode)',
    CJ.lireProcTcp(proc, new Set(['127.0.0.1']), 25590, new Set(['12345'])) && !CJ.lireProcTcp(proc, new Set(['127.0.0.1']), 25590, new Set(['9'])) &&
    !CJ.lireProcTcp(proc.replace(' 01 ', ' 06 '), new Set(['127.0.0.1']), 25590, new Set(['12345'])) &&
    CJ.ipProc('0000000000000000FFFF00000100007F') === '127.0.0.1');
  {
    const evs = [];
    const s = S.creerSurveillance({ surEvenement: e => evs.push(e), horloge: () => 0 });
    s.ligne(CONNEXION);
    s.ligne('Sorting datapack list to load data correctly.');
    s.connexionReseau(true); s.connexionReseau(false); s.connexionReseau(false); s.connexionReseau(true);
    s.connexionReseau(false); s.connexionReseau(null); s.connexionReseau(false);
    const avant3 = evs.length;
    s.connexionReseau(false);
    verifier('connexion au serveur disparue 3 fois de suite (une coupure brève ou « on ne sait pas » ne comptent pas) : « Tu as quitté Casteria. À bientôt ! »',
      avant3 === 2 && evs[2] && evs[2].cas === 'quitte' && !evs[2].rouge, JSON.stringify(evs));
    const evs2 = [];
    const s2 = S.creerSurveillance({ surEvenement: e => evs2.push(e), horloge: () => 0 });
    s2.ligne(CONNEXION); s2.ligne('Sorting datapack list to load data correctly.'); s2.connexionReseau(true);
    s2.ligne('[16:20:40] [Render thread/WARN] [x]: Client disconnected with reason: Serveur fermé', { brute: true });
    s2.connexionReseau(false); s2.connexionReseau(false); s2.connexionReseau(false);
    s2.ligne('[16:20:41] [Render thread/INFO] [minecraft/Minecraft]: Stopping!', { brute: true });
    verifier('course cas 4 : la raison du journal (« Serveur fermé ») passe avant la connexion disparue',
      evs2.filter(e => e.type === 'fin').length === 1 && evs2[evs2.length - 1].cas === 'arret', JSON.stringify(evs2));
  }

  // 3. La sonde, contre un faux serveur qui lit la vraie poignée de main et le « Login Start ».
  verifier("l'UUID hors ligne est celui du jeu (Notch : b50ad385-829d-3141-a216-7e7d7539ba7f)",
    uuidHorsLigne('Notch').toString('hex') === 'b50ad385829d3141a2167e7d7539ba7f');
  function fauxServeur(mode) {
    const recus = [];
    const srv = net.createServer(s => {
      if (mode === 'muet') return;
      let buf = Buffer.alloc(0);
      s.on('data', d => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          const l = lireVarint(buf, 0);
          if (!l || buf.length < l.fin + l.valeur) return;
          const corps = buf.subarray(l.fin, l.fin + l.valeur);
          buf = buf.subarray(l.fin + l.valeur);
          recus.push(corps);
          if (recus.length === 2) {
            if (mode === 'refuse') {
              const json = Buffer.from(JSON.stringify({ translate: 'multiplayer.disconnect.not_whitelisted' }));
              s.write(paquet(0x00, Buffer.concat([varint(json.length), json])));
            } else s.write(paquet(0x03, varint(256)));
          }
        }
      });
    });
    return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, recus })));
  }
  let f = await fauxServeur('refuse');
  let rs = await sonderConnexion({ adresse: '127.0.0.1', port: f.srv.address().port, pseudo: '_FloSkyl_' });
  const poignee = f.recus[0];
  const etatSuivant = poignee ? poignee[poignee.length - 1] : null;
  const debutLogin = f.recus[1] || Buffer.alloc(0);
  const nomEnvoye = debutLogin.subarray(2, 2 + debutLogin[1]).toString();
  verifier('sonde refusée : « liste blanche », après une poignée de main « login » (767) et le pseudo avec son UUID',
    rs.etat === 'refuse' && rs.cle === 'multiplayer.disconnect.not_whitelisted' && etatSuivant === 2 &&
    lireVarint(poignee, 1).valeur === 767 && nomEnvoye === '_FloSkyl_' &&
    debutLogin.subarray(2 + debutLogin[1]).equals(uuidHorsLigne('_FloSkyl_')), JSON.stringify(rs) + ' ' + nomEnvoye);
  f.srv.close();
  f = await fauxServeur('accepte');
  rs = await sonderConnexion({ adresse: '127.0.0.1', port: f.srv.address().port, pseudo: '_Floskyl_' });
  verifier('sonde acceptée (compression) : elle raccroche aussitôt', rs.etat === 'accepte', JSON.stringify(rs));
  f.srv.close();
  f = await fauxServeur('muet');
  rs = await sonderConnexion({ adresse: '127.0.0.1', port: f.srv.address().port, pseudo: 'x_y', delaiMs: 800 });
  verifier('sonde sans réponse : erreur au bout du délai, rien de conclu', rs.etat === 'erreur', JSON.stringify(rs));
  f.srv.close();
  const comp = lireComposant(JSON.stringify({ text: '', extra: [{ text: 'Tu es banni de Casteria.', color: 'red' }, { text: '\n\nRaison : x' }] }));
  verifier('un refus écrit par nos scripts (texte, sans clé) se lit à plat', comp.cle === null && comp.texte === 'Tu es banni de Casteria.\n\nRaison : x', JSON.stringify(comp));

  // 4. Fermer le jeu : jamais un autre processus ; proprement d'abord, de force après le délai.
  const dormeur = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let d = dormeur();
  await new Promise(ok => setTimeout(ok, 300));
  let t0 = Date.now();
  let res = await fermerJeu(d.pid, { plateforme: 'win32', delaiMs: 1500 });
  verifier('Windows, un processus sans fenêtre : la demande de fermeture ne suffit pas, arrêté de force après le délai',
    res === 'force' && !vivant(d.pid) && Date.now() - t0 >= 1400, res + ' en ' + (Date.now() - t0) + ' ms');
  d = dormeur();
  await new Promise(ok => setTimeout(ok, 300));
  res = await fermerJeu(d.pid, { plateforme: 'linux', delaiMs: 3000 });
  verifier('Mac et Linux : SIGTERM, fermé sans arrêt forcé', res === 'propre' && !vivant(d.pid), res);
  verifier('un processus déjà fermé : rien à faire', (await fermerJeu(d.pid, { delaiMs: 500 })) === 'deja');
  verifier('le launcher ne se ferme jamais lui-même', (await fermerJeu(process.pid)) === 'echec' && (await fermerJeu(0)) === 'echec');

  // 5. Le ping avant le lancement : deux réessais courts avant de conclure.
  let appels = 0;
  let rp = await P.serveurRepond({ adresse: 'x', port: 1 }, { pauseMs: 10, interroger: async () => (++appels < 3 ? { etat: 'hors-ligne' } : { etat: 'en-ligne' }) });
  verifier('ping raté deux fois puis réussi : le jeu se lance', rp.etat === 'en-ligne' && appels === 3, appels + ' appels');
  appels = 0;
  rp = await P.serveurRepond({ adresse: 'x', port: 1 }, { pauseMs: 10, interroger: async () => { appels++; return { etat: 'hors-ligne' }; } });
  verifier('serveur fermé : 3 essais, puis « fermé »', rp.etat === 'hors-ligne' && appels === 3, appels + ' appels');
  const dossierFerme = path.join(ICI, 'serveur_ferme');
  fs.mkdirSync(dossierFerme);
  const mFerme = JSON.parse(fs.readFileSync(path.join(ICI, 'hebergement', 'manifeste.json'), 'utf8'));
  mFerme.serveur = { adresse: '127.0.0.1', port: 1 };
  const octetsFerme = Buffer.from(JSON.stringify(mFerme, null, 2));
  fs.writeFileSync(path.join(dossierFerme, 'manifeste.json'), octetsFerme);
  fs.writeFileSync(path.join(dossierFerme, 'manifeste.json.sig'), signer(octetsFerme));
  const racineFerme = path.join(dossierFerme, 'racine');
  const rl = await launcher(['--racine', racineFerme, '--pseudo', '_Floskyl_', '--manifeste', BASE + '/serveur_ferme/manifeste.json', '--cle-publique', CLE]);
  verifier('le serveur ne répond pas : « fermé pour le moment », rien téléchargé, le jeu pas lancé',
    rl.code === 1 && /Le serveur est fermé pour le moment, réessaie dans un instant\./.test(rl.sortie) && !fs.existsSync(path.join(racineFerme, 'jeu')),
    rl.sortie.slice(-300));

  // 6. Le pseudo vraiment entré : noté à part, sans toucher au reste des réglages.
  const racineP = path.join(ICI, 'racine_pseudo');
  fs.mkdirSync(racineP);
  R.enregistrerReglages(racineP, { pseudo: '_FloSkyl_', memoire_go: 3 });
  P.noterPseudoValide(racineP, '_Floskyl_');
  const lu = R.chargerReglages(racineP);
  verifier('pseudo entré noté à part : pseudo_valide, le pseudo et la mémoire gardés',
    lu.pseudo_valide === '_Floskyl_' && lu.pseudo === '_FloSkyl_' && lu.memoire_go === 3, JSON.stringify(lu));
}

// Au clic, un système trop ancien qui aurait échappé à la vérification : le chargeur refuse PortableMC avant sa
// première ligne. Un faux PortableMC (Node) écrit le vrai message du chargeur de Linux.
async function essaisSystemeAncien() {
  const R = require('../src/reglages');
  const { lancer } = require('../src/lancement');
  const { messageJoueur } = require('../src/partie');
  const message = "./portablemc: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found (required by ./portablemc)";
  const muet = { info() {}, avert() {} };
  const r = await lancer({ portablemc: process.execPath, args: ['-e', 'process.stderr.write(' + JSON.stringify(message + '\n') + '); process.exit(1)'], journal: muet });
  verifier('le message du chargeur (GLIBC_2.39 not found) est reconnu', r.code === 1 && r.glibcManquante === '2.39', JSON.stringify(r));
  verifier('le joueur lit la phrase « Ton Linux est trop ancien... »', messageJoueur({ code: 'systeme_trop_ancien' }) === R.TEXTE_LINUX_ANCIEN);
  const r2 = await lancer({ portablemc: process.execPath, args: ['-e', 'process.stderr.write("autre chose\\n"); process.exit(1)'], journal: muet });
  verifier('une autre erreur n\'est pas prise pour un Linux trop ancien', r2.code === 1 && !r2.glibcManquante, JSON.stringify(r2));
}

async function principal() {
  console.log('Essais du launcher dans ' + ICI);
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  const BASE = 'http://127.0.0.1:' + serveur.address().port;
  const CLE = path.join(ICI, 'cles', 'cle_publique.pem');
  const communs = ['--manifeste', BASE + '/hebergement/manifeste.json', '--cle-publique', CLE];

  console.log('\n1. Les clés et le manifeste de la mise en ligne 15');
  let r = await executer(path.join(LAUNCHER, 'outils', 'creer_cles.js'), [path.join(ICI, 'cles')]);
  verifier('paire de clés créée', r.code === 0, r.sortie);
  r = await executer(path.join(LAUNCHER, 'outils', 'fabriquer_manifeste.js'),
    ['--paquet', PAQUET, '--sortie', path.join(ICI, 'hebergement'), '--mise-en-ligne', '15',
      '--cle-privee', path.join(ICI, 'cles', 'cle_privee.pem')]);
  console.log(r.sortie.trim().split('\n').map(l => '         ' + l).join('\n'));
  verifier('manifeste fabriqué et signé', r.code === 0);
  const manifeste15 = JSON.parse(fs.readFileSync(path.join(ICI, 'hebergement', 'manifeste.json'), 'utf8'));
  const tiers = manifeste15.fichiers.filter(f => /^https:/.test(f.url));
  verifier('les 4 mods tiers pointent vers leur site officiel',
    tiers.length === 4 && tiers.every(f => f.url.startsWith('https://cdn.modrinth.com/')), tiers.map(f => f.url).join(' '));
  const heberges = fs.readdirSync(path.join(ICI, 'hebergement')).filter(n => /^[0-9a-f]{64}$/.test(n));
  verifier('nos fichiers hébergés à plat, chacun nommé par son empreinte (' + heberges.length + ')',
    heberges.length > 0 && heberges.every(n => sha256(path.join(ICI, 'hebergement', n)) === n));
  verifier("aucun mod tiers sur notre hébergement", !manifeste15.fichiers.some(f => /kubejs-neoforge|rhino-|LibX|SkyblockBuilder/.test(f.chemin) && !/^https:/.test(f.url)));
  verifier('casino_api.js absent du manifeste', !manifeste15.fichiers.some(f => /casino_api\.js$/.test(f.chemin)));
  const n15 = (manifeste15.nouvelles || [])[0] || { lignes: [] };
  const ecrites15 = fs.readFileSync(path.join(LAUNCHER, 'nouvelles', 'mise_en_ligne_15.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  verifier('« Ce qui change » vient des lignes écrites pour les joueurs (nouvelles/mise_en_ligne_15.txt)',
    JSON.stringify(n15.lignes) === JSON.stringify(ecrites15), JSON.stringify(n15.lignes));
  verifier('la nouvelle est datée par le LISEZMOI (25/09/2026, mise en ligne 15)',
    n15.mise_en_ligne === 15 && n15.date === '2026-09-25', JSON.stringify(n15).slice(0, 120));
  // Le secours : sans lignes écrites, l'extraction du LISEZMOI (sans mot de mise à jour à la main).
  fs.mkdirSync(path.join(ICI, 'sans_nouvelles'));
  r = await executer(path.join(LAUNCHER, 'outils', 'fabriquer_manifeste.js'), ['--paquet', PAQUET, '--sortie',
    path.join(ICI, 'secours'), '--mise-en-ligne', '15', '--sans-verifier-tiers', '--dossier-nouvelles', path.join(ICI, 'sans_nouvelles')]);
  const nv = ((JSON.parse(fs.readFileSync(path.join(ICI, 'secours', 'manifeste.json'), 'utf8')).nouvelles || [])[0] || { lignes: [] }).lignes;
  verifier('secours : l\'extraction du LISEZMOI donne 4 lignes propres, et le dit',
    /SECOURS/.test(r.sortie) && nv.length === 4 && nv.every(t => /^[A-ZÉ].*[^ ]\.$/.test(t) && !/OBLIGATOIRE|ne change|casino[a-z]* \d|\.minecraft|\.toml/.test(t)), JSON.stringify(nv));

  // Une retouche sans rien à annoncer (--sans-nouvelle, règle de Florian) : aucune ligne pour elle, l'historique reste,
  // et JAMAIS le LISEZMOI en secours (il peut parler de versions de mods).
  const dSans = path.join(ICI, 'sans_nouvelle');
  fs.mkdirSync(dSans);
  fs.copyFileSync(path.join(ICI, 'hebergement', 'manifeste.json'), path.join(dSans, 'manifeste.json'));
  r = await executer(path.join(LAUNCHER, 'outils', 'fabriquer_manifeste.js'), ['--paquet', PAQUET, '--sortie', dSans,
    '--mise-en-ligne', '16', '--sans-nouvelle', '--sans-verifier-tiers']);
  const nSans = JSON.parse(fs.readFileSync(path.join(dSans, 'manifeste.json'), 'utf8')).nouvelles || [];
  verifier('--sans-nouvelle : aucune ligne pour la 16, les nouvelles de la 15 restent en tête, pas de secours du LISEZMOI',
    r.code === 0 && !/SECOURS/.test(r.sortie) && !nSans.some(n => n.mise_en_ligne === 16) && nSans[0] && nSans[0].mise_en_ligne === 15,
    JSON.stringify(nSans.map(n => n.mise_en_ligne)) + ' ' + r.sortie.slice(-200));

  console.log('\n2. Première installation (dossier vide)');
  const racineA = path.join(ICI, 'racine_A');
  r = await launcher(['--racine', racineA, '--verifier-seulement'].concat(communs));
  console.log(r.sortie.trim().split('\n').slice(-3).map(l => '         ' + l).join('\n'));
  verifier('installation réussie', r.code === 0, r.sortie.slice(-500));
  const jeuA = path.join(racineA, 'jeu');
  let fautes = controlerJeu(jeuA, manifeste15);
  verifier('les ' + manifeste15.fichiers.length + ' fichiers en place, empreintes vérifiées', fautes.length === 0, fautes.slice(0, 5).join(', '));
  verifier('marqueur du launcher posé', fs.existsSync(path.join(jeuA, '.casteria-launcher')));
  verifier('options.txt du premier lancement posé', /lang:fr_fr/.test(fs.readFileSync(path.join(jeuA, 'options.txt'), 'utf8')));
  verifier('aucun fichier provisoire restant', fs.readdirSync(path.join(jeuA, '.telechargements')).length === 0);
  const kjs = sha256(path.join(jeuA, 'mods', 'kubejs-neoforge-2101.7.2-build.377.jar'));
  verifier('KubeJS pris sur Modrinth (source principale)', kjs.startsWith('df9a8458'), kjs);

  console.log('\n3. Deuxième passage : rien à télécharger');
  demandes.length = 0;
  r = await launcher(['--racine', racineA, '--verifier-seulement'].concat(communs));
  verifier('passage réussi', r.code === 0, r.sortie.slice(-300));
  verifier('0 téléchargé, 0 retiré', /233 vérifiés, 0 téléchargé, 0 retiré\./.test(r.sortie), r.sortie.slice(-300));
  verifier("un seul fichier demandé à l'hébergement : le fichier signé unique (manifeste et signature ensemble)",
    demandes.length === 1 && /manifeste\.signe\.json$/.test(demandes[0]), demandes.join(' '));

  console.log('\n4. Réparation : un fichier abîmé, un effacé, trois en trop, des options du joueur');
  fs.appendFileSync(path.join(jeuA, 'mods', 'casinoblocs-neoforge-1.5.15+1.21.1.jar'), 'x');
  fs.unlinkSync(path.join(jeuA, 'kubejs', 'startup_scripts', 'items.js'));
  fs.writeFileSync(path.join(jeuA, 'mods', 'casinoui-neoforge-1.4.2+1.21.1.jar'), 'ancienne version');
  fs.writeFileSync(path.join(jeuA, 'mods', 'triche.jar'), 'un mod ajouté');
  fs.writeFileSync(path.join(jeuA, 'kubejs', 'startup_scripts', 'casino_api.js'), '// pour le serveur');
  fs.appendFileSync(path.join(jeuA, 'options.txt'), 'fov:0.5\n');
  r = await launcher(['--racine', racineA, '--verifier-seulement'].concat(communs));
  verifier('passage réussi', r.code === 0, r.sortie.slice(-400));
  verifier('2 téléchargés, 3 retirés', /2 téléchargés, 3 retirés/.test(r.sortie), r.sortie.slice(-400));
  fautes = controlerJeu(jeuA, manifeste15);
  verifier('le dossier du jeu est de nouveau exact', fautes.length === 0, fautes.join(', '));
  verifier('les options du joueur sont gardées', /fov:0\.5/.test(fs.readFileSync(path.join(jeuA, 'options.txt'), 'utf8')));
  const retires = require('../src/synchro').listerFichiers(path.join(jeuA, '.retires'));
  verifier('les fichiers en trop sont rangés dans .retires (pas perdus)', retires.length === 3, retires.join(', '));

  console.log('\n5. Un manifeste modifié après sa signature, puis un manifeste sans signature');
  fs.mkdirSync(path.join(ICI, 'altere'));
  const brut = fs.readFileSync(path.join(ICI, 'hebergement', 'manifeste.json'), 'utf8');
  fs.writeFileSync(path.join(ICI, 'altere', 'manifeste.json'), brut.replace('"port": 25681', '"port": 25682'));
  fs.copyFileSync(path.join(ICI, 'hebergement', 'manifeste.json.sig'), path.join(ICI, 'altere', 'manifeste.json.sig'));
  const racineB = path.join(ICI, 'racine_B');
  r = await launcher(['--racine', racineB, '--verifier-seulement', '--manifeste', BASE + '/altere/manifeste.json', '--cle-publique', CLE]);
  verifier('manifeste modifié refusé', r.code === 1 && /signature du manifeste est fausse/.test(r.sortie), r.sortie.slice(-300));
  verifier('le joueur lit une phrase simple', /ne viennent pas de Casteria : rien n'a été installé/.test(r.sortie), r.sortie.slice(-300));
  verifier('rien installé', !fs.existsSync(path.join(racineB, 'jeu')));
  fs.unlinkSync(path.join(ICI, 'altere', 'manifeste.json.sig'));
  r = await launcher(['--racine', racineB, '--verifier-seulement', '--manifeste', BASE + '/altere/manifeste.json', '--cle-publique', CLE]);
  verifier('manifeste sans signature refusé', r.code === 1 && /pas signé/.test(r.sortie), r.sortie.slice(-300));

  // Le fichier signé unique modifié : refusé, même si l'ancien couple à côté est bon (on ne retombe pas dessus).
  copierDossier(path.join(ICI, 'hebergement'), path.join(ICI, 'enveloppe_alteree'));
  const envBrut = JSON.parse(fs.readFileSync(path.join(ICI, 'hebergement', 'manifeste.signe.json'), 'utf8'));
  envBrut.contenu = envBrut.contenu.replace('"port": 25681', '"port": 25682');
  fs.writeFileSync(path.join(ICI, 'enveloppe_alteree', 'manifeste.signe.json'), JSON.stringify(envBrut));
  r = await launcher(['--racine', racineB, '--verifier-seulement', '--manifeste', BASE + '/enveloppe_alteree/manifeste.json', '--cle-publique', CLE]);
  verifier("fichier signé unique modifié : refusé (l'ancien couple, bon, n'est pas pris à sa place)",
    r.code === 1 && /signature du manifeste est fausse/.test(r.sortie) && !fs.existsSync(path.join(racineB, 'jeu')), r.sortie.slice(-300));
  fs.writeFileSync(path.join(ICI, 'enveloppe_alteree', 'manifeste.signe.json'), '{ pas du json');
  r = await launcher(['--racine', racineB, '--verifier-seulement', '--manifeste', BASE + '/enveloppe_alteree/manifeste.json', '--cle-publique', CLE]);
  verifier('fichier signé unique illisible : refusé', r.code === 1 && /illisible/.test(r.sortie) && !fs.existsSync(path.join(racineB, 'jeu')), r.sortie.slice(-300));

  // Pendant que GitHub propage une nouvelle mise en ligne : le fichier signé unique est déjà le nouveau, l'ancien
  // couple mélange encore un manifeste et une signature de deux mises en ligne. Le launcher 1.0.3 installe quand même.
  copierDossier(path.join(ICI, 'hebergement'), path.join(ICI, 'melange'));
  fs.writeFileSync(path.join(ICI, 'melange', 'manifeste.json'), brut.replace('"port": 25681', '"port": 25682'));
  const racineM = path.join(ICI, 'racine_melange');
  r = await launcher(['--racine', racineM, '--verifier-seulement', '--manifeste', BASE + '/melange/manifeste.json', '--cle-publique', CLE]);
  verifier("ancien couple mélangé, fichier signé unique bon : installation réussie à partir du fichier signé unique",
    r.code === 0 && controlerJeu(path.join(racineM, 'jeu'), manifeste15).length === 0, r.sortie.slice(-300));

  console.log('\n6. Des manifestes signés mais dangereux');
  const dangers = [
    ['un chemin qui sort du dossier', m => { m.fichiers[0].chemin = 'mods/../../evil.txt'; }, /chemin dangereux/],
    ['un dossier que le launcher ne gère pas (saves)', m => { m.dossiers_geres.push('saves'); }, /ne gère pas : saves/],
    ['un fichier dans le dossier des mondes', m => { m.fichiers[0].chemin = 'saves/monde/level.dat'; }, /hors des dossiers autorisés/],
    ['une adresse locale absolue', m => { m.fichiers[0].url = 'C:/Windows/win.ini'; }, /adresse invalide/],
    ['des nouvelles qui ne sont pas du texte',
      m => { m.nouvelles = [{ mise_en_ligne: 1, date: '2026-09-25', lignes: [{ html: '<img src=x>' }] }]; }, /une nouvelle est invalide/],
  ];
  for (const [nom, changer, attendu] of dangers) {
    const m = JSON.parse(brut);
    changer(m);
    const dossier = path.join(ICI, 'danger_' + dangers.findIndex(d => d[0] === nom));
    fs.mkdirSync(dossier);
    const octets = Buffer.from(JSON.stringify(m, null, 2));
    fs.writeFileSync(path.join(dossier, 'manifeste.json'), octets);
    fs.writeFileSync(path.join(dossier, 'manifeste.json.sig'), signer(octets));
    const racine = path.join(dossier, 'racine');
    r = await launcher(['--racine', racine, '--verifier-seulement', '--manifeste',
      BASE + '/' + path.basename(dossier) + '/manifeste.json', '--cle-publique', CLE]);
    verifier(nom + ' : refusé', r.code === 1 && attendu.test(r.sortie), r.sortie.slice(-300));
    verifier(nom + ' : rien écrit', !fs.existsSync(path.join(racine, 'jeu')) && !fs.existsSync(path.join(ICI, 'evil.txt')));
  }

  console.log("\n7. L'hébergement sert un mauvais fichier");
  copierDossier(path.join(ICI, 'hebergement'), path.join(ICI, 'hebergement_casse'));
  const cible = manifeste15.fichiers.find(f => f.chemin === 'mods/casinoboss-neoforge-1.0.11+1.21.1.jar');
  const blob = path.join(ICI, 'hebergement_casse', ...cible.url.split('/'));
  const faux = fs.readFileSync(blob);
  faux[faux.length - 1] ^= 0xff;
  fs.writeFileSync(blob, faux);
  const racineC = path.join(ICI, 'racine_C');
  r = await launcher(['--racine', racineC, '--verifier-seulement', '--manifeste', BASE + '/hebergement_casse/manifeste.json', '--cle-publique', CLE]);
  verifier('mise à jour refusée', r.code === 1 && /casinoboss/.test(r.sortie) && /empreinte fausse/.test(r.sortie), r.sortie.slice(-400));
  verifier('le joueur lit « fichier abîmé », pas « vérifie ta connexion »', /Un fichier est arrivé abîmé/.test(r.sortie), r.sortie.slice(-400));
  verifier('le fichier faux n\'est pas installé', !fs.existsSync(path.join(racineC, 'jeu', 'mods', 'casinoboss-neoforge-1.0.11+1.21.1.jar')));
  verifier('aucun fichier provisoire restant', fs.readdirSync(path.join(racineC, 'jeu', '.telechargements')).length === 0);

  console.log("\n8. Un dossier qui n'a pas été créé par le launcher (un .minecraft par erreur)");
  const racineD = path.join(ICI, 'racine_D');
  fs.mkdirSync(path.join(racineD, 'jeu', 'mods'), { recursive: true });
  fs.writeFileSync(path.join(racineD, 'jeu', 'mods', 'mod_du_joueur.jar'), 'à ne pas toucher');
  r = await launcher(['--racine', racineD, '--verifier-seulement'].concat(communs));
  verifier('refusé', r.code === 1 && /ne viennent pas du launcher/.test(r.sortie), r.sortie.slice(-300));
  verifier('le mod du joueur est intact', fs.readFileSync(path.join(racineD, 'jeu', 'mods', 'mod_du_joueur.jar'), 'utf8') === 'à ne pas toucher');
  verifier('rien ajouté', fs.readdirSync(path.join(racineD, 'jeu', 'mods')).length === 1);

  const recent = casinouiRecent();
  console.log('\n9. Une mise à jour (mise en ligne simulée : casinoui 1.4.4 remplacé par ' + (recent ? path.basename(recent) : '?') + ')');
  if (recent) {
    const paquet16 = path.join(ICI, 'paquet_simule');
    copierDossier(PAQUET, paquet16);
    fs.renameSync(path.join(paquet16, 'mods', 'casinoui-neoforge-1.4.4+1.21.1.jar'), path.join(ICI, 'casinoui_1.4.4_mis_de_cote.jar'));
    fs.copyFileSync(recent, path.join(paquet16, 'mods', path.basename(recent)));
    r = await executer(path.join(LAUNCHER, 'outils', 'fabriquer_manifeste.js'),
      ['--paquet', paquet16, '--sortie', path.join(ICI, 'hebergement'), '--mise-en-ligne', '99',
        '--cle-privee', path.join(ICI, 'cles', 'cle_privee.pem'), '--sans-verifier-tiers']);
    verifier('manifeste 99 fabriqué', r.code === 0, r.sortie);
    verifier('1 seul nouveau fichier copié sur l\'hébergement', /1 fichier\(s\) nouveau\(x\) copié/.test(r.sortie), r.sortie);
    demandes.length = 0;
    r = await launcher(['--racine', racineA, '--verifier-seulement'].concat(communs));
    verifier('mise à jour réussie', r.code === 0, r.sortie.slice(-400));
    verifier('1 téléchargé, 1 retiré (le vieux casinoui)', /1 téléchargé, 1 retiré\./.test(r.sortie) && /casinoui-neoforge-1\.4\.4/.test(r.sortie), r.sortie.slice(-400));
    const m99 = JSON.parse(fs.readFileSync(path.join(ICI, 'hebergement', 'manifeste.json'), 'utf8'));
    fautes = controlerJeu(jeuA, m99);
    verifier('le dossier du jeu correspond à la mise en ligne 99', fautes.length === 0, fautes.join(', '));
    verifier('un seul fichier demandé en plus du manifeste', demandes.filter(d => /\/[0-9a-f]{64}$/.test(d)).length === 1, demandes.join(' '));
  } else console.log('  (sauté : aucun autre casinoui dans ' + MODS_SERVEURMC + ')');

  console.log("\n9 bis. Pas d'internet (l'hébergement ne répond pas)");
  r = await launcher(['--racine', path.join(ICI, 'racine_F'), '--verifier-seulement',
    '--manifeste', 'http://127.0.0.1:1/manifeste.json', '--cle-publique', CLE]);
  verifier('refusé avec une phrase simple', r.code === 1 && /Impossible de joindre le serveur des mises à jour/.test(r.sortie), r.sortie);
  verifier('rien installé', !fs.existsSync(path.join(ICI, 'racine_F', 'jeu')));

  console.log('\n10. Pseudo et mémoire refusés');
  r = await launcher(['--racine', path.join(ICI, 'racine_E'), '--pseudo', 'Flo rian', '--verifier-seulement'].concat(communs));
  verifier('pseudo avec une espace refusé', r.code === 1 && /lettres sans accent/.test(r.sortie), r.sortie);
  r = await launcher(['--racine', path.join(ICI, 'racine_E'), '--pseudo', 'Élodie', '--verifier-seulement'].concat(communs));
  verifier('pseudo avec un accent refusé', r.code === 1 && /lettres sans accent/.test(r.sortie), r.sortie);
  r = await launcher(['--racine', path.join(ICI, 'racine_E'), '--memoire', '1', '--verifier-seulement'].concat(communs));
  verifier('mémoire de 1 Go refusée', r.code === 1 && /entre 2 et 16 Go/.test(r.sortie), r.sortie);

  console.log('\n11. PortableMC en --dry sur une installation déjà faite (aucun Java lancé)');
  const installe = path.join(COMMUN, 'versions', 'neoforge-21.1.251', 'neoforge-21.1.251.json');
  if (fs.existsSync(installe)) {
    r = await launcher(['--racine', racineA, '--pseudo', 'TestFlo', '--commun', COMMUN, '--dry'].concat(communs));
    console.log(r.sortie.trim().split('\n').slice(-4).map(l => '         ' + l).join('\n'));
    verifier('--dry réussi', r.code === 0 && /Tout est prêt/.test(r.sortie), r.sortie.slice(-500));
    const journaux = fs.readdirSync(path.join(racineA, 'journaux')).sort();
    const dernier = fs.readFileSync(path.join(racineA, 'journaux', journaux[journaux.length - 1]), 'utf8');
    verifier('la commande entre directement sur le serveur',
      /--join-server gm52-dc02\.ouiheberg\.com --join-server-port 25681/.test(dernier), '');
    verifier('Java de Mojang seulement (--jvm-policy mojang)', /--jvm-policy mojang/.test(dernier) && /loaded_jvm/.test(dernier));
    const version = JSON.parse(fs.readFileSync(path.join(LAUNCHER, 'package.json'), 'utf8')).version;
    verifier('le jeu reçoit la marque « Casteria » (pas « portablemc »)',
      dernier.includes('-Dminecraft.launcher.brand=Casteria,-Dminecraft.launcher.version=' + version), '');
    verifier('le jeu tourne dans le dossier du launcher', dernier.includes('--mc-dir ' + jeuA));
    verifier("le jeu n'a pas été lancé", !/\tlaunched\t/.test(dernier) && !/\[portablemc\] launched/.test(dernier));
  } else console.log('  (sauté : NeoForge pas installé dans ' + COMMUN + ', il faudrait lancer Java)');

  console.log('\n12. La publication sur un faux GitHub local (le vrai dépôt n\'est jamais touché)');
  await essaisPublication(CLE);

  console.log("\n13. L'état du serveur en direct (un faux serveur Minecraft local)");
  await essaisEtatServeur();

  console.log('\n14. La mise à jour du code du launcher et le choix de l\'amorce');
  await essaisCodeLauncher(BASE, CLE);

  console.log('\n15. Mac et Linux, simulés (dossiers, PortableMC par processeur, droits, chemins)');
  essaisPlateformes();
  await essaisSystemeAncien();

  console.log('\n16. La surveillance de la partie : jamais les menus de Minecraft (raisons, sonde, fermeture, ping, pseudo entré)');
  await essaisSurveillance(BASE, CLE);

  serveur.close();
  console.log('\n' + reussis + ' vérifications réussies, ' + echecs.length + ' échec(s).' +
    (echecs.length ? '\nÉchecs : ' + echecs.join(' | ') : ''));
  return echecs.length ? 1 : 0;
}

principal().then(c => { process.exitCode = c; }, e => { console.error(e); serveur.close(); process.exitCode = 1; });
