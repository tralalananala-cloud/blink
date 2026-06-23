// Cipher Desktop — wrapper Electron peste build-ul web Expo (react-native-web).
// Servește static folderul ./web (copiat din `expo export --platform web`)
// printr-un server local, ca să evite problemele de path cu file://.
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");
const handler = require("serve-handler");

let server = null;

// Port FIX → origine localStorage stabilă → identitatea + conversațiile persistă
// între lansări (altfel, cu port aleator, se pierdea totul de fiecare dată).
const PORT = 8137;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) =>
      handler(req, res, { public: path.join(__dirname, "web"), cleanUrls: true })
    );
    server.on("error", () => resolve(PORT)); // deja pornit (altă instanță) → refolosește originea
    server.listen(PORT, "127.0.0.1", () => resolve(PORT));
  });
}

async function createWindow() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 440,
    height: 880,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: "#0A0C10",
    title: "Blink",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  // linkuri externe în browserul sistemului
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  // diagnostice
  win.webContents.on("did-finish-load", () => {
    console.log("[blink] page loaded");
    if (process.env.BLINK_CAPTURE) {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          require("fs").writeFileSync(process.env.BLINK_CAPTURE, img.toPNG());
          console.log("[blink] captured");
        } catch (e) { console.log("[blink] capture err", e); }
      }, 4500);
    }
  });
  win.webContents.on("did-fail-load", (_e, code, desc) => console.log("[cipher] load failed", code, desc));
  win.webContents.on("render-process-gone", (_e, d) => console.log("[cipher] renderer gone:", d.reason));
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) console.log("[renderer]", message);
  });
  win.loadURL(`http://127.0.0.1:${port}`);
}

// O singură instanță (altfel a doua ar lua alt port → altă origine localStorage)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(createWindow);
}
app.on("window-all-closed", () => {
  if (server) server.close();
  app.quit();
});
