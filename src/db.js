// IndexedDB wrapper for all dynamic user data (the only data exported/imported
// during migration). All stores from the spec are declared up front so the DB
// version stays stable as later modules wire them; Module 5 uses `favorites`.
//
// Stores:
//   favorites     { word_id }
//   study_log     { timestamp, date, lists_studied, cards_seen, known, unknown }
//   wrong_book    { word_id, wrong_count, last_wrong_date }
//   rounds        { list_id, times_studied, last_studied, history[] }
//   explain_cache { key:"{word_id}:{lang}", text, generated_at }

const DB_NAME = "jp-flashcard";

let dbPromise = null;

// Write hook: filestore.js registers a callback here so any change to durable
// data triggers a debounced mirror to the local save file. `meta` (the sync
// marker) and `explain_cache` (regenerable, never persisted to the file) don't
// trigger it — and `suppressWriteHook` is raised while filestore writes its own
// snapshot, so persisting never re-triggers itself into a loop.
let onWrite = null;
let hookSuppressed = false;
const NO_TRIGGER = new Set(["meta", "explain_cache"]);
export function setWriteHook(fn) {
  onWrite = fn;
}
export function suppressWriteHook(v) {
  hookSuppressed = !!v;
}

const STORE_DEFS = {
  favorites: { keyPath: "word_id" },
  study_log: { keyPath: "timestamp" },
  wrong_book: { keyPath: "word_id" },
  rounds: { keyPath: "list_id" },
  explain_cache: { keyPath: "key" },
  saves: { keyPath: "id" }, // account snapshots
  seen: { keyPath: "list_id" }, // last-browsed per list
  course_state: { keyPath: "course" }, // current round per course
  kana_progress: { keyPath: "id" }, // per-kana mastery (§4B): rolling accuracy
  meta: { keyPath: "key" }, // misc app state (e.g. last file-sync marker)
};
const REQUIRED_STORES = Object.keys(STORE_DEFS);

function createStores(db) {
  for (const [name, opts] of Object.entries(STORE_DEFS)) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
  }
}

// Open at a specific version (used to create/repair stores via an upgrade).
function openAt(version) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => createStores(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () =>
      reject(new Error("Database upgrade blocked — close other tabs of this app and reload."));
  });
}

// Open WITHOUT a fixed version: opens whatever version already exists (creating
// a fresh DB at v1 if none). This avoids VersionError if the stored DB is at a
// higher version than this code expects.
function openCurrent() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => createStores(req.result); // only fires for a brand-new DB
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = openCurrent().then((db) => {
    // If a store is missing (e.g. an older DB), bump to the next version to add it.
    if (REQUIRED_STORES.every((s) => db.objectStoreNames.contains(s))) return db;
    const next = db.version + 1;
    db.close();
    return openAt(next);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains(store)) {
          resolve(undefined); // store missing (transient); skip rather than throw
          return;
        }
        const t = db.transaction(store, mode);
        const os = t.objectStore(store);
        const result = fn(os);
        t.oncomplete = () => {
          if (mode === "readwrite" && onWrite && !hookSuppressed && !NO_TRIGGER.has(store)) {
            try {
              onWrite(store);
            } catch {
              /* a sync-scheduling error must not abort the data write */
            }
          }
          resolve(result && result._value !== undefined ? result._value : undefined);
        };
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function reqValue(request) {
  // Helper so tx() can return the request's result after completion.
  const box = { _value: undefined };
  request.onsuccess = () => {
    box._value = request.result;
  };
  return box;
}

// --- favorites -----------------------------------------------------------

export async function getAllFavoriteIds() {
  const ids = await tx("favorites", "readonly", (os) => reqValue(os.getAllKeys()));
  return ids || [];
}

export async function addFavorite(wordId) {
  await tx("favorites", "readwrite", (os) => os.put({ word_id: wordId }));
}

export async function removeFavorite(wordId) {
  await tx("favorites", "readwrite", (os) => os.delete(wordId));
}

export async function toggleFavorite(wordId, isFav) {
  if (isFav) await removeFavorite(wordId);
  else await addFavorite(wordId);
  return !isFav;
}

// --- wrong book ----------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function getAllWrongIds() {
  const ids = await tx("wrong_book", "readonly", (os) => reqValue(os.getAllKeys()));
  return ids || [];
}

export async function getWrongCount() {
  const n = await tx("wrong_book", "readonly", (os) => reqValue(os.count()));
  return n || 0;
}

// "Unknown" answer: add to wrong book or increment its count. (read, then write)
export async function markWrong(wordId) {
  const rec = (await tx("wrong_book", "readonly", (os) => reqValue(os.get(wordId)))) || {
    word_id: wordId,
    wrong_count: 0,
    last_wrong_date: today(),
  };
  rec.wrong_count += 1;
  rec.last_wrong_date = today();
  await tx("wrong_book", "readwrite", (os) => os.put(rec));
}

// "Known" answer: decrement; remove from wrong book when it reaches 0.
export async function markKnown(wordId) {
  const rec = await tx("wrong_book", "readonly", (os) => reqValue(os.get(wordId)));
  if (!rec) return;
  rec.wrong_count -= 1;
  await tx("wrong_book", "readwrite", (os) => (rec.wrong_count <= 0 ? os.delete(wordId) : os.put(rec)));
}

// --- study log (one entry per finished study session) --------------------

export async function addStudyLog(entry) {
  await tx("study_log", "readwrite", (os) => os.put(entry));
}

