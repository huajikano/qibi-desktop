import express from "express";
import { db, now, countChineseChars, touchNovel, saveChapterRevision } from "../db.js";
import { requireAuth, ownsChapter, ownsNovel, currentUser } from "../auth.js";

const router = express.Router();

// 公开单章（仅已发布章节，阅读端，无需登录）
router.get("/chapters/:id/public", (req, res) => {
  const id = Number(req.params.id);
  const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(id) as any;
  if (!chapter) return res.status(404).json({ error: "章节不存在" });

  const novel = db.prepare("SELECT * FROM novels WHERE id = ?").get(chapter.novel_id) as any;
  if (!novel) return res.status(404).json({ error: "作品不存在" });

  const user = currentUser(req);
  const isOwner = user && (user.id === novel.user_id || user.role === "admin");

  if (!isOwner) {
    if (novel.is_public === 0) return res.status(403).json({ error: "该作品为作者私密作品" });
    if (chapter.status !== "已发布") return res.status(403).json({ error: "章节未发布" });
  }

  res.json(chapter);
});

// 以下为作者端接口，需严格鉴权
router.use(requireAuth);

// 章节列表（不含正文，轻量）
router.get("/novels/:novelId/chapters", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const rows = db
    .prepare("SELECT id, title, status, word_count, sort_order, updated_at FROM chapters WHERE novel_id = ? ORDER BY sort_order, id")
    .all(novelId);
  res.json(rows);
});

// 单章（含正文）
router.get("/chapters/:id", ownsChapter, (req, res) => {
  const id = Number(req.params.id);
  const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(id);
  if (!chapter) return res.status(404).json({ error: "章节不存在" });
  res.json(chapter);
});

// 新建章节
router.post("/novels/:novelId/chapters", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const { title } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: "章节名不能为空" });
  const max = (db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM chapters WHERE novel_id=?").get(novelId) as any).m;
  const info = db
    .prepare("INSERT INTO chapters (novel_id, title, sort_order) VALUES (?,?,?)")
    .run(novelId, title.trim(), max + 1);
  touchNovel(novelId);
  const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(info.lastInsertRowid);
  res.json(chapter);
});

// 更新章节（标题/状态/正文）
router.patch("/chapters/:id", ownsChapter, async (req, res) => {
  const id = Number(req.params.id);
  const n = req.body || {};
  const fields: string[] = [];
  const vals: any[] = [];
  if (n.title !== undefined) {
    fields.push("title = ?");
    vals.push(String(n.title));
  }
  if (n.status !== undefined) {
    fields.push("status = ?");
    vals.push(String(n.status));
  }
  if (n.content !== undefined) {
    if (n.content.length > 300_000) return res.status(400).json({ error: "单章字数超限" });
    fields.push("content = ?");
    fields.push("word_count = ?");
    vals.push(String(n.content), countChineseChars(n.content));
  }
  if (!fields.length) return res.status(400).json({ error: "无更新字段" });
  fields.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE chapters SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(id) as any;
  touchNovel(chapter.novel_id);
  // 自动重建该章节的知识库索引（异步、不阻塞响应）
  if (typeof n.content === "string") {
    try { const { indexOne } = await import("../kb.js"); indexOne(chapter.novel_id, "chapter", id); } catch { /* ignore */ }
  }
  res.json({ ok: true, chapter });
});

// 上移/下移：按照当前章节列表的实际顺序进行交换，并彻底规避 sort_order 重复或断号
router.post("/chapters/:id/move", ownsChapter, (req, res) => {
  const id = Number(req.params.id);
  const { dir } = req.body || {};
  const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(id) as any;
  if (!chapter) return res.status(404).json({ error: "章节不存在" });

  const allChapters = db
    .prepare("SELECT id, sort_order FROM chapters WHERE novel_id = ? ORDER BY sort_order ASC, id ASC")
    .all(chapter.novel_id) as Array<{ id: number; sort_order: number }>;

  const currentIndex = allChapters.findIndex((c) => c.id === id);
  if (currentIndex === -1) return res.status(404).json({ error: "未找到当前章节" });

  const targetIndex = dir === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= allChapters.length) {
    return res.json({ ok: true, message: "已处于边界，无需移动" });
  }

  // 数组内交换位置
  const temp = allChapters[currentIndex];
  allChapters[currentIndex] = allChapters[targetIndex];
  allChapters[targetIndex] = temp;

  // 事务内重新紧凑规整分配 1, 2, 3...
  db.exec("BEGIN");
  try {
    const updateStmt = db.prepare("UPDATE chapters SET sort_order = ? WHERE id = ?");
    for (let i = 0; i < allChapters.length; i++) {
      updateStmt.run(i + 1, allChapters[i].id);
    }
    touchNovel(chapter.novel_id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  res.json({ ok: true });
});

// 删除章节（级联删除其细纲）
router.delete("/chapters/:id", ownsChapter, (req, res) => {
  const id = Number(req.params.id);
  const chapter = db.prepare("SELECT novel_id FROM chapters WHERE id = ?").get(id) as any;
  if (!chapter) return res.status(404).json({ error: "章节不存在" });
  db.prepare("DELETE FROM chapters WHERE id = ?").run(id);
  touchNovel(chapter.novel_id);
  res.json({ ok: true });
});


// 获取章节版本历史列表
router.get("/chapters/:id/revisions", ownsChapter, (req, res) => {
  const chapterId = Number(req.params.id);
  const rows = db.prepare(
    "SELECT id, chapter_id, novel_id, title, word_count, reason, created_at FROM chapter_revisions WHERE chapter_id = ? ORDER BY id DESC"
  ).all(chapterId);
  res.json(rows);
});

// 获取指定历史版本的完整内容
router.get("/chapters/:id/revisions/:revisionId", ownsChapter, (req, res) => {
  const chapterId = Number(req.params.id);
  const revisionId = Number(req.params.revisionId);
  const row = db.prepare(
    "SELECT * FROM chapter_revisions WHERE id = ? AND chapter_id = ?"
  ).get(revisionId, chapterId);
  if (!row) return res.status(404).json({ error: "版本记录不存在" });
  res.json(row);
});

// 手动创建正文快照
router.post("/chapters/:id/revisions", ownsChapter, (req, res) => {
  const chapterId = Number(req.params.id);
  const { reason } = req.body || {};
  const revId = saveChapterRevision(chapterId, reason || "作者手动快照");
  if (!revId) return res.status(400).json({ error: "当前正文为空，未创建快照" });
  res.json({ ok: true, id: revId });
});

// 恢复指定历史版本
router.post("/chapters/:id/revisions/:revisionId/restore", ownsChapter, (req, res) => {
  const chapterId = Number(req.params.id);
  const revisionId = Number(req.params.revisionId);
  const revision = db.prepare(
    "SELECT * FROM chapter_revisions WHERE id = ? AND chapter_id = ?"
  ).get(revisionId, chapterId) as any;
  if (!revision) return res.status(404).json({ error: "历史版本不存在" });

  const current = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as any;
  if (!current) return res.status(404).json({ error: "章节不存在" });

  // 恢复前将当前版本存为备份
  if (current.content && current.content.trim()) {
    saveChapterRevision(chapterId, "恢复历史版本前备份", current.content, current.title);
  }

  const newWordCount = countChineseChars(revision.content);
  db.prepare("UPDATE chapters SET content = ?, word_count = ?, updated_at = datetime('now') WHERE id = ?").run(
    revision.content,
    newWordCount,
    chapterId
  );

  touchNovel(current.novel_id);
  const updated = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as any;
  res.json({ ok: true, chapter: updated });
});

export default router;
