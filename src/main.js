// App init, hash routing, and the home / deck / favorites / self-test views.
// Modules: B (browse + flip + nav), 4 (dual-speaker TTS), 5 (favorites),
// 6 (self-test + wrong book, with per-list scope filters).

import "../styles/main.css";
import {
  loadManifest,
  loadListFile,
  loadCardsByIds,
  orderedCourses,
  findList,
  cardListId,
  Deck,
} from "./deck.js";
import { createCard } from "./card.js";
import { getSettings, setSetting } from "./settings.js";
import { SPEAKERS, playSpeaker, resolveSpeaker, speechAvailable, japaneseVoiceAvailable, stopSpeech } from "./tts.js";
import { getAllFavoriteIds, toggleFavorite, getAllWrongIds, getWrongCount, getAllStudyLog, getAllCourseStates, getAllSeen, markSeen, getAllWrong, removeFromWrong } from "./db.js";
import { statsByList, courseProgress, logRound } from "./progress.js";
import { renderQuiz } from "./quiz.js";
import {
  ensureActive,
  listAccounts,
  activeId,
  createAccount,
  switchAccount,
  renameAccount,
  removeAccount,
  exportAccount,
  importIntoAccount,
  duplicateCurrentAs,
} from "./accounts.js";
import { createExplainPanel, EXPLAIN_PROVIDERS, providerMeta } from "./explain.js";
import { renderDashboard, renderCourse } from "./dashboard.js";
import { renderKana } from "./kana.js";
import { bootReconcile, flushNow, isFileBacked } from "./filestore.js";

const app = document.getElementById("app");

const state = {
  manifest: null,
  favorites: new Set(),
  deck: null,
  card: null,
  settings: getSettings(),
  _move: null,
  _flip: null,
  _cleanup: null,
};

// --- helpers -------------------------------------------------------------

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function speakerIcon() {
  const span = el("span", "icon");
  span.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  return span;
}

