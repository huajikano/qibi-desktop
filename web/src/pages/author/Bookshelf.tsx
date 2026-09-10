import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookPlus, PenLine, Trash2, Users, Map as MapIcon, Sparkles, Globe, Lock, Eye, EyeOff } from "lucide-react";
import { api } from "../../api";
import type { Novel } from "../../types";

const GENRES = ["玄幻", "都市", "历史", "科幻", "仙侠", "悬疑", "言情", "其他"];
const STATUSES = ["连载中", "已完结", "停更", "隐藏"];

export default function Bookshelf() {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("玄幻");
  const [intro, setIntro] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const load = async () => {
    setNovels(await api.get<Novel[]>("/novels"));
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.post("/novels", { title, genre, intro, is_public: isPublic ? 1 : 0 });
      setTitle("");
      setIntro("");
      setIsPublic(true);
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setError(err.message || "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleVisibility = async (n: Novel) => {
    setTogglingId(n.id);
    try {
      const nextPublic = n.is_public === 0 ? 1 : 0;
      await api.patch(`/novels/${n.id}`, { is_public: nextPublic });
      setNovels((ns) => ns.map((item) => (item.id === n.id ? { ...item, is_public: nextPublic } : item)));
    } catch (err: any) {
      alert(err.message || "切换可见性失败");
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async (n: Novel) => {
    if (!confirm(`确定删除《${n.title}》？该作品的章节、大纲、人物与地图将一并删除，且不可恢复。`)) return;
    await api.del(`/novels/${n.id}`);
    await load();
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="serif-title text-2xl text-ink">我的书架</h1>
          <p className="mt-1 text-sm text-ink-2">共 {novels.length} 部作品</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/author/distill" className="btn-ghost">
            <Sparkles size={16} />
            蒸馏作者
          </Link>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            <BookPlus size={16} />
            新建作品
          </button>
        </div>
      </div>

      {/* 新建弹层 */}
      {showCreate && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setShowCreate(false)}>
          <form
            className="card w-full max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
            onSubmit={create}
            aria-label="新建作品"
          >
            <h2 className="serif-title mb-4 text-lg text-ink">新建作品</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm text-ink-2" htmlFor="b-title">
                  书名 <span className="text-primary-2">*</span>
                </label>
                <input id="b-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-ink-2" htmlFor="b-genre">
                  类型
                </label>
                <select id="b-genre" className="input" value={genre} onChange={(e) => setGenre(e.target.value)}>
                  {GENRES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-ink-2" htmlFor="b-intro">
                  简介
                </label>
                <textarea
                  id="b-intro"
                  className="input min-h-24 resize-y"
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  placeholder="一句话打动读者"
                />
              </div>
              <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
                <div className="mb-2 font-medium text-ink">作品可见性</div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer text-ink">
                    <input
                      type="radio"
                      name="visibility"
                      checked={isPublic}
                      onChange={() => setIsPublic(true)}
                    />
                    <Globe size={13} className="text-emerald-400" />
                    <span>公开作品（其他作者与读者可见）</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-ink">
                    <input
                      type="radio"
                      name="visibility"
                      checked={!isPublic}
                      onChange={() => setIsPublic(false)}
                    />
                    <Lock size={13} className="text-amber-400" />
                    <span>私密作品（仅自己可见）</span>
                  </label>
                </div>
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>
                  取消
                </button>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? "创建中…" : "创建"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* 书卡网格 */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-52 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : novels.length === 0 ? (
        <div className="card p-12 text-center text-sm text-ink-2">
          还没有作品，点击右上角「新建作品」开启创作。
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {novels.map((n) => (
            <div key={n.id} className="card group overflow-hidden">
              <Link to={`/author/book/${n.id}`}>
                <div
                  className="flex h-32 items-center justify-center"
                  style={{ background: `linear-gradient(150deg, ${n.cover_color}, #0e0e1c 140%)` }}
                >
                  <span className="serif-title text-3xl text-white/90">{n.title.slice(0, 2)}</span>
                </div>
              </Link>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="serif-title truncate text-base text-ink">{n.title}</h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                        n.is_public === 0
                          ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                          : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                      }`}
                      onClick={(e) => {
                        e.preventDefault();
                        void toggleVisibility(n);
                      }}
                      disabled={togglingId === n.id}
                      title={n.is_public === 0 ? "当前为私密作品（仅自己可见），点击切换为公开" : "当前为公开作品（全站可见），点击切换为私密"}
                    >
                      {n.is_public === 0 ? <Lock size={10} /> : <Globe size={10} />}
                      <span>{togglingId === n.id ? "…" : n.is_public === 0 ? "私密" : "公开"}</span>
                    </button>
                    <span className="shrink-0 rounded bg-primary-soft px-2 py-0.5 text-[10px] text-primary-2">
                      {n.status}
                    </span>
                  </div>
                </div>
                <p className="mt-1 flex items-center gap-3 text-xs text-ink-3">
                  <span>{n.genre}</span>
                  <span>{(n.word_count / 10000).toFixed(1)} 万字</span>
                </p>
                <div className="mt-3 flex gap-2">
                  <Link to={`/author/book/${n.id}`} className="btn-ghost !min-h-8 flex-1 !px-2 text-xs">
                    <PenLine size={13} /> 写作
                  </Link>
                  <Link to={`/author/book/${n.id}/characters`} className="btn-ghost !min-h-8 !px-2 text-xs" aria-label="人物">
                    <Users size={13} />
                  </Link>
                  <Link to={`/author/book/${n.id}/map`} className="btn-ghost !min-h-8 !px-2 text-xs" aria-label="地图">
                    <MapIcon size={13} />
                  </Link>
                  <button
                    className="btn-danger !min-h-8 !px-2 text-xs"
                    onClick={() => void remove(n)}
                    aria-label="删除"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
