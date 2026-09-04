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

// electron-builder leaves the app completely unsigned when no valid Apple
// Developer certificate is installed.  Current macOS releases can classify
// that unsealed Electron executable as blocked code (and even remove the app
// after the first launch attempt).  An ad-hoc signature is the macOS
// "Sign to Run Locally" identity: it seals this exact local build without
// pretending that it is suitable for distribution or notarized.
run(`codesign --force --deep --sign - "${built}"`);
run(`codesign --verify --deep --strict --verbose=2 "${built}"`);

fs.rmSync(installed, { recursive: true, force: true });
run(`ditto "${built}" "${installed}"`);
for (const attr of ["com.apple.quarantine", "com.apple.provenance"]) {
  try {
    run(`xattr -dr ${attr} "${installed}"`);
  } catch {
    /* attribute not present (or protected by this macOS version) — fine */
  }
}
run(`codesign --verify --deep --strict --verbose=2 "${installed}"`);
if (!fs.existsSync(installed)) throw new Error(`install failed: ${installed} is missing`);

// Drop the intermediate build .app so Spotlight only ever finds the installed
// copy in /Applications (otherwise release/mac-arm64/…app shows as a duplicate).
fs.rmSync("release/mac-arm64", { recursive: true, force: true });

console.log(`\n✅ Installed ${installed} — launch it from Spotlight or /Applications.`);
