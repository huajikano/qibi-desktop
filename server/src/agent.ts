// 起笔 · 管家 Agent 模块（学习自 ai-novelist / 青烛）
//
// 设计目标：
// - 让 AI 可以多步调用「起笔」后端的工具，并可选择加入用户挂载的外部 MCP 客户端工具
// - 内置 Anthropic 原生 + OpenAI 兼容 tool_use 循环
// - 每次循环最多 N 步（默认 10），可由前端手动中断
//
// 工具集：仅实现核心创作闭环所需的高频工具子集，避免与现有 25 项 MCP tools 重复。
// 完整工具集仍可通过 MCP 服务端访问，由前端在 Settings 中复制 Claude Code 命令使用。

import { db, countChineseChars, touchNovel, saveChapterRevision } from "./db.js";
import { listAllExternalTools, callTool as callExternalTool } from "./mcpClient.js";
import { indexOne, query as kbQuery, indexNovel as kbIndexNovel, kbStats as kbGetStats } from "./kb.js";
import { streamChat } from "./routes/ai.js";

// Agent runtime config, injected by the agent router at call time
let _agentRuntimeConfig: { key: string; protocol: string; baseUrl: string; model: string } | null = null;
export function setAgentRuntimeConfig(cfg: typeof _agentRuntimeConfig) { _agentRuntimeConfig = cfg; }

export type AgentToolSpec = {
  name: string;
  description: string;
  inputSchema: any;
};

