/**
 * Plotline — Electron Main Process
 *
 * Wraps the Express server in an Electron shell.
 * Checks for system dependencies, starts the server as a child process,
 * waits for it to be ready, then opens a BrowserWindow.
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn, execFileSync, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PLOTLINE_PORT || 3847;
const SERVER_URL = `http://localhost:${PORT}`;

// When packaged, asar-unpacked files live at app.asar.unpacked/
// In dev mode, they're just relative to the project root.
function getAppRoot() {
  if (app.isPackaged) {
    // In packaged mode, __dirname = .../Resources/app.asar/electron
    // path.dirname(__dirname) = .../Resources/app.asar
    // We need .../Resources/app.asar.unpacked (sibling, not child)
    const asarDir = path.dirname(__dirname); // .../Resources/app.asar
    const resourcesDir = path.dirname(asarDir); // .../Resources
    return path.join(resourcesDir, 'app.asar.unpacked');
  }
  // Dev mode: project root
  return path.join(__dirname, '..');
}

// User data directory for storing uploads, projects, exports, models
function getDataDir() {
  return path.join(app.getPath('userData'), 'data');
}

const APP_ROOT = getAppRoot();
const SERVER_SCRIPT = path.join(APP_ROOT, 'server.js');

let mainWindow = null;
let serverProcess = null;

// ---------------------------------------------------------------------------
// Dependency Checks
// ---------------------------------------------------------------------------

function findBinary(name) {
  // Check common Homebrew paths first, then system PATH
  const commonPaths = [
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const result = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf-8' }).trim();
    if (result) return result;
  } catch {}
  return null;
}

function checkDependencies() {
  const missing = [];

  // Homebrew whisper-cpp installs as "whisper-cli" (not "whisper-cpp")
  if (!findBinary('whisper-cli')) {
    missing.push({
      name: 'whisper-cpp',
      install: 'brew install whisper-cpp',
    });
  }

  if (!findBinary('ffmpeg')) {
    missing.push({
      name: 'ffmpeg',
      install: 'brew install ffmpeg',
    });
  }

  if (missing.length > 0) {
    const names = missing.map((d) => d.name).join(', ');
    const instructions = missing
      .map((d) => `  • ${d.name}:\n    ${d.install}`)
      .join('\n\n');

    const result = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Missing Dependencies',
      message: `Plotline requires ${names} to be installed.`,
      detail:
        `Install via Homebrew:\n\n${instructions}\n\n` +
        `If you don't have Homebrew, install it first:\n` +
        `  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`,
      buttons: ['Open Homebrew Site', 'Quit'],
      defaultId: 1,
    });

    if (result === 0) {
      shell.openExternal('https://brew.sh');
    }

    app.quit();
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Server Management
// ---------------------------------------------------------------------------

function startServer() {
  return new Promise((resolve, reject) => {
    const dataDir = getDataDir();

    // Ensure data directories exist
    for (const sub of ['uploads', 'projects', 'exports', 'models']) {
      const dir = path.join(dataDir, sub);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    console.log('[main] App root:', APP_ROOT);
    console.log('[main] Server script:', SERVER_SCRIPT);
    console.log('[main] Data directory:', dataDir);

    if (!fs.existsSync(SERVER_SCRIPT)) {
      reject(new Error(`Server script not found at: ${SERVER_SCRIPT}`));
      return;
    }

    // Build a PATH that includes Homebrew
    const brewPaths = '/opt/homebrew/bin:/usr/local/bin';
    const currentPath = process.env.PATH || '';
    const fullPath = `${brewPaths}:${currentPath}`;

    // Spawn the Express server as a child process.
    // Use Electron's bundled Node.js binary (process.execPath resolves to the
    // Electron binary, but we need the real node inside the framework).
    // However, Electron *can* run Node scripts via process.execPath with
    // the ELECTRON_RUN_AS_NODE flag, which makes it behave as plain Node.
    serverProcess = spawn(process.execPath, [SERVER_SCRIPT], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PATH: fullPath,
        PLOTLINE_PORT: String(PORT),
        PLOTLINE_DATA_DIR: dataDir,
        ELECTRON: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`[server] ${data.toString().trim()}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[server-err] ${data.toString().trim()}`);
    });

    serverProcess.on('error', (err) => {
      console.error('[server] Failed to start:', err);
      reject(err);
    });

    serverProcess.on('exit', (code, signal) => {
      console.log(`[server] Exited with code ${code}, signal ${signal}`);
      serverProcess = null;
    });

    // Poll until the server is ready
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds

    const poll = setInterval(() => {
      attempts++;
      const req = http.get(SERVER_URL, (res) => {
        clearInterval(poll);
        console.log('[server] Ready!');
        resolve();
      });

      req.on('error', () => {
        if (attempts >= maxAttempts) {
          clearInterval(poll);
          reject(new Error('Server did not start within 30 seconds'));
        }
      });

      req.setTimeout(500, () => req.destroy());
    }, 500);
  });
}

function killServer() {
  if (serverProcess) {
    console.log('[server] Shutting down...');
    serverProcess.kill('SIGTERM');

    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
        serverProcess = null;
      }
    }, 5000);
  }
}

// ---------------------------------------------------------------------------
// Window Management
// ---------------------------------------------------------------------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App Lifecycle
// ---------------------------------------------------------------------------

app.on('ready', async () => {
  if (!checkDependencies()) return;

  try {
    await startServer();
    createWindow();
  } catch (err) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Startup Error',
      message: 'Failed to start Plotline server.',
      detail: err.message + '\n\nCheck Console.app for more details.',
    });
    app.quit();
  }
});

app.on('window-all-closed', () => {
  killServer();
  app.quit();
});

app.on('before-quit', () => {
  killServer();
});

app.on('activate', () => {
  if (mainWindow === null && serverProcess) {
    createWindow();
  }
});
