import express from "express";
import { db } from "../db.js";
import { requireAuth, ownsMap, ownsNovel, currentUser } from "../auth.js";
import { resolveWorldRuntimeConfig, streamChat, formatAiError } from "./ai.js";
import { buildSkillInjection } from "../skills.js";

const router = express.Router();
router.use(requireAuth);

// 地图列表
router.get("/novels/:novelId/maps", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const rows = db
    .prepare("SELECT id, novel_id, name, updated_at FROM maps WHERE novel_id = ? ORDER BY id")
    .all(novelId);
  res.json(rows);
});

// 单张地图（含绘制数据）
router.get("/maps/:id", ownsMap, (req, res) => {
  const map = db.prepare("SELECT * FROM maps WHERE id = ?").get(Number(req.params.id)) as any;
  if (!map) return res.status(404).json({ error: "地图不存在" });
  let data = {};
  try {
    data = JSON.parse(String(map.data || "{}"));
  } catch {
    data = {};
  }
  res.json({ ...map, data });
});

// 新建地图
router.post("/novels/:novelId/maps", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const { name } = req.body || {};
  const info = db
    .prepare("INSERT INTO maps (novel_id, name, data) VALUES (?,?,?)")
    .run(novelId, name || "世界地图", "{}");
  const map = db.prepare("SELECT * FROM maps WHERE id = ?").get(info.lastInsertRowid);
  res.json({ ...map, data: {} });
});

// 保存地图（整体覆盖 data JSON，自动保存友好）
router.patch("/maps/:id", ownsMap, (req, res) => {
  const id = Number(req.params.id);
  const n = req.body || {};
  const map = db.prepare("SELECT * FROM maps WHERE id = ?").get(id);
  if (!map) return res.status(404).json({ error: "地图不存在" });
  if (n.name !== undefined) {
    db.prepare("UPDATE maps SET name = ?, updated_at = datetime('now') WHERE id = ?").run(String(n.name), id);
  }
  if (n.data !== undefined) {
    const dataStr = typeof n.data === "string" ? n.data : JSON.stringify(n.data);
    db.prepare("UPDATE maps SET data = ?, updated_at = datetime('now') WHERE id = ?").run(dataStr, id);
  } else if (n.nodes !== undefined || n.edges !== undefined || n.settings !== undefined) {
    // 兼容前端直接传 nodes/edges 的格式
    const parsedNodes = typeof n.nodes === "string" ? JSON.parse(n.nodes) : (n.nodes || []);
    const parsedEdges = typeof n.edges === "string" ? JSON.parse(n.edges) : (n.edges || []);
    const parsedSettings = typeof n.settings === "string" ? JSON.parse(n.settings) : (n.settings || {});
    const combinedData = JSON.stringify({ nodes: parsedNodes, edges: parsedEdges, settings: parsedSettings });
    db.prepare("UPDATE maps SET data = ?, updated_at = datetime('now') WHERE id = ?").run(combinedData, id);
  }
  const updated = db.prepare("SELECT * FROM maps WHERE id = ?").get(id) as any;
  let data = {};
  try {
    data = JSON.parse(String(updated.data || "{}"));
  } catch {
    data = {};
  }
  res.json({ ok: true, map: { ...updated, data } });
});

// 删除地图
router.delete("/maps/:id", ownsMap, (req, res) => {
  db.prepare("DELETE FROM maps WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

// AI 根据小说章节正文提取地理要素并生成地图建议
router.post("/novels/:novelId/maps/:mapId/ai-enrich", ownsNovel, async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const novelId = Number(req.params.novelId);
  const mapId = Number(req.params.mapId);

  const runtime = resolveWorldRuntimeConfig(req, user);
  if (!runtime) {
    return res.status(400).json({ error: "未配置 AI 密钥，请前往「设置」配置「角色与地图」或「小说写作助手」API Key" });
  }

  const novel = db.prepare("SELECT title, genre, summary FROM novels WHERE id = ?").get(novelId) as any;
  const chapters = db
    .prepare("SELECT id, title, content FROM chapters WHERE novel_id = ? AND length(trim(content)) > 0 ORDER BY sort_order ASC, id ASC LIMIT 20")
    .all(novelId) as Array<{ id: number; title: string; content: string }>;

  if (!chapters.length) {
    return res.status(400).json({ error: "当前作品暂无章节正文可供提取地图信息。" });
  }

  const combinedText = chapters
    .map((c, i) => `【第${i + 1}章：${c.title}】\n${c.content.slice(0, 3000)}`)
    .join("\n\n");

  const system = `你是一位世界观架构与小说地理测绘专家。
请仔细阅读小说正文，提取其中提到的地理信息（国家、宗门领地、主要城池、险地关隘、山脉森林、江河路线）。
画布总尺寸为 1600 宽 x 1000 高。请为提取出的各个地理元素合理分配分布在画布范围内的坐标 (x: 100~1500, y: 100~900)。

必须严格输出纯 JSON 对象，格式如下：
{
  "shapes": [
    {
      "name": "区域名称（如天元帝国、十万大山）",
      "kind": "ellipse",
      "cx": 400,
      "cy": 300,
      "rx": 150,
      "ry": 120,
      "fill": "#2b2b4a",
      "stroke": "#3fa2ff",
      "description": "简要地理背景描述"
    }
  ],
  "labels": [
    {
      "text": "地标名称（如青云宗、帝都、落日峡谷）",
      "x": 420,
      "y": 310,
      "fontSize": 16,
      "color": "#e8e6f0",
      "description": "地标简述"
    }
  ],
  "paths": [
    {
      "name": "路线/河流名称（如通天河、丝绸商道）",
      "points": [200, 200, 450, 350, 700, 600],
      "color": "#3fa2ff",
      "width": 3,
      "dashed": false,
      "description": "路线说明"
    }
  ]
}
禁止输出任何 Markdown 格式包裹（如 \`\`\`json），禁止输出任何解释说明，只输出标准 JSON。`;

  const userPrompt = `小说名：《${novel?.title || "未命名"}》\n题材：${novel?.genre || "通用"}\n\n章节正文如下：\n${combinedText}`;

  let fullOutput = "";
  try {
    let skillBlock = "";
    try { skillBlock = buildSkillInjection(user.id, "world"); } catch { /* ignore */ }
    await streamChat({
      key: runtime.key,
      system: skillBlock ? system + "\n\n" + skillBlock : system,
      userPrompt,
      maxTokens: 4096,
      protocol: runtime.protocol,
      baseUrl: runtime.baseUrl,
      model: runtime.model,
      onDelta: (text) => {
        fullOutput += text;
      },
    });

    let cleanJson = fullOutput.trim();
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleanJson = jsonMatch[0];

    const parsed = JSON.parse(cleanJson);
    const shapes = Array.isArray(parsed.shapes) ? parsed.shapes : [];
    const labels = Array.isArray(parsed.labels) ? parsed.labels : [];
    const paths = Array.isArray(parsed.paths) ? parsed.paths : [];

    res.json({
      ok: true,
      analyzedChapters: chapters.length,
      shapes,
      labels,
      paths,
    });
  } catch (err: any) {
    const formatted = formatAiError(err, {
      baseUrl: runtime?.baseUrl,
      protocol: runtime?.protocol,
      model: runtime?.model,
      moduleName: "地图完善",
    });
    res.status(500).json({ error: formatted });
  }
});

export default router;
