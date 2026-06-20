// Kana (五十音) subsystem — a distinct learning mode (SPEC §4B). It reuses the
// low-level plumbing (IndexedDB, TTS, explain, account snapshots) but has its
// own data shape, gojūon grid view, four study modes, Hepburn auto-grader, and a
// per-kana rolling-accuracy mastery model. It deliberately does NOT use the vocab
// list/round structure.

import { getSettings } from "./settings.js";
import { playSpeaker, resolveSpeaker, stopSpeech } from "./tts.js";
import { getAllKanaProgress, recordKanaResult } from "./db.js";
import { createKanaExplainPanel, kanaOriginShort } from "./explain.js";

const FILES = { hira: "hiragana.json", kata: "katakana.json" };
const SCRIPTS = [
  { key: "hira", label: "ひらがな", sub: "Hiragana" },
  { key: "kata", label: "カタカナ", sub: "Katakana" },
];
const CATEGORIES = [
  ["seion", "清音"],
  ["dakuon", "濁音"],
  ["handakuon", "半濁音"],
  ["yoon", "拗音"],
];

const _cache = {};

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

async function loadKana(script) {
  if (_cache[script]) return _cache[script];
  const LIB = typeof globalThis !== "undefined" ? globalThis.__JPLIB__ : null;
  if (LIB && LIB.kana && LIB.kana[script]) return (_cache[script] = LIB.kana[script]);
  const res = await fetch(`./kana/${FILES[script]}`);
  if (!res.ok) throw new Error(`kana/${FILES[script]}: ${res.status}`);
  return (_cache[script] = await res.json());
}

// Speak a kana through the shared TTS layer. Pre-generated VOICEVOX mp3s (via
// scripts/kana-tts.py) live on entry.audio; playSpeaker uses them when present
// and falls back to the browser voice otherwise.
function speakKana(entry) {
  const s = getSettings();
  const pseudo = { reading: entry.kana, front: entry.kana, audio: entry.audio || undefined };
  playSpeaker(pseudo, resolveSpeaker(s), s);
}

function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

// --- mastery -------------------------------------------------------------

// "Mastered" = answered correctly 3 times in a row (streak ≥ 3). A streak is a
// recent-correctness signal, so it's resilient to early mistakes and easy to
// explain to the user; a single miss resets it, surfacing the kana for review.
const MASTERED_STREAK = 3;

function accuracy(rec) {
  return rec && rec.attempts ? rec.correct / rec.attempts : null;
}
function isMastered(rec) {
  return !!(rec && (rec.streak || 0) >= MASTERED_STREAK);
}
function masteryClass(rec) {
  if (!rec || !rec.attempts) return ""; // not studied yet
  const s = rec.streak || 0;
  if (s >= MASTERED_STREAK) return "kana-cell--m3"; // mastered
  if (s >= 1) return "kana-cell--m2"; // on a correct streak, not yet mastered
  return "kana-cell--m1"; // last attempt was wrong → needs review
}

async function progressMap() {
  const recs = await getAllKanaProgress().catch(() => []);
  return new Map(recs.map((r) => [r.id, r]));
}

// --- shared UI bits ------------------------------------------------------

function topBar(title, backHref, backLabel) {
  const bar = el("div", "deck-bar");
  const left = el("div", "deck-bar__side");
  const back = el("a", "btn btn--ghost", backLabel || "← Back");
  back.href = backHref;
  left.appendChild(back);
  bar.append(left, el("div", "deck-title", title), el("div", "deck-bar__side"));
  return bar;
}

function chipRow(options, active, onPick) {
  const row = el("div", "scope-bar");
  options.forEach(([key, label]) => {
    const chip = el("button", "chip" + (key === active ? " chip--active" : ""), label);
    chip.addEventListener("click", () => {
      row.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip--active"));
      chip.classList.add("chip--active");
      onPick(key);
    });
    row.appendChild(chip);
  });
  return row;
}

