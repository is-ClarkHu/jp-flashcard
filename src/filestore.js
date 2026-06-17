// Local-file persistence for the Electron app.
//
// The renderer keeps using IndexedDB as its live working store (so the rest of
// the app is unchanged). This module mirrors the WHOLE database to one
// origin-independent save.json — via the preload `jpStore` bridge — and restores
// from it on boot. That makes "where did my progress go?" impossible: the file
// is the source of truth, shared by every window no matter how it was launched.
//
// In a plain browser the bridge is absent, so every export here is a no-op and
// the app runs IndexedDB-only (debug; surfaced in the Accounts settings pane).

import {
  exportStores,
  importStores,
  listSaves,
  replaceSaves,
  setWriteHook,
  suppressWriteHook,
  getSyncMarker,
  setSyncMarker,
} from "./db.js";
import { getSettings, setSettings } from "./settings.js";
import { persistActive } from "./accounts.js";

const bridge = typeof window !== "undefined" ? window.jpStore : null;
const SCHEMA = 1;
const DEBOUNCE_MS = 1500;

export function isFileBacked() {
  return !!bridge;
}

let timer = null;
let inFlight = false;

// A full, file-shaped snapshot. apiKeys are stripped — keys live only in this
// machine's localStorage, never in the portable file. explain_cache is dropped
// (regenerable, and would bloat the file).
async function buildSnapshot() {
  await persistActive(); // flush live working set → active account record
  const settings = { ...getSettings() };
  delete settings.apiKeys;
  return {
    schemaVersion: SCHEMA,
    savedAt: new Date().toISOString(),
    settings,
    saves: await listSaves(),
    live: await exportStores(["explain_cache"]),
  };
}

async function doSave() {
  if (!bridge) return;
  if (inFlight) {
    scheduleSave(); // coalesce: try again after the in-flight write finishes
    return;
  }
  inFlight = true;
  clearTimeout(timer);
  timer = null;
  try {
    // Suppress the write hook while we build the snapshot: persistActive() writes
    // to `saves`, which would otherwise schedule another save → endless loop.
    suppressWriteHook(true);
    const snap = await buildSnapshot();
    suppressWriteHook(false);
    const ok = await bridge.save(snap);
    if (ok) {
      suppressWriteHook(true);
      await setSyncMarker(snap.savedAt);
      suppressWriteHook(false);
    }
  } catch (e) {
    console.error("[filestore] save failed:", e);
  } finally {
    suppressWriteHook(false);
    inFlight = false;
  }
}

// Debounced: called from db.js after any durable write.
export function scheduleSave() {
  if (!bridge) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    doSave();
  }, DEBOUNCE_MS);
}

// Immediate flush (window hide / "Back up now" button).
export async function flushNow() {
  if (!bridge) return;
  await doSave();
}

// Boot reconcile: the file is authoritative when it is present, valid, and at
// least as new as the marker we stored after our last successful write. We never
// let a missing/broken/empty file clobber existing IndexedDB data. Run this
// BEFORE ensureActive(), so the restored accounts + activeAccountId are in place.
export async function bootReconcile() {
  if (!bridge) return; // browser/debug: IndexedDB-only, nothing to reconcile
  let file = null;
  try {
    file = await bridge.load();
  } catch (e) {
    console.error("[filestore] load failed:", e);
  }

  const valid = file && file.schemaVersion && file.savedAt && file.live;
  if (!valid) {
    // No usable file yet → seed it from whatever is currently in IndexedDB
    // (empty for a fresh install; current data on the first upgraded launch).
    await flushNow();
    setWriteHook(scheduleSave);
    return;
  }

  const marker = await getSyncMarker();
  if (!marker || file.savedAt >= marker) {
    // File is the source of truth → restore it into the live database.
    await importStores(file.live, "replace");
    await replaceSaves(file.saves || []);
    const local = getSettings();
    setSettings({ ...(file.settings || {}), apiKeys: local.apiKeys }); // keep local keys
    await setSyncMarker(file.savedAt);
  } else {
    // Local is newer than the file (e.g. a prior write failed) → rewrite it.
    await flushNow();
  }
  setWriteHook(scheduleSave);
}