function clear() {
  app.replaceChildren();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

// Toggle furigana visibility app-wide (cards + self-test) via a root attribute;
// CSS hides .card__reading / .card__reading-sub when off — no re-render needed.
function applyShowReading(show) {
  document.documentElement.dataset.hideReading = show ? "false" : "true";
}

// Tiny inline accuracy sparkline from an array of per-test accuracies (0..1).
function sparkline(accs) {
  const w = 54;
  const h = 16;
  const pad = 2;
  const n = accs.length;
  const y = (a) => (h - pad - a * (h - 2 * pad)).toFixed(1);
  const span = el("span", "sparkline");
  const c = getComputedStyle(document.documentElement).getPropertyValue("--chart-accent").trim() || "#6b8e6b";
  if (n === 1) {
    span.innerHTML = `<svg width="${w}" height="${h}"><circle cx="${w / 2}" cy="${y(accs[0])}" r="2.2" fill="${c}"/></svg>`;
    return span;
  }
  const pts = accs
    .map((a, i) => `${(pad + (i * (w - 2 * pad)) / (n - 1)).toFixed(1)},${y(a)}`)
    .join(" ");
  span.innerHTML = `<svg width="${w}" height="${h}"><polyline fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${pts}"/></svg>`;
  return span;
}

function statBadge(text, variant) {
  return el("span", "stat-badge" + (variant ? ` stat-badge--${variant}` : ""), text);
}

const ICONS = {
  use: '<path d="M20 6 9 17l-5-5"/>',
  export: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  import: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
  rename: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  delete: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/>',
};

function iconBtn(name, title, onClick) {
  const b = el("button", "icon-btn");
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  b.addEventListener("click", onClick);
  return b;
}

function topEntry(href, icon, label, count) {
  const a = el("a", "top-entry");
  a.href = href;
  a.append(el("span", "top-entry__icon", icon), el("span", null, label));
  if (count !== "" && count != null) a.appendChild(el("span", "top-entry__count", `${count}`));
  return a;
}

// --- home view -----------------------------------------------------------

async function renderHome() {
  clear();
  const header = el("header", "app-header");
  header.appendChild(el("h1", "app-title", "日本語 単語帳"));
  header.appendChild(el("p", "app-subtitle", "Japanese Vocabulary Flashcards"));
  app.appendChild(header);

  const wrongCount = await getWrongCount().catch(() => 0);
  const top = el("div", "top-entries");
  top.appendChild(topEntry("#/kana", "あ", "Kana", ""));
  top.appendChild(topEntry("#/favorites", "★", "Favorites", state.favorites.size));
  top.appendChild(topEntry("#/wrong", "✗", "Wrong Book", wrongCount));
  top.appendChild(topEntry("#/dashboard", "▤", "Dashboard", ""));
  top.appendChild(topEntry("#/settings", "⚙", "Settings", ""));
  app.appendChild(top);

  const logs = await getAllStudyLog().catch(() => []);
  const statMap = statsByList(logs);
  const courseStates = await getAllCourseStates().catch(() => []);
  const roundOf = new Map(courseStates.map((c) => [c.course, c.round || 1]));
  const seen = await getAllSeen().catch(() => []);
  const seenMap = new Map(seen.map((s) => [s.list_id, s.last_seen]));
  const todayStr = new Date().toISOString().slice(0, 10);
  const threshold = state.settings.roundThreshold || 0.9;

  const courses = orderedCourses(state.manifest);
  const list = el("div", "course-list");

  courses.forEach((course) => {
    const round = roundOf.get(course.name) || 1;
    const gate = courseProgress(course.lists, logs, round, threshold);
    const studied = gate.perList.filter((p) => p.tested).length;
    const total = course.lists.reduce((n, l) => n + l.count, 0);
    const card = el("section", "course");

    const head = el("div", "course__head");
    head.setAttribute("role", "button");
    head.appendChild(el("span", "course__name", course.name));
    const metaEl = el("span", "course__meta");
    metaEl.appendChild(document.createTextNode(`${course.lists.length} lists · ${total} words · `));
    metaEl.appendChild(el("strong", "course__round", `Round ${round}`));
    if (studied) metaEl.appendChild(document.createTextNode(` · ${studied}/${course.lists.length} tested this round`));
    head.appendChild(metaEl);
    const stats = el("a", "course__stats");
    stats.href = `#/course/${encodeURIComponent(course.name)}`;
    stats.title = `${course.name} dashboard & wrong book`;
    stats.textContent = "▤";
    stats.addEventListener("click", (e) => e.stopPropagation());
    head.appendChild(stats);
    const caret = el("span", "course__caret", "▸");
    head.appendChild(caret);

    // "last seen" marks only the single most-recently-opened list in this course.
    let lastSeenListId = "";
    let lastSeenTs = "";
    course.lists.forEach((l) => {
      const ts = seenMap.get(l.list_id);
      if (ts && ts > lastSeenTs) {
        lastSeenTs = ts;
        lastSeenListId = l.list_id;
      }
    });

    const body = el("div", "course__lists");
    course.lists.forEach((l) => {
      const row = el("a", "list-row");
      row.href = `#/list/${encodeURIComponent(l.list_id)}`;

      const main = el("div", "list-row__main");
      main.appendChild(el("div", "list-row__name", l.list_name));
      const gp = gate.perList.find((p) => p.list_id === l.list_id);
      const e = statMap.get(l.list_id);
      const lastSeen = l.list_id === lastSeenListId ? seenMap.get(l.list_id) : null;
      if ((gp && gp.tested) || e || lastSeen) {
        const stats = el("div", "list-row__stats");
        if (gp && gp.tested) {
          const lastPct = Math.round(gp.lastAcc * 100);
          stats.appendChild(statBadge(`${gp.count}× this round`));
          stats.appendChild(statBadge(`last ${lastPct}%`, gp.passed ? "good" : ""));
        }
        if (e && e.lastDate) stats.appendChild(statBadge(`last test ${e.lastDate}`));
        if (lastSeen) stats.appendChild(statBadge(`last seen ${lastSeen.slice(0, 10)}`));
        if (e && e.tests.length) stats.appendChild(sparkline(e.tests.map((t) => t.acc)));
        main.appendChild(stats);
        const activeToday = (e && e.lastDate === todayStr) || (lastSeen && lastSeen.slice(0, 10) === todayStr);
        if (activeToday) row.classList.add("list-row--today");
      }
      row.appendChild(main);
      row.appendChild(el("span", "list-row__count", `${l.count}`));
      body.appendChild(row);
    });

    head.addEventListener("click", () => {
      const open = card.classList.toggle("course--open");
      caret.textContent = open ? "▾" : "▸";
    });

    card.appendChild(head);
    card.appendChild(body);
    list.appendChild(card);
  });

  app.appendChild(list);
}

// --- deck view (browse) --------------------------------------------------
// opts: { title, scopes?:[{key,label}], getCards(scope)->cards, onSelfTest?(scope) }

function renderDeckUI({ title, scopes, getCards, onSelfTest, wrongCounts, onClear }) {
  clear();
  app.classList.add("app--wide");
  let activeScope = scopes && scopes.length ? scopes[0].key : null;
  let explainOpen = false;

  const bar = el("div", "deck-bar");
  const left = el("div", "deck-bar__side");
  const back = el("a", "btn btn--ghost", "← Home");
  back.href = "#/";
  left.appendChild(back);

  const right = el("div", "deck-bar__side");
  if (onSelfTest) {
    const test = el("button", "btn", "Self-test");
    test.addEventListener("click", () => onSelfTest(activeScope));
    right.appendChild(test);
  }
  const faceBtn = el("button", "btn btn--ghost");
  const faceLabel = () => (state.settings.defaultFace === "front" ? "Front: 日本語" : "Front: Meaning");
  faceBtn.textContent = faceLabel();
  faceBtn.addEventListener("click", () => {
    state.settings = setSetting("defaultFace", state.settings.defaultFace === "front" ? "back" : "front");
    faceBtn.textContent = faceLabel();
    if (state.deck.size) showCard();
  });
  right.appendChild(faceBtn);

  const readingBtn = el("button", "btn btn--ghost");
  const readingLabel = () => (state.settings.showReading ? "Reading: on" : "Reading: off");
  readingBtn.title = "Show/hide the kana reading (furigana)";
  readingBtn.textContent = readingLabel();
  readingBtn.classList.toggle("btn--active", state.settings.showReading);
  readingBtn.addEventListener("click", () => {
    state.settings = setSetting("showReading", !state.settings.showReading);
    applyShowReading(state.settings.showReading);
    readingBtn.textContent = readingLabel();
    readingBtn.classList.toggle("btn--active", state.settings.showReading);
  });
  right.appendChild(readingBtn);

  bar.append(left, el("div", "deck-title", title), right);
  app.appendChild(bar);

  // Scope chips (All / ★ / ✗) for list view.
  const chipEls = {};
  if (scopes && scopes.length) {
    const sb = el("div", "scope-bar");
    scopes.forEach((s) => {
      const chip = el("button", "chip");
      chip.addEventListener("click", () => setScope(s.key));
      chipEls[s.key] = chip;
      sb.appendChild(chip);
    });
    app.appendChild(sb);
  }
  function refreshChips() {
    if (!scopes) return;
    scopes.forEach((s) => {
      if (chipEls[s.key]) chipEls[s.key].textContent = `${s.label} ${getCards(s.key).length}`;
    });
  }

  // Stage row: ‹ | card (+ star) | ›
  const stageRow = el("div", "stage-row");
  const prevArrow = el("button", "nav-arrow", "‹");
  const nextArrow = el("button", "nav-arrow", "›");
  const stage = el("div", "stage");
  const cardWrap = el("div", "card-wrap");
  const star = el("button", "fav-btn");
  star.title = "Favorite (toggle)";
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFav();
  });
  cardWrap.appendChild(star);
  stage.appendChild(cardWrap);
  stageRow.append(prevArrow, stage, nextArrow);
  app.appendChild(stageRow);
  prevArrow.addEventListener("click", () => move(-1));
  nextArrow.addEventListener("click", () => move(1));

  // Speaker bar.
  const speakers = el("div", "speakers");
  // Voice picker: a play button + a dropdown of the 7 voices ("Auto" = browser
  // system voice + the 6 VOICEVOX voices). Default shows the user's default voice.
  const voiceSel = el("select", "voice-select");
  [["auto", "Auto (system)"], ...SPEAKERS.map((s) => [s.key, s.label])].forEach(([key, label]) => {
    const o = el("option", null, label);
    o.value = key;
    voiceSel.appendChild(o);
  });
  voiceSel.value = state.settings.defaultSpeaker || "aoyama";
  voiceSel.addEventListener("change", () => {
    syncRate();
    play(voiceSel.value);
  });
  const playBtn = el("button", "speaker-btn");
  playBtn.append(speakerIcon(), el("span", null, "Play"));
  playBtn.title = "Play this word with the selected voice";
  playBtn.addEventListener("click", () => play(voiceSel.value));
  speakers.append(playBtn, voiceSel);
  const auto = el("button", "btn btn--ghost speaker-auto");
  const autoLabel = () => `Auto-play: ${state.settings.autoPlay ? "on" : "off"}`;
  auto.textContent = autoLabel();
  auto.classList.toggle("btn--active", state.settings.autoPlay);
  auto.addEventListener("click", () => {
    state.settings = setSetting("autoPlay", !state.settings.autoPlay);
    auto.textContent = autoLabel();
    auto.classList.toggle("btn--active", state.settings.autoPlay);
  });
  speakers.appendChild(auto);
  const rate = el("select", "speaker-rate");
  [["Slow", 0.7], ["Normal", 1.0], ["Fast", 1.3]].forEach(([label, val]) => {
    const o = el("option", null, label);
    o.value = String(val);
    if (Math.abs(val - state.settings.speechRate) < 0.05) o.selected = true;
    rate.appendChild(o);
  });
  rate.addEventListener("change", () => {
    state.settings = setSetting("speechRate", parseFloat(rate.value));
  });
  speakers.appendChild(rate);
  // Speed only affects the browser Web Speech voice ("Auto"); VOICEVOX mp3s are
  // pre-rendered at a fixed speed, so gray the control out for those.
  const syncRate = () => {
    const isSystem = voiceSel.value === "auto";
    rate.disabled = !isSystem;
    rate.title = isSystem
      ? "Playback speed for the system voice"
      : "Speed applies only to the Auto (system) voice — VOICEVOX voices play at a fixed speed.";
  };
  syncRate();
  app.appendChild(speakers);

  if (!speechAvailable() || !japaneseVoiceAvailable()) {
    app.appendChild(
      el("p", "voice-hint", "No Japanese system voice detected — install a ja-JP voice in your OS settings to hear pronunciation."),
    );
  }

  // Foot: counter + shuffle (kept right under the card).
  const foot = el("div", "deck-foot");
  const counter = el("div", "counter");
  const wrongBadge = wrongCounts ? el("span", "wrong-badge") : null;
  const shuffleBtn = el("button", "btn btn--ghost", "Shuffle");
  shuffleBtn.addEventListener("click", () => {
    if (!state.deck.size) return;
    const on = state.deck.toggleShuffle();
    shuffleBtn.classList.toggle("btn--active", on);
    showCard();
  });
  foot.appendChild(counter);
  if (wrongBadge) foot.appendChild(wrongBadge);
  foot.appendChild(shuffleBtn);
  if (onClear) {
    const clearBtn = el("button", "btn btn--ghost", "Got it ✓");
    clearBtn.title = "Remove this word from the wrong book";
    clearBtn.addEventListener("click", removeCurrent);
    foot.appendChild(clearBtn);
  }
  app.appendChild(foot);

  app.appendChild(el("p", "hint", "Click the card to flip · ← → to navigate · Space to flip · ★ to favorite"));

  // Explanation (Layer 1 static + Layer 2 deep dive) — kept at the bottom so
  // expanding it doesn't push the controls down.
  const explainBar = el("div", "explain-bar");
  const explainToggle = el("button", "btn btn--ghost", "Explain ▾");
  explainToggle.addEventListener("click", () => {
    explainOpen = !explainOpen;
    explainToggle.textContent = explainOpen ? "Explain ▴" : "Explain ▾";
    explainToggle.classList.toggle("btn--active", explainOpen);
    renderExplain();
  });
  explainBar.appendChild(explainToggle);
  const explainHost = el("div", "explain-host");
  app.append(explainBar, explainHost);
  function renderExplain() {
    explainHost.replaceChildren();
    if (explainOpen && state.deck.current) {
      explainHost.appendChild(createExplainPanel(state.deck.current).element);
    }
  }

  function emptyText(scope) {
    if (scope === "fav") return "No favorites in this list yet.";
    if (scope === "wrong") return "No wrong words in this list — nice!";
    return "Nothing here.";
  }

  function play(speakerKey) {
    if (state.deck.current) playSpeaker(state.deck.current, speakerKey, state.settings);
  }
  function updateStar() {
    const fav = state.deck.current && state.favorites.has(state.deck.current.id);
    star.textContent = fav ? "★" : "☆";
    star.classList.toggle("fav-btn--on", !!fav);
  }
  async function toggleFav() {
    const c = state.deck.current;
    if (!c) return;
    const isFav = state.favorites.has(c.id);
    const nowFav = await toggleFavorite(c.id, isFav);
    if (nowFav) state.favorites.add(c.id);
    else state.favorites.delete(c.id);
    updateStar();
    refreshChips();
  }
  function showCard() {
    stopSpeech();
    state.card = createCard(state.deck.current, { defaultFace: state.settings.defaultFace });
    cardWrap.replaceChildren(star, state.card.element);
    star.style.display = "";
    counter.textContent = `${state.deck.index + 1} / ${state.deck.size}`;
    prevArrow.disabled = state.deck.index === 0;
    nextArrow.disabled = state.deck.index === state.deck.size - 1;
    if (wrongBadge) wrongBadge.textContent = `wrong ×${wrongCounts.get(state.deck.current.id) || 0}`;
    updateStar();
    // Collapse the explanation when a new card is shown.
    explainOpen = false;
    explainToggle.textContent = "Explain ▾";
    explainToggle.classList.remove("btn--active");
    renderExplain();
    // Auto-play reads the word as soon as it's shown (not on flip).
    // Reset the voice picker to the default (or a fresh random) on every card, so
    // an on-card voice change only sticks for the word it was chosen on.
    voiceSel.value =
      state.settings.voiceMode === "random"
        ? resolveSpeaker(state.settings)
        : state.settings.defaultSpeaker || "aoyama";
    syncRate();
    if (state.settings.autoPlay) play(voiceSel.value);
  }
  function move(delta) {
    if (!state.deck.size) return;
    if (delta < 0) state.deck.prev();
    else state.deck.next();
    showCard();
  }
  async function removeCurrent() {
    const c = state.deck.current;
    if (!c) return;
    if (onClear) await onClear(c.id);
    state.deck.cards.splice(state.deck.index, 1);
    state.deck.original = state.deck.cards.slice();
    if (!state.deck.cards.length) {
      star.style.display = "none";
      cardWrap.replaceChildren(el("div", "card-empty", "Wrong book cleared — nice work!"));
      counter.textContent = "0 / 0";
      if (wrongBadge) wrongBadge.textContent = "";
      prevArrow.disabled = true;
      nextArrow.disabled = true;
      return;
    }
    if (state.deck.index >= state.deck.cards.length) state.deck.index = state.deck.cards.length - 1;
    showCard();
  }
  function load() {
    refreshChips();
    const cards = getCards(activeScope);
    state.deck = new Deck(cards);
    if (!cards.length) {
      star.style.display = "none";
      cardWrap.replaceChildren(el("div", "card-empty", emptyText(activeScope)));
      counter.textContent = "0 / 0";
      prevArrow.disabled = true;
      nextArrow.disabled = true;
      return;
    }
    showCard();
  }
  function setScope(key) {
    activeScope = key;
    Object.entries(chipEls).forEach(([k, e]) => e.classList.toggle("chip--active", k === key));
    load();
  }

  if (scopes && scopes.length) chipEls[activeScope].classList.add("chip--active");
  state._move = move;
  state._flip = () => state.card && state.card.flip();
  load();
}

