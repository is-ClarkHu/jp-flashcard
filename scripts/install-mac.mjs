// One-shot updater for the everyday Mac app (Apple Silicon).
//
// Rebuilds from source and (re)installs into /Applications, so the app you launch
// daily reflects the latest code. The .app is a build artifact — source under
// src/ electron/ styles/ is the real thing; this just regenerates and copies it.
//
//   npm run app:mac

import { execSync } from "node:child_process";
import fs from "node:fs";

const APP = "JP Flashcards.app";
const built = `release/mac-arm64/${APP}`;
const installed = `/Applications/${APP}`;
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

run("npm run build");
run("npx electron-builder --mac dir --arm64");

fs.rmSync(installed, { recursive: true, force: true });
run(`ditto "${built}" "${installed}"`);
try {
  run(`xattr -dr com.apple.quarantine "${installed}"`);
} catch {
  /* no quarantine attribute to clear — fine */
}

// Drop the intermediate build .app so Spotlight only ever finds the installed
// copy in /Applications (otherwise release/mac-arm64/…app shows as a duplicate).
fs.rmSync("release/mac-arm64", { recursive: true, force: true });

console.log(`\n✅ Installed ${installed} — launch it from Spotlight or /Applications.`);