// Progress ring (SVG): fraction 0..1, an inner % and a caption. `inner` overrides
// the centered text (e.g. a count instead of a percentage).
function ring(fraction, label, size = 84, inner) {
  const f = Math.max(0, Math.min(1, fraction || 0));
  const cx = size / 2;
  const sw = Math.max(6, Math.round(size / 12));
  const r = cx - sw / 2 - 1;
  const c = 2 * Math.PI * r;
  const off = (c * (1 - f)).toFixed(1);
  const wrap = el("div", "kana-ring");
  wrap.innerHTML =
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--chart-track)" stroke-width="${sw}"/>` +
    `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--chart-accent)" stroke-width="${sw}" ` +
    `stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off}" ` +
    `transform="rotate(-90 ${cx} ${cx})"/>` +
    `<text x="${cx}" y="${cx + size * 0.06}" text-anchor="middle" class="kana-ring__pct">${inner != null ? inner : Math.round(f * 100) + "%"}</text></svg>` +
    `<div class="kana-ring__label">${label}</div>`;
  return wrap;
}

// --- home (script chooser + overall progress) ----------------------------

async function renderHome(app) {
  app.replaceChildren();
  app.appendChild(topBar("仮名 · Kana", "#/", "← Home"));
  app.appendChild(el("p", "kana-intro", "Learn the Japanese syllabaries — recognize the closed set, then drill the confusable ones. Separate from the vocabulary decks."));

  const pm = await progressMap();
  const grid = el("div", "kana-home");
  for (const s of SCRIPTS) {
    const data = await loadKana(s.key).catch(() => null);
    const card = el("a", "kana-home__card");
    card.href = `#/kana/${s.key}`;
    const head = el("div", "kana-home__head");
    head.append(el("span", "kana-home__glyph", s.label), el("span", "kana-home__sub", s.sub));
    card.appendChild(head);
    if (data) {
      const total = data.kana.length;
      let studied = 0, mastered = 0, att = 0, cor = 0;
      data.kana.forEach((k) => {
        const r = pm.get(k.id);
        if (r && r.attempts) {
          studied++;
          att += r.attempts;
          cor += r.correct;
          if (isMastered(r)) mastered++;
        }
      });
      const acc = att ? cor / att : 0;
      const rings = el("div", "kana-rings");
      rings.append(
        ring(total ? studied / total : 0, `Studied · ${studied}/${total}`, 66),
        ring(total ? mastered / total : 0, `Mastered · ${mastered}/${total}`, 66),
        ring(acc, `Accuracy`, 66),
      );
      card.appendChild(rings);
    }
    grid.appendChild(card);
  }
  app.appendChild(grid);
}

// --- overview (gojūon grid) ----------------------------------------------