async function renderDeck(listId) {
  clear();
  const meta = findList(state.manifest, listId);
  if (!meta) return void app.appendChild(el("p", "error", `List not found: ${listId}`));
  app.appendChild(el("p", "loading", "Loading…"));
  let data, wrongIds;
  try {
    data = await loadListFile(meta.file);
    wrongIds = new Set(await getAllWrongIds().catch(() => []));
    markSeen(listId); // record that this list was browsed
  } catch (e) {
    clear();
    return void app.appendChild(el("p", "error", `Failed to load list: ${e.message}`));
  }
  const listCards = data.cards;
  const title = `${meta.course} · ${data.list_name}`;

  const getCards = (scope) => {
    if (scope === "fav") return listCards.filter((c) => state.favorites.has(c.id));
    if (scope === "wrong") return listCards.filter((c) => wrongIds.has(c.id));
    return listCards;
  };
  const scopes = [
    { key: "all", label: "All" },
    { key: "fav", label: "★" },
    { key: "wrong", label: "✗" },
  ];
  const onSelfTest = (scope) =>
    startQuiz({
      title,
      cards: getCards(scope),
      listId: scope === "all" ? listId : null,
      onExit: () => {
        state._cleanup = null;
        renderDeck(listId);
      },
    });

  renderDeckUI({ title, scopes, getCards, onSelfTest });
}

