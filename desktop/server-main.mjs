import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import fs from "fs";
import net from "net";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let serverPort = 3000;
let tunnelProcess = null;
let currentTunnelUrl = "";

// 获取本机所有局域网 IPv4 地址
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

// 检查端口是否被占用，被占用则自动找空闲端口
function checkOrFindPort(desiredPort) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", () => {
      // 端口被占用，找随机空闲端口
      const fallback = net.createServer();
      fallback.listen(0, "0.0.0.0", () => {
        const port = fallback.address().port;
        fallback.close(() => resolve(port));
      });
    });
    tester.once("listening", () => {
      tester.close(() => resolve(desiredPort));
    });
    tester.listen(desiredPort, "0.0.0.0");
  });
}

// 等待后端接口就绪
async function waitForHealth(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return true;
    } catch {
      /* 稍后重试 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// 寻找可用的 cloudflared 可执行文件
function findCloudflaredExecutable() {
  const candidates = [
    // 绿色版运行目录（同级目录）
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "cloudflared-windows-amd64.exe") : null,
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "cloudflared.exe") : null,
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "cloudflared", "cloudflared-windows-amd64.exe") : null,
    // 应用程序工作目录
    path.join(process.cwd(), "cloudflared-windows-amd64.exe"),
    path.join(process.cwd(), "cloudflared.exe"),
    path.join(process.cwd(), "cloudflared", "cloudflared-windows-amd64.exe"),
    // 打包资源内
    path.join(here, "cloudflared-windows-amd64.exe"),
    path.join(here, "cloudflared.exe"),
    path.join(process.resourcesPath || "", "cloudflared-windows-amd64.exe"),
    path.join(process.resourcesPath || "", "cloudflared.exe"),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "cloudflared"; // 尝试系统 PATH
}

// 启动 Cloudflare 隧道
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
      console.log("[tunnel-log]", text);
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match && match[0]) {
        currentTunnelUrl = match[0];
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("tunnel-url", currentTunnelUrl);
        }
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("error", (err) => {
      console.warn("[tunnel-err]", err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("tunnel-error", err.message);
      }
    });

    child.on("exit", (code) => {
      console.log("[tunnel] 进程退出，代码:", code);
      if (code !== 0 && (!currentTunnelUrl || currentTunnelUrl === "")) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("tunnel-error", `隧道退出 (code: ${code})`);
        }
      }
    });
  } catch (err) {
    console.warn("[tunnel] 启动失败:", err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tunnel-error", err.message);
    }
  }
}

// 启动主服务器
async function startServer() {
  const port = await checkOrFindPort(3000);
  serverPort = port;

  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });

  process.env.PORT = String(port);
  process.env.HOST = "0.0.0.0"; // 开启局域网与公网全接口监听
  process.env.PUBLIC_SERVER = "true"; // 启用公网模式下的注册/IP 等限制
  process.env.NODE_ENV = "production";
  process.env.DATA_DIR = dataDir;
  process.env.WEB_DIST = path.join(here, "web-dist");
  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  }

  await import("./server-bundle.mjs");
  const ok = await waitForHealth(port);
  if (!ok) throw new Error("后端服务启动超时，请检查系统端口占用情况");
  return port;
}

function createServerWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 720,
    minWidth: 700,
    minHeight: 580,
    title: "起笔 · 公网服务器控制中心",
    backgroundColor: "#0f1117",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // 允许页面调用 shell 与 ipcRenderer
    },
  });

  const uiPath = path.join(here, "server-ui", "index.html");
  mainWindow.loadFile(uiPath);

  mainWindow.webContents.on("did-finish-load", () => {
    const ips = getLocalIpAddresses();
    mainWindow.webContents.send("server-ready", {
      port: serverPort,
      lanUrls: ips.map((ip) => `http://${ip}:${serverPort}`),
    });
    if (currentTunnelUrl) {
      mainWindow.webContents.send("tunnel-url", currentTunnelUrl);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC 交互
ipcMain.on("restart-tunnel", () => {
  currentTunnelUrl = "";
  startCloudflareTunnel(serverPort);
});

ipcMain.on("open-data-folder", () => {
  const dataDir = path.join(app.getPath("userData"), "data");
  shell.openPath(dataDir);
});

// App 生命周期
app.whenReady().then(async () => {
  try {
    const port = await startServer();
    createServerWindow();
    startCloudflareTunnel(port);
  } catch (err) {
    console.error("[server-main] 启动失败:", err);
    app.quit();
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
