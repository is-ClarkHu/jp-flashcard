// No privileged APIs are exposed: the app is fully client-side (IndexedDB for
// user data, the bundled library for content). This file exists so contextIsolation
// has a preload to load; add contextBridge exposures here later if ever needed.