async function renderFavorites() {
  clear();
  app.appendChild(el("p", "loading", "Loading…"));
  const cards = await loadCardsByIds([...state.favorites]);
  if (!cards.length) {
    clear();
    const back = el("a", "btn btn--ghost", "← Home");
    back.href = "#/";
    return void app.append(back, el("p", "hint", "No favorites yet — tap ★ on a card to add it."));
  }
  renderDeckUI({
    title: "★ Favorites",
    getCards: () => cards,
    onSelfTest: () =>
      startQuiz({
        title: "★ Favorites",
        cards,
        listId: null,
        onExit: () => {
          state._cleanup = null;
          renderFavorites();
        },
      }),
  });
}

// --- self-test -----------------------------------------------------------

function startQuiz({ title, cards, listId, emptyMsg, onExit }) {
  clear();
  app.classList.add("app--wide");
  const exit = onExit || (() => (location.hash = "#/"));
  if (!cards.length) {
    const back = el("button", "btn btn--ghost", "← Back");
    back.addEventListener("click", exit);
    return void app.append(back, el("p", "hint", emptyMsg || "Nothing to study here yet."));
  }
  state._cleanup = renderQuiz(app, { title, cards, listId, favorites: state.favorites, onExit: exit });
}

// Wrong book — browse (flip) by default; can self-test; shows wrong counts and a
// "Got it" to clear a word. Optionally scoped to one course.
function wrongCourseOf(wordId) {
  const m = wordId.match(/^(.+)-l\d+-\d+$/);
  return m ? m[1] : "";
}

