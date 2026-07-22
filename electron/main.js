const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');
const handler = require('serve-handler');

// This app's UI is exported from the same Expo/React Native codebase used for the phone app (via
// `expo export -p web`), so it isn't reflowed for wide desktop windows — the window below is sized
// like a phone on purpose rather than stretching a portrait layout across a wide screen.
const WINDOW_WIDTH = 430;
const WINDOW_HEIGHT = 900;

const DIST_DIR = path.join(__dirname, '..', 'dist');

let mainWindow;
let server;

/**
 * Serves the exported static web build over plain HTTP on localhost instead of `file://`, since
 * the export's asset paths are root-absolute (e.g. `/favicon.ico`) and only resolve correctly
 * against a server root. Also sets the cross-origin isolation headers expo-sqlite's web backend
 * requires (it uses SharedArrayBuffer, which browsers/Chromium disable unless the response opts
 * in via COOP/COEP) — without these, the app's database would silently fail to open.
 */
function startStaticServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      handler(req, res, { public: DIST_DIR });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function createWindow() {
  const port = await startStaticServer();

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 360,
    minHeight: 640,
    title: 'Stonks',
    backgroundColor: '#0f3d2e',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
