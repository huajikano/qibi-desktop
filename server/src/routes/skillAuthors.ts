import express, { Request, Response } from "express";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { db, now } from "../db.js";
import { currentUser, ownsNovel, requireAuth, type UserRow } from "../auth.js";
import { parseSourceFile } from "../services/sourceParser.js";
import { resolveDistillRuntimeConfig, streamChat, formatAiError } from "./ai.js";
import { buildSkillInjection } from "../skills.js";

const router = express.Router();
router.use(requireAuth);

function resolveDefaultDataDir(): string {
  if (process.env.DATA_DIR && process.env.DATA_DIR.trim()) {
    return process.env.DATA_DIR.trim();
  }
  if (process.env.HOST === "0.0.0.0" && (fs.existsSync("E:\\") || fs.existsSync("E:/"))) {
    return "E:\\起笔-公网服务器数据\\data";
  }
  return path.resolve(process.cwd(), "data");
}

const DATA_DIR = resolveDefaultDataDir();
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["txt", "epub", "md", "html", "htm", "json"]);

type AuthorRow = {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  profile: string;
  current_version_id: number | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type SourceRow = {
  id: number;
  author_id: number;
  user_id: number;
  kind: string;
  filename: string;
  format: string;
  stored_path: string;
  size_bytes: number;
  parsed_chars: number;
  chapter_count: number;
  status: string;
  error: string | null;
  created_at: string;
};

function getUser(req: Request): UserRow {
  const user = currentUser(req);
  if (!user) throw Object.assign(new Error("请先登录"), { status: 401 });
  return user;
}

function authorForUser(id: number, user: UserRow): AuthorRow | undefined {
  const author = db.prepare("SELECT * FROM distilled_authors WHERE id = ?").get(id) as AuthorRow | undefined;
  if (!author || (author.user_id !== user.id && user.role !== "admin")) return undefined;
  return author;
}

function publicSource(source: SourceRow) {
  return {
    id: source.id,
    author_id: source.author_id,
    kind: source.kind,
    filename: source.filename,
    format: source.format,
    size_bytes: source.size_bytes,
    parsed_chars: source.parsed_chars,
    chapter_count: source.chapter_count,
    status: source.status,
    error: source.error,
    created_at: source.created_at,
  };
}

function publicVersion(version: any) {
  return {
    id: version.id,
    author_id: version.author_id,
    version: version.version,
    writing_skill: version.writing_skill,
    author_persona: version.author_persona,
    skill_markdown: version.skill_markdown,
    sample_summary: version.sample_summary,
    created_at: version.created_at,
  };
}

function publicAuthor(author: AuthorRow) {
  const current = author.current_version_id
    ? db.prepare("SELECT * FROM distilled_author_versions WHERE id = ?").get(author.current_version_id)
    : undefined;
  return {
    id: author.id,
    user_id: author.user_id,
    name: author.name,
    slug: author.slug,
    profile: parseJson(author.profile, {}),
    current_version_id: author.current_version_id,
    status: author.status,
    created_at: author.created_at,
    updated_at: author.updated_at,
    current_version: current ? publicVersion(current) : null,
  };
}

function parseJson(value: string | null | undefined, fallback: any) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || `author-${crypto.randomBytes(4).toString("hex")}`;
}

function formatFromName(filename: string, requested?: unknown): string {
  const value = String(requested || path.extname(filename).slice(1)).toLowerCase();
  if (!ALLOWED_FORMATS.has(value)) throw Object.assign(new Error("仅支持 TXT、EPUB、Markdown、HTML 或 JSON 材料"), { status: 400 });
  return value;
}

function uploadPath(userId: number, authorId: number, filename: string): string {
  const ext = path.extname(filename).toLowerCase() || ".txt";
  return path.resolve(DATA_DIR, "skill-materials", String(userId), String(authorId), `${crypto.randomUUID()}${ext}`);
}

function sseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
}

function sse(res: Response, payload: unknown) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sourceMaterial(sources: Array<{ filename: string; sample: string }>): string {
  let result = "";
  for (const source of sources) {
    const block = `\n\n===== 材料：${source.filename} =====\n${source.sample}`;
    if (result.length + block.length > 200_000) break;
    result += block;
  }
  return result.slice(0, 200_000);
}

