import { useEffect, useState } from "react";
import { Bot, Terminal, KeyRound, PenTool, RotateCcw, Save, AlertCircle, CheckCircle2, Trash2, ExternalLink, Plug, Sparkles, MapPin, Globe, ShieldCheck, Copy, Check, BookOpen, ChevronDown, ChevronUp, FileText, Smartphone, History, Users, Compass, HelpCircle, ScrollText, Upload, Power, Plus, Edit3, RefreshCw, Loader2, ListFilter } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../stores/auth";
import type { AiProtocol, AiSettings } from "../types";

type Msg = { kind: "ok" | "err"; text: string } | null;


const PROMPT_ROLES = [
  { id: "draft", name: "生成正文 (Draft)", badge: "✍️ 正文草稿", desc: "根据前文剧情、设定与本章细纲创作本章完整正文" },
  { id: "continue", name: "智能续写 (Continue)", badge: "⏩ 顺畅续写", desc: "紧承当前章节已有文本继续向下撰写" },
  { id: "deslop", name: "网文去AI味 (Deslop)", badge: "🌿 7 Gate 去味", desc: "彻底清除套路词、打破工整排比、动作化心理、生活化对话" },
  { id: "polish", name: "细节润色 (Polish)", badge: "🎨 细节润色", desc: "提升描写质感、修饰文笔与对话，保持剧情结构不变" },
  { id: "expand", name: "情节扩写 (Expand)", badge: "📖 丰满扩写", desc: "补充环境氛围、心理活动与细节动作，扩充篇幅" },
  { id: "review", name: "对抗审查 (Review)", badge: "⚖️ 对抗式审查", desc: "资深主编与老读者双重视角：毒点找茬、节奏诊断、人设与爽点打分" },
  { id: "analyze", name: "爆款拆文 (Analyze)", badge: "🔍 爆款拆文", desc: "深度拆解黄金三章、故事核、压抑与释放情绪曲线、金手指节奏" },
  { id: "outline", name: "生成细纲 (Outline)", badge: "📋 分章细纲", desc: "分析设定与全书脉络，规划后续章节的核心冲突与情节" },
  { id: "summary", name: "章节摘要 (Summary)", badge: "📝 章节总结", desc: "提炼本章核心剧情为150字以内的速览摘要" },
  { id: "suggest", name: "剧情顾问 (Suggest)", badge: "💡 创作顾问", desc: "解答作者创作疑难，提供情节构思与前后一致的伏笔建议" },
];

interface NetworkInfo {
  ok: boolean;
  host: string;
  port: number;
  isNetworkMode: boolean;
  localUrls: string[];
  lanUrls: string[];
  dataDir: string;
  databaseFile: string;
  uptimeSeconds: number;
}


