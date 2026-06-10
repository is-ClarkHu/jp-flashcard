// Self-test mode (§4.3) + wrong book (§4.4).
// Show the Japanese, recall, reveal (free flip back and forth), then mark
// Known / Unknown. Unknown -> wrong_book (++); Known -> wrong_book (--, removed
// at 0). Finishing a real list appends one entry to rounds.history. Cards can be
// favorited mid-test.

import { createCard } from "./card.js";
import { getSettings, setSetting } from "./settings.js";
import { PROVIDERS, getProvider, stopSpeech } from "./tts.js";
import { markWrong, markKnown, toggleFavorite, addStudyLog, getWrongCount, getCourseRound } from "./db.js";
import { courseOfList } from "./progress.js";

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

// Render the self-test. `favorites` is a live Set kept in sync. Returns a
// cleanup fn that removes the key handler.
export function renderQuiz(app, { title, cards, listId, favorites, onExit }) {
  const settings = getSettings();
  const shuffle = (a) => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  let pool = cards; // current set being tested (all, or just the missed ones on retest)
  let queue = shuffle(pool); // self-test order is always randomized
  let index = 0;
  let known = 0;
  let unknown = 0;
  let wrongIds = []; // ids marked Unknown this round (to reverse if the record is deleted)
  let wrongCards = []; // the actual cards missed this round (for the result page)
  let reactions = []; // per-card { id, ms, result } for timing analysis
  let revealed = false;
  let finishing = false;
  let retestMode = false; // retesting missed cards: correct does NOT clear the wrong book
  let timedOut = false;
  let timerOn = settings.timerEnabled;
  let timerId = null;
  let timerLeft = 0;
  let shownAt = 0;
  let card = null;

  app.replaceChildren();

  const bar = el("div", "deck-bar");
  const left = el("div", "deck-bar__side");
  const back = el("button", "btn btn--ghost", "← Back");
  back.addEventListener("click", () => exit());
  left.appendChild(back);
  const timerBtn = el("button", "btn btn--ghost");
  const timerLabel = () => (timerOn ? `⏱ ${settings.timerSeconds}s` : "⏱ off");
  timerBtn.title = "Per-word countdown";
  timerBtn.textContent = timerLabel();
  timerBtn.classList.toggle("btn--active", timerOn);
  timerBtn.addEventListener("click", () => {
    timerOn = !timerOn;
    setSetting("timerEnabled", timerOn);
    timerBtn.textContent = timerLabel();
    timerBtn.classList.toggle("btn--active", timerOn);
    if (!timerOn) clearTimer();
    else if (!revealed && !timedOut && queue[index]) startTimer();
  });
  const score = el("div", "quiz-score");
  const right = el("div", "deck-bar__side");
  right.append(timerBtn, score);
  bar.append(left, el("div", "deck-title", `Self-test · ${title}`), right);
  app.appendChild(bar);

  const progress = el("div", "quiz-progress");
  const barFill = el("div", "quiz-progress__fill");
  progress.appendChild(barFill);
  app.appendChild(progress);

  const timerBadge = el("div", "timer-badge");
  timerBadge.style.display = "none";
  app.appendChild(timerBadge);

  const stage = el("div", "stage");
  const cardWrap = el("div", "card-wrap");
  const star = el("button", "fav-btn");
  star.title = "Favorite (F)";
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFav();
  });
  cardWrap.appendChild(star);
  stage.appendChild(cardWrap);
  app.appendChild(stage);

  const speakers = el("div", "speakers");
  PROVIDERS.forEach((p) => {
    const b = el("button", "speaker-btn");
    b.append(speakerIcon(), el("span", null, p.label));
    b.addEventListener("click", () => {
      if (queue[index]) getProvider(p.id).play(queue[index], settings);
    });
    speakers.appendChild(b);
  });
  app.appendChild(speakers);

  const actions = el("div", "quiz-actions");
  app.appendChild(actions);

  const hint = el("p", "hint", "Space: flip · ← Unknown · → Known · F: favorite");
  app.appendChild(hint);

  function updateScore() {
    score.textContent = `✓ ${known}  ✗ ${unknown}`;
    barFill.style.width = `${(index / queue.length) * 100}%`;
  }

  function updateStar() {
    const fav = queue[index] && favorites.has(queue[index].id);
    star.textContent = fav ? "★" : "☆";
    star.classList.toggle("fav-btn--on", !!fav);
  }

  async function toggleFav() {
    const c = queue[index];
    if (!c) return;
    const isFav = favorites.has(c.id);
    const nowFav = await toggleFavorite(c.id, isFav);
    if (nowFav) favorites.add(c.id);
    else favorites.delete(c.id);
    updateStar();
  }

  function showQuestion() {
    stopSpeech();
    clearTimer();
    revealed = false;
    timedOut = false;
    card = createCard(queue[index], { defaultFace: "front", onFlip });
    cardWrap.replaceChildren(star, card.element);
    updateScore();
    updateStar();

    const showBtn = el("button", "btn quiz-show", "Show answer");
    showBtn.addEventListener("click", () => card.flip());
    actions.replaceChildren(showBtn);

    shownAt = Date.now();
    startTimer();
  }

  // First flip reveals the grade buttons; further flips just toggle the card.
  function onFlip() {
    if (revealed) return;
    revealed = true;
    clearTimer();
    const unknownBtn = el("button", "btn btn--unknown", "‹ Unknown");
    const knownBtn = el("button", "btn btn--known", "Known ›");
    unknownBtn.addEventListener("click", () => grade(false));
    knownBtn.addEventListener("click", () => grade(true));
    actions.replaceChildren(unknownBtn, knownBtn);
  }

  function startTimer() {
    if (!timerOn || revealed) return;
    timerLeft = settings.timerSeconds;
    timerBadge.style.display = "";
    timerBadge.textContent = `⏱ ${timerLeft}s`;
    timerId = setInterval(() => {
      timerLeft -= 1;
      timerBadge.textContent = `⏱ ${Math.max(0, timerLeft)}s`;
      if (timerLeft <= 0) onTimeout();
    }, 1000);
  }
  function clearTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    timerBadge.style.display = "none";
  }
  function onTimeout() {
    clearTimer();
    if (revealed || finishing || index >= queue.length) return;
    revealed = true;
    timedOut = true;
    if (card) card.flip(); // reveal the answer (onFlip returns early: revealed is set)
    const c = queue[index];
    unknown += 1;
    wrongIds.push(c.id);
    wrongCards.push(c);
    markWrong(c.id);
    reactions.push({ id: c.id, ms: settings.timerSeconds * 1000, result: "timeout" });
    updateScore();
    const next = el("button", "btn btn--unknown", "Time's up — Next →");
    next.addEventListener("click", advance);
    actions.replaceChildren(next);
  }

  function advance() {
    index += 1;
    if (index >= queue.length) finish();
    else showQuestion();
  }

  function grade(ok) {
    if (finishing || index >= queue.length) return;
    const c = queue[index];
    if (!c) return;
    reactions.push({ id: c.id, ms: Date.now() - shownAt, result: ok ? "known" : "unknown" });
    clearTimer();
    if (ok) {
      known += 1;
      if (!retestMode) markKnown(c.id); // retest: a correct answer must not remove it
    } else {
      unknown += 1;
      wrongIds.push(c.id);
      wrongCards.push(c);
      markWrong(c.id);
    }
    advance();
  }

  async function finish() {
    if (finishing) return;
    finishing = true;
    stopSpeech();
    clearTimer();
    updateScore();
    barFill.style.width = "100%";

    const totalMs = reactions.reduce((s, r) => s + r.ms, 0);

    // Log this session (powers the dashboard). Never let a logging hiccup block
    // the result page from showing.
    let saveNote = "";
    try {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const course = listId ? courseOfList(listId) : "";
      const round = course ? await getCourseRound(course) : 1;
      await addStudyLog({
        timestamp: now.toISOString(),
        date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        hour: now.getHours(),
        title, // for the test-history list / result page
        list_id: listId || "",
        course, // course this test belongs to
        round, // course round at test time
        lists_studied: listId ? [listId] : [],
        cards_seen: queue.length,
        known,
        unknown,
        wrong_ids: wrongIds.slice(), // to reverse wrong-book if this record is deleted
        reactions: reactions.slice(),
        total_ms: totalMs,
      });
      const wb = await getWrongCount().catch(() => null);
      saveNote = wb == null ? "Saved." : `Saved · wrong book now has ${wb} words.`;
    } catch (e) {
      saveNote = `Could not save progress: ${e.message}`;
    }

    const total = queue.length;
    const acc = total ? Math.round((known / total) * 100) : 0;
    const missed = wrongCards.slice();
    const secs = (totalMs / 1000).toFixed(0);
    const avg = reactions.length ? (totalMs / reactions.length / 1000).toFixed(1) : "0";

    const summary = el("div", "quiz-summary");
    summary.appendChild(el("h2", "quiz-summary__title", "Round complete"));
    const stats = el("div", "quiz-summary__stats");
    stats.append(
      stat("Total", total),
      stat("Known", known, "stat--known"),
      stat("Unknown", unknown, "stat--unknown"),
      stat("Accuracy", `${acc}%`),
    );
    summary.appendChild(stats);
    summary.appendChild(el("p", "quiz-summary__time", `Time: ${secs}s · avg ${avg}s/word`));
    summary.appendChild(el("p", "quiz-summary__save", saveNote));

    if (missed.length) {
      summary.appendChild(el("h3", "quiz-missed__title", `Missed (${missed.length}) — tap ★ to favorite`));
      const listEl = el("div", "quiz-missed");
      missed.forEach((c) => {
        const row = el("div", "quiz-missed__row");
        const star = el("button", "fav-btn fav-btn--inline");
        const setStar = () => {
          const on = favorites.has(c.id);
          star.textContent = on ? "★" : "☆";
          star.classList.toggle("fav-btn--on", on);
        };
        setStar();
        star.addEventListener("click", async () => {
          const on = favorites.has(c.id);
          const now = await toggleFavorite(c.id, on);
          if (now) favorites.add(c.id);
          else favorites.delete(c.id);
          setStar();
        });
        const text = el("div", "quiz-missed__text");
        text.appendChild(el("span", "quiz-missed__jp", c.front + (c.reading ? ` (${c.reading})` : "")));
        text.appendChild(el("span", "quiz-missed__mean", c.meaning_en || c.meaning_zh || c.meaning_ja || ""));
        row.append(star, text);
        listEl.appendChild(row);
      });
      summary.appendChild(listEl);
      const retest = el("button", "btn btn--unknown quiz-retest", `Retest these ${missed.length}`);
      retest.addEventListener("click", () => restart(missed, true));
      summary.appendChild(retest);
    }

    const btns = el("div", "quiz-summary__btns");
    const retry = el("button", "btn", "Retry all");
    retry.addEventListener("click", () => restart(cards, false));
    const home = el("button", "btn btn--ghost", "おつかれ！");
    home.addEventListener("click", () => exit());
    btns.append(retry, home);
    summary.appendChild(btns);

    cardWrap.replaceChildren();
    speakers.style.display = "none";
    actions.replaceChildren(summary);
    hint.style.display = "none";
  }

  function restart(newPool, retest) {
    clearTimer();
    retestMode = !!retest;
    pool = newPool && newPool.length ? newPool.slice() : cards;
    queue = shuffle(pool);
    index = 0;
    known = 0;
    unknown = 0;
    wrongIds = [];
    wrongCards = [];
    reactions = [];
    finishing = false;
    timedOut = false;
    speakers.style.display = "";
    hint.style.display = "";
    showQuestion();
  }

  function stat(label, value, cls) {
    const box = el("div", `stat ${cls || ""}`);
    box.appendChild(el("div", "stat__value", String(value)));
    box.appendChild(el("div", "stat__label", label));
    return box;
  }

  function onKey(e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === "f" || e.key === "F") {
      toggleFav();
      e.preventDefault();
      return;
    }
    if (timedOut) {
      // After a timeout the card is already marked wrong; → / Enter / Space = Next.
      if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
        advance();
        e.preventDefault();
      }
      return;
    }
    if (e.key === " " || e.key === "Enter") {
      if (card) card.flip();
      e.preventDefault();
    } else if (revealed && e.key === "ArrowRight") {
      grade(true);
      e.preventDefault();
    } else if (revealed && e.key === "ArrowLeft") {
      grade(false);
      e.preventDefault();
    }
  }
  function cleanup() {
    clearTimer();
    document.removeEventListener("keydown", onKey);
  }
  function exit() {
    cleanup();
    if (onExit) onExit();
  }
  document.addEventListener("keydown", onKey);

  showQuestion();
  return cleanup;
}
