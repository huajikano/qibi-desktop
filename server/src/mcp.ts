import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { db, now, countChineseChars, touchNovel, saveChapterRevision } from "./db.js";

// 获取当前上下文用户ID（默认获取第一个有效用户或环境变量指定用户）
function resolveUserId(specifiedUserId?: number): number {
  if (specifiedUserId && specifiedUserId > 0) return specifiedUserId;
  if (process.env.NOVELFORGE_USER_ID) {
    const uid = Number(process.env.NOVELFORGE_USER_ID);
    if (!isNaN(uid) && uid > 0) return uid;
  }
  if (process.env.NOVELFORGE_USERNAME) {
    const user = db.prepare("SELECT id FROM users WHERE username = ?").get(process.env.NOVELFORGE_USERNAME) as any;
    if (user) return user.id;
  }
  const firstUser = db.prepare("SELECT id FROM users ORDER BY id ASC LIMIT 1").get() as any;
  return firstUser ? firstUser.id : 1;
}

export function createNovelForgeMcpServer() {
  const server = new Server(
    {
      name: "novelforge-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    }
  );

  // 1. 注册 MCP Tools 列表
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "novelforge_list_novels",
          description: "获取作品书库列表。返回所有小说的 ID、书名、作者、类型、状态、总字数、更新时间等信息。",
          inputSchema: {
            type: "object",
            properties: {
              userId: { type: "number", description: "指定作者的用户ID（可选，默认使用主用户）" },
            },
          },
        },
        {
          name: "novelforge_get_novel",
          description: "获取单部小说的完整详情，包括简介、分类、状态、总字数及章节数量。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
            },
            required: ["novelId"],
          },
        },
        {
          name: "novelforge_create_novel",
          description: "创建一部新的小说作品。",
          inputSchema: {
            type: "object",
            properties: {
              title: { type: "string", description: "小说名称" },
              author: { type: "string", description: "作者笔名（可选，默认为空）" },
              genre: { type: "string", description: "作品分类（如：玄幻、都市、仙侠、科幻、历史、悬疑、轻小说等，默认玄幻）" },
              intro: { type: "string", description: "作品简介/故事核" },
              coverColor: { type: "string", description: "封面主题色（Hex颜色值，默认 #e60012 起点红）" },
              userId: { type: "number", description: "归属用户ID（可选）" },
            },
            required: ["title"],
          },
        },
        {
          name: "novelforge_update_novel",
          description: "更新小说的基本信息（书名、简介、分类、连载状态等）。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
              title: { type: "string", description: "新书名" },
              author: { type: "string", description: "作者笔名" },
              genre: { type: "string", description: "作品分类" },
              status: { type: "string", description: "连载状态（连载中、已完结、暂停连载、隐藏）" },
              intro: { type: "string", description: "作品简介" },
              coverColor: { type: "string", description: "封面颜色" },
            },
            required: ["novelId"],
          },
        },
        {
          name: "novelforge_delete_novel",
          description: "删除一部小说及其所有章节、细纲、角色设定（危险操作，需 confirm=true）。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
              confirm: { type: "boolean", description: "确认删除标识，必须显式传入 true" },
            },
            required: ["novelId", "confirm"],
          },
        },
        {
          name: "novelforge_list_chapters",
          description: "获取指定小说的所有章节目录列表（按排序顺序输出 ID、标题、字数、发布状态）。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
            },
            required: ["novelId"],
          },
        },
        {
          name: "novelforge_get_chapter",
          description: "获取指定章节的完整正文内容及元数据。",
          inputSchema: {
            type: "object",
            properties: {
              chapterId: { type: "number", description: "章节ID" },
            },
            required: ["chapterId"],
          },
        },
        {
          name: "novelforge_create_chapter",
          description: "在指定小说中新建一个章节（支持直接填入正文，自动统计中文字数）。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
              title: { type: "string", description: "章节标题（例如：第1章 觉醒之日）" },
              content: { type: "string", description: "章节正文内容（可选，默认空）" },
              status: { type: "string", description: "状态（草稿、已发布，默认草稿）" },
            },
            required: ["novelId", "title"],
          },
        },
        {
          name: "novelforge_update_chapter",
          description: "更新章节的标题、正文内容或状态（自动创建历史版本备份并更新小说总字数）。",
          inputSchema: {
            type: "object",
            properties: {
              chapterId: { type: "number", description: "章节ID" },
              title: { type: "string", description: "修改后的章节标题" },
              content: { type: "string", description: "修改后的章节正文内容" },
              status: { type: "string", description: "状态（草稿、已发布）" },
              backupReason: { type: "string", description: "更新前自动快照的说明（可选，默认：MCP Agent修改前备份）" },
            },
            required: ["chapterId"],
          },
        },
        {
          name: "novelforge_delete_chapter",
          description: "删除指定章节及其细纲与历史版本。",
          inputSchema: {
            type: "object",
            properties: {
              chapterId: { type: "number", description: "章节ID" },
            },
            required: ["chapterId"],
          },
        },
        {
          name: "novelforge_list_chapter_revisions",
          description: "获取章节的历史备份版本列表（包括字数、备份原因与时间）。",
          inputSchema: {
            type: "object",
            properties: {
              chapterId: { type: "number", description: "章节ID" },
            },
            required: ["chapterId"],
          },
        },
        {
          name: "novelforge_restore_chapter_revision",
          description: "将章节内容回滚/恢复至指定的历史版本。",
          inputSchema: {
            type: "object",
            properties: {
              chapterId: { type: "number", description: "章节ID" },
              revisionId: { type: "number", description: "版本记录ID" },
            },
            required: ["chapterId", "revisionId"],
          },
        },
        {
          name: "novelforge_get_outlines",
          description: "获取小说的全书大纲或分卷/章节细纲列表。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
            },
            required: ["novelId"],
          },
        },
        {
          name: "novelforge_update_outline",
          description: "创建或更新细纲条目（可关联具体章节或作为全书大纲）。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
              outlineId: { type: "number", description: "细纲ID（若传入则更新已有条目，若不传则新增条目）" },
              chapterId: { type: "number", description: "关联的章节ID（可选）" },
              title: { type: "string", description: "细纲节点标题" },
              content: { type: "string", description: "细纲详情内容" },
              sortOrder: { type: "number", description: "排序序号" },
            },
            required: ["novelId", "title"],
          },
        },
        {
          name: "novelforge_list_characters",
          description: "获取小说的人设卡与角色库列表（姓名、身份、角色定位、性格特点、关系网）。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
            },
            required: ["novelId"],
          },
        },
        {
          name: "novelforge_get_character",
          description: "获取单个角色的完整人物设定卡详情。",
          inputSchema: {
            type: "object",
            properties: {
              characterId: { type: "number", description: "角色ID" },
            },
            required: ["characterId"],
          },
        },
        {
          name: "novelforge_create_character",
          description: "在小说中新增角色设定卡。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
              name: { type: "string", description: "角色姓名" },
              alias: { type: "string", description: "绰号/别名/尊号" },
              role: { type: "string", description: "角色定位（主角、主要配角、反派、配角、路人，默认主角）" },
              gender: { type: "string", description: "性别（男、女、未知）" },
              age: { type: "string", description: "年龄/寿元" },
              appearance: { type: "string", description: "外貌特征/衣着打扮" },
              personality: { type: "string", description: "性格特征/行为习惯" },
              background: { type: "string", description: "背景经历/功法金手指" },
              relationships: { type: "string", description: "与其他角色的关系（JSON字符串或文本说明）" },
            },
            required: ["novelId", "name"],
          },
        },
        {
          name: "novelforge_update_character",
          description: "更新角色设定卡的各项信息。",
          inputSchema: {
            type: "object",
            properties: {
              characterId: { type: "number", description: "角色ID" },
              name: { type: "string", description: "角色姓名" },
              alias: { type: "string", description: "别名" },
              role: { type: "string", description: "角色定位" },
              gender: { type: "string", description: "性别" },
              age: { type: "string", description: "年龄" },
              appearance: { type: "string", description: "外貌特征" },
              personality: { type: "string", description: "性格特征" },
              background: { type: "string", description: "背景设定" },
              relationships: { type: "string", description: "人际关系" },
            },
            required: ["characterId"],
          },
        },
        {
          name: "novelforge_delete_character",
          description: "删除指定角色设定卡。",
          inputSchema: {
            type: "object",
            properties: {
              characterId: { type: "number", description: "角色ID" },
            },
            required: ["characterId"],
          },
        },
        {
          name: "novelforge_get_world_map",
          description: "获取小说的世界观设定、势力分布与地图设定数据。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
            },
            required: ["novelId"],
          },
        },
        {
          name: "novelforge_update_world_map",
          description: "更新小说的世界观设定与地图数据（支持 JSON 结构与层级节点）。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
              name: { type: "string", description: "世界设定名称（默认：世界地图与地理势力）" },
              data: { type: "string", description: "世界观/地图数据（JSON字符串或结构化文本）" },
            },
            required: ["novelId", "data"],
          },
        },
        {
          name: "novelforge_get_writer_state",
          description: "获取小说的创作进度备忘与伏笔追踪记录（foreshadowing 列表）。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
            },
            required: ["novelId"],
          },
        },
        {
          name: "novelforge_update_writer_state",
          description: "更新小说的创作进度备忘或伏笔追踪记录。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
              progress: { type: "string", description: "创作进度笔记与待办" },
              foreshadowing: { type: "string", description: "伏笔记录列表（JSON 字符串数组，包含草蛇灰线标记）" },
            },
            required: ["novelId"],
          },
        },
        {
          name: "novelforge_export_novel",
          description: "将整部小说或指定范围章节完整导出为标准排版的 Markdown / 纯文本。",
          inputSchema: {
            type: "object",
            properties: {
              novelId: { type: "number", description: "小说ID" },
              format: { type: "string", description: "导出格式（markdown 或 text，默认 markdown）" },
              includeOutlines: { type: "boolean", description: "是否在开头附带细纲与人设（默认 true）" },
            },
            required: ["novelId"],
          },
        },
        {
          name: "novelforge_search",
          description: "全局搜索：在小说正文、章节标题、人设卡、细纲或世界设定中检索关键词。",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "检索关键词" },
              novelId: { type: "number", description: "指定小说ID进行精准检索（可选，不传则全书库检索）" },
            },
            required: ["query"],
          },
        },
      ],
    };
  });

  // 2. 处理 Tool 调用
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = args || {};

    try {
      switch (name) {
        case "novelforge_list_novels": {
          const userId = resolveUserId(a.userId as number);
          const novels = db
            .prepare(
              `SELECT n.id, n.title, n.author, n.genre, n.status, n.intro, n.word_count, n.is_public, n.updated_at,
                      (SELECT COUNT(1) FROM chapters c WHERE c.novel_id = n.id) AS chapter_count
               FROM novels n WHERE n.user_id = ? ORDER BY n.updated_at DESC`
            )
            .all(userId);
          return { content: [{ type: "text", text: JSON.stringify(novels, null, 2) }] };
        }

        case "novelforge_get_novel": {
          const novelId = Number(a.novelId);
          const novel = db.prepare("SELECT * FROM novels WHERE id = ?").get(novelId) as any;
          if (!novel) throw new Error(`小说 ID ${novelId} 不存在`);
          const chapterCount = (
            db.prepare("SELECT COUNT(1) AS c FROM chapters WHERE novel_id = ?").get(novelId) as any
          ).c;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ...novel, chapter_count: chapterCount }, null, 2),
              },
            ],
          };
        }

        case "novelforge_create_novel": {
          const userId = resolveUserId(a.userId as number);
          const title = String(a.title || "").trim();
          if (!title) throw new Error("小说书名不能为空");
          const author = String(a.author || "").trim();
          const genre = String(a.genre || "玄幻").trim();
          const intro = String(a.intro || "").trim();
          const coverColor = String(a.coverColor || "#e60012").trim();

          const info = db
            .prepare(
              "INSERT INTO novels (user_id, title, author, genre, intro, cover_color) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .run(userId, title, author, genre, intro, coverColor);

          const created = db.prepare("SELECT * FROM novels WHERE id = ?").get(info.lastInsertRowid);
          return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] };
        }

        case "novelforge_update_novel": {
          const novelId = Number(a.novelId);
          const fields: string[] = [];
          const vals: any[] = [];
          if (a.title !== undefined) {
            fields.push("title = ?");
            vals.push(String(a.title).trim());
          }
          if (a.author !== undefined) {
            fields.push("author = ?");
            vals.push(String(a.author).trim());
          }
          if (a.genre !== undefined) {
            fields.push("genre = ?");
            vals.push(String(a.genre).trim());
          }
          if (a.status !== undefined) {
            fields.push("status = ?");
            vals.push(String(a.status).trim());
          }
          if (a.intro !== undefined) {
            fields.push("intro = ?");
            vals.push(String(a.intro).trim());
          }
          if (a.coverColor !== undefined) {
            fields.push("cover_color = ?");
            vals.push(String(a.coverColor).trim());
          }
          if (!fields.length) throw new Error("未提供任何需要更新的字段");
          fields.push("updated_at = datetime('now')");
          vals.push(novelId);
          db.prepare(`UPDATE novels SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
          const updated = db.prepare("SELECT * FROM novels WHERE id = ?").get(novelId);
          return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
        }

        case "novelforge_delete_novel": {
          const novelId = Number(a.novelId);
          if (a.confirm !== true) throw new Error("删除作品为不可逆高危操作，必须传入 confirm: true");
          db.prepare("DELETE FROM novels WHERE id = ?").run(novelId);
          return { content: [{ type: "text", text: `成功删除小说 ID ${novelId} 及关联的所有内容` }] };
        }

        case "novelforge_list_chapters": {
          const novelId = Number(a.novelId);
          const chapters = db
            .prepare(
              "SELECT id, novel_id, title, status, word_count, sort_order, updated_at FROM chapters WHERE novel_id = ? ORDER BY sort_order, id"
            )
            .all(novelId);
          return { content: [{ type: "text", text: JSON.stringify(chapters, null, 2) }] };
        }

        case "novelforge_get_chapter": {
          const chapterId = Number(a.chapterId);
          const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId);
          if (!chapter) throw new Error(`章节 ID ${chapterId} 不存在`);
          return { content: [{ type: "text", text: JSON.stringify(chapter, null, 2) }] };
        }

        case "novelforge_create_chapter": {
          const novelId = Number(a.novelId);
          const title = String(a.title || "").trim();
          if (!title) throw new Error("章节标题不能为空");
          const content = String(a.content || "");
          const status = String(a.status || "草稿");
          const wordCount = countChineseChars(content);

          const max = (
            db.prepare("SELECT COALESCE(MAX(sort_order),0) AS m FROM chapters WHERE novel_id=?").get(novelId) as any
          ).m;

          const info = db
            .prepare(
              "INSERT INTO chapters (novel_id, title, content, status, word_count, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .run(novelId, title, content, status, wordCount, max + 1);

          touchNovel(novelId);
          const created = db.prepare("SELECT * FROM chapters WHERE id = ?").get(info.lastInsertRowid);
          return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] };
        }

        case "novelforge_update_chapter": {
          const chapterId = Number(a.chapterId);
          const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as any;
          if (!chapter) throw new Error(`章节 ID ${chapterId} 不存在`);

          const reason = String(a.backupReason || "MCP Agent 修改前备份");
          if (chapter.content && chapter.content.trim()) {
            saveChapterRevision(chapterId, reason, chapter.content, chapter.title);
          }

          const fields: string[] = [];
          const vals: any[] = [];
          if (a.title !== undefined) {
            fields.push("title = ?");
            vals.push(String(a.title).trim());
          }
          if (a.status !== undefined) {
            fields.push("status = ?");
            vals.push(String(a.status).trim());
          }
          if (a.content !== undefined) {
            const cnt = String(a.content);
            fields.push("content = ?");
            fields.push("word_count = ?");
            vals.push(cnt, countChineseChars(cnt));
          }
          if (!fields.length) throw new Error("未提供任何需要更新的字段");
          fields.push("updated_at = datetime('now')");
          vals.push(chapterId);

          db.prepare(`UPDATE chapters SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
          touchNovel(chapter.novel_id);
          const updated = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId);
          return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
        }

        case "novelforge_delete_chapter": {
          const chapterId = Number(a.chapterId);
          const chapter = db.prepare("SELECT novel_id FROM chapters WHERE id = ?").get(chapterId) as any;
          if (!chapter) throw new Error(`章节 ID ${chapterId} 不存在`);
          db.prepare("DELETE FROM chapters WHERE id = ?").run(chapterId);
          touchNovel(chapter.novel_id);
          return { content: [{ type: "text", text: `成功删除章节 ID ${chapterId}` }] };
        }

        case "novelforge_list_chapter_revisions": {
          const chapterId = Number(a.chapterId);
          const rows = db
            .prepare(
              "SELECT id, chapter_id, novel_id, title, word_count, reason, created_at FROM chapter_revisions WHERE chapter_id = ? ORDER BY id DESC"
            )
            .all(chapterId);
          return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
        }

        case "novelforge_restore_chapter_revision": {
          const chapterId = Number(a.chapterId);
          const revisionId = Number(a.revisionId);
          const rev = db
            .prepare("SELECT * FROM chapter_revisions WHERE id = ? AND chapter_id = ?")
            .get(revisionId, chapterId) as any;
          if (!rev) throw new Error(`历史版本 ID ${revisionId} 不存在`);

          const current = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as any;
          if (!current) throw new Error(`章节 ID ${chapterId} 不存在`);

          if (current.content && current.content.trim()) {
            saveChapterRevision(chapterId, "回滚前当前版本自动快照", current.content, current.title);
          }

          const wc = countChineseChars(rev.content);
          db.prepare(
            "UPDATE chapters SET content = ?, word_count = ?, updated_at = datetime('now') WHERE id = ?"
          ).run(rev.content, wc, chapterId);

          touchNovel(current.novel_id);
          const restored = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId);
          return { content: [{ type: "text", text: JSON.stringify(restored, null, 2) }] };
        }

        case "novelforge_get_outlines": {
          const novelId = Number(a.novelId);
          const rows = db
            .prepare("SELECT * FROM outlines WHERE novel_id = ? ORDER BY sort_order, id")
            .all(novelId);
          return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
        }

        case "novelforge_update_outline": {
          const novelId = Number(a.novelId);
          const title = String(a.title || "").trim();
          const content = String(a.content || "");
          const chapterId = a.chapterId !== undefined ? Number(a.chapterId) : null;
          const sortOrder = Number(a.sortOrder || 0);

          if (a.outlineId) {
            const oid = Number(a.outlineId);
            db.prepare(
              "UPDATE outlines SET title = ?, content = ?, chapter_id = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ? AND novel_id = ?"
            ).run(title, content, chapterId, sortOrder, oid, novelId);
            const updated = db.prepare("SELECT * FROM outlines WHERE id = ?").get(oid);
            return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
          } else {
            const info = db
              .prepare(
                "INSERT INTO outlines (novel_id, chapter_id, title, content, sort_order) VALUES (?, ?, ?, ?, ?)"
              )
              .run(novelId, chapterId, title, content, sortOrder);
            const created = db.prepare("SELECT * FROM outlines WHERE id = ?").get(info.lastInsertRowid);
            return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] };
          }
        }

        case "novelforge_list_characters": {
          const novelId = Number(a.novelId);
          const characters = db
            .prepare("SELECT * FROM characters WHERE novel_id = ? ORDER BY sort_order, id")
            .all(novelId);
          return { content: [{ type: "text", text: JSON.stringify(characters, null, 2) }] };
        }

        case "novelforge_get_character": {
          const characterId = Number(a.characterId);
          const char = db.prepare("SELECT * FROM characters WHERE id = ?").get(characterId);
          if (!char) throw new Error(`角色 ID ${characterId} 不存在`);
          return { content: [{ type: "text", text: JSON.stringify(char, null, 2) }] };
        }

        case "novelforge_create_character": {
          const novelId = Number(a.novelId);
          const name = String(a.name || "").trim();
          if (!name) throw new Error("角色姓名不能为空");
          const alias = String(a.alias || "");
          const role = String(a.role || "主角");
          const gender = String(a.gender || "未知");
          const age = String(a.age || "");
          const appearance = String(a.appearance || "");
          const personality = String(a.personality || "");
          const background = String(a.background || "");
          const relationships = String(a.relationships || "[]");

          const info = db
            .prepare(
              `INSERT INTO characters (novel_id, name, alias, role, gender, age, appearance, personality, background, relationships)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(novelId, name, alias, role, gender, age, appearance, personality, background, relationships);

          const created = db.prepare("SELECT * FROM characters WHERE id = ?").get(info.lastInsertRowid);
          return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] };
        }

        case "novelforge_update_character": {
          const characterId = Number(a.characterId);
          const fields: string[] = [];
          const vals: any[] = [];
          const keys = ["name", "alias", "role", "gender", "age", "appearance", "personality", "background", "relationships"];
          for (const k of keys) {
            if ((a as any)[k] !== undefined) {
              fields.push(`${k} = ?`);
              vals.push(String((a as any)[k]));
            }
          }
          if (!fields.length) throw new Error("未提供任何需要更新的字段");
          fields.push("updated_at = datetime('now')");
          vals.push(characterId);

          db.prepare(`UPDATE characters SET ${fields.join(", ")} WHERE id = ?`).run(...vals);
          const updated = db.prepare("SELECT * FROM characters WHERE id = ?").get(characterId);
          return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
        }

        case "novelforge_delete_character": {
          const characterId = Number(a.characterId);
          db.prepare("DELETE FROM characters WHERE id = ?").run(characterId);
          return { content: [{ type: "text", text: `成功删除角色 ID ${characterId}` }] };
        }

        case "novelforge_get_world_map": {
          const novelId = Number(a.novelId);
          const map = db.prepare("SELECT * FROM maps WHERE novel_id = ?").get(novelId) as any;
          return { content: [{ type: "text", text: JSON.stringify(map || { novel_id: novelId, name: "世界地图", data: "{}" }, null, 2) }] };
        }

        case "novelforge_update_world_map": {
          const novelId = Number(a.novelId);
          const name = String(a.name || "世界地图");
          const data = String(a.data || "{}");
          const exists = db.prepare("SELECT id FROM maps WHERE novel_id = ?").get(novelId) as any;
          if (exists) {
            db.prepare("UPDATE maps SET name = ?, data = ?, updated_at = datetime('now') WHERE novel_id = ?").run(name, data, novelId);
          } else {
            db.prepare("INSERT INTO maps (novel_id, name, data) VALUES (?, ?, ?)").run(novelId, name, data);
          }
          const updated = db.prepare("SELECT * FROM maps WHERE novel_id = ?").get(novelId);
          return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
        }

        case "novelforge_get_writer_state": {
          const novelId = Number(a.novelId);
          const state = db.prepare("SELECT * FROM novel_writer_state WHERE novel_id = ?").get(novelId);
          return { content: [{ type: "text", text: JSON.stringify(state || { novel_id: novelId, progress: "", foreshadowing: "[]" }, null, 2) }] };
        }

        case "novelforge_update_writer_state": {
          const novelId = Number(a.novelId);
          const userId = resolveUserId();
          const progress = a.progress !== undefined ? String(a.progress) : null;
          const foreshadowing = a.foreshadowing !== undefined ? String(a.foreshadowing) : null;

          const exists = db.prepare("SELECT novel_id FROM novel_writer_state WHERE novel_id = ?").get(novelId);
          if (exists) {
            const fields: string[] = [];
            const vals: any[] = [];
            if (progress !== null) {
              fields.push("progress = ?");
              vals.push(progress);
            }
            if (foreshadowing !== null) {
              fields.push("foreshadowing = ?");
              vals.push(foreshadowing);
            }
            fields.push("updated_at = datetime('now')");
            vals.push(novelId);
            db.prepare(`UPDATE novel_writer_state SET ${fields.join(", ")} WHERE novel_id = ?`).run(...vals);
          } else {
            db.prepare("INSERT INTO novel_writer_state (novel_id, user_id, progress, foreshadowing) VALUES (?, ?, ?, ?)").run(
              novelId,
              userId,
              progress || "",
              foreshadowing || "[]"
            );
          }
          const updated = db.prepare("SELECT * FROM novel_writer_state WHERE novel_id = ?").get(novelId);
          return { content: [{ type: "text", text: JSON.stringify(updated, null, 2) }] };
        }

        case "novelforge_export_novel": {
          const novelId = Number(a.novelId);
          const format = String(a.format || "markdown").toLowerCase();
          const includeOutlines = a.includeOutlines !== false;

          const novel = db.prepare("SELECT * FROM novels WHERE id = ?").get(novelId) as any;
          if (!novel) throw new Error(`小说 ID ${novelId} 不存在`);

          const chapters = db
            .prepare("SELECT * FROM chapters WHERE novel_id = ? ORDER BY sort_order, id")
            .all(novelId) as any[];

          let output = "";
          if (format === "markdown") {
            output += `# ${novel.title}\n\n`;
            output += `**作者**：${novel.author || "佚名"}  \n`;
            output += `**分类**：${novel.genre} | **状态**：${novel.status} | **总字数**：${novel.word_count} 字  \n\n`;
            if (novel.intro) {
              output += `## 作品简介\n\n${novel.intro}\n\n`;
            }

            if (includeOutlines) {
              const outlines = db.prepare("SELECT * FROM outlines WHERE novel_id = ? ORDER BY sort_order, id").all(novelId) as any[];
              if (outlines.length > 0) {
                output += `## 核心大纲\n\n`;
                for (const o of outlines) {
                  output += `### ${o.title}\n\n${o.content}\n\n`;
                }
              }

              const chars = db.prepare("SELECT * FROM characters WHERE novel_id = ? ORDER BY sort_order, id").all(novelId) as any[];
              if (chars.length > 0) {
                output += `## 主要人设卡\n\n`;
                for (const c of chars) {
                  output += `### ${c.name} (${c.role} / ${c.gender})\n`;
                  if (c.alias) output += `- **别名**：${c.alias}\n`;
                  if (c.personality) output += `- **性格**：${c.personality}\n`;
                  if (c.appearance) output += `- **外貌**：${c.appearance}\n`;
                  if (c.background) output += `- **背景**：${c.background}\n`;
                  output += `\n`;
                }
              }
            }

            output += `## 正文章节\n\n`;
            for (const ch of chapters) {
              output += `### ${ch.title}\n\n${ch.content || "（暂无正文）"}\n\n`;
            }
          } else {
            output += `《${novel.title}》\n作者：${novel.author || "佚名"}\n字数：${novel.word_count}字\n简介：${novel.intro}\n\n`;
            for (const ch of chapters) {
              output += `====================\n${ch.title}\n====================\n\n${ch.content}\n\n\n`;
            }
          }

          return { content: [{ type: "text", text: output }] };
        }

        case "novelforge_search": {
          const q = String(a.query || "").trim();
          if (!q) throw new Error("检索关键词不能为空");
          const novelId = a.novelId ? Number(a.novelId) : null;
          const like = `%${q}%`;

          let chSql = "SELECT id, novel_id, title, substr(content, 1, 100) AS snippet, word_count FROM chapters WHERE (title LIKE ? OR content LIKE ?)";
          const chParams: any[] = [like, like];
          if (novelId) {
            chSql += " AND novel_id = ?";
            chParams.push(novelId);
          }
          const matchedChapters = db.prepare(chSql + " LIMIT 20").all(...chParams);

          let charSql = "SELECT id, novel_id, name, role, appearance, personality, background FROM characters WHERE (name LIKE ? OR alias LIKE ? OR personality LIKE ? OR background LIKE ?)";
          const charParams: any[] = [like, like, like, like];
          if (novelId) {
            charSql += " AND novel_id = ?";
            charParams.push(novelId);
          }
          const matchedCharacters = db.prepare(charSql + " LIMIT 10").all(...charParams);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    query: q,
                    matchedChapters,
                    matchedCharacters,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        default:
          throw new Error(`未知的 MCP 工具: ${name}`);
      }
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text", text: `[MCP 执行错误] ${err.message}` }],
      };
    }
  });

  // 3. 注册 MCP Resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "novelforge://novels",
          name: "起笔·全书库小说列表",
          mimeType: "application/json",
          description: "当前用户的全部小说作品及基础元数据",
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    if (uri === "novelforge://novels") {
      const userId = resolveUserId();
      const rows = db.prepare("SELECT * FROM novels WHERE user_id = ? ORDER BY updated_at DESC").all(userId);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(rows, null, 2),
          },
        ],
      };
    }
    throw new Error(`资源未找到: ${uri}`);
  });

  // 4. 注册 MCP Prompts
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: [
        {
          name: "deslop_text",
          description: "【网文 7 Gate 门禁去AI味】清除禁用词、打破排比、动作说话代替直接心理、段首缩进两全角空格",
          arguments: [
            { name: "text", description: "需要去AI味的小说文本段落或章节", required: true },
          ],
        },
        {
          name: "review_chapter",
          description: "【主编+读者双重视角对抗式审查】排查毒点、节奏拖沓、人设崩塌，输出改进示范",
          arguments: [
            { name: "chapterContent", description: "待审查的小说正文内容", required: true },
            { name: "novelContext", description: "小说背景设定或大纲（可选）", required: false },
          ],
        },
        {
          name: "analyze_chapter",
          description: "【爆款网文结构与黄金三章拆解】分析故事核、卖点、情绪曲线与金手指节奏",
          arguments: [
            { name: "text", description: "需要拆解的小说章节或范文", required: true },
          ],
        },
      ],
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: pArgs } = request.params;
    const a = pArgs || {};

    if (name === "deslop_text") {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `你是一位资深网络小说去AI味精修专家。你的任务是彻底清除文本中的AI写作痕迹，让文字回归自然、生动、非模板化的真实网文质感。
【7 Gate 门禁系统】
1. 彻底清除“不禁/深吸一口气/眼中闪过一丝/嘴角勾起一抹/宛如/宛若/缓缓开口/这一刻”等AI套路词；
2. 打破三段式工整排比，打乱长短句节奏；
3. 动作说话代替直接解释心理；
4. 对话去除说教书面腔，加入口语与停顿；
5. 删减无意义心理与注水过渡；
6. 段末严禁升华总结与哲理感慨；
7. 【排版规范】输出的每个段落开头必须严格缩进两个全角空格（　　）。

保持原剧情走向与人设不变，直接输出去AI味精修后的自然全文：

${a.text}`,
            },
          },
        ],
      };
    }

    if (name === "review_chapter") {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `你是一位严苛的网络小说审查协调器。你的职责是模拟【网文资深主编】与【挑剔核心老读者】视角，对提交的小说章节进行对抗式审查找茬，找出潜在问题与毒点。
执行铁律：审查是挑刺找问题，不是验证正确性。请从以下维度输出结构化审查报告：
1. 【综合评级与毒点预警】（S/A/B/C/D级评分，明确指出主角是否憋屈、设定是否吃书、配角是否弱智）；
2. 【核心问题诊断清单】（结构与节奏拖沓、爽点铺垫是否成立、人设是否崩塌、章末钩子是否有追读欲望）；
3. 【可执行修改示范】（给出针对最严重问题的具体改写对比示范）。

${a.novelContext ? `【作品背景】\n${a.novelContext}\n\n` : ""}【待审查章节】\n${a.chapterContent}`,
            },
          },
        ],
      };
    }

    if (name === "analyze_chapter") {
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `你是一位资深网络小说结构分析师与爆款拆解专家。你的任务是深度拆解小说文本，提炼其爆款密码与结构设计。请全面分析并输出以下模块的结构化拆解报告：
1. 【故事核与核心看点】（底层驱动力、核心卖点、金手指/极致情绪/反差感）；
2. 【黄金三章/节奏线拆解】（开篇危机悬念、主角立住机制、压抑与释放情绪曲线）；
3. 【金手指与信息差节奏】（运作机制与爽感回报）；
4. 【写作手法与可迁移模板】（可供作者学习复用的具体叙事技巧与结构公式）。

【拆解文本】\n${a.text}`,
            },
          },
        ],
      };
    }

    throw new Error(`未知的 MCP Prompt: ${name}`);
  });

  return server;
}

export async function runStdioMcpServer() {
  const server = createNovelForgeMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[NovelForge MCP] 起笔小说创作平台 MCP 服务已启动 (Stdio 模式)");
}

// 若直接运行本文件
if (process.argv[1] && (process.argv[1].endsWith("mcp.ts") || process.argv[1].endsWith("mcp.js"))) {
  runStdioMcpServer().catch((err) => {
    console.error("[NovelForge MCP 启动失败]", err);
    process.exit(1);
  });
}
