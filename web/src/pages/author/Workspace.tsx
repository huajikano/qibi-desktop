import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import {
  ArrowLeft, Bot, ChevronDown, ChevronUp, Folder, FolderOpen, FilePlus2, ListTree, Map as MapIcon,
  PenLine, Plus, Save, Sparkles, Trash2, Users, X, AlignLeft, Wand2, Palette, RotateCcw,
  History, Undo2, Copy, Scissors, Clock, Check, BookOpen, FileText, Globe, Lock, Terminal, PlayCircle,
  Bookmark, Search, Bell,
} from "lucide-react";
import { chapterRevisionApi } from "../../api";
import type { ChapterRevision } from "../../types";
import { api, aiStream, ApiError, skillAuthorApi, writerStateApi } from "../../api";
import { PromptDialog } from "../../components/Dialog";
import type { Chapter, Character, DistilledAuthor, Novel, NovelWriterState, Outline } from "../../types";

const STATUSES = ["草稿", "已发布"];

type AiMode = "draft" | "continue" | "deslop" | "polish" | "expand" | "summary" | "suggest" | "outline" | "deslop-selection" | "polish-selection" | "expand-selection" | "review" | "analyze";

// 正文编辑器外观：背景色/文字色可由用户自定义，持久化到浏览器本地
const EDITOR_APPEARANCE_KEY = "novelforge:editor-appearance";
const EDITOR_APPEARANCE_DEFAULT = { bg: "#282c34", fg: "#e8e6f0" };

// 一键切换的预设主题，方便快速选定"写作感"配色
const EDITOR_APPEARANCE_PRESETS: Array<{ id: string; name: string; bg: string; fg: string; hint: string }> = [
  { id: "night", name: "默认深色", bg: "#282c34", fg: "#e8e6f0", hint: "柔和暗夜，长文不易疲劳" },
  { id: "paper", name: "纸黄暖光", bg: "#f5ecd5", fg: "#3a2e1f", hint: "纸张感护眼，长篇阅读首选" },
  { id: "ivory", name: "象牙白日", bg: "#fafaf3", fg: "#1f1f24", hint: "干净明亮，适合校对润色" },
  { id: "ink", name: "墨韵青灰", bg: "#1f2733", fg: "#cdd6e3", hint: "冷色调高对比，适合夜间码字" },
  { id: "sepia", name: "复古棕褐", bg: "#f1e7d0", fg: "#5b4636", hint: "怀旧复古风格，散文风" },
  { id: "focal", name: "沉浸焦糖", bg: "#2a221a", fg: "#e6d3a3", hint: "深褐暖光，长文沉浸防分心" },
];

// 沉浸模式（专注写作）：自动隐藏左右栏 + 顶栏紧凑 + 编辑器居中放大
const FOCUS_MODE_KEY = "novelforge:focus-mode";

// 操作反馈 toast（2s 自动消失，避免遮挡）
type Toast = { id: number; text: string; kind: "info" | "success" | "warn" };
let toastSeq = 0;

const LAST_ACTIVE_CHAPTER_PREFIX = "novelforge:last-active-chapter:";
const RAIL_WIDTH_KEY = "novelforge:workspace-rail-widths";

// 左右栏拖拽宽度：左栏 200-440 / 右栏 240-480，默认 288 / 320
type RailWidths = { left: number; right: number };
const RAIL_WIDTH_DEFAULT: RailWidths = { left: 288, right: 320 };
const RAIL_WIDTH_LIMITS = { left: [200, 440] as const, right: [240, 480] as const };

function loadRailWidths(): RailWidths {
  try {
    const raw = localStorage.getItem(RAIL_WIDTH_KEY);
    if (!raw) return RAIL_WIDTH_DEFAULT;
    const j = JSON.parse(raw);
    const l = Number(j?.left);
    const r = Number(j?.right);
    return {
      left: Number.isFinite(l) && RAIL_WIDTH_LIMITS.left[0] <= l && l <= RAIL_WIDTH_LIMITS.left[1] ? l : RAIL_WIDTH_DEFAULT.left,
      right: Number.isFinite(r) && RAIL_WIDTH_LIMITS.right[0] <= r && r <= RAIL_WIDTH_LIMITS.right[1] ? r : RAIL_WIDTH_DEFAULT.right,
    };
  } catch {
    return RAIL_WIDTH_DEFAULT;
  }
}

function getLastActiveChapterId(nId: number): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_CHAPTER_PREFIX + nId);
    if (!raw) return null;
    const num = Number(raw);
    return Number.isInteger(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

function setLastActiveChapterId(nId: number, cId: number | null): void {
  try {
    if (cId === null) {
      localStorage.removeItem(LAST_ACTIVE_CHAPTER_PREFIX + nId);
    } else {
      localStorage.setItem(LAST_ACTIVE_CHAPTER_PREFIX + nId, String(cId));
    }
  } catch {
    /* ignore */
  }
}

function loadEditorAppearance(): { bg: string; fg: string } {
  try {
    const raw = localStorage.getItem(EDITOR_APPEARANCE_KEY);
    if (!raw) return EDITOR_APPEARANCE_DEFAULT;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.bg === "string" && typeof parsed?.fg === "string") return parsed;
  } catch {
    /* ignore malformed local storage */
  }
  return EDITOR_APPEARANCE_DEFAULT;
}

