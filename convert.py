#!/usr/bin/env python3
"""
convert.py — Module A of the Japanese flashcard app: raw_data/ -> data/.

Reads raw vocab files (PDF / xlsx / xls / csv) from raw_data/, extracts the
Japanese word + reading + meaning of each card, shuffles each source file and
splits it into fixed-size study lists, then writes a clean JSON library plus a
manifest into data/. The web app reads ONLY from data/ at runtime.

This is a data-prep tool, NOT the app. The app is a separate web frontend.

Data layout produced (one "course" per top-level raw_data/ subfolder):

    data/
      manifest.json              curriculum -> group -> list index
      N5/list01.json ...         one JSON file per study list
      Duolingo/list01.json ...
      audio/                     (reserved; filled later by --tts)

Course / list rules (see README "Decisions"):
  * Each top-level raw_data/<folder> is one flat course.
      - folder matching N1..N5  -> course "N5" (uppercased)
      - folder "Duolinguo"/"Duolingo" (and similar) -> course "Duolingo"
      - any other folder -> course = folder name as-is
  * Each source file is shuffled (deterministic --seed) then split into lists
    of --chunk-size cards. Multiple files in one course (e.g. Duolingo units)
    are processed in filename order with continuous list numbering; list_name
    records the source label (e.g. "Unit 1 - 2").

Optional LLM enrichment (both require an API key; both are idempotent):
  --fill-meanings   fill MISSING meaning languages (never overwrite source)
  --explain         generate the static Layer-1 rich explanation from scratch

Re-running convert.py merges any previously generated meanings / explanations /
audio paths from the existing data/ by stable card id, so a plain re-run never
wipes prior enrichment.

Usage:
    python convert.py                      # build data/ from raw_data/
    python convert.py --chunk-size 40
    python convert.py --fill-meanings      # needs ANTHROPIC_API_KEY
    python convert.py --explain
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# --- Layout / extraction constants ---------------------------------------

# Quizlet print-to-PDF column positions vary by source (the kanji / reading /
# meaning columns are arranged differently across JLPT levels). So parsing is
# driven by SCRIPT, not by x-position: kanji token -> the written form (front),
# pure-kana token -> reading, Latin/enumerator token -> meaning. x is used only
# to order tokens within a row.

# Per-page header band (timestamp + title) and footer band (URL + page number).
HEADER_MAX_TOP = 38.0
FOOTER_MIN_TOP = 752.0

# Vertical tolerance (points) for grouping words into one visual row. Kana/Latin
# baseline jitter is ~3px (same card); a kanji line and its kana reading line are
# ~15-18px apart (separate rows), so 8 cleanly separates the two cases.
ROW_TOLERANCE = 8.0

# Marker after which the real term/definition rows begin on a Quizlet export.
TERMS_MARKER = re.compile(r"Terms\s+in\s+this\s+set", re.IGNORECASE)

# LLM providers for enrichment (--fill-meanings / --explain). Each reads its key
# from the listed env var (or a .env file at the project root) unless --api-key
# is passed. Use a cheap provider (deepseek / moonshot) for big runs. Override the
# model with --model. kind: "anthropic" | "openai" (chat-completions) | "gemini".
PROVIDERS = {
    "anthropic": {"env": "ANTHROPIC_API_KEY", "kind": "anthropic", "model": "claude-opus-4-8"},
    "openai":    {"env": "OPENAI_API_KEY", "kind": "openai", "model": "gpt-4o",
                  "url": "https://api.openai.com/v1/chat/completions"},
    "deepseek":  {"env": "DEEPSEEK_API_KEY", "kind": "openai", "model": "deepseek-chat",
                  "url": "https://api.deepseek.com/v1/chat/completions"},
    "moonshot":  {"env": "MOONSHOT_API_KEY", "kind": "openai", "model": "moonshot-v1-8k",
                  "url": "https://api.moonshot.cn/v1/chat/completions"},
    "mistral":   {"env": "MISTRAL_API_KEY", "kind": "openai", "model": "mistral-large-latest",
                  "url": "https://api.mistral.ai/v1/chat/completions"},
    "gemini":    {"env": "GEMINI_API_KEY", "kind": "gemini", "model": "gemini-2.0-flash"},
}
# Bulk library enrichment defaults to DeepSeek-V3 (deepseek-chat): cheap, fast,
# and plenty good for short glosses/explanations (this is not a reasoning task, so
# the R1 reasoner would only be slower and pricier). Override with --provider.
DEFAULT_PROVIDER = "deepseek"

SUPPORTED_EXTS = {".pdf", ".xlsx", ".xls", ".csv"}

# Header aliases for spreadsheet (xlsx/xls/csv) sources. PDFs are headerless and
# use positional parsing instead (see extract_cards_from_pdf).
HEADER_ALIASES: Dict[str, List[str]] = {
    "front":      ["日语", "単語", "単词", "word", "term", "正面", "表", "front"],
    "reading":    ["假名", "読み", "よみ", "reading", "kana", "furigana", "读音"],
    "meaning_zh": ["中文", "意思", "释义", "中", "zh", "chinese"],
    "meaning_en": ["英文", "英语", "english", "en", "meaning"],
    "meaning_ja": ["日语释义", "和訳", "意味", "jp meaning"],
    "explain_zh": ["解释", "说明", "explanation", "note", "notes"],
    "explain_en": ["explanation_en", "note_en"],
    "explain_ja": ["例句", "example", "和文例"],
}


# --- Card model ----------------------------------------------------------

@dataclass
class Card:
    front: str = ""
    reading: str = ""
    meaning_zh: str = ""
    meaning_en: str = ""
    meaning_ja: str = ""
    explain_zh: str = ""
    explain_en: str = ""
    explain_ja: str = ""
    audio_anime: Optional[str] = None
    audio_announcer: Optional[str] = None
    audio_example: Optional[str] = None
    duplicate_of: Optional[str] = None
    extra: str = ""
    # Assigned during list assembly:
    id: str = ""
    # Internal, not written to JSON:
    _source: str = field(default="", repr=False)
    _has_kanji: bool = field(default=False, repr=False)
    _meaning_parts: List[str] = field(default_factory=list, repr=False)

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "front": self.front,
            "reading": self.reading,
            "meaning_zh": self.meaning_zh,
            "meaning_en": self.meaning_en,
            "meaning_ja": self.meaning_ja,
            "explain_zh": self.explain_zh,
            "explain_en": self.explain_en,
            "explain_ja": self.explain_ja,
            "audio_anime": self.audio_anime,
            "audio_announcer": self.audio_announcer,
            "audio_example": self.audio_example,
            "duplicate_of": self.duplicate_of,
            "extra": self.extra,
        }


# --- Small text helpers --------------------------------------------------

_KANA = re.compile(r"[぀-ゟ゠-ヿ]")            # hiragana + katakana
_HAN = re.compile(r"[一-鿿]")                          # CJK ideographs
_LATIN = re.compile(r"[A-Za-z]")
_PARENS = re.compile(r"^(.*?)[\(（](.+?)[\)）]\s*$")            # "漢字 (かな)" form


def slug(text: str) -> str:
    """Filesystem/id-safe slug, keeping ASCII letters/digits only."""
    s = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")
    return s or "x"


def detect_meaning_lang(text: str) -> str:
    """Route a definition string to a meaning_* language by its script."""
    if _KANA.search(text):
        return "ja"
    if _LATIN.search(text):
        return "en"
    if _HAN.search(text):
        return "zh"
    return "en"


def clean_reading(text: str) -> str:
    """Strip surrounding parens/whitespace from a kana reading token."""
    return re.sub(r"[\s（）()]", "", text).strip()


def norm_reading(text: str) -> str:
    """Normalize a reading for duplicate/conflict comparison."""
    return re.sub(r"[\s（）()／/、,，]", "", text)


def is_kanji_token(t: str) -> bool:
    return bool(_HAN.search(t))


def is_kana_token(t: str) -> bool:
    return bool(_KANA.search(t)) and not _HAN.search(t) and not _LATIN.search(t)


def join_meaning(parts: List[str]) -> str:
    text = " ".join(p for p in parts if p).strip()
    text = re.sub(r"\s+", " ", text)
    # Some sources drop the space after commas/semicolons (e.g. "a,b").
    return re.sub(r"([,;])(?=\S)", r"\1 ", text)


# --- PDF extraction ------------------------------------------------------

def _cluster_rows(words: List[dict]) -> List[List[dict]]:
    """Group words into visual rows by their vertical position."""
    rows: List[List[dict]] = []
    for w in sorted(words, key=lambda x: (x["top"], x["x0"])):
        if rows and (w["top"] - rows[-1][0]["top"]) <= ROW_TOLERANCE:
            rows[-1].append(w)
        else:
            rows.append([w])
    return rows


def _gate_rows(page, started: bool) -> Tuple[List[List[dict]], bool, Optional[int]]:
    """Return content rows for a page (header/footer + preamble stripped)."""
    words = [
        w for w in page.extract_words()
        if HEADER_MAX_TOP < w["top"] < FOOTER_MIN_TOP
    ]
    rows = _cluster_rows(words)
    declared: Optional[int] = None
    if not started:
        marker_idx = None
        for i, row in enumerate(rows):
            joined = " ".join(w["text"] for w in row)
            if TERMS_MARKER.search(joined):
                marker_idx = i
                m = re.search(r"\((\d+)\)", joined)
                if m:
                    declared = int(m.group(1))
                break
        if marker_idx is None:
            return [], False, None  # still in the preamble
        started = True
        rows = rows[marker_idx + 1:]
    return rows, started, declared


def extract_cards_from_pdf(path: Path) -> List[Card]:
    """
    Extract cards from a Quizlet print-to-PDF, by SCRIPT (not column x).

    Per card: the kanji/okurigana token is the written form (front); a pure-kana
    token is the reading (or the front itself for kana-only words); Latin /
    enumerator tokens are the meaning. This handles every observed layout
    (kanji-left+reading-mid, reading-left+kanji-mid, and reading-on-second-line)
    uniformly. Embedded mnemonic images are ignored (text extraction skips them).
    Header/footer and the pre-"Terms in this set" preamble are stripped.
    """
    import pdfplumber  # local import keeps base deps minimal at import time

    cards: List[Card] = []
    current: Optional[Card] = None
    started = False
    declared_count: Optional[int] = None

    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            rows, started, declared = _gate_rows(page, started)
            if declared is not None:
                declared_count = declared
            for row in rows:
                kanji, kana, meaning = [], [], []
                for w in sorted(row, key=lambda x: x["x0"]):
                    # NFKC folds Kangxi-radical variants (適⽤ -> 適用) and
                    # full/half-width forms into canonical characters.
                    t = unicodedata.normalize("NFKC", w["text"])
                    if is_kanji_token(t):
                        kanji.append(t)
                    elif is_kana_token(t):
                        kana.append(t)
                    else:
                        meaning.append(t)
                meaning_text = " ".join(meaning).strip()
                has_head = bool(kanji or kana)

                # Wrapped meaning continuation (no headword on this row).
                if not has_head:
                    if meaning_text and current is not None:
                        current._meaning_parts.append(meaning_text)
                    continue

                # Kana-only line with no meaning: a reading line under a kanji
                # headword (the second-line layout), else a new kana-only word.
                if kana and not kanji and not meaning_text:
                    if current is not None and current._has_kanji and not current.reading:
                        current.reading = clean_reading(" ".join(kana))
                        continue

                # New card.
                if kanji:
                    front = re.sub(r"\s+", "", "".join(kanji))
                    reading = clean_reading(" ".join(kana)) if kana else ""
                    has_kanji = True
                else:
                    front = clean_reading(" ".join(kana))
                    reading = ""
                    has_kanji = False
                if not front:
                    continue
                card = Card(front=front, reading=reading, _source=path.name,
                            _has_kanji=has_kanji)
                if meaning_text:
                    card._meaning_parts.append(meaning_text)
                cards.append(card)
                current = card

    # Finalize meanings: join wrapped parts, route by detected language.
    for card in cards:
        text = join_meaning(card._meaning_parts)
        if text:
            setattr(card, f"meaning_{detect_meaning_lang(text)}", text)

    if declared_count is not None and declared_count != len(cards):
        print(f"  [note] {path.name}: extracted {len(cards)} cards, "
              f"set declares {declared_count}")
    return cards


# --- Spreadsheet extraction ----------------------------------------------

def _map_headers(columns: List[str]) -> Dict[str, str]:
    """Map source column names to target fields via the alias table."""
    mapping: Dict[str, str] = {}
    for col in columns:
        norm = str(col).strip().lower()
        for target, aliases in HEADER_ALIASES.items():
            if norm in [a.lower() for a in aliases]:
                mapping[col] = target
                break
    return mapping


def extract_cards_from_table(path: Path) -> List[Card]:
    """Extract cards from xlsx/xls/csv using the header-alias table."""
    import pandas as pd

    if path.suffix.lower() == ".csv":
        df = pd.read_csv(path, dtype=str).fillna("")
    else:
        df = pd.read_excel(path, dtype=str).fillna("")

    mapping = _map_headers(list(df.columns))
    unmapped = [c for c in df.columns if c not in mapping]
    if unmapped:
        print(f"  [warn] {path.name}: unmapped columns -> extra: {unmapped}")

    cards: List[Card] = []
    for _, row in df.iterrows():
        card = Card(_source=path.name)
        extras = []
        for col, value in row.items():
            value = str(value).strip()
            if not value:
                continue
            target = mapping.get(col)
            if target:
                setattr(card, target, value)
            else:
                extras.append(f"{col}={value}")
        if extras:
            card.extra = "; ".join(extras)
        if card.front or card.reading:
            cards.append(card)
    return cards


def extract_cards(path: Path) -> List[Card]:
    ext = path.suffix.lower()
    if ext == ".pdf":
        return extract_cards_from_pdf(path)
    if ext in {".xlsx", ".xls", ".csv"}:
        return extract_cards_from_table(path)
    return []


# --- Course / source labelling -------------------------------------------

def course_name_for_folder(folder: str) -> str:
    """Normalize a top-level raw_data/ folder name into a course name."""
    if re.fullmatch(r"[Nn][1-5]", folder):
        return folder.upper()
    if re.fullmatch(r"duoling[ou]o?", folder, re.IGNORECASE):
        return "Duolingo"
    return folder


def source_label(course: str, filename: str) -> str:
    """Human label for a source file within a course (used in list_name)."""
    m = re.search(r"Unit\s*(\d+)", filename, re.IGNORECASE)
    if m:
        return f"Unit {int(m.group(1))}"
    return course


def source_sort_key(filename: str) -> Tuple[int, str]:
    """Order files within a course (Unit 1, 2, 3 ... then by name)."""
    m = re.search(r"Unit\s*(\d+)", filename, re.IGNORECASE)
    return (int(m.group(1)) if m else 9999, filename.lower())


# --- List assembly -------------------------------------------------------

@dataclass
class StudyList:
    list_id: str
    list_name: str
    file: str
    cards: List[Card]


@dataclass
class Course:
    name: str
    lists: List[StudyList] = field(default_factory=list)


def build_courses(raw_dir: Path, chunk_size: int, seed: int) -> List[Course]:
    """Walk raw_data/, extract + shuffle + chunk each file into study lists."""
    courses: List[Course] = []

    for folder in sorted(p for p in raw_dir.iterdir() if p.is_dir()):
        course_name = course_name_for_folder(folder.name)
        course_slug = slug(course_name)
        course = Course(name=course_name)

        files = sorted(
            (f for f in folder.rglob("*") if f.suffix.lower() in SUPPORTED_EXTS),
            key=lambda f: source_sort_key(f.name),
        )
        if not files:
            print(f"[skip] {folder.name}: no supported files")
            continue

        list_num = 0
        for src in files:
            label = source_label(course_name, src.name)
            cards = extract_cards(src)
            if not cards:
                print(f"  [warn] {src.name}: no cards extracted "
                      f"(scanned PDF? check that text is selectable)")
                continue

            # Shuffle this file deterministically, then split into lists.
            rng = random.Random(f"{seed}:{course_slug}:{src.name}")
            rng.shuffle(cards)

            part = 0
            for i in range(0, len(cards), chunk_size):
                list_num += 1
                part += 1
                chunk = cards[i:i + chunk_size]
                lst = StudyList(
                    list_id=f"{course_slug}-list{list_num:02d}",
                    list_name=f"{label} - {part}",
                    file=f"{course_slug}/list{list_num:02d}.json",
                    cards=chunk,
                )
                for seq, card in enumerate(chunk, start=1):
                    card.id = f"{course_slug}-l{list_num:02d}-{seq:03d}"
                course.lists.append(lst)

            print(f"  {src.name}: {len(cards)} cards "
                  f"-> {label} ({(len(cards) + chunk_size - 1) // chunk_size} lists)")
        if course.lists:
            courses.append(course)
            total = sum(len(l.cards) for l in course.lists)
            print(f"[course] {course_name}: {len(course.lists)} lists, {total} cards")
    return courses


# --- Duplicate / conflict detection --------------------------------------

def detect_duplicates_conflicts(courses: List[Course]) -> Tuple[int, int]:
    """Mark duplicates (set duplicate_of) and warn on conflicts. Global scope."""
    seen: Dict[str, List[Card]] = {}
    dups = conflicts = 0

    def location(card: Card) -> str:
        return card.id

    for course in courses:
        for lst in course.lists:
            for card in lst.cards:
                key = card.front.strip()
                if not key:
                    continue
                priors = seen.get(key)
                if priors is None:
                    seen[key] = [card]
                    continue
                cr = norm_reading(card.reading)
                # Same front + same (or unknown/empty) reading -> duplicate.
                dup = next(
                    (p for p in priors
                     if not cr or not norm_reading(p.reading)
                     or norm_reading(p.reading) == cr),
                    None,
                )
                if dup is not None:
                    card.duplicate_of = dup.id
                    dups += 1
                    print(f"  [dup] {location(card)} 「{card.front}」 "
                          f"duplicates {dup.id}")
                else:
                    # Same front but every prior has a different non-empty
                    # reading -> homograph or scraping error. Keep both.
                    conflicts += 1
                    p = priors[0]
                    print(f"  [conflict] 「{card.front}」 "
                          f"{location(card)}(reading={card.reading!r}) vs "
                          f"{p.id}(reading={p.reading!r}) — kept both")
                priors.append(card)
    return dups, conflicts


# --- Merge previously generated enrichment / audio -----------------------

_PRESERVE_FIELDS = [
    "meaning_zh", "meaning_en", "meaning_ja",
    "explain_zh", "explain_en", "explain_ja",
    "audio_anime", "audio_announcer", "audio_example",
]


def merge_existing(courses: List[Course], out_dir: Path) -> int:
    """
    Copy previously generated LLM fields / audio paths from existing data/
    into freshly extracted cards (matched by stable id), so re-runs don't wipe
    enrichment. Source-derived meanings are not overwritten (only empty fields
    are filled).
    """
    if not out_dir.exists():
        return 0
    existing: Dict[str, dict] = {}
    for jf in out_dir.rglob("list*.json"):
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for c in data.get("cards", []):
            if c.get("id"):
                existing[c["id"]] = c

    restored = 0
    for course in courses:
        for lst in course.lists:
            for card in lst.cards:
                prev = existing.get(card.id)
                if not prev:
                    continue
                for fld in _PRESERVE_FIELDS:
                    cur = getattr(card, fld)
                    old = prev.get(fld)
                    if (cur in ("", None)) and old not in ("", None):
                        setattr(card, fld, old)
                        restored += 1
    if restored:
        print(f"[merge] restored {restored} fields from existing data/")
    return restored


# --- Output --------------------------------------------------------------

def write_output(courses: List[Course], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    curricula = []
    for course in courses:
        course_slug = slug(course.name)
        (out_dir / course_slug).mkdir(parents=True, exist_ok=True)
        lists_meta = []
        for lst in course.lists:
            doc = {
                "curriculum": course.name,
                "group": course.name,
                "list_id": lst.list_id,
                "list_name": lst.list_name,
                "cards": [c.to_json() for c in lst.cards],
            }
            (out_dir / lst.file).write_text(
                json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            lists_meta.append({
                "list_id": lst.list_id,
                "list_name": lst.list_name,
                "count": len(lst.cards),
                "file": lst.file,
            })
        # Flat "6 courses" model: one curriculum per course, one group inside.
        curricula.append({
            "curriculum": course.name,
            "groups": [{"group": course.name, "lists": lists_meta}],
        })

    manifest = {"curricula": curricula}
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[write] manifest.json + {sum(len(c.lists) for c in courses)} list files "
          f"-> {out_dir}/")


# --- LLM enrichment ------------------------------------------------------

def load_dotenv(path: Path) -> None:
    """Load KEY=VALUE lines from a .env file into os.environ (no override)."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        os.environ.setdefault(k, v)


