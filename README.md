# jp-flashcard

A fully local, single-user **Japanese vocabulary flashcard app** — the core Quizlet
experience (flip / self-test / shuffle / favorites) plus six-voice audio,
multi-round study tracking, two-layer AI explanations, an analytics dashboard, and
portable packaging (run it as a **website** or a **desktop app**, with one-click
progress migration).

No ads. No server. No login. **Offline-first** — the only optional network call is
the on-demand "Explain deeper" feature, which uses *your own* API key and is cached
forever after the first fetch.

> **What this repo ships:** the **app + the `convert.py` data tool**, plus a tiny
> built-in **demo deck** so it runs the moment you clone it. It does **not** ship a
> full vocabulary library — you build your own from your own source files with
> `convert.py` (see [Build your own library](#build-your-own-library)). This keeps
> the project to code you can freely share, not third-party word lists.

---

## Quick start

```bash
git clone https://github.com/is-ClarkHu/jp-flashcard.git
cd jp-flashcard
npm install
npm run dev            # http://localhost:5173
```

A fresh clone runs immediately on a small bundled **demo deck** (`data/sample/`) so
you can try every feature right away. To study real material, build your own library
(next section); the app loads it automatically and the demo steps aside.

---

## Features

- **Browse** by course → list, large 3D flip cards (Japanese ⇄ meaning).
- **Multi-voice audio** — a voice picker with six bundled VOICEVOX voices plus an
  "Auto (system)" browser `ja-JP` fallback. Per-word mp3 is pre-generated offline by
  `convert.py --tts`; in-app you get speech-rate, auto-play-on-flip, and a
  fixed-or-random auto-play voice. Tapping a voice on a card makes it current for
  that word.
- **Self-test** — self-graded Known / Unknown, always shuffled, with a wrong book
  that grows on misses and clears as you get them right.
- **Per-list scopes** — study/test **All**, **★ favorites**, or **✗ wrong** words
  within any list.
- **Multi-round tracking** — each finished round is logged; the home screen shows
  times studied, last accuracy, and an accuracy-over-rounds sparkline per list.
- **AI explanations (two layers)** — an offline static brief (`explain_*`) plus an
  on-demand online deep-dive (your API key), answered in ZH / EN / JP and cached.
- **Analytics dashboard** — check-in heatmap + streak, daily volume, level-progress
  rings, accuracy trend, wrong-answer distribution, and a "when you learn best"
  time-of-day analysis.
- **Multiple profiles** — separate accounts, each with its own progress.
- **Backup & migration** — export all progress to one JSON file; import it on
  another machine (merge or replace).
- **Light / dark theme**, responsive down to mobile.

### Keyboard shortcuts

| Context | Keys |
|---|---|
| Browse | `←` / `→` prev/next · `Space` flip · click ★ to favorite |
| Self-test | `Space` flip · `→` Known · `←` Unknown · `F` favorite |

---

## How it works

```
raw_data/        your own vocab files (PDF / xlsx / xls / csv). Disposable, gitignored.
   │
   ▼  convert.py            reads raw_data/, extracts cards, shuffles + splits into
   │                        lists, (optionally) LLM-enriches, writes the library.
data/            build output the app reads at runtime (gitignored, except data/sample/):
   ├── manifest.json        course -> list index
   ├── N5/list01.json …     one JSON file per study list
   ├── audio/               pre-generated pronunciation (added later by --tts)
   └── sample/              the small demo deck that ships with the repo
   │
   ▼  the app (static SPA)
   ├── reads data/ (read-only); falls back to data/sample/ if no library is built
   └── writes user data -> IndexedDB (favorites / study log / wrong book / rounds / cache)
```

**Three strictly separated data classes:**

1. **Raw input** (`raw_data/`) — disposable; only an input to conversion;
   gitignored. Deletable at any time without breaking the app.
2. **Static library** (`data/`) — the vocab content (+ audio later). Built by you
   from your own sources and **not committed** (only `data/sample/` is). It travels
   *with* your own app package when you build one.
3. **Dynamic user data** (IndexedDB) — favorites, check-ins, wrong answers, study
   rounds, explanation cache, settings. Your personal progress — the **only** thing
   exported/imported during migration.

---

## Build your own library

`convert.py` reads `raw_data/`, extracts each card's Japanese word + reading +
meaning, shuffles each source file and splits it into fixed-size study lists, and
writes the JSON library + `manifest.json` into `data/`.

```bash
# one-time Python setup for the data tool
python3 -m venv venv
./venv/bin/python -m pip install -r requirements.txt

# build data/ from raw_data/
./venv/bin/python convert.py
./venv/bin/python convert.py --chunk-size 40   # 40 words per list instead of 50
./venv/bin/python convert.py --seed 7          # different (reproducible) shuffle
```

Once `data/manifest.json` exists, `npm run dev` loads it automatically instead of the
demo deck.

### Where to drop raw files

Each **top-level folder under `raw_data/` is one course**:

```
raw_data/
  N5/ … N1/        # e.g. JLPT levels (one PDF each)
  MyDeck/          # any name becomes a course of that name
```

- A folder named `N1`–`N5` becomes course `N5` (uppercased).
- A folder named `Duolinguo`/`Duolingo` becomes course `Duolingo`.
- Any other folder name becomes a course with that name.

Supported files: **`.pdf`** (e.g. print-to-PDF flashcards), `.xlsx`, `.xls`, `.csv`.
The parser keys off character script (kanji = written form, kana = reading,
Latin/number = meaning) and NFKC-normalizes text, so it adapts to several column
layouts. Embedded images are ignored (text only, no OCR).

### LLM enrichment (optional, build-time, multi-provider)

Source data is often missing meaning languages and never has explanations. Two
separate, idempotent steps fill those into the library:

```bash
cp .env.example .env                            # then put your provider key in .env
./venv/bin/python convert.py --fill-meanings    # fill MISSING meaning languages
./venv/bin/python convert.py --explain          # generate Layer-1 explanations
```

- **Provider** — default **`deepseek`** (DeepSeek-V3 `deepseek-chat`: cheap, fast,
  plenty good for glosses/explanations). `--provider` also accepts `anthropic`,
  `openai`, `gemini`, `moonshot`, `mistral`; each reads its key from the matching env
  var / `.env` (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, …) — see `.env.example`.
- **Batched, not per-word** — each request sends a batch of cards and the model
  returns a JSON array, so the whole library is a few dozen requests. Tune with
  `--batch-size` (auto: 30 for meanings, 12 for explanations).
- `--limit N` enriches only the first N cards that need it — a cheap way to test a
  provider/prompt before the full run (e.g. `--explain --limit 5`).
- `--model` overrides the provider's default model; `--only`/`--force` scope a re-run.
- `--fill-meanings` only fills empty languages; never overwrites a source meaning.
- `--explain` generates `explain_zh/en/ja` (example sentence + usage) from scratch.
- Both skip already-filled cards, so re-runs don't re-bill.

### Generate audio (VOICEVOX)

Pre-generate per-word pronunciation for all six bundled voices with the local
[VOICEVOX](https://voicevox.hiroshiba.jp/) engine — no cloud, no API key:

```bash
# First launch the VOICEVOX app (serves http://127.0.0.1:50021) and install ffmpeg.
./venv/bin/python convert.py --tts                       # synth all 6 voices, every card
./venv/bin/python convert.py --tts --only N5 --limit 20  # scope a quick test run
```

Clips land in `data/<course>/audio/<id>/<voice>.mp3` and are linked into each card's
`audio` map. The run is resumable — existing clips are kept (paths re-linked) unless
you pass `--force`. The voice list lives in `src/speakers.js`, mirrored by the
`TTS_SPEAKERS` table in `convert.py`; keep the two in sync. Override the engine URL
with `VOICEVOX_HOST` if it isn't on the default port.

> **Two separate keys.** The key above is **build-time** — it generates the static
> library written into `data/` (your dev machine only; goes in `.env`, gitignored).
> It is unrelated to the in-app **Settings** key used live by "Explain deeper", which
> is stored per-device in the browser. The app's Settings supports the same six
> providers.

Re-running `convert.py` merges previously generated meanings / explanations / audio
paths from the existing `data/` (matched by stable card id), so a plain re-run never
wipes enrichment.

---

## Packaging (3 targets)

```bash
# 1. Hosted website  — serve the build with any static server
npm run build                 # -> dist/  (library fetched from data/ at runtime)
npm run preview               # local server to check it; or deploy dist/ anywhere

# 2. Standalone single file — opens straight from file:// (double-click)
npm run build:standalone      # -> dist-standalone/index.html  (ONE self-contained
                              #    file: JS, CSS, and the whole library inlined)

# 3. Electron desktop app    — double-clickable .dmg / .exe
npm install                   # first pulls electron + electron-builder
npm run electron              # run the desktop app locally
npm run build:electron        # -> release/  (.dmg on macOS, .exe on Windows)
```

- The **single-file** build inlines everything because Chrome blocks both `fetch` and
  ES-module loading from `file://`; inlining sidesteps both.
- **Electron** serves `dist/` over a custom `app://` protocol (so the app's relative
  `fetch` works without disabling web security) and bundles the library.
- All three are fully offline; the only network call is the optional Layer-2
  "Explain deeper" (your own API key, from Settings).

### Desktop app (Electron) — details

**Which command when:**

| Command | Use it for | Loads | DevTools |
|---|---|---|---|
| `npm run dev` | **Everyday development** — pure web, hot reload, browser DevTools. Electron not involved. | Vite dev server in your browser | browser |
| `npm run electron:dev` | **Debugging Electron-specific behavior** (esp. IndexedDB persistence) with hot reload. | Vite dev server, in an Electron window | auto-opened |
| `npm run electron` | A final check of the **built** app exactly as it ships (same `app://` origin as the installer). | built `dist/` over `app://` | no |
| `npm run build:electron` | **Producing the installer** for distribution. | — (writes `release/`) | — |

```bash
npm install                   # one-time: pulls electron + electron-builder
npm run dev                   # daily web dev (browser, hot reload)
npm run electron:dev          # debug inside Electron (dev server + auto DevTools)
npm run electron              # run the built app as it ships (app:// origin)
npm run build:electron        # build installers into release/
```

> **Heads-up:** `electron:dev` loads the dev server (a `http://localhost` origin), so
> its IndexedDB lives in a *separate* bucket from the shipped app's `app://` origin.
> It's perfect for confirming the *mechanism* (data survives restart), but the
> packaged app — or `npm run electron` — is the true production-origin check.

Output of `build:electron` lands in **`release/`** (gitignored):

- **macOS:** `JP Flashcards-<version>.dmg`
- **Windows:** `JP Flashcards Setup <version>.exe` (configured; build it on a Windows
  machine, or cross-build from macOS with Wine installed)

The installers are **unsigned**, so first launch needs a manual bypass — macOS:
right-click → Open; Windows: "More info" → "Run anyway".

**Why the desktop build matters — durable storage.** All your data (accounts,
favorites, study log, wrong book, rounds, explanation cache) lives in **IndexedDB**.
The desktop app loads from a stable, secure `app://` origin and uses Electron's
persistent profile, so that data survives quits, restarts, and app updates. It is
stored under the app's user-data directory:

- **macOS:** `~/Library/Application Support/JP Flashcards/IndexedDB/`
- **Windows:** `%APPDATA%/JP Flashcards/IndexedDB/`

> Storage is keyed by the app's `productName` ("JP Flashcards"). Don't rename it in
> `package.json` once you have real progress — a new name = a new (empty) profile.

**Verify persistence (30 seconds):** launch the app → create an account and study a
few cards (favorite one, mark some Known/Unknown so the wrong book and a round are
written) → fully **quit** (⌘Q / close) → relaunch → your account and progress are
still there.

> ⚠️ **Private distribution only.** A built `.dmg` / `.exe` **inlines the full
> vocabulary library**, which may be built from copyrighted sources. **Do not commit
> the binaries and do not attach them to a public GitHub Release.** Share them
> privately. Only the source (app code + `convert.py` + the small `data/sample/`
> demo) belongs in this repository.

---

## Project structure

```
jp-flashcard/
├── index.html
├── package.json            # vite + electron scripts, electron-builder config
├── vite.config.js          # base "./", publicDir "data", standalone single-file mode
├── convert.py              # data-prep: raw_data/ -> data/ (+ optional LLM enrichment)
├── requirements.txt        # Python deps for convert.py
├── .env.example            # build-time provider keys for convert.py (copy to .env)
├── scripts/inline-data.mjs # inlines the library for the standalone build
├── electron/
│   ├── main.cjs            # serves dist/ over the app:// protocol
│   └── preload.cjs
├── raw_data/               # gitignored; your disposable raw files
├── data/                   # build output (gitignored); only data/sample/ is committed
│   └── sample/             # the small demo deck that ships with the repo
├── src/
│   ├── main.js             # app init, hash routing, home / deck / favorites / settings / backup
│   ├── deck.js             # library loading (with sample fallback), Deck cursor, shuffle
│   ├── card.js             # single card render + 3D flip
│   ├── tts.js              # audio layer: per-voice VOICEVOX mp3 + browser TTS fallback
│   ├── speakers.js         # the six bundled VOICEVOX voices (key, label, style id)
│   ├── quiz.js             # self-test mode + wrong book + round/session logging
│   ├── db.js               # IndexedDB wrapper (all dynamic stores + export/import)
│   ├── accounts.js         # multiple profiles
│   ├── explain.js          # AI explanation: static Layer 1 + online Layer 2 (cached)
│   ├── dashboard.js        # analytics dashboard (hand-rolled SVG charts)
│   ├── progress.js         # study log / rounds / wrong-book bookkeeping
│   ├── migrate.js          # export/import progress JSON
│   └── settings.js         # user settings (localStorage)
└── styles/main.css         # Japanese-refined visual style, light + dark
```

---

## Data models

### Vocab JSON (one file per list)

```json
{
  "curriculum": "N5",
  "group": "N5",
  "list_id": "N5-list01",
  "list_name": "N5 - 1",
  "cards": [
    {
      "id": "N5-l01-002",
      "front": "飲み物",
      "reading": "のみもの",
      "meaning_zh": "饮料", "meaning_en": "a drink", "meaning_ja": "飲み物",
      "explain_zh": "", "explain_en": "", "explain_ja": "",
      "audio": { "aoyama": "N5/audio/N5-l01-002/aoyama.mp3" },
      "audio_anime": null, "audio_announcer": null, "audio_example": null,
      "duplicate_of": null,
      "extra": ""
    }
  ]
}
```

See `data/sample/` for a complete, runnable two-list example.

### `manifest.json`

`curriculum → group → list`. The home screen browses courses, then lists. The app
reads `data/manifest.json` if you've built a library, otherwise falls back to
`data/sample/manifest.json`.

### IndexedDB stores (dynamic user data)

```
favorites      { word_id }
study_log      { timestamp, date, hour, lists_studied, cards_seen, known, unknown }
wrong_book     { word_id, wrong_count, last_wrong_date }
rounds         { list_id, times_studied, last_studied, history:[{round,date,known,unknown}] }
explain_cache  { key:"{word_id}:{lang}", text, generated_at }
seen           { list_id, last_seen }
course_state   { course, round }
kana_progress  { id, ... }            # 五十音 rolling accuracy
saves          { id, name, stores, settings, counts }   # one per account
meta           { key, value }         # internal (e.g. last file-sync marker)
```

Settings (default face, speech rate, auto-play, theme, explanation language, API key,
model) live in `localStorage`.

### Where your progress is stored — and how to not lose it

> **TL;DR — for daily study, use the packaged Electron app.** It saves everything
> to one local file, so it never gets lost. The dev server in a browser is for
> development only.

Browser storage (IndexedDB **and** localStorage) is isolated **per origin** —
`scheme://host:port` — and also per browser. The same app opened different ways
therefore reads **different, independent stores**:

| How you open it | Origin | Storage |
| --- | --- | --- |
| Packaged Electron app (recommended) | `app://app` | Electron userData |
| Electron loading the dev server | `http://localhost:5173` | Electron userData |
| `npm run dev` in Chrome/Safari | `http://localhost:5173` | that browser's profile |
| The standalone single file (double-click) | `file://` | that browser's profile |

These do **not** share data and do **not** erase each other. Open the app a
different way (a different port because `5173` was taken — Vite silently jumps to
`5174` — a different browser, packaged vs dev) and you'll see a *fresh empty
store*. Your old data is still there under the original origin; you're just
looking at a different box. Clearing a browser's site data, however, **deletes**
that origin's store for good.

**The fix:** the Electron app persists the whole database to a single
origin-independent file and treats it as the source of truth:

- **`<userData>/save.json`** — full mirror (all accounts + active progress +
  settings) written atomically after every change. On macOS, `<userData>` is
  `~/Library/Application Support/JP Flashcards/`.
- **`<userData>/backups/`** — the last ~20 timestamped copies.
- On launch the app restores from `save.json`, so even a wiped/!changed origin
  comes back. Settings → **Accounts** has **Open save folder** / **Back up now**.
- **API keys are never written to the file** (they stay in `localStorage`); after
  a site-data clear, re-enter them in Settings.

Running in a plain browser (dev/debug) shows a banner in Settings → Accounts:
there's no file there, so storage is per-origin only. To move data between a
browser and the app, use per-account **Export / Import**.

---

## Decisions

Choices not fully specified up front, recorded here.

1. **Flat courses.** Each top-level `raw_data/` folder is one parallel course on the
   home screen, modeled in `manifest.json` as one curriculum per course with a single
   group, keeping the `curriculum → group → list` schema.
2. **Lists are word-chunks.** Each source file is shuffled (deterministic `--seed`, so
   lists and card IDs are stable across runs) and split into lists of `--chunk-size`
   words (default **50**).
3. **PDF parsing is script-based, not column-based.** Parsing keys off character
   script: a kanji token is the written form (`front`), a pure-kana token is the
   `reading` (or `front` for kana-only words), Latin/number tokens are the `meaning`.
   Text is NFKC-normalized so font variants and full/half-width forms fold to canon.
4. **Embedded images are ignored** (text only, no OCR). Scanned PDFs are reported, not
   silently OCR-ed.
5. **Source gaps stay empty, not invented.** Cards with no reading/meaning in the
   source stay empty until LLM enrichment; they are not parser errors.
6. **Duplicates vs conflicts** (global): a *duplicate* (same word, same/unknown
   reading) is kept with `duplicate_of` set to the first occurrence. A *conflict*
   (same written form, different non-empty reading) keeps both and prints a warning;
   nothing is silently merged.
7. **Wrong-book rule.** An "Unknown" increments `wrong_count`; a "Known" decrements it
   and removes the word from the wrong book at 0.
8. **Stack:** Vite + vanilla JS (no framework). Dynamic data in IndexedDB, settings in
   localStorage. Dashboard charts are hand-rolled SVG (no chart library) to stay fully
   offline and dependency-light.
9. **The API key is never written into an exported progress file** — nor into the
   Electron `save.json`. Keys stay in `localStorage` on the machine that entered them.
10. **Durable storage is a file, not the browser.** The Electron app mirrors the whole
    database to `<userData>/save.json` (atomic write + rotating backups) and restores
    from it on launch, so user data survives the per-origin IndexedDB split and
    cleared site data. A plain browser has no file and runs IndexedDB-only (debug).

---

## Privacy & offline

Everything runs locally. The library lives on your machine; your progress lives in
your browser's IndexedDB and never leaves unless you export it. The single optional
network call is "Explain deeper", which goes directly to the LLM provider you choose
in Settings (Claude / ChatGPT / Gemini / DeepSeek / Moonshot / Mistral) with the key
you enter there (stored locally, stripped from progress exports).

---

## License

[MIT](LICENSE) © 2026 Jiahe Hu. The vocabulary content you generate with `convert.py`
from your own sources is yours and is **not** part of this repository.
