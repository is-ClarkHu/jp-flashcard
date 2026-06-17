// Accounts: a list of independent progress profiles. One account is "active" —
// its data IS the live IndexedDB working set. Switching persists the current
// account, then loads the chosen one. Export/import are per-account; import takes
// merge/replace (scoped to that account). The word library is never included.

import { exportStores, importStores, putSave, listSaves, deleteSave } from "./db.js";
import { getSettings, setSettings, setSetting } from "./settings.js";

const APP = "jp-flashcard";
const KEYPATH = {
  favorites: "word_id",
  study_log: "timestamp",
  wrong_book: "word_id",
  rounds: "list_id",
  explain_cache: "key",
  seen: "list_id",
  course_state: "course",
  kana_progress: "id",
};

export function activeId() {
  return getSettings().activeAccountId || "";
}

export async function listAccounts() {
  const a = await listSaves();
  return a.sort((x, y) => (x.created_at || "").localeCompare(y.created_at || ""));
}

function countStores(stores) {
  return {
    favorites: (stores.favorites || []).length,
    wrong_book: (stores.wrong_book || []).length,
    rounds: (stores.rounds || []).length,
  };
}

async function liveSnapshot() {
  const settings = { ...getSettings() };
  delete settings.apiKeys; // keys never travel with account data
  const stores = await exportStores();
  return { settings, stores, counts: countStores(stores) };
}

// Ensure there is a valid active account; on first run, adopt the current live
// data as the "Default" account. Returns the active id.
export async function ensureActive() {
  const accts = await listSaves();
  const id = activeId();
  if (id && accts.find((a) => a.id === id)) return id;
  if (accts.length) {
    setSetting("activeAccountId", accts[0].id);
    return accts[0].id;
  }
  const snap = await liveSnapshot();
  const rec = {
    id: `${Date.now()}`,
    name: getSettings().profileName || "Default",
    created_at: new Date().toISOString(),
    lastImportAt: "",
    ...snap,
  };
  await putSave(rec);
  setSetting("activeAccountId", rec.id);
  return rec.id;
}

// Persist the live working set back into the active account's record.
export async function persistActive() {
  const id = activeId();
  if (!id) return;
  const rec = (await listSaves()).find((a) => a.id === id);
  if (!rec) return;
  const snap = await liveSnapshot();
  rec.settings = snap.settings;
  rec.stores = snap.stores;
  rec.counts = snap.counts;
  await putSave(rec);
}

export async function createAccount(name) {
  await persistActive();
  const cur = getSettings();
  const settings = { ...cur, profileName: name || "New account" };
  delete settings.apiKeys;
  const rec = {
    id: `${Date.now()}`,
    name: name || "New account",
    created_at: new Date().toISOString(),
    lastImportAt: "",
    settings,
    stores: {},
    counts: countStores({}),
  };
  await putSave(rec);
  // Make it active: clear live data, keep app settings (theme/keys), reset profile.
  await importStores({}, "replace");
  setSettings({ ...cur, profileName: rec.name, activeAccountId: rec.id });
}

// Save the current live progress as a NEW account (a fork). Does not switch —
// you keep studying the current account; the copy is added to the list.
export async function duplicateCurrentAs(name) {
  const snap = await liveSnapshot();
  const rec = {
    id: `${Date.now()}`,
    name: name || "Copy",
    created_at: new Date().toISOString(),
    lastImportAt: "",
    ...snap,
  };
  await putSave(rec);
  return rec;
}

export async function switchAccount(id) {
  await persistActive();
  const rec = (await listSaves()).find((a) => a.id === id);
  if (!rec) throw new Error("Account not found");
  const local = getSettings();
  await importStores(rec.stores || {}, "replace");
  setSettings({ ...(rec.settings || {}), apiKeys: local.apiKeys, activeAccountId: id });
}