export default function Settings() {
  const { user } = useAuth();
  // 1. 小说写作助手配置状态
  const [writerKey, setWriterKey] = useState("");
  const [writerBaseUrl, setWriterBaseUrl] = useState("");
  const [writerProtocol, setWriterProtocol] = useState<AiProtocol>("auto");
  const [writerModel, setWriterModel] = useState("");
  const [writerMode, setWriterMode] = useState<"session" | "persist">("persist");
  const [writerBusy, setWriterBusy] = useState(false);
  const [writerMsg, setWriterMsg] = useState<Msg>(null);

  // 2. 蒸馏作者专用配置状态
  const [distillKey, setDistillKey] = useState("");
  const [distillBaseUrl, setDistillBaseUrl] = useState("");
  const [distillProtocol, setDistillProtocol] = useState<AiProtocol>("auto");
  const [distillModel, setDistillModel] = useState("");
  const [distillMode, setDistillMode] = useState<"session" | "persist">("persist");
  const [distillBusy, setDistillBusy] = useState(false);
  const [distillMsg, setDistillMsg] = useState<Msg>(null);

  // 3. 角色与地图专用配置状态（两者共用此 API Key）
  const [worldKey, setWorldKey] = useState("");
  const [worldBaseUrl, setWorldBaseUrl] = useState("");
  const [worldProtocol, setWorldProtocol] = useState<AiProtocol>("auto");
  const [worldModel, setWorldModel] = useState("");
  const [worldMode, setWorldMode] = useState<"session" | "persist">("persist");
  const [worldBusy, setWorldBusy] = useState(false);
  const [worldMsg, setWorldMsg] = useState<Msg>(null);

  

  // 3.1 管家 Agent 专用配置状态
  const [agentKey, setAgentKey] = useState("");
  const [agentBaseUrl, setAgentBaseUrl] = useState("");
  const [agentProtocol, setAgentProtocol] = useState<AiProtocol>("auto");
  const [agentModel, setAgentModel] = useState("");
  const [agentMode, setAgentMode] = useState<"session" | "persist">("persist");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentMsg, setAgentMsg] = useState<Msg>(null);
  const [agentToolTesting, setAgentToolTesting] = useState(false);
  const [agentToolResult, setAgentToolResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 4. 小说写作助手提示词自定义状态
  const [selectedPromptRole, setSelectedPromptRole] = useState<string>("draft");
  const [defaultPrompts, setDefaultPrompts] = useState<Record<string, string>>({});
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});
  const [activePromptText, setActivePromptText] = useState<string>("");
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptMsg, setPromptMsg] = useState<Msg>(null);

  const loadPrompts = () => {
    return api.get<{ defaults: Record<string, string>; custom: Record<string, string> }>("/ai/prompts")
      .then((res) => {
        setDefaultPrompts(res.defaults || {});
        setCustomPrompts(res.custom || {});
      })
      .catch(() => undefined);
  };

  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // 各高级设置区块的折叠状态（默认全部收起，避免一打开页面就看到大量未配项）
  const [mcpAgentOpen, setMcpAgentOpen] = useState(false);
  const [mcpClientOpen, setMcpClientOpen] = useState(false);
  const [promptCustomOpen, setPromptCustomOpen] = useState(false);

  // 模型下拉列表（按 baseUrl+protocol+key 缓存）：writer/distill/world 三组独立
  type ModelFetchState = {
    open: boolean;
    busy: boolean;
    models: string[];
    source?: string;
    error?: string;
  };
  const [writerModels, setWriterModels] = useState<ModelFetchState>({ open: false, busy: false, models: [] });
  const [distillModels, setDistillModels] = useState<ModelFetchState>({ open: false, busy: false, models: [] });
  const [worldModels, setWorldModels] = useState<ModelFetchState>({ open: false, busy: false, models: [] });
  const [agentModels, setAgentModels] = useState<ModelFetchState>({ open: false, busy: false, models: [] });

  // MCP 客户端
  type ClientRec = {
    id: string; name: string; transport: "stdio" | "sse" | "http";
    command?: string; args?: string[]; env?: Record<string, string>;
    url?: string; status: string; errorMessage?: string;
    tools: Array<{ name: string; description?: string }>;
    prompts: Array<{ name: string; description?: string }>;
    resources: Array<{ uri: string; name?: string; mimeType?: string }>;
  };
  const [mcpClients, setMcpClients] = useState<ClientRec[]>([]);
  const [mcpKind, setMcpKind] = useState<"stdio" | "sse" | "http">("http");
  const [mcpName, setMcpName] = useState("");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpMsg, setMcpMsg] = useState<Msg>(null);

  // 5. 用户自定义 Skill 通用化
  type SkillRec = {
    id: number;
    name: string;
    slug: string;
    scope: "writer" | "distill" | "world" | "all";
    sourceKind: "manual" | "uploaded" | "distilled_author";
    sourceRef: string | null;
    content: string;
    enabled: boolean;
    priority: number;
    notes: string;
    createdAt: string;
    updatedAt: string;
  };
  const SKILL_SCOPES: Array<{ id: SkillRec["scope"]; label: string; desc: string; tone: string }> = [
    { id: "writer", label: "写作助手", desc: "注入到正文生成/续写/润色/扩写/审查/拆文等", tone: "bg-primary-2/15 text-primary-2 border-primary-2/30" },
    { id: "distill", label: "蒸馏作者", desc: "注入到蒸馏作者生成与风格提取", tone: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
    { id: "world", label: "角色与地图", desc: "注入到人物提取与世界地图生成", tone: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
    { id: "all", label: "全部场景", desc: "对所有 AI 场景都注入（请谨慎使用，可能与场景专属提示词冲突）", tone: "bg-rose-500/15 text-rose-500 border-rose-500/30" },
  ];

  const [skills, setSkills] = useState<SkillRec[]>([]);
  const [skillEditing, setSkillEditing] = useState<SkillRec | null>(null);
  const [skillCreating, setSkillCreating] = useState(false);
  const [skillFileName, setSkillFileName] = useState("skill.md");
  const [skillScopeFilter, setSkillScopeFilter] = useState<"all" | SkillRec["scope"]>("all");
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillMsg, setSkillMsg] = useState<Msg>(null);

  const loadSkills = async () => {
    try {
      const res = await api.get<{ skills: SkillRec[] }>("/user-skills");
      setSkills(res.skills || []);
    } catch {
      setSkills([]);
    }
  };

  useEffect(() => { void loadSkills(); }, []);

  const loadMcpClients = async () => {
    try {
      const res = await api.get<{ clients: ClientRec[] }>("/mcp/clients");
      setMcpClients(res.clients || []);
    } catch {
      setMcpClients([]);
    }
  };

  useEffect(() => { void loadMcpClients(); }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedUrl(text);
    setTimeout(() => setCopiedUrl(null), 2000);
  };


  const loadSettings = () => {
    return api.get<AiSettings>("/ai/settings").then((s) => {
      setSettings(s);
      const w = s.writer || s;
      setWriterBaseUrl(w.baseUrl || "");
      setWriterProtocol(w.protocol);
      setWriterModel(w.model || "");

      if (s.distill) {
        setDistillBaseUrl(s.distill.baseUrl || "");
        setDistillProtocol(s.distill.protocol);
        setDistillModel(s.distill.model || "");
      }


      if (s.agent) {
        setAgentBaseUrl(s.agent.baseUrl || "");
        setAgentProtocol(s.agent.protocol);
        setAgentModel(s.agent.model || "");
      }
      if (s.world) {
        setWorldBaseUrl(s.world.baseUrl || "");
        setWorldProtocol(s.world.protocol);
        setWorldModel(s.world.model || "");
      }
    }).catch(() => undefined);
  };

  useEffect(() => {
    void loadSettings();
    void loadPrompts();
    if (user?.role === "admin") {
      void api.get<NetworkInfo>("/system/network-info").then(setNetworkInfo).catch(() => setNetworkInfo(null));
    }
  }, [user?.role]);

  
  useEffect(() => {
    if (customPrompts[selectedPromptRole] !== undefined) {
      setActivePromptText(customPrompts[selectedPromptRole]);
    } else if (defaultPrompts[selectedPromptRole]) {
      setActivePromptText(defaultPrompts[selectedPromptRole]);
    }
  }, [selectedPromptRole, customPrompts, defaultPrompts]);

  const saveCurrentPrompt = async () => {
    setPromptBusy(true);
    setPromptMsg(null);
    try {
      const updated = { ...customPrompts, [selectedPromptRole]: activePromptText.trim() };
      const res = await api.post<{ ok: boolean; custom: Record<string, string>; defaults: Record<string, string> }>("/ai/prompts", {
        prompts: updated,
      });
      setCustomPrompts(res.custom || {});
      const roleObj = PROMPT_ROLES.find((r) => r.id === selectedPromptRole);
      setPromptMsg({ kind: "ok", text: `已成功保存「${roleObj?.name || selectedPromptRole}」的自定义提示词！` });
    } catch (err: any) {
      setPromptMsg({ kind: "err", text: err.message || "保存提示词失败" });
    } finally {
      setPromptBusy(false);
    }
  };

  const resetCurrentPrompt = async () => {
    const roleObj = PROMPT_ROLES.find((r) => r.id === selectedPromptRole);
    if (!confirm(`确定将「${roleObj?.name || selectedPromptRole}」的提示词恢复为官方默认预设吗？`)) return;
    setPromptBusy(true);
    setPromptMsg(null);
    try {
      const res = await api.post<{ ok: boolean; custom: Record<string, string>; defaults: Record<string, string> }>("/ai/prompts/reset", {
        role: selectedPromptRole,
      });
      setCustomPrompts(res.custom || {});
      setActivePromptText(res.defaults?.[selectedPromptRole] || defaultPrompts[selectedPromptRole] || "");
      setPromptMsg({ kind: "ok", text: `已将「${roleObj?.name || selectedPromptRole}」恢复为官方默认提示词` });
    } catch (err: any) {
      setPromptMsg({ kind: "err", text: err.message || "重置失败" });
    } finally {
      setPromptBusy(false);
    }
  };

  const resetAllPrompts = async () => {
    if (!confirm("确定将所有写作助手的自定义提示词全部清除，恢复为官方默认预设吗？")) return;
    setPromptBusy(true);
    setPromptMsg(null);
    try {
      const res = await api.post<{ ok: boolean; custom: Record<string, string>; defaults: Record<string, string> }>("/ai/prompts/reset", {});
      setCustomPrompts(res.custom || {});
      setActivePromptText(res.defaults?.[selectedPromptRole] || defaultPrompts[selectedPromptRole] || "");
      setPromptMsg({ kind: "ok", text: "已将所有能力的提示词恢复为官方默认预设！" });
    } catch (err: any) {
      setPromptMsg({ kind: "err", text: err.message || "重置失败" });
    } finally {
      setPromptBusy(false);
    }
  };

  const saveWriter = async (e: React.FormEvent) => {
    e.preventDefault();
    setWriterMsg(null);
    setWriterBusy(true);
    try {
      await api.post("/ai/settings/ai-key", {
        apiKey: writerKey.trim(),
        mode: writerMode,
        baseUrl: writerBaseUrl.trim() || null,
        protocol: writerProtocol,
        model: writerModel.trim() || null,
      });
      setWriterKey("");
      setWriterMsg({ kind: "ok", text: writerMode === "session" ? "小说助手配置已保存（仅本次会话有效）" : "小说助手配置已加密保存到账号" });
      await loadSettings();
    } catch (err: any) {
      setWriterMsg({ kind: "err", text: err.message || "保存失败" });
    } finally {
      setWriterBusy(false);
    }
  };

  const clearWriter = async () => {
    if (!confirm("确定清除小说写作助手的 API Key 及配置？")) return;
    await api.post("/ai/settings/ai-key", { mode: "clear" });
    setWriterBaseUrl("");
    setWriterProtocol("auto");
    setWriterModel("");
    setWriterMsg({ kind: "ok", text: "已清除小说助手个人配置" });
    await loadSettings();
  };


  const saveAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentMsg(null);
    setAgentBusy(true);
    try {
      await api.post("/ai/settings/agent-key", {
        apiKey: agentKey.trim(),
        mode: agentMode,
        baseUrl: agentBaseUrl.trim() || null,
        protocol: agentProtocol,
        model: agentModel.trim() || null,
      });
      setAgentKey("");
      setAgentMsg({ kind: "ok", text: agentMode === "session" ? "管家 Agent 配置已保存（仅本次会话有效）" : "管家 Agent 配置已加密保存到账号" });
      await loadSettings();
    } catch (err: any) {
      setAgentMsg({ kind: "err", text: err.message || "保存失败" });
    } finally {
      setAgentBusy(false);
    }
  };

  const clearAgent = async () => {
    if (!confirm("确定清除管家 Agent 的专属 API Key 及配置？（清除后将自动回退共用小说写作助手配置）")) return;
    await api.post("/ai/settings/agent-key", { mode: "clear" });
    setAgentBaseUrl("");
    setAgentProtocol("auto");
    setAgentModel("");
    setAgentMsg({ kind: "ok", text: "已清除管家 Agent 专用配置" });
    await loadSettings();
  };

  const testAgentTools = async () => {
    setAgentToolTesting(true);
    setAgentToolResult(null);
    try {
      const res = await api.post<{ ok: boolean; toolCallingSupported: boolean; message: string; error?: string }>("/ai/test-tools", {
        target: "agent"
      });
      setAgentToolResult({
        ok: res.toolCallingSupported,
        message: res.message
      });
    } catch (err: any) {
      setAgentToolResult({
        ok: false,
        message: err.message || "测试请求失败"
      });
    } finally {
      setAgentToolTesting(false);
    }
  };

  const saveDistill = async (e: React.FormEvent) => {
    e.preventDefault();
    setDistillMsg(null);
    setDistillBusy(true);
    try {
      await api.post("/ai/settings/distill-key", {
        apiKey: distillKey.trim(),
        mode: distillMode,
        baseUrl: distillBaseUrl.trim() || null,
        protocol: distillProtocol,
        model: distillModel.trim() || null,
      });
      setDistillKey("");
      setDistillMsg({ kind: "ok", text: distillMode === "session" ? "蒸馏专用配置已保存（仅本次会话有效）" : "蒸馏专用配置已加密保存到账号" });
      await loadSettings();
    } catch (err: any) {
      setDistillMsg({ kind: "err", text: err.message || "保存失败" });
    } finally {
      setDistillBusy(false);
    }
  };

  const clearDistill = async () => {
    if (!confirm("确定清除蒸馏作者专用的 API Key 及配置？")) return;
    await api.post("/ai/settings/distill-key", { mode: "clear" });
    setDistillBaseUrl("");
    setDistillProtocol("auto");
    setDistillModel("");
    setDistillMsg({ kind: "ok", text: "已清除蒸馏专用个人配置" });
    await loadSettings();
  };

  const saveWorld = async (e: React.FormEvent) => {
    e.preventDefault();
    setWorldMsg(null);
    setWorldBusy(true);
    try {
      await api.post("/ai/settings/world-key", {
        apiKey: worldKey.trim(),
        mode: worldMode,
        baseUrl: worldBaseUrl.trim() || null,
        protocol: worldProtocol,
        model: worldModel.trim() || null,
      });
      setWorldKey("");
      setWorldMsg({ kind: "ok", text: worldMode === "session" ? "角色与地图配置已保存（仅本次会话有效）" : "角色与地图配置已加密保存到账号" });
      await loadSettings();
    } catch (err: any) {
      setWorldMsg({ kind: "err", text: err.message || "保存失败" });
    } finally {
      setWorldBusy(false);
    }
  };

  const clearWorld = async () => {
    if (!confirm("确定清除角色与地图的专用 API Key 及配置？（清除后将自动回退共用小说助手配置）")) return;
    await api.post("/ai/settings/world-key", { mode: "clear" });
    setWorldBaseUrl("");
    setWorldProtocol("auto");
    setWorldModel("");
    setWorldMsg({ kind: "ok", text: "已清除角色与地图专用配置，现已回退共用写作助手配置" });
    await loadSettings();
  };

  const writerConfig = settings?.writer || settings;
  const agentConfig = settings?.agent;
  const distillConfig = settings?.distill;
  const worldConfig = settings?.world;

  // 像 cc-switch 那样，根据 API Key + Base URL 主动拉取上游可用模型列表
  const fetchModels = async (
    apiKey: string,
    baseUrl: string,
    protocol: AiProtocol,
    scope: "writer" | "distill" | "world" | "agent",
    setState: React.Dispatch<React.SetStateAction<ModelFetchState>>
  ) => {
    setState((s) => ({ ...s, busy: true, open: true, error: undefined }));
    try {
      const res = await api.post<{ models: string[]; source: string; error?: string }>("/ai/fetch-models", {
        apiKey: apiKey.trim() || null,
        baseUrl: baseUrl.trim(),
        protocol,
        scope,
      });
      if (res.error) {
        setState({ open: true, busy: false, models: [], error: res.error });
        return;
      }
      setState({ open: true, busy: false, models: res.models || [], source: res.source });
    } catch (err: any) {
      setState({ open: true, busy: false, models: [], error: err.message || "获取模型列表失败" });
    }
  };

  // 模型下拉浮层（3 个 scope 复用）
  const ModelPicker = ({ state, onPick, onClose }: { state: ModelFetchState; onPick: (m: string) => void; onClose: () => void }) => {
    if (!state.open) return null;
    return (
      <div className="relative z-10 mt-1.5 rounded-md border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1.5 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <ListFilter size={11} />
            {state.busy ? "正在探测上游模型…" :
              state.error ? <span className="text-red-400">⚠ {state.error}</span> :
              state.source ? <>来自 <strong className="text-ink-2 font-mono">{state.source}</strong> 协议，共 <strong className="text-ink-2">{state.models.length}</strong> 个模型</> :
              "模型列表"}
          </span>
          <button type="button" className="text-ink-3 hover:text-ink" onClick={onClose} title="关闭">✕</button>
        </div>
        {state.busy ? (
          <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-ink-3">
            <Loader2 size={14} className="animate-spin" /> 拉取中…
          </div>
        ) : state.models.length > 0 ? (
          <ul className="max-h-56 overflow-y-auto py-1 text-xs">
            {state.models.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left font-mono text-ink-2 hover:bg-primary-2/10 hover:text-ink"
                  onClick={() => { onPick(m); onClose(); }}
                >
                  {m}
                </button>
              </li>
            ))}
          </ul>
        ) : !state.error ? (
          <div className="px-3 py-3 text-center text-xs text-ink-3">暂无模型数据</div>
        ) : null}
      </div>
    );
  };

  // ---- Skill 通用化：增删改与上传 ----
  const saveSkill = async (data: { id?: number; name: string; slug?: string; scope: SkillRec["scope"]; content: string; enabled: boolean; priority: number; notes: string; sourceKind?: SkillRec["sourceKind"]; sourceRef?: string | null }) => {
    setSkillBusy(true);
    setSkillMsg(null);
    try {
      if (data.id) {
        await api.patch(`/user-skills/${data.id}`, {
          name: data.name,
          scope: data.scope,
          content: data.content,
          enabled: data.enabled,
          priority: data.priority,
          notes: data.notes,
        });
      } else {
        await api.post("/user-skills", {
          name: data.name,
          scope: data.scope,
          content: data.content,
          enabled: data.enabled,
          priority: data.priority,
          notes: data.notes,
          sourceKind: data.sourceKind || "manual",
          sourceRef: data.sourceRef || null,
        });
      }
      setSkillEditing(null);
      setSkillCreating(false);
      setSkillMsg({ kind: "ok", text: data.id ? "Skill 已更新" : "Skill 已新建" });
      await loadSkills();
    } catch (err: any) {
      setSkillMsg({ kind: "err", text: err.message || "保存失败" });
    } finally {
      setSkillBusy(false);
    }
  };

  const deleteSkill = async (id: number) => {
    if (!confirm("确定删除该 Skill？删除后该提示词将不再注入到 AI 调用。")) return;
    setSkillBusy(true);
    try {
      await api.del(`/user-skills/${id}`);
      setSkillMsg({ kind: "ok", text: "已删除 Skill" });
      await loadSkills();
    } catch (err: any) {
      setSkillMsg({ kind: "err", text: err.message || "删除失败" });
    } finally {
      setSkillBusy(false);
    }
  };

  const toggleSkill = async (s: SkillRec) => {
    try {
      await api.patch(`/user-skills/${s.id}`, { enabled: !s.enabled });
      await loadSkills();
    } catch (err: any) {
      setSkillMsg({ kind: "err", text: err.message || "切换失败" });
    }
  };

  const uploadSkillFile = async (file: File) => {
    setSkillBusy(true);
    setSkillMsg(null);
    try {
      const text = await file.text();
      await api.post("/user-skills/upload", {
        filename: file.name,
        content: text,
      });
      setSkillMsg({ kind: "ok", text: `已上传 Skill 文件：${file.name}` });
      await loadSkills();
    } catch (err: any) {
      setSkillMsg({ kind: "err", text: err.message || "上传失败" });
    } finally {
      setSkillBusy(false);
    }
  };

  const importFromDistilled = async () => {
    try {
      const data = await api.get<{ authors: Array<{ id: number; name: string; slug: string }> }>("/skill-authors");
      const list = data.authors || [];
      if (!list.length) {
        setSkillMsg({ kind: "err", text: "暂无可用的蒸馏作者" });
        return;
      }
      const choice = prompt(
        "请输入要导入的蒸馏作者 ID：\n" + list.map((a) => `#${a.id} ${a.name}（${a.slug}）`).join("\n"),
        String(list[0].id)
      );
      if (!choice) return;
      const id = Number(choice);
      if (!Number.isInteger(id)) {
        setSkillMsg({ kind: "err", text: "无效的 ID" });
        return;
      }
      const scope = (prompt("注入范围（writer / distill / world / all）：", "writer") || "writer").trim();
      if (!["writer", "distill", "world", "all"].includes(scope)) {
        setSkillMsg({ kind: "err", text: "scope 必须是 writer/distill/world/all 之一" });
        return;
      }
      setSkillBusy(true);
      await api.post("/user-skills/from-distilled", { authorId: id, scope });
      setSkillMsg({ kind: "ok", text: "已从蒸馏作者导入 Skill" });
      await loadSkills();
    } catch (err: any) {
      setSkillMsg({ kind: "err", text: err.message || "导入失败" });
    } finally {
      setSkillBusy(false);
    }
  };

  const filteredSkills = skillScopeFilter === "all"
    ? skills
    : skills.filter((s) => s.scope === (skillScopeFilter as SkillRec["scope"]) || s.scope === "all");

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 space-y-6">
      <div>
        <h1 className="serif-title mb-1 text-2xl text-ink">API 设置</h1>
        <p className="text-sm text-ink-2">账号：{user?.username}（{user?.role === "admin" ? "管理员" : "作者"}）</p>
      </div>

      <div className="rounded-md border border-border bg-surface p-3.5 text-xs leading-5 text-ink-2">
        <p className="flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-gold" />
          <span>
            系统支持将<strong>小说写作助手</strong>、<strong>蒸馏长篇作者</strong>与<strong>角色与地图设定库</strong>配置为不同的大模型服务商或网关。<br />
            获取 API Key：可前往 <a className="text-link underline" href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a>，或访问 <a className="inline-flex items-center gap-1 text-link underline" href="https://ccswitch.io/" target="_blank" rel="noreferrer">CC-Switch 官网 <ExternalLink size={11} /></a> 了解配置。<br />
            注意：<code>https://ccswitch.io/</code> 是官网，不是 API Base URL；Base URL 必须填写实际 API 网关地址。
          </span>
        </p>
      </div>

      {/* 0. 本机服务器与网络模式（公网/局域网多设备协同，仅管理员可见） */}
      {user?.role === "admin" && (
      <section className="card space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Globe className="text-primary-2" size={18} />
            <h2 className="serif-title text-base text-ink">本机服务器与网络模式</h2>
          </div>
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-400">
            {networkInfo?.isNetworkMode ? "局域网与公网监听已就绪 (0.0.0.0)" : "本机服务运行中"}
          </span>
        </div>

        <div className="space-y-4 text-xs">
          <div className="rounded-md border border-border bg-surface-2 p-3.5">
            <div className="flex items-center gap-2 font-medium text-ink">
              <ShieldCheck size={16} className="text-emerald-400" />
              <span>数据与登录 100% 本地化保证</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-ink-3">
              当前电脑即为主服务器。所有作者账号、登录密码 Hash、Session 状态、API 密钥、小说章节、角色与世界地图均保存在本地 SQLite 数据库中。
              <span className="ml-1 font-mono text-ink-2">({networkInfo?.databaseFile || "data/novelforge.db"})</span>
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* 本机访问 */}
            <div className="rounded-md border border-border bg-surface p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">💻 本机电脑访问</span>
                <span className="text-[10px] text-ink-3">当前设备浏览器</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {(networkInfo?.localUrls || ["http://localhost:3000"]).map((url) => (
                  <div key={url} className="flex items-center justify-between rounded bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-2">
                    <span className="truncate">{url}</span>
                    <button
                      type="button"
                      className="ml-2 rounded p-1 hover:text-primary-2"
                      onClick={() => copyToClipboard(url)}
                      title="复制地址"
                    >
                      {copiedUrl === url ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* 局域网/手机访问 */}
            <div className="rounded-md border border-border bg-surface p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink">📱 手机 / 平板 / 局域网访问</span>
                <span className="text-[10px] text-ink-3">同一 WiFi 下直接打开</span>
              </div>
              <div className="mt-2 space-y-1.5">
                {networkInfo?.lanUrls && networkInfo.lanUrls.length > 0 ? (
                  networkInfo.lanUrls.map((url) => (
                    <div key={url} className="flex items-center justify-between rounded bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-2">
                      <span className="truncate">{url}</span>
                      <button
                        type="button"
                        className="ml-2 rounded p-1 hover:text-primary-2"
                        onClick={() => copyToClipboard(url)}
                        title="复制地址"
                      >
                        {copiedUrl === url ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="py-2 text-ink-3">未检测到活动局域网 IP（请连接 WiFi 或局域网）</p>
                )}
              </div>
            </div>
          </div>

          {/* 公网与远程访问指引 */}
          <div className="rounded-md border border-primary-2/20 bg-primary-soft/50 p-3.5">
            <p className="font-semibold text-primary-2">🌐 公网与远程异地访问指引：</p>
            <ul className="mt-2 list-disc pl-4 space-y-1 text-ink-2 leading-relaxed">
              <li>
                <strong>内网穿透（推荐）：</strong>使用 cpolar / Cloudflare Tunnel / frp 将本地端口 <code className="rounded bg-surface px-1 py-0.5 font-mono">{networkInfo?.port || 3000}</code> 映射为公网网址，即可异地多端访问。
              </li>
              <li>
                <strong>路由器端口映射：</strong>若宽带有公网 IP，在路由器后台配置 NAT 转发将外部端口指向本机局域网 IP 的 <code className="rounded bg-surface px-1 py-0.5 font-mono">{networkInfo?.port || 3000}</code> 端口。
              </li>
              <li>
                <strong>虚拟局域网：</strong>使用 Tailscale 或 ZeroTier 组网，异地设备输入本机的虚拟局域网 IP 即可直连。
              </li>
            </ul>
          </div>
        </div>
      </section>
      )}

      {/* MCP (Model Context Protocol) Agent 互联配置 */}
      <section className="card space-y-4 p-6 border-primary-2/20">
        <button
          type="button"
          onClick={() => setMcpAgentOpen((v) => !v)}
          className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2">
            <Bot className="text-primary-2" size={18} />
            <h2 className="serif-title text-base text-ink">Model Context Protocol (MCP) · Agent 互联</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-400">
              25 项 Tools + 3 项 Prompts 就绪
            </span>
            {mcpAgentOpen ? <ChevronUp size={16} className="text-ink-3" /> : <ChevronDown size={16} className="text-ink-3" />}
          </div>
        </button>

        {mcpAgentOpen && (
          <>
            <p className="text-xs text-ink-3">
              支持 <strong>Claude Code</strong>、<strong>AstrBot</strong>、<strong>Claude Desktop</strong>、<strong>Cursor / Windsurf / Cline</strong> 等 AI Agent 工具连接起笔平台，实现自动化阅读与管理小说、章节创作、细纲规划、角色设定与伏笔追踪。
            </p>

            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              {/* Claude Code 快速配置 */}
              <div className="rounded-md border border-border bg-surface-2 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink flex items-center gap-1.5">
                    <Terminal size={14} className="text-primary-2" />
                    Claude Code / CLI 接入
                  </span>
                  <span className="text-[10px] text-ink-3">Stdio 模式 (.mcp.json 已内置)</span>
                </div>
                <p className="text-ink-3 text-[11px]">终端一键添加命令：</p>
                <div className="flex items-center justify-between rounded bg-surface px-2.5 py-1.5 font-mono text-[11px] text-ink-2 border border-border">
                  <span className="truncate">claude mcp add novelforge node "C:\Users\Administrator\Desktop\xm\XXS\mcp\server.mjs"</span>
                  <button
                    type="button"
                    className="ml-2 rounded p-1 hover:text-primary-2 shrink-0"
                    onClick={(e) => { e.stopPropagation(); copyToClipboard('claude mcp add novelforge node "C:\\Users\\Administrator\\Desktop\\xm\\XXS\\mcp\\server.mjs"'); }}
                    title="复制命令"
                  >
                    {copiedUrl === 'claude mcp add novelforge node "C:\\Users\\Administrator\\Desktop\\xm\\XXS\\mcp\\server.mjs"' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>

              {/* AstrBot / SSE 网络模式 */}
              <div className="rounded-md border border-border bg-surface-2 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink flex items-center gap-1.5">
                    <Globe size={14} className="text-emerald-400" />
                    AstrBot / Web Agent (SSE)
                  </span>
                  <span className="text-[10px] text-ink-3">HTTP SSE 网络直连</span>
                </div>
                <p className="text-ink-3 text-[11px]">远程/网络 Agent 连接 SSE URL：</p>
                <div className="flex items-center justify-between rounded bg-surface px-2.5 py-1.5 font-mono text-[11px] text-ink-2 border border-border">
                  <span className="truncate">{`http://127.0.0.1:${networkInfo?.port || 3000}/api/mcp/sse`}</span>
                  <button
                    type="button"
                    className="ml-2 rounded p-1 hover:text-primary-2 shrink-0"
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(`http://127.0.0.1:${networkInfo?.port || 3000}/api/mcp/sse`); }}
                    title="复制 SSE URL"
                  >
                    {copiedUrl === `http://127.0.0.1:${networkInfo?.port || 3000}/api/mcp/sse` ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border bg-surface p-3 text-xs text-ink-3 flex items-center justify-between">
              <span>📁 项目根目录下已生成 <strong className="text-ink font-mono font-normal">.mcp.json</strong>、<strong className="text-ink font-mono font-normal">astrbot_mcp.json</strong>、<strong className="text-ink font-mono font-normal">claude_desktop_config.json</strong> 与 <strong className="text-ink font-mono font-normal">MCP使用说明.md</strong>。</span>
            </div>
          </>
        )}
      </section>

      {/* 🔌 MCP 客户端：连接外部 MCP 服务器（学习自 ai-novelist） */}
      <section className="card space-y-4 p-6 border-emerald-500/30">
        <button
          type="button"
          onClick={() => setMcpClientOpen((v) => !v)}
          className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
        >
          <div className="flex items-center gap-2">
            <Plug className="text-emerald-400" size={18} />
            <h2 className="serif-title text-base text-ink">MCP 客户端 · 接入外部 MCP 服务器</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={"rounded-full px-2.5 py-0.5 text-[11px] " + (mcpClients.length > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-surface-2 text-ink-3")}>
              {mcpClients.length} 个客户端{mcpClients.length > 0 ? "已挂载" : ""}
            </span>
            {mcpClientOpen ? <ChevronUp size={16} className="text-ink-3" /> : <ChevronDown size={16} className="text-ink-3" />}
          </div>
        </button>
        {mcpClientOpen && (<>
        <p className="text-xs text-ink-3">
          支持以 <strong>HTTP / SSE / Stdio</strong> 三种方式连接任意外部 MCP 服务器（例如 GitHub MCP、文件系统 MCP、Sequential-Thinking MCP 等）。
          挂载成功后，外部工具将被纳入「起笔」的 <strong className="text-ink">管家 Agent</strong> 工具集，可让 AI 自主调用。
        </p>

        <div className="rounded-md border border-border bg-surface-2 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-3 w-20 shrink-0">连接方式</span>
            <div className="flex gap-1.5">
              {([
                { v: "http", label: "HTTP (Streamable)" },
                { v: "sse", label: "SSE" },
                { v: "stdio", label: "Stdio (本地进程)" },
              ] as const).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  className={`rounded px-2.5 py-1 text-xs ${mcpKind === opt.v ? "bg-primary-soft text-primary-2 font-medium" : "border border-border text-ink-2 hover:text-ink"}`}
                  onClick={() => setMcpKind(opt.v)}
                >{opt.label}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-ink-3 w-20 shrink-0">显示名称</label>
            <input className="input flex-1 min-w-40 text-xs" value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="如：GitHub MCP / 文件 MCP / 本地知识库" />
          </div>
          {mcpKind === "stdio" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-ink-3 w-20 shrink-0">启动命令</label>
                <input className="input flex-1 min-w-40 text-xs font-mono" value={mcpCommand} onChange={(e) => setMcpCommand(e.target.value)} placeholder="如：npx 或 C:\Program Files\nodejs\node.exe" />
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <label className="text-xs text-ink-3 w-20 shrink-0 mt-2">参数</label>
                <textarea className="input flex-1 min-w-40 text-xs font-mono" rows={2} value={mcpArgs} onChange={(e) => setMcpArgs(e.target.value)} placeholder="每行一个参数，如：&#10;-y&#10;@modelcontextprotocol/server-filesystem&#10;C:\Users\Administrator\Desktop" />
              </div>
              <p className="text-[10px] text-amber-300/80">⚠️ 公网服务器模式下，仅管理员可挂载 stdio 客户端，避免任意进程被启动。</p>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-ink-3 w-20 shrink-0">URL</label>
              <input className="input flex-1 min-w-40 text-xs font-mono" value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder={mcpKind === "sse" ? "http://127.0.0.1:8000/sse" : "http://127.0.0.1:8000/mcp"} />
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            {mcpMsg && (
              <span className={`text-xs ${mcpMsg.kind === "ok" ? "text-emerald-400" : "text-red-300"}`}>{mcpMsg.text}</span>
            )}
            <button
              type="button"
              className="btn-primary !min-h-8 text-xs"
              disabled={mcpBusy || !mcpName.trim() || (mcpKind === "stdio" ? !mcpCommand.trim() : !mcpUrl.trim())}
              onClick={async () => {
                setMcpBusy(true); setMcpMsg(null);
                try {
                  const payload: any = { kind: mcpKind, name: mcpName.trim() };
                  if (mcpKind === "stdio") {
                    payload.command = mcpCommand.trim();
                    payload.args = mcpArgs.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);
                  } else {
                    payload.url = mcpUrl.trim();
                  }
                  const res = await api.post<{ ok: boolean; error?: string; client: any }>("/mcp/clients/connect", payload);
                  if (res.ok) {
                    setMcpMsg({ kind: "ok", text: "连接成功 ✓" });
                    setMcpName(""); setMcpCommand(""); setMcpArgs(""); setMcpUrl("");
                    await loadMcpClients();
                  } else {
                    setMcpMsg({ kind: "err", text: res.error || "连接失败" });
                    await loadMcpClients();
                  }
                } catch (err: any) {
                  setMcpMsg({ kind: "err", text: err?.message || "连接失败" });
                } finally { setMcpBusy(false); }
              }}
            >{mcpBusy ? "连接中…" : "连接 MCP 服务器"}</button>
          </div>
        </div>

        {/* 已挂载客户端列表 */}
        <div className="space-y-2">
          {mcpClients.length === 0 && (
            <p className="rounded-md border border-dashed border-border bg-surface-2/40 p-4 text-center text-xs text-ink-3">
              暂未挂载任何外部 MCP 客户端。填写上方表单即可连接。
            </p>
          )}
          {mcpClients.map((c) => (
            <div key={c.id} className="rounded-md border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${c.status === "ready" ? "bg-emerald-400" : c.status === "error" ? "bg-red-400" : "bg-amber-400"}`} />
                    <span className="text-sm font-medium text-ink">{c.name}</span>
                    <span className="text-[10px] text-ink-3">{c.transport.toUpperCase()}</span>
                    {c.status === "error" && c.errorMessage && (
                      <span className="text-[10px] text-red-300 truncate">· {c.errorMessage}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-3 font-mono truncate">
                    {c.transport === "stdio" ? `${c.command} ${(c.args || []).join(" ")}` : c.url}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost !min-h-7 !px-2 text-[11px]"
                  onClick={async () => { await api.del(`/mcp/clients/${c.id}`); await loadMcpClients(); }}
                >
                  断开
                </button>
              </div>
              {(c.tools?.length > 0 || c.prompts?.length > 0) && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-ink-3 hover:text-ink">
                    工具 {c.tools.length} 项 · 提示词 {c.prompts.length} 项 · 资源 {c.resources.length} 项
                  </summary>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {c.tools.map((t) => (
                      <div key={t.name} className="rounded border border-border bg-surface-2 px-2 py-1">
                        <div className="font-mono text-[11px] text-primary-2">{t.name}</div>
                        {t.description && <div className="text-[10px] text-ink-3 line-clamp-2">{t.description}</div>}
                      </div>
                    ))}
                    {c.prompts.map((p) => (
                      <div key={p.name} className="rounded border border-border bg-surface-2 px-2 py-1">
                        <div className="font-mono text-[11px] text-emerald-400">📝 {p.name}</div>
                        {p.description && <div className="text-[10px] text-ink-3 line-clamp-2">{p.description}</div>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
        </>)}
      </section>
      <section className="card space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="text-primary-2" size={18} />
            <h2 className="serif-title text-base text-ink">小说写作助手 · API 配置</h2>
          </div>
          <span className={"rounded-full px-2 py-0.5 text-[11px] " + (writerConfig?.keyConfigured ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300")}>
            {writerConfig?.keyConfigured ? ("已配置 (" + (writerConfig.keySource === "session" ? "会话" : writerConfig.keySource === "user-db" ? "账号加密" : "站方") + ")") : "未配置"}
          </span>
        </div>
        <p className="text-xs text-ink-3">用于章节草稿生成、续写、润色、扩写、细纲规划与写作顾问等任务。</p>

        <form onSubmit={saveWriter} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="writer-apikey">
              API Key / 令牌
            </label>
            <input
              id="writer-apikey"
              type="password"
              className="input font-mono"
              value={writerKey}
              onChange={(e) => setWriterKey(e.target.value)}
              placeholder="留空表示不修改已有密钥"
              autoComplete="off"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm text-ink-2" htmlFor="writer-base-url">实际 API Base URL</label>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-ink-2 hover:border-primary-2/50 hover:text-ink"
                onClick={() => { setWriterBaseUrl("http://127.0.0.1:15721/v1"); setWriterProtocol("anthropic"); }}
                title="填入本机 CC-Switch 代理地址"
              >
                <Plug size={12} /> 连接本地 CC-Switch
              </button>
            </div>
            <input
              id="writer-base-url"
              type="url"
              className="input font-mono text-xs"
              value={writerBaseUrl}
              onChange={(e) => setWriterBaseUrl(e.target.value)}
              placeholder="https://gateway.example.com/v1"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="writer-protocol">协议</label>
            <select
              id="writer-protocol"
              className="input"
              value={writerProtocol}
              onChange={(e) => setWriterProtocol(e.target.value as AiProtocol)}
            >
              <option value="auto">自动判断（兼容旧配置）</option>
              <option value="anthropic">Anthropic 原生</option>
              <option value="openai">OpenAI 兼容</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="writer-model">模型</label>
            <div className="flex gap-2">
              <input
                id="writer-model"
                className="input flex-1 font-mono text-xs"
                value={writerModel}
                onChange={(e) => setWriterModel(e.target.value)}
                placeholder={writerProtocol === "anthropic" ? "claude-opus-5" : "如：deepseek/deepseek-v4-flash"}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn-secondary flex shrink-0 items-center gap-1 text-xs whitespace-nowrap"
                title="根据上方填写的 API Key 与 Base URL 主动拉取上游可用模型列表（类似 cc-switch）"
                onClick={() => void fetchModels(
                  writerKey,
                  writerBaseUrl,
                  writerProtocol,
                  "writer",
                  setWriterModels,
                )}
                disabled={writerModels.busy}
              >
                {writerModels.busy ? <Loader2 size={12} className="animate-spin" /> : <ListFilter size={12} />}
                获取模型
              </button>
            </div>
            <ModelPicker state={writerModels} onPick={(m) => setWriterModel(m)} onClose={() => setWriterModels((s) => ({ ...s, open: false }))} />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="radio" checked={writerMode === "persist"} onChange={() => setWriterMode("persist")} />
              持久保存（加密落库）
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="radio" checked={writerMode === "session"} onChange={() => setWriterMode("session")} />
              仅本次会话（更私密）
            </label>
          </div>
          {writerMsg && (
            <p className={"flex items-center gap-2 rounded-md border px-3 py-2 text-sm " + (writerMsg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400")}>
              {writerMsg.kind === "ok" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              {writerMsg.text}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={writerBusy}>
              {writerBusy ? "保存中…" : "保存写作助手配置"}
            </button>
            {(user?.ai_api_key_enabled || writerConfig?.keySource === "session") && (
              <button type="button" className="btn-danger" onClick={() => void clearWriter()}>
                <Trash2 size={14} /> 清除密钥
              </button>
            )}
          </div>
        </form>
      </section>

      

      {/* 2. 管家 Agent 专属配置与自定义连接地址 */}
      <section className="card space-y-4 p-6 border-emerald-500/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="text-emerald-400" size={18} />
            <h2 className="serif-title text-base text-ink">管家 Agent · 专属 API 连接与模型配置</h2>
          </div>
          <span className={"rounded-full px-2 py-0.5 text-[11px] " + (agentConfig?.keyConfigured ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300")}>
            {agentConfig?.keyConfigured ? ("已配置 (" + (agentConfig.keySource === "session" ? "会话" : agentConfig.keySource === "user-db" ? "账号加密" : agentConfig.keySource === "writer-session" ? "回退写作助手会话" : agentConfig.keySource === "writer-db" ? "回退写作助手账号" : "站方") + ")") : "未配置"}
          </span>
        </div>
        <p className="text-xs text-ink-3">
          用于全自动调度小说章节、细纲规划、角色档案更新与 MCP 工具执行的自主 ReAct Agent。
          <br />
          <strong>支持完全自定义连接地址与专属模型</strong>：如配置本地代理（如 <code>http://127.0.0.1:15721/v1</code>）、Claude 3.7 / 4.8 或具备完整 Function-Calling（工具调用）能力的模型端点。
          未单独配置时，将自动平滑回退继承上方「小说写作助手」的配置。
        </p>

        <form onSubmit={saveAgent} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="agent-apikey">
              管家 Agent 专属 API Key / 令牌（可选，留空则共用小说写作助手）
            </label>
            <input
              id="agent-apikey"
              type="password"
              className="input"
              value={agentKey}
              onChange={(e) => setAgentKey(e.target.value)}
              placeholder={user?.agent_api_key_enabled ? "••••••••••••••••（已加密存储，留空保持不变）" : "留空则自动共用上方「小说写作助手」的 API Key"}
              autoComplete="new-password"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm text-ink-2" htmlFor="agent-baseurl">
                专属 API Base URL（自定义 Agent 接口连接地址）
              </label>
              <input
                id="agent-baseurl"
                type="url"
                className="input font-mono text-xs"
                value={agentBaseUrl}
                onChange={(e) => setAgentBaseUrl(e.target.value)}
                placeholder="留空共用小说助手，如 http://127.0.0.1:15721/v1 或 https://api.deepseek.com/v1"
              />
              <p className="mt-1 text-[11px] text-ink-3">
                若以 <code>/v1</code> 结尾且协议为自动，将采用 OpenAI Function Calling 标准兼容模式。
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-ink-2" htmlFor="agent-protocol">
                接口通信协议
              </label>
              <select
                id="agent-protocol"
                className="input"
                value={agentProtocol}
                onChange={(e) => setAgentProtocol(e.target.value as AiProtocol)}
              >
                <option value="auto">自动识别（/v1 结尾走 OpenAI tools，否则走 Anthropic）</option>
                <option value="openai">OpenAI 兼容协议 (Chat Completions + Function Calling)</option>
                <option value="anthropic">Anthropic 原生协议 (/v1/messages + tools)</option>
              </select>
            </div>
          </div>

          <div className="relative">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm text-ink-2" htmlFor="agent-model">
                管家 Agent 专属模型名称（Model ID）
              </label>
              <button
                type="button"
                className="text-xs text-link flex items-center gap-1 hover:underline"
                onClick={() => void fetchModels(
                  agentKey || writerKey,
                  agentBaseUrl || writerBaseUrl,
                  agentProtocol === "auto" ? writerProtocol : agentProtocol,
                  "agent",
                  setAgentModels
                )}
                disabled={agentModels.busy}
              >
                {agentModels.busy ? <Loader2 size={12} className="animate-spin" /> : <ListFilter size={12} />}
                获取端点模型列表
              </button>
            </div>
            <input
              id="agent-model"
              type="text"
              className="input font-mono text-xs"
              value={agentModel}
              onChange={(e) => setAgentModel(e.target.value)}
              placeholder="留空共用小说助手模型，如 deepseek-chat, gpt-4o, claude-3-7-sonnet 等"
            />
            <ModelPicker state={agentModels} onPick={(m) => setAgentModel(m)} onClose={() => setAgentModels((s) => ({ ...s, open: false }))} />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
              <input
                type="radio"
                name="agent-mode"
                value="persist"
                checked={agentMode === "persist"}
                onChange={() => setAgentMode("persist")}
              />
              持久化加密存储（推荐，账号多设备登录均生效）
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-2 cursor-pointer">
              <input
                type="radio"
                name="agent-mode"
                value="session"
                checked={agentMode === "session"}
                onChange={() => setAgentMode("session")}
              />
              仅保存在当前会话（关闭网页即失效）
            </label>
          </div>

          {agentMsg && (
            <p className={"flex items-center gap-1.5 text-xs " + (agentMsg.kind === "ok" ? "text-emerald-400" : "text-red-300")}>
              {agentMsg.kind === "ok" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              {agentMsg.text}
            </p>
          )}

          {agentToolResult && (
            <div className={"rounded-md border p-3 text-xs leading-relaxed " + (agentToolResult.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300")}>
              <div className="flex items-center gap-2 font-medium">
                {agentToolResult.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                <span>{agentToolResult.ok ? "Tool Calling 探针测试通过" : "Tool Calling 探针测试未通过"}</span>
              </div>
              <p className="mt-1 text-[11px] opacity-90">{agentToolResult.message}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn-primary" disabled={agentBusy}>
              {agentBusy ? "保存中…" : "保存管家 Agent 配置"}
            </button>
            <button
              type="button"
              className="btn-secondary flex items-center gap-1 text-xs"
              onClick={() => void testAgentTools()}
              disabled={agentToolTesting || (!agentConfig?.keyConfigured && !writerConfig?.keyConfigured)}
              title="向当前配置的端点发起探针调用，检测是否支持大模型工具调用"
            >
              {agentToolTesting ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
              {agentToolTesting ? "探针检测中…" : "测试 Agent 工具调用兼容性"}
            </button>
            {(user?.agent_api_key_enabled || (agentConfig?.keySource === "session" && agentConfig.isDedicated)) && (
              <button type="button" className="btn-danger" onClick={() => void clearAgent()}>
                <Trash2 size={14} /> 清除专用配置
              </button>
            )}
          </div>
        </form>
      </section>

      {/* 1.1 小说写作助手 · 提示词与 Skill 规则配置 */}
      <section className="card space-y-4 p-6 border-primary-2/20">
        <button
          type="button"
          onClick={() => setPromptCustomOpen((v) => !v)}
          className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary-2" size={18} />
            <h2 className="serif-title text-base text-ink">小说写作助手 · Skill 提示词与创作指令配置</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={"rounded-full px-2 py-0.5 text-[11px] font-medium " + (Object.keys(customPrompts).length > 0 ? "bg-primary-2/10 text-primary-2" : "bg-surface-2 text-ink-3")}>
              {Object.keys(customPrompts).length > 0 ? `已自定义 ${Object.keys(customPrompts).length} 项` : "全部使用官方预设"}
            </span>
            {Object.keys(customPrompts).length > 0 && (
              <button
                type="button"
                className="text-[11px] text-ink-3 hover:text-red-400 underline"
                onClick={(e) => { e.stopPropagation(); void resetAllPrompts(); }}
                title="恢复所有项为默认提示词"
              >
                全部重置
              </button>
            )}
            {promptCustomOpen ? <ChevronUp size={16} className="text-ink-3" /> : <ChevronDown size={16} className="text-ink-3" />}
          </div>
        </button>
        {promptCustomOpen && (<>
        <p className="text-xs text-ink-3 leading-relaxed">
          可根据个人写作风格自由定制各项创作能力（草稿生成、续写、润色、扩写、大纲规划等）的核心 System Prompt / Skill 指令。
          系统将在调用时自动结合作品档案、全书总大纲、人物卡、世界地理与全书章节正文上下文执行创作。
        </p>

        {/* 能力切换 Tabs */}
        <div className="flex flex-wrap gap-1.5 border-b border-border/70 pb-3">
          {PROMPT_ROLES.map((role) => {
            const isCustom = !!customPrompts[role.id];
            const isSelected = selectedPromptRole === role.id;
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => setSelectedPromptRole(role.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isSelected
                    ? "bg-primary-2 text-white shadow-sm"
                    : "bg-surface-2/80 text-ink-2 hover:bg-surface-3 hover:text-ink"
                }`}
              >
                <span>{role.badge}</span>
                {isCustom && (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isSelected ? "bg-white" : "bg-primary-2"
                    }`}
                    title="已自定义此项提示词"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* 当前选中能力的编辑面板 */}
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">
                {PROMPT_ROLES.find((r) => r.id === selectedPromptRole)?.name}
              </span>
              <span className="text-ink-3">
                — {PROMPT_ROLES.find((r) => r.id === selectedPromptRole)?.desc}
              </span>
            </div>
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                customPrompts[selectedPromptRole]
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  : "bg-surface-2 text-ink-3"
              }`}
            >
              {customPrompts[selectedPromptRole] ? "● 已启用自定义指令" : "○ 官方默认预设"}
            </span>
          </div>

          <div className="relative">
            <textarea
              className="input w-full font-mono text-xs leading-relaxed transition-all focus:border-primary-2"
              rows={7}
              value={activePromptText}
              onChange={(e) => setActivePromptText(e.target.value)}
              placeholder="请输入自定义系统提示词 / 创作指令…"
            />
          </div>

          <div className="rounded-md bg-surface-2/60 p-2.5 text-[11px] text-ink-3 leading-relaxed border border-border/50">
            <p className="font-medium text-ink-2 mb-1">💡 提示词与排版小贴士：</p>
            <p>
              • <strong>标准首行缩进</strong>：若需保持中文小说经典排版，可在提示词中加入要求每个正文大段开头使用两个全角空格（<code className="text-primary-2 font-mono">　　</code>）。
            </p>
            <p>
              • <strong>上下文注入机制</strong>：系统已自动为您装配《作品简介》、全书主线大纲、全书人物关系表、世界地图势力以及所有前文章节内容，无需在提示词中重复输入作品细节。
            </p>
          </div>

          {promptMsg && (
            <p
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                promptMsg.kind === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-red-500/30 bg-red-500/10 text-red-400"
              }`}
            >
              {promptMsg.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {promptMsg.text}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex items-center gap-1.5 text-xs py-1.5"
                onClick={() => void saveCurrentPrompt()}
                disabled={promptBusy}
              >
                <Save size={13} />
                {promptBusy ? "保存中…" : "保存当前能力提示词"}
              </button>
              {customPrompts[selectedPromptRole] && (
                <button
                  type="button"
                  className="btn-secondary flex items-center gap-1.5 text-xs py-1.5"
                  onClick={() => void resetCurrentPrompt()}
                  disabled={promptBusy}
                  title="恢复此能力的官方默认提示词"
                >
                  <RotateCcw size={13} />
                  恢复本项为官方默认
                </button>
              )}
            </div>
            <button
              type="button"
              className="text-xs text-ink-3 hover:text-ink hover:underline inline-flex items-center gap-1"
              onClick={() => {
                const def = defaultPrompts[selectedPromptRole];
                if (def) setActivePromptText(def);
              }}
              title="查看官方预设内容"
            >
              查看/填入官方预设内容
            </button>
          </div>
        </div>
        </>)}
      </section>


      {/* 2. 角色与地图（设定库）专用配置 */}
      <section className="card space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="text-primary-2" size={18} />
            <h2 className="serif-title text-base text-ink">角色与地图 · 专用 API 配置</h2>
          </div>
          <span className={"rounded-full px-2 py-0.5 text-[11px] " + (worldConfig?.keyConfigured ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300")}>
            {worldConfig?.keyConfigured
              ? (worldConfig.keySource === "session" ? "已配置 (会话)" : worldConfig.keySource === "user-db" ? "已配置 (账号加密)" : worldConfig.keySource === "station" ? "站方配置" : "已共用写作助手配置")
              : "未配置"}
          </span>
        </div>
        <p className="text-xs text-ink-3">
          用于<strong>AI 提取正文角色</strong>与<strong>AI 完善地图地理要素</strong>。两者共用此处的 API 配置；若未单独填写，将自动共用上方小说写作助手的配置。
        </p>

        <form onSubmit={saveWorld} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="world-apikey">
              角色与地图 API Key / 令牌
            </label>
            <input
              id="world-apikey"
              type="password"
              className="input font-mono"
              value={worldKey}
              onChange={(e) => setWorldKey(e.target.value)}
              placeholder="留空表示不修改已有密钥（未填写时自动共用写作助手配置）"
              autoComplete="off"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm text-ink-2" htmlFor="world-base-url">API Base URL</label>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-ink-2 hover:border-primary-2/50 hover:text-ink"
                onClick={() => { setWorldBaseUrl("http://127.0.0.1:15721/v1"); setWorldProtocol("anthropic"); }}
                title="填入本机 CC-Switch 代理地址"
              >
                <Plug size={12} /> 连接本地 CC-Switch
              </button>
            </div>
            <input
              id="world-base-url"
              type="url"
              className="input font-mono text-xs"
              value={worldBaseUrl}
              onChange={(e) => setWorldBaseUrl(e.target.value)}
              placeholder="https://gateway.example.com/v1"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="world-protocol">协议</label>
            <select
              id="world-protocol"
              className="input"
              value={worldProtocol}
              onChange={(e) => setWorldProtocol(e.target.value as AiProtocol)}
            >
              <option value="auto">自动判断（兼容旧配置）</option>
              <option value="anthropic">Anthropic 原生</option>
              <option value="openai">OpenAI 兼容</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="world-model">模型</label>
            <div className="flex gap-2">
              <input
                id="world-model"
                className="input flex-1 font-mono text-xs"
                value={worldModel}
                onChange={(e) => setWorldModel(e.target.value)}
                placeholder={worldProtocol === "anthropic" ? "claude-opus-5" : "如：deepseek/deepseek-v4-flash"}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn-secondary flex shrink-0 items-center gap-1 text-xs whitespace-nowrap"
                title="根据上方填写的 API Key 与 Base URL 主动拉取上游可用模型列表（类似 cc-switch）"
                onClick={() => void fetchModels(worldKey, worldBaseUrl, worldProtocol, "world", setWorldModels)}
                disabled={worldModels.busy}
              >
                {worldModels.busy ? <Loader2 size={12} className="animate-spin" /> : <ListFilter size={12} />}
                获取模型
              </button>
            </div>
            <ModelPicker state={worldModels} onPick={(m) => setWorldModel(m)} onClose={() => setWorldModels((s) => ({ ...s, open: false }))} />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="radio" checked={worldMode === "persist"} onChange={() => setWorldMode("persist")} />
              持久保存（加密落库）
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="radio" checked={worldMode === "session"} onChange={() => setWorldMode("session")} />
              仅本次会话（更私密）
            </label>
          </div>
          {worldMsg && (
            <p className={"flex items-center gap-2 rounded-md border px-3 py-2 text-sm " + (worldMsg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400")}>
              {worldMsg.kind === "ok" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              {worldMsg.text}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={worldBusy}>
              {worldBusy ? "保存中…" : "保存角色与地图配置"}
            </button>
            {(user?.world_api_key_enabled || (worldConfig?.keySource === "session" && worldConfig.isDedicated)) && (
              <button type="button" className="btn-danger" onClick={() => void clearWorld()}>
                <Trash2 size={14} /> 清除专用密钥
              </button>
            )}
          </div>
        </form>
      </section>

      {/* 3. 蒸馏作者专用配置 */}
      <section className="card space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary-2" size={18} />
            <h2 className="serif-title text-base text-ink">蒸馏作者 · 专用 API 配置</h2>
          </div>
          <span className={"rounded-full px-2 py-0.5 text-[11px] " + (distillConfig?.keyConfigured ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300")}>
            {distillConfig?.keyConfigured ? ("已配置 (" + (distillConfig.keySource === "session" ? "会话" : distillConfig.keySource === "user-db" ? "账号加密" : "站方") + ")") : "未配置"}
          </span>
        </div>
        <p className="text-xs text-ink-3">用于长篇小说样本深度剖析、提取写作能力 (writing skill)、作者人格 (persona) 及合并 Skill。推荐配置长上下文模型。</p>

        <form onSubmit={saveDistill} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="distill-apikey">
              蒸馏专用 API Key / 令牌
            </label>
            <input
              id="distill-apikey"
              type="password"
              className="input font-mono"
              value={distillKey}
              onChange={(e) => setDistillKey(e.target.value)}
              placeholder="留空表示不修改已有密钥"
              autoComplete="off"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm text-ink-2" htmlFor="distill-base-url">蒸馏 API Base URL</label>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-ink-2 hover:border-primary-2/50 hover:text-ink"
                onClick={() => { setDistillBaseUrl("http://127.0.0.1:15721/v1"); setDistillProtocol("anthropic"); }}
                title="填入本机 CC-Switch 代理地址"
              >
                <Plug size={12} /> 连接本地 CC-Switch
              </button>
            </div>
            <input
              id="distill-base-url"
              type="url"
              className="input font-mono text-xs"
              value={distillBaseUrl}
              onChange={(e) => setDistillBaseUrl(e.target.value)}
              placeholder="https://gateway.example.com/v1"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="distill-protocol">协议</label>
            <select
              id="distill-protocol"
              className="input"
              value={distillProtocol}
              onChange={(e) => setDistillProtocol(e.target.value as AiProtocol)}
            >
              <option value="auto">自动判断（兼容旧配置）</option>
              <option value="anthropic">Anthropic 原生</option>
              <option value="openai">OpenAI 兼容</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-ink-2" htmlFor="distill-model">模型</label>
            <div className="flex gap-2">
              <input
                id="distill-model"
                className="input flex-1 font-mono text-xs"
                value={distillModel}
                onChange={(e) => setDistillModel(e.target.value)}
                placeholder={distillProtocol === "anthropic" ? "claude-opus-5" : "如：deepseek/deepseek-v4-flash"}
                autoComplete="off"
              />
              <button
                type="button"
                className="btn-secondary flex shrink-0 items-center gap-1 text-xs whitespace-nowrap"
                title="根据上方填写的 API Key 与 Base URL 主动拉取上游可用模型列表（类似 cc-switch）"
                onClick={() => void fetchModels(distillKey, distillBaseUrl, distillProtocol, "distill", setDistillModels)}
                disabled={distillModels.busy}
              >
                {distillModels.busy ? <Loader2 size={12} className="animate-spin" /> : <ListFilter size={12} />}
                获取模型
              </button>
            </div>
            <ModelPicker state={distillModels} onPick={(m) => setDistillModel(m)} onClose={() => setDistillModels((s) => ({ ...s, open: false }))} />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="radio" checked={distillMode === "persist"} onChange={() => setDistillMode("persist")} />
              持久保存（加密落库）
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="radio" checked={distillMode === "session"} onChange={() => setDistillMode("session")} />
              仅本次会话（更私密）
            </label>
          </div>
          {distillMsg && (
            <p className={"flex items-center gap-2 rounded-md border px-3 py-2 text-sm " + (distillMsg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400")}>
              {distillMsg.kind === "ok" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
              {distillMsg.text}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={distillBusy}>
              {distillBusy ? "保存中…" : "保存蒸馏配置"}
            </button>
            {distillConfig?.keyConfigured && (
              <button type="button" className="btn-danger" onClick={() => void clearDistill()}>
                <Trash2 size={14} /> 清除蒸馏密钥
              </button>
            )}
          </div>
        </form>
      </section>

      {/* 4. 通用 Skill 池（对标 ai-novelist：可挂任意 .md 提示词到不同 AI 场景） */}
      <section className="card space-y-4 p-6 border-amber-500/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ScrollText className="text-amber-500" size={18} />
            <h2 className="serif-title text-base text-ink">通用 Skill 池 · 任意 .md 提示词注入</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={"rounded-full px-2 py-0.5 text-[11px] " + (skills.filter((s) => s.enabled).length > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-surface-2 text-ink-3")}>
              已启用 {skills.filter((s) => s.enabled).length} / {skills.length}
            </span>
            <button
              type="button"
              className="btn-secondary flex items-center gap-1.5 text-xs py-1"
              onClick={importFromDistilled}
              disabled={skillBusy}
              title="把蒸馏作者的最新版本 skill_markdown 当作 Skill 导入"
            >
              <FileText size={12} />
              从蒸馏作者导入
            </button>
          </div>
        </div>
        <p className="text-xs text-ink-3 leading-relaxed">
          Skill 是一段 Markdown 提示词（文风约束、风格示例、结构模板、禁忌清单等），可按作用域自动注入到<strong>写作助手 · 蒸馏作者 · 角色与地图</strong>三类 AI 调用的系统提示词前缀。
          启用 Skill 越多，提示词越长，请根据模型上下文窗口合理控制数量。
        </p>

        {/* scope 过滤 */}
        <div className="flex flex-wrap gap-1.5 border-b border-border/70 pb-2.5">
          {[{ id: "all", label: "全部", desc: "显示所有 Skill", tone: "bg-surface-2 text-ink" }, ...SKILL_SCOPES].map((sc) => {
            const isSel = skillScopeFilter === (sc.id as any);
            return (
              <button
                key={sc.id}
                type="button"
                onClick={() => setSkillScopeFilter(sc.id as any)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all border ${
                  isSel
                    ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                    : `bg-surface-2/80 text-ink-2 hover:bg-surface-3 hover:text-ink border-border`
                }`}
                title={sc.desc}
              >
                <span>{sc.label}</span>
              </button>
            );
          })}
        </div>

        {/* 创建 / 上传 按钮组 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 text-xs py-1.5"
            onClick={() => { setSkillCreating(true); setSkillEditing({ id: 0, name: "", slug: "", scope: "writer", sourceKind: "manual", sourceRef: null, content: "", enabled: true, priority: 0, notes: "", createdAt: "", updatedAt: "" }); }}
            disabled={skillBusy}
          >
            <Plus size={13} />
            新建 Skill
          </button>
          <label className="btn-secondary flex items-center gap-1.5 text-xs py-1.5 cursor-pointer">
            <Upload size={13} />
            上传 .md 文件
            <input
              type="file"
              accept=".md,text/markdown,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { void uploadSkillFile(f); e.target.value = ""; }
              }}
            />
          </label>
        </div>

        {/* 消息提示 */}
        {skillMsg && (
          <p className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
            skillMsg.kind === "ok" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-400"
          }`}>
            {skillMsg.kind === "ok" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            {skillMsg.text}
          </p>
        )}

        {/* 列表 */}
        <div className="space-y-2">
          {filteredSkills.length === 0 && (
            <div className="rounded-md border border-dashed border-border/70 bg-surface-2/40 p-4 text-center text-xs text-ink-3">
              {skills.length === 0 ? "暂无 Skill。点击「新建」或「上传 .md」开始。" : "当前作用域下无 Skill"}
            </div>
          )}
          {filteredSkills.map((s) => {
            const scopeInfo = SKILL_SCOPES.find((sc) => sc.id === s.scope) || SKILL_SCOPES[0];
            const kindLabel: Record<string, string> = { manual: "手写", uploaded: "上传", distilled_author: "蒸馏作者" };
            return (
              <div key={s.id} className={`rounded-md border bg-surface-1 p-3 transition-all ${s.enabled ? "border-border/80" : "border-border/40 opacity-60"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium " + scopeInfo.tone}>
                      {scopeInfo.label}
                    </span>
                    <span className="font-medium text-ink text-sm">{s.name}</span>
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                      来源：{kindLabel[s.sourceKind] || s.sourceKind}
                    </span>
                    {s.priority !== 0 && (
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                        优先级 {s.priority}
                      </span>
                    )}
                    <span className="text-[10px] text-ink-3">/ {s.slug}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                      onClick={() => void toggleSkill(s)}
                      title={s.enabled ? "已启用，点击停用" : "已停用，点击启用"}
                    >
                      <Power size={14} className={s.enabled ? "text-emerald-500" : "text-ink-3"} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                      onClick={() => { setSkillEditing(s); setSkillCreating(false); }}
                      title="编辑"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-ink-3 hover:bg-red-500/10 hover:text-red-400"
                      onClick={() => void deleteSkill(s.id)}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {s.notes && <p className="mt-1.5 text-[11px] text-ink-3">📝 {s.notes}</p>}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-ink-3 hover:text-ink">查看 prompt 内容（{(s.content || "").length} 字）</summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-2/60 p-2 text-[11px] leading-relaxed text-ink-2 whitespace-pre-wrap break-all">{s.content || "（空）"}</pre>
                </details>
              </div>
            );
          })}
        </div>

        {/* 编辑 / 创建弹层 */}
        {(skillEditing || skillCreating) && skillEditing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setSkillEditing(null); setSkillCreating(false); }}>
            <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
              <h3 className="serif-title text-base text-ink flex items-center gap-2">
                <ScrollText size={16} className="text-amber-500" />
                {skillCreating ? "新建 Skill" : "编辑 Skill"}
              </h3>
              <div className="space-y-2.5">
                <label className="block">
                  <span className="text-xs text-ink-2">名称</span>
                  <input
                    type="text"
                    className="input w-full mt-1"
                    value={skillEditing.name}
                    onChange={(e) => setSkillEditing({ ...skillEditing, name: e.target.value })}
                    placeholder="例如：网文爽文风格 · 余华语言 · 推理大纲模板"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs text-ink-2">作用域 scope</span>
                    <select
                      className="input w-full mt-1"
                      value={skillEditing.scope}
                      onChange={(e) => setSkillEditing({ ...skillEditing, scope: e.target.value as any })}
                    >
                      {SKILL_SCOPES.map((sc) => (
                        <option key={sc.id} value={sc.id}>{sc.label} — {sc.desc}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs text-ink-2">优先级 priority（越大越靠前）</span>
                    <input
                      type="number"
                      className="input w-full mt-1"
                      value={skillEditing.priority}
                      onChange={(e) => setSkillEditing({ ...skillEditing, priority: Number(e.target.value) || 0 })}
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs text-ink-2">备注（可选）</span>
                  <input
                    type="text"
                    className="input w-full mt-1"
                    value={skillEditing.notes}
                    onChange={(e) => setSkillEditing({ ...skillEditing, notes: e.target.value })}
                    placeholder="例如：经典玄幻爽文节奏，禁止第一人称"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-ink-2">Markdown 内容（注入到 AI 系统提示词的前缀）</span>
                  <textarea
                    className="input w-full mt-1 font-mono text-xs leading-relaxed"
                    rows={10}
                    value={skillEditing.content}
                    onChange={(e) => setSkillEditing({ ...skillEditing, content: e.target.value })}
                    placeholder="请填写 Markdown 提示词，例如：&#10;## 风格要求&#10;- 杜绝 AI 套路词……&#10;## 章节结构&#10;1. 钩子开篇&#10;2. ..."
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={skillEditing.enabled}
                    onChange={(e) => setSkillEditing({ ...skillEditing, enabled: e.target.checked })}
                  />
                  启用此 Skill
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  className="btn-secondary text-xs py-1.5"
                  onClick={() => { setSkillEditing(null); setSkillCreating(false); }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs py-1.5"
                  disabled={skillBusy || !skillEditing.name.trim()}
                  onClick={() => void saveSkill({
                    id: skillCreating ? undefined : skillEditing.id,
                    name: skillEditing.name.trim(),
                    scope: skillEditing.scope,
                    content: skillEditing.content,
                    enabled: skillEditing.enabled,
                    priority: skillEditing.priority,
                    notes: skillEditing.notes,
                  })}
                >
                  {skillBusy ? "保存中…" : "保存 Skill"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* 5. 底部全量用户创作使用手册 */}
      <section className="card space-y-5 p-6 border-primary-2/30 bg-surface-1/90 shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-border pb-3">
          <BookOpen className="text-primary-2" size={20} />
          <div>
            <h2 className="serif-title text-base font-bold text-ink">📖 用户创作使用指南（新手与进阶手册）</h2>
            <p className="text-xs text-ink-3">供作者快速了解 API 配置方法、作品权限、整书全景 AI 写作与特色功能。</p>
          </div>
        </div>

        <div className="space-y-4 text-xs leading-relaxed text-ink-2">
          {/* 指南 1 */}
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-ink text-sm">
              <KeyRound size={15} className="text-primary-2" /> 第一步：如何正确配置你的专属 AI 创作接口
            </h3>
            <ul className="list-disc space-y-1.5 pl-4 text-ink-2">
              <li><strong>三路独立架构：</strong>
                <ul className="mt-1 list-circle space-y-1 pl-4 text-ink-3">
                  <li><strong>小说写作助手：</strong>负责草稿生成、续写、全文润色扩写、大纲规划与剧情问答，高频使用推荐配置。</li>
                  <li><strong>角色与地图专用：</strong>负责 AI 从正文提取角色与完善地图要素。未单独填写时自动共用小说助手的配置。</li>
                  <li><strong>蒸馏作者专用：</strong>用于数万至百万字小说原著样本的文风 (writing skill) 与人格 (persona) 深度提炼，推荐配置长上下文模型。</li>
                </ul>
              </li>
              <li><strong>Base URL 规范：</strong>必须填写实际 API 接口网关地址（如 <code>https://api.deepseek.com/v1</code> 或本地 CC-Switch 代理 <code>http://127.0.0.1:15721/v1</code>），<strong>切勿填写官网地址（如 https://ccswitch.io/）</strong>。</li>
              <li><strong>协议匹配：</strong>如果使用 DeepSeek、OneAPI、NewAPI 或第三方兼容中转，请选择 <code>OpenAI 兼容</code>；如果直连 Anthropic 官方 Key，请选择 <code>Anthropic 原生</code>。</li>
              <li><strong>安全与隔离：</strong>保存的 Key 经 AES-256-GCM 强加密存储，仅在为你生成内容时解密，任何其他用户无法查看。</li>
            </ul>
          </div>

          {/* 指南 2 */}
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-ink text-sm">
              <Globe size={15} className="text-primary-2" /> 第二步：作品公开与私密可见性
            </h3>
            <ul className="list-disc space-y-1.5 pl-4 text-ink-2">
              <li><strong>🌐 公开作品：</strong>展示在首页公开书库与读者端，所有读者可浏览你的作品简介、大纲和已发布章节。</li>
              <li><strong>🔒 私密作品：</strong>从公开书库彻底隐藏，仅你本人（及管理员）登录后可见，适合创作初期大纲草拟或个人私密作品。</li>
              <li><strong>随时切换：</strong>在「我的书架」作品卡片上，或在「写作台」顶栏，均可一键点击「公开 / 私密」徽章随时切换状态。</li>
            </ul>
          </div>

          {/* 指南 3 */}
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-ink text-sm">
              <Sparkles size={15} className="text-primary-2" /> 第三步：正文创作与全书全章节连贯识别
            </h3>
            <ul className="list-disc space-y-1.5 pl-4 text-ink-2">
              <li><strong>整书全局视野：</strong>AI 写作助手已升级支持<strong>整本小说所有章节识别</strong>！AI 会通盘读取全书完整章节目录、所有历史章节细纲与正文前文脉络，生成本章正文时严格承接前文剧情，杜绝设定冲突与吃书。</li>
              <li><strong>标准中文排版与首行缩进：</strong>编辑器、读者端与 AI 输出均原生支持每段首行自动缩进 2 字符（2em），并在章节顶栏提供 <code>一键排版</code> 按钮，可随时将杂乱草稿一秒规范化为标准段落缩进。</li>
              <li><strong>智能视口跟踪：</strong>AI 生成/续写/扩写时，编辑器视口会自动平滑滚动跟随 AI 最新的输出位置，无需手动下拉滚动条。</li>
              <li><strong>自动记忆章节：</strong>每次进入小说自动打开上次离开时停留的章节，无需翻找目录。</li>
            </ul>
          </div>

          {/* 指南 4 */}
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-ink text-sm">
              <Smartphone size={15} className="text-primary-2" /> 第四步：手机移动端流畅码字技巧
            </h3>
            <ul className="list-disc space-y-1.5 pl-4 text-ink-2">
              <li><strong>自适应 Tab 布局：</strong>在手机浏览器访问时，自动切换为 <code>[✍️ 正文写作]</code>、<code>[📑 章节细纲]</code>、<code>[📜 作品总纲]</code> 三大 Tab 视图。</li>
              <li><strong>沉浸式全屏：</strong>写作时正文编辑器独占全屏宽度，彻底告别侧边栏挤压；选章后秒切回编辑器继续码字。</li>
            </ul>
          </div>

          {/* 指南 5 */}
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-ink text-sm">
              <History size={15} className="text-primary-2" /> 第五步：选区右键润色与历史版本一键撤回
            </h3>
            <ul className="list-disc space-y-1.5 pl-4 text-ink-2">
              <li><strong>右键悬浮菜单：</strong>在编辑器中用鼠标（或手机长按）选中任意段落，点击鼠标右键唤起菜单，支持 <strong>✨ AI 润色选区</strong> 与 <strong>📝 AI 扩写选区</strong>，满意后一键替换。</li>
              <li><strong>历史快照撤回：</strong>AI 每次生成新正文前会自动对旧内容备份快照。点击顶栏 <code>🕒 历史版本</code> 可随时查看时间轴并一键还原。</li>
            </ul>
          </div>

          {/* 指南 6 */}
          <div className="rounded-lg border border-border bg-surface-2 p-4">
            <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-ink text-sm">
              <HelpCircle size={15} className="text-primary-2" /> 常见报错与排查速查表
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
              <div className="rounded border border-border bg-surface-3 p-2.5">
                <p className="font-semibold text-red-300">❌ HTTP 401 / 403 认证失败</p>
                <p className="text-ink-3 mt-1">API Key 错误、过期或余额不足；或者协议选择错误（如 OpenAI 协议配了 Anthropic 原生 Key）。</p>
              </div>
              <div className="rounded border border-border bg-surface-3 p-2.5">
                <p className="font-semibold text-amber-300">❌ HTTP 404 路径不存在</p>
                <p className="text-ink-3 mt-1">Base URL 填成了官网地址（如 ccswitch.io）或末尾缺少 <code>/v1</code>，请前往「设置」核对。</p>
              </div>
              <div className="rounded border border-border bg-surface-3 p-2.5">
                <p className="font-semibold text-amber-300">❌ HTTP 429 限流 / 额度耗尽</p>
                <p className="text-ink-3 mt-1">模型服务商频次触发超限，稍等 1-2 分钟重试，或充值更换备用 Key。</p>
              </div>
              <div className="rounded border border-border bg-surface-3 p-2.5">
                <p className="font-semibold text-blue-300">❌ 无法连接到服务地址</p>
                <p className="text-ink-3 mt-1">使用本地代理（如 CC-Switch）时确认该软件已在后台运行并监听 15721 端口。</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
