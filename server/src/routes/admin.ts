import express from "express";
import { db } from "../db.js";
import { requireAdmin } from "../auth.js";

const router = express.Router();
router.use(requireAdmin);

router.get("/users", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.created_at, u.ai_api_key_enabled, u.disabled,
        (SELECT COUNT(*) FROM novels n WHERE n.user_id = u.id) AS novel_count,
        (SELECT COUNT(*) FROM chapters c JOIN novels n ON n.id = c.novel_id WHERE n.user_id = u.id) AS chapter_count
       FROM users u ORDER BY u.id`
    )
    .all();
  res.json(rows);
});

router.patch("/users/:id", (req, res) => {
  const id = Number(req.params.id);
  if (id === 1) return res.status(400).json({ error: "不能修改初始管理员" });
  const n = req.body || {};
  const fields: string[] = [];
  const vals: any[] = [];
  if (n.role !== undefined) {
    fields.push("role = ?");
    vals.push(n.role === "admin" ? "admin" : "author");
  }
  if (n.disabled !== undefined) {
    fields.push("disabled = ?");
    vals.push(n.disabled ? 1 : 0);
  }
  if (fields.length) {
    fields.push("updated_at = datetime('now')");
    vals.push(id);
    db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  }
  res.json({ ok: true });
});

router.get("/stats", (_req, res) => {
  const count = (sql: string) => (db.prepare(sql).get() as any).c;
  res.json({
    users: count("SELECT COUNT(*) AS c FROM users"),
    novels: count("SELECT COUNT(*) AS c FROM novels"),
    chapters: count("SELECT COUNT(*) AS c FROM chapters"),
    characters: count("SELECT COUNT(*) AS c FROM characters"),
    maps: count("SELECT COUNT(*) AS c FROM maps"),
    words: count("SELECT COALESCE(SUM(word_count),0) AS c FROM chapters"),
    stationKeyConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
});

export default router;
