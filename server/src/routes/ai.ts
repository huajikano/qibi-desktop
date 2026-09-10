import express, { Request, Response } from "express";
import { db, decryptKey, encryptKey } from "../db.js";
import { requireAuth, currentUser } from "../auth.js";
import { buildSkillInjection } from "../skills.js";

const router = express.Router();
router.use(requireAuth);



const STATION_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-5";
const BASE_URL = (process.env.ANTHROPIC_BASE_URL || "").replace(/\/+$/, "");
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT || 50);
// 默认仅允许管理员账号使用服务端配置的本地站方密钥（如机子本地部署的 cc-switch 代理）
// 普通注册用户必须配置自己的 API Key，避免滥用主机的 AI 余额与网络连接
const ALLOW_PUBLIC_STATION_KEY = process.env.ALLOW_PUBLIC_STATION_KEY === "true";

function getStationKey(user: any): string {
  if (!STATION_KEY) return "";
  if (user?.role === "admin" || ALLOW_PUBLIC_STATION_KEY) return STATION_KEY;
  return "";
}

type AiProtocol = "auto" | "anthropic" | "openai";
function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("API Base URL 必须是无凭据的 http/https 地址");
  if (url.hostname.toLowerCase() === "ccswitch.io" || url.hostname.toLowerCase().endsWith(".ccswitch.io")) throw new Error("https://ccswitch.io/ 是官网地址，不是 API endpoint");
  return url.toString().replace(/\/+$/, "");
}
function validProtocol(value: unknown): AiProtocol {
  return value === "anthropic" || value === "openai" || value === "auto" ? value : "auto";
}
function resolveBaseUrl(user: any, req: Request): string {
  const raw = req.session.userApiBaseUrl || user.ai_api_base_url || BASE_URL || "https://api.anthropic.com";
  return normalizeBaseUrl(raw);
}
function resolveProtocol(user: any, req: Request, baseUrl: string): Exclude<AiProtocol, "auto"> {
  const configured = validProtocol(req.session.userApiProtocol || user.ai_api_protocol);
  if (configured !== "auto") return configured;
  return baseUrl.endsWith("/v1") ? "openai" : "anthropic";
}

type Role = "draft" | "continue" | "polish" | "expand" | "outline" | "summary" | "suggest" | "deslop" | "review" | "analyze";

const SYSTEM_PROMPTS: Record<Role, string> = {
  draft: "你是一位资深中文网络小说作家。你已获得该小说的整本小说完整章节目录、所有历史章节细纲与全部正文前文、全书人物卡与本章细纲设定。请深入结合全书已写章节的剧情脉络与人物性格发展，严格承接前序章节结尾情节，紧扣本章细纲，创作一章紧密承接前文的本章完整正文。文风：中文网络小说风格，节奏紧凑，描写生动，对话自然，每章约2500-4000字。直接输出正文，不要输出章节标题、不要解释。",
  continue: "你是中文小说续写助手。你已掌握全书所有已有章节的全部正文上下文与本章已有内容。请紧接当前章节已有文字自然向下续写，保持与全书人物设定、世界观、文风、人称、节奏与口吻完全一致，自然延续情节走向。直接输出续写正文，不要输出标题与解释。",
  deslop: "你是一位资深网络小说去AI味精修专家。你的任务是彻底清除文本中的AI写作痕迹，让文字回归自然、生动、非模板化的真实网文质感。【7 Gate 门禁系统】1. 彻底清除“不禁/深吸一口气/眼中闪过一丝/嘴角勾起一抹/宛如/宛若/缓缓开口/这一刻”等AI套路词；2. 打破三段式工整排比，打乱长短句节奏；3. 动作说话代替直接解释心理；4. 对话去除说教书面腔，加入口语与停顿；5. 删减无意义心理与注水过渡；6. 段末严禁升华总结与哲理感慨；7. 保持原剧情走向与人设不变，直接输出去AI味精修后的自然全文。",
  polish: "你是中文小说润色编辑。基于整本小说的完整上下文与人物设定，请对给定正文进行润色：修正病句与错别字、提升描写质感与环境氛围、让对话更契合人物性格，但保持原意、情节、结构与人称完全不变。直接输出润色后的全文。",
  expand: "你是中文小说扩写助手。基于整本小说的完整上下文与人物设定，请在不改变情节主干的前提下，将给定正文扩写得更丰满：补充环境氛围、心理活动、细节动作与人物神态对话。直接输出扩写后的全文。",
  review: "你是一位严苛的网络小说审查协调器。你的职责是模拟【网文资深主编】与【挑剔核心老读者】视角，对提交的小说章节进行对抗式审查找茬，找出潜在问题与毒点。执行铁律：审查是挑刺找问题，不是验证正确性。请从以下维度输出结构化审查报告：1. 【综合评级与毒点预警】（S/A/B/C/D级评分，明确指出主角是否憋屈、设定是否吃书、配角是否弱智）；2. 【核心问题诊断清单】（结构与节奏拖沓、爽点铺垫是否成立、人设是否崩塌、章末钩子是否有追读欲望）；3. 【可执行修改示范】（给出针对最严重问题的具体改写对比示范）。",
  analyze: "你是一位资深网络小说结构分析师与爆款拆解专家。你的任务是深度拆解小说文本，提炼其爆款密码与结构设计。请全面分析并输出以下模块的结构化拆解报告：1. 【故事核与核心看点】（底层驱动力、核心卖点、金手指/极致情绪/反差感）；2. 【黄金三章/节奏线拆解】（开篇危机悬念、主角立住机制、压抑与释放情绪曲线）；3. 【金手指与信息差节奏】（运作机制与爽感回报）；4. 【写作手法与可迁移模板】（可供作者学习复用的具体叙事技巧与结构公式）。",
  outline: "你是小说大纲规划师。请全面通盘分析小说设定、全书所有已有章节目录、各章细纲与已写正文剧情走向，输出结构清晰的后续分章节细纲：每章包含【核心冲突】【关键情节】【出场人物】【结尾钩子】。",
  summary: "你是小说内容总结助手。请结合整本小说全局脉络，为给定正文写一段150字以内的章节摘要，供作者快速回顾。直接输出摘要。",
  suggest: "你是小说创作顾问。基于整本小说设定、全书所有章节目录、已写各章正文剧情脉络、总大纲与人物卡，针对作者提出的创作与剧情问题给出专业、具体、前后严谨一致的可执行建议。",
};

const TOKEN_LIMIT: Record<Role, number> = {
  draft: 9000,
  continue: 5000,
  deslop: 6000,
  polish: 5000,
  expand: 7000,
  review: 5000,
  analyze: 5000,
  outline: 4000,
  summary: 800,
  suggest: 3000,
};

