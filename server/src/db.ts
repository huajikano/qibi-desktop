import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import crypto from "crypto";

function resolveDefaultDataDir(): string {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return process.env.DATA_DIR.trim();
  }
  // 若本机存在 E: 盘且处于服务器模式，默认使用 E: 盘保密数据路径
  if (process.env.HOST === "0.0.0.0" && (fs.existsSync("E:\\") || fs.existsSync("E:/"))) {
    return "E:\\起笔-公网服务器数据\\data";
  }
  return path.resolve(process.cwd(), "data");
}

const DATA_DIR = resolveDefaultDataDir();
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Node 24 内置 SQLite（零原生依赖，无需 node-gyp 编译）
export const db = new DatabaseSync(path.join(DATA_DIR, "novelforge.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ---- schema ----
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'author',
  ai_api_key_enc TEXT,
  ai_api_key_enabled INTEGER DEFAULT 0,
  ai_api_base_url TEXT,
  ai_api_protocol TEXT NOT NULL DEFAULT 'auto',
  ai_api_model TEXT,
  distill_api_key_enc TEXT,
  distill_api_key_enabled INTEGER DEFAULT 0,
  distill_api_base_url TEXT,
  distill_api_protocol TEXT NOT NULL DEFAULT 'auto',
  distill_api_model TEXT,
  world_api_key_enc TEXT,
  world_api_key_enabled INTEGER DEFAULT 0,
  world_api_base_url TEXT,
  world_api_protocol TEXT NOT NULL DEFAULT 'auto',
  world_api_model TEXT,
  agent_api_key_enc TEXT,
  agent_api_key_enabled INTEGER DEFAULT 0,
  agent_api_base_url TEXT,
  agent_api_protocol TEXT NOT NULL DEFAULT 'auto',
  agent_api_model TEXT,
  disabled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS novels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '玄幻',
  status TEXT NOT NULL DEFAULT '连载中',
  intro TEXT NOT NULL DEFAULT '',
  cover_color TEXT NOT NULL DEFAULT '#e60012',
  word_count INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '草稿',
  word_count INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '主角',
  gender TEXT NOT NULL DEFAULT '未知',
  age TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  background TEXT NOT NULL DEFAULT '',
  relationships TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '世界地图',
  data TEXT NOT NULL DEFAULT '{}',
  thumbnail TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS distilled_authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '{}',
  current_version_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);

CREATE TABLE IF NOT EXISTS distilled_author_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES distilled_authors(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'novel',
  filename TEXT NOT NULL,
  format TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  parsed_chars INTEGER NOT NULL DEFAULT 0,
  chapter_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'uploaded',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS distilled_author_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES distilled_authors(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  writing_skill TEXT NOT NULL DEFAULT '',
  author_persona TEXT NOT NULL DEFAULT '',
  skill_markdown TEXT NOT NULL DEFAULT '',
  sample_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(author_id, version)
);


CREATE TABLE IF NOT EXISTS chapter_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '修改前备份',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS novel_writer_state (
  novel_id INTEGER PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  distilled_author_id INTEGER,
  progress TEXT NOT NULL DEFAULT '',
  foreshadowing TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_novels_user ON novels(user_id);
CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_id);
CREATE INDEX IF NOT EXISTS idx_outlines_novel ON outlines(novel_id);
CREATE INDEX IF NOT EXISTS idx_characters_novel ON characters(novel_id);
CREATE INDEX IF NOT EXISTS idx_maps_novel ON maps(novel_id);
CREATE INDEX IF NOT EXISTS idx_distilled_authors_user ON distilled_authors(user_id);
CREATE INDEX IF NOT EXISTS idx_distilled_sources_author ON distilled_author_sources(author_id);
CREATE INDEX IF NOT EXISTS idx_distilled_versions_author ON distilled_author_versions(author_id);
CREATE INDEX IF NOT EXISTS idx_writer_state_user ON novel_writer_state(user_id);
CREATE INDEX IF NOT EXISTS idx_revisions_chapter ON chapter_revisions(chapter_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL,
  source_kind TEXT NOT NULL,           -- 'chapter' | 'outline' | 'character' | 'world' | 'manual'
  source_id INTEGER,                   -- 关联章节/大纲/人设/地图的 ID
  title TEXT,
  content TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_novel ON kb_chunks(novel_id);
CREATE INDEX IF NOT EXISTS idx_kb_source ON kb_chunks(novel_id, source_kind, source_id);

-- 用户自定义 Skill 通用化（参考 ai-novelist：每条 Skill = 一段 Markdown 提示词）
-- scope: writer / distill / world / all，分别注入到不同 AI 调用的系统提示词前缀
-- source_kind: manual（手写）/ uploaded（上传文件）/ distilled_author（绑定蒸馏作者）
-- source_ref: 关联来源的物理路径或蒸馏作者 ID
CREATE TABLE IF NOT EXISTS user_skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'writer',
  source_kind TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT,
  content TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_user_skills_user ON user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_scope ON user_skills(user_id, scope, enabled);

-- 百万字小说分层记忆系统：分卷大纲与大事件脉络
CREATE TABLE IF NOT EXISTS volumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  core_conflict TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_volumes_novel ON volumes(novel_id);

-- 百万字小说分层记忆系统：章节微摘要与前情提要链
CREATE TABLE IF NOT EXISTS chapter_summaries (
  chapter_id INTEGER PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  key_events TEXT NOT NULL DEFAULT '',
  cliffhanger TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_summaries_novel ON chapter_summaries(novel_id);

-- 百万字小说分层记忆系统：角色动态账本（位置、境界、伤病、持有道具、最新心境）
CREATE TABLE IF NOT EXISTS character_states (
  character_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  current_location TEXT NOT NULL DEFAULT '',
  current_realm TEXT NOT NULL DEFAULT '',
  inventory TEXT NOT NULL DEFAULT '',
  status_effects TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_char_states_novel ON character_states(novel_id);

`);

// 为已有数据库执行幂等迁移；CREATE TABLE IF NOT EXISTS 不会给旧表补列。
const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
if (!userColumns.some((c) => c.name === "ai_api_base_url")) {
  db.exec("ALTER TABLE users ADD COLUMN ai_api_base_url TEXT");
}
if (!userColumns.some((c) => c.name === "ai_api_protocol")) {
  db.exec("ALTER TABLE users ADD COLUMN ai_api_protocol TEXT NOT NULL DEFAULT 'auto'");
}
if (!userColumns.some((c) => c.name === "ai_api_model")) {
  db.exec("ALTER TABLE users ADD COLUMN ai_api_model TEXT");
}
if (!userColumns.some((c) => c.name === "distill_api_key_enc")) {
  db.exec("ALTER TABLE users ADD COLUMN distill_api_key_enc TEXT");
}
if (!userColumns.some((c) => c.name === "distill_api_key_enabled")) {
  db.exec("ALTER TABLE users ADD COLUMN distill_api_key_enabled INTEGER DEFAULT 0");
}
if (!userColumns.some((c) => c.name === "distill_api_base_url")) {
  db.exec("ALTER TABLE users ADD COLUMN distill_api_base_url TEXT");
}
if (!userColumns.some((c) => c.name === "distill_api_protocol")) {
  db.exec("ALTER TABLE users ADD COLUMN distill_api_protocol TEXT NOT NULL DEFAULT 'auto'");
}
if (!userColumns.some((c) => c.name === "distill_api_model")) {
  db.exec("ALTER TABLE users ADD COLUMN distill_api_model TEXT");
}
if (!userColumns.some((c) => c.name === "world_api_key_enc")) {
  db.exec("ALTER TABLE users ADD COLUMN world_api_key_enc TEXT");
}
if (!userColumns.some((c) => c.name === "world_api_key_enabled")) {
  db.exec("ALTER TABLE users ADD COLUMN world_api_key_enabled INTEGER DEFAULT 0");
}
if (!userColumns.some((c) => c.name === "world_api_base_url")) {
  db.exec("ALTER TABLE users ADD COLUMN world_api_base_url TEXT");
}
if (!userColumns.some((c) => c.name === "world_api_protocol")) {
  db.exec("ALTER TABLE users ADD COLUMN world_api_protocol TEXT NOT NULL DEFAULT 'auto'");
}
if (!userColumns.some((c) => c.name === "world_api_model")) {
  db.exec("ALTER TABLE users ADD COLUMN world_api_model TEXT");
}
if (!userColumns.some((c) => c.name === "ai_custom_prompts")) {
  db.exec("ALTER TABLE users ADD COLUMN ai_custom_prompts TEXT DEFAULT '{}'");
}
if (!userColumns.some((c) => c.name === "agent_api_key_enc")) {
  db.exec("ALTER TABLE users ADD COLUMN agent_api_key_enc TEXT");
}
if (!userColumns.some((c) => c.name === "agent_api_key_enabled")) {
  db.exec("ALTER TABLE users ADD COLUMN agent_api_key_enabled INTEGER DEFAULT 0");
}
if (!userColumns.some((c) => c.name === "agent_api_base_url")) {
  db.exec("ALTER TABLE users ADD COLUMN agent_api_base_url TEXT");
}
if (!userColumns.some((c) => c.name === "agent_api_protocol")) {
  db.exec("ALTER TABLE users ADD COLUMN agent_api_protocol TEXT NOT NULL DEFAULT 'auto'");
}
if (!userColumns.some((c) => c.name === "agent_api_model")) {
  db.exec("ALTER TABLE users ADD COLUMN agent_api_model TEXT");
}
if (!userColumns.some((c) => c.name === "registered_from_ip")) {
  db.exec("ALTER TABLE users ADD COLUMN registered_from_ip TEXT DEFAULT ''");
}


const chapterColumns = db.prepare("PRAGMA table_info(chapters)").all() as Array<{ name: string }>;
if (!chapterColumns.some((c) => c.name === "volume_id")) {
  db.exec("ALTER TABLE chapters ADD COLUMN volume_id INTEGER REFERENCES volumes(id) ON DELETE SET NULL");
}

const novelColumns = db.prepare("PRAGMA table_info(novels)").all() as Array<{ name: string }>;
if (!novelColumns.some((c) => c.name === "is_public")) {
  db.exec("ALTER TABLE novels ADD COLUMN is_public INTEGER NOT NULL DEFAULT 1");
}

// ---- helpers ----
export function now(): string {
  return new Date().toISOString();
}

export function countChineseChars(s: string): number {
  const cjk = s.match(/[一-鿿㐀-䶿]/g);
  const other = s.replace(/[一-鿿㐀-䶿]/g, "").length;
  return (cjk ? cjk.length : 0) + other;
}

export function encryptKey(plain: string, secret: string): string {
  const key = crypto.createHash("sha256").update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptKey(payload: string, secret: string): string | null {
  try {
    const [ivB64, tagB64, dataB64] = payload.split(".");
    const key = crypto.createHash("sha256").update(secret).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function touchNovel(novelId: number) {
  db.prepare("UPDATE novels SET updated_at = datetime('now') WHERE id = ?").run(novelId);
  // 重算字数
  const row = db
    .prepare("SELECT COALESCE(SUM(word_count),0) AS wc FROM chapters WHERE novel_id = ?")
    .get(novelId) as { wc: number };
  db.prepare("UPDATE novels SET word_count = ? WHERE id = ?").run(row.wc, novelId);
}


export function saveChapterRevision(chapterId: number, reason = '修改前备份', customContent?: string, customTitle?: string) {
  const chapter = db.prepare('SELECT id, novel_id, title, content, word_count FROM chapters WHERE id = ?').get(chapterId) as any;
  if (!chapter) return null;
  const novel = db.prepare('SELECT user_id FROM novels WHERE id = ?').get(chapter.novel_id) as any;
  if (!novel) return null;
  const content = customContent !== undefined ? customContent : chapter.content;
  const title = customTitle !== undefined ? customTitle : chapter.title;
  // 空正文不建备份
  if (!content || !content.trim()) return null;
  const wordCount = countChineseChars(content);
  const info = db.prepare(
    'INSERT INTO chapter_revisions (chapter_id, novel_id, user_id, title, content, word_count, reason) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(chapterId, chapter.novel_id, novel.user_id, title, content, wordCount, reason);
  
  // 保留最近 50 个版本
  db.prepare("DELETE FROM chapter_revisions WHERE chapter_id = ? AND id NOT IN (SELECT id FROM chapter_revisions WHERE chapter_id = ? ORDER BY id DESC LIMIT 50)").run(chapterId, chapterId);

  return info.lastInsertRowid;
}
