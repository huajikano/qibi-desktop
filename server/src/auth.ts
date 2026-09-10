import express, { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db } from "./db.js";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  ai_api_key_enc: string | null;
  ai_api_key_enabled: number;
  ai_api_base_url: string | null;
  ai_api_protocol: "auto" | "anthropic" | "openai";
  ai_api_model: string | null;
  distill_api_key_enc?: string | null;
  distill_api_key_enabled?: number;
  distill_api_base_url?: string | null;
  distill_api_protocol?: "auto" | "anthropic" | "openai";
  distill_api_model?: string | null;
  world_api_key_enc?: string | null;
  world_api_key_enabled?: number;
  world_api_base_url?: string | null;
  world_api_protocol?: "auto" | "anthropic" | "openai";
  world_api_model?: string | null;
  agent_api_key_enc?: string | null;
  agent_api_key_enabled?: number;
  agent_api_base_url?: string | null;
  agent_api_protocol?: "auto" | "anthropic" | "openai";
  agent_api_model?: string | null;
  disabled: number;
  created_at: string;
}

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    ai_api_key_enabled: !!u.ai_api_key_enabled,
    distill_api_key_enabled: !!u.distill_api_key_enabled,
    world_api_key_enabled: !!u.world_api_key_enabled,
    agent_api_key_enabled: !!u.agent_api_key_enabled,
    created_at: u.created_at,
  };
}

function isDisabled(id: number): boolean {
  const row = db.prepare("SELECT disabled FROM users WHERE id = ?").get(id) as { disabled: number } | undefined;
  return !!row?.disabled;
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userApiKey?: string;
    userApiBaseUrl?: string;
    userApiProtocol?: "auto" | "anthropic" | "openai";
    userApiModel?: string;
    distillApiKey?: string;
    distillApiBaseUrl?: string;
    distillApiProtocol?: "auto" | "anthropic" | "openai";
    distillApiModel?: string;
    worldApiKey?: string;
    worldApiBaseUrl?: string;
    worldApiProtocol?: "auto" | "anthropic" | "openai";
    worldApiModel?: string;
    agentApiKey?: string;
    agentApiBaseUrl?: string;
    agentApiProtocol?: "auto" | "anthropic" | "openai";
    agentApiModel?: string;
  }
}

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "尝试次数过多，请 10 分钟后再试" },
});

// 确保管理员初始账号存在
export function seedAdmin() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123456";
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!exists) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(
      username,
      hash
    );
    console.log(`[init] 管理员账号已创建: ${username}`);
  }
}

router.post("/register", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "用户名与密码不能为空" });
  if (!/^[a-zA-Z0-9_\p{Script=Han}]{2,20}$/u.test(username))
    return res.status(400).json({ error: "用户名需为 2-20 位中文、字母、数字或下划线" });
  if (password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
  const dup = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (dup) return res.status(409).json({ error: "用户名已被占用" });

  // 公网服务器模式：每个客户端 IP 至多注册 3 个账号，防止恶意刷号
  const PUBLIC_SERVER = process.env.PUBLIC_SERVER === "true";
  if (PUBLIC_SERVER) {
    const clientIp = req.ip || "";
    if (clientIp) {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE registered_from_ip = ? AND role != 'admin'")
        .get(clientIp) as { n: number };
      if ((row?.n ?? 0) >= 3) {
        return res.status(429).json({
          error: "当前网络环境下注册次数已达上限（同一 IP 至多注册 3 个账号），如有需要请联系管理员",
        });
      }
    }
    const hash2 = bcrypt.hashSync(password, 10);
    const info2 = db
      .prepare("INSERT INTO users (username, password_hash, registered_from_ip) VALUES (?, ?, ?)")
      .run(username, hash2, clientIp);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info2.lastInsertRowid) as unknown as UserRow;
    req.session.userId = user.id;
    return res.json({ user: publicUser(user) });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(username, hash);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid) as unknown as UserRow;
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

router.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "请输入用户名和密码" });
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as unknown as UserRow | undefined;
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: "用户名或密码错误" });
  if (user.disabled) return res.status(403).json({ error: "账号已被停用，请联系管理员" });
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

router.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId) as unknown as UserRow | undefined;
  if (!user) return res.json({ user: null });
  res.json({ user: publicUser(user) });
});

// 中间件：必须登录
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ error: "请先登录" });
  if (isDisabled(req.session.userId)) return res.status(403).json({ error: "账号已被停用" });
  next();
}

// 中间件：必须是管理员
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) return res.status(401).json({ error: "请先登录" });
  if (isDisabled(req.session.userId)) return res.status(403).json({ error: "账号已被停用" });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId) as unknown as UserRow;
  if (user.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
  next();
}

// 中间件：当前登录用户
export function currentUser(req: Request): UserRow | null {
  if (!req.session.userId) return null;
  if (isDisabled(req.session.userId)) return null;
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId) as unknown as UserRow) || null;
}

function ownsUserNovel(userId: number, role: string, novelId: number): boolean {
  const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(novelId) as { user_id: number } | undefined;
  return !!novel && (novel.user_id === userId || role === "admin");
}

export function ownsChapter(req: Request, res: Response, next: NextFunction) {
  const chapter = db.prepare("SELECT novel_id FROM chapters WHERE id = ?").get(Number(req.params.id)) as { novel_id: number } | undefined;
  const user = currentUser(req);
  if (!chapter) return res.status(404).json({ error: "章节不存在" });
  if (!user) return res.status(401).json({ error: "请先登录" });
  if (!ownsUserNovel(user.id, user.role, chapter.novel_id)) return res.status(403).json({ error: "无权操作他人作品" });
  next();
}

export function ownsOutline(req: Request, res: Response, next: NextFunction) {
  const outline = db.prepare("SELECT novel_id FROM outlines WHERE id = ?").get(Number(req.params.id)) as { novel_id: number } | undefined;
  const user = currentUser(req);
  if (!outline) return res.status(404).json({ error: "大纲不存在" });
  if (!user) return res.status(401).json({ error: "请先登录" });
  if (!ownsUserNovel(user.id, user.role, outline.novel_id)) return res.status(403).json({ error: "无权操作他人作品" });
  next();
}

export function ownsMap(req: Request, res: Response, next: NextFunction) {
  const map = db.prepare("SELECT novel_id FROM maps WHERE id = ?").get(Number(req.params.id)) as { novel_id: number } | undefined;
  const user = currentUser(req);
  if (!map) return res.status(404).json({ error: "地图不存在" });
  if (!user) return res.status(401).json({ error: "请先登录" });
  if (!ownsUserNovel(user.id, user.role, map.novel_id)) return res.status(403).json({ error: "无权操作他人作品" });
  next();
}

// 中间件：校验小说归属权（多作者隔离）
export function ownsNovel(req: Request, res: Response, next: NextFunction) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const novelId = Number(req.params.novelId ?? req.params.id);
  const novel = db.prepare("SELECT id, user_id FROM novels WHERE id = ?").get(novelId) as
    | { id: number; user_id: number }
    | undefined;
  if (!novel) return res.status(404).json({ error: "作品不存在" });
  if (novel.user_id !== user.id && user.role !== "admin")
    return res.status(403).json({ error: "无权操作他人作品" });
  req.body._novelId = novelId;
  next();
}

export default router;
