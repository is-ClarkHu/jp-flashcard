// `npm run electron:dev` — run Electron against the live Vite dev server so you can
// debug Electron-specific behavior (IndexedDB persistence, the app window, etc.)
// with hot reload and DevTools, without a production build.
//
// It starts Vite programmatically, points Electron at the resolved dev URL via the
// ELECTRON_DEV_URL env var (read by electron/main.cjs), and tears the dev server
// down again when the Electron window is closed. No extra dependencies — Vite and
// Electron are already devDependencies.

import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron"; // default export is the path to the electron binary

const server = await createServer();
await server.listen();

const url = server.resolvedUrls?.local?.[0];
if (!url) {
  console.error("electron:dev — could not resolve the Vite dev server URL.");
  await server.close();
  process.exit(1);
}

console.log(`\n  Vite dev server: ${url}\n  Launching Electron (DevTools will open)…\n`);

const child = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_DEV_URL: url },
});

async function shutdown(code) {
  try {
    await server.close();
  } catch {
    /* already closing */
  }
  process.exit(code ?? 0);
}

child.on("close", (code) => shutdown(code ?? 0));
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
