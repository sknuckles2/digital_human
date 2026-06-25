/**
 * Electron 主进程 — 服务管理器
 *
 * 启动时自动拉起：
 *   1. Orchestrator + Edge-TTS (Node.js :6080)
 *   2. ASR Whisper 服务 (Python :6090)
 *
 * 退出时自动清理所有子进程。
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ============================================================
//  路径
// ============================================================

const ROOT_DIR = path.join(__dirname, '..');
const ORCHESTRATOR_DIR = path.join(ROOT_DIR, 'server', 'orchestrator');
const ASR_SERVICE_DIR = path.join(ROOT_DIR, 'server', 'asr-service');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const LOG_DIR = path.join(ROOT_DIR, 'logs');
const IS_DEV = !fs.existsSync(path.join(DIST_DIR, 'index.html'));

// Linux IME 兼容性
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-wayland-ime');
}

let mainWindow = null;
let orchestratorProc = null;
let asrProc = null;

// ============================================================
//  子进程管理
// ============================================================

/** 日志到文件和渲染进程 */
function emitLog(level, source, message) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] [${level.toUpperCase()}] [${source}] ${message}`;
  console.log(line);

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOG_DIR, 'electron.log'), line + '\n');

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('service-log', { level, source, message, ts });
  }
}

function startOrchestrator() {
  return new Promise((resolve) => {
    const cmd = process.execPath;
    const env = {
      ...process.env,
      ORCHESTRATOR_PORT: '6080',
      ASR_URL: 'http://127.0.0.1:6090',
      EDGE_TTS_CMD: path.join(
        process.env.USERPROFILE || '',
        'AppData', 'Roaming', 'Python', 'Python314', 'Scripts', 'edge-tts.exe'
      ),
    };

    emitLog('info', 'MAIN', '启动编排服务...');
    orchestratorProc = spawn(cmd, ['index.js'], {
      cwd: ORCHESTRATOR_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    orchestratorProc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) emitLog('info', 'ORCH', line);
    });

    orchestratorProc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) emitLog('warn', 'ORCH', line);
    });

    orchestratorProc.on('close', (code) => {
      emitLog('info', 'MAIN', `编排服务退出 (code=${code})`);
      orchestratorProc = null;
    });

    orchestratorProc.on('error', (err) => {
      emitLog('error', 'MAIN', `编排服务启动失败: ${err.message}`);
    });

    waitForPort(6080, '编排服务').then(resolve);
  });
}

function startASR() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'python.exe' : 'python3';
    const env = {
      ...process.env,
      ASR_PORT: '6090',
      WHISPER_MODEL: 'base',
      WHISPER_DEVICE: 'cpu',
    };

    emitLog('info', 'MAIN', '启动 ASR 服务...');
    asrProc = spawn(cmd, ['asr_service.py'], {
      cwd: ASR_SERVICE_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    asrProc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) emitLog('info', 'ASR', line);
    });

    asrProc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) emitLog('warn', 'ASR', line);
    });

    asrProc.on('close', (code) => {
      emitLog('info', 'MAIN', `ASR 服务退出 (code=${code})`);
      asrProc = null;
    });

    asrProc.on('error', (err) => {
      emitLog('error', 'MAIN', `ASR 服务启动失败: ${err.message}`);
    });

    waitForPort(6090, 'ASR 服务').then(resolve);
  });
}

function waitForPort(port, label, timeout = 15000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > timeout) {
        emitLog('warn', 'MAIN', `${label} 启动超时 (${timeout}ms)`);
        resolve(false);
        return;
      }
      const net = require('net');
      const sock = new net.Socket();
      sock.setTimeout(1000);
      sock.on('connect', () => {
        sock.destroy();
        emitLog('info', 'MAIN', `${label} 就绪 (:${port})`);
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        setTimeout(check, 500);
      });
      sock.connect(port, '127.0.0.1');
    };
    check();
  });
}

function stopServices() {
  const procs = [
    { name: '编排服务', proc: orchestratorProc },
    { name: 'ASR 服务', proc: asrProc },
  ];
  for (const { name, proc } of procs) {
    if (proc) {
      emitLog('info', 'MAIN', `停止 ${name}...`);
      try { proc.kill('SIGTERM'); } catch {}
      if (process.platform === 'win32') {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
      }
    }
  }
  if (process.platform === 'win32') {
    try { require('child_process').execSync('taskkill /f /im python.exe 2>nul', { stdio: 'ignore' }); } catch {}
  }
}

// ============================================================
//  生产模式静态文件服务器
// ============================================================

let prodServer = null;

function startProdServer() {
  return new Promise((resolve) => {
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.webm': 'audio/webm',
      '.moc3': 'application/octet-stream',
      '.can3': 'application/octet-stream',
      '.cmo3': 'application/octet-stream',
    };

    function proxyRequest(clientReq, clientRes, targetUrl, timeout) {
      const urlObj = new URL(targetUrl);
      const opts = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: clientReq.method,
        headers: { ...clientReq.headers, host: urlObj.host },
        timeout,
      };
      delete opts.headers['x-api-target'];

      const proxyReq = http.request(opts, (proxyRes) => {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks);
          clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
          clientRes.end(body);
        });
      });

      proxyReq.on('error', (err) => {
        emitLog('error', 'PROXY', `代理失败: ${err.message}`);
        if (!clientRes.headersSent) {
          clientRes.writeHead(502, { 'Content-Type': 'application/json' });
          clientRes.end(JSON.stringify({ error: `Proxy error: ${err.message}` }));
        }
      });

      clientReq.on('data', (c) => proxyReq.write(c));
      clientReq.on('end', () => proxyReq.end());
    }

    prodServer = http.createServer((req, res) => {
      if (req.url.startsWith('/api/')) {
        const targetBase = req.headers['x-api-target'];
        const apiPath = req.url.replace(/^\/api\/[^\/]+/, '') || '/';

        if (req.url.startsWith('/api/llm') && targetBase) {
          const targetUrl = `${String(targetBase).replace(/\/$/, '')}${apiPath}`;
          emitLog('info', 'PROXY', `${req.method} ${req.url} → ${targetUrl}`);
          proxyRequest(req, res, targetUrl, 30000);
          return;
        }

        if (req.url.startsWith('/api/voice')) {
          const targetUrl = `http://127.0.0.1:6080${apiPath}`;
          emitLog('info', 'PROXY', `${req.method} ${req.url} → ${targetUrl}`);
          proxyRequest(req, res, targetUrl, 60000);
          return;
        }

        res.writeHead(404);
        res.end('API route not found');
        return;
      }

      let url = req.url.split('?')[0];
      if (url === '/') url = '/index.html';

      const filePath = path.join(DIST_DIR, url);
      const ext = path.extname(filePath);

      if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          fs.readFile(path.join(DIST_DIR, 'index.html'), (_, html) => {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
          });
          return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });

    prodServer.listen(0, '127.0.0.1', () => {
      const port = prodServer.address().port;
      emitLog('info', 'MAIN', `静态服务运行在 :${port}`);
      resolve(port);
    });
  });
}

