import fs from "node:fs/promises";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import iconv from "iconv-lite";

export type SourceKind = "novel" | "comment" | "social";

const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_SAMPLE_CHARS = 200_000;
const CHAPTER_PATTERNS = [
  /^第[零一二三四五六七八九十百千万]+[章节卷篇部].*$/m,
  /^第\d+[章节卷篇部].*$/m,
  /^Chapter\s+\d+.*$/im,
  /^Part\s+\d+.*$/im,
  /^Section\s+\d+.*$/im,
  /^【[一二三四五六七八九十\d]+】.*$/m,
];

export interface ParsedSource {
  text: string;
  sample: string;
  chars: number;
  chapters: number;
}

function decodeText(buffer: Buffer): string {
  const candidates = ["utf-8", "utf-16le", "gb18030", "gbk", "big5"];
  let best = "";
  let bestScore = -Infinity;
  for (const encoding of candidates) {
    if (!iconv.encodingExists(encoding)) continue;
    const text = iconv.decode(buffer, encoding);
    const replacement = (text.match(/�/g) || []).length;
    const cjk = (text.match(/[㐀-鿿]/g) || []).length;
    const score = cjk * 3 - replacement * 20 - Math.abs(text.length - buffer.length) * 0.001;
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best.replace(/^﻿/, "");
}

function cleanText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/[​‌‍﻿­‎‏‪-‮]/g, "")
    .replace(/　/g, " ")
    .split("\n");
  const output: string[] = [];
  let previousEmpty = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (output.length && !previousEmpty) output.push("");
      previousEmpty = true;
      continue;
    }
    previousEmpty = false;
    const hasUrl = /(?:https?:\/\/|www\.)\S+/i.test(line);
    const adWords = (line.match(/广告|推广|赞助|点击|下载|APP|关注|公众号/g) || []).length;
    if ((hasUrl && adWords > 0) || adWords >= 2) continue;
    if (line.length < 5 && /^[\d\-*#@!?。，、]+$/.test(line)) continue;
    output.push(line);
  }
  return output.join("\n").trim();
}

function chapterRanges(text: string): Array<{ title: string; start: number; end: number }> {
  let matches: Array<{ index: number; title: string }> = [];
  for (const pattern of CHAPTER_PATTERNS) {
    const found: Array<{ index: number; title: string }> = [];
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(re)) {
      if (match.index !== undefined) found.push({ index: match.index, title: match[0].trim() });
    }
    if (found.length > matches.length) matches = found;
  }
  if (matches.length >= 3) {
    return matches.map((match, index) => {
      const next = matches[index + 1]?.index ?? text.length;
      const lineEnd = text.indexOf("\n", match.index);
      return { title: match.title, start: lineEnd < 0 ? next : lineEnd + 1, end: next };
    });
  }
  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const ranges: Array<{ title: string; start: number; end: number }> = [];
  let cursor = 0;
  let start = 0;
  let length = 0;
  let number = 1;
  for (const paragraph of paragraphs) {
    const index = text.indexOf(paragraph, cursor);
    cursor = index + paragraph.length;
    if (length > 3000 && start < index) {
      ranges.push({ title: `第${number++}节`, start, end: index });
      start = index;
      length = 0;
    }
    length += paragraph.length;
  }
  if (start < text.length) ranges.push({ title: `第${number}节`, start, end: text.length });
  return ranges;
}

function representativeSample(text: string, ranges: Array<{ title: string; start: number; end: number }>): string {
  if (text.length <= MAX_SAMPLE_CHARS) return text;
  const selected = new Set<number>();
  const head = Math.min(3, ranges.length);
  for (let i = 0; i < head; i += 1) selected.add(i);
  for (let i = 0; i < 3; i += 1) selected.add(Math.max(0, ranges.length - 1 - i));
  const middleStart = head;
  const middleEnd = Math.max(middleStart, ranges.length - 3);
  const middleCount = Math.max(1, Math.floor(MAX_SAMPLE_CHARS / 6000));
  for (let i = 0; i < middleCount; i += 1) {
    const ratio = middleCount === 1 ? 0.5 : i / (middleCount - 1);
    selected.add(Math.min(middleEnd - 1, middleStart + Math.floor((middleEnd - middleStart - 1) * ratio)));
  }
  let result = "";
  for (const index of [...selected].sort((a, b) => a - b)) {
    const range = ranges[index];
    const chunk = `## ${range.title}\n\n${text.slice(range.start, range.end).trim()}\n\n`;
    if (result.length + chunk.length > MAX_SAMPLE_CHARS) break;
    result += chunk;
  }
  return result.slice(0, MAX_SAMPLE_CHARS);
}

function stripHtml(html: string): { title: string; text: string } {
  const heading = html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] || "";
  const title = heading.replace(/<[^>]+>/g, "").replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (entity) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[entity] || entity)).trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>(?=.)/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/section>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return { title, text: cleanText(text) };
}

function parseEpub(buffer: Buffer): string {
  const files = unzipSync(new Uint8Array(buffer));
  const read = (name: string) => {
    const value = files[name];
    return value ? strFromU8(value) : "";
  };
  const container = read("META-INF/container.xml");
  const rootfile = container.match(/full-path=["']([^"']+)["']/i)?.[1] || "OEBPS/content.opf";
  const rootDir = path.posix.dirname(rootfile);
  const opf = read(rootfile);
  const manifest = new Map<string, string>();
  for (const match of opf.matchAll(/<item\b[^>]*\bid=["']([^"']+)["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) {
    manifest.set(match[1], path.posix.normalize(path.posix.join(rootDir, decodeURIComponent(match[2]))));
  }
  const ordered: string[] = [];
  for (const match of opf.matchAll(/<itemref\b[^>]*\bidref=["']([^"']+)["'][^>]*>/gi)) {
    const href = manifest.get(match[1]);
    if (href) ordered.push(href);
  }
  const candidates = ordered.length ? ordered : Object.keys(files).filter((name) => /\.(x?html?|htm)$/i.test(name)).sort();
  return candidates.map((name, index) => {
    const parsed = stripHtml(read(name));
    return `第${index + 1}章${parsed.title ? ` ${parsed.title}` : ""}\n${parsed.text}`;
  }).filter((value) => value.trim()).join("\n\n");
}

export async function parseSourceFile(filePath: string, format: string): Promise<ParsedSource> {
  const buffer = await fs.readFile(filePath);
  if (buffer.length > MAX_SOURCE_BYTES) throw new Error("单个材料不能超过 100MB");
  const raw = format.toLowerCase() === "epub" ? parseEpub(buffer) : decodeText(buffer);
  const text = cleanText(raw);
  const ranges = chapterRanges(text);
  return { text, sample: representativeSample(text, ranges), chars: text.length, chapters: ranges.length };
}

export function sourceSampleLimit(): number {
  return MAX_SAMPLE_CHARS;
}
