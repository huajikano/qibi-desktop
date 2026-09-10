import express from "express";
import { db } from "../db.js";
import { requireAuth, ownsOutline, ownsNovel } from "../auth.js";

const router = express.Router();
router.use(requireAuth);

// 大纲列表：chapter_id 为 NULL → 总纲；否则为该章细纲
router.get("/novels/:novelId/outlines", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const rows = db
    .prepare("SELECT * FROM outlines WHERE novel_id = ? ORDER BY sort_order, id")
    .all(novelId);
  res.json(rows);
});

// 新建大纲（body.chapter_id 缺省则为总纲）
router.post("/novels/:novelId/outlines", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const { title, content, chapter_id } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "标题不能为空" });
  if (chapter_id !== undefined && chapter_id !== null) {
    const chapter = db.prepare("SELECT id FROM chapters WHERE id = ? AND novel_id = ?").get(Number(chapter_id), novelId);
    if (!chapter) return res.status(400).json({ error: "章节不属于当前作品" });
  }
  const max = (db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM outlines WHERE novel_id=?").get(novelId) as any).m;
  const info = db
    .prepare("INSERT INTO outlines (novel_id, chapter_id, title, content, sort_order) VALUES (?,?,?,?,?)")
    .run(novelId, chapter_id ?? null, title.trim(), content || "", max + 1);
  const row = db.prepare("SELECT * FROM outlines WHERE id = ?").get(info.lastInsertRowid);
  res.json(row);
});

router.patch("/outlines/:id", ownsOutline, async (req, res) => {
  const id = Number(req.params.id);
  const n = req.body || {};
  if (n.chapter_id !== undefined && n.chapter_id !== null) {
    const existing = db.prepare("SELECT novel_id FROM outlines WHERE id = ?").get(id) as { novel_id: number } | undefined;
    const chapter = db.prepare("SELECT id FROM chapters WHERE id = ? AND novel_id = ?").get(Number(n.chapter_id), existing?.novel_id ?? -1);
    if (!chapter) return res.status(400).json({ error: "章节不属于当前作品" });
  }
  const fields: string[] = [];
  const vals: any[] = [];
  for (const k of ["title", "content", "chapter_id"]) {
    if (n[k] !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(n[k] === null ? null : String(n[k]));
    }
  }
  if (!fields.length) return res.status(400).json({ error: "无更新字段" });
  fields.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE outlines SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  const out = db.prepare("SELECT * FROM outlines WHERE id = ?").get(id) as any;
  try { const { indexOne } = await import("../kb.js"); if (out) indexOne(out.novel_id, "outline", id); } catch { /* ignore */ }
  res.json({ ok: true, outline: out });
});

router.delete("/outlines/:id", ownsOutline, (req, res) => {
  db.prepare("DELETE FROM outlines WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
