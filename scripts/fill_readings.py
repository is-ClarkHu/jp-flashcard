#!/usr/bin/env python3
"""Fill missing `reading` (kana) on cards in data/*/list*.json — free, offline.

Strategy per card with empty reading, in priority order:
  1. card's own `meaning_ja` if it is pure kana  -> trust source data
  2. `front` is pure kana (no kanji)             -> the word is its own reading
  3. otherwise                                   -> pykakasi auto furigana (hira)

Run dry first (prints stats + samples); pass --apply to write files in place.
"""
import json, re, sys, glob, os

KANJI = re.compile(r'[一-鿿々〆ヶ]')           # has CJK ideograph
KANA  = re.compile(r'^[ぁ-ゖァ-ヺーゝゞ・〜～\s]+$')  # pure kana (allow long-vowel/punct)
PAREN = re.compile(r'[(（]([ぁ-ゖァ-ヺーゝゞ・]+)[)）]')  # furigana in parens, e.g. 留学生(りゅうがくせい)

import pykakasi
_kks = pykakasi.kakasi()

def is_pure_kana(s):
    return bool(s) and bool(KANA.match(s))

def auto_reading(front):
    return "".join(r['hira'] for r in _kks.convert(front)).strip()

def reading_for(card):
    """Return (reading, source) or (None, 'skip')."""
    mj = (card.get("meaning_ja") or "").strip()
    if is_pure_kana(mj):
        return mj, "meaning_ja"
    front = (card.get("front") or "").strip()
    if not front:
        return None, "skip"
    m = PAREN.search(front)            # front carries its own furigana
    if m:
        return m.group(1), "paren"
    if not KANJI.search(front):
        return front, "front_kana"
    r = auto_reading(front)
    return (r, "pykakasi") if r else (None, "skip")

def main():
    apply = "--apply" in sys.argv
    files = sorted(glob.glob("data/*/list*.json"))
    stats = {"meaning_ja": 0, "paren": 0, "front_kana": 0, "pykakasi": 0, "skip": 0}
    samples = {"meaning_ja": [], "paren": [], "front_kana": [], "pykakasi": []}
    changed_files = 0
    for mf in files:
        top = json.load(open(mf, encoding="utf-8"))
        cards = top.get("cards", [])
        dirty = False
        for c in cards:
            if c.get("reading"):
                continue
            r, src = reading_for(c)
            stats[src] += 1
            if src != "skip" and len(samples[src]) < 12:
                samples[src].append((c.get("front"), r))
            if r and apply:
                c["reading"] = r
                dirty = True
        if dirty:
            with open(mf, "w", encoding="utf-8") as f:
                json.dump(top, f, ensure_ascii=False, indent=2)
                f.write("\n")
            changed_files += 1

    print(f"{'APPLIED' if apply else 'DRY RUN'} over {len(files)} files")
    print(f"  filled from meaning_ja : {stats['meaning_ja']}")
    print(f"  filled from paren furi : {stats['paren']}")
    print(f"  filled from front kana : {stats['front_kana']}")
    print(f"  filled via pykakasi    : {stats['pykakasi']}")
    print(f"  could not fill (skip)  : {stats['skip']}")
    if apply:
        print(f"  files rewritten        : {changed_files}")
    for src in ("meaning_ja", "paren", "front_kana", "pykakasi"):
        print(f"\n  -- {src} samples (front -> reading) --")
        for f_, r in samples[src]:
            print(f"     {f_!r:14} -> {r}")

if __name__ == "__main__":
    main()
