// Electron main process. Serves the built dist/ over a custom "app://" protocol
// (registered as a standard, secure, fetch-capable scheme) so the SPA's relative
// fetch('./manifest.json') works without disabling web security.

const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("path");
const { pathToFileURL } = require("url");

const DIST = path.join(__dirname, "..", "dist");

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
  win.loadURL("app://app/index.html");
}

app.whenReady().then(() => {
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
