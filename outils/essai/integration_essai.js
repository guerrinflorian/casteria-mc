'use strict';
// Essai de l'intégration à Windows (src/integration_windows.js) DANS Electron (shell.readShortcutLink et
// writeShortcutLink n'existent que là), sur un Bureau d'essai et une clé de registre d'essai (HKCU\Software\
// CasteriaEssai\...), effacée à la fin. Ne touche ni aux vrais raccourcis ni à la vraie inscription.
// Usage : node_modules/.bin/electron outils/essai/integration_essai.js
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const I = require('../../src/integration_windows');

const PROJET = path.join(__dirname, '..', '..');
const ICI = path.join(PROJET, 'essais', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-integration');
const CLE = 'HKCU\\Software\\CasteriaEssai\\Uninstall\\essai';
const res = [];
const ok = (nom, v, d) => res.push((v ? 'OK     ' : 'ÉCHEC  ') + nom + (v ? '' : ' : ' + d));
const reg = a => { try { return execFileSync('reg', a, { encoding: 'latin1' }); } catch (e) { return ''; } };

app.whenReady().then(async () => {
  try {
    const bureau = path.join(ICI, 'bureau');
    const appData = path.join(ICI, 'appdata');
    const menu = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    for (const d of [bureau, menu]) fs.mkdirSync(d, { recursive: true });
    const exe = path.join(ICI, 'programme', 'Casteria.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.copyFileSync(process.execPath, exe);
    const autre = process.execPath;
    const ancien = 'Le launcher de Casteria : met à jour les fichiers du serveur, puis lance le jeu avec PortableMC.';
    shell.writeShortcutLink(path.join(bureau, 'Casteria.lnk'), 'create', { target: exe, description: ancien, icon: exe, iconIndex: 0 });
    shell.writeShortcutLink(path.join(menu, 'Casteria.lnk'), 'create', { target: exe, description: ancien, icon: exe, iconIndex: 0 });
    // Un raccourci « Casteria » vers UN AUTRE programme : il ne doit pas être touché.
    fs.mkdirSync(path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'), { recursive: true });
    const autreLnk = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'Casteria.lnk');
    shell.writeShortcutLink(autreLnk, 'create', { target: autre, description: 'un autre programme' });
    reg(['add', CLE, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'Casteria', '/f']);
    reg(['add', CLE, '/v', 'Comments', '/t', 'REG_SZ', '/d', ancien, '/f']);
    reg(['add', CLE, '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', '1.0.0', '/f']);

    const racine = path.join(ICI, 'racine');
    const params = { shell, racine, exe, iconeSource: path.join(PROJET, 'electron', 'icones', 'casteria.ico'), version: '1.0.1', bureau, appData, cle: CLE };
    const faits1 = await I.integrer(params);
    const b = shell.readShortcutLink(path.join(bureau, 'Casteria.lnk'));
    const m = shell.readShortcutLink(path.join(menu, 'Casteria.lnk'));
    const icones = fs.readdirSync(path.join(racine, 'icones'));
    ok('Bureau : description = I.DESCRIPTION', b.description === I.DESCRIPTION, b.description);
    ok('Bureau : icône = la nouvelle, dans le dossier du launcher', /casteria-[0-9a-f]{12}\.ico$/.test(b.icon) && fs.existsSync(b.icon) && b.icon.startsWith(racine), b.icon);
    ok('Bureau : la cible reste le launcher', path.resolve(b.target).toLowerCase() === exe.toLowerCase(), b.target);
    ok('menu Démarrer corrigé aussi', m.description === I.DESCRIPTION && m.icon === b.icon, JSON.stringify(m));
    const a = shell.readShortcutLink(autreLnk);
    ok("un raccourci vers un AUTRE programme n'est pas touché", a.description === 'un autre programme', a.description);
    const lu = reg(['query', CLE]);
    ok('inscription : description, icône et version corrigées',
      /Casteria, un serveur Skyblock modd/.test(lu) && lu.includes(b.icon) && /DisplayVersion\s+REG_SZ\s+1\.0\.1/.test(lu), lu);
    ok('une seule icône rangée', icones.length === 1, icones.join(','));
    const faits2 = await I.integrer(params);
    ok('au démarrage suivant : rien à refaire', faits2.length === 0, faits2.join(' ; '));
    console.log('Premier passage : ' + faits1.join(' ; '));
  } catch (e) {
    ok('essai sans erreur', false, e.stack);
  } finally {
    reg(['delete', 'HKCU\\Software\\CasteriaEssai', '/f']);
    ok("clé d'essai effacée", reg(['query', 'HKCU\\Software\\CasteriaEssai']) === '', 'encore là');
    console.log(res.join('\n'));
    app.exit(res.some(l => l.startsWith('ÉCHEC')) ? 1 : 0);
  }
});