// round: undefined = all rounds combined (cumulative wrong book, course-scoped);
// a number = only the words missed during that course round (from study_log).
async function renderWrong(courseSlug, round) {
  clear();
  app.appendChild(el("p", "loading", "Loading…"));

  let ids;
  const counts = new Map();
  if (round != null && courseSlug) {
    // words missed in this course round, with how many times each was missed then
    const logs = await getAllStudyLog().catch(() => []);
    logs.forEach((l) => {
      if (l.course !== courseSlug || logRound(l) !== round) return;
      (l.wrong_ids || []).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    });
    ids = [...counts.keys()].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
  } else {
    let recs = await getAllWrong().catch(() => []);
    if (courseSlug) recs = recs.filter((r) => wrongCourseOf(r.word_id) === courseSlug);
    recs.sort((a, b) => (b.wrong_count || 0) - (a.wrong_count || 0));
    recs.forEach((r) => counts.set(r.word_id, r.wrong_count || 0));
    ids = recs.map((r) => r.word_id);
  }

  const cards = await loadCardsByIds(ids);
  const scope = courseSlug ? `${courseSlug} ` : "";
  const title = round != null ? `✗ ${scope}Wrong · Round ${round}` : `✗ ${scope}Wrong Book`;
  if (!cards.length) {
    clear();
    const back = el("a", "btn btn--ghost", courseSlug ? "← Course" : "← Home");
    back.href = courseSlug ? `#/course/${encodeURIComponent(courseSlug)}` : "#/";
    return void app.append(back, el("p", "hint", "No wrong words here — nice work!"));
  }
  renderDeckUI({
    title,
    getCards: () => cards,
    wrongCounts: counts,
    // Per-round view derives from history, so "Got it" only clears the live book.
    onClear: (id) => removeFromWrong(id),
    onSelfTest: () =>
      startQuiz({
        title,
        cards,
        listId: null,
        onExit: () => {
          state._cleanup = null;
          renderWrong(courseSlug, round);
        },
      }),
  });
}

// --- settings (left nav: Appearance / Explanations / Backup) -------------

function chipRow(options, getActive, onPick) {
  const row = el("div", "scope-bar");
  options.forEach(([key, label]) => {
    const chip = el("button", "chip" + (getActive() === key ? " chip--active" : ""), label);
    chip.addEventListener("click", () => {
      onPick(key);
      row.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip--active"));
      chip.classList.add("chip--active");
    });
    row.appendChild(chip);
  });
  return row;
}

function appearancePane() {
  const box = el("div", "pane");
  box.appendChild(el("h3", "pane__title", "Theme"));
  box.appendChild(
    chipRow(
      [["light", "Light"], ["dark", "Dark"]],
      () => state.settings.theme,
      (key) => {
        state.settings = setSetting("theme", key);
        applyTheme(key);
      },
    ),
  );
  box.appendChild(el("h3", "pane__title", "Reading (furigana)"));
  box.appendChild(
    chipRow(
      [["show", "Show"], ["hide", "Hide"]],
      () => (state.settings.showReading ? "show" : "hide"),
      (key) => {
        state.settings = setSetting("showReading", key === "show");
        applyShowReading(state.settings.showReading);
      },
    ),
  );
  box.appendChild(el("h3", "pane__title", "Card language (meaning shown)"));
  box.appendChild(
    chipRow(
      [["zh", "中文"], ["en", "English"]],
      () => state.settings.cardLang || "en",
      (key) => (state.settings = setSetting("cardLang", key)),
    ),
  );
  return box;
}