export async function renameAccount(id, name) {
  const rec = (await listSaves()).find((a) => a.id === id);
  if (!rec) return;
  rec.name = name;
  if (rec.settings) rec.settings.profileName = name;
  await putSave(rec);
  if (id === activeId()) setSetting("profileName", name);
}

// Delete an account. If it was the active one, load another account (or a fresh
// empty Default) into the live data. Returns { switched } so the UI can reload.
export async function removeAccount(id) {
  const wasActive = id === activeId();
  await deleteSave(id);
  if (!wasActive) return { switched: false };

  const local = getSettings();
  const rest = await listSaves();
  if (rest.length) {
    const next = rest[0];
    await importStores(next.stores || {}, "replace");
    setSettings({ ...(next.settings || {}), apiKeys: local.apiKeys, activeAccountId: next.id });
  } else {
    await importStores({}, "replace"); // no accounts left → fresh empty Default
    const settings = { ...local, profileName: "Default" };
    delete settings.apiKeys;
    const rec = {
      id: `${Date.now()}`,
      name: "Default",
      created_at: new Date().toISOString(),
      lastImportAt: "",
      settings,
      stores: {},
      counts: { favorites: 0, wrong_book: 0, rounds: 0 },
    };
    await putSave(rec);
    setSettings({ ...local, profileName: "Default", activeAccountId: rec.id });
  }
  return { switched: true };
}

function downloadBundle(bundle, name) {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = bundle.exported_at.replace(/[:.]/g, "-").slice(0, 19);
  const who = (name || "account").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account";
  a.href = url;
  a.download = `jp-flashcard-${who}-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportAccount(id) {
  if (id === activeId()) await persistActive();
  const rec = (await listSaves()).find((a) => a.id === id);
  if (!rec) throw new Error("Account not found");
  const bundle = {
    app: APP,
    type: "progress",
    version: 1,
    profile: rec.name || "",
    exported_at: new Date().toISOString(),
    settings: rec.settings || {},
    stores: rec.stores || {},
  };
  downloadBundle(bundle, rec.name);
  return bundle;
}

function mergeStores(base, incoming) {
  const out = {};
  const names = new Set([...Object.keys(base || {}), ...Object.keys(incoming || {})]);
  for (const n of names) {
    const kp = KEYPATH[n] || "id";
    const map = new Map();
    for (const r of base?.[n] || []) map.set(r[kp], r);
    for (const r of incoming?.[n] || []) map.set(r[kp], r); // incoming wins
    out[n] = [...map.values()];
  }
  return out;
}

// Import a file into a specific account. mode "merge" | "replace".
// Returns { counts, active } — active=true means the live data changed (reload).
export async function importIntoAccount(id, file, mode) {
  const bundle = JSON.parse(await file.text());
  if (bundle.app !== APP || bundle.type !== "progress") {
    throw new Error("Not a jp-flashcard progress file.");
  }
  const rec = (await listSaves()).find((a) => a.id === id);
  if (!rec) throw new Error("Account not found");
  const incoming = bundle.stores || {};

  rec.stores = mode === "replace" ? incoming : mergeStores(rec.stores || {}, incoming);
  if (bundle.settings) {
    rec.settings = mode === "replace" ? bundle.settings : { ...(rec.settings || {}), ...bundle.settings };
  }
  rec.lastImportAt = new Date().toISOString();
  rec.counts = countStores(rec.stores);
  await putSave(rec);

  const isActive = id === activeId();
  if (isActive) {
    // Reflect into the live working set too.
    await importStores(incoming, mode);
    const local = getSettings();
    if (bundle.settings) {
      if (mode === "replace") setSettings({ ...bundle.settings, apiKeys: local.apiKeys, activeAccountId: id });
      else setSettings({ ...local, ...bundle.settings, apiKeys: local.apiKeys });
    }
    setSetting("lastImportAt", rec.lastImportAt);
  }
  return { counts: rec.counts, active: isActive };
}
