'use strict';
// Le bon PortableMC 5.0.5 pour le système et le processeur (a7).
//   Dans le projet : bin/<système>-<processeur>/portablemc[.exe] (win32-x64, linux-x64, darwin-x64, darwin-arm64),
//     avec bin/empreintes.json (sha256 relevés après vérification des signatures PGP de PortableMC).
//   Dans l'application installée : resources/bin/portablemc[.exe] (et resources/bin/empreintes.json si présent).
// Sous Mac et Linux, le binaire est RECOPIÉ dans le dossier du launcher (<racine>/bin/portablemc) et marqué
// exécutable (chmod 755) : un AppImage est monté en lecture seule, et les droits Unix se perdent quand le paquet est
// fabriqué depuis Windows. La copie est écrite octet par octet (jamais copyFile), pour ne pas emporter d'attribut de
// quarantaine du Mac. Sous Windows, il est utilisé en place (comme l'installateur 1.0.0 publié).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const nomBinaire = plateforme => (plateforme === 'win32' ? 'portablemc.exe' : 'portablemc');
const dossierBinaire = (plateforme, arch) => plateforme + '-' + arch;
const cheminsDe = plateforme => (plateforme === 'win32' ? path.win32 : path.posix);

// Où est le binaire livré : dans l'application installée, ou dans le projet (développement).
function cheminLivre({ installe, resources, projet, plateforme = process.platform, arch = process.arch }) {
  const p = cheminsDe(plateforme);
  return installe ? p.join(resources, 'bin', nomBinaire(plateforme)) : p.join(projet, 'bin', dossierBinaire(plateforme, arch), nomBinaire(plateforme));
}

function sha256(octets) { return crypto.createHash('sha256').update(octets).digest('hex'); }

// Rend le chemin à exécuter. Vérifie l'empreinte si la liste est livrée à côté (sinon : ancienne installation).
function preparer({ livre, racine, plateforme = process.platform, arch = process.arch, empreintes = null }) {
  if (!fs.existsSync(livre)) {
    const e = new Error('PortableMC introuvable : ' + livre);
    e.code = 'portablemc_absent';
    throw e;
  }
  const octets = fs.readFileSync(livre);
  if (empreintes && empreintes.fichiers) {
    const attendu = empreintes.fichiers[dossierBinaire(plateforme, arch) + '/' + nomBinaire(plateforme)];
    if (attendu && attendu.sha256 !== sha256(octets)) {
      const e = new Error("PortableMC livré n'a pas l'empreinte attendue : " + livre);
      e.code = 'portablemc_abime';
      throw e;
    }
  }
  if (plateforme === 'win32') return livre;
  const p = cheminsDe(plateforme);
  const dossier = p.join(racine, 'bin');
  const cible = p.join(dossier, nomBinaire(plateforme));
  let aJour = false;
  try { aJour = sha256(fs.readFileSync(cible)) === sha256(octets); } catch (e) { /* à poser */ }
  if (!aJour) {
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(cible + '.tmp', octets, { mode: 0o755 });
    fs.renameSync(cible + '.tmp', cible);
  }
  fs.chmodSync(cible, 0o755);
  return cible;
}

// La liste des empreintes livrée à côté du binaire, si elle existe.
function lireEmpreintes(livre) {
  try { return JSON.parse(fs.readFileSync(path.join(path.dirname(livre), 'empreintes.json'), 'utf8')); } catch (e) {
    try { return JSON.parse(fs.readFileSync(path.join(path.dirname(livre), '..', 'empreintes.json'), 'utf8')); } catch (e2) { return null; }
  }
}

module.exports = { nomBinaire, dossierBinaire, cheminLivre, preparer, lireEmpreintes };
