import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  Link as LinkIcon,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  Search,
  MapPin,
  Compass,
  X,
  Castle,
  Mountain,
  Flame,
  Shield,
  Layers,
  Check
} from "lucide-react";
import { api } from "../../api";

// 地点类型定义
export interface LocationNode {
  id: string;
  name: string;
  category: "sect" | "city" | "fortress" | "secret" | "danger" | "town" | "natural";
  x: number;
  y: number;
  faction?: string;
  characters?: string;
  description?: string;
  dangerLevel: "safe" | "normal" | "danger" | "forbidden";
  resources?: string;
}

// 路线定义
export interface RouteEdge {
  id: string;
  from: string;
  to: string;
  type: "road" | "water" | "portal" | "secret" | "barrier";
  label?: string;
  description?: string;
}

const CATEGORY_MAP = {
  sect: { label: "宗门 / 仙山", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/40", icon: Sparkles },
  city: { label: "主城 / 帝国", color: "bg-amber-500/20 text-amber-400 border-amber-500/40", icon: Castle },
  fortress: { label: "要塞 / 关隘", color: "bg-stone-500/20 text-stone-300 border-stone-500/40", icon: Shield },
  secret: { label: "秘境 / 遗迹", color: "bg-purple-500/20 text-purple-400 border-purple-500/40", icon: Layers },
  danger: { label: "凶险禁地", color: "bg-rose-500/20 text-rose-400 border-rose-500/40", icon: Flame },
  town: { label: "城镇 / 商会", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40", icon: Compass },
  natural: { label: "大川 / 荒原", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40", icon: Mountain },
};

const DANGER_MAP = {
  safe: { label: "安全", color: "text-emerald-400" },
  normal: { label: "凡俗", color: "text-blue-400" },
  danger: { label: "凶险", color: "text-amber-400" },
  forbidden: { label: "禁忌绝地", color: "text-rose-500 font-bold" },
};

const ROUTE_STYLES = {
  road: { stroke: "#94a3b8", strokeDasharray: "none", label: "官道陆路" },
  water: { stroke: "#38bdf8", strokeDasharray: "6,6", label: "通航水运" },
  portal: { stroke: "#c084fc", strokeDasharray: "4,4", label: "空间传送" },
  secret: { stroke: "#f59e0b", strokeDasharray: "8,4", label: "隐秘暗径" },
  barrier: { stroke: "#f43f5e", strokeDasharray: "3,3", label: "结界封阻" },
};

// 预设世界观模板
const TEMPLATES = [
  {
    name: "🌟 修仙大千世界",
    desc: "中州仙域、太上仙宗、上古昆仑秘境、南疆十万大山与九幽深渊",
    nodes: [
      { id: "x1", name: "中州仙朝·太初帝都", category: "city", x: 600, y: 400, faction: "大衍神朝", characters: "神皇、太子", dangerLevel: "safe", description: "九州枢纽，万宗来朝之所" },
      { id: "x2", name: "太上道宗", category: "sect", x: 420, y: 220, faction: "太上玄门", characters: "纯阳道祖", dangerLevel: "safe", description: "万载道门领袖，悬空三十三重天" },
      { id: "x3", name: "昆仑废墟·上古秘境", category: "secret", x: 260, y: 140, faction: "上古仙族残裔", dangerLevel: "danger", description: "蕴含成仙契机的大道遗迹", resources: "混沌青莲根" },
      { id: "x4", name: "南疆·十万大山", category: "danger", x: 480, y: 650, faction: "蛮荒九黎", dangerLevel: "danger", description: "瘴气弥漫，太古异兽盘踞" },
      { id: "x5", name: "东海·蓬莱归墟", category: "natural", x: 880, y: 350, faction: "真龙一族", dangerLevel: "normal", description: "无垠汪洋尽头的天地海眼" },
      { id: "x6", name: "九幽绝地·无间深渊", category: "danger", x: 820, y: 680, faction: "九幽魔宗", dangerLevel: "forbidden", description: "地脉阴煞之汇，魔道巨擘封印地" },
    ],
    edges: [
      { id: "e1", from: "x1", to: "x2", type: "road", label: "通天白玉道" },
      { id: "e2", from: "x2", to: "x3", type: "secret", label: "虚空古路" },
      { id: "e3", from: "x1", to: "x5", type: "water", label: "沧海漕运" },
      { id: "e4", from: "x1", to: "x4", type: "road", label: "南巡官道" },
      { id: "e5", from: "x4", to: "x6", type: "barrier", label: "天雷伏魔大阵" },
      { id: "e6", from: "x1", to: "x6", type: "portal", label: "封魔跨界阵" },
    ]
  },
  {
    name: "⚔️ 西幻帝国与地下城",
    desc: "圣辉王都、奥术高塔、边陲黑石要塞与无尽深渊",
    nodes: [
      { id: "w1", name: "圣辉帝国王都·罗曼城", category: "city", x: 500, y: 380, faction: "太阳王室", characters: "查理三世、大主教", dangerLevel: "safe", description: "全大陆最辉煌的白石圣城" },
      { id: "w2", name: "逐日奥术法师塔", category: "sect", x: 320, y: 240, faction: "秘法评议会", dangerLevel: "safe", description: "悬浮于高空的永恒魔导核心" },
      { id: "w3", name: "黑石要塞·叹息之壁", category: "fortress", x: 740, y: 320, faction: "帝国第七重军团", dangerLevel: "normal", description: "抵御异端北侵的第一防线" },
      { id: "w4", name: "迷雾低语·黑森林", category: "natural", x: 780, y: 550, faction: "暗夜德鲁伊", dangerLevel: "danger", description: "终年不见天日的被诅咒林地" },
      { id: "w5", name: "深渊裂隙·地下城", category: "danger", x: 920, y: 640, faction: "深渊领主", dangerLevel: "forbidden", description: "一百层未被攻略的上古地城" },
    ],
    edges: [
      { id: "we1", from: "w1", to: "w2", type: "portal", label: "奥术传送镜" },
      { id: "we2", from: "w1", to: "w3", type: "road", label: "帝国皇家大道" },
      { id: "we3", from: "w3", to: "w4", type: "secret", label: "巡林荒径" },
      { id: "we4", from: "w4", to: "w5", type: "barrier", label: "封印回廊" },
    ]
  },
  {
    name: "🏯 江湖九州与宗派",
    desc: "大炎神都、临安世家、纯阳道宗、黑木崖与天下第一雄关",
    nodes: [
      { id: "j1", name: "大炎神都·天子脚下", category: "city", x: 550, y: 400, faction: "朝廷六扇门", characters: "诸葛总捕头", dangerLevel: "safe", description: "庙堂威严，藏龙卧虎" },
      { id: "j2", name: "纯阳道宗·终南之巅", category: "sect", x: 380, y: 260, faction: "天下道门之首", dangerLevel: "safe", description: "仙风道骨，剑试天下" },
      { id: "j3", name: "临安府·江南世家", category: "town", x: 720, y: 460, faction: "四大世家联盟", dangerLevel: "normal", description: "烟雨江南，富甲天下" },
      { id: "j4", name: "雁门关·天下雄关", category: "fortress", x: 350, y: 150, faction: "镇北军", dangerLevel: "normal", description: "一夫当关，万夫莫开" },
      { id: "j5", name: "黑木崖·魔宗圣坛", category: "danger", x: 800, y: 220, faction: "日月天魔教", dangerLevel: "danger", description: "险峰万仞，正道不敢犯" },
    ],
    edges: [
      { id: "je1", from: "j1", to: "j2", type: "road", label: "终南驿道" },
      { id: "je2", from: "j1", to: "j3", type: "water", label: "江南运河" },
      { id: "je3", from: "j2", to: "j4", type: "road", label: "塞外驰道" },
      { id: "je4", from: "j1", to: "j5", type: "barrier", label: "险阻绝壁" },
    ]
  }
];

export default function MapEditor() {
  const { id: novelId, mapId } = useParams<{ id: string; mapId: string }>();
  const navigate = useNavigate();

  // 数据状态
  const [mapTitle, setMapTitle] = useState("大世界地理全图");
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [edges, setEdges] = useState<RouteEdge[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 画布交互状态 (CSS 硬件加速变换)
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // 节点拖拽
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 });

  // 连线模式
  const [connectMode, setConnectMode] = useState(false);
  const [connectStartNodeId, setConnectStartNodeId] = useState<string | null>(null);

  // 选中查看与编辑
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // 加载地图数据
  useEffect(() => {
    if (!mapId) return;
    api.get(`/maps/${mapId}`).then((res: any) => {
      if (res) {
        if (res.title) setMapTitle(res.title);
        try {
          const parsedNodes = typeof res.nodes === "string" ? JSON.parse(res.nodes) : res.nodes;
          if (Array.isArray(parsedNodes) && parsedNodes.length > 0) {
            setNodes(parsedNodes);
          } else {
            // 初始空地图直接载入第一个修仙模板让作者开箱即用
            setNodes(TEMPLATES[0].nodes as LocationNode[]);
            setEdges(TEMPLATES[0].edges as RouteEdge[]);
          }
          const parsedEdges = typeof res.edges === "string" ? JSON.parse(res.edges) : res.edges;
          if (Array.isArray(parsedEdges) && parsedEdges.length > 0) {
            setEdges(parsedEdges);
          }
        } catch {
          setNodes(TEMPLATES[0].nodes as LocationNode[]);
          setEdges(TEMPLATES[0].edges as RouteEdge[]);
        }
      }
    }).catch(() => {
      setNodes(TEMPLATES[0].nodes as LocationNode[]);
      setEdges(TEMPLATES[0].edges as RouteEdge[]);
    });
  }, [mapId]);

  // 保存地图
  const handleSave = async () => {
    if (!mapId) return;
    setSaving(true);
    try {
      await api.patch(`/maps/${mapId}`, {
        title: mapTitle,
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
        settings: JSON.stringify({ zoom, pan }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      console.error("保存地图失败:", e);
    } finally {
      setSaving(false);
    }
  };

  // 画布滚轮缩放
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.3), 2.5);
    setZoom(Number(newZoom.toFixed(2)));
  };

  // 画布平移 (按下中键或左键空白区)
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target !== containerRef.current && (e.target as HTMLElement).id !== "canvas-bg") return;
    if (e.button === 0 || e.button === 1) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
    } else if (draggingNodeId) {
      const dx = (e.clientX - dragStartRef.current.mouseX) / zoom;
      const dy = (e.clientY - dragStartRef.current.mouseY) / zoom;
      setNodes(prev => prev.map(n => {
        if (n.id === draggingNodeId) {
          return { ...n, x: Math.round(dragStartRef.current.nodeX + dx), y: Math.round(dragStartRef.current.nodeY + dy) };
        }
        return n;
      }));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  // 节点拖拽起始
  const handleNodeMouseDown = (e: React.MouseEvent, node: LocationNode) => {
    e.stopPropagation();
    if (connectMode) {
      if (!connectStartNodeId) {
        setConnectStartNodeId(node.id);
      } else if (connectStartNodeId !== node.id) {
        // 创建连线
        const newEdge: RouteEdge = {
          id: `edge_${Date.now()}`,
          from: connectStartNodeId,
          to: node.id,
          type: "road",
          label: "连知道路",
        };
        setEdges(prev => [...prev, newEdge]);
        setConnectStartNodeId(null);
        setConnectMode(false);
      }
      return;
    }

    if (e.button === 0) {
      setSelectedNodeId(node.id);
      setDraggingNodeId(node.id);
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        nodeX: node.x,
        nodeY: node.y,
      };
    }
  };

  // 添加新地点
  const handleAddLocation = () => {
    const id = `loc_${Date.now()}`;
    // 放置在当前视图中心
    const centerX = -pan.x / zoom + (containerRef.current?.clientWidth || 800) / (2 * zoom);
    const centerY = -pan.y / zoom + (containerRef.current?.clientHeight || 600) / (2 * zoom);

    const newNode: LocationNode = {
      id,
      name: `新领地·${nodes.length + 1}`,
      category: "sect",
      x: Math.round(centerX),
      y: Math.round(centerY),
      dangerLevel: "safe",
      description: "新建立的神秘领域...",
    };

    setNodes(prev => [...prev, newNode]);
    setSelectedNodeId(id);
  };

  // 删除地点
  const handleDeleteNode = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.from !== id && e.to !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  // 聚焦到指定地点
  const focusLocation = (node: LocationNode) => {
    setSelectedNodeId(node.id);
    const w = containerRef.current?.clientWidth || 800;
    const h = containerRef.current?.clientHeight || 600;
    setPan({
      x: -(node.x * zoom) + w / 2,
      y: -(node.y * zoom) + h / 2,
    });
  };

  // 导入模板
  const applyTemplate = (tpl: typeof TEMPLATES[0]) => {
    setNodes(tpl.nodes as LocationNode[]);
    setEdges(tpl.edges as RouteEdge[]);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setShowTemplateModal(false);
  };

  const selectedNode = nodes.find(n => n.id === selectedNodeId);

  return (
    <div className="flex h-screen w-full flex-col bg-stone-950 text-stone-100 overflow-hidden select-none">
      {/* 顶部操作工具栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-stone-800 bg-stone-900/80 px-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/author/novel/${novelId}`)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-700 bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-white transition"
            title="返回作品主页"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <input
            type="text"
            value={mapTitle}
            onChange={e => setMapTitle(e.target.value)}
            className="bg-transparent text-lg font-bold tracking-wide focus:outline-none border-b border-transparent hover:border-stone-700 focus:border-amber-500 px-1 py-0.5 text-stone-100"
          />
          <span className="rounded bg-stone-800 px-2 py-0.5 text-xs text-stone-400">
            {nodes.length} 地点 · {edges.length} 路线
          </span>
        </div>

        {/* 快捷操作区 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTemplateModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/20 transition shadow-sm"
          >
            <Sparkles className="h-3.5 w-3.5" />
            世界观模板
          </button>

          <button
            onClick={handleAddLocation}
            className="flex items-center gap-1.5 rounded-lg border border-stone-700 bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-200 hover:bg-stone-700 transition"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-400" />
            添加地点
          </button>

          <button
            onClick={() => {
              setConnectMode(!connectMode);
              setConnectStartNodeId(null);
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              connectMode
                ? "border-amber-500 bg-amber-500/20 text-amber-300 animate-pulse"
                : "border-stone-700 bg-stone-800 text-stone-200 hover:bg-stone-700"
            }`}
          >
            <LinkIcon className="h-3.5 w-3.5 text-indigo-400" />
            {connectMode ? (connectStartNodeId ? "点击目标地点..." : "点击起点地点...") : "连接路线"}
          </button>

          <div className="h-4 w-[1px] bg-stone-800 mx-1" />

          {/* 缩放按钮 */}
          <div className="flex items-center rounded-lg border border-stone-800 bg-stone-900/60 p-0.5">
            <button
              onClick={() => setZoom(z => Math.max(z - 0.15, 0.3))}
              className="p-1 text-stone-400 hover:text-white"
              title="缩小"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 text-xs text-stone-400 min-w-[3rem] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(z + 0.15, 2.5))}
              className="p-1 text-stone-400 hover:text-white"
              title="放大"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              className="p-1 text-stone-400 hover:text-white border-l border-stone-800 ml-0.5"
              title="重置视角"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* 保存按钮 */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 transition shadow"
          >
            {saveSuccess ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "保存中..." : saveSuccess ? "已保存" : "保存地图"}
          </button>
        </div>
      </header>

      {/* 主工作区 */}
      <div className="flex flex-1 relative overflow-hidden">
        {/* 左侧地点索引侧边栏 */}
        <aside className="z-10 flex w-64 flex-col border-r border-stone-800/80 bg-stone-900/90 backdrop-blur">
          <div className="p-3 border-b border-stone-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-stone-500" />
              <input
                type="text"
                placeholder="搜索地点、势力..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-stone-800 bg-stone-950 py-1.5 pl-8 pr-3 text-xs text-stone-200 placeholder-stone-500 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="px-2 py-1 text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
              全部地理标的 ({nodes.length})
            </div>
            {nodes
              .filter(n => n.name.includes(searchQuery) || (n.faction && n.faction.includes(searchQuery)))
              .map(node => {
                const CatMeta = CATEGORY_MAP[node.category] || CATEGORY_MAP.sect;
                const isSelected = selectedNodeId === node.id;
                return (
                  <div
                    key={node.id}
                    onClick={() => focusLocation(node)}
                    className={`flex items-center justify-between rounded-lg px-2.5 py-2 text-xs transition cursor-pointer border ${
                      isSelected
                        ? "border-amber-500/50 bg-amber-500/10 text-white"
                        : "border-transparent text-stone-300 hover:bg-stone-800/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <CatMeta.icon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                      <div className="truncate">
                        <div className="font-medium truncate">{node.name}</div>
                        {node.faction && (
                          <div className="text-[10px] text-stone-500 truncate">{node.faction}</div>
                        )}
                      </div>
                    </div>
                    <span className={`text-[10px] shrink-0 font-medium ${DANGER_MAP[node.dangerLevel].color}`}>
                      {DANGER_MAP[node.dangerLevel].label}
                    </span>
                  </div>
                );
              })}
          </div>
        </aside>

        {/* 画布核心交互容器 (CSS 3D 变换硬件加速，60fps 流畅缩放与平移) */}
        <main
          ref={containerRef}
          id="canvas-bg"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          className={`flex-1 relative overflow-hidden bg-stone-950 ${
            isPanning ? "cursor-grabbing" : "cursor-grab"
          }`}
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)`,
            backgroundSize: `${32 * zoom}px ${32 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          {/* 渲染画布平移与缩放层 */}
          <div
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transformOrigin: "0 0",
              position: "absolute",
              left: 0,
              top: 0,
              width: "100%",
              height: "100%",
            }}
          >
            {/* SVG 连线层 */}
            <svg
              className="absolute left-0 top-0 overflow-visible pointer-events-none"
              style={{ width: "10000px", height: "10000px" }}
            >
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                </marker>
              </defs>
              {edges.map(edge => {
                const fromNode = nodes.find(n => n.id === edge.from);
                const toNode = nodes.find(n => n.id === edge.to);
                if (!fromNode || !toNode) return null;

                const style = ROUTE_STYLES[edge.type] || ROUTE_STYLES.road;
                const midX = (fromNode.x + toNode.x) / 2;
                const midY = (fromNode.y + toNode.y) / 2;

                return (
                  <g key={edge.id}>
                    <line
                      x1={fromNode.x}
                      y1={fromNode.y}
                      x2={toNode.x}
                      y2={toNode.y}
                      stroke={style.stroke}
                      strokeWidth={2}
                      strokeDasharray={style.strokeDasharray}
                      className="transition-all"
                    />
                    {edge.label && (
                      <text
                        x={midX}
                        y={midY - 8}
                        fill="#cbd5e1"
                        fontSize={11}
                        textAnchor="middle"
                        className="font-medium drop-shadow-md select-none pointer-events-auto cursor-pointer"
                        onClick={() => {
                          const newLabel = prompt("修改路线描述:", edge.label);
                          if (newLabel !== null) {
                            setEdges(prev => prev.map(e => e.id === edge.id ? { ...e, label: newLabel } : e));
                          }
                        }}
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* 连线过程中的预览线 */}
              {connectMode && connectStartNodeId && (
                (() => {
                  const s = nodes.find(n => n.id === connectStartNodeId);
                  if (!s) return null;
                  return (
                    <circle cx={s.x} cy={s.y} r={28} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4,4" className="animate-spin" />
                  );
                })()
              )}
            </svg>

            {/* 地点卡片节点层 */}
            {nodes.map(node => {
              const CatMeta = CATEGORY_MAP[node.category] || CATEGORY_MAP.sect;
              const isSelected = selectedNodeId === node.id;
              const isConnectTarget = connectMode && connectStartNodeId === node.id;

              return (
                <div
                  key={node.id}
                  onMouseDown={e => handleNodeMouseDown(e, node)}
                  style={{
                    position: "absolute",
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                  className={`group cursor-pointer rounded-xl border p-3 shadow-xl backdrop-blur transition-all ${
                    isSelected
                      ? "border-amber-400 bg-stone-900/95 ring-2 ring-amber-500/40 z-20 scale-105"
                      : "border-stone-700/80 bg-stone-900/80 hover:border-stone-500 z-10"
                  } ${isConnectTarget ? "ring-2 ring-amber-400 animate-pulse" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-lg border ${CatMeta.color}`}>
                      <CatMeta.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-stone-100 flex items-center gap-1.5">
                        {node.name}
                        <span className={`text-[10px] font-normal ${DANGER_MAP[node.dangerLevel].color}`}>
                          [{DANGER_MAP[node.dangerLevel].label}]
                        </span>
                      </div>
                      {node.faction && (
                        <div className="text-[11px] text-stone-400 font-medium">
                          {node.faction}
                        </div>
                      )}
                    </div>
                  </div>

                  {node.description && (
                    <p className="mt-1.5 max-w-[200px] text-[11px] text-stone-400 line-clamp-2">
                      {node.description}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </main>

        {/* 右侧地点详细属性编辑抽屉 */}
        {selectedNode && (
          <aside className="z-10 flex w-80 flex-col border-l border-stone-800 bg-stone-900/95 p-4 backdrop-blur overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <h3 className="text-sm font-bold text-stone-200 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-amber-500" />
                编辑地点属性
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDeleteNode(selectedNode.id)}
                  className="rounded p-1 text-stone-500 hover:bg-rose-500/20 hover:text-rose-400 transition"
                  title="删除地点"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setSelectedNodeId(null)}
                  className="rounded p-1 text-stone-500 hover:bg-stone-800 hover:text-stone-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block text-stone-400 mb-1 font-medium">地点名称</label>
                <input
                  type="text"
                  value={selectedNode.name}
                  onChange={e => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, name: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-stone-200 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">地理类别</label>
                <select
                  value={selectedNode.category}
                  onChange={e => {
                    const val = e.target.value as LocationNode["category"];
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, category: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-stone-200 focus:border-amber-500 focus:outline-none"
                >
                  {Object.entries(CATEGORY_MAP).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">危险级别</label>
                <select
                  value={selectedNode.dangerLevel}
                  onChange={e => {
                    const val = e.target.value as LocationNode["dangerLevel"];
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, dangerLevel: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-stone-200 focus:border-amber-500 focus:outline-none"
                >
                  {Object.entries(DANGER_MAP).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">所属势力 / 门派统治</label>
                <input
                  type="text"
                  placeholder="如：大衍神朝、太上玄门"
                  value={selectedNode.faction || ""}
                  onChange={e => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, faction: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-stone-200 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">常驻代表人物</label>
                <input
                  type="text"
                  placeholder="如：纯阳祖师、白石城主"
                  value={selectedNode.characters || ""}
                  onChange={e => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, characters: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-stone-200 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">地脉特色 / 产出资源</label>
                <input
                  type="text"
                  placeholder="如：九天灵玉矿、混沌青莲根"
                  value={selectedNode.resources || ""}
                  onChange={e => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, resources: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-stone-200 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">地理与环境设定</label>
                <textarea
                  rows={4}
                  placeholder="描写地形险要、气候特征及关键剧情背景..."
                  value={selectedNode.description || ""}
                  onChange={e => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, description: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-stone-200 focus:border-amber-500 focus:outline-none resize-none leading-relaxed"
                />
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* 世界观模板选择弹窗 */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-stone-800 bg-stone-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-stone-800">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                <h3 className="text-base font-bold text-stone-100">选择世界观地理预设</h3>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-2 text-xs text-stone-400 leading-relaxed">
              一键导入小说典型世界地图架构，包含核心主城、顶级宗派、禁忌险地及通路连线，方便在此基础上扩充创作：
            </p>

            <div className="mt-4 space-y-3">
              {TEMPLATES.map((tpl, i) => (
                <div
                  key={i}
                  onClick={() => applyTemplate(tpl)}
                  className="group flex flex-col gap-1 rounded-xl border border-stone-800 bg-stone-950 p-3.5 transition hover:border-amber-500/50 hover:bg-stone-800/40 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-200 group-hover:text-amber-400 transition text-sm">
                      {tpl.name}
                    </span>
                    <span className="text-[11px] text-stone-500">
                      {tpl.nodes.length} 个核心标的
                    </span>
                  </div>
                  <p className="text-xs text-stone-400 leading-relaxed">
                    {tpl.desc}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowTemplateModal(false)}
                className="rounded-lg border border-stone-700 px-4 py-1.5 text-xs text-stone-300 hover:bg-stone-800 transition"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
