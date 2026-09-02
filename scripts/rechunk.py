#!/usr/bin/env python3
"""
Re-split an already-built data/ library into smaller (or larger) study lists.

Why this exists
---------------
`convert.py --chunk-size N` builds lists from raw_data/, but a plain re-run with
a different chunk size would assign new card ids and therefore lose every
enriched field (readings, meanings, explanations) and every generated audio clip,
because merge_existing() matches by card id.

This script does the same re-split *in place on data/*: it keeps the card order
produced by the original deterministic shuffle, re-slices each source file into
lists of --chunk-size cards, renumbers list ids / card ids exactly the way
convert.py would, moves the per-card audio folders to their new ids, and rewrites
manifest.json. Nothing is re-parsed and nothing is re-generated, so all
enrichment and all mp3s survive.

It also writes an id map (old -> new) so user progress stored by card id
(favorites, wrong book, ...) can be migrated with scripts/remap_save.py.

Usage
-----
    ./venv/bin/python scripts/rechunk.py --chunk-size 30
    ./venv/bin/python scripts/rechunk.py --chunk-size 30 --dry-run

After it finishes, rebuild the app (`npm run build`, then `npm run app:mac`).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Tuple

# A list name is "<source label> - <part>", e.g. "Unit 3 - 2" or "N5 - 4".
LIST_NAME_RE = re.compile(r"^(.*) - (\d+)$")

TMP_AUDIO_DIR = ".rechunk-tmp"


# --- Reading the existing library ----------------------------------------

def source_label(list_name: str) -> str:
    """'Unit 3 - 2' -> 'Unit 3'. Names without a part suffix map to themselves."""
    m = LIST_NAME_RE.match(list_name)
    return m.group(1) if m else list_name


def load_library(data_dir: Path) -> Tuple[dict, List[dict]]:
    """Return (manifest, courses) where each course carries its loaded lists."""
    manifest_path = data_dir / "manifest.json"
    if not manifest_path.exists():
        sys.exit(f"[error] {manifest_path} not found — build the library first.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    courses = []
    for cur in manifest.get("curricula", []):
        lists = []
        for group in cur.get("groups", []):
            for meta in group.get("lists", []):
                doc_path = data_dir / meta["file"]
                if not doc_path.exists():
                    sys.exit(f"[error] {doc_path} missing (manifest is out of date).")
                doc = json.loads(doc_path.read_text(encoding="utf-8"))
                lists.append({"meta": meta, "doc": doc})
        if not lists:
            continue
        # Every list of a course lives in the same folder: "N5/list01.json".
        slug = Path(lists[0]["meta"]["file"]).parent.as_posix()
        courses.append({"curriculum": cur, "slug": slug, "lists": lists})
    return manifest, courses


def group_by_source(course: dict) -> "OrderedDict[str, List[dict]]":
    """Concatenate each source file's cards back together, in list order."""
    by_source: "OrderedDict[str, List[dict]]" = OrderedDict()
    for item in course["lists"]:
        label = source_label(item["doc"].get("list_name") or item["meta"]["list_name"])
        by_source.setdefault(label, []).extend(item["doc"].get("cards", []))
    return by_source


# --- Re-splitting ---------------------------------------------------------

def rechunk_course(course: dict, chunk_size: int) -> Tuple[List[dict], Dict[str, str]]:
    """Build the new list docs for one course + the old-id -> new-id card map."""
    slug = course["slug"]
    new_lists: List[dict] = []
    id_map: Dict[str, str] = {}
    list_num = 0

    for label, cards in group_by_source(course).items():
        for part, start in enumerate(range(0, len(cards), chunk_size), start=1):
            list_num += 1
            chunk = [dict(c) for c in cards[start:start + chunk_size]]
            for seq, card in enumerate(chunk, start=1):
                old_id = card.get("id") or ""
                new_id = f"{slug}-l{list_num:02d}-{seq:03d}"
                if old_id and old_id != new_id:
                    id_map[old_id] = new_id
                card["id"] = new_id
                card["audio"] = remap_audio_paths(card.get("audio"), old_id, new_id)
            new_lists.append({
                "list_id": f"{slug}-list{list_num:02d}",
                "list_name": f"{label} - {part}",
                "file": f"{slug}/list{list_num:02d}.json",
                "cards": chunk,
            })
    return new_lists, id_map


def remap_audio_paths(audio, old_id: str, new_id: str):
    """Point '<course>/audio/<old id>/<voice>.mp3' at the card's new id."""
    if not isinstance(audio, dict) or not old_id or old_id == new_id:
        return audio if isinstance(audio, dict) else {}
    return {
        key: path.replace(f"/audio/{old_id}/", f"/audio/{new_id}/")
        if isinstance(path, str) else path
        for key, path in audio.items()
    }


# --- Writing --------------------------------------------------------------

