import express from "express";
import { db } from "../db.js";
import { currentUser, requireAuth, ownsNovel } from "../auth.js";
import { resolveWorldRuntimeConfig, streamChat, formatAiError } from "./ai.js";
import { buildSkillInjection } from "../skills.js";

const router = express.Router();
router.use(requireAuth);

function ownsCharacter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const characterId = Number(req.params.id);
  const character = db.prepare("SELECT novel_id FROM characters WHERE id = ?").get(characterId) as { novel_id: number } | undefined;
  if (!character) return res.status(404).json({ error: "人物不存在" });
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(character.novel_id) as { user_id: number } | undefined;
  if (!novel) return res.status(404).json({ error: "作品不存在" });
  if (novel.user_id !== user.id && user.role !== "admin") return res.status(403).json({ error: "无权操作他人作品" });
  next();
}

const CHAR_FIELDS = ["name", "alias", "role", "gender", "age", "appearance", "personality", "background", "relationships"] as const;

function serializeCharacter(row: any) {
  let relationships = [];
  try {
    const parsed = JSON.parse(row.relationships || "[]");
    relationships = Array.isArray(parsed) ? parsed : [];
  } catch {
    // 忽略格式异常
  }
  return { ...row, relationships };
}

router.get("/novels/:novelId/characters", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const rows = db.prepare("SELECT * FROM characters WHERE novel_id = ? ORDER BY sort_order, id").all(novelId);
  res.json(rows.map(serializeCharacter));
});

router.post("/novels/:novelId/characters", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "人物名不能为空" });
  const max = (db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM characters WHERE novel_id=?").get(novelId) as any).m;
  const info = db.prepare("INSERT INTO characters (novel_id, name, sort_order) VALUES (?,?,?)").run(novelId, name.trim(), max + 1);
  const row = db.prepare("SELECT * FROM characters WHERE id = ?").get(info.lastInsertRowid);
  res.json(serializeCharacter(row));
});

router.patch("/characters/:id", ownsCharacter, async (req, res) => {
  const id = Number(req.params.id);
  const n = req.body || {};
  const fields: string[] = [];
  const vals: any[] = [];
  for (const k of CHAR_FIELDS) {
    if (n[k] !== undefined) {
      fields.push(`${k} = ?`);
      vals.push(k === "relationships" ? JSON.stringify(n[k] || []) : String(n[k]));
    }
  }
  if (!fields.length) return res.status(400).json({ error: "无更新字段" });
  fields.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE characters SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
  const ch = db.prepare("SELECT * FROM characters WHERE id = ?").get(id) as any;
  try { const { indexOne } = await import("../kb.js"); if (ch) indexOne(ch.novel_id, "character", id); } catch { /* ignore */ }
  res.json({ ok: true, character: serializeCharacter(ch) });
});

