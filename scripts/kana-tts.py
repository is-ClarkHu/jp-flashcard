#!/usr/bin/env python3
"""Generate the six VOICEVOX voices for every kana (五十音), so the kana module
plays real voices instead of the browser fallback — in both the local app and
the public demo (data/kana/ ships in the repo).

Synthesizes each kana's sound (its `pron` when set, e.g. を→お, else the kana
itself) for all six voices and records the paths on each entry's `audio` field.
Prereqs: VOICEVOX running + ffmpeg. Resumable. Run from the project root:

    python3 scripts/kana-tts.py
"""
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

VV = os.environ.get("VOICEVOX_HOST", "http://127.0.0.1:50021")
SPEAKERS = [("aoyama", 13), ("kyushu", 17), ("yurei", 103), ("zunda", 3), ("no7", 30), ("metan", 6)]
KANA = Path("data/kana")
FILES = ["hiragana.json", "katakana.json"]


def slug(s):
    """ASCII-safe, unique, stable dir name from a kana id like 'hira:あ'."""
    out = []
    for ch in s:
        if ch.isascii() and ch.isalnum():
            out.append(ch)
        elif ch in ":-_":
            out.append("-")
        else:
            out.append(f"u{ord(ch):x}")
    return "".join(out)


def vv_post(path, data=None):
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(f"{VV}{path}", data=data, method="POST", headers=headers)
    return urllib.request.urlopen(req, timeout=60).read()


def synth(text, style_id, dest):
    q = vv_post(f"/audio_query?text={urllib.parse.quote(text)}&speaker={style_id}")
    wav = vv_post(f"/synthesis?speaker={style_id}", data=q)
    p = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "wav", "-i", "pipe:0",
         "-codec:a", "libmp3lame", "-qscale:a", "5", str(dest)],
        input=wav, capture_output=True,
    )
    return p.returncode == 0 and dest.exists()


def main():
    try:
        ver = urllib.request.urlopen(f"{VV}/version", timeout=5).read().decode().strip()
    except Exception as e:  # noqa: BLE001
        sys.exit(f"VOICEVOX not reachable at {VV} ({e}) — launch the VOICEVOX app first.")
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found — install it (brew install ffmpeg).")
    print(f"[kana-tts] VOICEVOX {ver} · {len(SPEAKERS)} voices")

    made = skipped = failed = 0
    for fname in FILES:
        jf = KANA / fname
        data = json.loads(jf.read_text(encoding="utf-8"))
        for entry in data["kana"]:
            # Synthesize the kana itself — VOICEVOX reads it phonetically (を→o,
            # ん→n). (`pron` is a dict of human-readable notes, not a sound.)
            text = entry["kana"]
            if not text:
                continue
            sid_dir = KANA / "audio" / slug(entry["id"])
            sid_dir.mkdir(parents=True, exist_ok=True)
            audio = entry.get("audio") if isinstance(entry.get("audio"), dict) else {}
            for key, style in SPEAKERS:
                dest = sid_dir / f"{key}.mp3"
                rel = f"kana/audio/{slug(entry['id'])}/{key}.mp3"
                if dest.exists() and dest.stat().st_size > 0:
                    audio[key] = rel
                    skipped += 1
                    continue
                try:
                    if synth(text, style, dest):
                        audio[key] = rel
                        made += 1
                    else:
                        failed += 1
                except Exception as e:  # noqa: BLE001
                    print(f"  fail {entry['id']} {key}: {e}")
                    failed += 1
            entry["audio"] = audio
        jf.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"  {fname}: {len(data['kana'])} kana")
    print(f"[kana-tts] made {made}, skipped {skipped}, failed {failed}")


if __name__ == "__main__":
    main()
