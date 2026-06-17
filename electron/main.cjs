// Electron main process. Serves the built dist/ over a custom "app://" protocol
// (registered as a standard, secure, fetch-capable scheme) so the SPA's relative
// fetch('./manifest.json') works without disabling web security.
//
// It also owns the durable user save: a single save.json in userData, written
// atomically with rotating backups. Because there is exactly one main process
// regardless of which origin a window loaded (app:// or the dev server), every
// window shares this one file — that is what frees user data from the per-origin
// IndexedDB split that otherwise makes "the same app" look empty when opened a
// different way (different port, different browser, packaged vs dev).

const { app, BrowserWindow, protocol, net, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const DIST = path.join(__dirname, "..", "dist");

// Set by `npm run electron:dev` (scripts/electron-dev.mjs): when present, load the
// live Vite dev server instead of the built bundle, and open DevTools. Lets you
// debug Electron-specific behavior with hot reload, without a full build. The
// save.json below is shared across both modes (same main process).
const DEV_URL = process.env.ELECTRON_DEV_URL;

const MAX_BACKUPS = 20;
const saveFile = () => path.join(app.getPath("userData"), "save.json");
const backupDir = () => path.join(app.getPath("userData"), "backups");

function readSave() {
  try {
    return JSON.parse(fs.readFileSync(saveFile(), "utf8"));
  } catch {
    return null; // missing or unreadable → caller treats as "no file"
  }
}

function rotateBackup(data) {
  try {
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(path.join(dir, `save-${stamp}.json`), data);
    const old = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("save-") && f.endsWith(".json"))
      .sort();
    for (const f of old.slice(0, Math.max(0, old.length - MAX_BACKUPS))) {
      fs.unlinkSync(path.join(dir, f));
    }
  } catch (e) {
    // A backup failure must never break the primary save.
    console.error("[save] backup rotation failed:", e);
  }
}

function writeSave(snapshot) {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  const data = JSON.stringify(snapshot, null, 2);
  // Atomic: write a temp file in the same dir, then rename over save.json.
  const tmp = path.join(dir, `save.json.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, saveFile());
  rotateBackup(data);
  return true;
}

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 360,
    backgroundColor: "#faf8f5",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (DEV_URL) {
    win.loadURL(DEV_URL);
    win.webContents.openDevTools();
  } else {
    win.loadURL("app://app/index.html");
  }
}

// Single instance: a second launch focuses the existing window instead of
// opening a second one that would race the same save.json.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    ipcMain.handle("jpstore:load", () => readSave());
    ipcMain.handle("jpstore:save", (_e, snapshot) => {
      try {
        return writeSave(snapshot);
      } catch (e) {
        console.error("[save] write failed:", e);
        return false;
      }
    });
    ipcMain.handle("jpstore:reveal", () => {
      const f = saveFile();
      if (fs.existsSync(f)) shell.showItemInFolder(f);
      else shell.openPath(app.getPath("userData"));
      return true;
    });

    protocol.handle("app", (request) => {
      const url = new URL(request.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/" || rel === "") rel = "/index.html";
      const filePath = path.join(DIST, rel);
      return net.fetch(pathToFileURL(filePath).toString());
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