function buildContext(req: Request): string {
  const { novelId, chapterId, content, extra } = req.body || {};
  const parts: string[] = [];
  if (!novelId) {
    if (content) parts.push(`【正文片段】\n${String(content)}`);
    if (extra) parts.push(`【补充要求】\n${String(extra)}`);
    return parts.join("\n\n");
  }

  const novel = db.prepare("SELECT * FROM novels WHERE id = ?").get(novelId) as any;
  if (!novel) {
    if (content) parts.push(`【正文片段】\n${String(content)}`);
    if (extra) parts.push(`【补充要求】\n${String(extra)}`);
    return parts.join("\n\n");
  }

  // 1. 作品基础档案
  parts.push(
    `【作品基础档案】\n- 书名：《${novel.title}》\n- 类型/流派：${novel.genre || "未设定"}\n- 当前状态：${novel.status || "连载中"}\n- 全书总字数：约 ${novel.word_count || 0} 字\n- 作品简介：${novel.intro || "暂无简介"}`
  );

  // 2. 作品总大纲与主线
  const outlines = db
    .prepare("SELECT id, title, content FROM outlines WHERE novel_id = ? AND chapter_id IS NULL ORDER BY sort_order ASC, id ASC")
    .all(novelId) as Array<{ id: number; title: string; content: string }>;
  if (outlines.length > 0) {
    parts.push(
      `【作品总大纲与主线剧情】\n${outlines.map((o, idx) => `${idx + 1}. 【${o.title || "大纲条目"}】：${o.content}`).join("\n")}`
    );
  }

  // 3. 全书人物卡与关系设定
  const chars = db
    .prepare("SELECT * FROM characters WHERE novel_id = ? ORDER BY sort_order ASC, id ASC")
    .all(novelId) as any[];
  if (chars.length > 0) {
    const charList = chars.map((c, idx) => {
      const details = [
        `身份定位：${c.role || "配角"}`,
        c.gender && c.gender !== "未知" ? `性别：${c.gender}` : "",
        c.age ? `年龄：${c.age}` : "",
        c.alias ? `别名/称号：${c.alias}` : "",
        c.personality ? `性格：${c.personality}` : "",
        c.appearance ? `外貌：${c.appearance}` : "",
        c.background ? `背景：${c.background}` : "",
      ]
        .filter(Boolean)
        .join(" | ");

      let relStr = "";
      if (c.relationships) {
        try {
          const rels = JSON.parse(c.relationships);
          if (Array.isArray(rels) && rels.length > 0) {
            relStr = `\n  - 人际关系：` + rels.map((r: any) => `${r.targetName || r.target || "某人"}（${r.relation || r.type || "相关"}）`).join("，");
          }
        } catch {
          // ignore
        }
      }
      return `${idx + 1}. 【${c.name}】（${details}）${relStr}`;
    });
    parts.push(`【全书主要人物卡与关系设定】\n${charList.join("\n")}`);
  }


  // 3.1 角色最新动态账本（境界、位置、装备、伤病状态）
  const charStates = db
    .prepare("SELECT cs.*, c.name, c.role FROM character_states cs JOIN characters c ON cs.character_id = c.id WHERE cs.novel_id = ?")
    .all(novelId) as any[];
  if (charStates.length > 0) {
    const dynamicItems = charStates.map((cs) => {
      const parts = [
        cs.current_location ? `当前位置：${cs.current_location}` : "",
        cs.current_realm ? `当前修为/境界：${cs.current_realm}` : "",
        cs.inventory ? `关键道具/持有物：${cs.inventory}` : "",
        cs.status_effects ? `状态/伤病：${cs.status_effects}` : "",
        cs.notes ? `心境/最新动向：${cs.notes}` : "",
      ].filter(Boolean).join(" | ");
      return `- 【${cs.name}】（${cs.role || "配角"}）：${parts || "状态平稳"}`;
    });
    parts.push(`【📍 角色最新动态账本（连贯性核心）】\n${dynamicItems.join("\n")}`);
  }

  // 3.2 分卷核心冲突与故事里程碑
  const volumes = db
    .prepare("SELECT * FROM volumes WHERE novel_id = ? ORDER BY sort_order ASC, id ASC")
    .all(novelId) as any[];
  if (volumes.length > 0) {
    const volList = volumes.map((v, i) => `第 ${i + 1} 卷《${v.title}》：核心冲突【${v.core_conflict || "未设定"}】 | 卷大纲：${v.summary || "暂无"}`);
    parts.push(`【全书分卷主线与长篇里程碑】\n${volList.join("\n")}`);
  }

  // 4. 世界地理与势力格局设定（若有地图数据）
  const mapList = db.prepare("SELECT * FROM maps WHERE novel_id = ? ORDER BY id ASC").all(novelId) as any[];
  if (mapList.length > 0) {
    const mapSummaries: string[] = [];
    for (const m of mapList) {
      try {
        const data = typeof m.data === "string" ? JSON.parse(m.data) : m.data;
        const regions = (data?.regions || []).map((r: any) => r.name).filter(Boolean);
        const markers = (data?.markers || []).map((p: any) => `${p.name || p.title}${p.desc ? `(${p.desc})` : ""}`).filter(Boolean);
        const paths = (data?.paths || []).map((pth: any) => pth.name).filter(Boolean);
        const items = [];
        if (regions.length) items.push(`势力领地/区域：${regions.join("、")}`);
        if (markers.length) items.push(`重要名城关隘：${markers.join("、")}`);
        if (paths.length) items.push(`交通/山川要道：${paths.join("、")}`);
        if (items.length) {
          mapSummaries.push(`- 地图《${m.name}》：${items.join(" | ")}`);
        }
      } catch {
        // ignore
      }
    }
    if (mapSummaries.length > 0) {
      parts.push(`【世界地理与势力格局设定】\n${mapSummaries.join("\n")}`);
    }
  }

  // 5. 创作进度与伏笔记录
  const writerState = db.prepare("SELECT * FROM novel_writer_state WHERE novel_id = ?").get(novelId) as any;
  if (writerState) {
    const wsParts: string[] = [];
    if (writerState.progress && String(writerState.progress).trim()) {
      wsParts.push(`- 当前创作进度：${writerState.progress.trim()}`);
    }
    if (writerState.foreshadowing && String(writerState.foreshadowing).trim() && writerState.foreshadowing !== "[]") {
      wsParts.push(`- 伏笔记录与回收计划：${writerState.foreshadowing.trim()}`);
    }
    if (wsParts.length > 0) {
      parts.push(`【作者创作进度与伏笔清单】\n${wsParts.join("\n")}`);
    }
  }

  // 6. 全书所有章节检索、目录与每章细纲全景
  const allChapters = db
    .prepare("SELECT * FROM chapters WHERE novel_id = ? ORDER BY sort_order ASC, id ASC")
    .all(novelId) as any[];

  // 查找所有章节细纲，映射到各章节
  const allChapterOutlines = db
    .prepare("SELECT * FROM outlines WHERE novel_id = ? AND chapter_id IS NOT NULL ORDER BY sort_order ASC, id ASC")
    .all(novelId) as any[];
  const chapterOutlinesMap = new Map<number, Array<{ title: string; content: string }>>();
  for (const ot of allChapterOutlines) {
    const list = chapterOutlinesMap.get(ot.chapter_id) || [];
    list.push({ title: ot.title, content: ot.content });
    chapterOutlinesMap.set(ot.chapter_id, list);
  }


  // 查找所有章节微摘要（百万字前情提要链）
  const allSummaries = db
    .prepare("SELECT * FROM chapter_summaries WHERE novel_id = ?")
    .all(novelId) as any[];
  const summaryMap = new Map<number, any>();
  for (const sm of allSummaries) {
    summaryMap.set(sm.chapter_id, sm);
  }

  const activeChapterIndex = allChapters.findIndex((c) => c.id === Number(chapterId));
  const activeChapter = activeChapterIndex >= 0 ? allChapters[activeChapterIndex] : null;

  // 组装全书章节目录（带各章细纲概要）
  if (allChapters.length > 0) {
    const dirList = allChapters.map((ch, idx) => {
      const isCurrent = ch.id === Number(chapterId);
      const outlinesForCh = chapterOutlinesMap.get(ch.id) || [];
      const sm = summaryMap.get(ch.id);
      const summaryStr = sm?.summary ? ` [剧情提要: ${sm.summary}]` : "";
      const outlineStr =
        outlinesForCh.length > 0
          ? ` -> 细纲: ` + outlinesForCh.map((o) => (o.title ? `【${o.title}】` : "") + o.content).join("; ")
          : "";
      const currentMarker = isCurrent ? " 【👈 当前操作章节】" : "";
      return `第 ${idx + 1} 章：《${ch.title}》 [状态: ${ch.status || "草稿"} | ${ch.word_count || 0}字]${currentMarker}${summaryStr}${outlineStr}`;
    });
    parts.push(`【全书完整章节目录与剧情纲目总览（共 ${allChapters.length} 章）】\n${dirList.join("\n")}`);
  }

  // 7. 当前章节专属本章细纲
  if (activeChapter) {
    const currentOutlines = chapterOutlinesMap.get(activeChapter.id) || [];
    if (currentOutlines.length > 0) {
      parts.push(
        `【📍 本章（第 ${activeChapterIndex + 1} 章《${activeChapter.title}》）细纲深度要求】\n${currentOutlines
          .map((o, i) => `${i + 1}. 【${o.title || "情节要求"}】：${o.content}`)
          .join("\n")}`
      );
    }
  }

  // 8. 全书所有章节正文剧情回顾与脉络（让 AI 真正识别整本小说的所有章节内容）
  if (allChapters.length > 0) {
    const MAX_TOTAL_CHAPTER_CHARS = 120000;
    const chapterTexts: string[] = [];

    let totalChars = 0;
    for (const ch of allChapters) {
      totalChars += (ch.content || "").length;
    }

    if (totalChars <= MAX_TOTAL_CHAPTER_CHARS) {
      chapterTexts.push(`【整本小说所有章节正文全景回顾（已按章节顺序呈现）】\n`);
      for (let i = 0; i < allChapters.length; i++) {
        const ch = allChapters[i];
        const isCurrent = ch.id === Number(chapterId);
        const chContent = isCurrent && content !== undefined ? String(content) : ch.content || "";

        if (isCurrent) {
          chapterTexts.push(
            `\n============================================================\n📍 第 ${i + 1} 章：《${ch.title}》【👈 当前正在创作/编辑的章节】\n============================================================\n${chContent.trim() ? chContent.trim() : "（本章当前正文为空，待生成/待写作）"}\n`
          );
        } else {
          const prefix = i < (activeChapterIndex >= 0 ? activeChapterIndex : allChapters.length) ? "前序章节" : "后续章节";
          chapterTexts.push(
            `\n============================================================\n【${prefix}】第 ${i + 1} 章：《${ch.title}》（${ch.word_count || 0}字）\n============================================================\n${chContent.trim() ? chContent.trim() : "（正文暂空）"}\n`
          );
        }
      }
    } else {
      chapterTexts.push(`【整本小说章节正文脉络回顾（长篇全书智能聚焦）】\n`);
      const currentIdx = activeChapterIndex >= 0 ? activeChapterIndex : allChapters.length - 1;
      const fullTextWindowStart = Math.max(0, currentIdx - 8);
      const fullTextWindowEnd = Math.min(allChapters.length - 1, currentIdx + 3);

      for (let i = 0; i < allChapters.length; i++) {
        const ch = allChapters[i];
        const isCurrent = ch.id === Number(chapterId);
        const rawContent = isCurrent && content !== undefined ? String(content) : ch.content || "";
        const trimmed = rawContent.trim();

        if (isCurrent) {
          chapterTexts.push(
            `\n============================================================\n📍 第 ${i + 1} 章：《${ch.title}》【👈 当前正在创作/编辑的章节】\n============================================================\n${trimmed ? trimmed : "（本章当前正文为空，待生成/待写作）"}\n`
          );
        } else if (i >= fullTextWindowStart && i <= fullTextWindowEnd) {
          const prefix = i < currentIdx ? "前序章节" : "后续章节";
          chapterTexts.push(
            `\n============================================================\n【${prefix} · 全文】第 ${i + 1} 章：《${ch.title}》（${ch.word_count || 0}字）\n============================================================\n${trimmed ? trimmed : "（正文暂空）"}\n`
          );
        } else {
          let excerpt = "（正文暂空）";
          if (trimmed.length <= 1200) {
            excerpt = trimmed;
          } else {
            const head = trimmed.slice(0, 500);
            const tail = trimmed.slice(-500);
            excerpt = `${head}\n\n……（中间情节略去，共 ${trimmed.length} 字）……\n\n${tail}`;
          }
          chapterTexts.push(
            `\n============================================================\n【早期前序章节 · 脉络节选】第 ${i + 1} 章：《${ch.title}》（总字数: ${ch.word_count || 0}字）\n============================================================\n${excerpt}\n`
          );
        }
      }
    }
    parts.push(chapterTexts.join(""));
  }

  if (content && (!activeChapter || content !== activeChapter.content)) {
    if (String(content).length < 2000) {
      parts.push(`【作者当前选中的具体文本片段】\n${String(content)}`);
    }
  }
  if (extra && String(extra).trim()) {
    parts.push(`【补充要求 / 作者指令】\n${String(extra).trim()}`);
  }

  return parts.join("\n\n");
}

