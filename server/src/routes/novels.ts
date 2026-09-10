import express from "express";
import { db, now, touchNovel } from "../db.js";
import { requireAuth, currentUser, ownsNovel } from "../auth.js";

const router = express.Router();

const COVER_COLORS = ["#e60012", "#c0392b", "#b03a2e", "#7f1d1d", "#9a3412", "#a16207", "#166534", "#0f766e", "#1e40af", "#6d28d9", "#9d174d"];

// 公开书架（阅读端，只公开作者设置为公开且状态非隐藏的作品，不公开私密作品与草稿正文）
router.get("/novels/public", (_req, res) => {
  const rows = db
    .prepare(
      "SELECT n.*, u.username AS owner FROM novels n JOIN users u ON u.id = n.user_id WHERE n.is_public != 0 AND n.status != '隐藏' ORDER BY n.updated_at DESC"
    )
    .all();
  res.json(rows);
});

// 某本书详情（公开，含章节列表）
router.get("/novels/:id/public", (req, res) => {
  const id = Number(req.params.id);
  const novel = db
    .prepare("SELECT n.*, u.username AS owner FROM novels n JOIN users u ON u.id=n.user_id WHERE n.id = ?")
    .get(id) as any;
  if (!novel) return res.status(404).json({ error: "作品不存在" });
  // 若作品被作者设为私密（is_public === 0），且访问者非作者本人或管理员，则拒绝公开访问
  const user = currentUser(req);
  if (novel.is_public === 0 && (!user || (user.id !== novel.user_id && user.role !== "admin"))) {
    return res.status(403).json({ error: "该作品为作者私密作品，暂未公开展示" });
  }
  const chapters = db
    .prepare("SELECT id, title, word_count, status, updated_at FROM chapters WHERE novel_id = ? AND status='已发布' ORDER BY sort_order")
    .all(id);
  const characters = db
    .prepare("SELECT id, name, role, gender, appearance FROM characters WHERE novel_id = ? ORDER BY sort_order")
    .all(id);
  const mapCount = (db.prepare("SELECT COUNT(*) AS c FROM maps WHERE novel_id = ?").get(id) as any).c;
  res.json({ ...novel, chapters, characters, mapCount });
});

// 以下为作者端（需登录）
router.use(requireAuth);

// 我创建的书
router.get("/novels", (req, res) => {
  const user = currentUser(req)!;
  const rows = db
    .prepare("SELECT * FROM novels WHERE user_id = ? ORDER BY updated_at DESC")
    .all(user.id);
  res.json(rows);
});

// 单本书（作者端）
router.get("/novels/:id", ownsNovel, (req, res) => {
  const novel = db.prepare("SELECT * FROM novels WHERE id = ?").get(Number(req.params.id));
  if (!novel) return res.status(404).json({ error: "作品不存在" });
  res.json(novel);
});

// 创建书
router.post("/novels", (req, res) => {
  const user = currentUser(req)!;
  const { title, genre, intro, author, is_public } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "书名不能为空" });
  const isPublicVal = is_public === false || is_public === 0 ? 0 : 1;
  const info = db
    .prepare(
      "INSERT INTO novels (user_id, title, author, genre, intro, cover_color, is_public) VALUES (?,?,?,?,?,?,?)"
    )
    .run(
      user.id,
      title.trim(),
      author || user.username,
      genre || "玄幻",
      intro || "",
      COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)],
      isPublicVal
    );
  const novel = db.prepare("SELECT * FROM novels WHERE id = ?").get(info.lastInsertRowid);
  res.json(novel);
});

// 改书（仅作者）
router.patch("/novels/:id", ownsNovel, (req, res) => {
  const id = Number(req.params.id);
  const n = req.body || {};
  const fields: string[] = [];
  const vals: any[] = [];
  for (const k of ["title", "author", "genre", "status", "intro", "cover_color", "is_public"]) {
    if (n[k] !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(k === "is_public" ? (n[k] ? 1 : 0) : String(n[k]));
    }
  }
  if (!fields.length) return res.status(400).json({ error: "无更新字段" });
  fields.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE novels SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  res.json({ ok: true, novel: db.prepare("SELECT * FROM novels WHERE id = ?").get(id) });
});

// 删书（级联删除章节/大纲/人物/地图）
router.delete("/novels/:id", ownsNovel, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM novels WHERE id = ?").run(id);
  res.json({ ok: true });
});

export default router;