router.delete("/characters/:id", ownsCharacter, (req, res) => {
  db.prepare("DELETE FROM characters WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

router.post("/novels/:novelId/characters/ai-extract", ownsNovel, async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const novelId = Number(req.params.novelId);
  const { scope = "all", maxChapters = 15 } = req.body || {};

  const runtime = resolveWorldRuntimeConfig(req, user);
  if (!runtime) {
    return res.status(400).json({ error: "未配置 AI 密钥，请前往「设置」配置「角色与地图」或「小说写作助手」API Key" });
  }

  let query = "SELECT id, title, content FROM chapters WHERE novel_id = ? AND length(trim(content)) > 0";
  if (scope === "recent") {
    query += " ORDER BY sort_order DESC, id DESC LIMIT ?";
  } else {
    query += " ORDER BY sort_order ASC, id ASC LIMIT ?";
  }
  const chapters = db.prepare(query).all(novelId, Number(maxChapters) || 15) as Array<{ id: number; title: string; content: string }>;

  if (!chapters.length) {
    return res.status(400).json({ error: "当前小说暂无正文内容可供分析，请先在写作台创建并填写章节正文。" });
  }

  const novel = db.prepare("SELECT title, genre, summary FROM novels WHERE id = ?").get(novelId) as any;
  const combinedText = chapters
    .map((c, i) => `【第${i + 1}章：${c.title}】\n${c.content.slice(0, 3500)}`)
    .join("\n\n");

  const system = `你是一位资深小说设定分析师。请仔细阅读提供的小说正文，全面提取出小说中出场或提及的所有人物，并整理出详尽的人物设定档案。
必须严格输出纯 JSON 数组，格式如下：
[
  {
    "name": "人物姓名（必填）",
    "alias": "称号/别名/外号/字号",
    "role": "主角 / 主要配角 / 反派 / 次要角色 / 路人",
    "gender": "男 / 女 / 未知 / 其他",
    "age": "年龄或外表年龄",
    "personality": "性格特点与处事风格",
    "appearance": "容貌衣着与外在特征",
    "background": "身份背景、宗门门派、职业或过往经历",
    "relationships": [
      { "target": "关联人物名", "relation": "关系描述" }
    ]
  }
]
禁止输出任何 Markdown 格式包裹，禁止输出任何解释性文字，只输出标准 JSON 数组内容。`;

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
    const jsonMatch = cleanJson.match(/\[[\s\S]*\]/);
    if (jsonMatch) cleanJson = jsonMatch[0];

    const extracted = JSON.parse(cleanJson);
    if (!Array.isArray(extracted)) {
      throw new Error("AI 返回数据非数组格式");
    }

    const formatted = extracted.map((c: any) => ({
      name: String(c.name || "").trim(),
      alias: String(c.alias || "").trim(),
      role: ["主角", "主要配角", "反派", "次要角色", "路人"].includes(c.role) ? c.role : "主要配角",
      gender: String(c.gender || "未知").trim(),
      age: String(c.age || "").trim(),
      appearance: String(c.appearance || "").trim(),
      personality: String(c.personality || "").trim(),
      background: String(c.background || "").trim(),
      relationships: Array.isArray(c.relationships) ? c.relationships : [],
    })).filter((c: any) => c.name.length > 0);

    res.json({
      characters: formatted,
      analyzedChapters: chapters.length,
    });
  } catch (err: any) {
    const formatted = formatAiError(err, {
      baseUrl: runtime?.baseUrl,
      protocol: runtime?.protocol,
      model: runtime?.model,
      moduleName: "角色提取",
    });
    res.status(500).json({ error: formatted });
  }
});

router.post("/novels/:novelId/characters/batch-import", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const { characters = [] } = req.body || {};
  if (!Array.isArray(characters) || !characters.length) {
    return res.status(400).json({ error: "导入列表不能为空" });
  }

  const existing = db.prepare("SELECT id, name FROM characters WHERE novel_id = ?").all(novelId) as Array<{ id: number; name: string }>;
  const existingMap = new Map(existing.map((c) => [c.name.trim(), c.id]));

  let inserted = 0;
  let updated = 0;

  const insertStmt = db.prepare(`
    INSERT INTO characters (novel_id, name, alias, role, gender, age, appearance, personality, background, relationships, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);

  const updateStmt = db.prepare(`
    UPDATE characters SET
      alias = CASE WHEN ? != '' THEN ? ELSE alias END,
      role = CASE WHEN ? != '' THEN ? ELSE role END,
      gender = CASE WHEN ? != '' THEN ? ELSE gender END,
      age = CASE WHEN ? != '' THEN ? ELSE age END,
      appearance = CASE WHEN ? != '' THEN ? ELSE appearance END,
      personality = CASE WHEN ? != '' THEN ? ELSE personality END,
      background = CASE WHEN ? != '' THEN ? ELSE background END,
      relationships = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const maxOrder = ((db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM characters WHERE novel_id=?").get(novelId) as any)?.m) || 0;
  let currentOrder = maxOrder;

  for (const c of characters) {
    const name = String(c.name || "").trim();
    if (!name) continue;
    const rels = JSON.stringify(Array.isArray(c.relationships) ? c.relationships : []);
    const existId = existingMap.get(name);
    if (existId) {
      updateStmt.run(
        c.alias || "", c.alias || "",
        c.role || "", c.role || "",
        c.gender || "", c.gender || "",
        c.age || "", c.age || "",
        c.appearance || "", c.appearance || "",
        c.personality || "", c.personality || "",
        c.background || "", c.background || "",
        rels,
        existId
      );
      updated++;
    } else {
      currentOrder++;
      const info = insertStmt.get(
        novelId,
        name,
        c.alias || "",
        c.role || "主要配角",
        c.gender || "未知",
        c.age || "",
        c.appearance || "",
        c.personality || "",
        c.background || "",
        rels,
        currentOrder
      ) as any;
      inserted++;

      // 自动初始化动态账本：打通人物提取与 Agent 工具的数据流
      if (info?.id) {
        try {
          db.prepare(`
            INSERT INTO character_states (character_id, novel_id, current_location, key_relationships, recent_events, type_specific_data, notes, updated_at)
            VALUES (?, ?, '', '', '', '{}', '初次AI提取，待补充动态信息', datetime('now'))
            ON CONFLICT(character_id) DO NOTHING
          `).run(info.id, novelId);
        } catch {
          // 忽略动态账本初始化失败（向后兼容）
        }
      }
    }
  }

  const allRows = db.prepare("SELECT * FROM characters WHERE novel_id = ? ORDER BY sort_order, id").all(novelId);
  res.json({
    ok: true,
    inserted,
    updated,
    characters: allRows.map(serializeCharacter),
  });
});


// 获取小说全部角色的动态账本（供前端人物库展示）
router.get("/novels/:novelId/character-states", ownsNovel, (req, res) => {
  const novelId = Number(req.params.novelId);
  const rows = db.prepare(`
    SELECT cs.*, c.name, c.role, c.alias
    FROM characters c
    LEFT JOIN character_states cs ON c.id = cs.character_id
    WHERE c.novel_id = ?
    ORDER BY c.sort_order ASC, c.id ASC
  `).all(novelId);
  res.json(rows);
});

export default router;