function resolveKey(req: Request, user: any): { key: string | null; source: string } {
  const bodyKey = req.body?.apiKey;
  if (bodyKey && typeof bodyKey === "string" && bodyKey.trim()) return { key: bodyKey.trim(), source: "body" };
  if (req.session.userApiKey) return { key: req.session.userApiKey, source: "session" };
  if (user.ai_api_key_enabled && user.ai_api_key_enc) {
    const dec = decryptKey(user.ai_api_key_enc, process.env.SESSION_SECRET || "x");
    if (dec) return { key: dec, source: "user-db" };
  }
  const station = getStationKey(user);
  if (station) return { key: station, source: "station" };
  return { key: null, source: "none" };
}

export type AiRuntimeConfig = {
  key: string;
  source: "body" | "session" | "user-db" | "station";
  baseUrl: string;
  protocol: "anthropic" | "openai";
  model: string;
};


// 解析蒸馏请求中的密钥
function resolveDistillKey(req: Request, user: any): { key: string | null; source: string } {
  const bodyKey = req.body?.apiKey;
  if (bodyKey && typeof bodyKey === "string" && bodyKey.trim()) return { key: bodyKey.trim(), source: "body" };
  if (req.session.distillApiKey) return { key: req.session.distillApiKey, source: "session" };
  if (user.distill_api_key_enabled && user.distill_api_key_enc) {
    const dec = decryptKey(user.distill_api_key_enc, process.env.SESSION_SECRET || "x");
    if (dec) return { key: dec, source: "user-db" };
  }
  const station = getStationKey(user);
  if (station) return { key: station, source: "station" };
  return { key: null, source: "none" };
}

export function resolveDistillRuntimeConfig(req: Request, user: any): AiRuntimeConfig | null {
  const resolved = resolveDistillKey(req, user);
  if (!resolved.key) return null;
  const isPersonal = resolved.source !== "station";
  if (!isPersonal) {
    const baseUrl = normalizeBaseUrl(BASE_URL || "https://api.anthropic.com");
    const protocol = BASE_URL.endsWith("/v1") ? "openai" : "anthropic";
    return { key: resolved.key, source: "station", baseUrl, protocol, model: MODEL };
  }
  const configuredBase = req.session.distillApiBaseUrl || user.distill_api_base_url;
  const configuredProtocol = validProtocol(req.session.distillApiProtocol || user.distill_api_protocol);
  const baseUrl = normalizeBaseUrl(configuredBase || "https://api.anthropic.com");
  const protocol = configuredProtocol === "auto" ? (configuredBase?.endsWith("/v1") ? "openai" : "anthropic") : configuredProtocol;
  const configuredModel = String(req.session.distillApiModel || user.distill_api_model || "").trim();
  const model = configuredModel || (protocol === "anthropic" ? "claude-opus-5" : MODEL);
  return { key: resolved.key, source: resolved.source as AiRuntimeConfig["source"], baseUrl, protocol, model };
}

// 解析设定库（角色与地图共用）密钥
function resolveWorldKey(req: Request, user: any): { key: string | null; source: string } {
  const bodyKey = req.body?.apiKey;
  if (bodyKey && typeof bodyKey === "string" && bodyKey.trim()) return { key: bodyKey.trim(), source: "body" };
  if (req.session.worldApiKey) return { key: req.session.worldApiKey, source: "session" };
  if (user.world_api_key_enabled && user.world_api_key_enc) {
    const dec = decryptKey(user.world_api_key_enc, process.env.SESSION_SECRET || "x");
    if (dec) return { key: dec, source: "user-db" };
  }
  // 未单独配置时，优雅回退到小说写作助手配置或站方配置
  if (req.session.userApiKey) return { key: req.session.userApiKey, source: "writer-session" };
  if (user.ai_api_key_enabled && user.ai_api_key_enc) {
    const dec = decryptKey(user.ai_api_key_enc, process.env.SESSION_SECRET || "x");
    if (dec) return { key: dec, source: "writer-db" };
  }
  const station = getStationKey(user);
  if (station) return { key: station, source: "station" };
  return { key: null, source: "none" };
}


// 解析 Agent 专用配置
function resolveAgentKey(req: Request, user: any): { key: string | null; source: string } {
  const bodyKey = req.body?.apiKey;
  if (bodyKey && typeof bodyKey === "string" && bodyKey.trim()) return { key: bodyKey.trim(), source: "body" };
  if (req.session.agentApiKey) return { key: req.session.agentApiKey, source: "session" };
  if (user.agent_api_key_enabled && user.agent_api_key_enc) {
    const dec = decryptKey(user.agent_api_key_enc, process.env.SESSION_SECRET || "x");
    if (dec) return { key: dec, source: "user-db" };
  }
  // 未单独配置时，回退到小说写作助手配置或站方配置
  if (req.session.userApiKey) return { key: req.session.userApiKey, source: "writer-session" };
  if (user.ai_api_key_enabled && user.ai_api_key_enc) {
    const dec = decryptKey(user.ai_api_key_enc, process.env.SESSION_SECRET || "x");
    if (dec) return { key: dec, source: "writer-db" };
  }
  const station = getStationKey(user);
  if (station) return { key: station, source: "station" };
  return { key: null, source: "none" };
}

export function resolveAgentRuntimeConfig(req: Request, user: any): AiRuntimeConfig | null {
  const resolved = resolveAgentKey(req, user);
  if (!resolved.key) return null;
  if (resolved.source === "station") {
    const baseUrl = normalizeBaseUrl(BASE_URL || "https://api.anthropic.com");
    const protocol = BASE_URL.endsWith("/v1") ? "openai" : "anthropic";
    return { key: resolved.key, source: "station", baseUrl, protocol, model: MODEL };
  }
  if (resolved.source === "writer-session" || resolved.source === "writer-db") {
    const configuredBase = req.session.userApiBaseUrl || user.ai_api_base_url;
    const configuredProtocol = validProtocol(req.session.userApiProtocol || user.ai_api_protocol);
    const baseUrl = normalizeBaseUrl(configuredBase || "https://api.anthropic.com");
    const protocol = configuredProtocol === "auto" ? (configuredBase?.endsWith("/v1") ? "openai" : "anthropic") : configuredProtocol;
    const configuredModel = String(req.session.userApiModel || user.ai_api_model || "").trim();
    const model = configuredModel || (protocol === "anthropic" ? "claude-opus-5" : MODEL);
    return { key: resolved.key, source: resolved.source === "writer-session" ? "session" : "user-db", baseUrl, protocol, model };
  }
  const configuredBase = req.session.agentApiBaseUrl || user.agent_api_base_url;
  const configuredProtocol = validProtocol(req.session.agentApiProtocol || user.agent_api_protocol);
  const baseUrl = normalizeBaseUrl(configuredBase || "https://api.anthropic.com");
  const protocol = configuredProtocol === "auto" ? (configuredBase?.endsWith("/v1") ? "openai" : "anthropic") : configuredProtocol;
  const configuredModel = String(req.session.agentApiModel || user.agent_api_model || "").trim();
  const model = configuredModel || (protocol === "anthropic" ? "claude-opus-5" : MODEL);
  return { key: resolved.key, source: resolved.source as AiRuntimeConfig["source"], baseUrl, protocol, model };
}