def _all_cards(courses: List[Course]) -> List[Card]:
    return [c for course in courses for lst in course.lists for c in lst.cards]


def _http_post(url: str, headers: Dict[str, str], body: dict) -> dict:
    """POST JSON via stdlib urllib (no extra deps); return parsed JSON."""
    import urllib.request
    import urllib.error

    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:300]
        raise RuntimeError(f"HTTP {e.code}: {detail}") from None


def _call_llm(provider: str, key: str, model: str, prompt: str) -> str:
    """One completion call, routed by provider. Returns the text content."""
    cfg = PROVIDERS[provider]
    if cfg["kind"] == "anthropic":
        data = _http_post(
            "https://api.anthropic.com/v1/messages",
            {"content-type": "application/json", "x-api-key": key,
             "anthropic-version": "2023-06-01"},
            {"model": model, "max_tokens": 8000,
             "messages": [{"role": "user", "content": prompt}]},
        )
        return "".join(b.get("text", "") for b in data.get("content", [])
                       if b.get("type") == "text")
    if cfg["kind"] == "gemini":
        url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{model}:generateContent?key={key}")
        data = _http_post(url, {"content-type": "application/json"},
                          {"contents": [{"parts": [{"text": prompt}]}],
                           "generationConfig": {"maxOutputTokens": 8000}})
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts)
    # openai-compatible (openai / deepseek / moonshot / mistral)
    data = _http_post(
        cfg["url"],
        {"content-type": "application/json", "authorization": f"Bearer {key}"},
        {"model": model, "max_tokens": 8000,
         "messages": [{"role": "user", "content": prompt}]},
    )
    return data["choices"][0]["message"]["content"]


