import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import fs from "fs";
import net from "net";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

// 判断当前运行模式：公网服务器模式 vs 本地单机写作模式
const isServerMode =
  process.argv.includes("--server") ||
  process.env.APP_MODE === "server" ||
  path.basename(process.execPath).includes("服务器") ||
  path.basename(process.execPath).toLowerCase().includes("server");

// ==========================================
// 1. 公共与服务器辅助函数
// ==========================================

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function checkPortAvailable(port, host = "0.0.0.0") {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => resolve(false));
    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

async function waitForHealth(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      /* 稍后重试 */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function findCloudflaredExecutable() {
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "cloudflared-windows-amd64.exe") : null,
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "cloudflared.exe") : null,
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "cloudflared", "cloudflared-windows-amd64.exe") : null,
    path.join(process.cwd(), "cloudflared-windows-amd64.exe"),
    path.join(process.cwd(), "cloudflared.exe"),
    path.join(process.cwd(), "cloudflared", "cloudflared-windows-amd64.exe"),
    path.join(here, "cloudflared-windows-amd64.exe"),
    path.join(here, "cloudflared.exe"),
    path.join(process.resourcesPath || "", "cloudflared-windows-amd64.exe"),
    path.join(process.resourcesPath || "", "cloudflared.exe"),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "cloudflared";
}

// ==========================================
// 2. 公网服务器模式运行逻辑
// ==========================================

let serverWindow = null;
let tunnelProcess = null;
let currentTunnelUrl = "";
let runningPort = 3000;

function startCloudflareTunnel(port) {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill();
    } catch {}
    tunnelProcess = null;
  }

  const exePath = findCloudflaredExecutable();
  console.log("[tunnel] 使用 cloudflared 路径:", exePath);

  try {
    const child = spawn(exePath, ["tunnel", "--protocol", "http2", "--url", `http://127.0.0.1:${port}`], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    tunnelProcess = child;

    const onData = (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && match[0]) {
        currentTunnelUrl = match[0];
        if (serverWindow && !serverWindow.isDestroyed()) {
          serverWindow.webContents.send("tunnel-url", currentTunnelUrl);
        }
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (err) => {
      if (serverWindow && !serverWindow.isDestroyed()) {
        serverWindow.webContents.send("tunnel-error", err.message);
      }
    });

    child.on("exit", (code) => {
      if (code !== 0 && !currentTunnelUrl) {
        if (serverWindow && !serverWindow.isDestroyed()) {
          serverWindow.webContents.send("tunnel-error", `隧道退出 (code: ${code})`);
        }
      }
    });
  } catch (err) {
    if (serverWindow && !serverWindow.isDestroyed()) {
      serverWindow.webContents.send("tunnel-error", err.message);
    }
  }
}

let runningDataDir = "";

function resolveServerDataDir() {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return process.env.DATA_DIR.trim();
  }
  // 优先保存在 E: 盘专属保密目录
  if (fs.existsSync("E:\\") || fs.existsSync("E:/")) {
    return "E:\\起笔-公网服务器数据\\data";
  }
  if (fs.existsSync("D:\\") || fs.existsSync("D:/")) {
    return "D:\\起笔-公网服务器数据\\data";
  }
  return path.join(app.getPath("userData"), "data");
}

async function runAsPublicServer() {
  const isPort3000Free = await checkPortAvailable(3000, "0.0.0.0");
  runningPort = isPort3000Free ? 3000 : await findFreePort("0.0.0.0");

  const dataDir = resolveServerDataDir();
  runningDataDir = dataDir;
  fs.mkdirSync(dataDir, { recursive: true });

  // 如果本地历史数据库存在且目标目录尚未创建数据库，安全迁移/复制过去
  const fallbackDb = path.join(app.getPath("userData"), "data", "novelforge.db");
  const targetDb = path.join(dataDir, "novelforge.db");
  if (fs.existsSync(fallbackDb) && !fs.existsSync(targetDb)) {
    try {
      fs.copyFileSync(fallbackDb, targetDb);
      console.log("[data] 已将历史数据平滑同步至保密路径:", targetDb);
    } catch {}
  }

  process.env.PORT = String(runningPort);
  process.env.HOST = "0.0.0.0"; // 全网监听
  process.env.NODE_ENV = "production";
  process.env.DATA_DIR = dataDir;
  process.env.WEB_DIST = path.join(here, "web-dist");
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  }

  await import("./server-bundle.mjs");
  const ok = await waitForHealth(runningPort);
  if (!ok) throw new Error("后端服务启动超时，请检查端口占用");

  serverWindow = new BrowserWindow({
    width: 880,
    height: 740,
    minWidth: 720,
    minHeight: 600,
    title: "起笔 · 公网服务器控制中心",
    backgroundColor: "#0f1117",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const uiPath = path.join(here, "server-ui", "index.html");
  serverWindow.loadFile(uiPath);

  serverWindow.webContents.on("did-finish-load", () => {
    const ips = getLocalIpAddresses();
    serverWindow.webContents.send("server-ready", {
      port: runningPort,
      lanUrls: ips.map((ip) => `http://${ip}:${runningPort}`),
    });
    if (currentTunnelUrl) {
      serverWindow.webContents.send("tunnel-url", currentTunnelUrl);
    }
  });

  serverWindow.on("closed", () => {
    serverWindow = null;
  });

  startCloudflareTunnel(runningPort);
}

// ==========================================
// 3. 本地单机写作模式运行逻辑
// ==========================================

async function runAsStandaloneClient() {
  const port = await findFreePort("127.0.0.1");

  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  process.env.PORT = String(port);
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "production";
  process.env.DATA_DIR = dataDir;
  process.env.WEB_DIST = path.join(here, "web-dist");
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  }

  await import("./server-bundle.mjs");
  const ok = await waitForHealth(port);
  if (!ok) throw new Error("后端服务启动超时，请检查日志");

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "起笔 · 小说创作平台",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

// ==========================================
// 4. IPC 与生命周期监听
// ==========================================

ipcMain.on("restart-tunnel", () => {
  currentTunnelUrl = "";
  startCloudflareTunnel(runningPort);
});

ipcMain.on("open-data-folder", () => {
  const dataDir = runningDataDir || resolveServerDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  shell.openPath(dataDir);
});

app.whenReady().then(() => {
  if (isServerMode) {
    console.log("[app] 启动模式: 公网服务器控制中心");
    runAsPublicServer().catch((err) => {
      console.error("[desktop-server] 启动失败:", err);
      app.quit();
    });
  } else {
    console.log("[app] 启动模式: 本地单机写作工作台");
    runAsStandaloneClient().catch((err) => {
      console.error("[desktop-client] 启动失败:", err);
      app.quit();
    });
  }
});

app.on("window-all-closed", () => {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill();
    } catch {}
    tunnelProcess = null;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill();
    } catch {}
    tunnelProcess = null;
  }
});
