import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import helmet from "helmet";
import session from "express-session";
import MemoryStoreFactory from "memorystore";
import cors from "cors";
import { db, now } from "./db.js";
import authRouter, { seedAdmin, requireAdmin } from "./auth.js";
import novelsRouter from "./routes/novels.js";
import chaptersRouter from "./routes/chapters.js";
import outlinesRouter from "./routes/outlines.js";
import charactersRouter from "./routes/characters.js";
import mapsRouter from "./routes/maps.js";
import aiRouter from "./routes/ai.js";
import adminRouter from "./routes/admin.js";
import skillAuthorsRouter from "./routes/skillAuthors.js";
import mcpRouter from "./routes/mcp.js";
import mcpClientRouter from "./routes/mcpClient.js";
import agentRouter from "./routes/agent.js";
import kbRouter from "./routes/kb.js";
import skillsRouter from "./routes/skills.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0"; // 默认监听 0.0.0.0 支持局域网与公网访问；桌面客户端主进程可覆盖为 127.0.0.1
const IS_PROD = process.env.NODE_ENV === "production";

// 信任反向代理（Nginx / Caddy / cpolar / frp / Cloudflare Tunnel 等）
app.set("trust proxy", true);

seedAdmin();

// 安全响应头（放宽限制以良好支持局域网 IP 与反向代理域名访问）
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// 会话（内存存储：零外部依赖，密码与账号数据完全存在本地 SQLite 数据库中）
const MemoryStore = MemoryStoreFactory(session);
function resolveDefaultDataDir(): string {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return process.env.DATA_DIR.trim();
  }
  if (process.env.HOST === "0.0.0.0" && (fs.existsSync("E:\\") || fs.existsSync("E:/"))) {
    return "E:\\起笔-公网服务器数据\\data";
  }
  return path.resolve(process.cwd(), "data");
}

const DATA_DIR = resolveDefaultDataDir();
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(
  session({
    store: new MemoryStore({ checkPeriod: 86400000 }),
    secret: process.env.SESSION_SECRET || "novelforge-local-server-secret-key-2026",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // 兼容 HTTP 局域网直连与公网反向代理
      maxAge: 7 * 24 * 3600 * 1000,
    },
  })
);

// 获取本机所有局域网 IPv4 地址
export function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// 健康检查
app.get("/api/health", (_req, res) => res.json({ ok: true, time: now() }));

// 系统网络与服务器信息接口（仅管理员可查看，防止公网普通用户探测主机内网拓扑与路径）
app.get("/api/system/network-info", requireAdmin, (_req, res) => {
  const ips = getLocalIpAddresses();
  res.json({
    ok: true,
    host: HOST,
    port: PORT,
    isNetworkMode: HOST === "0.0.0.0",
    localUrls: ["http://localhost:" + PORT, "http://127.0.0.1:" + PORT],
    lanUrls: ips.map((ip) => "http://" + ip + ":" + PORT),
    dataDir: DATA_DIR,
    databaseFile: path.join(DATA_DIR, "novelforge.db"),
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: now(),
  });
});

// 业务路由
app.use("/api/auth", authRouter);
app.use("/api", novelsRouter);
app.use("/api", chaptersRouter);
app.use("/api", outlinesRouter);
app.use("/api", charactersRouter);
app.use("/api", mapsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/admin", adminRouter);
app.use("/api", skillAuthorsRouter);
app.use("/api", mcpRouter);
app.use("/api/mcp", mcpClientRouter);
app.use("/api/agent", agentRouter);
app.use("/api", kbRouter);
app.use("/api", skillsRouter);

// 生产环境：托管前端构建产物（自动查找 web/dist 路径）
const candidateDistPaths = [
  process.env.WEB_DIST,
  path.resolve(process.cwd(), "web", "dist"),
  path.resolve(process.cwd(), "dist"),
  path.resolve(process.cwd(), "..", "web", "dist"),
  path.resolve(process.cwd(), "..", "..", "web", "dist"),
].filter(Boolean) as string[];

const WEB_DIST = candidateDistPaths.find((p) => fs.existsSync(path.join(p, "index.html"))) || "";

if (WEB_DIST && fs.existsSync(WEB_DIST)) {
  console.log("[novelforge] 前端静态资源托管自: " + WEB_DIST);
  app.use(express.static(WEB_DIST, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      }
    }
  }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
} else {
  console.warn("[novelforge] 未找到前端构建产物 web/dist，仅提供 API 接口服务");
}

// 统一错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[error]", err?.message);
  res.status(err?.status || 500).json({ error: err?.message || "服务器内部错误" });
});

app.listen(PORT, HOST, () => {
  const lanIps = getLocalIpAddresses();
  console.log("");
  console.log("==========================================================");
  console.log("  起笔 · 小说创作平台 (NovelForge) 本机服务器已启动");
  console.log("==========================================================");
  console.log("  【本机电脑访问】");
  console.log("    -> http://localhost:" + PORT);
  console.log("    -> http://127.0.0.1:" + PORT);
  if (HOST === "0.0.0.0" && lanIps.length > 0) {
    console.log("  【局域网/手机/其他设备访问】(确保处于同一 WiFi 或局域网)");
    lanIps.forEach((ip) => {
      console.log("    -> http://" + ip + ":" + PORT);
    });
  }
  console.log("  【公网/外网访问】");
  console.log("    -> 支持路由器端口映射 (NAT 转发端口 " + PORT + ")");
  console.log("    -> 或使用内网穿透工具 (如 cpolar / frp / Cloudflare Tunnel)");
  console.log("  【数据与登录存储】");
  console.log("    -> 账号、密码 Hash、小说、角色与地图 100% 保存在本机 SQLite");
  console.log("    -> 数据目录: " + DATA_DIR);
  console.log("==========================================================");
  console.log("");
});