export function resolveWorldRuntimeConfig(req: Request, user: any): AiRuntimeConfig | null {
  const resolved = resolveWorldKey(req, user);
  if (!resolved.key) return null;
  if (resolved.source === "station") {
    const baseUrl = normalizeBaseUrl(BASE_URL || "https://api.anthropic.com");
    const protocol = BASE_URL.endsWith("/v1") ? "openai" : "anthropic";
    return { key: resolved.key, source: "station", baseUrl, protocol, model: MODEL };
  }
  if (resolved.source === "writer-session" || resolved.source === "writer-db") {
    const configuredBase = req.session.userApiBaseUrl || user.ai_api_base_url;
    const configuredProtocol = validProtocol(req.session.userApiProtocol || user.ai_api_protocol);
    const baseUrl = normalizeBaseUrl(configuredBase || "https://api.anthropic.com");
    const protocol = configuredProtocol === "auto" ? (configuredBase?.endsWith("/v1") ? "openai" : "anthropic") : configuredProtocol;
    const configuredModel = String(req.session.userApiModel || user.ai_api_model || "").trim();
    const model = configuredModel || (protocol === "anthropic" ? "claude-opus-5" : MODEL);
    return { key: resolved.key, source: resolved.source === "writer-session" ? "session" : "user-db", baseUrl, protocol, model };
  }
  const configuredBase = req.session.worldApiBaseUrl || user.world_api_base_url;
  const configuredProtocol = validProtocol(req.session.worldApiProtocol || user.world_api_protocol);
  const baseUrl = normalizeBaseUrl(configuredBase || "https://api.anthropic.com");
  const protocol = configuredProtocol === "auto" ? (configuredBase?.endsWith("/v1") ? "openai" : "anthropic") : configuredProtocol;
  const configuredModel = String(req.session.worldApiModel || user.world_api_model || "").trim();
  const model = configuredModel || (protocol === "anthropic" ? "claude-opus-5" : MODEL);
  return { key: resolved.key, source: resolved.source as AiRuntimeConfig["source"], baseUrl, protocol, model };
}

export function resolveRuntimeConfig(req: Request, user: any): AiRuntimeConfig | null {
  const resolved = resolveKey(req, user);
  if (!resolved.key) return null;
  const isPersonal = resolved.source !== "station";
  if (!isPersonal) {
    const baseUrl = normalizeBaseUrl(BASE_URL || "https://api.anthropic.com");
    const protocol = BASE_URL.endsWith("/v1") ? "openai" : "anthropic";
    return { key: resolved.key, source: "station", baseUrl, protocol, model: MODEL };
  }
  const configuredBase = req.session.userApiBaseUrl || user.ai_api_base_url;
  const configuredProtocol = validProtocol(req.session.userApiProtocol || user.ai_api_protocol);
  const baseUrl = normalizeBaseUrl(configuredBase || "https://api.anthropic.com");
  const protocol = configuredProtocol === "auto" ? (configuredBase?.endsWith("/v1") ? "openai" : "anthropic") : configuredProtocol;
  const configuredModel = String(req.session.userApiModel || user.ai_api_model || "").trim();
  const model = configuredModel || (protocol === "anthropic" ? "claude-opus-5" : MODEL);
  return { key: resolved.key, source: resolved.source as AiRuntimeConfig["source"], baseUrl, protocol, model };
}

function ensureChapterAccess(req: Request, user: any): any {
  const novelId = Number(req.body?.novelId);
  const chapterId = Number(req.body?.chapterId);
  const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as any;
  if (!chapter || !Number.isInteger(novelId) || chapter.novel_id !== novelId) throw Object.assign(new Error("章节与作品不匹配"), { status: 400 });
  const novel = db.prepare("SELECT user_id FROM novels WHERE id = ?").get(novelId) as { user_id: number } | undefined;
  if (!novel || (novel.user_id !== user.id && user.role !== "admin")) throw Object.assign(new Error("无权操作该章节"), { status: 403 });
  return chapter;
}

// ---- AI
function stationLimitOk(userId: number): boolean {
  if (STATION_KEY && process.env.AI_DAILY_LIMIT) {
    const day = new Date().toISOString().slice(0, 10);
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_usage (user_id INTEGER, day TEXT, count INTEGER DEFAULT 1, PRIMARY KEY(user_id, day))`).run();
    const usage = db.prepare("SELECT count FROM ai_usage WHERE user_id = ? AND day = ?").get(userId, day) as any;
    const used = usage ? usage.count : 0;
    if (used >= DAILY_LIMIT) return false;
    db.prepare("INSERT INTO ai_usage (user_id, day, count) VALUES (?,?,1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1").run(userId, day);
  }
  return true;
}

function sseSend(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part: any) => typeof part === "string" ? part : (part?.type === "text" && typeof part.text === "string" ? part.text : "")).join("");
}

// 流式调用：Anthropic 原生 或 OpenAI /v1 兼容协议，统一输出 {type:"delta"|"done"|"error"}
export async function streamChat(opts: {
  key: string;
  system: string;
  userPrompt: string;
  maxTokens: number;
  protocol: "anthropic" | "openai";
  baseUrl: string;
  model: string;
  onDelta: (text: string) => void;
  signal?: AbortSignal;
}) {
  const { key, system, userPrompt, maxTokens, onDelta, signal, protocol, baseUrl, model } = opts;

  if (protocol === "openai") {
    const url = `${baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        detail = j?.error?.message || j?.message || detail;
      } catch {
        /* ignore */
      }
      const e = new Error(detail) as any;
      e.status = res.status;
      throw e;
    }
    const contentType = res.headers.get("content-type") || "";
    if (!res.body) throw new Error("上游未返回响应内容");
    if (contentType.includes("application/json")) {
      const body: any = await res.json();
      const text = extractTextContent(body?.choices?.[0]?.message?.content) || extractTextContent(body?.choices?.[0]?.delta?.content);
      if (text) onDelta(text);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const parseOpenAiLine = (line: string): boolean => {
      const t = line.trim();
      if (!t.startsWith("data:")) return false;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") return true;
      try {
        const j = JSON.parse(payload);
        const choice = j?.choices?.[0];
        const text = extractTextContent(choice?.delta?.content) || extractTextContent(choice?.message?.content);
        if (text) onDelta(text);
      } catch {
        /* skip malformed upstream frame */
      }
      return false;
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) if (parseOpenAiLine(line)) return;
    }
    buf += decoder.decode();
    if (buf.trim()) parseOpenAiLine(buf);
    return;
  }

  // Anthropic 原生协议
  const url = `${baseUrl}${baseUrl.endsWith("/v1") ? "" : "/v1"}/messages`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      system,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      detail = j?.error?.message || j?.message || detail;
    } catch {
      /* ignore */
    }
    const e = new Error(detail) as any;
    e.status = res.status;
    throw e;
  }
  const contentType = res.headers.get("content-type") || "";
  if (!res.body) throw new Error("上游未返回响应内容");
  if (contentType.includes("application/json")) {
    const body: any = await res.json();
    const text = extractTextContent(body?.content);
    if (text) onDelta(text);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const parseAnthropicLine = (line: string) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    try {
      const j = JSON.parse(t.slice(5).trim());
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) onDelta(j.delta.text);
    } catch {
      /* skip malformed upstream frame */
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) parseAnthropicLine(line);
  }
  buf += decoder.decode();
  if (buf.trim()) parseAnthropicLine(buf);
}

// 带工具的对话：一次性发出完整请求，返回 {text, toolCalls, stop_reason}（不流式中间 token）。
// Agent 循环会多次调用，每次把工具结果回填到 messages。
export async function chatWithTools(opts: {
  key: string;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: any }>;
  tools: Array<{ name: string; description: string; inputSchema: any }>;
  maxTokens: number;
  protocol: "anthropic" | "openai";
  baseUrl: string;
  model: string;
  signal?: AbortSignal;
}): Promise<{ text: string; toolCalls: Array<{ id?: string; name: string; args: any }>; stopReason: string }> {
  const { key, system, messages, tools, maxTokens, protocol, baseUrl, model, signal } = opts;
  const toolCalls: Array<{ id?: string; name: string; args: any }> = [];
  let text = "";

  if (protocol === "openai") {
    const url = `${baseUrl}/chat/completions`;
    const oaTools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: "object", properties: {} } },
    }));
    // 核心修复：精准将 Anthropic 格式的历史消息映射为标准 OpenAI ChatCompletion 协议
    const oaMessages: any[] = [{ role: "system", content: system }];

    for (const m of messages) {
      if (m.role === "assistant") {
        if (Array.isArray(m.content)) {
          let textContent = "";
          const toolCalls: any[] = [];
          for (const b of m.content) {
            if (b.type === "text" && typeof b.text === "string") {
              textContent += b.text;
            } else if (b.type === "tool_use") {
              toolCalls.push({
                id: b.id,
                type: "function",
                function: {
                  name: b.name,
                  arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input || {}),
                },
              });
            }
          }
          const msgObj: any = { role: "assistant", content: textContent || null };
          if (toolCalls.length > 0) msgObj.tool_calls = toolCalls;
          oaMessages.push(msgObj);
        } else {
          oaMessages.push({ role: "assistant", content: String(m.content || "") });
        }
      } else if (m.role === "user") {
        if (Array.isArray(m.content) && m.content.some((b: any) => b.type === "tool_result")) {
          // 工具结果转换为 OpenAI 标准的 role: "tool" 消息序列
          for (const b of m.content) {
            if (b.type === "tool_result") {
              oaMessages.push({
                role: "tool",
                tool_call_id: b.tool_use_id,
                content: typeof b.content === "string" ? b.content : JSON.stringify(b.content || ""),
              });
            } else if (b.type === "text") {
              oaMessages.push({ role: "user", content: b.text });
            }
          }
        } else {
          oaMessages.push({
            role: "user",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          });
        }
      } else {
        oaMessages.push({ role: m.role, content: String(m.content) });
      }
    }
    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: oaMessages, tools: oaTools, tool_choice: "auto" }),
    });
    if (!res.ok) {
      const e: any = new Error(`HTTP ${res.status}`); e.status = res.status; throw e;
    }
    const body: any = await res.json();
    const choice = body?.choices?.[0];
    text = extractTextContent(choice?.message?.content);
    const calls = choice?.message?.tool_calls || [];
    for (const c of calls) {
      let parsed: any = {};
      try { parsed = JSON.parse(c.function.arguments || "{}"); } catch { parsed = {}; }
      toolCalls.push({ id: c.id, name: c.function.name, args: parsed });
    }
    return { text, toolCalls, stopReason: choice?.finish_reason || "unknown" };
  }

  // Anthropic 原生协议（一次性请求 + tools）
  const url = `${baseUrl}${baseUrl.endsWith("/v1") ? "" : "/v1"}/messages`;
  const antTools = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema || { type: "object", properties: {} },
  }));
  const antMessages = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content
        : [{ type: "text", text: String(m.content) }],
  }));
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, tools: antTools, messages: antMessages }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const j = await res.json(); detail = j?.error?.message || j?.message || detail; } catch { /* ignore */ }
    const e: any = new Error(detail); e.status = res.status; throw e;
  }
  const body: any = await res.json();
  const blocks: any[] = body?.content || [];
  for (const b of blocks) {
    if (b.type === "text" && typeof b.text === "string") text += b.text;
    else if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, args: b.input || {} });
  }
  return { text, toolCalls, stopReason: body?.stop_reason || "unknown" };
}