async function renderOverview(app, script) {
  app.replaceChildren();
  const meta = SCRIPTS.find((s) => s.key === script);
  if (!meta) return void app.appendChild(el("p", "error", `Unknown kana set: ${script}`));
  app.appendChild(topBar(`${meta.label} · ${meta.sub}`, "#/kana", "← Kana"));

  let data, pm;
  try {
    data = await loadKana(script);
    pm = await progressMap();
  } catch (e) {
    return void app.appendChild(el("p", "error", `Failed to load kana: ${e.message}`));
  }
  // The other script, so the detail panel can link あ ⇄ ア (same sound).
  let otherData = null;
  try {
    otherData = await loadKana(script === "hira" ? "kata" : "hira");
  } catch {
    /* counterpart linking is best-effort */
  }
  const byScript = { [data.script]: data };
  if (otherData) byScript[otherData.script] = otherData;
  const SCRIPT_NAME = { hira: "ひらがな", kata: "カタカナ" };
  // The same syllable in the opposite script. Both datasets are generated in the
  // same order, so index alignment is the counterpart; romaji+type is a fallback.
  function counterpartOf(entry) {
    const opp = entry.script === "hira" ? "kata" : "hira";
    const od = byScript[opp];
    const self = byScript[entry.script];
    if (!od || !self) return null;
    const idx = self.kana.findIndex((k) => k.id === entry.id);
    let c = idx >= 0 ? od.kana[idx] : null;
    if (!c || c.romaji !== entry.romaji || c.type !== entry.type) {
      c = od.kana.find((k) => k.romaji === entry.romaji && k.type === entry.type) || null;
    }
    return c;
  }

  // Study-mode launchers.
  const modes = el("div", "kana-modes");
  [
    ["recognize", "Recognize", "kana → romaji, self-graded"],
    ["listen", "Listen & ID", "hear it, pick the kana"],
    ["input", "Romaji input", "type it, auto-graded"],
    ["lookalike", "Look-alikes", "drill confusable kana"],
  ].forEach(([m, label, desc]) => {
    const a = el("a", "kana-mode");
    a.href = `#/kana/${script}/${m}`;
    a.append(el("span", "kana-mode__label", label), el("span", "kana-mode__desc", desc));
    modes.appendChild(a);
  });
  app.appendChild(modes);

  // Secondary entries: review (wrong book) + dashboard for this script.
  const tools = el("div", "kana-tools");
  [["review", "✗ Review"], ["dashboard", "▤ Dashboard"]].forEach(([m, label]) => {
    const a = el("a", "btn btn--ghost");
    a.href = `#/kana/${script}/${m}`;
    a.textContent = label;
    tools.appendChild(a);
  });
  app.appendChild(tools);

  let category = "seion";
  const gridHost = el("div", "kana-grid-host");
  const detail = el("div", "kana-detail");
  const detailHint = () =>
    detail.replaceChildren(el("p", "kana-detail__hint", "Tap a kana to see its reading, origin, mnemonic, and how to tell it apart from look-alikes."));
  detailHint();

  const cat = chipRow(CATEGORIES, category, (k) => {
    category = k;
    renderGrid();
  });
  // Grid on the left, detail/explain panel beside it (fills the empty space).
  const board = el("div", "kana-board");
  board.append(gridHost, detail);
  app.append(cat, board);

  // Special notes (sokuon / long vowels) under the grid.
  const notes = el("div", "kana-notes");
  (data.special || []).forEach((sp) => {
    const n = el("div", "kana-note");
    n.append(el("div", "kana-note__title", `${sp.kana} · ${sp.title}`), el("div", "kana-note__body", sp.note));
    notes.appendChild(n);
  });
  app.appendChild(notes);

  let selectedCell = null;
  function cell(entry) {
    const c = el("button", "kana-cell " + masteryClass(pm.get(entry.id)));
    c.dataset.flipped = "false";
    c.append(el("span", "kana-cell__kana", entry.kana), el("span", "kana-cell__romaji", entry.romaji));
    c.addEventListener("click", () => {
      c.dataset.flipped = c.dataset.flipped === "true" ? "false" : "true";
      if (selectedCell && selectedCell !== c) selectedCell.classList.remove("kana-cell--selected");
      selectedCell = c;
      c.classList.add("kana-cell--selected");
      speakKana(entry);
      showDetail(entry);
    });
    return c;
  }

  function renderGrid() {
    selectedCell = null; // cells are rebuilt; drop the stale reference
    gridHost.replaceChildren();
    const items = data.kana.filter((k) => k.type === category);
    if (category === "seion") {
      // 5-column gojūon layout using row/col (blanks kept as gaps).
      const grid = el("div", "kana-grid kana-grid--seion");
      const byRow = new Map();
      items.forEach((k) => {
        if (!byRow.has(k.row)) byRow.set(k.row, new Array(5).fill(null));
        byRow.get(k.row)[k.col] = k;
      });
      [...byRow.keys()].sort((a, b) => a - b).forEach((r) => {
        byRow.get(r).forEach((k) => grid.appendChild(k ? cell(k) : el("span", "kana-cell kana-cell--blank")));
      });
      gridHost.appendChild(grid);
    } else {
      const grid = el("div", "kana-grid kana-grid--flow");
      items.forEach((k) => grid.appendChild(cell(k)));
      gridHost.appendChild(grid);
    }
  }

  function showDetail(entry) {
    detail.replaceChildren();
    const head = el("div", "kana-detail__head");

    // Hero: the big glyph + a play button right under it.
    const hero = el("div", "kana-detail__hero");
    const glyph = el("button", "kana-detail__glyph");
    glyph.textContent = entry.kana;
    glyph.title = "Play";
    glyph.addEventListener("click", () => speakKana(entry));
    hero.appendChild(glyph);
    const play = el("button", "kana-detail__play", "🔊");
    play.title = "Play";
    play.addEventListener("click", () => speakKana(entry));
    hero.appendChild(play);
    head.appendChild(hero);

    const info = el("div", "kana-detail__info");
    info.appendChild(el("div", "kana-detail__romaji", entry.romaji));
    const lang = getSettings().explainLang;
    if (entry.position) info.appendChild(el("div", "kana-detail__pos", entry.position));
    if (entry.origin) info.appendChild(el("div", "kana-detail__origin", kanaOriginShort(entry.origin, lang)));
    const rec = pm.get(entry.id);
    if (rec && rec.attempts) {
      info.appendChild(el("div", "kana-detail__stat", `${Math.round(accuracy(rec) * 100)}% · ${rec.attempts} tries`));
    }

    // Counterpart link: jump between hiragana and katakana of the same sound.
    const cp = counterpartOf(entry);
    if (cp) {
      const link = el("button", "kana-cp");
      link.append(
        el("span", "kana-cp__arrow", "⇄"),
        el("span", "kana-cp__glyph", cp.kana),
        el("span", "kana-cp__label", SCRIPT_NAME[cp.script] || ""),
      );
      link.title = `Show ${cp.kana} (${cp.script === "kata" ? "katakana" : "hiragana"})`;
      link.addEventListener("click", () => {
        speakKana(cp);
        showDetail(cp);
      });
      info.appendChild(link);
    }
    head.appendChild(info);
    detail.appendChild(head);
    detail.appendChild(createKanaExplainPanel(entry).element);
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  renderGrid();
}

// --- study session scaffolding -------------------------------------------
// Returns a cleanup that removes any global key handler the mode installed.

function sessionItems(data, category) {
  return data.kana.filter((k) => k.type === category);
}

function progressBar(done, total) {
  const wrap = el("div", "kana-quiz__progress");
  const fill = el("div", "kana-quiz__progress-fill");
  fill.style.width = `${total ? (done / total) * 100 : 0}%`;
  wrap.appendChild(fill);
  return wrap;
}

// 1) Recognize — flip card, self-grade Known / Unknown. `fixedItems` (optional)
// runs the drill over a specific set (used by the review / wrong-book page)
// instead of a category.
function renderRecognize(app, script, data, fixedItems) {
  let category = "seion";
  let order = [];
  let idx = 0;
  let known = 0;
  const host = el("div", "kana-quiz");
  app.appendChild(host);

  function start() {
    order = shuffle(fixedItems || sessionItems(data, category));
    idx = 0;
    known = 0;
    step();
  }
  function step() {
    host.replaceChildren();
    if (idx >= order.length) return finish();
    const entry = order[idx];
    host.appendChild(progressBar(idx, order.length));
    const card = el("div", "kana-flip");
    card.dataset.flipped = "false";
    const front = el("div", "kana-flip__face kana-flip__front", entry.kana);
    const back = el("div", "kana-flip__face kana-flip__back");
    back.append(el("div", "kana-flip__romaji", entry.romaji), el("div", "kana-flip__origin", entry.origin ? `from 「${entry.origin}」` : ""));
    card.append(front, back);
    let flipped = false;
    const flip = () => {
      flipped = !flipped;
      card.dataset.flipped = flipped ? "true" : "false";
      if (flipped) speakKana(entry);
      grade.style.visibility = flipped ? "visible" : "hidden";
    };
    card.addEventListener("click", flip);
    host.appendChild(card);

    const grade = el("div", "kana-quiz__grade");
    grade.style.visibility = "hidden";
    const no = el("button", "btn btn--unknown", "✗ Unknown");
    const yes = el("button", "btn", "Known ✓");
    no.addEventListener("click", () => answer(false));
    yes.addEventListener("click", () => answer(true));
    grade.append(no, yes);
    host.appendChild(grade);
    host.appendChild(el("p", "hint", "Click the card to reveal · then grade yourself"));
    host._flip = flip;
    host._answer = (k) => flipped && answer(k);
  }
  async function answer(correct) {
    const entry = order[idx];
    if (correct) known++;
    await recordKanaResult(entry.id, correct);
    idx++;
    step();
  }
  function finish() {
    host.replaceChildren();
    host._flip = null;
    host._answer = null;
    host.appendChild(el("div", "kana-quiz__done", `${known} / ${order.length} known`));
    const again = el("button", "btn", "Study again");
    again.addEventListener("click", start);
    host.appendChild(again);
  }

  if (!fixedItems) app.insertBefore(chipRow(CATEGORIES, category, (k) => { category = k; start(); }), host);
  start();

  const onKey = (e) => {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if ((e.key === " " || e.key === "Enter") && host._flip) { host._flip(); e.preventDefault(); }
    else if (e.key === "ArrowLeft" && host._answer) { host._answer(false); e.preventDefault(); }
    else if (e.key === "ArrowRight" && host._answer) { host._answer(true); e.preventDefault(); }
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}

// Shared multiple-choice runner used by Listen & Look-alike modes.
// promptFor(entry, host) renders the question; choicesFor(entry, pool) returns
// the option entries (one correct).
function renderChoiceQuiz(app, data, { categoryAware, promptFor, choicesFor, hint }) {
  let category = "seion";
  let order = [];
  let idx = 0;
  let correctCount = 0;
  const host = el("div", "kana-quiz");
  if (categoryAware) app.appendChild(chipRow(CATEGORIES, category, (k) => { category = k; start(); }));
  app.appendChild(host);

  function pool() {
    return categoryAware ? sessionItems(data, category) : data.kana;
  }
  function start() {
    const items = pool();
    order = shuffle(items).slice(0, Math.min(20, items.length));
    idx = 0;
    correctCount = 0;
    step();
  }
  function step() {
    host.replaceChildren();
    if (idx >= order.length) return finish();
    const entry = order[idx];
    host.appendChild(progressBar(idx, order.length));
    host.appendChild(promptFor(entry, host));
    const choices = choicesFor(entry, pool());
    const grid = el("div", "kana-choices");
    let answered = false;
    choices.forEach((ch) => {
      const b = el("button", "kana-choice", ch.kana);
      b.addEventListener("click", async () => {
        if (answered) return;
        answered = true;
        const ok = ch.id === entry.id;
        b.classList.add(ok ? "kana-choice--right" : "kana-choice--wrong");
        if (!ok) grid.querySelectorAll(".kana-choice").forEach((x, i) => { if (choices[i].id === entry.id) x.classList.add("kana-choice--right"); });
        if (ok) correctCount++;
        await recordKanaResult(entry.id, ok);
        setTimeout(() => { idx++; step(); }, ok ? 450 : 950);
      });
      grid.appendChild(b);
    });
    host.appendChild(grid);
    if (hint) host.appendChild(el("p", "hint", hint));
  }
  function finish() {
    host.replaceChildren();
    host.appendChild(el("div", "kana-quiz__done", `${correctCount} / ${order.length} correct`));
    const again = el("button", "btn", "Again");
    again.addEventListener("click", start);
    host.appendChild(again);
  }
  start();
  return () => {};
}

// 2) Listen & identify — play audio, pick the kana.
function renderListen(app, script, data) {
  return renderChoiceQuiz(app, data, {
    categoryAware: true,
    hint: "Listen, then tap the kana you heard.",
    promptFor: (entry) => {
      const p = el("div", "kana-quiz__listen");
      const play = el("button", "kana-quiz__playbtn", "🔊");
      play.title = "Play again";
      play.addEventListener("click", () => speakKana(entry));
      p.appendChild(play);
      speakKana(entry);
      return p;
    },
    choicesFor: (entry, pool) => {
      const others = shuffle(pool.filter((k) => k.id !== entry.id)).slice(0, 5);
      return shuffle([entry, ...others]);
    },
  });
}

// 4) Look-alike drill — show romaji, choose the right glyph among confusables.
function renderLookalike(app, script, data) {
  // Only quiz kana that actually belong to a confusion group.
  const inGroup = data.kana.filter((k) => (k.lookalikes || []).length);
  if (!inGroup.length) {
    app.appendChild(el("p", "hint", "No look-alike groups defined for this script."));
    return () => {};
  }
  const subset = { ...data, kana: inGroup };
  return renderChoiceQuiz(app, subset, {
    categoryAware: false,
    hint: "These kana look alike — pick the one that matches the romaji.",
    promptFor: (entry) => {
      const p = el("div", "kana-quiz__prompt");
      p.appendChild(el("div", "kana-quiz__romaji", entry.romaji));
      const play = el("button", "btn btn--ghost", "🔊 Hear it");
      play.addEventListener("click", () => speakKana(entry));
      p.appendChild(play);
      return p;
    },
    // Choices = the kana itself + its specific look-alikes (the discrimination set).
    choicesFor: (entry) => {
      const looks = (entry.lookalikes || []).map((id) => data.kana.find((k) => k.id === id)).filter(Boolean);
      return shuffle([entry, ...looks]);
    },
  });
}

// 3) Romaji input — type romaji, auto-grade against Hepburn (+ kunrei alternates).
function renderInput(app, script, data) {
  let category = "seion";
  let order = [];
  let idx = 0;
  let correctCount = 0;
  const host = el("div", "kana-quiz");
  app.appendChild(chipRow(CATEGORIES, category, (k) => { category = k; start(); }));
  app.appendChild(host);

  function start() {
    order = shuffle(sessionItems(data, category));
    idx = 0;
    correctCount = 0;
    step();
  }
  function step() {
    host.replaceChildren();
    if (idx >= order.length) return finish();
    const entry = order[idx];
    host.appendChild(progressBar(idx, order.length));
    host.appendChild(el("div", "kana-quiz__bigglyph", entry.kana));
    speakKana(entry);

    const form = el("form", "kana-quiz__inputrow");
    const input = el("input", "text-input kana-quiz__input");
    input.type = "text";
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "type romaji…";
    const submit = el("button", "btn", "Check");
    submit.type = "submit";
    form.append(input, submit);
    host.appendChild(form);
    const feedback = el("div", "kana-quiz__feedback");
    host.appendChild(feedback);
    setTimeout(() => input.focus(), 0);

    let graded = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (graded) { idx++; step(); return; } // Enter again → next
      const guess = input.value.trim().toLowerCase();
      if (!guess) return;
      const ok = (entry.accepts || [entry.romaji]).includes(guess);
      graded = true;
      input.disabled = true;
      submit.textContent = "Next →";
      feedback.className = "kana-quiz__feedback " + (ok ? "kana-quiz__feedback--ok" : "kana-quiz__feedback--no");
      feedback.textContent = ok ? `✓ ${entry.romaji}` : `✗ ${entry.kana} = ${entry.romaji}`;
      if (ok) correctCount++;
      await recordKanaResult(entry.id, ok);
      submit.focus();
    });
  }
  function finish() {
    host.replaceChildren();
    host.appendChild(el("div", "kana-quiz__done", `${correctCount} / ${order.length} correct`));
    const again = el("button", "btn", "Again");
    again.addEventListener("click", start);
    host.appendChild(again);
  }
  start();
  return () => {};
}

