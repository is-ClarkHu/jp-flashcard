// Progress migration (§4.8). Export ALL dynamic user data + settings into one
// timestamped JSON file; import it on another machine (merge or replace).
// The word library is NOT included — it ships with the app package.
// A named profile travels with the data; imports record their timestamp.

import { exportStores, importStores, putSave, listSaves } from "./db.js";
import { getSettings, setSettings, setSetting } from "./settings.js";

const APP = "jp-flashcard";

// --- local save slots (game-style) ---------------------------------------

async function snapshot() {
  const settings = { ...getSettings() };
  delete settings.apiKeys; // keys stay on this device only
  return { settings, stores: await exportStores() };
}

export async function createSave(name) {
  const snap = await snapshot();
  const counts = {
    favorites: (snap.stores.favorites || []).length,
    wrong_book: (snap.stores.wrong_book || []).length,
    rounds: (snap.stores.rounds || []).length,
  };
  const rec = {
    id: `${Date.now()}`,
    name: name || "(unnamed)",
    created_at: new Date().toISOString(),
    counts,
    ...snap,
  };
  await putSave(rec);
  return rec;
}

// Load a slot. mode "replace" (default) wipes current then restores; "merge" adds.
export async function loadSave(id, mode = "replace") {
  const rec = (await listSaves()).find((s) => s.id === id);
  if (!rec) throw new Error("Save not found");
  await importStores(rec.stores || {}, mode);
  const local = getSettings();
  if (rec.settings) {
    if (mode === "replace") setSettings({ ...rec.settings, apiKeys: local.apiKeys });
    else setSettings({ ...local, ...rec.settings, apiKeys: local.apiKeys });
  }
  setSetting("lastImportAt", new Date().toISOString());
  return rec.counts || {};
}

export async function exportProgress() {
  const s = getSettings();
  // Never write API keys into a file the user might share.
  const settings = { ...s };
  delete settings.apiKeys;

  const bundle = {
    app: APP,
    type: "progress",
    version: 1,
    profile: s.profileName || "",
    exported_at: new Date().toISOString(),
    settings,
    stores: await exportStores(),
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = bundle.exported_at.replace(/[:.]/g, "-").slice(0, 19);
  const who = (s.profileName || "progress").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "progress";
  a.href = url;
  a.download = `jp-flashcard-${who}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return bundle;
}

// mode: "merge" | "replace". Returns a small summary of what was imported.
export async function importProgress(file, mode) {
  const bundle = JSON.parse(await file.text());
  if (bundle.app !== APP || bundle.type !== "progress") {
    throw new Error("Not a jp-flashcard progress file.");
  }
  const stores = bundle.stores || {};
  await importStores(stores, mode);

  // On replace, the imported settings (incl. profile name) take over but keep
  // the local API keys. On merge, keep local settings and just adopt the keys.
  const local = getSettings();
  if (bundle.settings) {
    if (mode === "replace") setSettings({ ...bundle.settings, apiKeys: local.apiKeys });
    else setSettings({ ...local, ...bundle.settings, apiKeys: local.apiKeys });
  }
  setSetting("lastImportAt", new Date().toISOString());

  return {
    profile: bundle.profile || "",
    favorites: (stores.favorites || []).length,
    wrong_book: (stores.wrong_book || []).length,
    rounds: (stores.rounds || []).length,
    exported_at: bundle.exported_at,
  };
}
