/**
 * Plotline — Electron Main Process
 *
 * Wraps the Express server in an Electron shell.
 * Checks for system dependencies, starts the server as a child process,
 * waits for it to be ready, then opens a BrowserWindow.
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const { fork, execFileSync } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PLOTLINE_PORT || 3847;
const SERVER_URL = `http://localhost:${PORT}`;
const SERVER_SCRIPT = path.join(__dirname, '..', 'server.js');

let mainWindow = null;
let serverProcess = null;

// ---------------------------------------------------------------------------
// Dependency Checks
// ---------------------------------------------------------------------------

function commandExists(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function checkDependencies() {
  const missing = [];

  if (!commandExists('whisper-cpp')) {
    missing.push({
      name: 'whisper-cpp',
      install: 'brew install whisper-cpp',
    });
  }

  if (!commandExists('ffmpeg')) {
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
    // Ensure data directories exist
    const dataDir = path.join(__dirname, '..', 'data');
    for (const sub of ['uploads', 'projects', 'exports', 'models']) {
      const dir = path.join(dataDir, sub);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Fork the Express server as a child process
    serverProcess = fork(SERVER_SCRIPT, [], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PLOTLINE_PORT: String(PORT),
        ELECTRON: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`[server] ${data.toString().trim()}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[server] ${data.toString().trim()}`);
    });

    serverProcess.on('error', (err) => {
      console.error('[server] Failed to start:', err);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      console.log(`[server] Exited with code ${code}`);
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

    // Force kill after 5 seconds if still running
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
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(SERVER_URL);

  // Show window when content is ready (avoids white flash)
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
  // Check dependencies first
  if (!checkDependencies()) return;

  try {
    await startServer();
    createWindow();
  } catch (err) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'Startup Error',
      message: 'Failed to start Plotline server.',
      detail: err.message,
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
