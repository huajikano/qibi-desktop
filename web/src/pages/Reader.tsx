import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, List, Moon, Palette, RotateCcw, Sun } from "lucide-react";
import { api } from "../api";
import type { Chapter } from "../types";

type PublicNovel = {
  id: number;
  title: string;
  author: string;
  chapters?: Array<{ id: number; title: string; status: string }>;
};

type ReaderAppearance = {
  night: boolean;
  dayBg: string;
  dayFg: string;
  nightBg: string;
  nightFg: string;
};

const READER_APPEARANCE_KEY = "novelforge:reader-appearance";
const READER_APPEARANCE_DEFAULT: ReaderAppearance = {
  night: true,
  dayBg: "#fbf7ed",
  dayFg: "#2b2b2b",
  nightBg: "#11131c",
  nightFg: "#d8d6df",
};

function loadAppearance(): ReaderAppearance {
  try {
    const raw = localStorage.getItem(READER_APPEARANCE_KEY);
    if (!raw) return READER_APPEARANCE_DEFAULT;
    const p = JSON.parse(raw);
    if (
      typeof p?.night === "boolean" &&
      typeof p?.dayBg === "string" && typeof p?.dayFg === "string" &&
      typeof p?.nightBg === "string" && typeof p?.nightFg === "string"
    ) {
      return p as ReaderAppearance;
    }
  } catch {
    /* ignore malformed storage */
  }
  return READER_APPEARANCE_DEFAULT;
}

