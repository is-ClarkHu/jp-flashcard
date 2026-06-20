#!/usr/bin/env python3
"""Generate rich Layer-1 explanations for the sample deck, in the SAME format as
the full library (convert.py --explain): a short usage note, a blank line, then
'例：' + a natural Japanese sentence, then its translation (zh/en only).

It reuses convert.py's prompt and LLM call verbatim, so the output matches the
real library exactly. Needs an API key (env / .env / --api-key), like convert.py.
Run from the project root, e.g.:

    python3 scripts/sample-explain.py --provider deepseek --api-key sk-...
    # or set DEEPSEEK_API_KEY in .env and just: python3 scripts/sample-explain.py
"""
import argparse
import json
import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import convert  # noqa: E402  (reuse PROVIDERS, prompt builder, LLM call, .env loader)

LANGS = ["zh", "en", "ja"]
SAMPLE = ROOT / "data" / "sample"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default="deepseek", choices=list(convert.PROVIDERS))
    ap.add_argument("--model", default=None)
    ap.add_argument("--api-key", default=None)
    ap.add_argument("--batch", type=int, default=20)
    args = ap.parse_args()

    convert.load_dotenv(ROOT / ".env")
    cfg = convert.PROVIDERS[args.provider]
    import os
    key = args.api_key or os.environ.get(cfg["env"])
    if not key:
        sys.exit(f"No API key for '{args.provider}'. Set {cfg['env']} (env or .env) or pass --api-key.")
    model = args.model or cfg["model"]

    # Load every sample list (skip the manifest), remembering which file each card is in.
    files = {}            # path -> data dict
    cards = []            # SimpleNamespace per card (what _build_prompt needs)
    where = {}            # card id -> (path, index)
    for jf in sorted(SAMPLE.glob("*.json")):
        if jf.name == "manifest.json":
            continue
        data = json.loads(jf.read_text(encoding="utf-8"))
        files[jf] = data
        for i, c in enumerate(data["cards"]):
            cards.append(SimpleNamespace(id=c["id"], front=c["front"], reading=c["reading"],
                                         meaning_zh=c["meaning_zh"], meaning_en=c["meaning_en"],
                                         meaning_ja=c["meaning_ja"]))
            where[c["id"]] = (jf, i)

    print(f"[explain] {len(cards)} cards · {args.provider}/{model} · batches of {args.batch}")
    done = 0
    for start in range(0, len(cards), args.batch):
        batch = cards[start:start + args.batch]
        prompt = convert._build_prompt(batch, LANGS, "explain")
        try:
            text = convert._call_llm(args.provider, key, model, prompt)
            rows = convert._extract_json_array(text)
        except Exception as e:  # noqa: BLE001
            print(f"  batch {start // args.batch + 1} failed: {e}")
            continue
        for row in rows:
            loc = where.get(row.get("id"))
            if not loc:
                continue
            jf, idx = loc
            card = files[jf]["cards"][idx]
            for l in LANGS:
                v = row.get(f"explain_{l}")
                if v:
                    card[f"explain_{l}"] = v
            done += 1
        print(f"  {start + len(batch)}/{len(cards)} cards")

    for jf, data in files.items():
        jf.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"[explain] wrote explanations for {done} cards across {len(files)} lists")


if __name__ == "__main__":
    main()