export function formatAiError(
  err: any,
  ctx?: { baseUrl?: string; protocol?: string; model?: string; moduleName?: string }
): string {
  const modulePrefix = ctx?.moduleName ? `【${ctx.moduleName}】` : "";
  const status =
    err?.status ||
    (typeof err?.message === "string" && err.message.match(/HTTP\s+(\d+)/)?.[1]
      ? Number(err.message.match(/HTTP\s+(\d+)/)[1])
      : undefined);
  const rawMsg = err?.message || String(err || "未知错误");

  // 1. 网络连接与超时错误
  if (
    rawMsg.includes("fetch failed") ||
    rawMsg.includes("ECONNREFUSED") ||
    rawMsg.includes("ENOTFOUND") ||
    rawMsg.includes("ETIMEDOUT") ||
    rawMsg.includes("UND_ERR_CONNECT_TIMEOUT") ||
    rawMsg.includes("ConnectTimeoutError")
  ) {
    const target = ctx?.baseUrl || "API Base URL";
    return `${modulePrefix}无法连接到 AI 服务地址（${target}）。排查建议：\n1. 如果使用的是 CC-Switch 等本地代理，请确认该代理软件已在后台启动并正常监听对应端口；\n2. 如果使用的是公网服务商，请检查网络连接与 Base URL 是否正确无误；\n3. 前往「设置」核对 API Base URL。`;
  }

  // 2. 401 / 403 认证错误
  if (
    status === 401 ||
    status === 403 ||
    rawMsg.includes("401") ||
    rawMsg.includes("403") ||
    rawMsg.includes("unauthorized") ||
    rawMsg.includes("Invalid API key") ||
    rawMsg.includes("authentication_error") ||
    rawMsg.includes("permission_denied")
  ) {
    return `${modulePrefix}API 认证失败（HTTP ${status || "401/403"}）：密钥无效、过期或权限不足。排查建议：\n1. 前往「设置」重新检查并填入正确的 API Key / 令牌；\n2. 确认您的服务商账号余额充足且 API 权限已开通；\n3. 检查协议选择（Anthropic 原生 vs OpenAI 兼容）是否与该 Key 匹配。`;
  }

  // 3. 404 路径错误
  if (status === 404 || rawMsg.includes("404") || rawMsg.includes("Not Found")) {
    return `${modulePrefix}接口地址不存在（HTTP 404）。排查建议：\n1. 请检查「设置」中的 API Base URL，必须填写实际 API 接口地址（如 http://127.0.0.1:15721/v1），切勿填写 https://ccswitch.io/ 官网地址；\n2. 确认 Base URL 末尾是否需要带 /v1，并核对协议选择是否正确。`;
  }

  // 4. 429 限流或额度耗尽
  if (
    status === 429 ||
    rawMsg.includes("429") ||
    rawMsg.includes("rate_limit") ||
    rawMsg.includes("insufficient_quota") ||
    rawMsg.includes("quota")
  ) {
    return `${modulePrefix}AI 请求触发限流或额度已用尽（HTTP 429）。排查建议：\n1. 上游服务商每分钟调用频次超限，请稍等 1-2 分钟后再试；\n2. 检查服务商账户额度是否已耗尽；\n3. 前往「设置」更换备用 API Key 或切换其他服务商。`;
  }

  // 5. 400 参数与模型错误
  if (
    status === 400 ||
    rawMsg.includes("400") ||
    rawMsg.includes("model_not_found") ||
    rawMsg.includes("does not exist") ||
    rawMsg.includes("context_length_exceeded") ||
    rawMsg.includes("invalid_request_error")
  ) {
    return `${modulePrefix}请求参数或模型配置错误（HTTP 400）：${rawMsg}。排查建议：\n1. 前往「设置」核对模型名称（当前配置: ${ctx?.model || "未设置"}）是否为上游服务商支持的确切模型标识；\n2. 检查协议选择（当前配置: ${ctx?.protocol || "自动"}）是否与模型相符；\n3. 若提示上下文超长，建议减小单次分析的材料章节量。`;
  }

  // 6. 500+ 服务端错误
  if (status && status >= 500) {
    return `${modulePrefix}上游服务商服务异常（HTTP ${status}）：${rawMsg}。排查建议：服务商或网关正在维护或暂时不可用，请稍后重试或在「设置」中切换其他模型/网关。`;
  }

  return `${modulePrefix}${rawMsg}`;
}

router.post("/run", async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  let chapter: any;
  try {
    chapter = ensureChapterAccess(req, user);
  } catch (err: any) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const role = (req.body?.role || "draft") as Role;
  if (!(role in SYSTEM_PROMPTS)) return res.status(400).json({ error: "未知能力" });
  const runtime = resolveRuntimeConfig(req, user);
  if (!runtime) {
    return res.status(400).json({ error: "未配置小说写作助手 API 密钥：请在「设置」->「小说写作助手」中填写完整的 API 配置，或联系管理员启用站方配置" });
  }
  if (runtime.source === "station" && !stationLimitOk(user.id)) {
    return res.status(429).json({ error: `站方密钥今日限额（${DAILY_LIMIT} 次）已用完，请在「设置」中填写个人 API Key` });
  }

  const context = buildContext(req);
  const userPrompt = req.body?.prompt || "";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  let generated = "";

  // 获取用户自定义提示词（若未自定义则使用系统预设）
  let customPrompts: Record<string, string> = {};
  try {
    const row = db.prepare("SELECT ai_custom_prompts FROM users WHERE id = ?").get(user.id) as any;
    if (row?.ai_custom_prompts) {
      customPrompts = JSON.parse(row.ai_custom_prompts);
    }
  } catch {}

  const activeSystemPrompt = req.body?.customSystemPrompt || customPrompts[role] || SYSTEM_PROMPTS[role];

  // 注入用户自定义 Skill（按 scope=writer 过滤）
  let skillBlock = "";
  try {
    skillBlock = buildSkillInjection(user.id, "writer");
  } catch {
    /* ignore */
  }
  const finalSystemPrompt = skillBlock ? activeSystemPrompt + "\n\n" + skillBlock : activeSystemPrompt;

  try {
    await streamChat({
      key: runtime.key,
      system: finalSystemPrompt,
      userPrompt: context ? `${context}\n\n---\n\n${userPrompt}` : userPrompt,
      maxTokens: TOKEN_LIMIT[role],
      protocol: runtime.protocol,
      baseUrl: runtime.baseUrl,
      model: runtime.model,
      signal: ac.signal,
      onDelta: (text) => {
        generated += text;
        sseSend(res, { type: "delta", text });
      },
    });

    if (!generated.trim()) {
      throw Object.assign(new Error("上游 AI 请求已结束，但没有返回可显示的正文。请检查 API Key、Base URL、协议和模型是否匹配。"), { status: 502 });
    }

    // 正文类任务：写回章节（draft/continue 覆盖；polish/expand 在原文基础上替换）
    const bodyRoles = ["draft", "continue", "polish", "expand"];
    const wantSave = req.body?.save !== false && (req.body?.save === true || (bodyRoles.includes(role) && !!req.body?.chapterId));
    if (wantSave && generated && req.body?.chapterId) {
      const chapterId = Number(req.body.chapterId);
      const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as any;
      if (chapter) {
        const { countChineseChars, saveChapterRevision } = await import("../db.js");
        // 自动备份旧正文（若有旧内容）
        if (chapter.content && chapter.content.trim()) {
          const reasonMap: Record<string, string> = {
            draft: "AI生成正文前备份",
            continue: "AI续写前备份",
            polish: "AI润色前备份",
            expand: "AI扩写前备份",
          };
          saveChapterRevision(chapterId, reasonMap[role] || "AI生成前备份", chapter.content, chapter.title);
        }
        const newContent = generated;
        db.prepare("UPDATE chapters SET content = ?, word_count = ?, updated_at = datetime('now') WHERE id = ?").run(
          newContent,
          countChineseChars(newContent),
          chapterId
        );
        // 重算小说总字数
        const { touchNovel } = await import("../db.js");
        touchNovel(chapter.novel_id);
        sseSend(res, { type: "saved", chapterId });
      }
    }
    sseSend(res, { type: "done" });
    res.end();
  } catch (err: any) {
    if (ac.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    const formatted = formatAiError(err, {
      baseUrl: runtime.baseUrl,
      protocol: runtime.protocol,
      model: runtime.model,
      moduleName: "小说写作助手",
    });
    if (!res.writableEnded) {
      sseSend(res, { type: "error", error: formatted });
      res.end();
    }
  }
});

