'use strict';
// Lance le jeu par PortableMC en sortie « machine » : une ligne par événement, les valeurs séparées par des tabulations
// (portablemc --help : « using tab ('\t', 0x09) separated values where the first value defines which kind of data »).
// Attention : PortableMC n'échappe que les retours à la ligne et les tabulations, pas la barre oblique inverse. Un
// chemin Windows comme « mc\natives » serait donc mal lu si on « dé-échappait » : on ne le fait pas.
const { spawn } = require('child_process');

function argumentsJeu({ commun, jeu, memoireGo, pseudo, neoforge, serveur, dry, marque }) {
  // La marque du launcher que voit le jeu (ses rapports de plantage) : « Casteria », pas « portablemc ». Ces réglages
  // viennent APRÈS ceux de PortableMC, et Java garde le dernier (vérifié le 25/09).
  const jvm = ['-Xmx' + memoireGo + 'G'];
  if (marque) jvm.push('-Dminecraft.launcher.brand=' + marque.nom, '-Dminecraft.launcher.version=' + marque.version);
  // La sortie du jeu en UTF-8 (Java 21) : sous Windows, elle suivait la page de code du système (cp1252). « ✦ »
  // devenait « ? », et PortableMC laissait tomber toute ligne accentuée (pas de l'UTF-8), dont la raison d'un renvoi
  // du serveur (« Tu n'as pas entré ton mot de passe à temps. », course 1.0.5 du 25/09).
  jvm.push('-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8');
  const a = [
    '--output', 'machine', 'start',
    '--main-dir', commun,
    '--mc-dir', jeu,
    // Toujours le Java de Mojang, téléchargé dans le dossier commun : jamais un vieux Java du PC.
    '--jvm-policy', 'mojang',
    '--jvm-arg=' + jvm.join(','),
    '-u', pseudo,
  ];
  if (serveur) a.push('--join-server', serveur.adresse, '--join-server-port', String(serveur.port));
  if (dry) a.push('--dry');
  a.push('neoforge::' + neoforge);
  return a;
}

function nombre(paire, i) {
  const n = Number(String(paire || '').split('/')[i]);
  return Number.isFinite(n) ? n : 0;
}

function lancer({ portablemc, args, signal = () => {}, journal, surLigneJeu = () => {} }) {
  return new Promise((ok, ko) => {
    let enfant;
    try {
      enfant = spawn(portablemc, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      ko(Object.assign(new Error('Impossible de démarrer PortableMC : ' + e.message), { code: 'portablemc_absent' }));
      return;
    }
    const res = { code: null, pidJeu: null, codeJeu: null, erreurs: [], java: null };
    let reste = '';

    function traiter(ligne) {
      if (!ligne) return;
      const v = ligne.split('\t');
      const code = v[0];
      switch (code) {
        case 'download':
          signal({
            type: 'telechargement_jeu', fait: nombre(v[1], 0), total: nombre(v[1], 1),
            octets: nombre(v[2], 0), octetsTotal: nombre(v[2], 1), vitesse: Number(v[4]) || 0,
          });
          return;
        case 'resources_downloaded':
          signal({ type: 'telechargement_jeu_fini' });
          break;
        case 'neoforge_installing':
          signal({ type: 'installation_neoforge', raison: v[1] });
          break;
        case 'neoforge_installer_processor':
          signal({ type: 'etape_neoforge', nom: v[1], tache: v[2] || '' });
          break;
        case 'neoforge_installed':
          signal({ type: 'neoforge_installe' });
          break;
        case 'loaded_jvm':
          res.java = v[2] || '';
          signal({ type: 'java', version: res.java });
          break;
        case 'launching':
          signal({ type: 'lancement' });
          break;
        case 'launched':
          res.pidJeu = Number(v[1]) || null;
          signal({ type: 'jeu_lance', pid: res.pidJeu });
          break;
        case 'terminated':
          res.codeJeu = Number(v[1]);
          signal({ type: 'jeu_ferme', code: res.codeJeu });
          break;
        case 'log_xml':
          // niveau, heure, logger, fil, message : le journal du jeu va dans notre journal, pas à l'écran, et à la
          // surveillance de la partie (surveillance.js)
          journal.info('[jeu] [' + v[1] + '] [' + v[4] + '] ' + (v[5] || ''));
          // « _stdout_ » : une ligne brute de la sortie du jeu (NeoForge écrit en texte, pas en XML). Un message sur
          // plusieurs lignes y arrive en plusieurs lignes.
          surLigneJeu(v[5] || '', { brute: v[4] === '_stdout_' });
          return;
        case 'log_raw':
          journal.info('[jeu] ' + (v[1] || ''));
          surLigneJeu(v[1] || '', { brute: true });
          return;
        default:
          if (code.startsWith('error_')) {
            res.erreurs.push(ligne);
            signal({ type: 'erreur_portablemc', code, valeurs: v.slice(1) });
          } else if (code.startsWith('warn_')) {
            journal.avert('[portablemc] ' + ligne.slice(0, 500));
            return;
          }
      }
      journal.info('[portablemc] ' + ligne.slice(0, 500));
    }

    enfant.stdout.setEncoding('utf8');
    enfant.stdout.on('data', d => {
      reste += d;
      let i;
      while ((i = reste.indexOf('\n')) >= 0) {
        traiter(reste.slice(0, i).replace(/\r$/, ''));
        reste = reste.slice(i + 1);
      }
    });
    enfant.stderr.setEncoding('utf8');
    enfant.stderr.on('data', d => {
      journal.info('[stderr] ' + d.trimEnd());
      // Linux : le PortableMC officiel demande glibc 2.39 (relevé par cc le 25/09). Sur un système plus ancien, c'est le
      // chargeur du système qui refuse, avant la moindre ligne de PortableMC : « version `GLIBC_2.39' not found ».
      const m = /GLIBC_(2\.\d+)'? not found/.exec(d);
      if (m) res.glibcManquante = m[1];
    });
    enfant.on('error', e => {
      ko(Object.assign(new Error('Impossible de démarrer PortableMC : ' + e.message), { code: 'portablemc_absent' }));
    });
    enfant.on('close', code => {
      if (reste) traiter(reste.replace(/\r$/, ''));
      res.code = code;
      ok(res);
    });
  });
}

module.exports = { argumentsJeu, lancer };
