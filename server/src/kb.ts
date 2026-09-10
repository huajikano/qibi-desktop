// 起笔 · 本地知识库（RAG）
//
// 使用 BM25 评分做相似度检索。无需任何原生模块，纯 JS + SQLite。
// 长篇作品章节数 > 30 时，全章节历史可能超出 LLM 上下文，先用 KB 检索最相关片段。

import { db } from "./db.js";

type Chunk = {
  id: number;
  novel_id: number;
  source_kind: string;
  source_id: number | null;
  title: string | null;
  content: string;
  indexed_at: string;
};

// 简易中文分词：按字符切分 + 兼容中英文短语（双字 / 三字滑窗）。
function tokenize(text: string): string[] {
  if (!text) return [];
  const norm = text.toLowerCase().replace(/[\r\n]+/g, " ");
  // 提取 ASCII 单词 + 单汉字 + 二/三元词组
  const tokens: string[] = [];
  const re = /[a-z0-9]+|[一-鿿]/gi;
  let m: RegExpExecArray | null;
  const chars: string[] = [];
  while ((m = re.exec(norm))) {
    if (m[0].length > 1) tokens.push(m[0]);
    else chars.push(m[0]);
  }
  for (let i = 0; i < chars.length; i++) {
    tokens.push(chars[i]);
    if (i + 1 < chars.length) tokens.push(chars[i] + chars[i + 1]);
    if (i + 2 < chars.length) tokens.push(chars[i] + chars[i + 1] + chars[i + 2]);
  }
  return tokens;
}

