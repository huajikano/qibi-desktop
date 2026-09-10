import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, BookOpen, Check, FileText, LoaderCircle, Plus, RefreshCw, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { ApiError, api, distillAuthorStream, skillAuthorApi, uploadSourceFile } from "../../api";
import type { AiSettings, DistilledAuthor, DistilledAuthorDetail, DistilledAuthorSource, DistilledAuthorVersion } from "../../types";

const formatBytes = (bytes: number) => {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export default function DistillAuthor() {
  const [searchParams] = useSearchParams();
  const novelId = searchParams.get("novelId");
  const [authors, setAuthors] = useState<DistilledAuthor[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DistilledAuthorDetail | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const [stage, setStage] = useState("");
  const [stageStatus, setStageStatus] = useState<Record<string, string>>({});
  const [streamText, setStreamText] = useState("");
  const [activeVersion, setActiveVersion] = useState<DistilledAuthorVersion | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const distillConfig = aiSettings?.distill || aiSettings;
  const selectedAuthor = useMemo(() => authors.find((author) => author.id === selectedId) || null, [authors, selectedId]);

  const loadAuthors = async () => {
    const list = await skillAuthorApi.list();
    setAuthors(list);
    if (selectedId && list.some((author) => author.id === selectedId)) return;
    if (list[0]) setSelectedId(list[0].id);
  };

  const loadDetail = async (id: number) => {
    const value = await skillAuthorApi.detail(id);
    setDetail(value);
    setActiveVersion(value.current_version || value.versions[0] || null);
  };

  useEffect(() => {
    void loadAuthors().finally(() => setLoading(false));
    void api.get<AiSettings>("/ai/settings").then(setAiSettings).catch(() => setAiSettings(null));
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId]);

  const createAuthor = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError("");
    try {
      const author = await skillAuthorApi.create(trimmed);
      setName("");
      setAuthors((items) => [author, ...items]);
      setSelectedId(author.id);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : err?.message || "创建作者失败");
    } finally {
      setCreating(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || !selectedId) return;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        await uploadSourceFile(selectedId, file, {
          onProgress: (received, total) => setStage(`正在上传 ${file.name}：${Math.round(received / total * 100)}%`),
        });
      }
      await loadDetail(selectedId);
      await loadAuthors();
      setStage("材料上传并解析完成");
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : err?.message || "材料上传失败");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const runDistill = async (evolve: boolean) => {
    if (!selectedId || !detail?.sources.some((source) => source.status === "ready")) return;
    setBusy(true);
    setError("");
    setStage("");
    setStageStatus({});
    setStreamText("");
    try {
      await distillAuthorStream(selectedId, { sourceIds: detail.sources.filter((source) => source.status === "ready").map((source) => source.id) }, (event) => {
        if (event.type === "stage" && event.stage) {
          setStage(event.stage);
          setStageStatus((items) => ({ ...items, [event.stage as string]: event.status || "running" }));
        }
        if (event.type === "delta" && event.text) setStreamText((text) => text + event.text);
        if (event.type === "preview" && event.version) {
          setActiveVersion(event.version);
          setStage("生成完成");
        }
      }, { evolve });
      await loadDetail(selectedId);
      await loadAuthors();
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : err?.message || "蒸馏失败");
    } finally {
      setBusy(false);
    }
  };

  const removeSource = async (source: DistilledAuthorSource) => {
    if (!selectedId) return;
    setError("");
    try {
      await skillAuthorApi.removeSource(source.id);
      await loadDetail(selectedId);
    } catch (err: any) {
      setError(err?.message || "删除材料失败");
    }
  };

  const deleteAuthor = async (author: DistilledAuthor) => {
    if (!confirm(`确定要删除蒸馏作者「${author.name}」及其所有上传材料与生成的 Skill 吗？此操作不可恢复。`)) return;
    setBusy(true);
    setError("");
    try {
      await skillAuthorApi.remove(author.id);
      const nextList = authors.filter((a) => a.id !== author.id);
      setAuthors(nextList);
      if (selectedId === author.id) {
        setSelectedId(nextList[0]?.id || null);
      }
    } catch (err: any) {
      setError(err?.message || "删除作者失败");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (version: DistilledAuthorVersion) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await skillAuthorApi.rollback(selectedId, version.id);
      await loadDetail(selectedId);
      await loadAuthors();
    } catch (err: any) {
      setError(err?.message || "回滚失败");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="grid min-h-[60vh] place-items-center text-ink-2"><LoaderCircle className="animate-spin" /></div>;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link to={novelId ? `/author/book/${novelId}` : "/author"} className="btn-ghost !min-h-9 !px-3 text-xs"><ArrowLeft size={14} /> 返回</Link>
        <div>
          <h1 className="serif-title text-2xl text-ink">蒸馏作者</h1>
          <p className="mt-1 text-sm text-ink-2">导入你拥有或获授权使用的小说材料，生成可供写作助手使用的风格 Skill。</p>
        </div>
      </div>

      <div className="mb-5 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-ink">
              <Sparkles size={15} className="text-primary-2" />
              <span>蒸馏使用“设置”中的蒸馏专用 AI 配置</span>
              <span className={"rounded-full px-2 py-0.5 text-[10px] " + (distillConfig?.keyConfigured ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300")}>
                {distillConfig === null || distillConfig === undefined ? "读取中" : distillConfig.keyConfigured ? "已配置" : "未配置"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-ink-3">
              {distillConfig?.keyConfigured ? ("当前来源：" + (distillConfig.keySource === "session" ? "本次会话" : distillConfig.keySource === "user-db" ? "账号加密配置" : "站方配置") + "；协议：" + distillConfig.protocol + "；模型：" + (distillConfig.model || "默认")) : "开始蒸馏前，请前往设置配置蒸馏作者专用的 API Key、Base URL、协议和模型。"}
            </p>
          </div>
          <Link to="/settings" className="btn-ghost !min-h-9 !px-3 text-xs">
            前往设置配置 API
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="card h-fit p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="serif-title text-sm text-ink">作者列表</h2>
            <Sparkles size={15} className="text-primary-2" />
          </div>
          <div className="space-y-1.5">
            {authors.map((author) => (
              <div key={author.id} className="group relative flex items-center">
                <button
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm pr-8 ${author.id === selectedId ? "border-primary-2/50 bg-primary-soft text-primary-2" : "border-border text-ink-2 hover:text-ink"}`}
                  onClick={() => setSelectedId(author.id)}
                >
                  <span className="block truncate">{author.name}</span>
                  <span className="mt-0.5 block text-[10px] opacity-70">{author.status === "ready" ? "已有 Skill" : "待导入材料"}</span>
                </button>
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-3 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                  title={`删除作者「${author.name}」`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteAuthor(author);
                  }}
                  disabled={busy}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {!authors.length && <p className="py-3 text-xs text-ink-3">还没有蒸馏作者。</p>}
          </div>
          <div className="mt-4 border-t border-border pt-4">
            <label className="mb-1.5 block text-xs text-ink-2">新建作者</label>
            <div className="flex gap-2">
              <input className="input min-w-0 flex-1 !py-2 text-xs" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createAuthor(); }} placeholder="如：作者风格一" />
              <button className="btn-primary !min-h-9 !px-2.5" onClick={() => void createAuthor()} disabled={creating || !name.trim()} aria-label="创建作者"><Plus size={15} /></button>
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-5">
          {!selectedAuthor || !detail ? (
            <div className="card p-12 text-center text-sm text-ink-2">请先创建或选择一个作者。</div>
          ) : (
            <>
              <div className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="serif-title text-xl text-ink">{selectedAuthor.name}</h2>
                    <p className="mt-1 text-xs text-ink-3">{detail.sources.length} 份材料 · {detail.versions.length} 个版本</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input ref={fileRef} type="file" multiple accept=".txt,.epub,.md,.html,.htm,.json" className="hidden" onChange={(event) => void uploadFiles(event.target.files)} />
                    <button className="btn-ghost !min-h-9 !px-3 text-xs" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={14} /> 导入小说</button>
                    <button className="btn-primary !min-h-9 !px-3 text-xs" onClick={() => void runDistill(false)} disabled={busy || !detail.sources.some((source) => source.status === "ready")}><Wand2 size={14} /> 开始蒸馏</button>
                    <button className="btn-ghost !min-h-9 !px-3 text-xs" onClick={() => void runDistill(true)} disabled={busy || !detail.current_version || !detail.sources.some((source) => source.status === "ready")}><RefreshCw size={14} /> 追加进化</button>
                    <button className="btn-danger !min-h-9 !px-3 text-xs" onClick={() => void deleteAuthor(selectedAuthor)} disabled={busy} title="删除此作者"><Trash2 size={14} /> 删除作者</button>
                  </div>
                </div>
                {stage && <div className="mt-4 rounded-md border border-primary-2/30 bg-primary-soft px-3 py-2 text-xs text-primary-2">{stage}</div>}
                {error && (
                  <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-3.5 text-xs text-red-200">
                    <div className="flex items-start gap-2">
                      <Trash2 className="hidden" /> {/* keep icon ref if needed */}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-red-300">蒸馏过程遇到问题：</p>
                        <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs leading-relaxed text-red-200/90">{error}</pre>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Link to="/settings" className="btn-primary !min-h-7 !px-2.5 text-[11px]">
                            前往「设置」配置或修正 API
                          </Link>
                          <button
                            type="button"
                            className="btn-ghost !min-h-7 !px-2 text-[11px]"
                            onClick={() => setError("")}
                          >
                            关闭提示
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="card p-5">
                <h3 className="mb-3 flex items-center gap-2 text-sm text-ink"><BookOpen size={15} className="text-primary-2" /> 材料</h3>
                <div className="space-y-2">
                  {detail.sources.map((source) => (
                    <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
                      <FileText size={16} className="shrink-0 text-ink-3" />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm text-ink">{source.filename}</p><p className="text-[10px] text-ink-3">{formatBytes(source.size_bytes)} · {source.parsed_chars.toLocaleString()} 字 · {source.chapter_count} 章</p></div>
                      <span className={`text-[10px] ${source.status === "ready" ? "text-emerald-400" : source.status === "error" ? "text-red-300" : "text-amber-300"}`}>{source.status === "ready" ? "已解析" : source.status === "error" ? source.error || "解析失败" : "处理中"}</span>
                      <button className="rounded p-1 text-ink-3 hover:text-red-300" onClick={() => void removeSource(source)} aria-label={`删除 ${source.filename}`}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  {!detail.sources.length && <p className="py-5 text-center text-xs text-ink-3">支持多个 TXT/EPUB 文件，单文件最大 100MB。</p>}
                </div>
              </div>

              {(streamText || Object.keys(stageStatus).length > 0) && (
                <div className="card p-5">
                  <h3 className="mb-3 flex items-center gap-2 text-sm text-ink"><LoaderCircle size={15} className={busy ? "animate-spin text-primary-2" : "text-emerald-400"} /> 蒸馏进度</h3>
                  <div className="mb-3 flex flex-wrap gap-2">{["writing", "persona", "merge"].map((item) => <span key={item} className={`rounded-full border px-2 py-1 text-[10px] ${stageStatus[item] === "done" ? "border-emerald-500/30 text-emerald-400" : stageStatus[item] === "running" ? "border-primary-2/40 text-primary-2" : "border-border text-ink-3"}`}>{stageStatus[item] === "done" && <Check size={11} className="mr-1 inline" />}{item === "writing" ? "写作能力" : item === "persona" ? "作者人格" : "合并 Skill"}</span>)}</div>
                  {streamText && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-xs leading-5 text-ink-2">{streamText}</pre>}
                </div>
              )}

              {activeVersion && (
                <div className="card p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="serif-title text-base text-ink">当前 Skill · v{activeVersion.version}</h3><span className="text-xs text-ink-3">{activeVersion.created_at}</span></div>
                  <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-4 text-xs leading-6 text-ink-2">{activeVersion.skill_markdown}</pre>
                  <details className="mt-4"><summary className="cursor-pointer text-xs text-link">查看 writing skill 与 author persona</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-xs leading-5 text-ink-2">{activeVersion.writing_skill}</pre><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-xs leading-5 text-ink-2">{activeVersion.author_persona}</pre></div></details>
                </div>
              )}

              {detail.versions.length > 0 && <div className="card p-5"><h3 className="mb-3 text-sm text-ink">版本管理</h3><div className="space-y-2">{detail.versions.map((version) => <div key={version.id} className="flex items-center gap-3 rounded border border-border px-3 py-2"><span className="text-sm text-ink">v{version.version}</span><span className="flex-1 text-xs text-ink-3">{version.sample_summary}</span><button className="btn-ghost !min-h-7 !px-2 text-[10px]" onClick={() => setActiveVersion(version)}>查看</button>{version.id !== detail.current_version_id && <button className="btn-ghost !min-h-7 !px-2 text-[10px]" onClick={() => void rollback(version)} disabled={busy}>回滚</button>}</div>)}</div></div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