// ============================================================
//  窗口管理
// ============================================================

function createWindow(prodPort) {
  mainWindow = new BrowserWindow({
    width: 260,
    height: 380,
    x: 100,
    y: 100,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (IS_DEV) {
    mainWindow.loadURL('https://localhost:3000/?electron=1');
    mainWindow.webContents.session.setCertificateVerifyProc((_req, callback) => {
      callback(0);
    });
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${prodPort}/?electron=1`);
  }

  mainWindow.setIgnoreMouseEvents(false);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================================
//  IPC 通信
// ============================================================

ipcMain.on('toggle-always-on-top', () => {
  if (!mainWindow) return;
  const wasTop = mainWindow.isAlwaysOnTop();
  const next = !wasTop;
  if (next) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true);
    mainWindow.focus();
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
  }
  mainWindow.webContents.send('always-on-top-changed', next);
});

ipcMain.on('set-always-on-top', (_event, top) => {
  if (!mainWindow) return;
  if (top) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setVisibleOnAllWorkspaces(true);
    mainWindow.focus();
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(false);
  }
  mainWindow.webContents.send('always-on-top-changed', top);
});

ipcMain.on('window-close', () => {
  if (!mainWindow) return;
  mainWindow.close();
});

ipcMain.on('resize-window', (_event, { width, height, skipTaskbar, center }) => {
  if (!mainWindow) return;
  mainWindow.setResizable(true);
  const [cx, cy] = mainWindow.getPosition();
  const [cw, ch] = mainWindow.getSize();
  const nx = cx + Math.round((cw - width) / 2);
  const ny = cy + Math.round((ch - height) / 2);
  mainWindow.setMinimumSize(width, height);
  mainWindow.setMaximumSize(width, height);
  mainWindow.setSize(width, height);
  mainWindow.setPosition(nx, ny);
  if (skipTaskbar !== undefined) mainWindow.setSkipTaskbar(skipTaskbar);
  if (center === true) mainWindow.center();
  setTimeout(() => mainWindow?.setResizable(false), 50);
});

// 读取历史日志
ipcMain.handle('get-logs', async () => {
  const logFile = path.join(LOG_DIR, 'electron.log');
  if (!fs.existsSync(logFile)) return [];
  const content = fs.readFileSync(logFile, 'utf-8');
  return content.split('\n').filter(Boolean).slice(-200).map((line) => {
    const match = line.match(/^\[(.+?)\] \[(.+?)\] \[(.+?)\] (.+)$/);
    if (match) return { ts: match[1], level: match[2].toLowerCase(), source: match[3], message: match[4] };
    return { ts: '', level: 'info', source: 'FILE', message: line };
  });
});

// ============================================================
//  应用生命周期
// ============================================================

app.whenReady().then(async () => {
  emitLog('info', 'MAIN', '启动数字人后台服务...');
  await Promise.all([startOrchestrator(), startASR()]);
  emitLog('info', 'MAIN', '所有服务已就绪');

  let prodPort = 3000;
  if (!IS_DEV) {
    prodPort = await startProdServer();
  }

  createWindow(prodPort);
});

app.on('before-quit', () => {
  stopServices();
  if (prodServer) { try { prodServer.close(); } catch {} }
});

app.on('window-all-closed', () => {
  stopServices();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
