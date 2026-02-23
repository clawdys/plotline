/**
 * Plotline — Electron Preload Script
 *
 * Exposes minimal Electron APIs to the renderer process via contextBridge.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('plotline', {
  isElectron: true,
  platform: process.platform,
  arch: process.arch,
});