function voicePane() {
  const box = el("div", "pane");
  box.appendChild(el("h3", "pane__title", "Auto-play voice"));
  box.appendChild(
    chipRow(
      [["fixed", "Fixed default"], ["random", "Random each card"]],
      () => state.settings.voiceMode || "fixed",
      (key) => (state.settings = setSetting("voiceMode", key)),
    ),
  );
  box.appendChild(el("h3", "pane__title", "Default voice"));
  box.appendChild(
    chipRow(
      SPEAKERS.map((s) => [s.key, s.label]),
      () => state.settings.defaultSpeaker || SPEAKERS[0].key,
      (key) => (state.settings = setSetting("defaultSpeaker", key)),
    ),
  );
  box.appendChild(
    el(
      "p",
      "panel__note",
      "Six VOICEVOX voices ship with the app. “Random” picks one per word for auto-play; “Fixed” always uses your default. On any card you can also tap a voice to hear it and make it current.",
    ),
  );
  return box;
}

function explanationsPane() {
  const box = el("div", "pane");
  box.appendChild(el("h3", "pane__title", "Explanation language"));
  box.appendChild(
    chipRow(
      [["zh", "中文"], ["en", "English"], ["ja", "日本語"]],
      () => state.settings.explainLang,
      (key) => (state.settings = setSetting("explainLang", key)),
    ),
  );

  box.appendChild(el("h3", "pane__title", "“Explain deeper” provider"));
  box.appendChild(
    el(
      "p",
      "panel__note",
      "Used only for on-demand deep explanations. Each key is stored locally in this browser and sent only to the provider you pick — never committed or shared. (Bulk explanations for the whole library are generated separately by convert.py — see README.)",
    ),
  );

  const fields = el("div", "prov-fields");
  function renderProviderFields() {
    fields.replaceChildren();
    const pid = state.settings.explainProvider;
    const meta = providerMeta(pid);
    fields.appendChild(el("label", "panel__field-label", `${meta.label} API key`));
    const keyInput = el("input", "text-input");
    keyInput.type = "password";
    keyInput.placeholder = "API key";
    keyInput.value = (state.settings.apiKeys && state.settings.apiKeys[pid]) || "";
    keyInput.addEventListener("change", () => {
      const keys = { ...(state.settings.apiKeys || {}) };
      keys[pid] = keyInput.value.trim();
      state.settings = setSetting("apiKeys", keys);
    });
    fields.appendChild(keyInput);
    fields.appendChild(el("label", "panel__field-label", "Model"));
    const modelInput = el("input", "text-input");
    modelInput.placeholder = meta.defaultModel;
    modelInput.value = (state.settings.models && state.settings.models[pid]) || "";
    modelInput.addEventListener("change", () => {
      const models = { ...(state.settings.models || {}) };
      const v = modelInput.value.trim();
      if (v) models[pid] = v;
      else delete models[pid];
      state.settings = setSetting("models", models);
    });
    fields.appendChild(modelInput);
  }
  box.appendChild(
    chipRow(
      EXPLAIN_PROVIDERS.map((p) => [p.id, p.label]),
      () => state.settings.explainProvider,
      (key) => {
        state.settings = setSetting("explainProvider", key);
        renderProviderFields();
      },
    ),
  );
  box.appendChild(fields);
  renderProviderFields();
  return box;
}

function studyPane() {
  const box = el("div", "pane");
  box.appendChild(el("h3", "pane__title", "Self-test timer"));
  box.appendChild(
    el(
      "p",
      "panel__note",
      "Optional per-word countdown during self-test. When it runs out, the card auto-flips and is marked wrong, and → becomes Next. Toggle it on the test screen; set the seconds here.",
    ),
  );
  box.appendChild(el("label", "panel__field-label", "Seconds per word"));
  const inp = el("input", "text-input");
  inp.type = "number";
  inp.min = "3";
  inp.max = "120";
  inp.value = String(state.settings.timerSeconds || 10);
  inp.addEventListener("change", () => {
    let v = parseInt(inp.value, 10);
    if (!Number.isFinite(v) || v < 3) v = 3;
    if (v > 120) v = 120;
    inp.value = String(v);
    state.settings = setSetting("timerSeconds", v);
  });
  box.appendChild(inp);
  box.appendChild(el("label", "panel__field-label", "Enabled by default"));
  box.appendChild(
    chipRow(
      [["on", "On"], ["off", "Off"]],
      () => (state.settings.timerEnabled ? "on" : "off"),
      (k) => (state.settings = setSetting("timerEnabled", k === "on")),
    ),
  );

  box.appendChild(el("hr", "panel__sep"));
  box.appendChild(el("h3", "pane__title", "Course rounds"));
  box.appendChild(
    el(
      "p",
      "panel__note",
      "A round of a course is complete when every list has been tested and each list's last-test accuracy reaches this threshold. Only then can you advance to the next round.",
    ),
  );
  box.appendChild(el("label", "panel__field-label", "Required accuracy to advance (%)"));
  const thr = el("input", "text-input");
  thr.type = "number";
  thr.min = "0";
  thr.max = "100";
  thr.value = String(Math.round((state.settings.roundThreshold || 0.9) * 100));
  thr.addEventListener("change", () => {
    let v = parseInt(thr.value, 10);
    if (!Number.isFinite(v) || v < 0) v = 0;
    if (v > 100) v = 100;
    thr.value = String(v);
    state.settings = setSetting("roundThreshold", v / 100);
  });
  box.appendChild(thr);
  return box;
}