// 用户设置中的密钥管理
router.get("/settings", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });

  const station = getStationKey(user);

  // 写作助手配置
  let writerSource = "none";
  if (req.session.userApiKey) writerSource = "session";
  else if (user.ai_api_key_enabled) writerSource = "user-db";
  else if (station) writerSource = "station";

  // 蒸馏作者配置
  let distillSource = "none";
  if (req.session.distillApiKey) distillSource = "session";
  else if (user.distill_api_key_enabled) distillSource = "user-db";
  else if (station) distillSource = "station";


  // 管家 Agent 专用配置
  let agentSource = "none";
  if (req.session.agentApiKey) agentSource = "session";
  else if (user.agent_api_key_enabled) agentSource = "user-db";
  else if (req.session.userApiKey) agentSource = "writer-session";
  else if (user.ai_api_key_enabled) agentSource = "writer-db";
  else if (station) agentSource = "station";

  const agentConfig = {
    keyConfigured: agentSource !== "none",
    keySource: agentSource,
    baseUrl: req.session.agentApiBaseUrl || user.agent_api_base_url || null,
    protocol: validProtocol(req.session.agentApiProtocol || user.agent_api_protocol),
    model: req.session.agentApiModel || user.agent_api_model || null,
    isSeparate: !!(req.session.agentApiKey || user.agent_api_key_enabled || req.session.agentApiBaseUrl || user.agent_api_base_url || req.session.agentApiModel || user.agent_api_model),
  };

  // 设定库（角色与地图）配置
  let worldSource = "none";
  if (req.session.worldApiKey) worldSource = "session";
  else if (user.world_api_key_enabled) worldSource = "user-db";
  else if (req.session.userApiKey) worldSource = "writer-session";
  else if (user.ai_api_key_enabled) worldSource = "writer-db";
  else if (station) worldSource = "station";

  const writerConfig = {
    keyConfigured: writerSource !== "none",
    keySource: writerSource,
    baseUrl: req.session.userApiBaseUrl || user.ai_api_base_url || null,
    protocol: validProtocol(req.session.userApiProtocol || user.ai_api_protocol),
    model: req.session.userApiModel || user.ai_api_model || null,
  };

  const distillConfig = {
    keyConfigured: distillSource !== "none",
    keySource: distillSource,
    baseUrl: req.session.distillApiBaseUrl || user.distill_api_base_url || null,
    protocol: validProtocol(req.session.distillApiProtocol || user.distill_api_protocol),
    model: req.session.distillApiModel || user.distill_api_model || null,
  };

  const worldConfig = {
    keyConfigured: worldSource !== "none",
    keySource: worldSource,
    isDedicated: !!(req.session.worldApiKey || user.world_api_key_enabled),
    baseUrl: req.session.worldApiBaseUrl || user.world_api_base_url || null,
    protocol: validProtocol(req.session.worldApiProtocol || user.world_api_protocol),
    model: req.session.worldApiModel || user.world_api_model || null,
  };

  res.json({
    writer: writerConfig,
    distill: distillConfig,
    world: worldConfig,
    stationConfigured: !!station,
    // 向后兼容旧前端字段
    keyConfigured: writerConfig.keyConfigured,
    keySource: writerConfig.keySource,
    baseUrl: writerConfig.baseUrl,
    protocol: writerConfig.protocol,
    model: writerConfig.model,
  });
});


// 单独配置管家 Agent 专属 API Key 与端点
router.post("/settings/agent-key", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { apiKey, mode, baseUrl, protocol, model } = req.body || {};
  const station = getStationKey(user);

  if (mode === "session") {
    if (apiKey && String(apiKey).trim()) req.session.agentApiKey = String(apiKey).trim();
    if (baseUrl !== undefined) req.session.agentApiBaseUrl = baseUrl ? normalizeBaseUrl(String(baseUrl)) : undefined;
    if (protocol !== undefined) req.session.agentApiProtocol = validProtocol(protocol);
    if (model !== undefined) req.session.agentApiModel = model ? String(model).trim() : undefined;
    if (!req.session.agentApiKey && !user.agent_api_key_enabled && !station && !req.session.userApiKey && !user.ai_api_key_enabled) {
      return res.status(400).json({ error: "请填写管家 Agent 专用 API Key" });
    }
    return res.json({ ok: true, source: req.session.agentApiKey ? "session" : (station ? "station" : "none") });
  }
  if (mode === "persist") {
    const hasNewKey = apiKey && String(apiKey).trim();
    if (!hasNewKey && !user.agent_api_key_enabled && !station && !req.session.userApiKey && !user.ai_api_key_enabled) {
      return res.status(400).json({ error: "请填写管家 Agent 专用 API Key" });
    }
    const enc = (hasNewKey ? encryptKeyDb(String(apiKey).trim()) : user.agent_api_key_enc) ?? null;
    const normalizedBase = (baseUrl === undefined ? user.agent_api_base_url : (baseUrl ? normalizeBaseUrl(String(baseUrl)) : null)) ?? null;
    const normalizedProtocol = protocol === undefined ? validProtocol(user.agent_api_protocol) : validProtocol(protocol);
    const normalizedModel = (model === undefined ? user.agent_api_model : (model ? String(model).trim() : null)) ?? null;
    db.prepare("UPDATE users SET agent_api_key_enc = ?, agent_api_key_enabled = ?, agent_api_base_url = ?, agent_api_protocol = ?, agent_api_model = ? WHERE id = ?").run(
      enc,
      hasNewKey ? 1 : (user.agent_api_key_enabled ? 1 : 0),
      normalizedBase,
      normalizedProtocol,
      normalizedModel,
      user.id
    );
    return res.json({ ok: true, source: hasNewKey ? "user-db" : (user.agent_api_key_enabled ? "user-db" : (station ? "station" : "none")) });
  }
  if (mode === "clear") {
    req.session.agentApiKey = undefined;
    req.session.agentApiBaseUrl = undefined;
    req.session.agentApiProtocol = undefined;
    req.session.agentApiModel = undefined;
    db.prepare("UPDATE users SET agent_api_key_enabled = 0, agent_api_key_enc = NULL, agent_api_base_url = NULL, agent_api_protocol = 'auto', agent_api_model = NULL WHERE id = ?").run(user.id);
    return res.json({ ok: true, source: "none" });
  }
  return res.status(400).json({ error: "未知的 mode" });
});

router.post("/settings/world-key", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { apiKey, mode, baseUrl, protocol, model } = req.body || {};
  const station = getStationKey(user);

  if (mode === "session") {
    if (apiKey && String(apiKey).trim()) req.session.worldApiKey = String(apiKey).trim();
    if (baseUrl !== undefined) req.session.worldApiBaseUrl = baseUrl ? normalizeBaseUrl(String(baseUrl)) : undefined;
    if (protocol !== undefined) req.session.worldApiProtocol = validProtocol(protocol);
    if (model !== undefined) req.session.worldApiModel = model ? String(model).trim() : undefined;
    if (!req.session.worldApiKey && !user.world_api_key_enabled && !station && !req.session.userApiKey && !user.ai_api_key_enabled) {
      return res.status(400).json({ error: "请填写角色与地图专用 API Key" });
    }
    return res.json({ ok: true, source: req.session.worldApiKey ? "session" : (station ? "station" : "none") });
  }
  if (mode === "persist") {
    const hasNewKey = apiKey && String(apiKey).trim();
    if (!hasNewKey && !user.world_api_key_enabled && !station && !req.session.userApiKey && !user.ai_api_key_enabled) {
      return res.status(400).json({ error: "请填写角色与地图专用 API Key" });
    }
    const enc = (hasNewKey ? encryptKeyDb(String(apiKey).trim()) : user.world_api_key_enc) ?? null;
    const normalizedBase = (baseUrl === undefined ? user.world_api_base_url : (baseUrl ? normalizeBaseUrl(String(baseUrl)) : null)) ?? null;
    const normalizedProtocol = protocol === undefined ? validProtocol(user.world_api_protocol) : validProtocol(protocol);
    const normalizedModel = (model === undefined ? user.world_api_model : (model ? String(model).trim() : null)) ?? null;
    db.prepare("UPDATE users SET world_api_key_enc = ?, world_api_key_enabled = ?, world_api_base_url = ?, world_api_protocol = ?, world_api_model = ? WHERE id = ?").run(
      enc,
      hasNewKey ? 1 : (user.world_api_key_enabled ? 1 : 0),
      normalizedBase,
      normalizedProtocol,
      normalizedModel,
      user.id
    );
    return res.json({ ok: true, source: hasNewKey ? "user-db" : (user.world_api_key_enabled ? "user-db" : (station ? "station" : "none")) });
  }
  if (mode === "clear") {
    req.session.worldApiKey = undefined;
    req.session.worldApiBaseUrl = undefined;
    req.session.worldApiProtocol = undefined;
    req.session.worldApiModel = undefined;
    db.prepare("UPDATE users SET world_api_key_enabled = 0, world_api_key_enc = NULL, world_api_base_url = NULL, world_api_protocol = 'auto', world_api_model = NULL WHERE id = ?").run(user.id);
    return res.json({ ok: true, source: "none" });
  }
  res.status(400).json({ error: "未知模式" });
});

