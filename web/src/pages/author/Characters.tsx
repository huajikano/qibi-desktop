import { memo, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckSquare,
  Map as MapIcon,
  PenLine,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  UserPlus,
  Wand2,
  X,
} from "lucide-react";
import { api, characterAiApi } from "../../api";
import { ConfirmDialog, PromptDialog } from "../../components/Dialog";
import type { Character, Novel } from "../../types";

const ROLES = ["主角", "配角", "反派", "路人", "重要角色", "主要配角", "次要角色"];
const GENDERS = ["男", "女", "未知", "其他"];

function normalizeRelationships(raw: any): { name: string; relation: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r: any) => ({
    name: String(r?.name || r?.target || "").trim(),
    relation: String(r?.relation || "").trim(),
  })).filter((r) => r.name.length > 0);
}

export default function Characters() {
  const { id } = useParams();
  const novelId = Number(id);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chars, setChars] = useState<Character[]>([]);
  const [editing, setEditing] = useState<Character | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // AI 提取人物与审核
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiExtracting, setAiExtracting] = useState(false);
  const [aiImporting, setAiImporting] = useState(false);
  const [aiScope, setAiScope] = useState<"all" | "recent">("all");
  const [extractedList, setExtractedList] = useState<Array<Partial<Character> & { selected?: boolean; isExisting?: boolean }>>([]);
  const [aiMsg, setAiMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [analyzedInfo, setAnalyzedInfo] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [n, cs] = await Promise.all([
        api.get<Novel>(`/novels/${novelId}`),
        api.get<Character[]>(`/novels/${novelId}/characters`),
      ]);
      setNovel(n);
      // 同时加载角色动态账本
      let statesMap = new Map();
      try {
        const states = await api.get<any[]>(`/novels/${novelId}/character-states`);
        statesMap = new Map(states.map(s => [s.character_id, s]));
      } catch {
        // 动态账本为可选功能，加载失败不影响主流程
      }
      setChars(cs.map((c) => ({ ...c, relationships: normalizeRelationships(c.relationships), state: statesMap.get(c.id) })));
    } catch (err: any) {
      setError(err?.message || "人物加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startAiExtract = async () => {
    setAiExtracting(true);
    setAiMsg(null);
    try {
      const res = await characterAiApi.extract(novelId, { scope: aiScope });
      const existingNames = new Set(chars.map((c) => c.name.trim()));
      const items = res.characters.map((c) => ({
        ...c,
        relationships: normalizeRelationships(c.relationships),
        selected: true,
        isExisting: existingNames.has(c.name.trim()),
      }));
      setExtractedList(items);
      setAnalyzedInfo(`已分析 ${res.analyzedChapters} 章节正文，提取出 ${items.length} 个人物设定`);
    } catch (err: any) {
      setAiMsg({ kind: "err", text: err.message || "AI 提取角色失败，请检查 API 配置" });
    } finally {
      setAiExtracting(false);
    }
  };

  const handleBatchImport = async () => {
    const selected = extractedList.filter((c) => c.selected && c.name?.trim());
    if (!selected.length) {
      setAiMsg({ kind: "err", text: "请至少勾选一个待导入的人物" });
      return;
    }
    setAiImporting(true);
    setAiMsg(null);
    try {
      const res = await characterAiApi.batchImport(novelId, selected);
      setChars(res.characters.map((c) => ({ ...c, relationships: normalizeRelationships(c.relationships) })));
      setAiModalOpen(false);
      setExtractedList([]);
    } catch (err: any) {
      setAiMsg({ kind: "err", text: err.message || "批量导入失败" });
    } finally {
      setAiImporting(false);
    }
  };

  const addChar = async (name: string) => {
    setAddOpen(false);
    const c = await api.post<Character>(`/novels/${novelId}/characters`, { name });
    setChars((cs) => [...cs, { ...c, relationships: normalizeRelationships(c.relationships) }]);
  };

  const save = useCallback(async (c: Character) => {
    const { character } = await api.patch<{ character: Character }>(`/characters/${c.id}`, { ...c, relationships: c.relationships });
    setEditing(null);
    setChars((cs) => cs.map((x) => (x.id === character.id ? { ...character, relationships: normalizeRelationships(character.relationships) } : x)));
  }, []);

  const remove = async (c: Character) => {
    setRemoving(null);
    await api.del(`/characters/${c.id}`);
    setChars((cs) => cs.filter((x) => x.id !== c.id));
  };

  const requestRemove = useCallback((c: Character) => setRemoving(c), []);
  const requestEdit = useCallback((c: Character) => setEditing({ ...c }), []);

  if (loading) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-ink-2">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm">人物加载中…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4 text-center text-ink-2">
        <div>
          <p className="text-sm text-red-300">{error}</p>
          <button className="btn-ghost mt-4 text-xs" onClick={() => void load()}>重新加载</button>
        </div>
      </div>
    );
  }

  if (!novel) return <div className="px-4 py-16 text-center text-ink-2">作品不存在</div>;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link to={`/author/book/${novelId}`} className="btn-ghost !min-h-9 !px-3 text-xs">
          <ArrowLeft size={14} /> 返回写作台
        </Link>
        <div>
          <h1 className="serif-title text-2xl text-ink">{novel.title} · 人物库</h1>
          <p className="mt-1 text-sm text-ink-2">共 {chars.length} 个人物</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link to={`/author/book/${novelId}/map`} className="btn-ghost !min-h-9 !px-3 text-xs">
            <MapIcon size={14} /> 地图
          </Link>
          <button
            className="btn-ghost !min-h-9 !px-3 text-xs border border-primary-2/40 text-primary-2 hover:bg-primary-soft"
            onClick={() => { setAiModalOpen(true); setAiMsg(null); }}
          >
            <Sparkles size={14} /> AI 正文提取人物
          </button>
          <button className="btn-primary !min-h-9 !px-3 text-xs" onClick={() => setAddOpen(true)}>
            <UserPlus size={14} /> 新建人物
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {chars.map((c) => (
          <CharacterCard key={c.id} character={c} onEdit={requestEdit} onDelete={requestRemove} />
        ))}
        {chars.length === 0 && (
          <div className="card col-span-full p-12 text-center text-sm text-ink-2">
            还没有人物。可点击「AI 正文提取人物」自动扫描小说正文生成人物卡，也可点击「新建人物」手动录入。
          </div>
        )}
      </div>

      <PromptDialog
        open={addOpen}
        title="新建人物"
        label="人物名"
        placeholder="如：李逍遥"
        onSubmit={(name) => void addChar(name)}
        onCancel={() => setAddOpen(false)}
      />

      <ConfirmDialog
        open={!!removing}
        title="删除人物"
        message={removing ? `确定删除人物「${removing.name}」？（地图上的标点将失去关联）` : ""}
        danger
        onConfirm={() => removing && void remove(removing)}
        onCancel={() => setRemoving(null)}
      />

      {/* AI 提取与审核确认弹窗 */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-surface shadow-2xl">
            {/* 弹窗顶栏 */}
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Sparkles className="text-primary-2" size={18} />
                <h2 className="serif-title text-base text-ink">AI 正文提取角色设定与审核确认</h2>
              </div>
              <button
                className="rounded p-1 text-ink-3 hover:text-ink"
                onClick={() => setAiModalOpen(false)}
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            {/* 弹窗内容 */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 控制面板 */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3 text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-ink-2">分析范围：</span>
                  <label className="flex items-center gap-1.5 cursor-pointer text-ink">
                    <input
                      type="radio"
                      name="scope"
                      checked={aiScope === "all"}
                      onChange={() => setAiScope("all")}
                      disabled={aiExtracting}
                    />
                    全部已有章节
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-ink">
                    <input
                      type="radio"
                      name="scope"
                      checked={aiScope === "recent"}
                      onChange={() => setAiScope("recent")}
                      disabled={aiExtracting}
                    />
                    最近章节
                  </label>
                </div>
                <button
                  className="btn-primary !min-h-8 !px-3 text-xs"
                  onClick={() => void startAiExtract()}
                  disabled={aiExtracting}
                >
                  {aiExtracting ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" /> AI 分析正文中…
                    </>
                  ) : (
                    <>
                      <Wand2 size={13} /> {extractedList.length ? "重新分析正文" : "开始提取人物"}
                    </>
                  )}
                </button>
              </div>

              {analyzedInfo && (
                <div className="rounded border border-primary-2/30 bg-primary-soft px-3 py-2 text-xs text-primary-2">
                  ✨ {analyzedInfo}
                </div>
              )}

              {aiMsg && (
                <div className={`rounded-md border p-3 text-xs ${aiMsg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/40 bg-red-500/10 text-red-200"}`}>
                  <p className="whitespace-pre-wrap leading-relaxed">{aiMsg.text}</p>
                  {aiMsg.kind === "err" && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <Link to="/settings" className="btn-primary !min-h-7 !px-2.5 text-[11px]">
                        前往「设置」检查角色与地图 API 配置
                      </Link>
                      <button type="button" className="btn-ghost !min-h-7 !px-2 text-[11px]" onClick={() => setAiMsg(null)}>
                        关闭
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 提取结果审核表格 */}
              {extractedList.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-ink-2">
                    <div className="flex items-center gap-3">
                      <button
                        className="hover:text-ink underline"
                        onClick={() => setExtractedList((items) => items.map((c) => ({ ...c, selected: true })))}
                      >
                        全选
                      </button>
                      <button
                        className="hover:text-ink underline"
                        onClick={() => setExtractedList((items) => items.map((c) => ({ ...c, selected: false })))}
                      >
                        全不选
                      </button>
                      <span className="text-ink-3">已选 {extractedList.filter((c) => c.selected).length} / {extractedList.length} 人</span>
                    </div>
                    <span className="text-ink-3">可直接在下方表格修改属性后再导入</span>
                  </div>

                  <div className="space-y-2.5">
                    {extractedList.map((item, idx) => (
                      <div
                        key={idx}
                        className={`rounded-lg border p-3.5 transition-colors ${
                          item.selected ? "border-primary-2/40 bg-surface-2" : "border-border bg-surface opacity-60"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <button
                            type="button"
                            className="text-primary-2 mr-1"
                            onClick={() =>
                              setExtractedList((items) =>
                                items.map((c, i) => (i === idx ? { ...c, selected: !c.selected } : c))
                              )
                            }
                          >
                            {item.selected ? <CheckSquare size={16} /> : <Square size={16} />}
                          </button>
                          <input
                            className="input font-medium text-xs !w-28 !py-1"
                            value={item.name || ""}
                            onChange={(e) =>
                              setExtractedList((items) =>
                                items.map((c, i) => (i === idx ? { ...c, name: e.target.value } : c))
                              )
                            }
                            placeholder="姓名"
                          />
                          <input
                            className="input text-xs !w-24 !py-1"
                            value={item.alias || ""}
                            onChange={(e) =>
                              setExtractedList((items) =>
                                items.map((c, i) => (i === idx ? { ...c, alias: e.target.value } : c))
                              )
                            }
                            placeholder="称号/别名"
                          />
                          <select
                            className="input text-xs !w-24 !py-1"
                            value={item.role || "主要配角"}
                            onChange={(e) =>
                              setExtractedList((items) =>
                                items.map((c, i) => (i === idx ? { ...c, role: e.target.value } : c))
                              )
                            }
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                          <select
                            className="input text-xs !w-20 !py-1"
                            value={item.gender || "未知"}
                            onChange={(e) =>
                              setExtractedList((items) =>
                                items.map((c, i) => (i === idx ? { ...c, gender: e.target.value } : c))
                              )
                            }
                          >
                            {GENDERS.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                          <input
                            className="input text-xs !w-20 !py-1"
                            value={item.age || ""}
                            onChange={(e) =>
                              setExtractedList((items) =>
                                items.map((c, i) => (i === idx ? { ...c, age: e.target.value } : c))
                              )
                            }
                            placeholder="年龄"
                          />
                          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${
                            item.isExisting ? "bg-amber-500/10 text-amber-300" : "bg-emerald-500/10 text-emerald-400"
                          }`}>
                            {item.isExisting ? "已有同名（合并完善）" : "新人物"}
                          </span>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-3 text-xs">
                          <div>
                            <label className="block text-[10px] text-ink-3 mb-0.5">性格特点</label>
                            <textarea
                              className="input text-xs w-full resize-y !py-1"
                              rows={2}
                              value={item.personality || ""}
                              onChange={(e) =>
                                setExtractedList((items) =>
                                  items.map((c, i) => (i === idx ? { ...c, personality: e.target.value } : c))
                                )
                              }
                              placeholder="性格处事"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-ink-3 mb-0.5">容貌外在</label>
                            <textarea
                              className="input text-xs w-full resize-y !py-1"
                              rows={2}
                              value={item.appearance || ""}
                              onChange={(e) =>
                                setExtractedList((items) =>
                                  items.map((c, i) => (i === idx ? { ...c, appearance: e.target.value } : c))
                                )
                              }
                              placeholder="外表衣着"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-ink-3 mb-0.5">背景身世</label>
                            <textarea
                              className="input text-xs w-full resize-y !py-1"
                              rows={2}
                              value={item.background || ""}
                              onChange={(e) =>
                                setExtractedList((items) =>
                                  items.map((c, i) => (i === idx ? { ...c, background: e.target.value } : c))
                                )
                              }
                              placeholder="门派/经历/身份"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!extractedList.length && !aiExtracting && (
                <div className="py-12 text-center text-xs text-ink-3">
                  点击上方「开始提取人物」，AI 将自动扫描小说正文并归纳所有角色档案以供审核。
                </div>
              )}
            </div>

            {/* 弹窗底栏 */}
            <div className="flex items-center justify-between border-t border-border px-5 py-3.5 bg-surface-2/50">
              <span className="text-xs text-ink-3">
                {extractedList.length ? `准备导入 ${extractedList.filter((c) => c.selected).length} 个人物` : "支持一键审核与批量导入"}
              </span>
              <div className="flex gap-2">
                <button
                  className="btn-ghost !min-h-9 !px-3 text-xs"
                  onClick={() => setAiModalOpen(false)}
                >
                  取消
                </button>
                <button
                  className="btn-primary !min-h-9 !px-4 text-xs"
                  onClick={() => void handleBatchImport()}
                  disabled={aiImporting || !extractedList.some((c) => c.selected && c.name?.trim())}
                >
                  {aiImporting ? "导入中…" : `确认导入 (${extractedList.filter((c) => c.selected && c.name?.trim()).length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <EditCharacterModal character={editing} onSave={save} onCancel={() => setEditing(null)} />
    </div>
  );
}

// 单个人物卡片：memo 避免编辑弹层输入时整网格重渲染
const CharacterCard = memo(function CharacterCard({
  character: c,
  onEdit,
  onDelete,
}: {
  character: Character;
  onEdit: (c: Character) => void;
  onDelete: (c: Character) => void;
}) {
  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="serif-title text-base text-ink">{c.name}</h3>
          {c.alias && <p className="text-xs text-ink-3">「{c.alias}」</p>}
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded bg-primary-soft px-2 py-0.5 text-xs text-primary-2">
            {c.role || "配角"}
          </span>
          <button
            className="rounded p-1 text-ink-3 hover:text-ink"
            onClick={() => onEdit(c)}
            aria-label="编辑人物"
          >
            <PenLine size={13} />
          </button>
          <button
            className="rounded p-1 text-ink-3 hover:text-red-300"
            onClick={() => onDelete(c)}
            aria-label="删除人物"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="mt-2 flex gap-3 text-xs text-ink-3">
        {c.gender && <span>{c.gender}</span>}
        {c.age && <span>{c.age}</span>}
      </div>

      {c.personality && (
        <p className="mt-2 text-xs leading-5 text-ink-2 line-clamp-2">
          <strong className="text-ink-3">性格：</strong>
          {c.personality}
        </p>
      )}

      {c.appearance && (
        <p className="mt-1 text-xs leading-5 text-ink-2 line-clamp-2">
          <strong className="text-ink-3">外貌：</strong>
          {c.appearance}
        </p>
      )}

      {c.background && (
        <p className="mt-1 text-xs leading-5 text-ink-2 line-clamp-2">
          <strong className="text-ink-3">背景：</strong>
          {c.background}
        </p>
      )}

      {/* 动态账本卡片：展示角色最新状态 */}
      {c.state && (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary-soft/40 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-primary-2 mb-1.5">
            <RefreshCw size={11} />
            <span>动态账本</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {c.state.current_location && (
              <div>
                <span className="text-ink-3">位置：</span>
                <span className="text-ink-2">{c.state.current_location}</span>
              </div>
            )}
            {(() => {
              let typeData: any = {};
              try { typeData = JSON.parse(c.state.type_specific_data || "{}"); } catch {}
              const realm = typeData.realm || typeData.relationship || typeData.suspicion || typeData.title || typeData.level;
              return realm && (
                <div>
                  <span className="text-ink-3">状态：</span>
                  <span className="text-primary-2 font-medium">{realm}</span>
                </div>
              );
            })()}
          </div>
          {c.state.recent_events && (
            <p className="text-[10px] text-ink-3 line-clamp-1 mt-1">
              {c.state.recent_events}
            </p>
          )}
        </div>
      )}

      {Array.isArray(c.relationships) && c.relationships.length > 0 && (
        <div className="mt-auto pt-3 border-t border-border/50 text-[11px] text-ink-3 flex flex-wrap gap-1">
          {c.relationships.map((r, i) => (
            <span key={i} className="rounded bg-surface-2 px-1.5 py-0.5">
              {r.name} · {r.relation}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

// 人物编辑弹层：独立组件，自管 form state
function EditCharacterModal({
  character,
  onSave,
  onCancel,
}: {
  character: Character | null;
  onSave: (c: Character) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Character | null>(character);
  const [saving, setSaving] = useState(false);
  const [newTarget, setNewTarget] = useState("");
  const [newRelation, setNewRelation] = useState("");

  useEffect(() => {
    setForm(character ? { ...character, relationships: normalizeRelationships(character.relationships) } : null);
  }, [character]);

  if (!character || !form) return null;

  const addRel = () => {
    if (!newTarget.trim() || !newRelation.trim()) return;
    setForm((f) => f && {
      ...f,
      relationships: [...normalizeRelationships(f.relationships), { name: newTarget.trim(), relation: newRelation.trim() }],
    });
    setNewTarget("");
    setNewRelation("");
  };

  const delRel = (idx: number) => {
    setForm((f) => f && {
      ...f,
      relationships: normalizeRelationships(f.relationships).filter((_, i) => i !== idx),
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="card flex max-h-[90vh] w-full max-w-2xl flex-col p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="serif-title text-lg text-ink">编辑人物 · {form.name}</h2>
          <button className="rounded p-1 text-ink-3 hover:text-ink" onClick={onCancel} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-ink-2">姓名</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-2">称号 / 别名</label>
              <input
                className="input"
                value={form.alias || ""}
                onChange={(e) => setForm((f) => f && { ...f, alias: e.target.value })}
                placeholder="如：剑仙、青莲居士"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-ink-2">角色定位</label>
              <select
                className="input"
                value={form.role || "配角"}
                onChange={(e) => setForm((f) => f && { ...f, role: e.target.value })}
              >
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-2">性别</label>
              <select
                className="input"
                value={form.gender || "未知"}
                onChange={(e) => setForm((f) => f && { ...f, gender: e.target.value })}
              >
                {GENDERS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-2">年龄</label>
              <input
                className="input"
                value={form.age || ""}
                onChange={(e) => setForm((f) => f && { ...f, age: e.target.value })}
                placeholder="如：18 岁"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-2">性格特征</label>
            <textarea
              className="input resize-y"
              rows={2}
              value={form.personality || ""}
              onChange={(e) => setForm((f) => f && { ...f, personality: e.target.value })}
              placeholder="如：外冷内热，重情重义，杀伐果断…"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-2">容貌外貌</label>
            <textarea
              className="input resize-y"
              rows={2}
              value={form.appearance || ""}
              onChange={(e) => setForm((f) => f && { ...f, appearance: e.target.value })}
              placeholder="如：白衣胜雪，身负长剑，眉目清冷…"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-2">背景经历</label>
            <textarea
              className="input resize-y"
              rows={3}
              value={form.background || ""}
              onChange={(e) => setForm((f) => f && { ...f, background: e.target.value })}
              placeholder="如：蜀山派大弟子，自幼父母双亡…"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-2">人物关系</label>
            <div className="space-y-2">
              {normalizeRelationships(form.relationships).map((r, i) => (
                <div key={i} className="flex items-center gap-2 rounded bg-surface-2 px-3 py-1.5 text-xs">
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="text-ink-3">·</span>
                  <span className="text-ink-2">{r.relation}</span>
                  <button className="ml-auto text-ink-3 hover:text-red-300" onClick={() => delRel(i)}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <input
                  className="input !py-1 text-xs"
                  placeholder="关联人物"
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                />
                <input
                  className="input !py-1 text-xs"
                  placeholder="关系（如：师徒）"
                  value={newRelation}
                  onChange={(e) => setNewRelation(e.target.value)}
                />
                <button type="button" className="btn-ghost !min-h-7 !px-2 text-xs" onClick={addRel}>
                  <Plus size={12} /> 添加
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn-primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