export async function getAllStudyLog() {
  return (await tx("study_log", "readonly", (os) => reqValue(os.getAll()))) || [];
}

export async function deleteStudyLog(timestamp) {
  await tx("study_log", "readwrite", (os) => os.delete(timestamp));
}

export async function getAllWrong() {
  return (await tx("wrong_book", "readonly", (os) => reqValue(os.getAll()))) || [];
}

export async function removeFromWrong(wordId) {
  await tx("wrong_book", "readwrite", (os) => os.delete(wordId));
}

// --- course round state (current round per course) -----------------------

export async function getCourseRound(course) {
  const rec = await tx("course_state", "readonly", (os) => reqValue(os.get(course)));
  return rec && rec.round ? rec.round : 1;
}
export async function setCourseRound(course, round) {
  await tx("course_state", "readwrite", (os) => os.put({ course, round }));
}
export async function getAllCourseStates() {
  return (await tx("course_state", "readonly", (os) => reqValue(os.getAll()))) || [];
}

// --- seen (last time a list was opened/browsed) --------------------------

export async function markSeen(listId) {
  await tx("seen", "readwrite", (os) => os.put({ list_id: listId, last_seen: new Date().toISOString() }));
}
export async function getAllSeen() {
  return (await tx("seen", "readonly", (os) => reqValue(os.getAll()))) || [];
}

// --- rounds (multi-round study tracking) ---------------------------------

export async function getAllRounds() {
  const rows = await tx("rounds", "readonly", (os) => reqValue(os.getAll()));
  return rows || [];
}

export async function getRound(listId) {
  return tx("rounds", "readonly", (os) => reqValue(os.get(listId)));
}

// --- kana progress (per-kana mastery, §4B) -------------------------------
// One record per kana id: { id, attempts, correct, streak, last_result, updated }.
// Mastery is a simple rolling accuracy; not the vocab round model.

export async function getAllKanaProgress() {
  return (await tx("kana_progress", "readonly", (os) => reqValue(os.getAll()))) || [];
}

// Record one attempt (correct true/false) against a kana, updating rolling stats.
export async function recordKanaResult(kanaId, correct) {
  const rec = (await tx("kana_progress", "readonly", (os) => reqValue(os.get(kanaId)))) || {
    id: kanaId,
    attempts: 0,
    correct: 0,
    streak: 0,
    last_result: null,
    updated: null,
  };
  rec.attempts += 1;
  if (correct) {
    rec.correct += 1;
    rec.streak = (rec.streak || 0) + 1;
  } else {
    rec.streak = 0;
  }
  rec.last_result = correct ? "correct" : "wrong";
  rec.updated = new Date().toISOString();
  await tx("kana_progress", "readwrite", (os) => os.put(rec));
  return rec;
}

// --- explanation cache (Layer 2 deep-dive results) -----------------------

export async function getExplainCache(key) {
  return tx("explain_cache", "readonly", (os) => reqValue(os.get(key)));
}

export async function putExplainCache(key, text) {
  await tx("explain_cache", "readwrite", (os) =>
    os.put({ key, text, generated_at: new Date().toISOString() }),
  );
}

// --- save slots ----------------------------------------------------------

export async function putSave(record) {
  await tx("saves", "readwrite", (os) => os.put(record));
}
export async function listSaves() {
  return (await tx("saves", "readonly", (os) => reqValue(os.getAll()))) || [];
}
export async function deleteSave(id) {
  await tx("saves", "readwrite", (os) => os.delete(id));
}
// Replace the whole accounts list (used when restoring from the local file).
export async function replaceSaves(records) {
  await tx("saves", "readwrite", (os) => {
    os.clear();
    for (const r of records || []) os.put(r);
  });
}

// --- file-sync marker (last savedAt we successfully wrote to save.json) --

export async function getSyncMarker() {
  const r = await tx("meta", "readonly", (os) => reqValue(os.get("fileSyncedAt")));
  return r ? r.value : "";
}
export async function setSyncMarker(savedAt) {
  await tx("meta", "readwrite", (os) => os.put({ key: "fileSyncedAt", value: savedAt }));
}

// --- migration (export / import all stores) ------------------------------

const ALL_STORES = ["favorites", "study_log", "wrong_book", "rounds", "explain_cache", "seen", "course_state", "kana_progress"];

export async function exportStores(exclude = []) {
  const out = {};
  for (const s of ALL_STORES) {
    if (exclude.includes(s)) continue;
    out[s] = (await tx(s, "readonly", (os) => reqValue(os.getAll()))) || [];
  }
  return out;
}

// mode: "replace" clears each store first; "merge" puts incoming over existing.
export async function importStores(data, mode) {
  for (const s of ALL_STORES) {
    const rows = data[s] || [];
    await tx(s, "readwrite", (os) => {
      if (mode === "replace") os.clear();
      for (const r of rows) os.put(r);
    });
  }
}

// Append one finished round's result to a list's history. (read, then write)
export async function appendRound(listId, { known, unknown }) {
  const rec = (await tx("rounds", "readonly", (os) => reqValue(os.get(listId)))) || {
    list_id: listId,
    times_studied: 0,
    last_studied: today(),
    history: [],
  };
  rec.times_studied += 1;
  rec.last_studied = today();
  rec.history.push({ round: rec.times_studied, date: today(), known, unknown });
  await tx("rounds", "readwrite", (os) => os.put(rec));
  return rec;
}
