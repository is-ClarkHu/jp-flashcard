// Single-card rendering + 3D flip. A card has two faces:
//   - Japanese face: the word (front) + kana reading (reading hideable globally)
//   - Meaning face:  the meaning (chosen Card language) + kana reading
// `defaultFace` ("front" = Japanese-first, "back" = meaning-first) decides which
// face shows un-rotated. The meaning face omits the kanji word so showing it
// first doesn't spoil that answer; the reading stays as a pronunciation aid.

import { getSettings } from "./settings.js";

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

// The single meaning to show, in the user's chosen Card language, with a
// graceful fallback if that language happens to be missing for this card.
function cardMeaning(card) {
  const lang = getSettings().cardLang || "en";
  return (
    card[`meaning_${lang}`] ||
    card.meaning_en ||
    card.meaning_zh ||
    card.meaning_ja ||
    ""
  );
}

function japaneseFace(card) {
  const face = el("div", "card__face card__face--jp");
  face.appendChild(el("div", "card__word", card.front));
  if (card.reading && card.reading !== card.front) {
    face.appendChild(el("div", "card__reading", card.reading));
  }
  return face;
}

function meaningFace(card) {
  const face = el("div", "card__face card__face--meaning");
  const m = cardMeaning(card);
  face.appendChild(
    el("div", m ? "card__meaning" : "card__meaning card__meaning--empty", m || "—"),
  );
  // The kana reading goes on the meaning face too (pronunciation aid, not the
  // answer like the kanji word) — still obeys the global show/hide-reading toggle.
  if (card.reading) face.appendChild(el("div", "card__reading-sub", card.reading));
  return face;
}

// Build a flip card. Returns { element, flip(), reset() }.
// opts: { defaultFace, onFlip, interactive } — interactive=false disables the
// click-to-flip handler (the self-test drives the flip itself).
export function createCard(card, opts = {}) {
  const { defaultFace = "front", onFlip, interactive = true } = opts;
  const root = el("div", "card");
  const inner = el("div", "card__inner");

  const jp = japaneseFace(card);
  const meaning = meaningFace(card);

  // The un-rotated (front-of-3d) face is whichever the user wants to see first.
  const showJpFirst = defaultFace === "front";
  const frontFace = showJpFirst ? jp : meaning;
  const backFace = showJpFirst ? meaning : jp;
  frontFace.classList.add("card__face--front");
  backFace.classList.add("card__face--back");

  inner.appendChild(frontFace);
  inner.appendChild(backFace);
  root.appendChild(inner);

  const api = {
    element: root,
    flip() {
      const flipped = root.dataset.flipped !== "true";
      root.dataset.flipped = flipped ? "true" : "false";
      if (onFlip) onFlip(flipped);
    },
    reset() {
      root.dataset.flipped = "false";
    },
  };
  root.dataset.flipped = "false";
  if (interactive) root.addEventListener("click", api.flip);
  return api;
}