router.post("/settings/distill-key", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { apiKey, mode, baseUrl, protocol, model } = req.body || {};
  const station = getStationKey(user);

  if (mode === "session") {
    if (apiKey && String(apiKey).trim()) req.session.distillApiKey = String(apiKey).trim();
    if (baseUrl !== undefined) req.session.distillApiBaseUrl = baseUrl ? normalizeBaseUrl(String(baseUrl)) : undefined;
    if (protocol !== undefined) req.session.distillApiProtocol = validProtocol(protocol);
    if (model !== undefined) req.session.distillApiModel = model ? String(model).trim() : undefined;
    if (!req.session.distillApiKey && !user.distill_api_key_enabled && !station) return res.status(400).json({ error: "请填写蒸馏专用 API Key" });
    return res.json({ ok: true, source: req.session.distillApiKey ? "session" : (station ? "station" : "none") });
  }
  if (mode === "persist") {
    const hasNewKey = apiKey && String(apiKey).trim();
    if (!hasNewKey && !user.distill_api_key_enabled && !station) return res.status(400).json({ error: "请填写蒸馏专用 API Key" });
    const enc = (hasNewKey ? encryptKeyDb(String(apiKey).trim()) : user.distill_api_key_enc) ?? null;
    const normalizedBase = (baseUrl === undefined ? user.distill_api_base_url : (baseUrl ? normalizeBaseUrl(String(baseUrl)) : null)) ?? null;
    const normalizedProtocol = protocol === undefined ? validProtocol(user.distill_api_protocol) : validProtocol(protocol);
    const normalizedModel = (model === undefined ? user.distill_api_model : (model ? String(model).trim() : null)) ?? null;
    db.prepare("UPDATE users SET distill_api_key_enc = ?, distill_api_key_enabled = ?, distill_api_base_url = ?, distill_api_protocol = ?, distill_api_model = ? WHERE id = ?").run(
      enc,
      hasNewKey ? 1 : (user.distill_api_key_enabled ? 1 : 0),
      normalizedBase,
      normalizedProtocol,
      normalizedModel,
      user.id
    );
    return res.json({ ok: true, source: hasNewKey ? "user-db" : (user.distill_api_key_enabled ? "user-db" : (station ? "station" : "none")) });
  }
  if (mode === "clear") {
    req.session.distillApiKey = undefined;
    req.session.distillApiBaseUrl = undefined;
    req.session.distillApiProtocol = undefined;
    req.session.distillApiModel = undefined;
    db.prepare("UPDATE users SET distill_api_key_enabled = 0, distill_api_key_enc = NULL, distill_api_base_url = NULL, distill_api_protocol = 'auto', distill_api_model = NULL WHERE id = ?").run(user.id);
    return res.json({ ok: true, source: "none" });
  }
  res.status(400).json({ error: "未知模式" });
});


// 测试自定义 API 端点的 Tool-Calling (Function Calling) 兼容性
router.post("/test-tools", async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });

  const { target } = req.body || {}; // 'writer' | 'agent' | 'custom'
  let key: string | null = null;
  let baseUrl: string = "";
  let protocol: "anthropic" | "openai" = "openai";
  let model: string = "";

  if (target === "agent") {
    const rt = resolveAgentRuntimeConfig(req, user);
    if (!rt) return res.status(400).json({ error: "未配置 Agent 运行时密钥或端点" });
    key = rt.key; baseUrl = rt.baseUrl; protocol = rt.protocol; model = rt.model;
  } else if (target === "custom") {
    const { apiKey, customBaseUrl, customProtocol, customModel } = req.body;
    key = apiKey || "";
    baseUrl = normalizeBaseUrl(customBaseUrl || "");
    protocol = customProtocol === "anthropic" ? "anthropic" : "openai";
    model = customModel || "";
  } else {
    const rt = resolveRuntimeConfig(req, user);
    if (!rt) return res.status(400).json({ error: "未配置写作助手运行时密钥或端点" });
    key = rt.key; baseUrl = rt.baseUrl; protocol = rt.protocol; model = rt.model;
  }

  if (!key) return res.status(400).json({ error: "缺少 API Key" });

  try {
    const testTool = {
      name: "probe_connection",
      description: "测试端点工具调用功能的探针工具",
      inputSchema: {
        type: "object",
        properties: {
          echo: { type: "string", description: "回显内容" }
        },
        required: ["echo"]
      }
    };

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 15000);

    const result = await chatWithTools({
      key,
      baseUrl,
      protocol,
      model,
      system: "你是一个连通性测试助手。请必须调用一次 probe_connection 工具，参数 echo 填 'connected'。",
      messages: [{ role: "user", content: "请执行探针工具 probe_connection。" }],
      tools: [testTool],
      maxTokens: 500,
      signal: ac.signal
    });
    clearTimeout(timeout);

    const toolCalled = result.toolCalls && result.toolCalls.some(t => t.name === "probe_connection");
    res.json({
      ok: true,
      toolCallingSupported: toolCalled,
      message: toolCalled
        ? "端点 " + baseUrl + " 成功响应并支持 Tool Calling（模型: " + model + "）"
        : "端点 " + baseUrl + " 返回了普通文本，但未触发 Tool Calling。请确认模型是否支持工具调用（Function Calling）。",
      rawText: result.text,
      toolCalls: result.toolCalls
    });
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      error: formatAiError(err, { baseUrl, protocol, model, moduleName: "Tool-Calling 测试" })
    });
  }
});

router.post("/settings/ai-key", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { apiKey, mode, baseUrl, protocol, model } = req.body || {};
  const station = getStationKey(user);

  if (mode === "session") {
    if (apiKey && String(apiKey).trim()) req.session.userApiKey = String(apiKey).trim();
    if (baseUrl !== undefined) req.session.userApiBaseUrl = baseUrl ? normalizeBaseUrl(String(baseUrl)) : undefined;
    if (protocol !== undefined) req.session.userApiProtocol = validProtocol(protocol);
    if (model !== undefined) req.session.userApiModel = model ? String(model).trim() : undefined;
    if (!req.session.userApiKey && !user.ai_api_key_enabled && !station) return res.status(400).json({ error: "请填写 API Key" });
    return res.json({ ok: true, source: req.session.userApiKey ? "session" : (station ? "station" : "none") });
  }
  if (mode === "persist") {
    const hasNewKey = apiKey && String(apiKey).trim();
    if (!hasNewKey && !user.ai_api_key_enabled && !station) return res.status(400).json({ error: "请填写 API Key" });
    const enc = (hasNewKey ? encryptKeyDb(String(apiKey).trim()) : user.ai_api_key_enc) ?? null;
    const normalizedBase = (baseUrl === undefined ? user.ai_api_base_url : (baseUrl ? normalizeBaseUrl(String(baseUrl)) : null)) ?? null;
    const normalizedProtocol = protocol === undefined ? validProtocol(user.ai_api_protocol) : validProtocol(protocol);
    const normalizedModel = (model === undefined ? user.ai_api_model : (model ? String(model).trim() : null)) ?? null;
    db.prepare("UPDATE users SET ai_api_key_enc = ?, ai_api_key_enabled = ?, ai_api_base_url = ?, ai_api_protocol = ?, ai_api_model = ? WHERE id = ?").run(enc, hasNewKey ? 1 : (user.ai_api_key_enabled ? 1 : 0), normalizedBase, normalizedProtocol, normalizedModel, user.id);
    return res.json({ ok: true, source: hasNewKey ? "user-db" : (user.ai_api_key_enabled ? "user-db" : (station ? "station" : "none")) });
  }
  if (mode === "clear") {
    req.session.userApiKey = undefined;
    req.session.userApiBaseUrl = undefined;
    req.session.userApiProtocol = undefined;
    req.session.userApiModel = undefined;
    db.prepare("UPDATE users SET ai_api_key_enabled = 0, ai_api_key_enc = NULL, ai_api_base_url = NULL, ai_api_protocol = 'auto', ai_api_model = NULL WHERE id = ?").run(user.id);
    return res.json({ ok: true, source: "none" });
  }
  res.status(400).json({ error: "未知模式" });
});

// 用户密钥 AES-GCM 落库加密
function encryptKeyDb(plain: string): string {
  return encryptKey(plain, process.env.SESSION_SECRET || "x");
}


router.get("/prompts", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  let customPrompts: Record<string, string> = {};
  try {
    const row = db.prepare("SELECT ai_custom_prompts FROM users WHERE id = ?").get(user.id) as any;
    if (row?.ai_custom_prompts) {
      customPrompts = JSON.parse(row.ai_custom_prompts);
    }
  } catch {}
  res.json({
    defaults: SYSTEM_PROMPTS,
    custom: customPrompts,
  });
});

router.post("/prompts", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { prompts } = req.body || {};
  if (!prompts || typeof prompts !== "object") {
    return res.status(400).json({ error: "无效的提示词数据" });
  }
  let existing: Record<string, string> = {};
  try {
    const row = db.prepare("SELECT ai_custom_prompts FROM users WHERE id = ?").get(user.id) as any;
    if (row?.ai_custom_prompts) existing = JSON.parse(row.ai_custom_prompts);
  } catch {}
  for (const [k, v] of Object.entries(prompts)) {
    if (typeof v === "string" && v.trim()) {
      existing[k] = v.trim();
    } else {
      delete existing[k];
    }
  }
  db.prepare("UPDATE users SET ai_custom_prompts = ? WHERE id = ?").run(JSON.stringify(existing), user.id);
  res.json({ ok: true, custom: existing, defaults: SYSTEM_PROMPTS });
});

