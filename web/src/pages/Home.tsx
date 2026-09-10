import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Flame, PenLine, Sparkles, Compass, Users, ChevronRight, Layers } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../stores/auth";
import type { Novel } from "../types";

const GENRES = ["全部", "玄幻", "都市", "历史", "科幻", "仙侠", "悬疑", "言情", "其他"];

export default function Home() {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [genre, setGenre] = useState("全部");
  const [loading, setLoading] = useState(true);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    void (async () => {
      try {
        const rows = await api.get<Novel[]>("/novels/public");
        setNovels(rows);
      } catch {
        setNovels([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const shown = genre === "全部" ? novels : novels.filter((n) => n.genre === genre);
  const featured = novels[0];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-8">
      {/* 顶部 Hero 殿堂卡片 */}
      <section className="relative overflow-hidden rounded-2xl border border-border/90 bg-gradient-to-br from-surface-elevated via-surface to-surface-1 p-8 sm:p-10 shadow-xl">
        <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-80 w-80 rounded-full bg-gold/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary-soft/80 px-3 py-1 text-xs font-medium text-primary-2 shadow-sm">
              <Flame size={14} className="animate-pulse" />
              <span>百万字长篇 AI 创作工作台 · 东方书卷引擎</span>
            </div>
            <h1 className="serif-title text-3xl font-bold tracking-tight text-white sm:text-5xl leading-tight">
              {featured ? `《${featured.title}》` : "以笔为舟 · 渡万里山河"}
            </h1>
            <p className="text-sm leading-relaxed text-ink-2 sm:text-base">
              {featured?.intro || "融合分层动态记忆、ReAct 智能体管家、世界观地图与知识库 RAG。专为百万字长篇网络小说打造的沉浸式创作与阅读平台。"}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {featured && (
                <Link to={`/book/${featured.id}`} className="btn-primary !min-h-10 !px-5 shadow-lg">
                  <BookOpen size={16} />
                  立即阅读全本
                </Link>
              )}
              {user ? (
                <Link to="/author" className="btn-secondary !min-h-10 !px-5">
                  <PenLine size={16} />
                  进入创作工作室
                </Link>
              ) : (
                <Link to="/register" className="btn-secondary !min-h-10 !px-5">
                  <Sparkles size={16} />
                  免费开启创作
                </Link>
              )}
            </div>
          </div>

          {/* 右侧作品/数据视觉卡片 */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:w-80 shrink-0">
            <div className="rounded-xl border border-border bg-surface-2/60 p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 text-primary-2 mb-1.5">
                <Layers size={18} />
                <span className="text-xs font-semibold text-ink">分层记忆</span>
              </div>
              <p className="text-[11px] text-ink-3 leading-relaxed">全书梗概、分卷大纲、章节微摘要与前情提要链</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 text-gold mb-1.5">
                <Users size={18} />
                <span className="text-xs font-semibold text-ink">动态账本</span>
              </div>
              <p className="text-[11px] text-ink-3 leading-relaxed">实时追踪角色最新修为境界、位置与持有法宝</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 text-emerald-400 mb-1.5">
                <Compass size={18} />
                <span className="text-xs font-semibold text-ink">世界地图</span>
              </div>
              <p className="text-[11px] text-ink-3 leading-relaxed">势力分布、名城关隘与地理要道可视化设定</p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2/60 p-4 backdrop-blur-md">
              <div className="flex items-center gap-2 text-link mb-1.5">
                <Sparkles size={18} />
                <span className="text-xs font-semibold text-ink">管家 Agent</span>
              </div>
              <p className="text-[11px] text-ink-3 leading-relaxed">自主多步调用工具与外部 MCP 协议协同写作</p>
            </div>
          </div>
        </div>
      </section>

      {/* 流派分类胶囊过滤栏 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-primary-2" />
            <h2 className="serif-title text-xl text-ink">全部作品库</h2>
          </div>
          <span className="text-xs text-ink-3">共收录 {novels.length} 部作品</span>
        </div>

        <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
          {GENRES.map((g) => (
            <button
              key={g}
              type="button"
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all duration-150 ${
                genre === g
                  ? "bg-primary text-white shadow-[0_2px_10px_rgba(230,0,18,0.35)]"
                  : "border border-border bg-surface hover:border-border-2 hover:bg-surface-2 text-ink-2 hover:text-ink"
              }`}
              onClick={() => setGenre(g)}
            >
              {g}
            </button>
          ))}
        </div>
      </section>

      {/* 作品卡片网格 */}
      <section>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-xl border border-border bg-surface-1" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-surface-1/40 py-16 text-center text-ink-3">
            <BookOpen size={36} className="mx-auto mb-3 opacity-30 text-primary-2" />
            <p className="text-sm">该分类下暂无公开作品</p>
            <p className="mt-1 text-xs text-ink-faint">作者可在写作台将自创小说切换为公开全站阅读</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((n) => (
              <Link
                key={n.id}
                to={`/book/${n.id}`}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface p-5 transition-all duration-200 hover:-translate-y-1 hover:border-primary-2/40 hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
              >
                <div className="pointer-events-none absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-primary to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="serif-title text-base font-semibold text-ink group-hover:text-primary-2 transition-colors line-clamp-1">
                      《{n.title}》
                    </h3>
                    <span className="shrink-0 rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-primary-2 border border-border">
                      {n.genre}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-ink-3 line-clamp-3 leading-relaxed">
                    {n.intro || "暂无作品简介"}
                  </p>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-ink-3">
                  <span className="truncate">作者：{n.author || n.owner || "佚名"}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-ink-2">{(n.word_count / 10000).toFixed(1)} 万字</span>
                    <ChevronRight size={13} className="text-ink-3 group-hover:translate-x-0.5 group-hover:text-primary-2 transition-all" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
