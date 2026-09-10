import express from "express";
import { requireAuth, currentUser } from "../auth.js";
import { db } from "../db.js";
import { indexNovel, dropNovel, query, kbStats, indexOne } from "../kb.js";

const router = express.Router();
router.use(requireAuth);

function ensureOwner(novelId: number, userId: number): void {
  const row = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(novelId) as any;
  if (!row) throw Object.assign(new Error("作品不存在"), { status: 404 });
  if (row.user_id !== userId && (db.prepare("SELECT role FROM users WHERE id = ?").get(userId) as any)?.role !== "admin") {
    throw Object.assign(new Error("无权操作"), { status: 403 });
  }
}

router.post("/novels/:novelId/kb/index", (req, res) => {
  const user = currentUser(req)!;
  const novelId = Number(req.params.novelId);
  try { ensureOwner(novelId, user.id); } catch (err: any) { return res.status(err.status || 400).json({ error: err.message }); }
  const r = indexNovel(novelId);
  res.json({ ok: true, ...r });
});

router.delete("/novels/:novelId/kb", (req, res) => {
  const user = currentUser(req)!;
  const novelId = Number(req.params.novelId);
  try { ensureOwner(novelId, user.id); } catch (err: any) { return res.status(err.status || 400).json({ error: err.message }); }
  const removed = dropNovel(novelId);
  res.json({ ok: true, removed });
});

router.get("/novels/:novelId/kb/stats", (req, res) => {
  const user = currentUser(req)!;
  const novelId = Number(req.params.novelId);
  try { ensureOwner(novelId, user.id); } catch (err: any) { return res.status(err.status || 400).json({ error: err.message }); }
  res.json(kbStats(novelId));
});

router.post("/novels/:novelId/kb/query", (req, res) => {
  const user = currentUser(req)!;
  const novelId = Number(req.params.novelId);
  try { ensureOwner(novelId, user.id); } catch (err: any) { return res.status(err.status || 400).json({ error: err.message }); }
  const { q, limit } = req.body || {};
  if (!q || typeof q !== "string") return res.status(400).json({ error: "缺少 q" });
  const hits = query(novelId, q, Math.max(1, Math.min(20, Number(limit) || 5)));
  res.json({ hits });
});

export { indexOne };
export default router;
