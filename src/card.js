// Single-card rendering + 3D flip. A card has two faces:
//   - Japanese face: the word (front) + kana reading
//   - Meaning face:  the meaning(s) + reading
// `defaultFace` ("front" = Japanese-first, "back" = meaning-first) decides which
// face is shown un-rotated.

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function meanings(card) {
  return [card.meaning_zh, card.meaning_en, card.meaning_ja].filter(Boolean);
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
  const ms = meanings(card);
  if (ms.length) {
    const wrap = el("div", "card__meanings");
    ms.forEach((m) => wrap.appendChild(el("div", "card__meaning", m)));
    face.appendChild(wrap);
  } else {
    face.appendChild(el("div", "card__meaning card__meaning--empty", "—"));
  }
  if (card.reading) face.appendChild(el("div", "card__reading-sub", card.reading));
  face.appendChild(el("div", "card__word-sub", card.front));
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