// 将长文本拆分为 ~512 字符的段落（按段落优先）
function splitChunks(text: string, maxLen = 512): string[] {
  if (!text) return [];
  const out: string[] = [];
  const paragraphs = text.split(/\r?\n/);
  let buf = "";
  for (const p of paragraphs) {
    if (!p.trim()) continue;
    if ((buf + "\n" + p).length > maxLen && buf) {
      out.push(buf);
      buf = p;
    } else {
      buf = buf ? buf + "\n" + p : p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

export function indexNovel(novelId: number): { chunks: number; sources: number } {
  const novel = db.prepare("SELECT id FROM novels WHERE id = ?").get(novelId) as any;
  if (!novel) throw new Error("作品不存在");
  db.prepare("DELETE FROM kb_chunks WHERE novel_id = ?").run(novelId);

  let total = 0;
  const sources = new Set<number>();

  // 章节正文
  const chapters = db.prepare("SELECT id, title, content FROM chapters WHERE novel_id = ?").all(novelId) as Array<{ id: number; title: string; content: string }>;
  const insert = db.prepare("INSERT INTO kb_chunks (novel_id, source_kind, source_id, title, content) VALUES (?, ?, ?, ?, ?)");
  for (const c of chapters) {
    if (!c.content || !c.content.trim()) continue;
    for (const seg of splitChunks(c.content, 480)) {
      insert.run(novelId, "chapter", c.id, `第${c.id}章 ${c.title}`, seg);
      total++;
    }
    sources.add(c.id);
  }

  // 总纲与章节细纲
  const outlines = db.prepare("SELECT id, title, content, chapter_id FROM outlines WHERE novel_id = ?").all(novelId) as Array<{ id: number; title: string; content: string; chapter_id: number | null }>;
  for (const o of outlines) {
    const body = `【${o.chapter_id ? "本章细纲" : "总纲"}】${o.title}\n${o.content || ""}`.trim();
    if (!body) continue;
    insert.run(novelId, "outline", o.id, o.title, body);
    total++;
  }

  // 角色卡
  const chars = db.prepare("SELECT id, name, role, gender, personality, appearance, background, alias FROM characters WHERE novel_id = ?").all(novelId) as any[];
  for (const c of chars) {
    const body = `【人物】${c.name}${c.alias ? "（" + c.alias + "）" : ""} ${c.role || ""}\n${[
      c.gender ? "性别：" + c.gender : "",
      c.personality ? "性格：" + c.personality : "",
      c.appearance ? "外貌：" + c.appearance : "",
      c.background ? "背景：" + c.background : "",
    ].filter(Boolean).join("\n")}`;
    insert.run(novelId, "character", c.id, c.name, body);
    total++;
  }

  return { chunks: total, sources: sources.size };
}

export function dropNovel(novelId: number): number {
  const info = db.prepare("DELETE FROM kb_chunks WHERE novel_id = ?").run(novelId);
  return Number(info.changes);
}

export function indexOne(novelId: number, sourceKind: string, sourceId: number): number {
  // 重新索引单个源（写章节 / 改大纲 / 改人物时调用）
  db.prepare("DELETE FROM kb_chunks WHERE novel_id = ? AND source_kind = ? AND source_id = ?").run(novelId, sourceKind, sourceId);
  const insert = db.prepare("INSERT INTO kb_chunks (novel_id, source_kind, source_id, title, content) VALUES (?, ?, ?, ?, ?)");
  if (sourceKind === "chapter") {
    const row = db.prepare("SELECT id, title, content FROM chapters WHERE id = ?").get(sourceId) as any;
    if (!row || !row.content?.trim()) return 0;
    let n = 0;
    for (const seg of splitChunks(row.content, 480)) {
      insert.run(novelId, "chapter", row.id, `第${row.id}章 ${row.title}`, seg);
      n++;
    }
    return n;
  }
  if (sourceKind === "outline") {
    const row = db.prepare("SELECT id, title, content, chapter_id FROM outlines WHERE id = ?").get(sourceId) as any;
    if (!row) return 0;
    insert.run(novelId, "outline", row.id, row.title, `【${row.chapter_id ? "本章细纲" : "总纲"}】${row.title}\n${row.content || ""}`.trim());
    return 1;
  }
  if (sourceKind === "character") {
    const row = db.prepare("SELECT id, name, role, gender, personality, appearance, background, alias FROM characters WHERE id = ?").get(sourceId) as any;
    if (!row) return 0;
    const body = `【人物】${row.name}${row.alias ? "（" + row.alias + "）" : ""} ${row.role || ""}\n${[
      row.gender ? "性别：" + row.gender : "",
      row.personality ? "性格：" + row.personality : "",
      row.appearance ? "外貌：" + row.appearance : "",
      row.background ? "背景：" + row.background : "",
    ].filter(Boolean).join("\n")}`;
    insert.run(novelId, "character", row.id, row.name, body);
    return 1;
  }
  return 0;
}

export type QueryHit = { id: number; source_kind: string; source_id: number | null; title: string | null; content: string; score: number };

export function query(novelId: number, queryText: string, limit = 5): QueryHit[] {
  const qTokens = tokenize(queryText);
  if (!qTokens.length) return [];
  const qSet = new Set(qTokens);

  const chunks = db.prepare("SELECT id, source_kind, source_id, title, content FROM kb_chunks WHERE novel_id = ?").all(novelId) as Chunk[];

  // 计算 BM25 分数（k1=1.5, b=0.75）
  const N = chunks.length || 1;
  const avgLen = chunks.reduce((a, c) => a + c.content.length, 0) / N || 1;

  // 词频统计
  const df = new Map<string, number>();
  const tfs = chunks.map((c) => {
    const toks = tokenize(c.content);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { chunk: c, tf, len: toks.length };
  });

  const K1 = 1.5, B = 0.75;
  const idf = (t: string) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));

  const scored: QueryHit[] = tfs.map(({ chunk, tf, len }) => {
    let s = 0;
    for (const qt of qSet) {
      const f = tf.get(qt) || 0;
      if (!f) continue;
      const numerator = f * (K1 + 1);
      const denominator = f + K1 * (1 - B + B * (len / avgLen));
      s += idf(qt) * (numerator / denominator);
    }
    return { id: chunk.id, source_kind: chunk.source_kind, source_id: chunk.source_id, title: chunk.title, content: chunk.content, score: s };
  });

  return scored.filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function kbStats(novelId: number): { chunks: number; lastIndexed: string | null } {
  const row = db.prepare("SELECT COUNT(*) AS c, MAX(indexed_at) AS last_indexed FROM kb_chunks WHERE novel_id = ?").get(novelId) as any;
  return { chunks: row?.c || 0, lastIndexed: row?.last_indexed || null };
}
