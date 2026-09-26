'use strict';
// Le seul passage entre la page et le launcher : ces demandes et un canal de signaux, rien d'autre.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('casteria', {
  etat: () => ipcRenderer.invoke('etat'),
  apercu: () => ipcRenderer.invoke('apercu'),
  etatServeur: () => ipcRenderer.invoke('etat-serveur'),
  verifierPseudo: pseudo => ipcRenderer.invoke('verifier-pseudo', pseudo),
  enregistrerReglages: demande => ipcRenderer.invoke('enregistrer-reglages', demande),
  jouer: () => ipcRenderer.invoke('jouer'),
  ouvrirDossier: quoi => ipcRenderer.invoke('ouvrir-dossier', quoi),
  reduire: () => ipcRenderer.invoke('reduire'),
  fermer: () => ipcRenderer.invoke('fermer'),
  redemarrer: () => ipcRenderer.invoke('redemarrer'),
  ouvrirInstallateur: () => ipcRenderer.invoke('ouvrir-installateur'),
  surSignal: rappel => { ipcRenderer.on('signal', (e, s) => rappel(s)); },
});
