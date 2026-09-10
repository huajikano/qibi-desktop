import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Stage, Layer, Line as KLine, Ellipse, Text as KText, Group, Circle, Rect } from "react-konva";
import type Konva from "konva";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  Download,
  Grid3x3,
  Hand,
  Link2,
  MousePointer2,
  PenTool,
  Plus,
  RefreshCw,
  Route,
  Save,
  Sparkles,
  Square,
  Trash2,
  Type,
  Users,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, mapAiApi } from "../../api";
import { PromptDialog } from "../../components/Dialog";
import type { Character, MapData, MapDoc, MapMarker, MapShape, MapPath, MapLabel, MapLine } from "../../types";

function shapeCenter(s: MapShape): { x: number; y: number } {
  if (s.points && s.points.length >= 2) {
    const xs = s.points.filter((_, i) => i % 2 === 0);
    const ys = s.points.filter((_, i) => i % 2 === 1);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  return { x: s.cx ?? 0, y: s.cy ?? 0 };
}

const CANVAS_W = 1600;
const CANVAS_H = 1000;
const COLORS = ["#e60012", "#ff2f3e", "#d4af37", "#3fa2ff", "#22c55e", "#a855f7", "#f97316", "#14b8a6"];
const PALETTE = ["#2b2b4a", "#3d3d6b", "#5a3d5c", "#1e3a5f", "#0f5132", "#4a1d24", "#3a4a2a", "#233a4a", "#ffffff22"];

type Tool = "select" | "pan" | "polygon" | "ellipse" | "path" | "label" | "line";

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function newData(): MapData {
  return {
    width: CANVAS_W,
    height: CANVAS_H,
    bg: "#141426",
    shapes: [],
    paths: [],
    labels: [],
    markers: [],
    lines: [],
  };
}

function normalizeMapData(raw: unknown): MapData {
  const base = newData();
  if (!raw || typeof raw !== "object") return base;
  const value = raw as Partial<MapData>;
  return {
    ...base,
    ...value,
    shapes: Array.isArray(value.shapes) ? value.shapes : [],
    paths: Array.isArray(value.paths) ? value.paths : [],
    labels: Array.isArray(value.labels) ? value.labels : [],
    markers: Array.isArray(value.markers) ? value.markers : [],
    lines: Array.isArray(value.lines) ? value.lines : [],
  };
}

export default function MapEditor() {
  const { id } = useParams();
  const novelId = Number(id);

  const [maps, setMaps] = useState<MapDoc[]>([]);
  const [mapId, setMapId] = useState<number | null>(null);
  const [data, setData] = useState<MapData>(newData());
  const [chars, setChars] = useState<Character[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [scale, setScale] = useState(0.6);
  const [offset, setOffset] = useState({ x: 40, y: 20 });
  const [drawing, setDrawing] = useState<{ type: Tool; points: number[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [showChars, setShowChars] = useState(true);
  const [name, setName] = useState("世界地图");
  const [color, setColor] = useState(COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [lineFrom, setLineFrom] = useState<string | null>(null);
  const [hoverChar, setHoverChar] = useState<number | null>(null);
  const [labelPos, setLabelPos] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<MapShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const canvasHostRef = useRef<HTMLDivElement>(null);

  // AI 完善地图
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<{
    shapes: Array<MapShape & { selected?: boolean }>;
    labels: Array<MapLabel & { selected?: boolean }>;
    paths: Array<MapPath & { selected?: boolean }>;
    analyzedChapters?: number;
  } | null>(null);
  const [aiMsg, setAiMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [showChars, loading]);

  const stageRef = useRef<Konva.Stage>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const [ns, cs] = await Promise.all([
          api.get<MapDoc[]>(`/novels/${novelId}/maps`),
          api.get<Character[]>(`/novels/${novelId}/characters`),
        ]);
        if (!active) return;
        setMaps(ns);
        setChars(cs);
        if (ns.length === 0) {
          const created = await api.post<MapDoc>(`/novels/${novelId}/maps`, { name: "世界地图" });
          if (!active) return;
          setMaps([created]);
          setMapId(created.id);
          setName(created.name);
          setData(normalizeMapData(created.data));
        } else {
          const full = await api.get<MapDoc>(`/maps/${ns[0].id}`);
          if (!active) return;
          setMapId(full.id);
          setName(full.name);
          setData(normalizeMapData(full.data));
        }
      } catch (err: any) {
        if (active) setError(err?.message || "地图加载失败，请稍后重试");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [novelId]);

  const saveTimer = useRef<number | null>(null);
  const pendingData = useRef<MapData | null>(null);

  const saveNow = useCallback(
    async (d: MapData) => {
      if (!mapId) return;
      setSaving(true);
      try {
        await api.patch(`/maps/${mapId}`, { data: d });
      } finally {
        setSaving(false);
      }
    },
    [mapId]
  );

  const save = useCallback(
    (d: MapData) => {
      pendingData.current = d;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        if (pendingData.current) void saveNow(pendingData.current);
      }, 500);
    },
    [saveNow]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const mutate = (fn: (d: MapData) => MapData) => {
    setData((d) => {
      const nd = fn(d);
      save(nd);
      return nd;
    });
  };

  const charById = useMemo(() => {
    const m = new Map<number, Character>();
    chars.forEach((c) => m.set(c.id, c));
    return m;
  }, [chars]);

  const markerByChar = useMemo(() => {
    const m = new Map<number, MapMarker>();
    data.markers.forEach((mk) => mk.characterId && m.set(mk.characterId, mk));
    return m;
  }, [data.markers]);

  const lineEndpoints = useMemo(() => {
    const m = new Map<string, { x: number; y: number; color: string }>();
    data.markers.forEach((mk) => m.set(mk.id, { x: mk.x, y: mk.y, color: mk.color }));
    data.shapes.forEach((s) => {
      const c = shapeCenter(s);
      m.set(s.id, { x: c.x, y: c.y, color: "#fff" });
    });
    return m;
  }, [data.markers, data.shapes]);

  const shapeCenters = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    data.shapes.forEach((s) => m.set(s.id, shapeCenter(s)));
    return m;
  }, [data.shapes]);

  const toWorld = (client: Konva.KonvaEventObject<MouseEvent>): { x: number; y: number } => {
    const stage = stageRef.current!;
    const pos = stage.getPointerPosition() ?? { x: 0, y: 0 };
    const transform = stage.getAbsoluteTransform().copy();
    return transform.invert().point(pos);
  };

  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "pan") return;
    const clickedShape = e.target === e.target.getStage();
    if (!clickedShape && tool !== "polygon" && tool !== "path") {
      setSelected(null);
      return;
    }
    const p = toWorld(e);
    if (tool === "polygon") {
      if (!drawing) {
        setDrawing({ type: "polygon", points: [p.x, p.y, p.x + 1, p.y + 1] });
      } else {
        setDrawing({ ...drawing, points: [...drawing.points, p.x, p.y] });
      }
      return;
    }
    if (tool === "path") {
      if (!drawing) {
        setDrawing({ type: "path", points: [p.x, p.y, p.x + 1, p.y + 1] });
      } else {
        setDrawing({ ...drawing, points: [...drawing.points, p.x, p.y] });
      }
      return;
    }
    if (tool === "label") {
      setLabelPos(p);
      return;
    }
    if (tool === "line") {
      if (!lineFrom) {
        setLineFrom(selected);
      } else {
        if (selected && selected !== lineFrom) {
          mutate((d) => ({
            ...d,
            lines: [...d.lines, { id: uid(), fromId: lineFrom, toId: selected, color, dashed: false }],
          }));
        }
        setLineFrom(null);
      }
    }
  };

  const onStageDblClick = () => {
    if (!drawing) return;
    if (drawing.type === "polygon" && drawing.points.length >= 6) {
      mutate((d) => ({
        ...d,
        shapes: [
          ...d.shapes,
          { id: uid(), kind: "polygon", name: `区域${d.shapes.length + 1}`, points: drawing.points, fill: PALETTE[d.shapes.length % PALETTE.length], stroke: "#e8e6f0" },
        ],
      }));
    }
    if (drawing.type === "path" && drawing.points.length >= 4) {
      mutate((d) => ({
        ...d,
        paths: [
          ...d.paths,
          { id: uid(), name: `路径${d.paths.length + 1}`, points: drawing.points, color, width: 5, dashed: false },
        ],
      }));
    }
    setDrawing(null);
  };

  const [isDrawingEllipse, setIsDrawingEllipse] = useState(false);
  const [ellipseAnchor, setEllipseAnchor] = useState<{ x: number; y: number } | null>(null);
  const [ellipseCur, setEllipseCur] = useState<{ x: number; y: number } | null>(null);

  const onStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== "ellipse" || e.target !== e.target.getStage()) return;
    const p = toWorld(e);
    setEllipseAnchor({ x: p.x, y: p.y });
    setEllipseCur({ x: p.x, y: p.y });
    setIsDrawingEllipse(true);
  };

  const onStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === "ellipse" && isDrawingEllipse && ellipseAnchor) {
      const p = toWorld(e);
      setEllipseCur(p);
    }
  };

  const onStageMouseUp = () => {
    if (tool === "ellipse" && isDrawingEllipse && ellipseAnchor && ellipseCur) {
      const rx = Math.abs(ellipseCur.x - ellipseAnchor.x) / 2;
      const ry = Math.abs(ellipseCur.y - ellipseAnchor.y) / 2;
      if (rx > 8 && ry > 8) {
        mutate((d) => ({
          ...d,
          shapes: [
            ...d.shapes,
            {
              id: uid(),
              kind: "ellipse",
              name: `区域${d.shapes.length + 1}`,
              cx: (ellipseAnchor.x + ellipseCur.x) / 2,
              cy: (ellipseAnchor.y + ellipseCur.y) / 2,
              rx,
              ry,
              fill: PALETTE[d.shapes.length % PALETTE.length],
              stroke: "#e8e6f0",
            },
          ],
        }));
      }
    }
    setIsDrawingEllipse(false);
    setEllipseAnchor(null);
    setEllipseCur(null);
  };

  const zoom = (factor: number) => {
    setScale((s) => Math.min(3, Math.max(0.2, +(s * factor).toFixed(3))));
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const factor = e.evt.deltaY < 0 ? 1.08 : 0.92;
    zoom(factor);
  };

  const addMarkerFromChar = (c: Character) => {
    if (markerByChar.has(c.id)) {
      setHoverChar(c.id);
      return;
    }
    mutate((d) => ({
      ...d,
      markers: [
        ...d.markers,
        { id: uid(), characterId: c.id, x: 300 + Math.random() * 600, y: 300 + Math.random() * 400, name: c.name, color: COLORS[Math.floor(Math.random() * COLORS.length)] },
      ],
    }));
  };

  const moveMarker = (m: MapMarker, pos: { x: number; y: number }) => {
    mutate((d) => ({
      ...d,
      markers: d.markers.map((mk) => (mk.id === m.id ? { ...mk, x: pos.x, y: pos.y } : mk)),
    }));
  };

  const exportPng = () => {
    const uri = stageRef.current!.toDataURL({ pixelRatio: 1.5 });
    const a = document.createElement("a");
    a.href = uri;
    a.download = `${name}.png`;
    a.click();
  };

  const startAiEnrich = async () => {
    if (!mapId) return;
    setAiAnalyzing(true);
    setAiMsg(null);
    try {
      const res = await mapAiApi.enrich(novelId, mapId);
      const shapes = (res.shapes || []).map((s) => ({ ...s, id: s.id || uid(), selected: true }));
      const labels = (res.labels || []).map((l) => ({ ...l, id: l.id || uid(), selected: true }));
      const paths = (res.paths || []).map((p) => ({ ...p, id: p.id || uid(), selected: true }));
      setAiResult({
        shapes,
        labels,
        paths,
        analyzedChapters: res.analyzedChapters,
      });
    } catch (err: any) {
      setAiMsg({ kind: "err", text: err.message || "AI 提取地图要素失败，请检查 API 配置" });
    } finally {
      setAiAnalyzing(false);
    }
  };

  const applyAiEnrich = () => {
    if (!aiResult) return;
    const selectedShapes = aiResult.shapes.filter((s) => s.selected);
    const selectedLabels = aiResult.labels.filter((l) => l.selected);
    const selectedPaths = aiResult.paths.filter((p) => p.selected);

    mutate((d) => ({
      ...d,
      shapes: [...d.shapes, ...selectedShapes],
      labels: [...d.labels, ...selectedLabels],
      paths: [...d.paths, ...selectedPaths],
    }));

    setAiModalOpen(false);
    setAiResult(null);
  };

  const previewPoints = drawing ? drawing.points : [];

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-ink-2">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm">地图加载中…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid h-full place-items-center px-4 text-center text-ink-2">
        <div>
          <p className="text-sm text-red-300">{error}</p>
          <button className="btn-ghost mt-4 text-xs" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-surface px-3 py-2">
        <Link to={`/author/book/${novelId}`} className="btn-ghost !min-h-8 !px-2 text-xs" aria-label="返回">
          <ArrowLeft size={14} />
        </Link>
        <input
          className="serif-title w-36 rounded border border-transparent bg-transparent px-2 py-1 text-sm text-ink focus:border-primary-2 focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => mapId && api.patch(`/maps/${mapId}`, { name })}
          aria-label="地图名称"
        />
        <span className="ml-1 hidden text-[10px] text-ink-3 sm:inline">
          {maps.length ? `${maps.length} 张地图` : "尚无地图"}
        </span>

        <div className="ml-auto flex items-center gap-1">
          {(
            [
              ["select", MousePointer2, "选择/连线"],
              ["pan", Hand, "平移/缩放"],
              ["polygon", PenTool, "绘制区域"],
              ["ellipse", PenTool, "椭圆区域"],
              ["path", Route, "绘制路径"],
              ["line", Link2, "关系连线"],
              ["label", Type, "文字标注"],
            ] as const
          ).map(([t, Icon, tip]) => (
            <button
              key={t}
              className={`rounded-md border p-2 transition-colors ${tool === t ? "border-primary-2 bg-primary-soft text-primary-2" : "border-border text-ink-2 hover:text-ink"}`}
              onClick={() => { setTool(t); setDrawing(null); setLineFrom(null); }}
              title={tip}
              aria-pressed={tool === t}
              aria-label={tip}
            >
              <Icon size={15} />
            </button>
          ))}

          <div className="mx-1 h-6 w-px bg-border" />

          <button className="btn-ghost !min-h-8 !px-2 text-xs" onClick={() => zoom(1.2)} aria-label="放大">
            <ZoomIn size={14} />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-ink-3">{Math.round(scale * 100)}%</span>
          <button className="btn-ghost !min-h-8 !px-2 text-xs" onClick={() => zoom(0.83)} aria-label="缩小">
            <ZoomOut size={14} />
          </button>

          <div className="mx-1 h-6 w-px bg-border" />

          <button
            className={`btn-ghost !min-h-8 !px-2 text-xs ${showGrid ? "text-primary-2" : "text-ink-3"}`}
            onClick={() => setShowGrid((v) => !v)}
            title="网格开/关"
          >
            <Grid3x3 size={14} />
          </button>
          <button
            className={`btn-ghost !min-h-8 !px-2 text-xs ${showChars ? "text-primary-2" : "text-ink-3"}`}
            onClick={() => setShowChars((v) => !v)}
            title="人物卡片"
          >
            <Users size={14} />
          </button>
          <button
            className="btn-ghost !min-h-8 !px-2 text-xs border border-primary-2/40 text-primary-2 hover:bg-primary-soft"
            onClick={() => { setAiModalOpen(true); setAiMsg(null); }}
            title="AI 根据正文完善地图"
          >
            <Sparkles size={14} /> <span className="hidden sm:inline">AI 完善地图</span>
          </button>
          <button className="btn-ghost !min-h-8 !px-2 text-xs" onClick={exportPng} title="导出 PNG 图片">
            <Download size={14} />
          </button>
          <button
            className="btn-primary !min-h-8 !px-3 text-xs"
            onClick={() => void saveNow(data)}
            disabled={saving}
          >
            <Save size={14} /> {saving ? "保存中…" : "已保存"}
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex min-h-0 flex-1">
        {/* 画布 */}
        <div
          ref={canvasHostRef}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[#0c0c17]"
          style={{ cursor: tool === "pan" ? "grab" : tool === "select" ? "default" : "crosshair" }}
        >
          {viewport.w > 0 && viewport.h > 0 && (
            <Stage
              ref={stageRef}
              width={viewport.w}
              height={viewport.h}
              scaleX={scale}
              scaleY={scale}
              x={offset.x}
              y={offset.y}
              draggable={tool === "pan"}
              onDragEnd={(e) => {
                if (e.target === e.target.getStage()) {
                  setOffset({ x: e.target.x(), y: e.target.y() });
                }
              }}
              onWheel={onWheel}
              onClick={onStageClick}
              onDblClick={onStageDblClick}
              onMouseDown={onStageMouseDown}
              onMouseMove={onStageMouseMove}
              onMouseUp={onStageMouseUp}
            >
              {/* 底图与网格层：独立离屏图层，关闭事件监听以确保平移与缩放 60fps 丝滑流畅 */}
              <Layer id="bg-layer" listening={false}>
                <Rect
                  x={0}
                  y={0}
                  width={data.width}
                  height={data.height}
                  fill={data.bg}
                  stroke="#2b2b4a"
                  strokeWidth={2}
                  perfectDrawEnabled={false}
                  shadowForStrokeEnabled={false}
                />
                {showGrid && (
                  <Group listening={false}>
                    {Array.from({ length: Math.floor(data.width / 100) + 1 }).map((_, i) => (
                      <KLine
                        key={`v${i}`}
                        points={[i * 100, 0, i * 100, data.height]}
                        stroke="#ffffff0a"
                        strokeWidth={1}
                        listening={false}
                        perfectDrawEnabled={false}
                        shadowForStrokeEnabled={false}
                      />
                    ))}
                    {Array.from({ length: Math.floor(data.height / 100) + 1 }).map((_, i) => (
                      <KLine
                        key={`h${i}`}
                        points={[0, i * 100, data.width, i * 100]}
                        stroke="#ffffff0a"
                        strokeWidth={1}
                        listening={false}
                        perfectDrawEnabled={false}
                        shadowForStrokeEnabled={false}
                      />
                    ))}
                  </Group>
                )}
              </Layer>

              {/* 交互要素层 */}
              <Layer id="main-layer">
                {/* 区域 */}
                {data.shapes.map((s) => {
                  const c = shapeCenters.get(s.id)!;
                  return (
                    <Group
                      key={s.id}
                      onClick={(e) => { e.cancelBubble = true; setSelected(s.id); }}
                      onMouseEnter={() => setHoverChar(-1)}
                    >
                      {s.kind === "polygon" ? (
                        <KLine
                          points={s.points}
                          closed
                          fill={s.fill}
                          stroke={selected === s.id ? "#ff2f3e" : s.stroke}
                          strokeWidth={selected === s.id ? 3 : 2}
                          opacity={0.75}
                          perfectDrawEnabled={false}
                          shadowForStrokeEnabled={false}
                        />
                      ) : (
                        <Ellipse
                          x={s.cx}
                          y={s.cy}
                          radiusX={s.rx!}
                          radiusY={s.ry!}
                          fill={s.fill}
                          stroke={selected === s.id ? "#ff2f3e" : s.stroke}
                          strokeWidth={selected === s.id ? 3 : 2}
                          opacity={0.75}
                          perfectDrawEnabled={false}
                          shadowForStrokeEnabled={false}
                        />
                      )}
                      <KText
                        x={s.kind === "ellipse" ? c.x - 60 : c.x}
                        y={s.kind === "ellipse" ? c.y - 8 : c.y}
                        text={s.name}
                        fontSize={18}
                        fill="#e8e6f0"
                        fontFamily="Noto Serif SC"
                        perfectDrawEnabled={false}
                        shadowForStrokeEnabled={false}
                      />
                    </Group>
                  );
                })}

                {/* 路径 */}
                {data.paths.map((p) => (
                  <KLine
                    key={p.id}
                    points={p.points}
                    stroke={selected === p.id ? "#ff2f3e" : p.color}
                    strokeWidth={selected === p.id ? p.width + 3 : p.width}
                    dash={p.dashed ? [12, 8] : undefined}
                    lineCap="round"
                    lineJoin="round"
                    perfectDrawEnabled={false}
                    shadowForStrokeEnabled={false}
                    onClick={(e) => { e.cancelBubble = true; setSelected(p.id); }}
                  />
                ))}

                {/* 关系连线 */}
                {data.lines.map((l) => {
                  const a = lineEndpoints.get(l.fromId);
                  const b = lineEndpoints.get(l.toId);
                  if (!a || !b) return null;
                  return (
                    <KLine
                      key={l.id}
                      points={[a.x, a.y, b.x, b.y]}
                      stroke={l.color}
                      strokeWidth={3}
                      dash={l.dashed ? [8, 6] : undefined}
                      perfectDrawEnabled={false}
                      shadowForStrokeEnabled={false}
                      onClick={(e) => { e.cancelBubble = true; setSelected(l.id); }}
                    />
                  );
                })}

                {/* 文字标注 */}
                {data.labels.map((l) => (
                  <KText
                    key={l.id}
                    x={l.x}
                    y={l.y}
                    text={l.text}
                    fontSize={l.fontSize}
                    fill={l.color}
                    fontFamily="Noto Serif SC"
                    perfectDrawEnabled={false}
                    shadowForStrokeEnabled={false}
                    onClick={(e) => { e.cancelBubble = true; setSelected(l.id); }}
                    draggable={tool === "select"}
                    onDragEnd={(e) => mutate((d) => ({ ...d, labels: d.labels.map((x) => (x.id === l.id ? { ...x, x: e.target.x(), y: e.target.y() } : x)) }))}
                  />
                ))}

                {/* 人物标点 */}
                {showChars &&
                  data.markers.map((m) => {
                    const c = m.characterId ? charById.get(m.characterId) : null;
                    const charName = m.name || c?.name || "?";
                    return (
                      <Group
                        key={m.id}
                        x={m.x}
                        y={m.y}
                        draggable={tool === "select"}
                        onDragEnd={(e) => moveMarker(m, { x: e.target.x(), y: e.target.y() })}
                        onClick={(e) => { e.cancelBubble = true; setSelected(m.id); }}
                      >
                        <Circle
                          radius={18}
                          fill={m.color}
                          stroke={selected === m.id ? "#fff" : "#fff0"}
                          strokeWidth={2}
                          perfectDrawEnabled={false}
                          shadowForStrokeEnabled={false}
                        />
                        <KText
                          text={charName.slice(0, 1)}
                          x={-10}
                          y={-13}
                          fontSize={16}
                          fill="#fff"
                          width={20}
                          align="center"
                          fontFamily="Noto Serif SC"
                          perfectDrawEnabled={false}
                          shadowForStrokeEnabled={false}
                        />
                        <KText
                          text={charName}
                          x={-40}
                          y={24}
                          width={80}
                          align="center"
                          fontSize={14}
                          fill={m.color}
                          fontFamily="Noto Serif SC"
                          perfectDrawEnabled={false}
                          shadowForStrokeEnabled={false}
                        />
                      </Group>
                    );
                  })}

                {/* 绘制预览 */}
                {previewPoints.length >= 4 && (
                  <KLine
                    points={previewPoints}
                    closed={drawing?.type === "polygon"}
                    stroke="#ff2f3e"
                    strokeWidth={2}
                    dash={[6, 4]}
                    listening={false}
                    perfectDrawEnabled={false}
                    shadowForStrokeEnabled={false}
                  />
                )}
                {isDrawingEllipse && ellipseAnchor && ellipseCur && (
                  <Ellipse
                    x={(ellipseAnchor.x + ellipseCur.x) / 2}
                    y={(ellipseAnchor.y + ellipseCur.y) / 2}
                    radiusX={Math.abs(ellipseCur.x - ellipseAnchor.x) / 2}
                    radiusY={Math.abs(ellipseCur.y - ellipseAnchor.y) / 2}
                    stroke="#ff2f3e"
                    strokeWidth={2}
                    dash={[6, 4]}
                    listening={false}
                    perfectDrawEnabled={false}
                    shadowForStrokeEnabled={false}
                  />
                )}
              </Layer>
            </Stage>
          )}

          {/* 选中图形属性面板 */}
          {selected && (
            <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 rounded-lg border border-border bg-surface/90 px-3 py-2 text-xs backdrop-blur">
              <span className="text-ink-2">已选中要素</span>
              <button
                className="btn-danger !min-h-7 !px-2 text-xs"
                onClick={() => {
                  mutate((d) => ({
                    ...d,
                    shapes: d.shapes.filter((s) => s.id !== selected),
                    paths: d.paths.filter((p) => p.id !== selected),
                    labels: d.labels.filter((l) => l.id !== selected),
                    markers: d.markers.filter((m) => m.id !== selected),
                    lines: d.lines.filter((l) => l.id !== selected && l.fromId !== selected && l.toId !== selected),
                  }));
                  setSelected(null);
                }}
              >
                <Trash2 size={12} /> 删除
              </button>
            </div>
          )}
        </div>

        {/* 右侧：人物库放置面板 */}
        {showChars && (
          <aside className="w-72 shrink-0 overflow-y-auto border-l border-border bg-surface p-3">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wider text-ink-3">
              <Users size={12} /> 人物（点击放置在地图上）
            </h3>
            <div className="space-y-1.5">
              {chars.map((c) => {
                const placed = markerByChar.has(c.id);
                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-2 rounded-md border p-2 transition-colors ${
                      placed ? "border-emerald-500/30 bg-emerald-500/5" : "border-border"
                    } ${hoverChar === c.id ? "ring-1 ring-primary-2" : ""}`}
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary-2 text-xs font-serif text-white">
                      {c.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{c.name}</p>
                      <p className="text-[10px] text-ink-3">{c.role}</p>
                    </div>
                    <button
                      className={`rounded-md border px-2 py-1 text-[10px] ${placed ? "border-emerald-500/40 text-emerald-400" : "border-primary-2/40 text-primary-2 hover:bg-primary-soft"}`}
                      onClick={() => (placed ? setSelected(markerByChar.get(c.id)!.id) : addMarkerFromChar(c))}
                    >
                      {placed ? "已放置" : "放置"}
                    </button>
                  </div>
                );
              })}
              {chars.length === 0 && (
                <Link to={`/author/book/${novelId}/characters`} className="block rounded-md border border-dashed border-border p-4 text-center text-xs text-ink-3 hover:text-ink">
                  先去人物库创建人物
                </Link>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* 文字标注输入弹窗 */}
      <PromptDialog
        open={labelPos !== null}
        title="添加地名/文字标注"
        label="文字内容"
        placeholder="如：落日山脉、天元帝国、青云宗"
        onSubmit={(text) => {
          if (labelPos && text.trim()) {
            mutate((d) => ({
              ...d,
              labels: [...d.labels, { id: uid(), text: text.trim(), x: labelPos.x, y: labelPos.y, fontSize: 18, color: "#e8e6f0" }],
            }));
          }
          setLabelPos(null);
        }}
        onCancel={() => setLabelPos(null)}
      />

      {/* AI 完善地图弹窗 */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Sparkles className="text-primary-2" size={18} />
                <h2 className="serif-title text-base text-ink">AI 根据小说正文完善地图要素</h2>
              </div>
              <button
                className="rounded p-1 text-ink-3 hover:text-ink"
                onClick={() => setAiModalOpen(false)}
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3 text-xs">
                <span className="text-ink-2">
                  AI 将扫描作品章节正文，提取其中的国家/宗门领地、城池关隘地标与河流路线，生成合理的地图布局坐标。
                </span>
                <button
                  className="btn-primary !min-h-8 !px-3 text-xs"
                  onClick={() => void startAiEnrich()}
                  disabled={aiAnalyzing}
                >
                  {aiAnalyzing ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" /> AI 分析正文与提取地理中…
                    </>
                  ) : (
                    <>
                      <Wand2 size={13} /> {aiResult ? "重新提取分析" : "开始提取地理要素"}
                    </>
                  )}
                </button>
              </div>

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

              {aiResult && (
                <div className="space-y-4">
                  {/* 1. 区域与宗门领地 */}
                  {aiResult.shapes.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-ink mb-2">🏞️ 区域与宗门势力范围 ({aiResult.shapes.length})</h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {aiResult.shapes.map((s, idx) => (
                          <div
                            key={s.id || idx}
                            className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-xs transition-colors ${
                              s.selected ? "border-primary-2/40 bg-surface-2" : "border-border bg-surface opacity-60"
                            }`}
                          >
                            <button
                              type="button"
                              className="text-primary-2"
                              onClick={() =>
                                setAiResult((res) => res && {
                                  ...res,
                                  shapes: res.shapes.map((item, i) => (i === idx ? { ...item, selected: !item.selected } : item)),
                                })
                              }
                            >
                              {s.selected ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-ink truncate">{s.name}</p>
                              <p className="text-[10px] text-ink-3 truncate">
                                坐标: ({Math.round(s.cx || 0)}, {Math.round(s.cy || 0)}) · 半径: {Math.round(s.rx || 100)}x{Math.round(s.ry || 80)}
                              </p>
                            </div>
                            <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: s.fill }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 2. 地标与城池据点 */}
                  {aiResult.labels.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-ink mb-2">📍 地标与城池据点 ({aiResult.labels.length})</h3>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {aiResult.labels.map((l, idx) => (
                          <div
                            key={l.id || idx}
                            className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-xs transition-colors ${
                              l.selected ? "border-primary-2/40 bg-surface-2" : "border-border bg-surface opacity-60"
                            }`}
                          >
                            <button
                              type="button"
                              className="text-primary-2"
                              onClick={() =>
                                setAiResult((res) => res && {
                                  ...res,
                                  labels: res.labels.map((item, i) => (i === idx ? { ...item, selected: !item.selected } : item)),
                                })
                              }
                            >
                              {l.selected ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-ink truncate">{l.text}</p>
                              <p className="text-[10px] text-ink-3">坐标: ({Math.round(l.x)}, {Math.round(l.y)})</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3. 路线与江河山脉 */}
                  {aiResult.paths.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-ink mb-2">🛤️ 路线与江河山脉 ({aiResult.paths.length})</h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {aiResult.paths.map((p, idx) => (
                          <div
                            key={p.id || idx}
                            className={`flex items-center gap-2.5 rounded-lg border p-2.5 text-xs transition-colors ${
                              p.selected ? "border-primary-2/40 bg-surface-2" : "border-border bg-surface opacity-60"
                            }`}
                          >
                            <button
                              type="button"
                              className="text-primary-2"
                              onClick={() =>
                                setAiResult((res) => res && {
                                  ...res,
                                  paths: res.paths.map((item, i) => (i === idx ? { ...item, selected: !item.selected } : item)),
                                })
                              }
                            >
                              {p.selected ? <CheckSquare size={16} /> : <Square size={16} />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-ink truncate">{p.name || `路径 ${idx + 1}`}</p>
                              <p className="text-[10px] text-ink-3">{p.points.length / 2} 个节点</p>
                            </div>
                            <span className="h-2 w-8 rounded" style={{ backgroundColor: p.color }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {!aiResult && !aiAnalyzing && (
                <div className="py-12 text-center text-xs text-ink-3">
                  点击上方「开始提取地理要素」，AI 将提取小说正文中的领土、城池与路线，并生成建议分布。
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-5 py-3.5 bg-surface-2/50">
              <span className="text-xs text-ink-3">
                {aiResult
                  ? `已选 ${
                      aiResult.shapes.filter((s) => s.selected).length +
                      aiResult.labels.filter((l) => l.selected).length +
                      aiResult.paths.filter((p) => p.selected).length
                    } 个地理要素`
                  : "支持要素复选与批量合并"}
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
                  onClick={applyAiEnrich}
                  disabled={
                    !aiResult ||
                    !(
                      aiResult.shapes.some((s) => s.selected) ||
                      aiResult.labels.some((l) => l.selected) ||
                      aiResult.paths.some((p) => p.selected)
                    )
                  }
                >
                  合并应用到当前地图
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