def _extract_json_array(text: str) -> list:
    """Tolerantly pull a JSON array out of an LLM response."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?|```$", "", text).strip()
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end != -1:
        text = text[start:end + 1]
    return json.loads(text)


def _build_prompt(batch: List[Card], langs: List[str], mode: str) -> str:
    items = [{"id": c.id, "front": c.front, "reading": c.reading,
              "meaning_zh": c.meaning_zh, "meaning_en": c.meaning_en,
              "meaning_ja": c.meaning_ja} for c in batch]
    if mode == "meanings":
        fields = ", ".join(f'"meaning_{l}"' for l in langs)
        instruction = (
            "For each Japanese vocabulary card, produce the missing short meanings "
            "for these languages: " + ", ".join(langs) + ". A short meaning is a "
            "concise gloss (the card-back answer); use whatever languages are "
            f"present as the source. Output ONLY a JSON array; each element is "
            f'{{"id": <id>, {fields}}}. No prose, no code fences.'
        )
    else:
        fields = ", ".join(f'"explain_{l}"' for l in langs)
        instruction = (
            "For each Japanese vocabulary card, write a learner-friendly explanation "
            "in each of these languages: " + ", ".join(langs) + ".\n"
            "Format each explanation value EXACTLY like this, using real line breaks:\n"
            "  • first, one or two short sentences on the core meaning, usage and nuance;\n"
            "  • then a blank line;\n"
            "  • then a line that starts with '例：' followed by a natural Japanese "
            "sentence that uses the word;\n"
            "  • then, except for the Japanese (ja) explanation, a final line with that "
            "sentence translated into the target language.\n"
            "Use \\n for the line breaks (valid JSON string escapes). Keep it concise.\n"
            "Output ONLY a JSON array; each element is "
            f'{{"id": <id>, {fields}}}. No prose, no code fences.'
        )
    return instruction + "\n\nCards:\n" + json.dumps(items, ensure_ascii=False)


def _card_list_id(card_id: str) -> Optional[str]:
    m = re.match(r"^(.+)-l(\d+)-\d+$", card_id)
    return f"{m.group(1)}-list{m.group(2)}" if m else None


def _matches_only(card: Card, only: str) -> bool:
    """only can be a course name, a list_id, or an id prefix."""
    if not only:
        return True
    m = re.match(r"^(.+)-l(\d+)-\d+$", card.id)
    course = m.group(1) if m else ""
    return only in (course, _card_list_id(card.id)) or card.id.startswith(only)


def enrich(courses: List[Course], mode: str, langs: List[str],
           provider: str, model: Optional[str], api_key: Optional[str],
           batch_size: int = 20, limit: int = 0, only: str = "",
           force: bool = False) -> None:
    """Run --fill-meanings or --explain over cards that still need it."""
    cfg = PROVIDERS[provider]
    key = api_key or os.environ.get(cfg["env"])
    if not key:
        sys.exit(f"No API key for '{provider}'. Set {cfg['env']} (env or .env) "
                 f"or pass --api-key.")
    model = model or cfg["model"]

    prefix = "meaning_" if mode == "meanings" else "explain_"

    def needs(c: Card) -> bool:
        if force:
            return True
        return any(not getattr(c, f"{prefix}{l}") for l in langs)

    todo = [c for c in _all_cards(courses) if needs(c) and _matches_only(c, only)]
    total_needed = len(todo)
    if limit and limit < len(todo):
        todo = todo[:limit]
    suffix = f" (limited to {len(todo)} of {total_needed})" if limit else ""
    print(f"[{mode}] {len(todo)} cards need work{suffix} "
          f"(provider={provider}, model={model})")
    filled = 0
    for i in range(0, len(todo), batch_size):
        batch = todo[i:i + batch_size]
        try:
            text = _call_llm(provider, key, model, _build_prompt(batch, langs, mode))
            by_id = {it["id"]: it for it in _extract_json_array(text)}
            for c in batch:
                it = by_id.get(c.id)
                if not it:
                    continue
                for lang in langs:
                    fld = f"{prefix}{lang}"
                    if (force or not getattr(c, fld)) and it.get(fld):
                        setattr(c, fld, str(it[fld]).strip())
            filled += len(batch)
            print(f"  {mode}: {min(i + batch_size, len(todo))}/{len(todo)}")
        except Exception as e:  # noqa: BLE001 - report and continue
            msg = str(e)
            print(f"  [error] batch {i}-{i + len(batch)}: {msg}")
            if any(s in msg for s in ("HTTP 401", "HTTP 402", "HTTP 403", "Insufficient Balance")):
                print("  [fatal] provider rejected the request (auth or billing). Stopping. "
                      "Top up or switch --provider, then re-run (it resumes — already-filled "
                      "cards are skipped).")
                break
    print(f"[{mode}] processed {filled} cards")


# --- CLI -----------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Build data/ from raw_data/.")
    ap.add_argument("--raw-dir", default="raw_data", type=Path)
    ap.add_argument("--out-dir", default="data", type=Path)
    ap.add_argument("--chunk-size", default=50, type=int,
                    help="words per study list (default 50)")
    ap.add_argument("--seed", default=42, type=int,
                    help="shuffle seed for reproducible lists (default 42)")
    ap.add_argument("--fill-meanings", action="store_true",
                    help="LLM-fill missing meaning languages (needs API key)")
    ap.add_argument("--explain", action="store_true",
                    help="LLM-generate Layer-1 explanations (needs API key)")
    ap.add_argument("--langs", default="zh,en,ja",
                    help="enrichment languages, comma-separated (default zh,en,ja)")
    ap.add_argument("--provider", default=DEFAULT_PROVIDER, choices=list(PROVIDERS),
                    help=f"LLM provider for enrichment (default {DEFAULT_PROVIDER})")
    ap.add_argument("--model", default=None,
                    help="model override (else the provider's default)")
    ap.add_argument("--api-key", default=None,
                    help="API key override (else the provider's env var / .env)")
    ap.add_argument("--batch-size", default=0, type=int,
                    help="cards per LLM request (0 = auto: 30 meanings / 12 explanations)")
    ap.add_argument("--limit", default=0, type=int,
                    help="only enrich the first N cards that need it (0 = all; for cheap test runs)")
    ap.add_argument("--only", default="",
                    help="restrict enrichment to a course / list_id / id prefix (e.g. N5-list01)")
    ap.add_argument("--force", action="store_true",
                    help="regenerate even if a field is already filled (overwrites)")
    args = ap.parse_args()

    load_dotenv(Path(".env"))

    if not args.raw_dir.exists():
        sys.exit(f"raw_dir not found: {args.raw_dir}")

    print(f"== Extracting from {args.raw_dir}/ "
          f"(chunk={args.chunk_size}, seed={args.seed}) ==")
    courses = build_courses(args.raw_dir, args.chunk_size, args.seed)
    if not courses:
        sys.exit("No courses built — check raw_data/ contents.")

    merge_existing(courses, args.out_dir)

    print("== Duplicate / conflict scan ==")
    dups, conflicts = detect_duplicates_conflicts(courses)

    langs = [l.strip() for l in args.langs.split(",") if l.strip()]
    if args.fill_meanings:
        print("== Filling missing meanings (LLM) ==")
        enrich(courses, "meanings", langs, args.provider, args.model, args.api_key,
               batch_size=args.batch_size or 30, limit=args.limit, only=args.only,
               force=args.force)
    if args.explain:
        print("== Generating explanations (LLM) ==")
        enrich(courses, "explanations", langs, args.provider, args.model, args.api_key,
               batch_size=args.batch_size or 12, limit=args.limit, only=args.only,
               force=args.force)

    write_output(courses, args.out_dir)

    total_cards = sum(len(l.cards) for c in courses for l in c.lists)
    print("== Summary ==")
    print(f"  courses: {len(courses)}")
    print(f"  lists:   {sum(len(c.lists) for c in courses)}")
    print(f"  cards:   {total_cards}")
    print(f"  duplicates marked: {dups}")
    print(f"  conflicts flagged: {conflicts}")


if __name__ == "__main__":
    main()