// --- wrong book (review) -------------------------------------------------
// A kana is "weak" when its most recent attempt was wrong, or its rolling
// accuracy is below 50%. These surface here for focused re-drilling; getting
// them right (accuracy climbs, last attempt correct) clears them automatically.
function weakKana(data, pm) {
  return data.kana.filter((k) => {
    const r = pm.get(k.id);
    if (!r || !r.attempts) return false;
    return r.last_result === "wrong" || r.correct / r.attempts < 0.5;
  });
}

function renderReview(app, script, data) {
  let inner = null;
  (async () => {
    const pm = await progressMap();
    const weak = weakKana(data, pm);
    const wrap = el("div", "kana-review");
    app.appendChild(wrap);
    if (!weak.length) {
      wrap.appendChild(el("p", "hint", "No weak kana yet — anything you miss in the study modes will collect here for review."));
      return;
    }
    const bar = el("div", "kana-review__bar");
    bar.appendChild(el("div", "kana-review__count", `${weak.length} kana to review`));
    const drill = el("button", "btn", "Drill these →");
    bar.appendChild(drill);
    wrap.appendChild(bar);

    const grid = el("div", "kana-grid kana-grid--flow");
    weak.forEach((k) => {
      const r = pm.get(k.id);
      const c = el("button", "kana-cell " + masteryClass(r));
      c.append(el("span", "kana-cell__kana", k.kana), el("span", "kana-cell__romaji", `${k.romaji} · ${Math.round((r.correct / r.attempts) * 100)}%`));
      c.classList.add("kana-cell--show");
      c.addEventListener("click", () => speakKana(k));
      grid.appendChild(c);
    });
    wrap.appendChild(grid);

    drill.addEventListener("click", () => {
      wrap.remove();
      if (inner) inner();
      inner = renderRecognize(app, script, data, weak);
    });
  })();
  return () => { if (inner) inner(); };
}