function accountsPane() {
  const box = el("div", "pane");
  box.appendChild(
    el(
      "p",
      "panel__note",
      "Each account is an independent progress profile (favorites, wrong book, study rounds, settings). The active account's data is what you study. Export/import act on a chosen account; the word library is shared and never part of an account.",
    ),
  );

  const goHomeReload = () => {
    location.hash = "#/";
    location.reload();
  };

  const btnRow = el("div", "panel__row");
  const saveAsBtn = el("button", "btn", "Save current as new account");
  saveAsBtn.addEventListener("click", async () => {
    const name = window.prompt("Name the new account (copies your current progress):", "");
    if (name === null) return;
    try {
      await duplicateCurrentAs(name.trim() || "Copy");
      refresh();
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  });
  const newBtn = el("button", "btn btn--ghost", "New empty account");
  newBtn.addEventListener("click", async () => {
    if (!confirm("Start a fresh empty account? Your current progress stays saved in its own account.")) return;
    const name = window.prompt("New account name:", "New account");
    if (name === null) return;
    try {
      await createAccount(name.trim() || "New account");
      goHomeReload();
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  });
  btnRow.append(saveAsBtn, newBtn);
  box.appendChild(btnRow);

  // Local-file storage status: in the Electron app, all accounts auto-save to
  // userData/save.json (with rotating backups). In a plain browser there is no
  // file — make that explicit so progress isn't silently trapped per-origin.
  if (isFileBacked()) {
    const fileRow = el("div", "panel__row");
    const revealBtn = el("button", "btn btn--ghost", "Open save folder");
    revealBtn.addEventListener("click", () => window.jpStore.reveal());
    const backupBtn = el("button", "btn btn--ghost", "Back up now");
    backupBtn.addEventListener("click", async () => {
      backupBtn.disabled = true;
      try {
        await flushNow();
        alert("Saved to the local file (a timestamped backup was added too).");
      } catch (e) {
        alert(`Backup failed: ${e.message}`);
      } finally {
        backupBtn.disabled = false;
      }
    });
    fileRow.append(revealBtn, backupBtn);
    box.appendChild(fileRow);
  } else {
    box.appendChild(
      el(
        "p",
        "panel__note panel__note--warn",
        "Debug mode (browser): progress is stored only in this browser/origin and is NOT saved to the local file. Different ports or browsers each get their own empty store. For durable storage use the packaged app; to move data between them, export here and import there.",
      ),
    );
  }

  const list = el("div", "slot-list");
  box.appendChild(list);

  // Hidden file input; after a file is picked we ask Merge / Replace.
  const file = el("input", "file-input");
  file.type = "file";
  file.accept = "application/json,.json";
  file.style.display = "none";
  let pendingId = null;
  file.addEventListener("change", () => {
    if (!file.files || !file.files[0] || !pendingId) return;
    askImportMode(pendingId, file.files[0]);
  });
  box.appendChild(file);

  function askImportMode(id, f) {
    const overlay = el("div", "modal");
    const card = el("div", "modal__card");
    card.appendChild(el("div", "modal__title", "Import into this account"));
    card.appendChild(el("p", "modal__text", `“${f.name}” — choose how to apply it:`));
    const row = el("div", "modal__btns");
    const run = async (mode) => {
      overlay.remove();
      file.value = "";
      pendingId = null;
      try {
        const r = await importIntoAccount(id, f, mode);
        if (r.active) goHomeReload();
        else {
          alert(`Imported (${mode}). ${r.counts.favorites}★ · ${r.counts.wrong_book}✗ · ${r.counts.rounds} rounds.`);
          refresh();
        }
      } catch (e) {
        alert(`Import failed: ${e.message}`);
      }
    };
    const merge = el("button", "btn", "Merge");
    merge.addEventListener("click", () => run("merge"));
    const replace = el("button", "btn btn--unknown", "Replace");
    replace.addEventListener("click", () => run("replace"));
    const cancel = el("button", "btn btn--ghost", "Cancel");
    cancel.addEventListener("click", () => {
      overlay.remove();
      file.value = "";
      pendingId = null;
    });
    row.append(merge, replace, cancel);
    card.appendChild(row);
    card.appendChild(el("p", "modal__hint", "Merge keeps existing items and adds the file's; Replace overwrites this account."));
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  async function refresh() {
    list.replaceChildren();
    const accts = await listAccounts();
    const aid = activeId();
    accts.forEach((a) => {
      const isActive = a.id === aid;
      const row = el("div", "slot" + (isActive ? " slot--active" : ""));
      const info = el("div", "slot__info");
      const nameEl = el("div", "slot__name", a.name);
      if (isActive) nameEl.appendChild(el("span", "slot__badge", "active"));
      info.appendChild(nameEl);
      const c = a.counts || {};
      info.appendChild(
        el(
          "div",
          "slot__meta",
          `${c.favorites || 0}★ · ${c.wrong_book || 0}✗ · ${c.rounds || 0} rounds${a.lastImportAt ? ` · imported ${new Date(a.lastImportAt).toLocaleDateString()}` : ""}`,
        ),
      );

      const actions = el("div", "slot__actions");
      if (!isActive) {
        actions.appendChild(
          iconBtn("use", "Use this account", async () => {
            try {
              await switchAccount(a.id);
              goHomeReload();
            } catch (e) {
              alert(`Failed: ${e.message}`);
            }
          }),
        );
      }
      actions.appendChild(iconBtn("export", "Export to file", () => exportAccount(a.id).catch((e) => alert(e.message))));
      actions.appendChild(
        iconBtn("import", "Import from file", () => {
          pendingId = a.id;
          file.click();
        }),
      );
      actions.appendChild(
        iconBtn("rename", "Rename", async () => {
          const n = window.prompt("Rename account:", a.name);
          if (n === null) return;
          await renameAccount(a.id, n.trim() || a.name);
          refresh();
        }),
      );
      actions.appendChild(
        iconBtn("delete", "Delete", async () => {
          const extra = isActive ? " It's the active account — another will be loaded." : "";
          if (!confirm(`Delete account “${a.name}”? This can't be undone.${extra}`)) return;
          const r = await removeAccount(a.id);
          if (r.switched) goHomeReload();
          else refresh();
        }),
      );
      row.append(info, actions);
      list.appendChild(row);
    });
  }
  refresh();
  return box;
}

function renderSettings() {
  clear();
  const back = el("a", "btn btn--ghost", "← Home");
  back.href = "#/";
  app.appendChild(back);
  app.appendChild(el("h1", "dash-title", "Settings"));

  const cats = [
    ["appearance", "Appearance", appearancePane],
    ["voice", "Voice", voicePane],
    ["accounts", "Accounts", accountsPane],
    ["study", "Study", studyPane],
    ["explanations", "Explanations", explanationsPane],
  ];

  const wrap = el("div", "settings");
  const nav = el("div", "settings__nav");
  const pane = el("div", "settings__pane");

  function select(key) {
    nav.querySelectorAll(".settings__navitem").forEach((n) =>
      n.classList.toggle("settings__navitem--active", n.dataset.key === key),
    );
    const cat = cats.find((c) => c[0] === key) || cats[0];
    pane.replaceChildren(cat[2]());
  }

  cats.forEach(([key, label]) => {
    const item = el("button", "settings__navitem", label);
    item.dataset.key = key;
    item.addEventListener("click", () => select(key));
    nav.appendChild(item);
  });

  wrap.append(nav, pane);
  app.appendChild(wrap);
  select("appearance");
}

// --- routing -------------------------------------------------------------

function route() {
  stopSpeech();
  if (state._cleanup) {
    state._cleanup();
    state._cleanup = null;
  }
  state._move = null;
  state._flip = null;
  app.classList.remove("app--wide", "app--full");

  const hash = location.hash.replace(/^#/, "");
  let m;
  if ((m = hash.match(/^\/kana(?:\/(.*))?$/))) state._cleanup = renderKana(app, m[1] || "");
  else if ((m = hash.match(/^\/list\/(.+)$/))) renderDeck(decodeURIComponent(m[1]));
  else if ((m = hash.match(/^\/wrong\/([^/]+)\/(\d+)$/))) renderWrong(decodeURIComponent(m[1]), parseInt(m[2], 10));
  else if ((m = hash.match(/^\/wrong\/(.+)$/))) renderWrong(decodeURIComponent(m[1]));
  else if (hash === "/wrong" || hash === "/test-wrong") renderWrong();
  else if (hash === "/favorites") renderFavorites();
  else if ((m = hash.match(/^\/course\/(.+)$/))) {
    app.classList.add("app--full");
    renderCourse(app, state.manifest, decodeURIComponent(m[1]));
  } else if (hash === "/backup" || hash === "/settings") renderSettings();
  else if (hash === "/dashboard") {
    app.classList.add("app--full");
    renderDashboard(app, state.manifest);
  } else renderHome();
}

document.addEventListener("keydown", (e) => {
  if (!state._move) return;
  if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if (e.key === "ArrowLeft") {
    state._move(-1);
    e.preventDefault();
  } else if (e.key === "ArrowRight") {
    state._move(1);
    e.preventDefault();
  } else if (e.key === " " || e.key === "Enter") {
    if (state._flip) state._flip();
    e.preventDefault();
  }
});

window.addEventListener("hashchange", route);

// Ask the browser to make storage persistent so the engine never evicts the
// user's IndexedDB (favorites / study log / wrong book / rounds / accounts) under
// disk pressure. In the Electron build the app loads from a stable app:// origin,
// where this is granted automatically; best-effort and harmless elsewhere.
async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) {
      const persisted = navigator.storage.persisted
        ? await navigator.storage.persisted()
        : false;
      if (!persisted) await navigator.storage.persist();
    }
  } catch {
    /* storage API unavailable; IndexedDB still works, just without the hint */
  }
}

async function init() {
  await requestPersistentStorage();
  applyTheme(state.settings.theme);
  applyShowReading(state.settings.showReading);
  try {
    state.manifest = await loadManifest();
  } catch (e) {
    app.appendChild(el("p", "error", `Could not load library: ${e.message}`));
    return;
  }
  try {
    // Electron only: make the local save file the source of truth before any
    // account logic reads accounts/activeAccountId. No-op in a plain browser.
    await bootReconcile();
  } catch (e) {
    console.error("file-store reconcile failed:", e);
  }
  try {
    await ensureActive();
  } catch {
    /* accounts unavailable; continue with live data */
  }
  try {
    state.favorites = new Set(await getAllFavoriteIds());
  } catch {
    state.favorites = new Set();
  }
  route();
}

// Flush any pending file save when the window is hidden or closed, so the last
// debounced changes aren't lost on quit (no-op in a plain browser).
window.addEventListener("pagehide", () => {
  flushNow();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushNow();
});

init();