def move_audio(data_dir: Path, slug: str, id_map: Dict[str, str], dry_run: bool) -> int:
    """
    Rename each per-card audio folder to its new card id.

    Old and new ids overlap, so this is done in two phases via a staging folder:
    everything moves out of audio/ first, then back in under its new name.
    """
    audio_root = data_dir / slug / "audio"
    if not audio_root.is_dir():
        return 0
    pending = [(old, new) for old, new in id_map.items()
               if (audio_root / old).is_dir()]
    if not pending or dry_run:
        return len(pending)

    staging = audio_root / TMP_AUDIO_DIR
    if staging.exists():
        sys.exit(f"[error] {staging} already exists — a previous run was interrupted.")
    staging.mkdir()
    for old, new in pending:
        (audio_root / old).rename(staging / new)
    for _, new in pending:
        (staging / new).rename(audio_root / new)
    staging.rmdir()
    return len(pending)


def write_course(data_dir: Path, course: dict, new_lists: List[dict], dry_run: bool) -> None:
    """Write the new list files and delete the list files they replace."""
    old_files = {item["meta"]["file"] for item in course["lists"]}
    new_files = {lst["file"] for lst in new_lists}
    cur = course["curriculum"]

    if dry_run:
        return
    for lst in new_lists:
        doc = {
            "curriculum": cur["curriculum"],
            "group": cur["groups"][0]["group"] if cur.get("groups") else cur["curriculum"],
            "list_id": lst["list_id"],
            "list_name": lst["list_name"],
            "cards": lst["cards"],
        }
        (data_dir / lst["file"]).write_text(
            json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    for stale in sorted(old_files - new_files):
        (data_dir / stale).unlink(missing_ok=True)


def write_manifest(data_dir: Path, manifest: dict, dry_run: bool) -> None:
    if dry_run:
        return
    (data_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# --- Main -----------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="Re-split data/ into lists of N cards.")
    ap.add_argument("--data-dir", default="data", type=Path)
    ap.add_argument("--chunk-size", default=30, type=int,
                    help="words per study list (default: 30)")
    # Path("") is Path("."), not an empty/falsy path.  Using it as the default
    # made the completed rechunk fail at the final step by trying to write JSON
    # to the current directory.  Keep the sentinel as None instead.
    ap.add_argument("--map-out", default=None, type=Path,
                    help="where to write the old-id -> new-id map "
                         "(default: <data-dir>/../.rechunk-map.json)")
    ap.add_argument("--dry-run", action="store_true",
                    help="report what would change, write nothing")
    args = ap.parse_args()

    if args.chunk_size < 1:
        sys.exit("[error] --chunk-size must be >= 1")

    data_dir: Path = args.data_dir
    manifest, courses = load_library(data_dir)
    if not courses:
        sys.exit("[error] manifest.json has no courses.")

    backup = data_dir / "manifest.json.bak"
    if not args.dry_run:
        shutil.copy2(data_dir / "manifest.json", backup)

    full_map: Dict[str, str] = {}
    list_map: Dict[str, str] = {}
    total_cards = total_lists = moved_audio = 0

    print(f"== Re-chunking {data_dir} to {args.chunk_size} words/list "
          f"{'(dry run) ' if args.dry_run else ''}==")

    for course in courses:
        name = course["curriculum"]["curriculum"]
        new_lists, id_map = rechunk_course(course, args.chunk_size)

        # An old list maps to whichever new list its first card landed in, so
        # per-list progress can be pointed somewhere sensible.
        for item in course["lists"]:
            cards = item["doc"].get("cards") or []
            if not cards:
                continue
            first = cards[0].get("id", "")
            new_first = id_map.get(first, first)
            m = re.match(r"^(.*)-l(\d+)-\d+$", new_first)
            if m:
                list_map[item["meta"]["list_id"]] = f"{m.group(1)}-list{m.group(2)}"

        moved = move_audio(data_dir, course["slug"], id_map, args.dry_run)
        write_course(data_dir, course, new_lists, args.dry_run)

        # Rewrite this course's manifest entry (flat model: one group per course).
        lists_meta = [{
            "list_id": lst["list_id"],
            "list_name": lst["list_name"],
            "count": len(lst["cards"]),
            "file": lst["file"],
        } for lst in new_lists]
        groups = course["curriculum"].get("groups") or [{"group": name, "lists": []}]
        groups[0]["lists"] = lists_meta
        course["curriculum"]["groups"] = groups[:1]

        cards_n = sum(len(lst["cards"]) for lst in new_lists)
        total_cards += cards_n
        total_lists += len(new_lists)
        moved_audio += moved
        full_map.update(id_map)
        print(f"[course] {name}: {len(course['lists'])} -> {len(new_lists)} lists, "
              f"{cards_n} cards, {len(id_map)} ids changed, {moved} audio folders moved")

    write_manifest(data_dir, manifest, args.dry_run)

    map_path = args.map_out if args.map_out is not None else data_dir.parent / ".rechunk-map.json"
    if not args.dry_run:
        map_path.write_text(json.dumps({
            "chunk_size": args.chunk_size,
            "cards": full_map,
            "lists": list_map,
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"== {total_lists} lists / {total_cards} cards; "
          f"{len(full_map)} card ids changed; {moved_audio} audio folders moved ==")
    if args.dry_run:
        print("(dry run: nothing was written)")
    else:
        print(f"id map -> {map_path}")
        print(f"manifest backup -> {backup}")
        print("Next: scripts/remap_save.py (user progress), then npm run build.")


if __name__ == "__main__":
    main()