export default function Reader() {
  const { id, chapterId } = useParams();
  const cid = Number(id || chapterId);

  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [chapters, setChapters] = useState<Array<{ id: number; title: string }>>([]);
  const [novel, setNovel] = useState<PublicNovel | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.9);
  const [showToc, setShowToc] = useState(false);
  const [appearance, setAppearance] = useState(loadAppearance);

  useEffect(() => {
    localStorage.setItem(READER_APPEARANCE_KEY, JSON.stringify(appearance));
  }, [appearance]);

  const night = appearance.night;
  const activeBg = night ? appearance.nightBg : appearance.dayBg;
  const activeFg = night ? appearance.nightFg : appearance.dayFg;

  const toggleNight = () => setAppearance((a) => ({ ...a, night: !a.night }));

  const setColor = (part: "bg" | "fg", value: string) => {
    setAppearance((a) =>
      night
        ? { ...a, nightBg: part === "bg" ? value : a.nightBg, nightFg: part === "fg" ? value : a.nightFg }
        : { ...a, dayBg: part === "bg" ? value : a.dayBg, dayFg: part === "fg" ? value : a.dayFg }
    );
  };

  useEffect(() => {
    if (!cid) return;
    setLoading(true);
    api
      .get<Chapter>(`/chapters/${cid}/public`)
      .then((c) => {
        setChapter(c);
        return api.get<PublicNovel>(`/novels/${c.novel_id}/public`);
      })
      .then((n) => {
        setNovel(n);
        const pub = (n.chapters ?? [])
          .filter((c: any) => c.status === "已发布")
          .map((c: any) => ({ id: c.id, title: c.title }));
        setChapters(pub);
      })
      .catch(() => setChapter(null))
      .finally(() => setLoading(false));
  }, [cid]);

  const idx = chapters.findIndex((c) => c.id === cid);
  const prev = idx > 0 ? chapters[idx - 1] : null;
  const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;

  const soft = (a: string, b: string, pct: number) =>
    `color-mix(in srgb, ${a} ${100 - pct}%, ${b} ${pct}%)`;

  return (
    <div
      className="mx-auto max-w-3xl px-4 py-8 transition-colors"
      style={{
        backgroundColor: activeBg,
        color: activeFg,
        colorScheme: night ? "dark" : "light",
        ["--color-bg" as any]: activeBg,
        ["--color-surface" as any]: soft(activeBg, night ? "#fff" : "#000", night ? 7 : 6),
        ["--color-surface-2" as any]: soft(activeBg, night ? "#fff" : "#000", night ? 12 : 9),
        ["--color-border" as any]: `color-mix(in srgb, ${activeFg} ${night ? 14 : 18}%, transparent)`,
        ["--color-ink" as any]: activeFg,
        ["--color-ink-2" as any]: `color-mix(in srgb, ${activeFg} 70%, transparent)`,
        ["--color-ink-3" as any]: `color-mix(in srgb, ${activeFg} 45%, transparent)`,
      }}
    >
      {/* 顶栏操作 */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-4 text-xs text-ink-3">
        <Link
          to={novel ? `/book/${novel.id}` : "/"}
          className="inline-flex items-center gap-1 hover:text-ink"
        >
          <ArrowLeft size={13} />
          {novel?.title || "返回"}
        </Link>
        <div className="flex items-center gap-3">
          <button
            className="inline-flex items-center gap-1 hover:text-ink"
            onClick={() => setShowToc((v) => !v)}
          >
            <List size={13} /> 目录
          </button>
          <div className="flex items-center gap-1">
            <span>字号</span>
            <button
              className="h-6 w-6 rounded border border-border bg-surface text-ink hover:border-border-strong"
              onClick={() => setFontSize((s) => Math.max(14, s - 2))}
            >
              -
            </button>
            <span className="w-6 text-center">{fontSize}</span>
            <button
              className="h-6 w-6 rounded border border-border bg-surface text-ink hover:border-border-strong"
              onClick={() => setFontSize((s) => Math.min(28, s + 2))}
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span>行距</span>
            <button
              className="h-6 w-6 rounded border border-border bg-surface text-ink hover:border-border-strong"
              onClick={() => setLineHeight((h) => Math.max(1.5, +(h - 0.2).toFixed(1)))}
            >
              -
            </button>
            <span className="w-6 text-center">{lineHeight}</span>
            <button
              className="h-6 w-6 rounded border border-border bg-surface text-ink hover:border-border-strong"
              onClick={() => setLineHeight((h) => Math.min(2.6, +(h + 0.2).toFixed(1)))}
            >
              +
            </button>
          </div>
          <div
            className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-1.5 py-1"
            title={night ? "夜间配色，可自定义背景与文字颜色" : "日间配色，可自定义背景与文字颜色"}
          >
            <Palette size={12} className="text-ink-3" />
            <input
              type="color"
              value={activeBg}
              onChange={(e) => setColor("bg", e.target.value)}
              aria-label="背景颜色"
              className="h-5 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
            />
            <input
              type="color"
              value={activeFg}
              onChange={(e) => setColor("fg", e.target.value)}
              aria-label="文字颜色"
              className="h-5 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
            />
          </div>
          <button
            className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
            onClick={() => setAppearance(READER_APPEARANCE_DEFAULT)}
            aria-label="恢复默认配色"
            title="恢复默认配色与模式"
          >
            <RotateCcw size={13} />
          </button>
          <button
            className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
            onClick={toggleNight}
            aria-label="夜间模式"
            title={night ? "切换到日间模式" : "切换到夜间模式"}
          >
            {night ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>

      {/* 目录抽屉 */}
      {showToc && (
        <aside className="card mb-6 max-h-72 overflow-y-auto p-2">
          {chapters.map((c, i) => (
            <Link
              key={c.id}
              to={`/read/${c.id}`}
              className={`block rounded px-3 py-2 text-sm transition-colors hover:bg-surface-2 ${
                c.id === chapter?.id ? "text-primary-2" : "text-ink-2"
              }`}
            >
              <span className="mr-2 font-serif text-xs text-ink-3">{i + 1}.</span>
              {c.title}
            </Link>
          ))}
        </aside>
      )}

      {/* 正文 */}
      {loading ? (
        <div className="grid h-64 place-items-center text-ink-2">加载中…</div>
      ) : chapter ? (
        <article>
          <header className="mb-8 text-center">
            <p className="text-xs tracking-[0.3em] text-ink-3">第 {idx + 1} 章</p>
            <h1 className="serif-title mt-2 text-2xl text-ink">{chapter.title}</h1>
            <p className="mt-2 text-xs text-ink-3">{chapter.word_count} 字</p>
          </header>
          <div
            className="font-serif space-y-4 text-justify"
            style={{ fontSize: `${fontSize}px`, lineHeight }}
          >
            {chapter.content ? (
              chapter.content.split(/\r?\n/).map((para, i) => {
                const trimmed = para.trim();
                if (!trimmed) {
                  return <div key={i} className="h-3" />;
                }
                return (
                  <p
                    key={i}
                    className="break-words leading-relaxed"
                    style={{ textIndent: "2em" }}
                  >
                    {para.replace(/^(?:　|\s){1,4}/, "")}
                  </p>
                );
              })
            ) : (
              <p className="text-ink-3" style={{ textIndent: "2em" }}>（本章暂无正文）</p>
            )}
          </div>
        </article>
      ) : (
        <div className="grid h-48 place-items-center text-ink-2">章节不存在或未公开</div>
      )}

      {/* 翻页 */}
      <nav className="mt-10 grid grid-cols-2 gap-3">
        {prev ? (
          <Link to={`/read/${prev.id}`} className="btn-ghost justify-start text-xs">
            <ArrowLeft size={14} />
            上一章 · {prev.title.slice(0, 12)}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link to={`/read/${next.id}`} className="btn-ghost justify-end text-xs">
            {next.title.slice(0, 12)} · 下一章
            <ArrowRight size={14} />
          </Link>
        )}
      </nav>
    </div>
  );
}