export const AGENT_TOOL_SPECS: AgentToolSpec[] = [
  {
    name: "get_chapter_summary",
    description: "获取指定章节的微摘要、关键事件与章末钩子。适用于长篇创作回溯前文、保持多章连贯。",
    inputSchema: {
      type: "object",
      properties: { chapterId: { type: "number", description: "章节 ID" } },
      required: ["chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "update_chapter_summary",
    description: "保存或更新某章节的微剧情摘要与关键转折。长篇小说写完一章应调用此工具沉淀前情提要。",
    inputSchema: {
      type: "object",
      properties: {
        chapterId: { type: "number" },
        novelId: { type: "number" },
        summary: { type: "string", description: "100字以内的核心剧情摘要" },
        keyEvents: { type: "string", description: "本章关键事件列表" },
        cliffhanger: { type: "string", description: "章末留下的悬念或钩子" },
      },
      required: ["chapterId", "novelId", "summary"],
      additionalProperties: false,
    },
  },
  {
    name: "get_character_states",
    description: "获取小说全部角色的最新动态账本。根据小说类型自动展示对应字段：修仙/玄幻(境界、法宝)、言情/都市(关系、地位)、悬疑/推理(嫌疑、线索)、历史/架空(官职、军力)。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "update_character_state",
    description: `更新指定角色的动态账本。根据小说类型填充对应字段：
      - 修仙/玄幻: 境界、功法、法宝、伤势、门派
      - 言情/都市: 关系进展、社会地位、情感状态、身世秘密、情敌
      - 悬疑/推理: 嫌疑等级、不在场证明、作案动机、掌握线索、行踪
      - 历史/架空: 官职、政治立场、军事实力、封地、党派
      - 科幻: 科技等级、改造程度、阵营、权限、特殊资源
      - 游戏异界: 等级、职业、技能、装备、公会`,
    inputSchema: {
      type: "object",
      properties: {
        characterId: { type: "number" },
        novelId: { type: "number" },
        location: { type: "string", description: "当前位置" },
        relationships: { type: "string", description: "关键人际关系变化（JSON字符串或文本）" },
        recentEvents: { type: "string", description: "最近1-3章的关键事件" },
        typeSpecificData: {
          type: "object",
          description: "类型特定数据（JSON对象）。修仙小说填realm/treasures，言情小说填relationship/social_status，悬疑小说填suspicion/clues等",
        },
      },
      required: ["characterId", "novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_volumes",
    description: "获取小说全书的分卷总纲列表与大事件里程碑。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_novels",
    description: "列出当前用户拥有的全部小说（含公开与私密）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_novel",
    description: "获取某部小说的完整详情（简介、字数、章节列表、人设、世界地图等）。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number", description: "小说 ID" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_chapters",
    description: "列出小说的全部章节目录（含标题、状态、字数）。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_chapter",
    description: "读取指定章节的完整正文。",
    inputSchema: {
      type: "object",
      properties: { chapterId: { type: "number" } },
      required: ["chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "update_chapter",
    description: "修改章节标题 / 状态 / 正文。AI 调用前必须先确认当前章节内容，避免覆盖。",
    inputSchema: {
      type: "object",
      properties: {
        chapterId: { type: "number" },
        title: { type: "string" },
        status: { type: "string", enum: ["草稿", "已发布"] },
        content: { type: "string" },
      },
      required: ["chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "list_outlines",
    description: "获取小说的总纲与各章节细纲。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_outline",
    description: "新建大纲条目（总纲或本章细纲）。",
    inputSchema: {
      type: "object",
      properties: {
        novelId: { type: "number" },
        title: { type: "string" },
        content: { type: "string" },
        chapterId: { type: "number", description: "绑定的章节 ID，留空表示总纲" },
      },
      required: ["novelId", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "list_characters",
    description: "获取小说全部角色卡。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_writer_state",
    description: "获取小说的创作进度笔记与伏笔清单。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "update_writer_state",
    description: "更新创作进度或伏笔清单（JSON 字符串或 Markdown）。",
    inputSchema: {
      type: "object",
      properties: {
        novelId: { type: "number" },
        progress: { type: "string" },
        foreshadowing: { type: "string" },
      },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "kb_index_novel",
    description: "对整本小说重新构建本地知识库（章节正文 + 大纲 + 人设）。后续 RAG 检索依赖此索引。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "kb_query",
    description: "在本地知识库中检索与查询最相关的片段（BM25 评分）。适用于长篇小说脉络模糊、寻找某人物/情节/伏笔。",
    inputSchema: {
      type: "object",
      properties: {
        novelId: { type: "number" },
        q: { type: "string", description: "查询文本" },
        limit: { type: "number", description: "返回条目数（默认 5，最大 20）" },
      },
      required: ["novelId", "q"],
      additionalProperties: false,
    },
  },
  {
    name: "kb_stats",
    description: "查询本地知识库的已建索引条数与最近索引时间。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },

  {
    name: "list_maps",
    description: "获取小说的所有世界地图（包括大千世界图、区域细图与秘境图）。",
    inputSchema: {
      type: "object",
      properties: { novelId: { type: "number" } },
      required: ["novelId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_map_location",
    description: "在指定地图上新建一个地理标的卡片（如仙宗、帝都、要塞、秘境、禁地等）。",
    inputSchema: {
      type: "object",
      properties: {
        mapId: { type: "number", description: "地图 ID" },
        name: { type: "string", description: "地点名称" },
        category: { type: "string", enum: ["city", "sect", "fortress", "secret", "danger", "town", "natural"], description: "地点类型" },
        faction: { type: "string", description: "所属统治势力/门派" },
        dangerLevel: { type: "string", enum: ["safe", "normal", "danger", "forbidden"], description: "危险程度" },
        description: { type: "string", description: "地理与环境设定描述" },
        resources: { type: "string", description: "盛产宝物或地脉资源" },
      },
      required: ["mapId", "name"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_chapter",
    description: "删除指定章节（危险操作，需明确任务要求才可使用）。",
    inputSchema: {
      type: "object",
      properties: { chapterId: { type: "number" } },
      required: ["chapterId"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_outline",
    description: "删除指定大纲或细纲条目。",
    inputSchema: {
      type: "object",
      properties: { outlineId: { type: "number" } },
      required: ["outlineId"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_character",
    description: "删除指定角色卡片。",
    inputSchema: {
      type: "object",
      properties: { characterId: { type: "number" } },
      required: ["characterId"],
      additionalProperties: false,
    },
  },
];

export function listAllTools(ownerId: number, includeExternal: boolean): AgentToolSpec[] {
  const specs = [...AGENT_TOOL_SPECS];
  if (includeExternal) {
    for (const ext of listAllExternalTools(ownerId)) {
      specs.push({
        name: `ext:${ext.id}:${ext.toolName}`,
        description: `[来自外部 MCP 客户端：${ext.clientName}] ${ext.description || ""}`.trim(),
        inputSchema: ext.inputSchema || { type: "object", properties: {} },
      });
    }
  }
  return specs;
}

export async function dispatchAgentTool(
  ownerId: number,
  name: string,
  args: any
): Promise<any> {
  if (name.startsWith("ext:")) {
    const [, clientId, ...rest] = name.split(":");
    const toolName = rest.join(":");
    return callExternalTool(ownerId, clientId, toolName, args || {});
  }

  const a = args || {};
  switch (name) {
    case "get_chapter_summary": {
      const row = db.prepare("SELECT * FROM chapter_summaries WHERE chapter_id = ?").get(a.chapterId) as any;
      if (!row) return { chapterId: a.chapterId, summary: "本章暂未提炼摘要" };
      return row;
    }
    case "update_chapter_summary": {
      const ch = db.prepare("SELECT novel_id FROM chapters WHERE id = ?").get(a.chapterId) as any;
      if (!ch) throw new Error("章节不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(ch.novel_id) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作");
      db.prepare(`
        INSERT INTO chapter_summaries (chapter_id, novel_id, summary, key_events, cliffhanger, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(chapter_id) DO UPDATE SET
          summary = excluded.summary,
          key_events = excluded.key_events,
          cliffhanger = excluded.cliffhanger,
          updated_at = datetime('now')
      `).run(a.chapterId, a.novelId, a.summary || "", a.keyEvents || "", a.cliffhanger || "");
      return { ok: true, chapterId: a.chapterId };
    }
    case "get_character_states": {
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(a.novelId) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权访问该作品");
      const rows = db.prepare(`
        SELECT cs.*, c.name, c.role, c.alias
        FROM characters c
        LEFT JOIN character_states cs ON c.id = cs.character_id
        WHERE c.novel_id = ?
        ORDER BY c.sort_order ASC, c.id ASC
      `).all(a.novelId);
      return rows;
    }
    case "update_character_state": {
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(a.novelId) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权访问该作品");

      const typeData = typeof a.typeSpecificData === "string" ? a.typeSpecificData : JSON.stringify(a.typeSpecificData || {});

      db.prepare(`
        INSERT INTO character_states (
          character_id, novel_id, current_location, key_relationships, recent_events, type_specific_data, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(character_id) DO UPDATE SET
          current_location = excluded.current_location,
          key_relationships = excluded.key_relationships,
          recent_events = excluded.recent_events,
          type_specific_data = excluded.type_specific_data,
          updated_at = datetime('now')
      `).run(
        a.characterId,
        a.novelId,
        a.location || "",
        a.relationships || "",
        a.recentEvents || "",
        typeData
      );
      return { ok: true, characterId: a.characterId };
    }
    case "list_volumes": {
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(a.novelId) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权访问该作品");
      return db.prepare("SELECT * FROM volumes WHERE novel_id = ? ORDER BY sort_order ASC, id ASC").all(a.novelId);
    }

    case "list_novels": {
      return db.prepare("SELECT id, title, author, genre, status, word_count, updated_at FROM novels WHERE user_id = ? ORDER BY updated_at DESC").all(ownerId);
    }
    case "get_novel": {
      const row = db.prepare("SELECT * FROM novels WHERE id = ?").get(a.novelId);
      if (!row) throw new Error("作品不存在");
      const userRow = db.prepare("SELECT id FROM users WHERE id = ?").get((row as any).user_id);
      if (!userRow || (userRow as any).id !== ownerId) throw new Error("无权访问该作品");
      const chapters = db.prepare("SELECT id, title, status, word_count FROM chapters WHERE novel_id = ? ORDER BY sort_order").all(a.novelId);
      const characters = db.prepare("SELECT id, name, role FROM characters WHERE novel_id = ? ORDER BY sort_order").all(a.novelId);
      const outlineCount = (db.prepare("SELECT COUNT(*) AS c FROM outlines WHERE novel_id = ? AND chapter_id IS NULL").get(a.novelId) as any).c;
      return { ...row, chapters, characters, outlineCount };
    }
    case "list_chapters": {
      return db.prepare("SELECT id, title, status, word_count, sort_order FROM chapters WHERE novel_id = ? ORDER BY sort_order").all(a.novelId);
    }
    case "get_chapter": {
      const row = db.prepare("SELECT * FROM chapters WHERE id = ?").get(a.chapterId) as any;
      if (!row) throw new Error("章节不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(row.novel_id) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权访问该章节");
      return row;
    }
    case "update_chapter": {
      const ch = db.prepare("SELECT * FROM chapters WHERE id = ?").get(a.chapterId) as any;
      if (!ch) throw new Error("章节不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(ch.novel_id) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该章节");
      const fields: string[] = [];
      const vals: any[] = [];
      if (typeof a.title === "string") { fields.push("title = ?"); vals.push(a.title); }
      if (typeof a.status === "string") { fields.push("status = ?"); vals.push(a.status); }
      if (typeof a.content === "string") {
        if (a.content.length > 300_000) throw new Error("单章字数超限");
        fields.push("content = ?"); vals.push(a.content);
        fields.push("word_count = ?"); vals.push(countChineseChars(a.content));
      }
      if (!fields.length) throw new Error("无更新字段");
      fields.push("updated_at = datetime('now')"); vals.push(a.chapterId);
      db.prepare(`UPDATE chapters SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
      touchNovel(ch.novel_id);
      return { ok: true, chapter: db.prepare("SELECT * FROM chapters WHERE id = ?").get(a.chapterId) };
    }
    case "list_outlines": {
      return db.prepare(
        "SELECT id, title, content, chapter_id, sort_order FROM outlines WHERE novel_id = ? ORDER BY chapter_id NULLS FIRST, sort_order"
      ).all(a.novelId);
    }
    case "create_outline": {
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(a.novelId) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该作品");
      const info = db.prepare(
        "INSERT INTO outlines (novel_id, chapter_id, title, content, sort_order) VALUES (?, ?, ?, ?, ?)"
      ).run(a.novelId, a.chapterId || null, a.title, a.content || "", 0);
      return db.prepare("SELECT * FROM outlines WHERE id = ?").get(info.lastInsertRowid);
    }
    case "list_characters": {
      return db.prepare("SELECT id, name, role, gender, age, alias, personality, appearance FROM characters WHERE novel_id = ? ORDER BY sort_order").all(a.novelId);
    }
    case "get_writer_state": {
      const row = db.prepare("SELECT * FROM novel_writer_state WHERE novel_id = ?").get(a.novelId);
      return row || { novel_id: a.novelId, progress: "", foreshadowing: "[]", distilled_author_id: null };
    }
    case "update_writer_state": {
      const fields: string[] = [];
      const vals: any[] = [];
      if (typeof a.progress === "string") { fields.push("progress = ?"); vals.push(a.progress); }
      if (typeof a.foreshadowing === "string") { fields.push("foreshadowing = ?"); vals.push(a.foreshadowing); }
      if (!fields.length) throw new Error("无更新字段");
      const existing = db.prepare("SELECT novel_id FROM novel_writer_state WHERE novel_id = ?").get(a.novelId);
      if (existing) {
        vals.push(a.novelId);
        db.prepare(`UPDATE novel_writer_state SET ${fields.join(", ")} WHERE novel_id = ?`).run(...vals);
      } else {
        vals.unshift(a.novelId);
        db.prepare(`INSERT INTO novel_writer_state (novel_id, ${fields.map((f) => f.split(" ")[0]).join(", ")}) VALUES (${new Array(fields.length + 1).fill("?").join(", ")})`).run(...vals);
      }
      return db.prepare("SELECT * FROM novel_writer_state WHERE novel_id = ?").get(a.novelId);
    }
    case "kb_index_novel": {
      const r = kbIndexNovel(a.novelId);
      return { ok: true, ...r };
    }
    case "kb_query": {
      const hits = kbQuery(a.novelId, a.q, Math.max(1, Math.min(20, Number(a.limit) || 5)));
      return hits.map((h) => ({ source_kind: h.source_kind, title: h.title, score: Number(h.score.toFixed(3)), preview: h.content.slice(0, 280) }));
    }
    case "kb_stats": {
      return kbGetStats(a.novelId);
    }
    case "create_chapter": {
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(a.novelId) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该作品");
      if (!a.title || !String(a.title).trim()) throw new Error("章节标题不能为空");
      const max = (db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM chapters WHERE novel_id=?").get(a.novelId) as any).m;
      const info = db.prepare("INSERT INTO chapters (novel_id, title, sort_order) VALUES (?,?,?)").run(a.novelId, String(a.title).trim(), max + 1);
      touchNovel(a.novelId);
      const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(info.lastInsertRowid);
      return { ok: true, chapter };
    }
    case "update_outline": {
      const outline = db.prepare("SELECT * FROM outlines WHERE id = ?").get(a.outlineId) as any;
      if (!outline) throw new Error("大纲条目不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(outline.novel_id) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该大纲");
      const fields: string[] = [];
      const vals: any[] = [];
      if (typeof a.title === "string") { fields.push("title = ?"); vals.push(a.title); }
      if (typeof a.content === "string") { fields.push("content = ?"); vals.push(a.content); }
      if (!fields.length) throw new Error("无更新字段");
      fields.push("updated_at = datetime('now')");
      vals.push(a.outlineId);
      db.prepare(`UPDATE outlines SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
      try { indexOne(outline.novel_id, "outline", a.outlineId); } catch { /* ignore */ }
      return { ok: true, outline: db.prepare("SELECT * FROM outlines WHERE id = ?").get(a.outlineId) };
    }
        case "create_character": {
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(a.novelId) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该作品");
      if (!a.name || !String(a.name).trim()) throw new Error("角色姓名不能为空");
      const maxCSort = (db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM characters WHERE novel_id=?").get(a.novelId) as any).m;
      const cFields = ["name", "role", "gender", "age", "appearance", "personality", "background"] as const;
      const insertFields = ["novel_id", "sort_order"];
      const insertVals: any[] = [a.novelId, maxCSort + 1];
      for (const f of cFields) {
        if (a[f] !== undefined) { insertFields.push(f); insertVals.push(String(a[f])); }
      }
      const placeholders = insertVals.map(() => "?").join(", ");
      const cInfo = db.prepare(`INSERT INTO characters (${insertFields.join(", ")}) VALUES (${placeholders})`)
        .run(...insertVals);
      try { indexOne(a.novelId, "character", Number(cInfo.lastInsertRowid)); } catch { /* ignore */ }
      return { ok: true, character: db.prepare("SELECT * FROM characters WHERE id = ?").get(cInfo.lastInsertRowid) };
    }
    case "update_character": {
      const ch = db.prepare("SELECT * FROM characters WHERE id = ?").get(a.characterId) as any;
      if (!ch) throw new Error("角色不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(ch.novel_id) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该角色");
      const CHAR_FIELDS = ["name", "alias", "role", "gender", "age", "appearance", "personality", "background"] as const;
      const fields: string[] = [];
      const vals: any[] = [];
      for (const f of CHAR_FIELDS) {
        if (a[f] !== undefined) { fields.push(`${f} = ?`); vals.push(String(a[f])); }
      }
      if (!fields.length) throw new Error("无更新字段");
      fields.push("updated_at = datetime('now')");
      vals.push(a.characterId);
      db.prepare(`UPDATE characters SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
      try { indexOne(ch.novel_id, "character", a.characterId); } catch { /* ignore */ }
      return { ok: true, character: db.prepare("SELECT * FROM characters WHERE id = ?").get(a.characterId) };
    }
    case "ai_draft": {
      if (!_agentRuntimeConfig) throw new Error("Agent 写作引擎未初始化，请重试或检查 API 配置");
      const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(a.chapterId) as any;
      if (!chapter) throw new Error("章节不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(a.novelId) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该章节");
      const SYSTEM_PROMPTS: Record<string, string> = {
        draft: "你是一位资深中文网络小说作家。你已获得该小说的整本小说完整章节目录、所有历史章节细纲与全部正文前文、全书人物卡与本章细纲设定。请深入结合全书已写章节的剧情脉络与人物性格发展，严格承接前序章节结尾情节，紧扣本章细纲，创作一章紧密承接前文的本章完整正文。文风：中文网络小说风格，节奏紧凑，描写生动，对话自然，每章约2500-4000字。直接输出正文，不要输出章节标题、不要解释。",
        continue: "你是中文小说续写助手。你已掌握全书所有已有章节的全部正文上下文与本章已有内容。请紧接当前章节已有文字自然向下续写，保持与全书人物设定、世界观、文风、人称、节奏与口吻完全一致，自然延续情节走向。直接输出续写正文，不要输出标题与解释。",
        deslop: "你是一位资深网络小说去AI味精修专家。你的任务是彻底清除文本中的AI写作痕迹，让文字回归自然、生动、非模板化的真实网文质感。【7 Gate 门禁系统】1. 彻底清除套路词；2. 打破三段式工整排比，打乱长短句节奏；3. 动作说话代替直接解释心理；4. 对话去除说教书面腔，加入口语与停顿；5. 删减无意义心理与注水过渡；6. 段末严禁升华总结与哲理感慨；7. 保持原剧情走向与人设不变，直接输出去AI味精修后的自然全文。",
        polish: "你是中文小说润色编辑。基于整本小说的完整上下文与人物设定，请对给定正文进行润色：修正病句与错别字、提升描写质感与环境氛围、让对话更契合人物性格，但保持原意、情节、结构与人称完全不变。直接输出润色后的全文。",
        expand: "你是中文小说扩写助手。基于整本小说的完整上下文与人物设定，请在不改变情节主干的前提下，将给定正文扩写得更丰满：补充环境氛围、心理活动、细节动作与人物神态对话。直接输出扩写后的全文。",
      };
      const TOKEN_LIMIT: Record<string, number> = { draft: 9000, continue: 5000, deslop: 6000, polish: 5000, expand: 7000 };
      const mode = a.mode || "draft";
      const systemPrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.draft;
      const contextParts: string[] = [];
      contextParts.push(`【作品基础档案】\n- 书名：《${novel.title || ""}》\n- 类型：${novel.genre || "未设定"}\n- 简介：${novel.intro || "暂无"}`);
      const outlines = db.prepare("SELECT title, content FROM outlines WHERE novel_id = ? AND chapter_id IS NULL ORDER BY sort_order ASC").all(a.novelId) as any[];
      if (outlines.length) { contextParts.push(`【总大纲】\n${outlines.map((o: any, i: number) => `${i+1}. 【${o.title}】：${o.content}`).join("\n")}`); }
      const chars = db.prepare("SELECT name, role, personality, background FROM characters WHERE novel_id = ? ORDER BY sort_order").all(a.novelId) as any[];
      if (chars.length) { contextParts.push(`【人物设定】\n${chars.map((c: any) => `${c.name}（${c.role || "配角"}）：${c.personality || ""}${c.background ? " | " + c.background : ""}`).join("\n")}`); }
      const ws = db.prepare("SELECT progress, foreshadowing FROM novel_writer_state WHERE novel_id = ?").get(a.novelId) as any;
      if (ws?.progress) contextParts.push(`【创作进度】\n${ws.progress}`);
      if (ws?.foreshadowing && ws.foreshadowing !== "[]") contextParts.push(`【伏笔清单】\n${ws.foreshadowing}`);
      const chOutlines = db.prepare("SELECT title, content FROM outlines WHERE novel_id = ? AND chapter_id = ? ORDER BY sort_order").all(a.novelId, a.chapterId) as any[];
      if (chOutlines.length) { contextParts.push(`【本章细纲】\n${chOutlines.map((o: any, i: number) => `${i+1}. 【${o.title}】：${o.content}`).join("\n")}`); }
      const allChapters = db.prepare("SELECT id, title, content, word_count FROM chapters WHERE novel_id = ? ORDER BY sort_order").all(a.novelId) as any[];
      const currentIdx = allChapters.findIndex((c: any) => c.id === a.chapterId);
      const dirItems = allChapters.map((c: any, i: number) => `第${i+1}章《${c.title}》（${c.word_count || 0}字）${c.id === a.chapterId ? "【当前章】" : ""}`);
      contextParts.push(`【章节目录】\n${dirItems.join("\n")}`);
      if (currentIdx > 0) {
        const prevCh = allChapters[currentIdx - 1];
        const prevContent = String(prevCh.content || "");
        const excerpt = prevContent.length > 2000 ? prevContent.slice(-2000) : prevContent;
        contextParts.push(`【上一章结尾（${prevCh.title}）】\n${excerpt}`);
      }
      const currentContent = String(chapter.content || "");
      if (["continue", "deslop", "polish", "expand"].includes(mode) && currentContent) {
        contextParts.push(`【本章当前正文（待处理）】\n${currentContent}`);
      }
      if (a.extra) contextParts.push(`【附加要求】\n${a.extra}`);
      const context = contextParts.join("\n\n");
      let generated = "";
      const rc = _agentRuntimeConfig;
      await streamChat({
        key: rc.key,
        system: systemPrompt,
        userPrompt: context,
        maxTokens: TOKEN_LIMIT[mode] || 9000,
        protocol: rc.protocol as any,
        baseUrl: rc.baseUrl,
        model: rc.model,
        onDelta: (text: string) => { generated += text; },
      });
      if (!generated.trim()) throw new Error("AI 写作引擎未返回有效内容，请检查 API 配置");
      if (chapter.content && chapter.content.trim()) {
        saveChapterRevision(a.chapterId, `Agent ${mode} 前备份`, chapter.content, chapter.title);
      }
      db.prepare("UPDATE chapters SET content = ?, word_count = ?, updated_at = datetime('now') WHERE id = ?").run(generated, countChineseChars(generated), a.chapterId);
      touchNovel(a.novelId);
      try { indexOne(a.novelId, "chapter", a.chapterId); } catch { /* ignore */ }
      return { ok: true, chapterId: a.chapterId, mode, wordCount: countChineseChars(generated), preview: generated.slice(0, 200) + (generated.length > 200 ? "..." : "") };
    }
    case "list_maps": {
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(a.novelId) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权访问该作品");
      return db.prepare("SELECT id, name, updated_at FROM maps WHERE novel_id = ? ORDER BY id ASC").all(a.novelId);
    }
    case "create_map_location": {
      const map = db.prepare("SELECT * FROM maps WHERE id = ?").get(a.mapId) as any;
      if (!map) throw new Error("地图不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(map.novel_id) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该地图");

      let mapData: any = {};
      try { mapData = typeof map.data === "string" ? JSON.parse(map.data) : map.data; } catch {}
      const nodes: any[] = Array.isArray(mapData?.nodes) ? mapData.nodes : [];

      const newLoc = {
        id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: a.name,
        category: a.category || "city",
        x: 400 + Math.round(Math.random() * 300),
        y: 300 + Math.round(Math.random() * 200),
        faction: a.faction || "",
        dangerLevel: a.dangerLevel || "safe",
        description: a.description || "",
        resources: a.resources || "",
        characterIds: [],
      };
      nodes.push(newLoc);
      mapData.nodes = nodes;

      db.prepare("UPDATE maps SET data = ?, updated_at = datetime(now) WHERE id = ?")
        .run(JSON.stringify(mapData), a.mapId);
      return { ok: true, location: newLoc };
    }
    case "delete_chapter": {
      const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(a.chapterId) as any;
      if (!chapter) throw new Error("章节不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(chapter.novel_id) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该章节");
      db.prepare("DELETE FROM chapters WHERE id = ?").run(a.chapterId);
      touchNovel(chapter.novel_id);
      return { ok: true, deletedChapterId: a.chapterId };
    }
    case "delete_outline": {
      const outline = db.prepare("SELECT * FROM outlines WHERE id = ?").get(a.outlineId) as any;
      if (!outline) throw new Error("大纲条目不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(outline.novel_id) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该大纲");
      db.prepare("DELETE FROM outlines WHERE id = ?").run(a.outlineId);
      return { ok: true, deletedOutlineId: a.outlineId };
    }
    case "delete_character": {
      const ch = db.prepare("SELECT * FROM characters WHERE id = ?").get(a.characterId) as any;
      if (!ch) throw new Error("角色不存在");
      const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(ch.novel_id) as any;
      if (!novel || novel.user_id !== ownerId) throw new Error("无权操作该角色");
      db.prepare("DELETE FROM characters WHERE id = ?").run(a.characterId);
      return { ok: true, deletedCharacterId: a.characterId };
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

export const AGENT_SYSTEM_PROMPT = `你是「起笔」智能长篇小说创作软件的"全能管家 Agent"。你可以像人类作家一样熟练操作起笔的每一个功能模块（写正文、建章节、修大纲、建角色、设地图、写摘要）。

【起笔全功能工具库】
1. 章节正文工具：
   - ai_draft：【核心】调用起笔专业网文写作引擎。写新章时 mode="draft"，续写 mode="continue"，精修去AI味 mode="deslop"，润色 mode="polish"，扩写 mode="expand"。自动加载全书大纲与前文，输出高质量网文！
   - create_chapter：在作品末尾新建一章（指定 title）。写新章前必须先调用它创建章节！
   - update_chapter：修改指定章节标题、发布状态或直接替换正文。
   - delete_chapter：删除废弃章节。
   - get_chapter：读取指定章节正文。
   - list_chapters：查看全书章节目录。

2. 大纲与细纲工具：
   - create_outline：创建总纲或指定章节的细纲。
   - update_outline：修改已有大纲或各章细纲的内容与核心冲突。
   - delete_outline：删除无效大纲条目。
   - list_outlines：查看全书所有大纲与细纲。

3. 角色人设与动态账本：
   - create_character：创建新人物卡（姓名、定位、性格、外貌、背景）。
   - update_character：修改人物卡设定。
   - delete_character：删除人物卡。
   - list_characters：查看全书角色卡。
   - get_character_states / update_character_state：读写角色动态账本（当前境界、法宝、位置、伤病）。

4. 大世界地图设定：
   - list_maps：查看小说所有世界地图。
   - create_map_location：在地图上新建地点（宗门、主城、险地、秘境、关隘、特产）。

5. 创作进度与知识库：
   - get_writer_state / update_writer_state：读写创作进度笔记与伏笔清单。
   - get_chapter_summary / update_chapter_summary：读写章节微摘要与章末钩子。
   - kb_query / kb_stats / kb_index_novel：本地全文知识库检索。

【执行铁律（严禁拖延，立即行动！）】
1. 严禁无休止重复查询！在第 1 步完成上下文查询（并行调 get_novel / list_chapters / list_outlines 等）后，必须在第 2 步立即制定计划并开始动手创建或修改！
2. 收到“写第X章”或“生成第X章”任务时：
   - 查出第X章若不存在，第一步立即 create_chapter 创建该章节！
   - 紧接着第二步立即调用 ai_draft(novelId, chapterId, mode="draft") 创作完整正文（2500-4000字）！
   - 第三步调用 update_chapter_summary 保存微摘要与章末钩子。
   - 汇报字数与完成情况！
3. 严格禁止只空谈计划而不调用执行工具。起笔所有修改操作必须通过工具落盘！`;
