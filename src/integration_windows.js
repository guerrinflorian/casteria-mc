'use strict';
// L'intégration à Windows (a7), à chaque démarrage de l'application installée. L'installateur publié ne change pas
// (réputation SmartScreen) : c'est le CODE qui corrige ce que l'installateur a posé (demande de Florian, 25/09) :
// - les raccourcis du Bureau, du menu Démarrer et de la barre des tâches (s'ils pointent vers CE launcher) : la
//   description au survol devient celle de DESCRIPTION, et l'icône, la nouvelle, nette à toutes les tailles ;
// - l'inscription de désinstallation (HKCU, sans droits d'administrateur) : la description, l'icône et la version.
// L'icône est recopiée dans <racine>/icones/casteria-<empreinte>.ico : un chemin stable (le code change de dossier à
// chaque version) et neuf quand elle change (Windows garde en cache l'icône d'un chemin déjà vu).
// Ce qui reste gravé dans Casteria.exe (son icône interne, visible dans le Gestionnaire des tâches) ne peut changer
// qu'avec un nouvel installateur. Module propre à Windows (win32) : ses chemins du registre gardent leurs « \ ».
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const NOM = 'Casteria';
// Le texte de Florian (25/09, par 5b) : simple, sans aucun nombre. Le même dans package.json et le .desktop de Linux.
const DESCRIPTION = 'Casteria, un serveur Skyblock moddé : ton île, tes machines et des boss à affronter.';
// La clé que l'installateur (electron-builder, appId fr.casteria.launcher) écrit pour l'utilisateur : elle est la même
// sur tous les PC (dérivée de l'appId). On vérifie son nom affiché avant d'y écrire.
const CLE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\aaca0423-0cee-5ff4-ba19-e381bf52b75e';

function reg(args) {
  return new Promise(ok => {
    execFile('reg', args, { windowsHide: true, timeout: 10000 }, (e, sortie) => ok({ ok: !e, sortie: String(sortie || '') }));
  });
}

function iconeStable(racine, source) {
  const octets = fs.readFileSync(source);
  const nom = 'casteria-' + crypto.createHash('sha256').update(octets).digest('hex').slice(0, 12) + '.ico';
  const dossier = path.join(racine, 'icones');
  const cible = path.join(dossier, nom);
  if (!fs.existsSync(cible)) {
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(cible + '.tmp', octets);
    fs.renameSync(cible + '.tmp', cible);
  }
  return { cible, dossier, nom };
}

// shell : celui d'Electron (readShortcutLink, writeShortcutLink) ; chemins : ceux d'app.getPath.
async function integrer({ shell, racine, exe, iconeSource, version, bureau, appData, journal, cle = CLE }) {
  const ico = iconeStable(racine, iconeSource);
  const faits = [];

  const raccourcis = [
    path.join(bureau, NOM + '.lnk'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', NOM + '.lnk'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', NOM + '.lnk'),
  ];
  for (const r of raccourcis) {
    if (!fs.existsSync(r)) continue;
    let l;
    try { l = shell.readShortcutLink(r); } catch (e) { continue; }
    // Seulement nos raccourcis : ceux qui lancent CE launcher.
    if (!l.target || path.resolve(l.target).toLowerCase() !== path.resolve(exe).toLowerCase()) continue;
    if (l.description === DESCRIPTION && l.icon === ico.cible) continue;
    const ok = shell.writeShortcutLink(r, 'update', { description: DESCRIPTION, icon: ico.cible, iconIndex: 0 });
    faits.push((ok ? 'raccourci corrigé : ' : 'raccourci NON corrigé : ') + r);
  }

  // L'inscription de désinstallation : seulement si c'est bien la nôtre.
  const lu = await reg(['query', cle, '/v', 'DisplayName']);
  if (lu.ok && /Casteria/.test(lu.sortie)) {
    // reg.exe répond dans l'encodage de la console (le « ç » y est illisible) : on compare la partie sans accent.
    const ascii = s => s.replace(/[^\x20-\x7e]/g, '');
    for (const [nomValeur, valeur] of [['Comments', DESCRIPTION], ['DisplayIcon', ico.cible], ['DisplayVersion', version]]) {
      const q = await reg(['query', cle, '/v', nomValeur]);
      if (q.ok && ascii(q.sortie).includes(ascii(valeur))) continue;
      const w = await reg(['add', cle, '/v', nomValeur, '/t', 'REG_SZ', '/d', valeur, '/f']);
      faits.push((w.ok ? 'inscription corrigée : ' : 'inscription NON corrigée : ') + nomValeur);
    }
  }

  // Les anciennes icônes, qui ne servent plus.
  for (const n of fs.readdirSync(ico.dossier)) {
    if (/^casteria-[0-9a-f]{12}\.ico$/.test(n) && n !== ico.nom) {
      try { fs.unlinkSync(path.join(ico.dossier, n)); } catch (e) { /* encore affichée : partira la fois suivante */ }
    }
  }
  if (journal) journal.info('intégration Windows : ' + (faits.length ? faits.join(' ; ') : 'déjà à jour'));
  return faits;
}

module.exports = { DESCRIPTION, CLE, integrer, iconeStable };