router.post("/prompts/reset", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { role } = req.body || {};
  if (role) {
    let existing: Record<string, string> = {};
    try {
      const row = db.prepare("SELECT ai_custom_prompts FROM users WHERE id = ?").get(user.id) as any;
      if (row?.ai_custom_prompts) existing = JSON.parse(row.ai_custom_prompts);
    } catch {}
    delete existing[role];
    db.prepare("UPDATE users SET ai_custom_prompts = ? WHERE id = ?").run(JSON.stringify(existing), user.id);
    return res.json({ ok: true, custom: existing, defaults: SYSTEM_PROMPTS });
  } else {
    db.prepare("UPDATE users SET ai_custom_prompts = '{}' WHERE id = ?").run(user.id);
    return res.json({ ok: true, custom: {}, defaults: SYSTEM_PROMPTS });
  }
});

// 像 cc-switch 一样：根据 API Key + Base URL 主动探测上游可用模型
// POST /api/ai/fetch-models  body: { apiKey?, baseUrl, protocol, scope? }
// scope: writer | distill | world — 用于在 apiKey 留空时回退到对应模块的已保存 Key
// 返回 { models: string[], source: 'anthropic'|'openai', error?: string }
router.post("/fetch-models", async (req, res) => {
  const user = currentUser(req)!;
  const { apiKey: explicitKey, baseUrl, protocol, scope } = req.body || {};

  // 没有显式给 Key 时，按 scope 回退到当前用户已保存的 Key（session / user-db / station）
  let resolvedKey = "";
  if (explicitKey && typeof explicitKey === "string" && explicitKey.trim()) {
    resolvedKey = explicitKey.trim();
  } else {
    const runtime = (scope === "distill")
      ? resolveDistillRuntimeConfig(req, user)
      : (scope === "world")
        ? resolveWorldRuntimeConfig(req, user)
        : resolveRuntimeConfig(req, user);
    if (runtime?.key) resolvedKey = runtime.key;
  }
  if (!resolvedKey) {
    return res.json({ models: [], error: "请先填写 API Key（或先在上方保存一次配置）" });
  }
  if (!baseUrl || typeof baseUrl !== "string" || !baseUrl.trim()) {
    return res.json({ models: [], error: "请提供 API Base URL" });
  }
  let normalizedBase: string;
  try {
    normalizedBase = normalizeBaseUrl(baseUrl.trim());
  } catch (err: any) {
    return res.json({ models: [], error: err?.message || "Base URL 格式不合法" });
  }
  const effectiveProtocol: Exclude<AiProtocol, "auto"> = validProtocol(protocol) === "auto"
    ? (normalizedBase.endsWith("/v1") ? "openai" : "anthropic")
    : (validProtocol(protocol) as Exclude<AiProtocol, "auto">);

  try {
    if (effectiveProtocol === "anthropic") {
      // Anthropic 原生：GET /v1/models（部分中转网关可能未实现此端点）
      const url = `${normalizedBase}/v1/models?limit=100`;
      const r = await fetch(url, {
        headers: {
          "x-api-key": resolvedKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return res.json({
          models: [],
          error: `上游返回 ${r.status}：${text.slice(0, 200) || "Anthropic 协议未提供 /v1/models 端点"}`,
        });
      }
      const body: any = await r.json();
      const list: any[] = Array.isArray(body?.data) ? body.data : [];
      const models = list
        .map((m) => (typeof m?.id === "string" ? m.id : null))
        .filter(Boolean) as string[];
      if (!models.length) {
        return res.json({ models: [], error: "上游未返回任何模型 ID（可能该 Key 无 /v1/models 权限）" });
      }
      return res.json({ models: models.slice(0, 100), source: "anthropic" });
    }

    // OpenAI 兼容：GET /models
    const url = normalizedBase.endsWith("/v1") ? `${normalizedBase}/models` : `${normalizedBase}/v1/models`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${resolvedKey}` },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return res.json({
        models: [],
        error: `上游返回 ${r.status}：${text.slice(0, 200) || "OpenAI 兼容端点未提供 /models"}`,
      });
    }
    const body: any = await r.json();
    const list: any[] = Array.isArray(body?.data) ? body.data : [];
    const models = list
      .map((m) => (typeof m?.id === "string" ? m.id : null))
      .filter(Boolean) as string[];
    if (!models.length) {
      return res.json({ models: [], error: "上游未返回任何模型 ID（可能该 Key 无 /models 权限）" });
    }
    return res.json({ models: models.slice(0, 100), source: "openai" });
  } catch (err: any) {
    return res.json({
      models: [],
      error: err?.message?.includes("fetch failed")
        ? "无法连接上游 API 地址，请检查 Base URL 与网络"
        : err?.message || "探测失败",
    });
  }
});

export default router;

// ---- 百万字小说长篇连贯创作支持接口 ----

// 自动提取/提炼指定章节的核心摘要与前情提要
router.post("/million/summarize-chapter", async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { chapterId } = req.body || {};
  if (!chapterId) return res.status(400).json({ error: "缺少 chapterId" });

  const chapter = db.prepare("SELECT * FROM chapters WHERE id = ?").get(chapterId) as any;
  if (!chapter) return res.status(404).json({ error: "章节不存在" });
  const novel = db.prepare("SELECT * FROM novels WHERE id = ?").get(chapter.novel_id) as any;
  if (!novel || (novel.user_id !== user.id && user.role !== "admin")) {
    return res.status(403).json({ error: "无权访问该作品" });
  }

  if (!chapter.content || chapter.content.trim().length < 50) {
    return res.status(400).json({ error: "本章正文字数过少，暂无法提炼有效摘要" });
  }

  const rt = resolveRuntimeConfig(req, user);
  if (!rt) return res.status(400).json({ error: "未配置 AI 运行时密钥" });

  const system = "你是一位资深网络小说剧情编审。请将提交的本章正文严格提炼为 JSON 格式：\n{\n  \"summary\": \"100字以内的本章核心剧情微摘要\",\n  \"key_events\": \"本章发生的1-3个关键事件（用分号隔开）\",\n  \"cliffhanger\": \"章末留下的核心悬念或钩子\"\n}\n注意：仅输出合法 JSON 字符串，不要包含任何 markdown 代码块或解释。";

  try {
    const result = await chatWithTools({
      key: rt.key,
      baseUrl: rt.baseUrl,
      protocol: rt.protocol,
      model: rt.model,
      system,
      messages: [{ role: "user", content: `【章节标题】《${chapter.title}》\n\n【正文全文】\n${chapter.content.slice(0, 8000)}` }],
      tools: [],
      maxTokens: 800,
    });

    let parsed: any = {};
    try {
      const clean = (result.text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { summary: (result.text || "").slice(0, 150), key_events: "", cliffhanger: "" };
    }

    db.prepare(`
      INSERT INTO chapter_summaries (chapter_id, novel_id, summary, key_events, cliffhanger, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(chapter_id) DO UPDATE SET
        summary = excluded.summary,
        key_events = excluded.key_events,
        cliffhanger = excluded.cliffhanger,
        updated_at = datetime('now')
    `).run(chapter.id, novel.id, parsed.summary || "", parsed.key_events || "", parsed.cliffhanger || "");

    res.json({ ok: true, summary: parsed });
  } catch (err: any) {
    res.status(500).json({ error: formatAiError(err, { baseUrl: rt.baseUrl, protocol: rt.protocol, model: rt.model, moduleName: "章节微摘要提炼" }) });
  }
});

// 获取/更新角色动态账本
router.get("/million/character-states/:novelId", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const novelId = Number(req.params.novelId);
  const rows = db.prepare(`
    SELECT cs.*, c.name, c.role, c.alias
    FROM characters c
    LEFT JOIN character_states cs ON c.id = cs.character_id
    WHERE c.novel_id = ?
    ORDER BY c.sort_order ASC, c.id ASC
  `).all(novelId);
  res.json({ states: rows });
});

router.post("/million/character-states", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { characterId, novelId, currentLocation, currentRealm, inventory, statusEffects, notes } = req.body || {};
  if (!characterId || !novelId) return res.status(400).json({ error: "缺少参数" });

  db.prepare(`
    INSERT INTO character_states (character_id, novel_id, current_location, current_realm, inventory, status_effects, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(character_id) DO UPDATE SET
      current_location = excluded.current_location,
      current_realm = excluded.current_realm,
      inventory = excluded.inventory,
      status_effects = excluded.status_effects,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).run(characterId, novelId, currentLocation || "", currentRealm || "", inventory || "", statusEffects || "", notes || "");

  res.json({ ok: true });
});

// 分卷管理 (CRUD)
router.get("/million/volumes/:novelId", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const novelId = Number(req.params.novelId);
  const rows = db.prepare("SELECT * FROM volumes WHERE novel_id = ? ORDER BY sort_order ASC, id ASC").all(novelId);
  res.json({ volumes: rows });
});

router.post("/million/volumes", (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: "请先登录" });
  const { novelId, title, summary, coreConflict, sortOrder } = req.body || {};
  if (!novelId || !title) return res.status(400).json({ error: "缺少作品 ID 或分卷标题" });
  const info = db.prepare("INSERT INTO volumes (novel_id, title, summary, core_conflict, sort_order) VALUES (?, ?, ?, ?, ?)").run(
    novelId,
    String(title).trim(),
    String(summary || "").trim(),
    String(coreConflict || "").trim(),
    Number(sortOrder) || 0
  );
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});