async function generateDistillation(req: Request, res: Response, author: AuthorRow, user: UserRow, sourceIds?: number[]) {
  const runtime = resolveDistillRuntimeConfig(req, user);
  if (!runtime) throw Object.assign(new Error("未配置蒸馏作者专用 API 密钥。请前往「设置」->「蒸馏作者 · 专用 API 配置」填写 API Key、Base URL 与模型名称后再开始蒸馏。"), { status: 400 });
  const params: any[] = [author.id, user.id];
  let query = "SELECT * FROM distilled_author_sources WHERE author_id = ? AND user_id = ? AND status = 'ready'";
  if (sourceIds?.length) {
    query += ` AND id IN (${sourceIds.map(() => "?").join(",")})`;
    params.push(...sourceIds);
  }
  const rows = db.prepare(query).all(...params) as unknown as SourceRow[];
  if (!rows.length) throw Object.assign(new Error("请先上传并解析至少一份材料"), { status: 400 });

  const parsed: Array<{ filename: string; sample: string }> = [];
  for (const row of rows) {
    const result = await parseSourceFile(row.stored_path, row.format);
    parsed.push({ filename: row.filename, sample: result.sample });
  }
  const material = sourceMaterial(parsed);
  const previous = author.current_version_id
    ? db.prepare("SELECT * FROM distilled_author_versions WHERE id = ?").get(author.current_version_id) as any
    : null;
  const previousContext = previous
    ? `\n\n【上一版本 writing skill】\n${previous.writing_skill.slice(0, 12_000)}\n\n【上一版本 author persona】\n${previous.author_persona.slice(0, 8_000)}`
    : "";

  const run = async (stage: string, system: string, prompt: string, maxTokens: number) => {
    sse(res, { type: "stage", stage, status: "running" });
    let output = "";
    let skillBlock = "";
    try { skillBlock = buildSkillInjection(user.id, "distill"); } catch { /* ignore */ }
    await streamChat({
      key: runtime.key,
      system: skillBlock ? system + "\n\n" + skillBlock : system,
      userPrompt: prompt,
      maxTokens,
      protocol: runtime.protocol,
      baseUrl: runtime.baseUrl,
      model: runtime.model,
      signal: undefined,
      onDelta: (text) => {
        output += text;
        sse(res, { type: "delta", stage, text });
      },
    });
    if (!output.trim()) throw new Error(`${stage} 阶段没有返回内容`);
    sse(res, { type: "stage", stage, status: "done" });
    return output.trim();
  };

  const writingSkill = await run(
    "writing",
    "你是专业的长篇网络小说文风分析师。只基于提供的授权样本总结可复用的写作规律，不复刻原文，不编造作者未体现的事实。",
    `请分析以下作者材料，输出一份不超过 6000 字的 writing skill。覆盖：叙事视角与距离、句式和节奏、场景与感官描写、人物塑造、对话、冲突与悬念、章节结构、情绪曲线、常见优点与应避免的问题。使用清晰的 Markdown 标题和可执行规则。${previousContext}\n\n${material}`,
    7000,
  );
  const persona = await run(
    "persona",
    "你是作者人格与创作习惯分析师。只根据样本进行谨慎推断，把事实、强推断和不确定性分开，不对真实人物作心理诊断。",
    `请根据材料输出一份不超过 3000 字的 author persona，覆盖：创作关注点、价值偏好、人物观、叙事取舍、更新与构思习惯的可观察表现，以及写作时适合的自检问题。不要声称知道作者现实生活。${previousContext}\n\n${material}`,
    4000,
  );
  const skill = await run(
    "merge",
    "你是技能文档编辑。把分析结果合并成供小说写作助手使用的单一 Markdown Skill。不要提及 API、工具调用或内部流程，不要复制原文段落。",
    `请将下列 writing skill 与 author persona 合并为一份不超过 10000 字的完整小说写作 Skill。必须包含：适用范围、创作前检查、正文生成规则、人物与对话规则、章节节奏规则、完稿自检清单，并明确“作品既有设定优先”。\n\n【writing skill】\n${writingSkill}\n\n【author persona】\n${persona}`,
    9000,
  );
  const nextVersion = ((db.prepare("SELECT MAX(version) AS v FROM distilled_author_versions WHERE author_id = ?").get(author.id) as any)?.v || 0) + 1;
  const info = db.prepare(`INSERT INTO distilled_author_versions
    (author_id, user_id, version, writing_skill, author_persona, skill_markdown, sample_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(author.id, user.id, nextVersion, writingSkill, persona, skill, `使用 ${rows.length} 份材料生成，样本总长度约 ${material.length} 字符。`);
  const versionId = Number(info.lastInsertRowid);
  db.prepare("UPDATE distilled_authors SET current_version_id = ?, status = 'ready', updated_at = ? WHERE id = ?").run(versionId, now(), author.id);
  const version = db.prepare("SELECT * FROM distilled_author_versions WHERE id = ?").get(versionId);
  sse(res, { type: "preview", author: publicAuthor({ ...author, current_version_id: versionId, status: "ready" }), version: publicVersion(version) });
  sse(res, { type: "done" });
}

router.get("/skill-authors", (req, res) => {
  const user = getUser(req);
  const rows = db.prepare("SELECT * FROM distilled_authors WHERE user_id = ? ORDER BY updated_at DESC, id DESC").all(user.id) as unknown as AuthorRow[];
  res.json(rows.map(publicAuthor));
});

router.post("/skill-authors", (req, res) => {
  const user = getUser(req);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "作者名称不能为空" });
  const slug = slugify(String(req.body?.slug || name));
  const profile = typeof req.body?.profile === "string" ? req.body.profile : JSON.stringify(req.body?.profile || {});
  try {
    const info = db.prepare("INSERT INTO distilled_authors (user_id, name, slug, profile) VALUES (?, ?, ?, ?)").run(user.id, name, slug, profile);
    const author = db.prepare("SELECT * FROM distilled_authors WHERE id = ?").get(info.lastInsertRowid) as AuthorRow;
    res.status(201).json(publicAuthor(author));
  } catch (err: any) {
    if (String(err?.message).includes("UNIQUE")) return res.status(409).json({ error: "该作者已经存在" });
    throw err;
  }
});

router.get("/skill-authors/:id", (req, res) => {
  const user = getUser(req);
  const author = authorForUser(Number(req.params.id), user);
  if (!author) return res.status(404).json({ error: "作者不存在" });
  const sources = db.prepare("SELECT * FROM distilled_author_sources WHERE author_id = ? ORDER BY created_at DESC").all(author.id) as unknown as SourceRow[];
  const versions = db.prepare("SELECT * FROM distilled_author_versions WHERE author_id = ? ORDER BY version DESC").all(author.id);
  res.json({ ...publicAuthor(author), sources: sources.map(publicSource), versions: versions.map(publicVersion) });
});

router.patch("/skill-authors/:id", (req, res) => {
  const user = getUser(req);
  const author = authorForUser(Number(req.params.id), user);
  if (!author) return res.status(404).json({ error: "作者不存在" });
  const name = req.body?.name === undefined ? author.name : String(req.body.name).trim();
  const profile = req.body?.profile === undefined ? author.profile : JSON.stringify(req.body.profile);
  if (!name) return res.status(400).json({ error: "作者名称不能为空" });
  db.prepare("UPDATE distilled_authors SET name = ?, profile = ?, updated_at = ? WHERE id = ?").run(name, profile, now(), author.id);
  res.json(publicAuthor(db.prepare("SELECT * FROM distilled_authors WHERE id = ?").get(author.id) as AuthorRow));
});

router.delete("/skill-authors/:id", async (req, res) => {
  const user = getUser(req);
  const author = authorForUser(Number(req.params.id), user);
  if (!author) return res.status(404).json({ error: "作者不存在" });
  const sources = db.prepare("SELECT stored_path FROM distilled_author_sources WHERE author_id = ?").all(author.id) as Array<{ stored_path: string }>;
  db.prepare("DELETE FROM distilled_authors WHERE id = ?").run(author.id);
  await Promise.all(sources.map((source) => fsPromises.unlink(source.stored_path).catch(() => undefined)));
  res.status(204).end();
});

router.post("/skill-authors/:id/sources/init", async (req, res) => {
  const user = getUser(req);
  const author = authorForUser(Number(req.params.id), user);
  if (!author) return res.status(404).json({ error: "作者不存在" });
  const filename = path.basename(String(req.body?.filename || "材料.txt")).slice(0, 255);
  const format = formatFromName(filename, req.body?.format);
  const expectedSize = Number(req.body?.size || 0);
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0 || expectedSize > MAX_SOURCE_BYTES) return res.status(400).json({ error: "材料大小必须在 1B 到 100MB 之间" });
  const storedPath = uploadPath(user.id, author.id, filename);
  await fsPromises.mkdir(path.dirname(storedPath), { recursive: true });
  await fsPromises.writeFile(storedPath, Buffer.alloc(0));
  const info = db.prepare(`INSERT INTO distilled_author_sources
    (author_id, user_id, kind, filename, format, stored_path, size_bytes, status)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'uploading')`).run(author.id, user.id, String(req.body?.kind || "novel"), filename, format, storedPath);
  res.status(201).json({ uploadId: Number(info.lastInsertRowid), filename, format, expectedSize });
});

router.post("/skill-authors/sources/:id/chunk", express.raw({ type: "*/*", limit: `${MAX_CHUNK_BYTES}b` }), async (req, res) => {
  const user = getUser(req);
  const source = db.prepare("SELECT * FROM distilled_author_sources WHERE id = ? AND user_id = ?").get(Number(req.params.id), user.id) as SourceRow | undefined;
  if (!source) return res.status(404).json({ error: "上传任务不存在" });
  if (source.status !== "uploading") return res.status(409).json({ error: "该上传任务已结束" });
  const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
  if (!chunk.length || chunk.length > MAX_CHUNK_BYTES) return res.status(400).json({ error: "上传分块大小无效" });
  const current = (await fsPromises.stat(source.stored_path)).size;
  const offset = Number(req.header("x-upload-offset") || current);
  if (!Number.isSafeInteger(offset) || offset !== current) return res.status(409).json({ error: `上传位置不匹配，当前应为 ${current}` });
  if (current + chunk.length > MAX_SOURCE_BYTES) return res.status(413).json({ error: "材料不能超过 100MB" });
  await fsPromises.appendFile(source.stored_path, chunk);
  const size = current + chunk.length;
  db.prepare("UPDATE distilled_author_sources SET size_bytes = ? WHERE id = ?").run(size, source.id);
  res.json({ uploadId: source.id, received: size });
});

router.post("/skill-authors/sources/:id/complete", async (req, res) => {
  const user = getUser(req);
  const source = db.prepare("SELECT * FROM distilled_author_sources WHERE id = ? AND user_id = ?").get(Number(req.params.id), user.id) as SourceRow | undefined;
  if (!source) return res.status(404).json({ error: "上传任务不存在" });
  try {
    const stat = await fsPromises.stat(source.stored_path);
    if (!stat.size) throw new Error("材料为空");
    const result = await parseSourceFile(source.stored_path, source.format);
    db.prepare(`UPDATE distilled_author_sources SET size_bytes = ?, parsed_chars = ?, chapter_count = ?, status = 'ready', error = NULL WHERE id = ?`)
      .run(stat.size, result.chars, result.chapters, source.id);
    res.json(publicSource(db.prepare("SELECT * FROM distilled_author_sources WHERE id = ?").get(source.id) as SourceRow));
  } catch (err: any) {
    db.prepare("UPDATE distilled_author_sources SET status = 'error', error = ? WHERE id = ?").run(err?.message || "材料解析失败", source.id);
    res.status(422).json({ error: err?.message || "材料解析失败" });
  }
});

router.delete("/skill-authors/sources/:id", async (req, res) => {
  const user = getUser(req);
  const source = db.prepare("SELECT * FROM distilled_author_sources WHERE id = ? AND user_id = ?").get(Number(req.params.id), user.id) as SourceRow | undefined;
  if (!source) return res.status(404).json({ error: "材料不存在" });
  db.prepare("DELETE FROM distilled_author_sources WHERE id = ?").run(source.id);
  await fsPromises.unlink(source.stored_path).catch(() => undefined);
  res.status(204).end();
});

async function distillHandler(req: Request, res: Response) {
  const user = getUser(req);
  const author = authorForUser(Number(req.params.id), user);
  if (!author) return res.status(404).json({ error: "作者不存在" });
  const runtime = resolveDistillRuntimeConfig(req, user);
  sseHeaders(res);
  try {
    await generateDistillation(req, res, author, user, Array.isArray(req.body?.sourceIds) ? req.body.sourceIds.map(Number).filter(Number.isInteger) : undefined);
  } catch (err: any) {
    const formatted = formatAiError(err, {
      baseUrl: runtime?.baseUrl,
      protocol: runtime?.protocol,
      model: runtime?.model,
      moduleName: "蒸馏作者",
    });
    sse(res, { type: "error", status: err?.status || 502, error: formatted });
  } finally {
    res.end();
  }
}

router.post("/skill-authors/:id/distill", distillHandler);
router.post("/skill-authors/:id/evolve", distillHandler);

router.get("/skill-authors/:id/versions", (req, res) => {
  const user = getUser(req);
  const author = authorForUser(Number(req.params.id), user);
  if (!author) return res.status(404).json({ error: "作者不存在" });
  const versions = db.prepare("SELECT * FROM distilled_author_versions WHERE author_id = ? ORDER BY version DESC").all(author.id);
  res.json(versions.map(publicVersion));
});

router.post("/skill-authors/:id/versions/:versionId/rollback", (req, res) => {
  const user = getUser(req);
  const author = authorForUser(Number(req.params.id), user);
  if (!author) return res.status(404).json({ error: "作者不存在" });
  const version = db.prepare("SELECT * FROM distilled_author_versions WHERE id = ? AND author_id = ?").get(Number(req.params.versionId), author.id);
  if (!version) return res.status(404).json({ error: "版本不存在" });
  db.prepare("UPDATE distilled_authors SET current_version_id = ?, status = 'ready', updated_at = ? WHERE id = ?").run(Number(req.params.versionId), now(), author.id);
  res.json(publicAuthor(db.prepare("SELECT * FROM distilled_authors WHERE id = ?").get(author.id) as AuthorRow));
});

router.get("/novels/:novelId/writer-state", ownsNovel, (req, res) => {
  const user = getUser(req);
  const novelId = Number(req.params.novelId);
  const state = db.prepare("SELECT * FROM novel_writer_state WHERE novel_id = ? AND user_id = ?").get(novelId, user.id) as any;
  res.json(state || { novel_id: novelId, user_id: user.id, distilled_author_id: null, progress: "", foreshadowing: "[]", updated_at: null });
});

router.patch("/novels/:novelId/writer-state", ownsNovel, (req, res) => {
  const user = getUser(req);
  const novelId = Number(req.params.novelId);
  const existing = db.prepare("SELECT * FROM novel_writer_state WHERE novel_id = ? AND user_id = ?").get(novelId, user.id) as any;
  const distilledAuthorId = req.body?.distilled_author_id === undefined ? existing?.distilled_author_id ?? null : (req.body.distilled_author_id === null ? null : Number(req.body.distilled_author_id));
  const progress = req.body?.progress === undefined ? existing?.progress || "" : String(req.body.progress);
  const foreshadowing = req.body?.foreshadowing === undefined ? existing?.foreshadowing || "[]" : (typeof req.body.foreshadowing === "string" ? req.body.foreshadowing : JSON.stringify(req.body.foreshadowing));
  db.prepare(`INSERT INTO novel_writer_state (novel_id, user_id, distilled_author_id, progress, foreshadowing, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(novel_id) DO UPDATE SET distilled_author_id = excluded.distilled_author_id, progress = excluded.progress, foreshadowing = excluded.foreshadowing, updated_at = excluded.updated_at`)
    .run(novelId, user.id, distilledAuthorId, progress, foreshadowing, now());
  res.json(db.prepare("SELECT * FROM novel_writer_state WHERE novel_id = ?").get(novelId));
});

export default router;