export default function Workspace() {
  const { id } = useParams();
  const novelId = Number(id);

  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [outlines, setOutlines] = useState<Outline[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const activeIdRef = useRef<number | null>(null);
  const outlineSavedRef = useRef(new Map<number, string>());
  const [outlineErrors, setOutlineErrors] = useState<Record<number, string>>({});
  const [outlineSaving, setOutlineSaving] = useState<Record<number, boolean>>({});
  const [newChapterOpen, setNewChapterOpen] = useState(false);
  const [newChapterError, setNewChapterError] = useState("");
  const [newChapterSaving, setNewChapterSaving] = useState(false);
  const [outlineDialogOpen, setOutlineDialogOpen] = useState(false);
  const [outlineDialogChapterId, setOutlineDialogChapterId] = useState<number | null>(null);
  const [outlineDialogError, setOutlineDialogError] = useState("");
  const [outlineDialogSaving, setOutlineDialogSaving] = useState(false);
  const [bookOutlineOpen, setBookOutlineOpen] = useState(true);

  // 左侧创作助手栏：细纲/人物/前后章/查找替换 — 4 个独立折叠面板
  const [leftRailOpen, setLeftRailOpen] = useState(true);
  const [leftOutlineOpen, setLeftOutlineOpen] = useState(true);
  const [leftCharactersOpen, setLeftCharactersOpen] = useState(true);
  const [leftSiblingsOpen, setLeftSiblingsOpen] = useState(true);
  const [leftFindOpen, setLeftFindOpen] = useState(true);
  const [hoverCharId, setHoverCharId] = useState<number | null>(null);
  // 自定义细纲 marker：localStorage 覆盖默认"标题前 8 字"
  const [outlineMarkers, setOutlineMarkers] = useState<Record<number, string>>(() => {
    try {
      const raw = localStorage.getItem("novelforge:outline-markers");
      return raw ? (JSON.parse(raw) as Record<number, string>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try { localStorage.setItem("novelforge:outline-markers", JSON.stringify(outlineMarkers)); } catch { /* ignore */ }
  }, [outlineMarkers]);
  const [editingMarkerId, setEditingMarkerId] = useState<number | null>(null);
  const [editingMarkerDraft, setEditingMarkerDraft] = useState("");

  // 左右栏宽度持久化 + 拖拽状态
  const [railWidths, setRailWidths] = useState<RailWidths>(loadRailWidths);
  const dragRailRef = useRef<{ side: "left" | "right"; startX: number; startLeft: number; startRight: number } | null>(null);
  const [draggingRail, setDraggingRail] = useState<"left" | "right" | null>(null);
  useEffect(() => {
    try { localStorage.setItem(RAIL_WIDTH_KEY, JSON.stringify(railWidths)); } catch { /* ignore */ }
  }, [railWidths]);

  const onRailDragStart = (side: "left" | "right", event: React.MouseEvent) => {
    event.preventDefault();
    dragRailRef.current = { side, startX: event.clientX, startLeft: railWidths.left, startRight: railWidths.right };
    setDraggingRail(side);
  };
  useEffect(() => {
    if (!draggingRail) return;
    const onMove = (e: MouseEvent) => {
      const drag = dragRailRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      if (drag.side === "left") {
        // 左侧变宽 → dx>0
        const next = Math.min(RAIL_WIDTH_LIMITS.left[1], Math.max(RAIL_WIDTH_LIMITS.left[0], drag.startLeft + dx));
        setRailWidths((w) => ({ ...w, left: next }));
      } else {
        // 右侧变宽 → dx<0
        const next = Math.min(RAIL_WIDTH_LIMITS.right[1], Math.max(RAIL_WIDTH_LIMITS.right[0], drag.startRight - dx));
        setRailWidths((w) => ({ ...w, right: next }));
      }
    };
    const onUp = () => setDraggingRail(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingRail]);


  // 移动端视图切换（正文写作 / 章节与细纲 / 作品总纲）
  const [mobileTab, setMobileTab] = useState<"editor" | "chapters" | "outline">("editor");

  // 历史版本抽屉与快捷撤回
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<ChapterRevision[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedRevision, setSelectedRevision] = useState<ChapterRevision | null>(null);
  const [lastBackupNotice, setLastBackupNotice] = useState<string | null>(null);

  // 右键选区快捷菜单
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string; from: number; to: number } | null>(null);

  // AI 抽屉
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiExtra, setAiExtra] = useState("");
  const [aiMode, setAiMode] = useState<AiMode>("draft");
  const aiModeRef = useRef<AiMode>("draft");
  const [agentTab, setAgentTab] = useState<"writer" | "butler">("writer");
  const [agentTask, setAgentTask] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentLog, setAgentLog] = useState<Array<{
    kind: "text" | "tool_call" | "tool_result" | "done" | "error" | "tool_error";
    text?: string;
    name?: string;
    args?: any;
    preview?: string;
    error?: string;
    severity?: string;
    step?: number
  }>>([]);
  const [agentIncludeExternal, setAgentIncludeExternal] = useState(true);
  const [kbOpen, setKbOpen] = useState(false);
  const [kbStats, setKbStats] = useState<{ chunks: number; lastIndexed: string | null } | null>(null);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbQuery, setKbQuery] = useState("");
  const [kbHits, setKbHits] = useState<Array<{ source_kind: string; title: string | null; score: number; preview: string }>>([]);
  const [kbMsg, setKbMsg] = useState<string | null>(null);
  const [aiPreview, setAiPreview] = useState("");
  const [aiReport, setAiReport] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [outlineSavedMsg, setOutlineSavedMsg] = useState("");
  const selectionRef = useRef<{ chapterId: number; from: number; to: number; text: string; baseDoc: string } | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const [editorAppearance, setEditorAppearance] = useState(loadEditorAppearance);
  const [appearancePanelOpen, setAppearancePanelOpen] = useState(false);
  const [progressExtracting, setProgressExtracting] = useState(false);
  const [foreshadowingExtracting, setForeshadowingExtracting] = useState(false);
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<boolean>(() => {
    try { return localStorage.getItem(FOCUS_MODE_KEY) === "1"; } catch { return false; }
  });
  const [findTerm, setFindTerm] = useState("");
  const [replaceTerm, setReplaceTerm] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findIndex, setFindIndex] = useState(0);
  const [findTotal, setFindTotal] = useState(0);
  const [findError, setFindError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastSeq;
    setToasts((arr) => [...arr, { id, text, kind }]);
    window.setTimeout(() => setToasts((arr) => arr.filter((t) => t.id !== id)), 2000);
  }, []);
  const [writerState, setWriterState] = useState<NovelWriterState | null>(null);
  const [skillAuthors, setSkillAuthors] = useState<DistilledAuthor[]>([]);
  const [writerSaving, setWriterSaving] = useState(false);

  useEffect(() => {
    localStorage.setItem(EDITOR_APPEARANCE_KEY, JSON.stringify(editorAppearance));
  }, [editorAppearance]);

  useEffect(() => {
    try { localStorage.setItem(FOCUS_MODE_KEY, focusMode ? "1" : "0"); } catch { /* ignore */ }
  }, [focusMode]);

  // Alt+F 切换沉浸模式
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "f" || e.key === "F") && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        setFocusMode((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 沉浸模式切换给个 toast 反馈
  useEffect(() => {
    pushToast(focusMode ? "已进入沉浸模式 · Alt+F 退出" : "已退出沉浸模式", "info");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMode]);

  useEffect(() => {
    aiModeRef.current = aiMode;
  }, [aiMode]);

  useEffect(() => {
    void Promise.all([writerStateApi.get(novelId), skillAuthorApi.list()]).then(([state, authors]) => {
      setWriterState(state);
      setSkillAuthors(authors);
    }).catch(() => {
      /* optional writing-assistant state */
    });
  }, [novelId]);

  // 自定义正文编辑器主题：用户可调背景/文字色 + 中文友好的衬线字体 + 纸张感视觉
  const editorTheme = useMemo(
    () => {
      // 判断用户选择的是深色还是浅色背景，用于微调高亮/选区颜色
      const hex = editorAppearance.bg.replace("#", "");
      let r = 0x80, g = 0x80, b = 0x80;
      if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      } else if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      }
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const isDark = luminance < 0.55;

      const activeLineBg = isDark ? "#ffffff0a" : "#0000000a";
      const selectionBg = isDark ? "#7aa2f74d" : "#3a5a8c4d";
      const gutterColor = isDark
        ? "color-mix(in srgb, " + editorAppearance.fg + " 35%, transparent)"
        : "color-mix(in srgb, " + editorAppearance.fg + " 30%, transparent)";

      return EditorView.theme(
        {
          "&": {
            backgroundColor: editorAppearance.bg,
            color: editorAppearance.fg,
            height: "100%",
            // 衬线字体优先，中文走宋体族，长文阅读更舒适
            fontFamily:
              '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", Georgia, "Times New Roman", serif',
            fontSize: focusMode ? "17.5px" : "16.5px",
            lineHeight: focusMode ? "2.05" : "2.0",
          },
          ".cm-scroller": {
            fontFamily: "inherit",
            lineHeight: "inherit",
            padding: focusMode ? "28px 48px 60px" : "20px 36px 40px",
            width: "100%",
            maxWidth: "100%",
            margin: "0",
          },
          ".cm-content": {
            caretColor: editorAppearance.fg,
            padding: "8px 0",
          },
          ".cm-line": {
            // 首行缩进由内容里的「　　」承担，避免叠成 4 字缩进
            paddingLeft: "0",
          },
          ".cm-gutters": {
            backgroundColor: editorAppearance.bg,
            color: gutterColor,
            border: "none",
          },
          ".cm-activeLine": {
            backgroundColor: activeLineBg,
          },
          ".cm-activeLineGutter": {
            backgroundColor: activeLineBg,
            color: editorAppearance.fg,
          },
          "&.cm-focused .cm-cursor": {
            borderLeftColor: editorAppearance.fg,
            borderLeftWidth: "2px",
          },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: selectionBg,
          },
          ".cm-placeholder": {
            color: isDark ? "#ffffff59" : "#00000059",
            fontStyle: "italic",
          },
        },
        { dark: isDark }
      );
    },
    [editorAppearance, focusMode]
  );

  // 智能段落规范排版：把每段首行多余的前导空白（含全角空格）清掉，统一补上两个全角空格。
  // 由于编辑器 CSS 不再使用 text-indent，正文段落缩进完全由内容里的「　　」字符承担，
  // 这样既能保证导出/Reader 端的排版一致，又避免与 CSS 视觉缩进叠成 4 个字符。
  // 修改通过 CodeMirror dispatch 写入，进入编辑器的撤销栈（Ctrl+Z 可回退）。
  const autoFormatIndents = () => {
    const view = editorViewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();
    if (!doc) return;
    const formatted = doc
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return "";
        // Markdown 结构行（标题/列表/引用/代码块/表格/分割线）跳过，不强加中文缩进
        if (/^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^>\s|^```|^---\s*$|^\|/.test(trimmed)) {
          return trimmed;
        }
        // 去掉所有前导半角空格 / 全角空格 / Tab / 零宽空白，再统一补两个全角空格
        return "　　" + trimmed;
      })
      .join("\n");
    if (formatted === doc) return; // 已是规整状态，不写入撤销栈
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
      selection: { anchor: 0 },
      scrollIntoView: false,
      userEvent: "input.format",
    });
  };

  const saveTimer = useRef<number | null>(null);

  const scrollEditorToBottom = useCallback(() => {
    const scroller = editorHostRef.current?.querySelector<HTMLElement>(".cm-scroller");
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
    const view = editorViewRef.current;
    if (view) {
      const docLen = view.state.doc.length;
      view.dispatch({
        selection: { anchor: docLen, head: docLen },
        effects: EditorView.scrollIntoView(docLen, { y: "end" }),
      });
    }
  }, []);

  const load = useCallback(async (preferredId?: number | null) => {
    const [n, cs, os, chs] = await Promise.all([
      api.get<Novel>(`/novels/${novelId}`),
      api.get<Chapter[]>(`/novels/${novelId}/chapters`),
      api.get<Outline[]>(`/novels/${novelId}/outlines`),
      api.get<Character[]>(`/novels/${novelId}/characters`).catch(() => [] as Character[]),
    ]);
    setNovel(n);
    setChapters(cs);
    setOutlines(os);
    setCharacters(chs || []);
    outlineSavedRef.current = new Map(os.map((o) => [o.id, o.content]));

    // 优先读取记忆的上次激活章节，无记录时若有章节默认选中第1章或最新章
    const savedLastId = getLastActiveChapterId(novelId);
    const nextId = preferredId && cs.some((c) => c.id === preferredId)
      ? preferredId
      : activeIdRef.current && cs.some((c) => c.id === activeIdRef.current)
        ? activeIdRef.current
        : savedLastId && cs.some((c) => c.id === savedLastId)
          ? savedLastId
          : cs[0]?.id ?? null;

    if (nextId !== null) {
      setActiveId(nextId);
      activeIdRef.current = nextId;
      setLastActiveChapterId(novelId, nextId);
      try {
        const c = await api.get<Chapter>(`/chapters/${nextId}`);
        setContent(c.content);
      } catch {
        /* ignore */
      }
    } else {
      setActiveId(null);
      setContent("");
    }
  }, [novelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectChapter = async (chapterId: number) => {
    if (dirty) await saveNow();
    setActiveId(chapterId);
    activeIdRef.current = chapterId;
    setLastActiveChapterId(novelId, chapterId);
    setMobileTab("editor");
    const c = await api.get<Chapter>(`/chapters/${chapterId}`);
    setContent(c.content);
  };

  // AI 自动生成正文期间实时平滑跟踪视口至最新生成位置
  useEffect(() => {
    if (aiBusy) {
      scrollEditorToBottom();
    }
  }, [aiBusy, content, scrollEditorToBottom]);

  const saveNow = useCallback(async () => {
    if (activeId === null) return;
    setSaving(true);
    try {
      await api.patch(`/chapters/${activeId}`, { content });
      setDirty(false);
      setChapters((cs) =>
        cs.map((c) =>
          c.id === activeId
            ? { ...c, word_count: (content.match(/[一-鿿]/g) || []).length }
            : c
        )
      );
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }, [activeId, content]);

  const onChange = (v: string) => {
    setContent(v);
    setDirty(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveNow(), 1500);
  };


  const loadRevisions = async (chapterId: number) => {
    setHistoryLoading(true);
    try {
      const list = await chapterRevisionApi.list(chapterId);
      setRevisions(list);
      if (list[0]) {
        try {
          const first = await chapterRevisionApi.get(chapterId, list[0].id);
          setSelectedRevision(first);
        } catch {
          setSelectedRevision(list[0]);
        }
      } else {
        setSelectedRevision(null);
      }
    } catch {
      setRevisions([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = () => {
    if (!activeId) return;
    setHistoryOpen(true);
    void loadRevisions(activeId);
  };

  const restoreRevision = async (rev: ChapterRevision) => {
    if (!activeId) return;
    if (!confirm(`确定将正文恢复至版本「${rev.reason}」（${rev.created_at}）？
当前正文会自动存为新快照。`) ) return;
    try {
      const res = await chapterRevisionApi.restore(activeId, rev.id);
      setContent(res.content);
      setDirty(false);
      setLastBackupNotice("已恢复至版本：" + rev.reason);
      setChapters((cs) => cs.map((c) => c.id === activeId ? { ...c, word_count: res.word_count } : c));
      await loadRevisions(activeId);
    } catch (err: any) {
      alert(err.message || "恢复版本失败");
    }
  };

  const quickUndo = async () => {
    if (!activeId) return;
    try {
      const list = await chapterRevisionApi.list(activeId);
      if (!list.length) {
        alert("当前章节暂无历史版本可撤回");
        return;
      }
      await restoreRevision(list[0]);
    } catch (err: any) {
      alert(err.message || "撤回失败");
    }
  };

  const openNewChapterDialog = () => {
    setNewChapterError("");
    setNewChapterOpen(true);
  };

  const addChapter = async (title: string) => {
    setNewChapterSaving(true);
    setNewChapterError("");
    try {
      const created = await api.post<Chapter>(`/novels/${novelId}/chapters`, { title });
      setChapters((cs) => [...cs, created]);
      setActiveId(created.id);
      activeIdRef.current = created.id;
      setContent(created.content || "");
      setDirty(false);
      setNewChapterOpen(false);
    } catch (err: any) {
      setNewChapterError(err instanceof ApiError ? err.message : err?.message || "新建章节失败，请重试");
    } finally {
      setNewChapterSaving(false);
    }
  };

  const updateChapter = async (chapterId: number, patch: Partial<Chapter>) => {
    await api.patch(`/chapters/${chapterId}`, patch);
    await load();
  };

  const moveChapter = async (chapterId: number, dir: "up" | "down") => {
    await api.post(`/chapters/${chapterId}/move`, { dir });
    await load();
  };

  const removeChapter = async (chapterId: number) => {
    if (!confirm("确定删除该章节？（其细纲将一并删除）")) return;
    await api.del(`/chapters/${chapterId}`);
    if (activeId === chapterId) {
      setActiveId(null);
      setContent("");
    }
    await load();
  };

  const openOutlineDialog = (chapterId: number | null) => {
    setOutlineDialogChapterId(chapterId);
    setOutlineDialogError("");
    setOutlineDialogOpen(true);
  };

  const addOutline = async (title: string) => {
    setOutlineDialogSaving(true);
    setOutlineDialogError("");
    try {
      const created = await api.post<Outline>(`/novels/${novelId}/outlines`, {
        title,
        content: "",
        chapter_id: outlineDialogChapterId,
      });
      setOutlines((os) => [...os, created]);
      outlineSavedRef.current.set(created.id, created.content);
      setExpanded((ex) => ({ ...ex, [created.id]: true }));
      setOutlineDialogOpen(false);
    } catch (err: any) {
      setOutlineDialogError(err instanceof ApiError ? err.message : err?.message || "添加大纲失败，请重试");
    } finally {
      setOutlineDialogSaving(false);
    }
  };

  const updateOutline = async (oid: number, patch: Partial<Outline>) => {
    setOutlineSaving((s) => ({ ...s, [oid]: true }));
    setOutlineErrors((s) => ({ ...s, [oid]: "" }));
    try {
      await api.patch(`/outlines/${oid}`, patch);
      if (typeof patch.content === "string") outlineSavedRef.current.set(oid, patch.content);
      setOutlines((os) => os.map((o) => (o.id === oid ? { ...o, ...patch } : o)));
    } catch (err: any) {
      setOutlineErrors((s) => ({ ...s, [oid]: err?.message || "细纲保存失败，请重试" }));
    } finally {
      setOutlineSaving((s) => ({ ...s, [oid]: false }));
    }
  };

  const removeOutline = async (oid: number) => {
    if (!confirm("确定删除该大纲条目？")) return;
    await api.del(`/outlines/${oid}`);
    await load();
  };

  // ---- AI ----
  const selectedAuthorSkill = skillAuthors.find((author) => author.id === writerState?.distilled_author_id)?.current_version?.skill_markdown || "";
  const assistantExtra = [
    aiExtra.trim(),
    selectedAuthorSkill ? `【当前作者 Skill】\n${selectedAuthorSkill}` : "",
    writerState?.progress ? `【创作进度】\n${writerState.progress}` : "",
    writerState?.foreshadowing ? `【伏笔记录】\n${writerState.foreshadowing}` : "",
  ].filter(Boolean).join("\n\n");

  const saveWriterState = async (patch: Partial<Pick<NovelWriterState, "distilled_author_id" | "progress" | "foreshadowing">>) => {
    setWriterSaving(true);
    try {
      const saved = await writerStateApi.update(novelId, patch);
      setWriterState(saved);
    } catch (err: any) {
      setAiError(err?.message || "写作助手状态保存失败");
    } finally {
      setWriterSaving(false);
    }
  };

  const extractWriterState = async (field: "progress" | "foreshadowing") => {
    if (!activeId) {
      setAiError("请先选中一个章节");
      return;
    }
    if (field === "progress" ? progressExtracting : foreshadowingExtracting) return;
    const setter = field === "progress" ? setProgressExtracting : setForeshadowingExtracting;
    setter(true);
    setExtractMsg(null);
    try {
      const fieldLabel = field === "progress" ? "【创作进度】" : "【伏笔清单】";
      const taskHint =
        field === "progress"
          ? "请提炼【创作进度】：当前卷/篇章名、已完成的关键情节节点、下一步推进计划；不超过 400 字，使用条目化表达，便于作者后续修改。"
          : "请扫描当前章节正文，提取【伏笔清单】：已埋设伏笔与待回收伏笔，按 Markdown 条目输出（可用 - / 1.），每条一句话并标注所在段落。";
      let streamBuffer = "";
      const full = await aiStream(
        "/ai/run",
        {
          role: "suggest",
          novelId,
          chapterId: activeId,
          content,
          save: false,
          extra: assistantExtra,
          prompt: `${taskHint}\n\n只输出${fieldLabel}正文，不要加解释、不要用代码块。`,
        },
        (delta) => {
          streamBuffer += delta;
          setWriterState((state) =>
            state ? { ...state, [field]: streamBuffer } : state
          );
        }
      );
      const saved = await writerStateApi.update(novelId, { [field]: full } as any);
      setWriterState(saved);
      setExtractMsg(field === "progress" ? "已更新创作进度" : "已更新伏笔清单");
      window.setTimeout(() => setExtractMsg(null), 2400);
    } catch (err: any) {
      setAiError(err?.message || "AI 提取失败，请稍后重试");
    } finally {
      setter(false);
    }
  };

  const runAI = async (overrideMode?: AiMode) => {
    if (!activeId || aiBusy) return;
    const mode = overrideMode ?? aiModeRef.current;
    setAiBusy(true);
    setAiError("");
    setSelectionError("");
    setAiPreview("");
    setAiReport("");
    setOutlineSavedMsg("");
    try {
      if (mode === "deslop-selection" || mode === "polish-selection" || mode === "expand-selection") {
        const view = editorViewRef.current;
        const range = view?.state.selection.main;
        if (!view || !range || range.empty) {
          setSelectionError(mode === "deslop-selection" ? "请先在正文编辑器中选中要去AI味的文字。" : "请先在正文编辑器中选中文字。");
          return;
        }
        const selectedText = view.state.sliceDoc(range.from, range.to);
        selectionRef.current = { chapterId: activeId, from: range.from, to: range.to, text: selectedText, baseDoc: view.state.doc.toString() };
        let streamed = "";
        const role = mode === "deslop-selection" ? "deslop" : mode === "polish-selection" ? "polish" : "expand";
        const prompt = mode === "deslop-selection"
          ? "只输出这段选中文本按照 7 Gate 门禁系统去AI味精修后的替换内容，彻底清除套路词与工整腔调，不要解释、标题、引号或 Markdown 代码围栏；保持原剧情与人物口吻。"
          : mode === "polish-selection"
          ? "只输出这段选中文本的润色后替换内容，不要解释、标题、引号或 Markdown 代码围栏；保持原意、结构和人物口吻。"
          : "只输出这段选中文本的扩写后替换内容，丰富细节、环境描写、心理活动或对话神态，不要解释、标题、引号或 Markdown 代码围栏；自然替换原段落。";
        await aiStream("/ai/run", {
          role, novelId, chapterId: activeId, content: selectedText, save: false, extra: assistantExtra,
          prompt,
        }, (text) => { streamed += text; setAiPreview(streamed); });
        return;
      }
      const isDraftLike = mode === "draft" || mode === "continue" || mode === "deslop" || mode === "expand" || mode === "polish";
      if (isDraftLike) {
        const originalContent = content;
        let streamed = "";
        const prompt = mode === "draft"
          ? "请深入结合全书已写各章节的前文剧情脉络与人物发展，紧扣本章细纲，创作本章完整正文。"
          : mode === "deslop"
          ? "请严格执行 7 Gate 门禁系统，全面消除本章正文中的 AI 套路词与模板化痕迹，输出去AI味精修后的自然全文。"
          : mode === "polish"
          ? "请结合全书剧情与人物口吻，润色当前章节正文，输出润色后的完整全文。"
          : mode === "expand"
          ? "请结合全书设定与前文伏笔，丰富细节与环境心理描写，扩写当前章节正文，输出扩写后的完整全文。"
          : "请紧密承接前文与本章已有正文，结合全书所有章节剧情与设定，自然续写（只需输出新增的续写内容）。";
        await aiStream("/ai/run", {
          role: mode, novelId, chapterId: activeId,
          content: mode === "continue" || mode === "deslop" || mode === "polish" || mode === "expand" ? content : undefined,
          extra: assistantExtra, save: true,
          prompt,
        }, (text) => {
          streamed += text;
          if (mode === "continue") {
            setContent(originalContent + (originalContent ? "\n" : "") + streamed);
          } else {
            setContent(streamed);
          }
          scrollEditorToBottom();
        });
        if (mode === "continue") {
          // AI 续写只产出新内容；服务端已把续写单独保存，需把前文与续写拼回一章，避免覆盖原文
          const saved = await api.get<Chapter>(`/chapters/${activeId}`);
          const finalContent = originalContent + (originalContent ? "\n" : "") + saved.content.trimEnd();
          if (saved.content.trim() && finalContent !== saved.content) {
            setContent(finalContent);
            await api.patch(`/chapters/${activeId}`, { content: finalContent });
            const updated = await api.get<Chapter>(`/chapters/${activeId}`);
            setChapters((cs) => cs.map((c) => c.id === activeId ? { ...c, word_count: updated.word_count, status: updated.status } : c));
          }
          setDirty(false);
          setLastBackupNotice("AI 续写已完成，原正文已自动存入历史版本。");
        } else {
          const saved = await api.get<Chapter>(`/chapters/${activeId}`);
          setContent(saved.content); setDirty(false); setLastBackupNotice(`AI 已生成新正文，原正文已自动存入历史版本。`);
          setChapters((cs) => cs.map((c) => c.id === activeId ? { ...c, word_count: saved.word_count, status: saved.status } : c));
        }
      } else {
        const defaultPrompt = mode === "review"
          ? "请对当前章节进行资深主编与核心老读者双重视角的对抗式审查，给出毒点预警、结构节奏诊断与可执行修改示范。"
          : mode === "analyze"
          ? "请深度拆解当前文本的故事核、黄金三章抓人点、压抑与释放情绪曲线、金手指节奏与写作技巧。"
          : mode === "summary"
          ? "总结本章。"
          : mode === "outline"
          ? "基于当前进度，为接下来的章节生成细纲建议。"
          : "请针对下面【补充要求】中作者提出的创作问题，给出专业、具体、前后严谨一致的可执行建议。";
        let streamed = "";
        await aiStream("/ai/run", { role: mode, novelId, chapterId: activeId, content, extra: assistantExtra, prompt: defaultPrompt }, (text) => {
          streamed += text;
          setAiReport(streamed);
        });
      }
    } catch (err: any) {
      setAiError(err.message || "AI 请求失败");
    } finally {
      setAiBusy(false);
    }
  };
const saveReportAsOutline = async (asChapter: boolean) => {
    const text = aiReport.trim();
    if (!text) return;
    try {
      await api.post<Outline>(`/novels/${novelId}/outlines`, {
        title: `AI${asChapter ? " 本章" : " 分卷总纲"}规划 · ${new Date().toLocaleDateString()}`,
        content: text,
        chapter_id: asChapter && activeId ? activeId : null,
      });
      await load();
      setOutlineSavedMsg(asChapter ? "已保存为本章细纲 ✓" : "已保存为作品总纲 ✓");
    } catch (err: any) {
      setOutlineSavedMsg(err?.message || "保存失败，请重试");
    }
  };

  // 监听全局点击以关闭右键菜单
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  const handleEditorContextMenu = (e: React.MouseEvent) => {
    const view = editorViewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) {
      // 未选中文本时保留原生系统菜单
      return;
    }
    const selectedText = view.state.doc.sliceString(from, to).trim();
    if (!selectedText) return;

    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      text: selectedText,
      from,
      to,
    });
  };

  const startSelectionAction = (action: "deslop-selection" | "polish-selection" | "expand-selection") => {
    if (!contextMenu || !activeId) return;
    const view = editorViewRef.current;
    if (!view) return;
    selectionRef.current = {
      chapterId: activeId,
      from: contextMenu.from,
      to: contextMenu.to,
      text: contextMenu.text,
      baseDoc: view.state.doc.toString(),
    };
    setAiMode(action);
    setAiOpen(true);
    setContextMenu(null);
    void runSelectionAI(action, contextMenu.text);
  };

  const runSelectionAI = async (mode: "deslop-selection" | "polish-selection" | "expand-selection", selectedText: string) => {
    setAiBusy(true);
    setAiError("");
    setSelectionError("");
    setAiPreview("");
    setAiReport("");
    let streamed = "";
    try {
      const role = mode === "deslop-selection" ? "deslop" : mode === "polish-selection" ? "polish" : "expand";
      const prompt = mode === "deslop-selection"
        ? "只输出这段选中文本按照 7 Gate 门禁系统去AI味精修后的替换内容，彻底清除套路词与工整腔调，不要解释、标题、引号或 Markdown 代码围栏；保持原剧情与人物口吻。"
        : mode === "polish-selection"
        ? "只输出这段选中文本的润色后替换内容，不要解释、标题、引号或 Markdown 代码围栏；保持原意、结构和人物口吻。"
        : "只输出这段选中文本的扩写后替换内容，丰富细节、环境描写、心理活动或对话神态，不要解释、标题、引号或 Markdown 代码围栏；自然替换原段落。";
      await aiStream("/ai/run", {
        role,
        novelId,
        chapterId: activeId,
        content: selectedText,
        save: false,
        extra: aiExtra,
        prompt,
      }, (text) => {
        streamed += text;
        setAiPreview(streamed);
      });
    } catch (err: any) {
      setAiError(err.message || "选区 AI 请求失败");
    } finally {
      setAiBusy(false);
    }
  };

  const applySelectionPreview = () => {
    const snapshot = selectionRef.current;
    const view = editorViewRef.current;
    if (!snapshot || !view || !aiPreview.trim()) return;
    const current = view.state.doc.toString();
    if (activeId !== snapshot.chapterId || current !== snapshot.baseDoc || current.slice(snapshot.from, snapshot.to) !== snapshot.text) {
      setSelectionError("正文已发生变化，请重新选择文字后再润色。");
      return;
    }
    view.dispatch({ changes: { from: snapshot.from, to: snapshot.to, insert: aiPreview }, selection: { anchor: snapshot.from, head: snapshot.from + aiPreview.length }, userEvent: "input" });
    setAiPreview("");
    selectionRef.current = null;
  };

  const activeChapter = chapters.find((c) => c.id === activeId) || null;
  const chapterOutlines = outlines.filter((o) => o.chapter_id === activeId);
  const bookOutlines = outlines.filter((o) => o.chapter_id === null);

  // 前后章快查：当前章节索引 ±3
  const activeIndex = activeChapter ? chapters.findIndex((c) => c.id === activeChapter.id) : -1;
  const siblingChapters = activeIndex >= 0
    ? chapters.filter((c, idx) => Math.abs(idx - activeIndex) <= 3 && c.id !== activeChapter!.id)
    : [];

  // 章节细纲 → 文本标记（用于在正文中搜索锚点）
  // 优先用自定义 marker，否则用标题前 8 字
  const chapterOutlinesWithText = useMemo(() => {
    if (!activeChapter || !content) return [];
    const text = content.replace(/\r\n/g, "\n");
    return chapterOutlines.map((o) => {
      const custom = (outlineMarkers[o.id] || "").trim();
      const fallback = o.title.trim().slice(0, 8);
      const marker = custom || fallback;
      if (!marker) return { outline: o, pos: -1, marker: fallback };
      const pos = text.indexOf(marker);
      return { outline: o, pos, marker };
    });
  }, [activeChapter, chapterOutlines, content, outlineMarkers]);

  // 角色卡快查：扫正文是否包含角色名/别名（中文环境按名匹配）
  const charactersInChapter = useMemo(() => {
    if (!content || !characters.length) return [] as Character[];
    const txt = content;
    return characters.filter((c) => {
      if (c.name && txt.includes(c.name)) return true;
      if (c.alias) {
        // 别名支持「、」分隔
        const aliases = c.alias.split(/[、,，\s]+/).filter(Boolean);
        return aliases.some((a) => a && txt.includes(a));
      }
      return false;
    });
  }, [content, characters]);

  const jumpToOutlineMarker = (outline: Outline) => {
    const custom = (outlineMarkers[outline.id] || "").trim();
    const marker = custom || outline.title.trim().slice(0, 8);
    if (!marker) return;
    const view = editorViewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    const pos = text.indexOf(marker);
    if (pos < 0) {
      alert(`未在正文中找到标记「${marker}」${custom ? "（自定义）" : "（标题前 8 字）"}。\n请在细纲上点击书签图标自定义更精准的 marker。`);
      return;
    }
    view.dispatch({
      selection: { anchor: pos, head: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
      userEvent: "select",
    });
    view.focus();
  };

  // ---- 查找与替换：与 txt 的 Ctrl+F / Ctrl+H 行为一致 ----
  // 用本地状态扫描 content，结果存 ref，触发 effect 后让 CodeMirror 跳转
  type FindMatch = { from: number; to: number };
  const findMatchesRef = useRef<FindMatch[]>([]);
  const findRegexRef = useRef<RegExp | null>(null);

  useEffect(() => {
    setFindError(null);
    findMatchesRef.current = [];
    findRegexRef.current = null;
    const term = findTerm;
    if (!term) {
      setFindTotal(0);
      setFindIndex(0);
      return;
    }
    let regex: RegExp;
    try {
      if (findRegex) {
        regex = new RegExp(term, findCase ? "g" : "gi");
      } else {
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, findCase ? "g" : "gi");
      }
    } catch (err: any) {
      setFindError(err?.message || "正则无效");
      setFindTotal(0);
      setFindIndex(0);
      return;
    }
    findRegexRef.current = regex;
    const matches: FindMatch[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      if (m.index === regex.lastIndex) regex.lastIndex++; // 防止零宽死循环
      matches.push({ from: m.index, to: m.index + m[0].length });
      if (matches.length >= 2000) break; // 安全上限
    }
    findMatchesRef.current = matches;
    setFindTotal(matches.length);
    setFindIndex((idx) => (matches.length === 0 ? 0 : Math.min(idx, matches.length - 1)));
  }, [findTerm, findCase, findRegex, content]);

  const gotoFindMatch = (nextIndex: number) => {
    const matches = findMatchesRef.current;
    if (!matches.length) return;
    const idx = ((nextIndex % matches.length) + matches.length) % matches.length;
    setFindIndex(idx);
    const view = editorViewRef.current;
    if (!view) return;
    const m = matches[idx];
    view.dispatch({
      selection: { anchor: m.from, head: m.to },
      effects: EditorView.scrollIntoView(m.from, { y: "center" }),
      userEvent: "select",
    });
    view.focus();
  };

  const replaceFindMatch = (onlyCurrent: boolean) => {
    const view = editorViewRef.current;
    if (!view) return;
    const matches = findMatchesRef.current;
    if (!matches.length) return;
    if (onlyCurrent) {
      const m = matches[findIndex];
      if (!m) return;
      view.dispatch({
        changes: { from: m.from, to: m.to, insert: replaceTerm },
        selection: { anchor: m.from + replaceTerm.length },
        userEvent: "input",
      });
      pushToast("已替换 1 处", "success");
    } else {
      const changes = matches
        .slice()
        .reverse()
        .map((m) => ({ from: m.from, to: m.to, insert: replaceTerm }));
      view.dispatch({ changes, userEvent: "input" });
      pushToast(`已替换 ${matches.length} 处`, "success");
    }
    view.focus();
  };

  const insertCharacterAtCursor = (name: string) => {
    const view = editorViewRef.current;
    if (!view) return;
    const range = view.state.selection.main;
    const insert = view.state.sliceDoc(range.from, range.to) === name ? "" : name;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: insert || name },
      selection: { anchor: range.from + (insert ? insert.length : name.length) },
      userEvent: "input",
    });
    view.focus();
  };

const isReportMode = aiMode === "review" || aiMode === "analyze" || aiMode === "summary" || aiMode === "outline" || aiMode === "suggest";

  const loadKbStats = async () => {
    try {
      const r = await api.get<{ chunks: number; lastIndexed: string | null }>(`/novels/${novelId}/kb/stats`);
      setKbStats(r);
    } catch { setKbStats(null); }
  };

  const rebuildKb = async () => {
    setKbBusy(true); setKbMsg(null);
    try {
      const r = await api.post<{ ok: boolean; chunks: number; sources: number }>(`/novels/${novelId}/kb/index`, {});
      setKbMsg(`已重建：${r.chunks} 条片段 · 来自 ${r.sources} 个章节`);
      await loadKbStats();
    } catch (e: any) { setKbMsg(e?.message || "重建失败"); }
    finally { setKbBusy(false); }
  };

  const runKbQuery = async () => {
    if (!kbQuery.trim()) return;
    setKbBusy(true); setKbMsg(null);
    try {
      const r = await api.post<{ hits: typeof kbHits }>(`/novels/${novelId}/kb/query`, { q: kbQuery.trim(), limit: 8 });
      setKbHits(r.hits || []);
      setKbMsg(`检索完成 · ${r.hits.length} 条命中`);
    } catch (e: any) { setKbMsg(e?.message || "检索失败"); }
    finally { setKbBusy(false); }
  };

  const dropKb = async () => {
    if (!confirm("确定清空当前作品的本地知识库索引？")) return;
    setKbBusy(true);
    try {
      await api.del(`/novels/${novelId}/kb`);
      setKbMsg("已清空知识库索引");
      setKbHits([]);
      await loadKbStats();
    } catch (e: any) { setKbMsg(e?.message || "清空失败"); }
    finally { setKbBusy(false); }
  };

  useEffect(() => { if (kbOpen) void loadKbStats(); }, [kbOpen, novelId]);

  const runAgent = async () => {
    if (!agentTask.trim() || agentBusy) return;
    setAgentBusy(true);
    setAgentLog([]);
    try {
      const res = await fetch("/api/agent/run", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: agentTask.trim(), novelId, includeExternal: agentIncludeExternal, maxSteps: 8 }),
      });
      if (!res.ok) {
        const errText = await res.text();
        setAgentLog([{ kind: "error", error: errText || `HTTP ${res.status}` }]);
        setAgentBusy(false);
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const e of events) {
          const lines = e.split("\n");
          let ev = "", data = "";
          for (const ln of lines) {
            if (ln.startsWith("event:")) ev = ln.slice(6).trim();
            else if (ln.startsWith("data:")) data += ln.slice(5).trim();
          }
          if (!ev || !data) continue;
          try {
            const payload = JSON.parse(data);
            if (ev === "assistant_text") setAgentLog((l) => [...l, { kind: "text", text: payload.text, step: payload.step }]);
            else if (ev === "tool_call") setAgentLog((l) => [...l, { kind: "tool_call", name: payload.name, args: payload.args, step: payload.step }]);
            else if (ev === "tool_result") setAgentLog((l) => [...l, { kind: "tool_result", name: payload.name, preview: payload.preview, step: payload.step }]);
            else if (ev === "done") {
              setAgentLog((l) => [...l, { kind: "done", text: payload.truncated ? "已达到步数上限" : "已完成" }]);
              void load(); // 自动刷新章节列表与正文，让 Agent 修改即时可见
            }
            else if (ev === "tool_error") setAgentLog((l) => [...l, { kind: "tool_error", name: payload.name, error: payload.error, severity: payload.severity }]);
            else if (ev === "error") setAgentLog((l) => [...l, { kind: "error", error: payload.error, severity: payload.severity }]);
          } catch { /* ignore */ }
        }
      }
    } catch (err: any) {
      setAgentLog((l) => [...l, { kind: "error", error: err?.message || String(err) }]);
    } finally {
      setAgentBusy(false);
    }
  };
  const reportTitle = aiMode === "outline" ? "📋 细纲规划输出"
    : aiMode === "review" ? "⚖️ 审查与诊断输出"
    : aiMode === "analyze" ? "🔍 爆款拆解输出"
    : aiMode === "summary" ? "📝 章节摘要输出"
    : aiMode === "suggest" ? "💡 创作建议输出"
    : "💡 辅助输出（非正文）";

  if (!novel) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center text-ink-2">
        作品不存在
        <div className="mt-4">
          <Link to="/author" className="btn-ghost text-sm">
            <ArrowLeft size={14} /> 返回书架
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full min-h-0 flex-col transition-colors duration-300 ${
      focusMode
        ? "bg-gradient-to-br from-[#1a1814] via-surface to-[#1a1814]"
        : "bg-gradient-to-br from-surface-1/40 via-surface to-surface-2/30"
    }`}>
      {/* 顶栏：渐变高光 + 作品主色描边 */}
      <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-surface via-surface to-surface-2 px-3 py-2.5 shadow-sm sm:px-4">
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-r bg-primary/70" aria-hidden />
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/author" className="btn-ghost !min-h-8 !px-2 text-xs shrink-0" aria-label="返回书架">
            <ArrowLeft size={14} />
          </Link>
          <span className="serif-title truncate text-base text-ink font-medium">{novel.title}</span>
          <span className="hidden rounded bg-primary-soft px-2 py-0.5 text-[10px] text-primary-2 sm:inline">{novel.genre}</span>
          <button
            type="button"
            className={`hidden items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors sm:inline-flex ${
              novel.is_public === 0
                ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
            }`}
            onClick={async () => {
              const nextVal = novel.is_public === 0 ? 1 : 0;
              await api.patch(`/novels/${novel.id}`, { is_public: nextVal });
              setNovel((n) => (n ? { ...n, is_public: nextVal } : n));
            }}
            title={novel.is_public === 0 ? "私密作品（仅自己可见），点击切换为公开" : "公开作品（全站可见），点击切换为私密"}
          >
            {novel.is_public === 0 ? <Lock size={10} /> : <Globe size={10} />}
            <span>{novel.is_public === 0 ? "私密" : "公开"}</span>
          </button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
          <Link to={`/author/book/${novelId}/characters`} className="btn-ghost !min-h-8 !px-2 text-xs shrink-0">
            <Users size={13} /> <span className="hidden sm:inline">人物</span>
          </Link>
          <Link to={`/author/book/${novelId}/map`} className="btn-ghost !min-h-8 !px-2 text-xs shrink-0">
            <MapIcon size={13} /> <span className="hidden sm:inline">地图</span>
          </Link>
          <Link to={`/author/distill?novelId=${novelId}`} className="btn-ghost !min-h-8 !px-2 text-xs shrink-0">
            <Sparkles size={13} /> <span className="hidden sm:inline">蒸馏作者</span>
          </Link>
          <button
            className="btn-ghost !min-h-8 !px-2 text-xs shrink-0"
            onClick={openHistory}
            disabled={!activeId}
            title="查看章节版本历史与撤回"
          >
            <History size={13} /> <span className="hidden sm:inline">历史版本</span>
          </button>
          <button
            className="btn-ghost !min-h-8 !px-2 text-xs shrink-0"
            onClick={() => setAiOpen((v) => !v)}
            aria-pressed={aiOpen}
          >
            <Bot size={13} /> <span className="hidden sm:inline">AI 助手</span>
          </button>
          <button
            className="btn-ghost !min-h-8 !px-2 text-xs shrink-0"
            onClick={() => setKbOpen((v) => !v)}
            aria-pressed={kbOpen}
            title="本地知识库 / RAG"
          >
            <BookOpen size={13} /> <span className="hidden sm:inline">知识库</span>
          </button>
          <button className="btn-primary !min-h-8 !px-2.5 text-xs shrink-0" onClick={() => void saveNow()} disabled={!dirty && !saving}>
            <Save size={13} /> {saving ? "保存中…" : dirty ? "保存" : "已保存"}
          </button>
          <button
            type="button"
            className={`btn-ghost !min-h-8 !px-2 text-xs shrink-0 transition-colors ${focusMode ? "!bg-primary-soft !text-primary-2 ring-1 ring-primary-2/40" : ""}`}
            onClick={() => setFocusMode((v) => !v)}
            aria-pressed={focusMode}
            title={focusMode ? "退出沉浸模式 (Alt+F)" : "进入沉浸模式 (Alt+F)：隐藏左右栏，放大正文"}
          >
            {focusMode ? <BookOpen size={13} /> : <PenLine size={13} />}
            <span className="hidden md:inline">{focusMode ? "退出沉浸" : "沉浸"}</span>
          </button>
        </div>
        {!leftRailOpen && (
          <button
            className="btn-ghost !min-h-8 !px-2 text-xs shrink-0 hidden xl:inline-flex"
            onClick={() => setLeftRailOpen(true)}
            aria-label="展开创作助手"
            title="展开左侧创作助手（细纲 / 人物 / 前后章 / 知识库）"
          >
            <ChevronDown size={13} className="-rotate-90" />
            <span className="hidden xl:inline">创作助手</span>
          </button>
        )}
      </div>

      {/* 移动端视图切换 Tab（手机与小屏设备专属） */}
      <div className="flex border-b border-border bg-surface-2/70 p-1 text-xs lg:hidden">
        <button
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-colors ${
            mobileTab === "editor"
              ? "bg-surface text-ink shadow-sm border border-border"
              : "text-ink-3 hover:text-ink"
          }`}
          onClick={() => setMobileTab("editor")}
        >
          <PenLine size={13} />
          <span>正文写作 {activeChapter ? `(${activeChapter.word_count}字)` : ""}</span>
        </button>
        <button
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-colors ${
            mobileTab === "chapters"
              ? "bg-surface text-ink shadow-sm border border-border"
              : "text-ink-3 hover:text-ink"
          }`}
          onClick={() => setMobileTab("chapters")}
        >
          <ListTree size={13} />
          <span>章节细纲 ({chapters.length})</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1">

        {/* 左：创作助手栏（细纲 / 人物 / 前后章 / 知识库召回） */}
        <aside
          style={{ width: railWidths.left }}
          className={`relative shrink-0 overflow-y-auto border-r border-border bg-surface-2/30 p-3 hidden xl:block transition-all duration-200 ${focusMode ? "!hidden" : ""} ${leftRailOpen ? "" : "!hidden"}`}
        >
          <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 shadow-sm">
            <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wider text-ink">
              <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-primary-soft text-primary-2">
                <Sparkles size={11} />
              </span>
              创作助手
            </h3>
            <button
              className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-primary-2"
              onClick={() => setLeftRailOpen(false)}
              aria-label="收起创作助手"
              title="收起"
            >
              <ChevronUp size={13} className="-rotate-90" />
            </button>
          </div>

          {/* 📋 当前章节细纲（点击 jump-to 锚点） */}
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <button
              type="button"
              className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
              onClick={() => setLeftOutlineOpen((v) => !v)}
              aria-expanded={leftOutlineOpen}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-2">
                <ListTree size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">本章细纲</p>
                <p className="text-[10px] text-ink-3">{chapterOutlines.length} 条 · 点击跳转</p>
              </div>
              <span className="shrink-0 text-ink-3 transition-transform" style={{ transform: leftOutlineOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>
                <ChevronDown size={14} />
              </span>
            </button>
            {leftOutlineOpen && (
              <div className="space-y-1.5 border-t border-border bg-surface-1/40 px-2 py-2">
                {!activeChapter && (
                  <p className="px-2 py-3 text-center text-[11px] text-ink-3">请先选择章节</p>
                )}
                {activeChapter && chapterOutlines.length === 0 && (
                  <p className="px-2 py-3 text-center text-[11px] text-ink-3">暂无本章细纲</p>
                )}
                {chapterOutlinesWithText.map(({ outline, pos, marker }, idx) => (
                  <div
                    key={outline.id}
                    className={`group rounded-md border px-2 py-1.5 transition-colors ${
                      pos >= 0 ? "border-border bg-surface hover:border-primary-2/50" : "border-dashed border-border/60 bg-surface-2/40 opacity-70"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => jumpToOutlineMarker(outline)}
                        disabled={pos < 0}
                        className="flex flex-1 items-center gap-1.5 text-left"
                        title={pos >= 0 ? `跳转到正文中的「${marker}」` : "正文尚未出现此细纲标记"}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-[9px] text-primary-2">{idx + 1}</span>
                        <span className="flex-1 truncate text-xs text-ink">{outline.title}</span>
                        <span className={`shrink-0 rounded px-1 text-[9px] ${pos >= 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-ink-3/10 text-ink-3"}`}>
                          {pos >= 0 ? "已出现" : "待写"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`shrink-0 rounded p-0.5 transition-colors ${outlineMarkers[outline.id] ? "text-primary-2" : "text-ink-3 opacity-0 group-hover:opacity-100"} hover:text-primary-2`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingMarkerId(outline.id);
                          setEditingMarkerDraft(outlineMarkers[outline.id] || "");
                        }}
                        aria-label="设置自定义 marker"
                        title={outlineMarkers[outline.id] ? `当前 marker：${outlineMarkers[outline.id]}` : "点击设置自定义 marker（精确匹配正文）"}
                      >
                        <Bookmark size={11} />
                      </button>
                    </div>
                    {editingMarkerId === outline.id && (
                      <div className="mt-1.5 flex items-center gap-1.5 rounded border border-primary-2/40 bg-surface-2 px-1.5 py-1">
                        <input
                          autoFocus
                          className="input flex-1 min-w-0 !py-0.5 text-[11px]"
                          value={editingMarkerDraft}
                          onChange={(e) => setEditingMarkerDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              setOutlineMarkers((m) => {
                                const next = { ...m };
                                const v = editingMarkerDraft.trim();
                                if (v) next[outline.id] = v;
                                else delete next[outline.id];
                                return next;
                              });
                              setEditingMarkerId(null);
                            } else if (e.key === "Escape") {
                              setEditingMarkerId(null);
                            }
                          }}
                          placeholder={`默认：${outline.title.slice(0, 8)}`}
                        />
                        <button
                          type="button"
                          className="btn-primary !min-h-6 !px-1.5 !py-0.5 text-[10px]"
                          onClick={() => {
                            setOutlineMarkers((m) => {
                              const next = { ...m };
                              const v = editingMarkerDraft.trim();
                              if (v) next[outline.id] = v;
                              else delete next[outline.id];
                              return next;
                            });
                            setEditingMarkerId(null);
                          }}
                        >✓</button>
                        <button
                          type="button"
                          className="btn-ghost !min-h-6 !px-1 !py-0.5 text-[10px]"
                          onClick={() => setEditingMarkerId(null)}
                        >✕</button>
                      </div>
                    )}
                    {outline.content && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[10px] leading-4 text-ink-2">{outline.content}</p>}
                    {outlineMarkers[outline.id] && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[9px] text-primary-2/80">
                        <Bookmark size={9} className="shrink-0" /> marker: {outlineMarkers[outline.id]}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 👤 人物卡快查（自动匹配正文中出现的角色） */}
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <button
              type="button"
              className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
              onClick={() => setLeftCharactersOpen((v) => !v)}
              aria-expanded={leftCharactersOpen}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-2">
                <Users size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">本章出场人物</p>
                <p className="text-[10px] text-ink-3">{charactersInChapter.length} / {characters.length} · 点击插入</p>
              </div>
              <span className="shrink-0 text-ink-3 transition-transform" style={{ transform: leftCharactersOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>
                <ChevronDown size={14} />
              </span>
            </button>
            {leftCharactersOpen && (
              <div className="space-y-1.5 border-t border-border bg-surface-1/40 px-2 py-2">
                {characters.length === 0 && (
                  <p className="px-2 py-3 text-center text-[11px] text-ink-3">尚无人物卡<br/><Link to={`/author/book/${novelId}/characters`} className="text-link">前往人物页 →</Link></p>
                )}
                {characters.length > 0 && charactersInChapter.length === 0 && (
                  <p className="px-2 py-3 text-center text-[11px] text-ink-3">本章正文未提及任何已建角色</p>
                )}
                {charactersInChapter.map((c) => (
                  <div
                    key={c.id}
                    className="relative rounded-md border border-border bg-surface p-1.5 hover:border-primary-2/50"
                    onMouseEnter={() => setHoverCharId(c.id)}
                    onMouseLeave={() => setHoverCharId(null)}
                  >
                    <button
                      type="button"
                      onClick={() => insertCharacterAtCursor(c.name)}
                      className="flex w-full items-center gap-1.5 text-left"
                      title="点击把角色名插入到光标位置"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-[10px] text-primary-2">
                        {c.gender === "女" ? "♀" : c.gender === "男" ? "♂" : "·"}
                      </span>
                      <span className="flex-1 truncate text-xs text-ink">{c.name}</span>
                      {c.role && <span className="shrink-0 text-[9px] text-ink-3">{c.role.slice(0, 6)}</span>}
                    </button>
                    {hoverCharId === c.id && (
                      <div className="absolute left-full top-0 z-10 ml-2 w-56 rounded-md border border-border bg-surface-1 p-2 shadow-lg">
                        <p className="text-[11px] font-medium text-ink">{c.name}{c.alias ? `（${c.alias}）` : ""}</p>
                        {c.age && <p className="mt-0.5 text-[10px] text-ink-3">{c.age}{c.gender ? ` · ${c.gender}` : ""}</p>}
                        {c.personality && <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-ink-2">{c.personality}</p>}
                        {c.background && <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-ink-3">{c.background}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 📑 前后章快查 */}
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <button
              type="button"
              className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
              onClick={() => setLeftSiblingsOpen((v) => !v)}
              aria-expanded={leftSiblingsOpen}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-2">
                <BookOpen size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">前后章快查</p>
                <p className="text-[10px] text-ink-3">上下各 3 章 · 点击切换</p>
              </div>
              <span className="shrink-0 text-ink-3 transition-transform" style={{ transform: leftSiblingsOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>
                <ChevronDown size={14} />
              </span>
            </button>
            {leftSiblingsOpen && (
              <div className="space-y-1 border-t border-border bg-surface-1/40 px-2 py-2">
                {siblingChapters.length === 0 && (
                  <p className="px-2 py-3 text-center text-[11px] text-ink-3">暂无邻近章节</p>
                )}
                {siblingChapters.map((c) => {
                  const idx = chapters.findIndex((x) => x.id === c.id);
                  const direction = idx < activeIndex ? "↑" : "↓";
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => void selectChapter(c.id)}
                      className="group flex w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1.5 text-left transition-colors hover:border-primary-2/50"
                    >
                      <span className="shrink-0 text-[10px] text-ink-3">{direction}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-ink">{c.title}</span>
                        <span className="block text-[9px] text-ink-3">{(c.word_count / 1000).toFixed(1)}k · {c.status}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 🔍 查找与替换（类 Ctrl+F / Ctrl+H） */}
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <button
              type="button"
              className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
              onClick={() => setLeftFindOpen((v) => !v)}
              aria-expanded={leftFindOpen}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-2">
                <Search size={14} className="text-primary-2" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">查找与替换</p>
                <p className="text-[10px] text-ink-3">
                  {findError
                    ? findError
                    : findTotal > 0
                    ? `${findIndex + 1} / ${findTotal} 处匹配`
                    : findTerm
                    ? "无匹配"
                    : "在正文中搜索 / 替换关键字"}
                </p>
              </div>
              <span className="shrink-0 text-ink-3 transition-transform" style={{ transform: leftFindOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>
                <ChevronDown size={14} />
              </span>
            </button>
            {leftFindOpen && (
              <div className="space-y-1.5 border-t border-border bg-surface-1/40 px-2 py-2">
                {!activeChapter && (
                  <p className="px-2 py-3 text-center text-[11px] text-ink-3">请先选择章节</p>
                )}
                {activeChapter && (
                  <>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={findTerm}
                        onChange={(e) => setFindTerm(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            gotoFindMatch(findIndex + (e.shiftKey ? -1 : 1));
                          }
                        }}
                        placeholder="查找关键字"
                        className="input !min-h-7 flex-1 !px-2 text-xs"
                        aria-label="查找关键字"
                      />
                      <button
                        type="button"
                        className="btn-ghost !min-h-7 !px-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => gotoFindMatch(findIndex - 1)}
                        disabled={findTotal === 0}
                        title="上一个（Shift+Enter）"
                        aria-label="上一个匹配"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !min-h-7 !px-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => gotoFindMatch(findIndex + 1)}
                        disabled={findTotal === 0}
                        title="下一个（Enter）"
                        aria-label="下一个匹配"
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={replaceTerm}
                        onChange={(e) => setReplaceTerm(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            replaceFindMatch(false);
                          }
                        }}
                        placeholder="替换为"
                        className="input !min-h-7 flex-1 !px-2 text-xs"
                        aria-label="替换内容"
                      />
                      <button
                        type="button"
                        className="btn-ghost !min-h-7 !px-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => replaceFindMatch(true)}
                        disabled={findTotal === 0}
                        title="替换当前匹配"
                      >
                        替换
                      </button>
                      <button
                        type="button"
                        className="btn-ghost !min-h-7 !px-1.5 text-[10px] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => replaceFindMatch(false)}
                        disabled={findTotal === 0}
                        title="全部替换"
                      >
                        全部
                      </button>
                    </div>
                    <div className="flex items-center gap-2 px-1 pt-1">
                      <label className="flex items-center gap-1 text-[10px] text-ink-3 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-3 w-3 accent-primary-2"
                          checked={findCase}
                          onChange={(e) => setFindCase(e.target.checked)}
                        />
                        区分大小写
                      </label>
                      <label className="flex items-center gap-1 text-[10px] text-ink-3 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-3 w-3 accent-primary-2"
                          checked={findRegex}
                          onChange={(e) => setFindRegex(e.target.checked)}
                        />
                        正则
                      </label>
                      {findTerm && (
                        <button
                          type="button"
                          className="ml-auto text-[10px] text-ink-3 hover:text-ink"
                          onClick={() => { setFindTerm(""); setReplaceTerm(""); }}
                        >
                          清空
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* 左→中 分隔拖拽条 */}
        <div
          onMouseDown={(e) => onRailDragStart("left", e)}
          className={`hidden xl:block w-1 shrink-0 cursor-col-resize select-none transition-colors ${focusMode ? "!hidden" : ""} ${draggingRail === "left" ? "bg-primary-2/60" : "bg-border hover:bg-primary-2/40"}`}
          title="拖拽调整左栏宽度"
          role="separator"
          aria-orientation="vertical"
        />

        {/* 中：编辑器 */}
        <main className={`min-h-0 min-w-0 flex-1 flex-col ${mobileTab === "editor" ? "flex" : "hidden lg:flex"}`}>
          {activeChapter ? (
            <>
              
              {lastBackupNotice && (
                <div className="flex items-center justify-between border-b border-primary-2/30 bg-primary-soft px-4 py-1.5 text-xs text-primary-2">
                  <div className="flex items-center gap-2">
                    <Sparkles size={13} />
                    <span>{lastBackupNotice}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="underline hover:text-ink font-medium" onClick={quickUndo}>
                      一键撤回上个版本
                    </button>
                    <button className="underline hover:text-ink" onClick={openHistory}>
                      查看版本历史
                    </button>
                    <button className="text-ink-3 hover:text-ink ml-1" onClick={() => setLastBackupNotice(null)}>
                      <X size={12} />
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-surface via-surface to-surface-2/70 px-3 py-2 shadow-sm sm:px-4">
                {/* 章节状态色点（语义化：图标+文本+role，色弱友好） */}
                <span
                  className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    activeChapter.status === "已发布"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-amber-500/15 text-amber-300"
                  }`}
                  role="status"
                  aria-label={activeChapter.status === "已发布" ? "当前章节已发布" : "当前章节为草稿"}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      activeChapter.status === "已发布"
                        ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
                        : "bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.45)]"
                    }`}
                    aria-hidden
                  />
                  {activeChapter.status}
                </span>
                <input
                  className="serif-title flex-1 min-w-28 rounded border border-transparent bg-transparent px-2 py-1 text-sm sm:text-base text-ink hover:border-border focus:border-primary-2 focus:outline-none"
                  value={activeChapter.title}
                  onChange={(e) => setChapters((cs) => cs.map((c) => (c.id === activeChapter.id ? { ...c, title: e.target.value } : c)))}
                  onBlur={(e) => {
                    if (e.target.value !== activeChapter.title) void updateChapter(activeChapter.id, { title: e.target.value });
                  }}
                  aria-label="章节标题"
                />
                <select
                  className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink-2 transition-colors hover:border-primary-2/40 focus:border-primary-2 focus:outline-none"
                  value={activeChapter.status}
                  onChange={(e) => void updateChapter(activeChapter.id, { status: e.target.value })}
                >
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs tabular-nums transition-colors ${
                  dirty ? "bg-amber-500/15 text-amber-300" : "bg-surface-2/60 text-ink-3"
                }`}>
                  {activeChapter.word_count.toLocaleString()} 字{dirty ? " · 未保存" : " · 已保存"}
                </span>
                <button
                  type="button"
                  className="btn-ghost !min-h-7 !px-2 text-xs text-ink-3 hover:text-ink shrink-0"
                  onClick={autoFormatIndents}
                  title="自动规范正文每段首行缩进两个全角字符（支持 Ctrl+Z 撤销）"
                >
                  <AlignLeft size={13} />
                  <span className="hidden sm:inline">一键排版</span>
                </button>
              </div>
              <div
                ref={editorHostRef}
                className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-1/40"
                onContextMenu={handleEditorContextMenu}
                onWheelCapture={(event) => {
                  const scroller = editorHostRef.current?.querySelector<HTMLElement>(".cm-scroller");
                  if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;
                  scroller.scrollTop += event.deltaY;
                  if (event.deltaY !== 0) event.preventDefault();
                }}
              >
                <CodeMirror
                  ref={cmRef}
                  value={content}
                  onCreateEditor={(view) => { editorViewRef.current = view; }}
                  onUpdate={(update: ViewUpdate) => {
                    if (update.selectionSet || update.docChanged) editorViewRef.current = update.view;
                  }}
                  onChange={onChange}
                  theme="none"
                  extensions={[markdown(), EditorView.lineWrapping, editorTheme]}
                  height="100%"
                  placeholder="开始写作…支持 Markdown 语法，每 1.5 秒自动保存。"
                />
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center text-ink-2">
              <div className="text-center">
                <PenLine className="mx-auto mb-3 opacity-40" size={36} />
                <p>选择或新建章节开始写作</p>
              </div>
            </div>
          )}
        </main>

        {/* 中→右 分隔拖拽条 */}
        <div
          onMouseDown={(e) => onRailDragStart("right", e)}
          className={`hidden lg:block w-1 shrink-0 cursor-col-resize select-none transition-colors ${focusMode ? "!hidden" : ""} ${draggingRail === "right" ? "bg-primary-2/60" : "bg-border hover:bg-primary-2/40"}`}
          title="拖拽调整右栏宽度"
          role="separator"
          aria-orientation="vertical"
        />

        {/* 右：作品总纲（文件夹）+ 章节列表 */}
        <aside
          style={{ width: railWidths.right }}
          className={`shrink-0 overflow-y-auto border-l border-border bg-surface-2/40 p-3 hidden lg:block transition-all duration-200 ${focusMode ? "!hidden" : ""} ${mobileTab === "chapters" ? "!block w-full flex-1" : ""}`}
        >
          {/* 📁 作品总纲文件夹（可折叠展开） */}
          <div className="mb-3 overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
            <button
              type="button"
              className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
              onClick={() => setBookOutlineOpen((v) => !v)}
              aria-expanded={bookOutlineOpen}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-2 transition-transform group-hover:scale-105">
                {bookOutlineOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">作品总纲</p>
                <p className="text-[10px] text-ink-3">{bookOutlines.length} 条 · 点击{bookOutlineOpen ? "折叠" : "展开"}</p>
              </div>
              <span className="shrink-0 text-ink-3 transition-transform" style={{ transform: bookOutlineOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>
                <ChevronDown size={14} />
              </span>
              <button
                type="button"
                className="ml-1 rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-primary-2"
                onClick={(e) => { e.stopPropagation(); openOutlineDialog(null); }}
                aria-label="新建总纲"
                title="新建总纲"
              >
                <Plus size={13} />
              </button>
            </button>
            {bookOutlineOpen && (
              <div className="space-y-1.5 border-t border-border bg-surface-1/40 px-2 py-2">
                {bookOutlines.length === 0 && (
                  <p className="px-2 py-3 text-center text-[11px] text-ink-3">尚无总纲 · 点击右上 + 新增</p>
                )}
                {bookOutlines.map((o, idx) => (
                  <div key={o.id} className="group rounded-md border border-border bg-surface px-2 py-1.5 transition-colors hover:border-primary-2/40">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-primary/15 text-[9px] text-primary-2">{idx + 1}</span>
                      <span className="flex-1 truncate text-xs text-ink">{o.title}</span>
                      <button className="rounded p-0.5 text-ink-3 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100" onClick={() => void removeOutline(o.id)} aria-label="删除大纲">
                        <Trash2 size={10} />
                      </button>
                    </div>
                    {o.content && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-[10px] leading-4 text-ink-2">{o.content}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 📑 章节列表标题 */}
          <div className="mb-2 flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 shadow-sm">
            <h3 className="flex items-center gap-2 text-xs font-medium tracking-wider text-ink">
              <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-primary-soft text-primary-2">
                <ListTree size={11} />
              </span>
              章节列表
              <span className="text-[10px] text-ink-3">({chapters.length})</span>
            </h3>
            <button className="rounded p-1 text-ink-3 hover:bg-primary-soft hover:text-primary-2" onClick={openNewChapterDialog} aria-label="新建章节" title="新建章节">
              <FilePlus2 size={14} />
            </button>
          </div>
          <div className="space-y-1">
            {chapters.map((c, i) => {
              const isFirst = i === 0;
              const isLast = i === chapters.length - 1;
              return (
              <div
                key={c.id}
                className={`group cursor-pointer rounded-md border px-2 py-2 transition-colors ${
                  c.id === activeId ? "border-primary-2/50 bg-primary-soft" : "border-transparent hover:bg-surface"
                }`}
                onClick={() => void selectChapter(c.id)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-5 shrink-0 text-right font-serif text-[10px] text-ink-3">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.title}</span>
                  <span className={`shrink-0 rounded px-1 text-[9px] ${c.status === "已发布" ? "bg-emerald-500/15 text-emerald-400" : "bg-ink-3/10 text-ink-3"}`}>
                    {c.status === "已发布" ? "发布" : "草稿"}
                  </span>
                  <span className="shrink-0 text-[9px] text-ink-3">{(c.word_count / 1000).toFixed(1)}k</span>
                </div>
                {/* 操作按钮行：常显，hover 时高亮；首尾章节禁用对应方向 */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    className={`inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded border px-1.5 text-[10px] transition-colors ${
                      isFirst
                        ? "cursor-not-allowed border-border/40 bg-surface-2/40 text-ink-3/40"
                        : "border-border bg-surface text-ink-2 hover:border-primary-2/60 hover:bg-primary-soft hover:text-primary-2"
                    }`}
                    onClick={(e) => { e.stopPropagation(); if (!isFirst) void moveChapter(c.id, "up"); }}
                    disabled={isFirst}
                    aria-label="上移章节"
                    title={isFirst ? "已是首章" : "上移一格（与上一章交换）"}
                  >
                    <ChevronUp size={11} />上移
                  </button>
                  <button
                    type="button"
                    className={`inline-flex h-6 min-w-6 items-center justify-center gap-0.5 rounded border px-1.5 text-[10px] transition-colors ${
                      isLast
                        ? "cursor-not-allowed border-border/40 bg-surface-2/40 text-ink-3/40"
                        : "border-border bg-surface text-ink-2 hover:border-primary-2/60 hover:bg-primary-soft hover:text-primary-2"
                    }`}
                    onClick={(e) => { e.stopPropagation(); if (!isLast) void moveChapter(c.id, "down"); }}
                    disabled={isLast}
                    aria-label="下移章节"
                    title={isLast ? "已是末章" : "下移一格（与下一章交换）"}
                  >
                    <ChevronDown size={11} />下移
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-6 items-center gap-0.5 rounded border border-dashed border-border px-1.5 text-[10px] text-ink-3 transition-colors hover:border-primary-2/50 hover:text-ink"
                    onClick={(e) => { e.stopPropagation(); openOutlineDialog(c.id); }}
                    aria-label="添加本章细纲"
                    title="为本章添加一条细纲"
                  >
                    <Plus size={11} />细纲
                  </button>
                  <button
                    type="button"
                    className="ml-auto inline-flex h-6 items-center gap-0.5 rounded px-1.5 text-[10px] text-ink-3 transition-colors hover:bg-danger/10 hover:text-red-400"
                    onClick={(e) => { e.stopPropagation(); void removeChapter(c.id); }}
                    aria-label="删除章节"
                    title="删除该章节（其细纲一并删除）"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                {/* 本章细纲 */}
                <div className="mt-1 space-y-1">
                  {outlines.filter((o) => o.chapter_id === c.id).map((o) => (
                      <div key={o.id} className="rounded bg-black/20 p-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            className="flex-1 truncate text-left text-[11px] text-ink-2 hover:text-ink"
                            onClick={(e) => { e.stopPropagation(); setExpanded((ex) => ({ ...ex, [o.id]: !ex[o.id] })); }}
                          >
                            {o.title} {expanded[o.id] ? "⌃" : "⌄"}
                          </button>
                          <button className="rounded p-0.5 text-ink-3 hover:text-red-400" onClick={(e) => { e.stopPropagation(); void removeOutline(o.id); }} aria-label="删除细纲">
                            <Trash2 size={10} />
                          </button>
                        </div>
                        {expanded[o.id] && (
                          <textarea
                            className="mt-1 w-full resize-y rounded border border-border bg-surface px-1.5 py-1 text-[11px] leading-4 text-ink-2"
                            rows={3}
                            value={o.content}
                            onChange={(e) => setOutlines((os) => os.map((x) => x.id === o.id ? { ...x, content: e.target.value } : x))}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => {
                              const value = e.target.value;
                              if (value !== outlineSavedRef.current.get(o.id)) void updateOutline(o.id, { content: value });
                            }}
                            placeholder="在这里填写本章细纲…"
                          />
                        )}
                        {(outlineSaving[o.id] || outlineErrors[o.id]) && (
                          <div className="mt-1 flex items-center justify-between text-[10px]">
                            <span className={outlineErrors[o.id] ? "text-red-300" : "text-ink-3"}>{outlineErrors[o.id] || "保存中…"}</span>
                            {outlineErrors[o.id] && <button className="text-link" onClick={(e) => { e.stopPropagation(); void updateOutline(o.id, { content: o.content }); }}>重试</button>}
                          </div>
                        )}
                      </div>
                    ))}
                  {outlines.filter((o) => o.chapter_id === c.id).length === 0 && (
                    <p className="px-1 text-[10px] text-ink-3">暂无本章细纲，可点击上方“添加细纲”。</p>
                  )}
                </div>
              </div>
            );
            })}
          </div>
        </aside>
      </div>

      {/* 操作反馈 toast（沉浸模式等） */}
      <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto rounded-full border border-border bg-surface-1/95 px-4 py-1.5 text-xs text-ink shadow-lg backdrop-blur transition-all duration-200 ease-out"
          >
            <span className="mr-1.5 inline-block h-1.5 w-1.5 translate-y-[-1px] rounded-full bg-primary-2 align-middle" />
            {t.text}
          </div>
        ))}
      </div>

      {/* 📚 知识库（RAG）抽屉 */}
      {kbOpen && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <BookOpen className="text-amber-400" size={16} />
            <h3 className="serif-title text-sm text-ink">本地知识库 · RAG</h3>
            <button className="ml-auto rounded p-1 text-ink-3 hover:text-ink" onClick={() => setKbOpen(false)} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="rounded-md border border-border bg-surface-2 p-3 space-y-2">
              <p className="text-xs text-ink-3">
                把当前作品的章节正文、总纲、人设自动切片并建立本地 BM25 索引。AI 写作时（如调用「管家 Agent」的 <code className="text-ink-2">kb_query</code>）可优先检索最相关的片段，解决长篇小说上下文丢失问题。
              </p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-ink-3">
                  已索引：<strong className="text-ink">{kbStats?.chunks ?? 0}</strong> 条片段
                  {kbStats?.lastIndexed ? <span className="text-ink-3"> · 上次 {kbStats.lastIndexed}</span> : null}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-primary !min-h-8 !px-2.5 text-xs" onClick={() => void rebuildKb()} disabled={kbBusy}>
                  {kbBusy ? "处理中…" : "🔄 重建整本索引"}
                </button>
                <button className="btn-ghost !min-h-8 !px-2 text-xs" onClick={() => void dropKb()} disabled={kbBusy}>
                  清空索引
                </button>
              </div>
              {kbMsg && <p className="text-[11px] text-ink-3">{kbMsg}</p>}
            </div>

            <div className="rounded-md border border-border bg-surface-2 p-3 space-y-2">
              <p className="text-xs text-ink-3">🔍 关键词检索（BM25）</p>
              <textarea
                className="input min-h-14 resize-y text-xs"
                value={kbQuery}
                onChange={(e) => setKbQuery(e.target.value)}
                placeholder="如：主角在雪山的奇遇 / 林婉儿的真实身世 / 上一章提到的玉佩"
              />
              <button className="btn-primary w-full !min-h-8 text-xs" onClick={() => void runKbQuery()} disabled={kbBusy || !kbQuery.trim()}>
                检索
              </button>
              <div className="space-y-1.5">
                {kbHits.length === 0 ? (
                  <p className="text-[11px] text-ink-3">检索结果将显示在这里。</p>
                ) : kbHits.map((h, i) => (
                  <div key={i} className="rounded border border-border bg-surface px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-primary-2">{h.source_kind === "chapter" ? "📖" : h.source_kind === "outline" ? "📋" : h.source_kind === "character" ? "👤" : "📄"} {h.title || "(无标题)"}</span>
                      <span className="text-ink-3">score {h.score}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[11px] leading-4 text-ink-2 line-clamp-4">{h.preview}</p>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[10px] leading-4 text-ink-3">
              索引采用纯 JS BM25，无外部依赖；保存章节/大纲/人设时会自动增量更新对应片段，可随时点击「重建整本索引」一次性重新生成。
            </p>
          </div>
        </div>
      )}

      {/* AI 助手抽屉 */}
      {aiOpen && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-border bg-surface shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            {agentTab === "writer" ? <Sparkles className="text-primary-2" size={16} /> : <Terminal className="text-emerald-400" size={16} />}
            <h3 className="serif-title text-sm text-ink">{agentTab === "writer" ? "小说写作助手" : "管家 Agent"}</h3>
            <div className="ml-auto flex items-center gap-1.5 text-[10px]">
              <button className={`rounded px-1.5 py-0.5 ${agentTab === "writer" ? "bg-primary-soft text-primary-2" : "text-ink-3 hover:text-ink"}`} onClick={() => setAgentTab("writer")}>写作助手</button>
              <button className={`rounded px-1.5 py-0.5 ${agentTab === "butler" ? "bg-emerald-500/15 text-emerald-400" : "text-ink-3 hover:text-ink"}`} onClick={() => setAgentTab("butler")}>管家 Agent</button>
              <button className="ml-1 rounded p-1 text-ink-3 hover:text-ink" onClick={() => setAiOpen(false)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
          </div>
          {agentTab === "butler" ? (
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <p className="text-xs text-ink-3">
                管家 Agent 可以自主调用起笔工具（查看作品/章节/大纲/人设/伏笔 → 修改章节 → 保存），并可选用你已挂载的外部 MCP 客户端工具。
                适用于「帮我补完本章细纲并写作」「整理全部章节大纲」「修复人物卡时间线矛盾」等多步任务。
              </p>
              <textarea
                className="input min-h-20 resize-y text-xs"
                value={agentTask}
                onChange={(e) => setAgentTask(e.target.value)}
                placeholder="如：根据当前作品细纲与上一章剧情，写出第 5 章完整正文（不少于 2500 字）。"
              />
              {/* 常用 Agent 任务指令快捷注入 */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  ["📋 规划下三章细纲", "请调取作品大纲和现有章节，自动规划并创建后 3 章的细纲（标题+核心冲突+出场人物）。"],
                  ["✍️ 补完当前章正文", "请先读取当前操作章节的细纲和上章结尾，然后直接调用 update_chapter 创作本章完整正文（2500字以上）。"],
                  ["⚖️ 全书伏笔健康诊断", "请调取创作进度和全部章节，检查已回收、待回收和遗忘的伏笔，并更新伏笔清单。"],
                  ["👤 梳理并更新人物卡", "请阅读最新章节剧情，自动提取人物的最新境界与持有物并更新角色动态账本。"],
                ].map(([label, promptText]) => (
                  <button
                    key={label}
                    type="button"
                    className="btn-ghost !min-h-6 !px-2 text-[10px] border border-border/80 bg-surface-2/60 text-ink-2 hover:text-primary-2 hover:border-primary-2/40"
                    onClick={() => setAgentTask(promptText)}
                    disabled={agentBusy}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-ink-2">
                <input type="checkbox" checked={agentIncludeExternal} onChange={(e) => setAgentIncludeExternal(e.target.checked)} />
                启用已挂载的外部 MCP 客户端工具
              </label>
              <button className="btn-primary w-full" onClick={() => void runAgent()} disabled={agentBusy || !agentTask.trim()}>
                {agentBusy ? (
                  <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> 思考与执行中…</>
                ) : (
                  <><PlayCircle size={14} /> 启动管家 Agent</>
                )}
              </button>
              <div className="max-h-[60vh] min-h-32 space-y-1.5 overflow-y-auto rounded-md border border-border bg-surface-1/60 p-2 font-mono text-[11px]">
                {agentLog.length === 0 ? (
                  <p className="text-ink-3">执行日志将显示在这里：每一步的工具调用、结果与最终回复。</p>
                ) : agentLog.map((e, i) => {
                  if (e.kind === "text") return <div key={i} className="text-ink-2 whitespace-pre-wrap">▸ {e.text}</div>;
                  if (e.kind === "tool_call") return <div key={i} className="text-primary-2">🔧 调用工具 <span className="font-semibold">{e.name}</span> {e.args ? JSON.stringify(e.args) : ""}</div>;
                  if (e.kind === "tool_result") return <div key={i} className="text-ink-3 truncate">  ↳ {e.preview}</div>;
                  if (e.kind === "tool_error") {
                    const severityColor = e.severity === "high" ? "text-red-400" : e.severity === "medium" ? "text-amber-400" : "text-blue-400";
                    return (
                      <div key={i} className={`${severityColor} rounded-md border border-current/30 bg-surface-1 p-2.5 text-xs whitespace-pre-wrap leading-relaxed`}>
                        {e.error}
                      </div>
                    );
                  }
                  if (e.kind === "done") return <div key={i} className="text-emerald-400">✅ {e.text}</div>;
                  if (e.kind === "error") {
                    const severityColor = e.severity === "high" ? "text-red-400" : e.severity === "medium" ? "text-amber-400" : "text-red-300";
                    return (
                      <div key={i} className={`${severityColor} rounded-md border border-current/30 bg-surface-1 p-2.5 text-xs whitespace-pre-wrap leading-relaxed`}>
                        {e.error}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
              <p className="text-[10px] leading-4 text-ink-3">提示：执行过程中如果 AI 要修改章节正文会自动写入数据库，请确认任务后启动。可在「设置」中配置 API 密钥与已挂载的外部 MCP 客户端。</p>
            </div>
          ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <button
                type="button"
                onClick={() => setAppearancePanelOpen((v) => !v)}
                aria-expanded={appearancePanelOpen}
                className="group flex w-full items-center justify-between gap-2 text-xs text-ink-2 transition-colors hover:text-ink"
              >
                <span className="flex items-center gap-2">
                  <Palette size={13} /> 正文编辑器外观
                  <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-ink-3">
                    {EDITOR_APPEARANCE_PRESETS.find((p) => p.bg.toLowerCase() === editorAppearance.bg.toLowerCase() && p.fg.toLowerCase() === editorAppearance.fg.toLowerCase())?.name || "自定义"}
                  </span>
                </span>
                <span className="text-ink-3 transition-transform duration-200" style={{ transform: appearancePanelOpen ? "rotate(0deg)" : "rotate(-90deg)" }}>
                  <ChevronDown size={13} />
                </span>
              </button>
              {appearancePanelOpen && (
              <>
              <div className="mb-3 mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {EDITOR_APPEARANCE_PRESETS.map((p) => {
                  const active = editorAppearance.bg.toLowerCase() === p.bg.toLowerCase() && editorAppearance.fg.toLowerCase() === p.fg.toLowerCase();
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setEditorAppearance({ bg: p.bg, fg: p.fg })}
                      title={p.hint}
                      className={`flex flex-col items-stretch overflow-hidden rounded border text-left transition-all ${
                        active
                          ? "border-primary-2 ring-1 ring-primary-2/60 shadow-sm"
                          : "border-border hover:border-primary-2/40"
                      }`}
                    >
                      <span
                        className="h-5 w-full border-b border-border/40"
                        style={{ backgroundColor: p.bg }}
                      >
                        <span className="block h-full w-full" style={{ background: `linear-gradient(90deg, ${p.bg} 0%, ${p.bg} 60%, ${p.fg}22 60%, ${p.fg}22 100%)` }} />
                      </span>
                      <span className={`px-1.5 py-1 text-[10px] font-medium ${active ? "bg-primary-2 text-white" : "bg-surface text-ink-2"}`}>
                        {p.name}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-ink-2">
                  背景
                  <input
                    type="color"
                    className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                    value={editorAppearance.bg}
                    onChange={(e) => setEditorAppearance((a) => ({ ...a, bg: e.target.value }))}
                    aria-label="正文编辑器背景颜色"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-ink-2">
                  文字
                  <input
                    type="color"
                    className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                    value={editorAppearance.fg}
                    onChange={(e) => setEditorAppearance((a) => ({ ...a, fg: e.target.value }))}
                    aria-label="正文编辑器文字颜色"
                  />
                </label>
                <button
                  className="btn-ghost !min-h-7 ml-auto !px-2 text-[11px]"
                  onClick={() => setEditorAppearance(EDITOR_APPEARANCE_DEFAULT)}
                  title="恢复默认颜色"
                >
                  <RotateCcw size={12} /> 恢复默认
                </button>
              </div>
              </>
              )}
            </div>
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs text-ink-2">
                <Sparkles size={13} /> 小说写作助手
              </div>
              <label className="mb-1.5 block text-xs text-ink-2">作者风格 Skill（可选）</label>
              <select
                className="input text-xs"
                value={writerState?.distilled_author_id ?? ""}
                disabled={!writerState || writerSaving}
                onChange={(event) => void saveWriterState({ distilled_author_id: event.target.value ? Number(event.target.value) : null })}
              >
                <option value="">不使用蒸馏作者</option>
                {skillAuthors.filter((author) => author.current_version).map((author) => (
                  <option key={author.id} value={author.id}>{author.name} · v{author.current_version?.version}</option>
                ))}
              </select>
              <div className="mt-3 grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-ink-2">创作进度</span>
                  <button
                    type="button"
                    className="btn-ghost !min-h-6 !px-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void extractWriterState("progress")}
                    disabled={!activeId || progressExtracting || foreshadowingExtracting}
                    aria-label="AI 自动提取创作进度"
                  >
                    <Wand2 size={11} className={progressExtracting ? "animate-pulse" : ""} />
                    {progressExtracting ? "提取中…" : "AI 自动提取"}
                  </button>
                </div>
                <textarea
                  className="input min-h-16 resize-y text-xs"
                  value={writerState?.progress || ""}
                  placeholder="进度记录：当前卷、已完成情节、下一步计划…"
                  onChange={(event) => setWriterState((state) => state ? { ...state, progress: event.target.value } : state)}
                  onBlur={(event) => void saveWriterState({ progress: event.target.value })}
                />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-ink-2">伏笔清单</span>
                  <button
                    type="button"
                    className="btn-ghost !min-h-6 !px-2 text-[10px] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void extractWriterState("foreshadowing")}
                    disabled={!activeId || progressExtracting || foreshadowingExtracting}
                    aria-label="AI 自动提取伏笔清单"
                  >
                    <Wand2 size={11} className={foreshadowingExtracting ? "animate-pulse" : ""} />
                    {foreshadowingExtracting ? "提取中…" : "AI 自动提取"}
                  </button>
                </div>
                <textarea
                  className="input min-h-16 resize-y text-xs"
                  value={writerState?.foreshadowing || "[]"}
                  placeholder="伏笔清单：用 JSON 或 Markdown 记录已埋设/待回收伏笔…"
                  onChange={(event) => setWriterState((state) => state ? { ...state, foreshadowing: event.target.value } : state)}
                  onBlur={(event) => void saveWriterState({ foreshadowing: event.target.value })}
                />
                {extractMsg && (
                  <div className="flex items-center gap-1 text-[10px] text-primary-2" role="status" aria-live="polite">
                    <Check size={11} /> {extractMsg}
                  </div>
                )}
              </div>
            </div>
            {/* 统一分类任务控制台 */}
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 flex items-center justify-between text-xs font-semibold text-ink">
                  <span>AI 创作任务</span>
                  <span className="text-[10px] font-normal text-ink-3">选择模式后点击底部「开始生成」</span>
                </label>

                {/* 任务分类一：正文生成与续写 */}
                <div className="mb-2.5">
                  <span className="text-[10px] text-ink-3 font-medium block mb-1">✍️ 正文创作</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      ["draft", "✍️ 细纲写章", "按当前细纲与前文脉络生成完整章节"],
                      ["continue", "⏩ 承接续写", "紧跟光标处自然往下续写情节"],
                      ["expand", "📖 细节扩写", "丰富环境描写、心理活动与神态对话"],
                    ].map(([k, label, tip]) => (
                      <button
                        key={k}
                        type="button"
                        title={tip}
                        className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          aiMode === k ? "border-primary-2 bg-primary-soft text-primary-2 font-medium shadow-sm" : "border-border text-ink-2 hover:text-ink hover:bg-surface-1"
                        }`}
                        onClick={() => setAiMode(k as any)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 任务分类二：7 Gate 门禁去AI味与文本精修 */}
                <div className="mb-2.5">
                  <span className="text-[10px] text-emerald-400 font-medium block mb-1">🌿 7 Gate去AI味与精修</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      ["deslop", "🌿 7 Gate去味(全文)", "执行7重门禁，彻底洗去套路词与AI腔"],
                      ["deslop-selection", "🌿 7 Gate去味(选区)", "针对编辑器中选中的段落消除AI套路"],
                      ["polish", "🎨 润色全文", "修正语病与错字，提升全章文学质感"],
                      ["polish-selection", "🎨 润色选中", "对选中的段落精细打磨文笔"],
                    ].map(([k, label, tip]) => (
                      <button
                        key={k}
                        type="button"
                        title={tip}
                        className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          aiMode === k ? "border-emerald-500/80 bg-emerald-500/10 text-emerald-300 font-medium shadow-sm" : "border-border text-ink-2 hover:text-ink hover:bg-surface-1"
                        }`}
                        onClick={() => setAiMode(k as any)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 任务分类三：推演审查与辅助输出 */}
                <div>
                  <span className="text-[10px] text-amber-400 font-medium block mb-1">⚖️ 审查、拆解与规划 (输出到辅助面板)</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      ["review", "⚖️ 毒点审查", "模拟主编挑剔老读者找茬审查与评级"],
                      ["analyze", "🔍 爆款拆解", "深度剖析底层看点、情绪线与金手指"],
                      ["outline", "📋 细纲规划", "生成后续分章节核心冲突与细纲"],
                      ["summary", "📝 章节摘要", "提炼100字前情微摘要，供后续连贯"],
                      ["suggest", "💡 剧情顾问", "针对卡文与设定提供可执行建议"],
                    ].map(([k, label, tip]) => (
                      <button
                        key={k}
                        type="button"
                        title={tip}
                        className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          aiMode === k ? "border-primary-2 bg-primary-soft text-primary-2 font-medium shadow-sm" : "border-border text-ink-2 hover:text-ink hover:bg-surface-1"
                        }`}
                        onClick={() => setAiMode(k as any)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 常用补充要求预设（点击快速填入输入框，绝不自动偷跑） */}
              <div>
                <span className="text-[10px] text-ink-3 block mb-1">💡 常用要求预设（点击填入下方输入框）：</span>
                <div className="flex flex-wrap gap-1">
                  {[
                    ["章末钩子", "重点检查本章结尾的悬念、情绪落点和下一章阅读动力。"],
                    ["节奏把控", "检查本章冲突密度和信息释放，指出拖沓或跳跃处。"],
                    ["伏笔核对", "结合全书设定和前文，核查本章伏笔的埋设与回收情况。"],
                    ["角色账本", "提取出场角色的最新境界、道具、伤病及心境动态账本。"],
                    ["配图Prompt", "根据本章名场面生成3条中文小说配图提示词。"],
                  ].map(([tag, promptText]) => (
                    <button
                      key={tag}
                      type="button"
                      className="rounded border border-border bg-surface-1 px-1.5 py-0.5 text-[10px] text-ink-3 hover:border-primary-2/40 hover:text-ink transition"
                      onClick={() => setAiExtra(prev => prev ? `${prev}；${promptText}` : promptText)}
                      title="点击填入下方要求输入框"
                    >
                      +{tag}
                    </button>
                  ))}
                  {aiExtra && (
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[10px] text-ink-3 hover:text-red-400"
                      onClick={() => setAiExtra("")}
                    >
                      清空要求
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-ink-2">补充要求（可选）</label>
              <textarea
                className="input min-h-20 resize-y text-xs"
                value={aiExtra}
                onChange={(e) => setAiExtra(e.target.value)}
                placeholder="如：风格要更诙谐；增加环境描写；控制节奏……"
              />
            </div>
                {aiError && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                    <p className="mb-1 font-semibold text-red-300">AI 助手提示 / 异常：</p>
                    <p className="max-h-48 overflow-y-auto whitespace-pre-wrap leading-relaxed text-red-200/90">{aiError}</p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <Link to="/settings" className="btn-primary !min-h-7 !px-2.5 text-[11px]">
                        前往「设置」配置 API
                      </Link>
                      <button type="button" className="btn-ghost !min-h-7 !px-2 text-[11px]" onClick={() => setAiError("")}>
                        关闭提示
                      </button>
                    </div>
                  </div>
                )}
                {selectionError && <p className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">{selectionError}</p>}
                {aiPreview && (
                  <div className="rounded-md border border-primary-2/40 bg-primary-soft p-3">
                    <p className="mb-1 text-xs text-primary-2">选区精修预览（{aiMode === "deslop-selection" ? "7 Gate 去AI味" : aiMode === "polish-selection" ? "润色" : "扩写"}）</p>
                    <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-ink-2">{aiPreview}</p>
                    <div className="mt-3 flex gap-2">
                      <button className="btn-primary !min-h-8 !px-3 text-xs" onClick={applySelectionPreview} disabled={aiBusy}>应用替换</button>
                      <button className="btn-ghost !min-h-8 !px-3 text-xs" onClick={() => { setAiPreview(""); selectionRef.current = null; }}>取消</button>
                    </div>
                  </div>
                )}
                                <div className="rounded-md border border-border bg-surface-2 p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                      {reportTitle}
                      {aiBusy && isReportMode && (
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary-2/40 border-t-primary-2" aria-label="生成中" />
                      )}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {aiMode === "outline" && aiReport.trim() && (
                        <>
                          <button type="button" className="btn-ghost !min-h-6 !px-2 text-[10px]" onClick={() => void saveReportAsOutline(false)}>存为总纲</button>
                          <button type="button" className="btn-ghost !min-h-6 !px-2 text-[10px]" onClick={() => void saveReportAsOutline(true)} disabled={!activeId}>存为本章细纲</button>
                        </>
                      )}
                      <button type="button" className="btn-ghost !min-h-6 !px-2 text-[10px]" onClick={() => { void navigator.clipboard.writeText(aiReport); }} disabled={!aiReport.trim()}>复制</button>
                      <button type="button" className="btn-ghost !min-h-6 !px-2 text-[10px] text-ink-3 hover:text-ink" onClick={() => setAiReport("")} disabled={!aiReport.trim()}>清空</button>
                    </div>
                  </div>
                  <div className="max-h-64 min-h-20 select-text overflow-y-auto whitespace-pre-wrap rounded border border-border bg-surface-1/60 p-2.5 font-mono text-xs leading-5 text-ink-1">
                    {aiReport || <span className="text-ink-3">细纲规划 / 审查报告 / 章节摘要 / 创作建议 等非正文类输出将实时显示在这里，可一键复制或存为细纲。</span>}
                  </div>
                  {outlineSavedMsg && (
                    <p className="mt-2 text-[10px] leading-4 text-emerald-400">{outlineSavedMsg}</p>
                  )}
                </div>
            <button className="btn-primary w-full" onClick={() => void runAI()} disabled={aiBusy || !activeId}>
              {aiBusy ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  生成中…
                </>
              ) : (
                <>
                  <Wand2 size={14} /> 开始生成
                </>
              )}
            </button>
            <p className="text-[10px] leading-4 text-ink-3">
              细纲写章/续写/去味/润色/扩写会写入当前章节正文；细纲规划、审查、拆解、摘要、建议等会输出到下方「辅助输出（非正文）」面板，可复制或一键存为细纲。需在「设置」中配置 API Key。
            </p>
          </div>
          )}
        </div>
      )}


      {/* 选区右键快捷菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 min-w-44 rounded-lg border border-border bg-surface-2 p-1.5 shadow-2xl backdrop-blur text-xs"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 190), top: Math.min(contextMenu.y, window.innerHeight - 180) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] text-ink-3 border-b border-border mb-1 truncate max-w-48">
            已选: "{contextMenu.text.slice(0, 15)}..."
          </div>
          <button
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-primary-soft hover:text-primary-2"
            onClick={() => startSelectionAction("deslop-selection")}
          >
            <Sparkles size={13} className="text-emerald-400" />
            <span>🌿 AI 去AI味选区</span>
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-primary-soft hover:text-primary-2"
            onClick={() => startSelectionAction("polish-selection")}
          >
            <Sparkles size={13} className="text-primary-2" />
            <span>🎨 AI 润色选区</span>
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-primary-soft hover:text-primary-2"
            onClick={() => startSelectionAction("expand-selection")}
          >
            <Wand2 size={13} className="text-primary-2" />
            <span>AI 扩写选区</span>
          </button>
          <div className="my-1 border-t border-border" />
          <button
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-surface-3"
            onClick={() => {
              void navigator.clipboard.writeText(contextMenu.text);
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>复制选区</span>
          </button>
          <button
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-ink hover:bg-surface-3"
            onClick={() => {
              void navigator.clipboard.writeText(contextMenu.text);
              const view = editorViewRef.current;
              if (view) {
                view.dispatch({ changes: { from: contextMenu.from, to: contextMenu.to, insert: "" } });
              }
              setContextMenu(null);
            }}
          >
            <Scissors size={13} />
            <span>剪切选区</span>
          </button>
        </div>
      )}

      {/* 历史版本与恢复抽屉 */}
      {historyOpen && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-border bg-surface shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <History className="text-primary-2" size={16} />
            <h3 className="serif-title text-sm text-ink">正文版本历史 · {activeChapter?.title}</h3>
            <button className="ml-auto rounded p-1 text-ink-3 hover:text-ink" onClick={() => setHistoryOpen(false)} aria-label="关闭">
              <X size={16} />
            </button>
          </div>
          <div className="flex flex-1 min-h-0">
            {/* 左侧：版本列表 */}
            <div className="w-56 shrink-0 border-r border-border overflow-y-auto p-2 space-y-1">
              {historyLoading && <div className="p-4 text-xs text-ink-3 text-center">加载历史版本…</div>}
              {!historyLoading && !revisions.length && (
                <div className="p-4 text-xs text-ink-3 text-center">当前章节暂无备份历史</div>
              )}
              {revisions.map((rev) => (
                <div
                  key={rev.id}
                  className={`rounded-md border p-2 text-left cursor-pointer transition-colors ${
                    selectedRevision?.id === rev.id ? "border-primary-2 bg-primary-soft" : "border-border hover:bg-surface-2"
                  }`}
                  onClick={async () => {
                    try {
                      if (!activeId) return;
                      const full = await chapterRevisionApi.get(activeId, rev.id);
                      setSelectedRevision(full);
                    } catch {
                      setSelectedRevision(rev);
                    }
                  }}
                >
                  <div className="flex items-center justify-between text-xs font-medium text-ink truncate">
                    <span className="truncate">{rev.reason}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-ink-3">
                    <span>{rev.created_at}</span>
                    <span>{rev.word_count} 字</span>
                  </div>
                </div>
              ))}
            </div>
            {/* 右侧：预览与恢复 */}
            <div className="flex-1 flex flex-col min-w-0 p-3">
              {selectedRevision ? (
                <>
                  <div className="flex items-center justify-between pb-2 border-b border-border">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink truncate">{selectedRevision.reason}</p>
                      <p className="text-[10px] text-ink-3">{selectedRevision.created_at} · {selectedRevision.word_count} 字</p>
                    </div>
                    <button
                      className="btn-primary !min-h-8 !px-3 text-xs"
                      onClick={() => void restoreRevision(selectedRevision)}
                    >
                      <Undo2 size={13} /> 恢复此版本
                    </button>
                  </div>
                  <div className="mt-2 flex-1 overflow-y-auto rounded bg-surface-2 p-3 text-xs leading-5 text-ink-2 whitespace-pre-wrap font-mono">
                    {selectedRevision.content || "（无内容）"}
                  </div>
                </>
              ) : (
                <div className="grid flex-1 place-items-center text-xs text-ink-3">请选择左侧历史版本以预览</div>
              )}
            </div>
          </div>
        </div>
      )}

      <PromptDialog
        open={newChapterOpen}
        title="新建章节"
        label="章节名"
        placeholder="如：第一章 初入江湖"
        error={newChapterError}
        submitting={newChapterSaving}
        onSubmit={(title) => void addChapter(title)}
        onCancel={() => {
          if (!newChapterSaving) setNewChapterOpen(false);
        }}
      />

      <PromptDialog
        open={outlineDialogOpen}
        title={outlineDialogChapterId === null ? "新建总纲" : "新建本章细纲"}
        label="大纲标题"
        placeholder={outlineDialogChapterId === null ? "如：故事主线" : "如：本章冲突与转折"}
        error={outlineDialogError}
        submitting={outlineDialogSaving}
        onSubmit={(title) => void addOutline(title)}
        onCancel={() => {
          if (!outlineDialogSaving) setOutlineDialogOpen(false);
        }}
      />
    </div>
  );
}
