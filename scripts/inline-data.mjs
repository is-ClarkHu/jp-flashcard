// Post-build step for the standalone (file://) target: inline the entire
// library (manifest + every list JSON) into dist-standalone/index.html as a
// global, so the single file opens directly from file:// with no fetch.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const dataDir = path.join(root, "data");
const htmlPath = path.join(root, "dist-standalone", "index.html");

const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf8"));

const lists = {};
for (const cur of manifest.curricula) {
  for (const g of cur.groups) {
    for (const l of g.lists) {
      lists[l.file] = JSON.parse(fs.readFileSync(path.join(dataDir, l.file), "utf8"));
    }
  }
}

// Kana (五十音) is a fixed, self-authored static set; inline it too so the kana
// module works in the single-file target with no fetch.
const kana = {};
for (const [key, file] of [["hira", "hiragana.json"], ["kata", "katakana.json"]]) {
  const p = path.join(dataDir, "kana", file);
  if (fs.existsSync(p)) kana[key] = JSON.parse(fs.readFileSync(p, "utf8"));
}

const json = JSON.stringify({ manifest, lists, kana }).replace(/</g, "\\u003c");
const tag = `<script>window.__JPLIB__=${json};</script>`;

let html = fs.readFileSync(htmlPath, "utf8");
// Insert the library global before the app's inlined module script.
html = html.replace('<script type="module"', `${tag}<script type="module"`);
fs.writeFileSync(htmlPath, html);

const kb = (fs.statSync(htmlPath).size / 1024).toFixed(0);
console.log(`inlined ${Object.keys(lists).length} lists into dist-standalone/index.html (${kb} KB)`);