// --- dashboard -----------------------------------------------------------
function statTile(label, value) {
  const t = el("div", "kana-stat");
  t.append(el("div", "kana-stat__val", `${value}`), el("div", "kana-stat__label", label));
  return t;
}

function progressRow(label, done, total) {
  const row = el("div", "kana-prow");
  row.appendChild(el("div", "kana-prow__label", label));
  const track = el("div", "kana-prow__track");
  const fill = el("div", "kana-prow__fill");
  fill.style.width = `${total ? (done / total) * 100 : 0}%`;
  track.appendChild(fill);
  row.appendChild(track);
  row.appendChild(el("div", "kana-prow__count", `${done}/${total}`));
  return row;
}

function renderDashboard(app, script, data) {
  (async () => {
    const pm = await progressMap();
    const wrap = el("div", "kana-dash");
    app.appendChild(wrap);

    const total = data.kana.length;
    const mastered = data.kana.filter((k) => isMastered(pm.get(k.id))).length;
    const studied = data.kana.filter((k) => pm.get(k.id) && pm.get(k.id).attempts).length;
    const weak = weakKana(data, pm).length;
    const attempts = [...pm.values()].reduce((n, r) => n + (r.attempts || 0), 0);

    const top = el("div", "kana-dash__top");
    top.appendChild(ring(total ? mastered / total : 0, `${mastered}/${total} mastered`));
    const totals = el("div", "kana-dash__totals");
    [["Studied", studied], ["Mastered", mastered], ["Need review", weak], ["Attempts", attempts]].forEach(([l, v]) => totals.appendChild(statTile(l, v)));
    top.appendChild(totals);
    wrap.appendChild(top);

    // Explain the mastery model + color legend so the numbers are unambiguous.
    const legend = el("div", "kana-legend");
    legend.appendChild(el("span", "kana-legend__note", `Mastered = answered correctly ${MASTERED_STREAK} times in a row. One miss resets the streak and the kana returns to review.`));
    const swatches = el("div", "kana-legend__swatches");
    [["kana-cell--m1", "missed last time"], ["kana-cell--m2", "on a streak"], ["kana-cell--m3", "mastered"]].forEach(([cls, label]) => {
      const s = el("span", "kana-legend__item");
      s.append(el("span", `kana-legend__dot ${cls}`), el("span", null, label));
      swatches.appendChild(s);
    });
    legend.appendChild(swatches);
    wrap.appendChild(legend);

    wrap.appendChild(el("h3", "kana-dash__h", "By category"));
    CATEGORIES.forEach(([key, label]) => {
      const items = data.kana.filter((k) => k.type === key);
      const m = items.filter((k) => isMastered(pm.get(k.id))).length;
      wrap.appendChild(progressRow(label, m, items.length));
    });

    // Coverage heat — every kana tinted by mastery (read-only mirror of the grid).
    wrap.appendChild(el("h3", "kana-dash__h", "Coverage"));
    const heat = el("div", "kana-grid kana-grid--flow kana-heat");
    data.kana.forEach((k) => {
      const cellEl = el("span", "kana-cell kana-cell--show " + masteryClass(pm.get(k.id)));
      cellEl.append(el("span", "kana-cell__kana", k.kana));
      cellEl.title = (() => { const r = pm.get(k.id); return r && r.attempts ? `${Math.round((r.correct / r.attempts) * 100)}% / ${r.attempts}` : "not studied"; })();
      heat.appendChild(cellEl);
    });
    wrap.appendChild(heat);

    // Most-missed kana (by number of wrong attempts).
    const missed = data.kana
      .map((k) => ({ k, r: pm.get(k.id) }))
      .filter((x) => x.r && x.r.attempts && x.r.attempts - x.r.correct > 0)
      .sort((a, b) => (b.r.attempts - b.r.correct) - (a.r.attempts - a.r.correct))
      .slice(0, 12);
    if (missed.length) {
      wrap.appendChild(el("h3", "kana-dash__h", "Most missed"));
      const list = el("div", "kana-missed");
      missed.forEach(({ k, r }) => {
        const item = el("div", "kana-missed__item");
        item.append(
          el("span", "kana-missed__glyph", k.kana),
          el("span", "kana-missed__romaji", k.romaji),
          el("span", "kana-missed__stat", `${r.attempts - r.correct}× wrong · ${Math.round((r.correct / r.attempts) * 100)}%`),
        );
        list.appendChild(item);
      });
      wrap.appendChild(list);
    }
  })();
  return () => {};
}

