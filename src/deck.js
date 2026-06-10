// Deck loading, ordering, shuffling. Reads the static library from data/.

// In the single-file (file://) build, the whole library is inlined as a global
// so no network/fetch is needed. Otherwise fetch from data/ (dev / server / Electron).
const LIB = typeof globalThis !== "undefined" ? globalThis.__JPLIB__ : null;

export async function loadManifest() {
  if (LIB) return LIB.manifest;
  // Primary: the full library you build with convert.py (data/manifest.json).
  // Fallback: the small bundled demo deck (data/sample/manifest.json), so a fresh
  // clone with no built library still runs out of the box. The demo manifest
  // points its list files at sample/… so loadListFile resolves them correctly.
  let res = await fetch("./manifest.json");
  if (!res.ok) res = await fetch("./sample/manifest.json");
  if (!res.ok) throw new Error(`manifest.json: ${res.status}`);
  return res.json();
}

export async function loadListFile(file) {
  if (LIB) {
    const data = LIB.lists[file];
    if (!data) throw new Error(`${file} not in bundle`);
    return data;
  }
  const res = await fetch(`./${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  return res.json();
}

// Preferred course order for the home screen: JLPT easy -> hard, then the rest.
const COURSE_ORDER = ["N5", "N4", "N3", "N2", "N1"];

export function orderedCourses(manifest) {
  const courses = manifest.curricula.map((c) => ({
    name: c.curriculum,
    lists: c.groups.flatMap((g) => g.lists),
  }));
  return courses.sort((a, b) => {
    const ia = COURSE_ORDER.indexOf(a.name);
    const ib = COURSE_ORDER.indexOf(b.name);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    }
    return a.name.localeCompare(b.name);
  });
}

// Card id format is "{courseSlug}-l{NN}-{seq}" -> the list file it lives in.
export function cardFile(cardId) {
  const m = cardId.match(/^(.+)-l(\d+)-\d+$/);
  if (!m) return null;
  return `${m[1]}/list${m[2]}.json`;
}

// Card id -> its list_id ("N5-l01-001" -> "N5-list01").
export function cardListId(cardId) {
  const m = cardId.match(/^(.+)-l(\d+)-\d+$/);
  return m ? `${m[1]}-list${m[2]}` : null;
}

// Load specific cards by id (e.g. a favorites deck), preserving the given order.
export async function loadCardsByIds(ids) {
  const files = [...new Set(ids.map(cardFile).filter(Boolean))];
  const byId = new Map();
  await Promise.all(
    files.map(async (file) => {
      try {
        const data = await loadListFile(file);
        for (const c of data.cards) byId.set(c.id, c);
      } catch {
        /* a list file may be missing; skip its cards */
      }
    }),
  );
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

export function findList(manifest, listId) {
  for (const c of manifest.curricula) {
    for (const g of c.groups) {
      for (const l of g.lists) {
        if (l.list_id === listId) return { ...l, course: c.curriculum };
      }
    }
  }
  return null;
}

// A simple deck cursor: holds cards, current index, and shuffle state.
export class Deck {
  constructor(cards) {
    this.original = cards.slice();
    this.cards = cards.slice();
    this.index = 0;
    this.shuffled = false;
  }
  get current() {
    return this.cards[this.index];
  }
  get size() {
    return this.cards.length;
  }
  next() {
    if (this.index < this.cards.length - 1) this.index++;
    return this.current;
  }
  prev() {
    if (this.index > 0) this.index--;
    return this.current;
  }
  toggleShuffle() {
    this.shuffled = !this.shuffled;
    if (this.shuffled) {
      for (let i = this.cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
      }
    } else {
      this.cards = this.original.slice();
    }
    // Land on the first card of the new order, not wherever we were.
    this.index = 0;
    return this.shuffled;
  }
}
