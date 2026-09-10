import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, ListTree, Users, Map as MapIcon } from "lucide-react";
import { api } from "../api";
import type { Novel } from "../types";

export default function BookDetail() {
  const { id } = useParams();
  const [book, setBook] = useState<Novel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setBook(await api.get<Novel>(`/novels/${id}/public`));
      } catch {
        setBook(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return <div className="grid min-h-[50vh] place-items-center text-ink-2">加载中…</div>;
  }
  if (!book) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-ink-2">
        作品不存在或未公开
        <div className="mt-4">
          <Link to="/" className="btn-ghost text-sm">
            <ArrowLeft size={14} />
            返回书库
          </Link>
        </div>
      </div>
    );
  }

  const published = book.chapters ?? [];
  const firstChapter = published[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
        <ArrowLeft size={12} /> 返回书库
      </Link>

      {/* 头部：封面 + 信息 */}
      <div className="card flex flex-col gap-6 p-6 sm:flex-row">
        <div
          className="flex h-56 w-40 shrink-0 items-center justify-center rounded-md shadow-lg"
          style={{ background: `linear-gradient(150deg, ${book.cover_color}, #0e0e1c 140%)` }}
        >
          <span className="serif-title text-5xl text-white/90">{book.title.slice(0, 2)}</span>
        </div>
        <div className="flex-1">
          <h1 className="serif-title text-3xl text-ink">
            {book.title}
            <span className="ml-3 align-middle text-sm font-normal text-ink-3">作者：{book.owner || book.author}</span>
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-primary-soft px-3 py-1 text-primary-2">{book.genre}</span>
            <span className="rounded-full border border-border px-3 py-1 text-ink-2">{book.status}</span>
            <span className="rounded-full border border-border px-3 py-1 text-ink-2">
              约 {Math.round(book.word_count / 1000)}k 字
            </span>
            {book.mapCount ? (
              <span className="rounded-full border border-border px-3 py-1 text-ink-2">
                {book.mapCount} 张地图
              </span>
            ) : null}
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-ink-2">{book.intro}</p>
          <div className="mt-5 flex gap-3">
            {firstChapter ? (
              <Link to={`/read/${firstChapter.id}`} className="btn-primary">
                <BookOpen size={16} />
                开始阅读
              </Link>
            ) : (
              <span className="btn-ghost cursor-default">暂无已发布章节</span>
            )}
          </div>
        </div>
      </div>

      {/* 人物 */}
      {book.characters && book.characters.length > 0 && (
        <section className="mt-8">
          <h2 className="serif-title mb-3 flex items-center gap-2 text-lg text-ink">
            <Users size={18} className="text-primary-2" /> 主要人物
          </h2>
          <div className="flex flex-wrap gap-2">
            {book.characters.map((c) => (
              <div key={c.id} className="card px-4 py-2.5 text-sm">
                <span className="text-ink">{c.name}</span>
                <span className="ml-2 text-xs text-ink-3">
                  {c.role}
                  {c.appearance ? ` · ${c.appearance.slice(0, 20)}${c.appearance.length > 20 ? "…" : ""}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 目录 */}
      <section className="mt-8">
        <h2 className="serif-title mb-3 flex items-center gap-2 text-lg text-ink">
          <ListTree size={18} className="text-primary-2" /> 目录（{published.length} 章）
        </h2>
        {published.length === 0 ? (
          <div className="card p-8 text-center text-sm text-ink-2">
            <MapIcon className="mx-auto mb-2" size={28} />
            作者尚未发布章节
          </div>
        ) : (
          <div className="card overflow-hidden">
            {published.map((c, i) => (
              <Link
                key={c.id}
                to={`/read/${c.id}`}
                className={`flex items-center justify-between px-4 py-3 text-sm transition-colors hover:bg-surface-2 ${
                  i > 0 ? "border-t border-border" : ""
                }`}
              >
                <span className="flex items-center gap-3 text-ink">
                  <span className="w-8 shrink-0 text-right font-serif text-xs text-ink-3">{i + 1}</span>
                  <span className="serif-title">{c.title}</span>
                </span>
                <span className="text-xs text-ink-3">{c.word_count} 字</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
