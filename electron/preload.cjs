// Bridge to the local save file managed by the main process. This is the one
// thing that makes user data origin-independent: every window — whether it
// loaded app:// (packaged) or the localhost dev server — talks to the SAME main
// process, so they all read/write one shared save.json. In a plain browser
// (`npm run dev` opened in Safari/Chrome) this bridge is absent, and the app
// falls back to IndexedDB-only (debug; not persisted to the file).

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jpStore", {
  load: () => ipcRenderer.invoke("jpstore:load"),
  save: (snapshot) => ipcRenderer.invoke("jpstore:save", snapshot),
  reveal: () => ipcRenderer.invoke("jpstore:reveal"),
});
