// 起笔 · 用户通用 Skill 管理（参考 ai-novelist Skill 通用化）
//
// 一条 Skill = 一段 Markdown 提示词，可设置 scope（writer/distill/world/all），
// 决定它会被自动注入到哪类 AI 调用的系统提示词中。
//
// source_kind:
//   - manual：用户手写编辑
//   - uploaded：上传的 .md 文件
//   - distilled_author：绑定既有蒸馏作者作品（自动读取 skill_markdown）

import express from "express";
import fs from "fs";
import path from "path";
import { db } from "../db.js";
import { requireAuth, currentUser } from "../auth.js";

const router = express.Router();
router.use(requireAuth);

const SCOPES = new Set(["writer", "distill", "world", "all"]);
const SOURCE_KINDS = new Set(["manual", "uploaded", "distilled_author"]);

function safeSlug(input: string, fallback: string): string {
  const base = (input || fallback || "")
    .toLowerCase()
    .replace(/[^a-z0-9\-_一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || `skill-${Date.now()}`;
}

function serialize(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    scope: row.scope,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    content: row.content,
    enabled: !!row.enabled,
    priority: row.priority,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uniqueSlug(userId: number, base: string): string {
  let slug = base;
  let n = 1;
  while (db.prepare("SELECT 1 FROM user_skills WHERE user_id = ? AND slug = ?").get(userId, slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

// 列表
router.get("/user-skills", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const rows = db
    .prepare("SELECT * FROM user_skills WHERE user_id = ? ORDER BY priority DESC, id ASC")
    .all(user.id);
  res.json({ skills: rows.map(serialize) });
});

// 详情
router.get("/user-skills/:id", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM user_skills WHERE id = ? AND user_id = ?").get(id, user.id);
  if (!row) return res.status(404).json({ error: "Skill 不存在" });
  res.json({ skill: serialize(row) });
});

// 新建
router.post("/user-skills", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const body = req.body || {};
  const name = String(body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Skill 名称不能为空" });
  const scope = SCOPES.has(body.scope) ? body.scope : "writer";
  const sourceKind = SOURCE_KINDS.has(body.sourceKind) ? body.sourceKind : "manual";
  const content = String(body.content || "");
  const priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0;
  const notes = String(body.notes || "");
  const slug = uniqueSlug(user.id, safeSlug(body.slug || name, "skill"));
  const info = db
    .prepare(
      `INSERT INTO user_skills (user_id, name, slug, scope, source_kind, source_ref, content, enabled, priority, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      user.id,
      name,
      slug,
      scope,
      sourceKind,
      body.sourceRef ? String(body.sourceRef) : null,
      content,
      body.enabled === false ? 0 : 1,
      priority,
      notes
    );
  const row = db.prepare("SELECT * FROM user_skills WHERE id = ?").get(info.lastInsertRowid);
  res.json({ skill: serialize(row) });
});

// 上传 .md 文件
router.post("/user-skills/upload", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const body = req.body || {};
  const filename = String(body.filename || "skill.md").trim();
  const content = String(body.content || "");
  if (!content.trim()) return res.status(400).json({ error: "文件内容为空" });
  if (content.length > 200_000) return res.status(400).json({ error: "Skill 文件过大（>200KB）" });

  const scope = SCOPES.has(body.scope) ? body.scope : "writer";
  const priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0;
  const baseName = filename.replace(/\.md$/i, "").trim() || "导入技能";
  const slug = uniqueSlug(user.id, safeSlug(baseName, "skill"));

  // 落盘到数据目录，便于后续分析/调试
  let storedPath: string | null = null;
  try {
    const skillDir = path.resolve(process.env.DATA_DIR || path.resolve(process.cwd(), "data"), "user-skills", String(user.id));
    fs.mkdirSync(skillDir, { recursive: true });
    storedPath = path.join(skillDir, `${slug}.md`);
    fs.writeFileSync(storedPath, content, "utf8");
  } catch {
    storedPath = null;
  }

  const info = db
    .prepare(
      `INSERT INTO user_skills (user_id, name, slug, scope, source_kind, source_ref, content, enabled, priority, notes)
       VALUES (?, ?, ?, ?, 'uploaded', ?, ?, 1, ?, ?)`
    )
    .run(user.id, baseName, slug, scope, storedPath || filename, content, priority, `上传自 ${filename}`);
  const row = db.prepare("SELECT * FROM user_skills WHERE id = ?").get(info.lastInsertRowid);
  res.json({ skill: serialize(row) });
});

// 绑定蒸馏作者
router.post("/user-skills/from-distilled", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { authorId, scope = "writer", priority = 50 } = req.body || {};
  const aid = Number(authorId);
  if (!Number.isInteger(aid)) return res.status(400).json({ error: "请提供 authorId" });
  if (!SCOPES.has(scope)) return res.status(400).json({ error: "scope 必须为 writer/distill/world/all" });

  const author = db
    .prepare("SELECT * FROM distilled_authors WHERE id = ? AND user_id = ?")
    .get(aid, user.id) as any;
  if (!author) return res.status(404).json({ error: "蒸馏作者不存在" });

  // 选最新版本；若无版本则用空内容
  const version = db
    .prepare("SELECT * FROM distilled_author_versions WHERE author_id = ? ORDER BY version DESC LIMIT 1")
    .get(aid) as any;

  const content = version?.skill_markdown || "";
  if (!content.trim()) {
    return res.status(400).json({ error: "该蒸馏作者尚未生成 skill_markdown，请先到蒸馏作者页生成版本" });
  }

  const slug = uniqueSlug(user.id, safeSlug(`${author.slug}-${scope}`, "distilled"));
  const info = db
    .prepare(
      `INSERT INTO user_skills (user_id, name, slug, scope, source_kind, source_ref, content, enabled, priority, notes)
       VALUES (?, ?, ?, ?, 'distilled_author', ?, ?, 1, ?, ?)`
    )
    .run(
      user.id,
      `${author.name} · ${scope}`,
      slug,
      scope,
      String(aid),
      content,
      Number(priority) || 0,
      `由蒸馏作者《${author.name}》version ${version?.version || "?"} 自动生成`
    );
  const row = db.prepare("SELECT * FROM user_skills WHERE id = ?").get(info.lastInsertRowid);
  res.json({ skill: serialize(row) });
});

// 更新
router.patch("/user-skills/:id", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM user_skills WHERE id = ? AND user_id = ?").get(id, user.id) as any;
  if (!row) return res.status(404).json({ error: "Skill 不存在" });
  const body = req.body || {};
  const fields: string[] = [];
  const vals: any[] = [];
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return res.status(400).json({ error: "Skill 名称不能为空" });
    fields.push("name = ?"); vals.push(name);
  }
  if (body.scope !== undefined) {
    if (!SCOPES.has(body.scope)) return res.status(400).json({ error: "scope 必须为 writer/distill/world/all" });
    fields.push("scope = ?"); vals.push(body.scope);
  }
  if (body.content !== undefined) {
    fields.push("content = ?"); vals.push(String(body.content));
  }
  if (body.enabled !== undefined) {
    fields.push("enabled = ?"); vals.push(body.enabled ? 1 : 0);
  }
  if (body.priority !== undefined && Number.isFinite(Number(body.priority))) {
    fields.push("priority = ?"); vals.push(Number(body.priority));
  }
  if (body.notes !== undefined) {
    fields.push("notes = ?"); vals.push(String(body.notes));
  }
  if (body.slug !== undefined) {
    const newSlug = safeSlug(body.slug, row.slug);
    if (newSlug !== row.slug) {
      // 唯一性校验
      const dup = db.prepare("SELECT 1 FROM user_skills WHERE user_id = ? AND slug = ? AND id != ?").get(user.id, newSlug, id);
      if (dup) return res.status(400).json({ error: "slug 已存在" });
      fields.push("slug = ?"); vals.push(newSlug);
    }
  }
  if (!fields.length) return res.json({ skill: serialize(row) });
  fields.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE user_skills SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  const updated = db.prepare("SELECT * FROM user_skills WHERE id = ?").get(id);
  res.json({ skill: serialize(updated) });
});

// 删除
router.delete("/user-skills/:id", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const id = Number(req.params.id);
  const row = db.prepare("SELECT id, source_kind, source_ref FROM user_skills WHERE id = ? AND user_id = ?").get(id, user.id) as any;
  if (!row) return res.status(404).json({ error: "Skill 不存在" });
  db.prepare("DELETE FROM user_skills WHERE id = ?").run(id);
  // 清理上传文件
  if (row.source_kind === "uploaded" && row.source_ref && fs.existsSync(row.source_ref)) {
    try { fs.unlinkSync(row.source_ref); } catch { /* ignore */ }
  }
  res.json({ ok: true });
});

// 一次性拉取按 scope 过滤的 Skill 内容（用于 AI 调用注入）
router.get("/skills/active", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const scope = String(req.query.scope || "writer");
  if (!SCOPES.has(scope)) return res.status(400).json({ error: "scope 必须为 writer/distill/world/all" });
  const rows = db
    .prepare(
      `SELECT * FROM user_skills
       WHERE user_id = ? AND enabled = 1 AND (scope = ? OR scope = 'all')
       ORDER BY priority DESC, id ASC`
    )
    .all(user.id, scope) as any[];
  res.json({
    scope,
    skills: rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      scope: r.scope,
      sourceKind: r.source_kind,
      priority: r.priority,
      content: r.content,
    })),
  });
});

export default router;