const MODE_RENDERERS = {
  recognize: renderRecognize,
  listen: renderListen,
  input: renderInput,
  lookalike: renderLookalike,
  review: renderReview,
  dashboard: renderDashboard,
};
const MODE_TITLES = {
  recognize: "Recognize",
  listen: "Listen & Identify",
  input: "Romaji Input",
  lookalike: "Look-alike Drill",
  review: "Review (Wrong Book)",
  dashboard: "Dashboard",
};

async function renderMode(app, script, mode) {
  app.replaceChildren();
  const meta = SCRIPTS.find((s) => s.key === script);
  if (!meta || !MODE_RENDERERS[mode]) return void app.appendChild(el("p", "error", "Unknown kana mode."));
  app.appendChild(topBar(`${meta.sub} · ${MODE_TITLES[mode]}`, `#/kana/${script}`, "← Overview"));
  let data;
  try {
    data = await loadKana(script);
  } catch (e) {
    return void app.appendChild(el("p", "error", `Failed to load kana: ${e.message}`));
  }
  return MODE_RENDERERS[mode](app, script, data);
}

// --- entry point (called by the router) ----------------------------------
// sub is the path after "kana/": "" | "hira" | "hira/input" ...
// Returns a cleanup function (or undefined) for the router to call on exit.
export function renderKana(app, sub) {
  stopSpeech();
  app.classList.add("app--wide");
  let cleanup;
  const parts = (sub || "").split("/").filter(Boolean);
  if (!parts.length) renderHome(app);
  else if (parts.length === 1) renderOverview(app, parts[0]);
  else {
    // renderMode is async and returns the mode's cleanup; capture it.
    renderMode(app, parts[0], parts[1]).then((c) => (cleanup = c));
  }
  return () => {
    stopSpeech();
    if (cleanup) cleanup();
  };
}
