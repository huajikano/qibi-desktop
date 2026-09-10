import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Sparkles,
  Search,
  MapPin,
  X,
  Castle,
  Mountain,
  Flame,
  Shield,
  Layers,
  Check,
  Users,
  Compass,
  Link2,
  Route,
  ChevronRight,
  FolderPlus,
  Edit3
} from "lucide-react";
import { api } from "../../api";
import type { Character } from "../../types";

export interface LocationNode {
  id: string;
  name: string;
  category: "city" | "sect" | "fortress" | "secret" | "danger" | "town" | "natural";
  x: number;
  y: number;
  faction?: string;
  characterIds?: number[];
  customCharacters?: string;
  description?: string;
  dangerLevel: "safe" | "normal" | "danger" | "forbidden";
  resources?: string;
}

export interface RouteEdge {
  id: string;
  from: string;
  to: string;
  type: "road" | "water" | "portal" | "secret" | "barrier";
  label?: string;
  description?: string;
}

export interface MapDocument {
  id: number;
  novel_id: number;
  name: string;
  nodes?: string | LocationNode[];
  edges?: string | RouteEdge[];
  settings?: string | any;
}

const CATEGORY_MAP = {
  city: { label: "主城 / 帝国", color: "border-amber-500/40 bg-amber-500/10 text-amber-300", icon: Castle },
  sect: { label: "宗派 / 仙山", color: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300", icon: Sparkles },
  fortress: { label: "要塞 / 关隘", color: "border-stone-500/40 bg-stone-500/10 text-stone-300", icon: Shield },
  secret: { label: "秘境 / 遗迹", color: "border-purple-500/40 bg-purple-500/10 text-purple-300", icon: Layers },
  danger: { label: "凶险禁地", color: "border-rose-500/40 bg-rose-500/10 text-rose-400", icon: Flame },
  town: { label: "城镇 / 坊市", color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", icon: Compass },
  natural: { label: "大川 / 奇观", color: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300", icon: Mountain },
};

const DANGER_MAP = {
  safe: { label: "安全", tag: "bg-emerald-500/20 text-emerald-300" },
  normal: { label: "凡俗", tag: "bg-blue-500/20 text-blue-300" },
  danger: { label: "凶险", tag: "bg-amber-500/20 text-amber-300" },
  forbidden: { label: "绝地", tag: "bg-rose-500/20 text-rose-300 font-bold" },
};

const ROUTE_TYPES = {
  road: { label: "官道陆路", stroke: "#94a3b8", dash: "none" },
  water: { label: "水运水道", stroke: "#38bdf8", dash: "6,6" },
  portal: { label: "传送法阵", stroke: "#c084fc", dash: "4,4" },
  secret: { label: "暗道险径", stroke: "#f59e0b", dash: "8,4" },
  barrier: { label: "界限封锁", stroke: "#f43f5e", dash: "3,3" },
};

const TEMPLATES = [
  {
    name: "🌟 修仙大千世界",
    desc: "仙都、太上道门、昆仑上古秘境、蛮荒大山与九幽深渊",
    nodes: [
      { id: "x1", name: "太初仙朝·神都", category: "city", x: 600, y: 380, faction: "大衍仙朝", dangerLevel: "safe", description: "九州枢纽，万道来朝" },
      { id: "x2", name: "太上玄门·纯阳宗", category: "sect", x: 380, y: 200, faction: "太上道宗", dangerLevel: "safe", description: "万载道门领袖，悬空三十三重仙峰" },
      { id: "x3", name: "昆仑遗墟·登仙秘境", category: "secret", x: 220, y: 120, faction: "上古仙族", dangerLevel: "danger", description: "蕴含成仙大道的残缺洞天", resources: "混沌青莲根" },
      { id: "x4", name: "南疆·十万荒山", category: "danger", x: 440, y: 640, faction: "九黎遗族", dangerLevel: "danger", description: "大荒瘴气弥漫，太古凶兽横行" },
      { id: "x5", name: "东海·蓬莱仙岛", category: "natural", x: 880, y: 320, faction: "海外散仙", dangerLevel: "normal", description: "浩瀚汪洋尽头的仙雾海域" },
      { id: "x6", name: "九幽魔域·无间深渊", category: "danger", x: 840, y: 660, faction: "天魔教总坛", dangerLevel: "forbidden", description: "地脉阴煞凝聚之所，群魔乱舞" },
    ],
    edges: [
      { id: "e1", from: "x1", to: "x2", type: "road", label: "白玉通天驿" },
      { id: "e2", from: "x2", to: "x3", type: "secret", label: "虚空暗径" },
      { id: "e3", from: "x1", to: "x5", type: "water", label: "东海海漕" },
      { id: "e4", from: "x1", to: "x4", type: "road", label: "平南官道" },
      { id: "e5", from: "x1", to: "x6", type: "portal", label: "封魔界阵" },
    ]
  },
  {
    name: "⚔️ 西幻大陆与地下城",
    desc: "圣辉王都、奥术法师塔、叹息黑石要塞与地下城裂隙",
    nodes: [
      { id: "w1", name: "圣辉帝国王都", category: "city", x: 500, y: 360, faction: "太阳教会与王室", dangerLevel: "safe", description: "全大陆最辉煌的白石圣都" },
      { id: "w2", name: "逐日奥术法师高塔", category: "sect", x: 300, y: 220, faction: "最高法师评议会", dangerLevel: "safe", description: "悬浮于群山之巅的永恒魔力中枢" },
      { id: "w3", name: "叹息之壁·黑石要塞", category: "fortress", x: 760, y: 320, faction: "帝国重装军团", dangerLevel: "normal", description: "抵御异端北侵的第一防线" },
      { id: "w4", name: "迷雾低语·黑森林", category: "natural", x: 780, y: 560, faction: "荒原德鲁伊", dangerLevel: "danger", description: "古老诅咒笼罩的迷惘森林" },
      { id: "w5", name: "百层裂隙·地下城", category: "danger", x: 920, y: 650, faction: "深渊魔物", dangerLevel: "forbidden", description: "未知层级的古代迷宫" },
    ],
    edges: [
      { id: "we1", from: "w1", to: "w2", type: "portal", label: "法力传送镜" },
      { id: "we2", from: "w1", to: "w3", type: "road", label: "帝国大道" },
      { id: "we3", from: "w3", to: "w4", type: "secret", label: "猎人巡逻道" },
      { id: "we4", from: "w4", to: "w5", type: "barrier", label: "封印门径" },
    ]
  },
  {
    name: "🏯 江湖九州格局",
    desc: "天子神都、江南水乡世家、终南正道与黑木崖魔教",
    nodes: [
      { id: "j1", name: "大炎神都·天子脚下", category: "city", x: 540, y: 380, faction: "朝廷与六扇门", dangerLevel: "safe", description: "皇权威严，九流汇集" },
      { id: "j2", name: "终南之巅·纯阳观", category: "sect", x: 360, y: 240, faction: "正道领袖", dangerLevel: "safe", description: "天下第一道门" },
      { id: "j3", name: "临安府·烟雨江南", category: "town", x: 740, y: 460, faction: "四大家族盟会", dangerLevel: "normal", description: "富甲天下，烟雨繁华" },
      { id: "j4", name: "天下雄关·雁门关", category: "fortress", x: 320, y: 130, faction: "镇北铁骑", dangerLevel: "normal", description: "一夫当关万夫莫开" },
      { id: "j5", name: "黑木崖·魔教总坛", category: "danger", x: 820, y: 220, faction: "日月神教", dangerLevel: "danger", description: "万仞险峰，正道辟易" },
    ],
    edges: [
      { id: "je1", from: "j1", to: "j2", type: "road", label: "官驿官道" },
      { id: "je2", from: "j1", to: "j3", type: "water", label: "京杭运河" },
      { id: "je3", from: "j2", to: "j4", type: "road", label: "边关驰道" },
      { id: "je4", from: "j1", to: "j5", type: "barrier", label: "天险险隘" },
    ]
  }
];

export default function MapEditor() {
  const { id } = useParams<{ id: string }>();
  const novelId = Number(id);
  const navigate = useNavigate();

  // 地图列表与当前地图
  const [maps, setMaps] = useState<MapDocument[]>([]);
  const [currentMapId, setCurrentMapId] = useState<number | null>(null);
  const [mapTitle, setMapTitle] = useState("世界大地图");

  // 本书人物库数据
  const [characters, setCharacters] = useState<Character[]>([]);

  // 地点与连线数据
  const [nodes, setNodes] = useState<LocationNode[]>([]);
  const [edges, setEdges] = useState<RouteEdge[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 画布平移缩放
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // 节点拖拽
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 });

  // 连线模式
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);

  // 选中项与侧边栏
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showNewMapDialog, setShowNewMapDialog] = useState(false);
  const [newMapName, setNewMapName] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);

  // 初始化加载小说地图和人物
  useEffect(() => {
    if (!novelId) return;
    void (async () => {
      try {
        const [mapList, charList] = await Promise.all([
          api.get<MapDocument[]>(`/novels/${novelId}/maps`),
          api.get<Character[]>(`/novels/${novelId}/characters`),
        ]);
        setCharacters(charList || []);
        if (mapList && mapList.length > 0) {
          setMaps(mapList);
          loadMap(mapList[0]);
        } else {
          // 没有地图则自动创建第一张默认地图
          const created = await api.post<MapDocument>(`/novels/${novelId}/maps`, { name: "世界大地图" });
          setMaps([created]);
          loadMap(created, TEMPLATES[0]);
        }
      } catch (e) {
        console.error("加载数据失败", e);
      }
    })();
  }, [novelId]);

  // 载入指定地图文档
  const loadMap = (doc: MapDocument, fallbackTpl?: typeof TEMPLATES[0]) => {
    setCurrentMapId(doc.id);
    setMapTitle(doc.name || "未命名地图");
    setSelectedNodeId(null);
    setSelectedEdgeId(null);

    let parsedNodes: LocationNode[] = [];
    let parsedEdges: RouteEdge[] = [];

    try {
      if (typeof doc.nodes === "string") parsedNodes = JSON.parse(doc.nodes);
      else if (Array.isArray(doc.nodes)) parsedNodes = doc.nodes;
    } catch {}

    try {
      if (typeof doc.edges === "string") parsedEdges = JSON.parse(doc.edges);
      else if (Array.isArray(doc.edges)) parsedEdges = doc.edges;
    } catch {}

    if (parsedNodes.length === 0 && fallbackTpl) {
      setNodes(fallbackTpl.nodes as LocationNode[]);
      setEdges(fallbackTpl.edges as RouteEdge[]);
    } else {
      setNodes(parsedNodes);
      setEdges(parsedEdges);
    }
  };

  // 保存当前地图
  const handleSave = async () => {
    if (!currentMapId) return;
    setSaving(true);
    try {
      await api.patch(`/maps/${currentMapId}`, {
        name: mapTitle,
        nodes: JSON.stringify(nodes),
        edges: JSON.stringify(edges),
        settings: JSON.stringify({ zoom, pan }),
      });
      setMaps(prev => prev.map(m => m.id === currentMapId ? { ...m, name: mapTitle } : m));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 1500);
    } catch (e) {
      console.error("保存失败", e);
    } finally {
      setSaving(false);
    }
  };

  // 画布滚轮缩放
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const nextZoom = Math.min(Math.max(zoom * factor, 0.35), 2.2);
    setZoom(Number(nextZoom.toFixed(2)));
  };

  // 空白区拖拽平移
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target !== containerRef.current && (e.target as HTMLElement).id !== "canvas-bg") return;
    if (e.button === 0 || e.button === 1) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      if (connectingFromId) setConnectingFromId(null);
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
          return {
            ...n,
            x: Math.round(dragStartRef.current.nodeX + dx),
            y: Math.round(dragStartRef.current.nodeY + dy),
          };
        }
        return n;
      }));
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
  };

  // 双击空白处直接新建地点
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== containerRef.current && (e.target as HTMLElement).id !== "canvas-bg") return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const worldX = Math.round((e.clientX - rect.left - pan.x) / zoom);
    const worldY = Math.round((e.clientY - rect.top - pan.y) / zoom);

    addNodeAt(worldX, worldY);
  };

  // 在指定坐标创建地点
  const addNodeAt = (x: number, y: number) => {
    const id = `loc_${Date.now()}`;
    const newNode: LocationNode = {
      id,
      name: `新地点 ${nodes.length + 1}`,
      category: "city",
      x,
      y,
      dangerLevel: "safe",
      characterIds: [],
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };

  // 顶栏添加按钮在视野中心落点
  const handleAddCenter = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width || 800;
    const h = rect?.height || 600;
    const cx = Math.round((w / 2 - pan.x) / zoom);
    const cy = Math.round((h / 2 - pan.y) / zoom);
    addNodeAt(cx, cy);
  };

  // 节点开始拖动或连线
  const handleNodeClick = (e: React.MouseEvent, node: LocationNode) => {
    e.stopPropagation();
    if (connectingFromId) {
      if (connectingFromId !== node.id) {
        // 创建连接
        const newEdge: RouteEdge = {
          id: `edge_${Date.now()}`,
          from: connectingFromId,
          to: node.id,
          type: "road",
          label: "连道",
        };
        setEdges(prev => [...prev, newEdge]);
      }
      setConnectingFromId(null);
      return;
    }

    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setDraggingNodeId(node.id);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      nodeX: node.x,
      nodeY: node.y,
    };
  };

  // 点击连线
  const handleEdgeClick = (e: React.MouseEvent, edge: RouteEdge) => {
    e.stopPropagation();
    setSelectedEdgeId(edge.id);
    setSelectedNodeId(null);
  };

  // 删除节点
  const handleDeleteNode = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id));
    setEdges(prev => prev.filter(e => e.from !== id && e.to !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  // 删除连线
  const handleDeleteEdge = (id: string) => {
    setEdges(prev => prev.filter(e => e.id !== id));
    if (selectedEdgeId === id) setSelectedEdgeId(null);
  };

  // 聚焦到指定地点
  const focusNode = (node: LocationNode) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    const rect = containerRef.current?.getBoundingClientRect();
    const w = rect?.width || 800;
    const h = rect?.height || 600;
    setPan({
      x: -(node.x * zoom) + w / 2,
      y: -(node.y * zoom) + h / 2,
    });
  };

  // 导入模板
  const handleApplyTemplate = (tpl: typeof TEMPLATES[0]) => {
    setNodes(tpl.nodes as LocationNode[]);
    setEdges(tpl.edges as RouteEdge[]);
    setPan({ x: 50, y: 50 });
    setZoom(1);
    setShowTemplateModal(false);
  };

  // 新建独立地图
  const handleCreateNewMap = async () => {
    if (!newMapName.trim()) return;
    try {
      const created = await api.post<MapDocument>(`/novels/${novelId}/maps`, {
        name: newMapName.trim(),
      });
      setMaps(prev => [...prev, created]);
      loadMap(created);
      setShowNewMapDialog(false);
      setNewMapName("");
    } catch (e) {
      console.error("新建地图失败", e);
    }
  };

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const selectedEdge = edges.find(e => e.id === selectedEdgeId);

  return (
    <div className="flex h-screen w-full flex-col bg-stone-950 text-stone-100 overflow-hidden select-none">
      {/* 顶部主导航栏 */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-stone-800 bg-stone-900/90 px-4 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/author/novel/${novelId}`)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-stone-700 bg-stone-800 text-stone-300 hover:bg-stone-700 hover:text-white transition"
            title="返回作品"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {/* 地图切换下拉与重命名 */}
          <div className="flex items-center gap-2">
            <select
              value={currentMapId || ""}
              onChange={(e) => {
                const doc = maps.find(m => m.id === Number(e.target.value));
                if (doc) loadMap(doc);
              }}
              className="rounded-lg border border-stone-700 bg-stone-800/90 px-2.5 py-1 text-xs font-semibold text-stone-100 focus:border-amber-500 focus:outline-none"
            >
              {maps.map(m => (
                <option key={m.id} value={m.id}>{m.name || `地图 #${m.id}`}</option>
              ))}
            </select>

            <input
              type="text"
              value={mapTitle}
              onChange={e => setMapTitle(e.target.value)}
              placeholder="地图名称..."
              className="w-44 rounded-lg border border-transparent hover:border-stone-700 focus:border-amber-500/80 bg-transparent px-2 py-0.5 text-sm font-bold text-stone-100 focus:bg-stone-900 focus:outline-none transition"
            />

            <button
              onClick={() => setShowNewMapDialog(true)}
              className="flex items-center gap-1 rounded-lg border border-stone-700 bg-stone-800 px-2 py-1 text-[11px] text-stone-300 hover:bg-stone-700"
              title="创建一张新地图（如区域细图或副本图）"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              新建地图
            </button>
          </div>
        </div>

        {/* 中间提示与状态 */}
        <div className="hidden md:flex items-center gap-3 text-xs text-stone-400">
          <span>双击画布空白处可快速落点</span>
          <span className="text-stone-600">|</span>
          <span>{nodes.length} 个地点</span>
          <span>{edges.length} 条通路</span>
        </div>

        {/* 快捷操作动作组 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTemplateModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition"
          >
            <Sparkles className="h-3.5 w-3.5" />
            世界模板
          </button>

          <button
            onClick={handleAddCenter}
            className="flex items-center gap-1.5 rounded-lg border border-stone-700 bg-stone-800 px-3 py-1.5 text-xs font-medium text-stone-200 hover:bg-stone-700 transition"
          >
            <Plus className="h-3.5 w-3.5 text-emerald-400" />
            添加地点
          </button>

          {/* 缩放与居中控制 */}
          <div className="flex items-center rounded-lg border border-stone-800 bg-stone-900 px-1 py-0.5">
            <button
              onClick={() => setZoom(z => Math.max(z - 0.15, 0.35))}
              className="p-1 text-stone-400 hover:text-white"
              title="缩小"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 text-xs text-stone-400 min-w-[2.8rem] text-center font-mono">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(z + 0.15, 2.2))}
              className="p-1 text-stone-400 hover:text-white"
              title="放大"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => { setZoom(1); setPan({ x: 50, y: 50 }); }}
              className="p-1 text-stone-400 hover:text-white border-l border-stone-800 ml-0.5"
              title="重置视图"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 transition shadow"
          >
            {saveSuccess ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "保存中..." : saveSuccess ? "已保存" : "保存"}
          </button>
        </div>
      </header>

      {/* 画布与侧边栏主体 */}
      <div className="flex flex-1 relative overflow-hidden">
        {/* 左侧地点树与检索 */}
        <aside className="z-10 flex w-64 shrink-0 flex-col border-r border-stone-800/80 bg-stone-900/90 backdrop-blur">
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
              全部地点 ({nodes.length})
            </div>
            {nodes
              .filter(n => n.name.includes(searchQuery) || (n.faction && n.faction.includes(searchQuery)))
              .map(node => {
                const CatMeta = CATEGORY_MAP[node.category] || CATEGORY_MAP.city;
                const isSelected = selectedNodeId === node.id;
                const residentChars = (node.characterIds || [])
                  .map(cid => characters.find(c => c.id === cid)?.name)
                  .filter(Boolean);

                return (
                  <div
                    key={node.id}
                    onClick={() => focusNode(node)}
                    className={`group flex flex-col gap-1 rounded-lg px-2.5 py-2 text-xs transition cursor-pointer border ${
                      isSelected
                        ? "border-amber-500/60 bg-amber-500/10 text-white"
                        : "border-transparent text-stone-300 hover:bg-stone-800/70"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 truncate">
                        <CatMeta.icon className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span className="font-medium truncate">{node.name}</span>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${DANGER_MAP[node.dangerLevel].tag}`}>
                        {DANGER_MAP[node.dangerLevel].label}
                      </span>
                    </div>

                    {(node.faction || residentChars.length > 0) && (
                      <div className="flex items-center gap-1.5 text-[10px] text-stone-400 truncate pl-5">
                        {node.faction && <span className="text-stone-300 truncate">{node.faction}</span>}
                        {residentChars.length > 0 && (
                          <span className="text-amber-400/80 truncate">· {residentChars.join(", ")}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            {nodes.length === 0 && (
              <div className="p-4 text-center text-xs text-stone-500">
                暂无地点，点击上方“世界模板”导入或双击画布空白处新增。
              </div>
            )}
          </div>
        </aside>

        {/* 画布核心交互区 (GPU 变换渲染) */}
        <main
          ref={containerRef}
          id="canvas-bg"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onWheel={handleWheel}
          className={`flex-1 relative overflow-hidden bg-stone-950 ${
            isPanning ? "cursor-grabbing" : "cursor-default"
          }`}
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)`,
            backgroundSize: `${28 * zoom}px ${28 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
        >
          {/* 画布平移缩放视口 */}
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
            {/* 连线 SVG 层 */}
            <svg
              className="absolute left-0 top-0 overflow-visible pointer-events-none"
              style={{ width: "10000px", height: "10000px" }}
            >
              {edges.map(edge => {
                const fromNode = nodes.find(n => n.id === edge.from);
                const toNode = nodes.find(n => n.id === edge.to);
                if (!fromNode || !toNode) return null;

                const style = ROUTE_TYPES[edge.type] || ROUTE_TYPES.road;
                const isSelected = selectedEdgeId === edge.id;
                const midX = (fromNode.x + toNode.x) / 2;
                const midY = (fromNode.y + toNode.y) / 2;

                return (
                  <g key={edge.id}>
                    {/* 响应点击的高灵敏透明加粗线 */}
                    <line
                      x1={fromNode.x}
                      y1={fromNode.y}
                      x2={toNode.x}
                      y2={toNode.y}
                      stroke="transparent"
                      strokeWidth={16}
                      className="pointer-events-auto cursor-pointer"
                      onClick={(e) => handleEdgeClick(e, edge)}
                    />
                    {/* 可视路线 */}
                    <line
                      x1={fromNode.x}
                      y1={fromNode.y}
                      x2={toNode.x}
                      y2={toNode.y}
                      stroke={isSelected ? "#f59e0b" : style.stroke}
                      strokeWidth={isSelected ? 3 : 2}
                      strokeDasharray={style.dash}
                      className="pointer-events-none transition-colors"
                    />
                    {/* 路线标签 */}
                    {edge.label && (
                      <text
                        x={midX}
                        y={midY - 8}
                        fill={isSelected ? "#f59e0b" : "#cbd5e1"}
                        fontSize={11}
                        textAnchor="middle"
                        className="font-medium drop-shadow select-none pointer-events-auto cursor-pointer"
                        onClick={(e) => handleEdgeClick(e, edge)}
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* 正在连线时的动态虚线引导 */}
              {connectingFromId && (() => {
                const s = nodes.find(n => n.id === connectingFromId);
                if (!s) return null;
                return (
                  <circle cx={s.x} cy={s.y} r={32} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="4,4" className="animate-spin" />
                );
              })()}
            </svg>

            {/* 地点卡片节点层 */}
            {nodes.map(node => {
              const CatMeta = CATEGORY_MAP[node.category] || CATEGORY_MAP.city;
              const isSelected = selectedNodeId === node.id;
              const isConnectingTarget = connectingFromId !== null && connectingFromId !== node.id;
              const isConnectingSource = connectingFromId === node.id;

              // 计算该地点驻留的角色
              const residentChars = (node.characterIds || [])
                .map(cid => characters.find(c => c.id === cid))
                .filter(Boolean) as Character[];

              return (
                <div
                  key={node.id}
                  onMouseDown={e => handleNodeClick(e, node)}
                  style={{
                    position: "absolute",
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                  className={`group select-none rounded-xl border p-3 shadow-xl backdrop-blur transition-all ${
                    isSelected
                      ? "border-amber-400 bg-stone-900/95 ring-2 ring-amber-500/50 z-30 scale-105"
                      : "border-stone-700/80 bg-stone-900/85 hover:border-stone-500 z-10"
                  } ${
                    isConnectingSource ? "ring-2 ring-amber-400 animate-pulse z-30" : ""
                  } ${
                    isConnectingTarget ? "hover:ring-2 hover:ring-emerald-400 cursor-crosshair" : "cursor-move"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${CatMeta.color}`}>
                      <CatMeta.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-[120px]">
                      <div className="text-sm font-bold text-stone-100 flex items-center justify-between gap-2">
                        <span>{node.name}</span>
                        <span className={`text-[10px] px-1 py-0.2 rounded font-normal ${DANGER_MAP[node.dangerLevel].tag}`}>
                          {DANGER_MAP[node.dangerLevel].label}
                        </span>
                      </div>
                      <div className="text-[11px] text-stone-400 font-medium truncate mt-0.5">
                        {node.faction || "未划分势力"}
                      </div>
                    </div>
                  </div>

                  {/* 驻扎人物头像标签 */}
                  {(residentChars.length > 0 || node.customCharacters) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-stone-800 pt-1.5">
                      <Users className="h-3 w-3 text-stone-500" />
                      {residentChars.map(c => (
                        <span
                          key={c.id}
                          className="rounded bg-stone-800/80 px-1.5 py-0.5 text-[10px] text-amber-300 font-medium"
                        >
                          {c.name}
                        </span>
                      ))}
                      {node.customCharacters && (
                        <span className="rounded bg-stone-800/80 px-1.5 py-0.5 text-[10px] text-stone-300 font-medium">
                          {node.customCharacters}
                        </span>
                      )}
                    </div>
                  )}

                  {/* 悬停快捷建立连线按钮 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConnectingFromId(connectingFromId === node.id ? null : node.id);
                    }}
                    className={`absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition shadow-md ${
                      isConnectingSource
                        ? "border-amber-400 bg-amber-500 text-stone-950 font-bold"
                        : "border-stone-600 bg-stone-800 text-stone-300 opacity-0 group-hover:opacity-100 hover:bg-stone-700 hover:text-white"
                    }`}
                    title="点击连接到另一地点"
                  >
                    <Link2 className="h-3 w-3" />
                    {isConnectingSource ? "连线中..." : "连线"}
                  </button>
                </div>
              );
            })}
          </div>
        </main>

        {/* 右侧属性详细编辑面板 */}
        {selectedNode && (
          <aside className="z-10 flex w-80 shrink-0 flex-col border-l border-stone-800 bg-stone-900/95 p-4 backdrop-blur overflow-y-auto">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-bold text-stone-200">地点详情与设定</h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDeleteNode(selectedNode.id)}
                  className="rounded p-1 text-stone-500 hover:bg-rose-500/20 hover:text-rose-400 transition"
                  title="删除此地点"
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

            <div className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-stone-400 mb-1 font-medium">地点名称</label>
                <input
                  type="text"
                  value={selectedNode.name}
                  onChange={e => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, name: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-1.5 text-stone-100 focus:border-amber-500 focus:outline-none font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-stone-400 mb-1 font-medium">地理类型</label>
                  <select
                    value={selectedNode.category}
                    onChange={e => {
                      const val = e.target.value as LocationNode["category"];
                      setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, category: val } : n));
                    }}
                    className="w-full rounded-lg border border-stone-800 bg-stone-950 px-2.5 py-1.5 text-stone-200 focus:border-amber-500 focus:outline-none"
                  >
                    {Object.entries(CATEGORY_MAP).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-stone-400 mb-1 font-medium">危险程度</label>
                  <select
                    value={selectedNode.dangerLevel}
                    onChange={e => {
                      const val = e.target.value as LocationNode["dangerLevel"];
                      setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, dangerLevel: val } : n));
                    }}
                    className="w-full rounded-lg border border-stone-800 bg-stone-950 px-2.5 py-1.5 text-stone-200 focus:border-amber-500 focus:outline-none"
                  >
                    {Object.entries(DANGER_MAP).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">所属统治势力 / 宗派家族</label>
                <input
                  type="text"
                  placeholder="如：大衍神朝、太上道宗"
                  value={selectedNode.faction || ""}
                  onChange={e => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, faction: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-1.5 text-stone-200 focus:border-amber-500 focus:outline-none"
                />
              </div>

              {/* 驻扎角色选择（联动本书真实人物库） */}
              <div>
                <label className="block text-stone-400 mb-1 font-medium">
                  驻扎人物（来自本书人物库）
                </label>
                {characters.length > 0 ? (
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-stone-800 bg-stone-950 p-2 space-y-1">
                    {characters.map(c => {
                      const isChecked = (selectedNode.characterIds || []).includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center gap-2 text-stone-300 hover:text-white cursor-pointer py-0.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              const cur = selectedNode.characterIds || [];
                              const next = isChecked ? cur.filter(id => id !== c.id) : [...cur, c.id];
                              setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, characterIds: next } : n));
                            }}
                            className="rounded border-stone-700 bg-stone-900 text-amber-500 focus:ring-0"
                          />
                          <span className="truncate">{c.name}</span>
                          {c.role && <span className="text-[10px] text-stone-500">({c.role})</span>}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-stone-500 bg-stone-950 p-2 rounded-lg border border-stone-800">
                    当前作品尚未创建人物，可先去人物库创建。
                  </div>
                )}
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">其他关键人物（文本补充）</label>
                <input
                  type="text"
                  placeholder="补充其他散客或NPC..."
                  value={selectedNode.customCharacters || ""}
                  onChange={e => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, customCharacters: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-1.5 text-stone-200 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">地脉特色 / 盛产宝物</label>
                <input
                  type="text"
                  placeholder="如：九天灵晶矿脉、千年紫灵芝"
                  value={selectedNode.resources || ""}
                  onChange={e => {
                    const val = e.target.value;
                    setNodes(prev => prev.map(n => n.id === selectedNode.id ? { ...n, resources: val } : n));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-1.5 text-stone-200 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">地形与剧情设定</label>
                <textarea
                  rows={4}
                  placeholder="描写地形险要程度、气候特征与关键剧情背景..."
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

        {/* 选中连线编辑面板 */}
        {selectedEdge && (
          <aside className="z-10 flex w-72 shrink-0 flex-col border-l border-stone-800 bg-stone-900/95 p-4 backdrop-blur">
            <div className="flex items-center justify-between border-b border-stone-800 pb-3">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-bold text-stone-200">编辑路线</h3>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDeleteEdge(selectedEdge.id)}
                  className="rounded p-1 text-stone-500 hover:bg-rose-500/20 hover:text-rose-400 transition"
                  title="删除路线"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setSelectedEdgeId(null)}
                  className="rounded p-1 text-stone-500 hover:bg-stone-800 hover:text-stone-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block text-stone-400 mb-1 font-medium">路线描述 / 距离</label>
                <input
                  type="text"
                  placeholder="如：官驿大道、行船三日、虚空传送"
                  value={selectedEdge.label || ""}
                  onChange={e => {
                    const val = e.target.value;
                    setEdges(prev => prev.map(ed => ed.id === selectedEdge.id ? { ...ed, label: val } : ed));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-1.5 text-stone-200 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-stone-400 mb-1 font-medium">通路类型</label>
                <select
                  value={selectedEdge.type}
                  onChange={e => {
                    const val = e.target.value as RouteEdge["type"];
                    setEdges(prev => prev.map(ed => ed.id === selectedEdge.id ? { ...ed, type: val } : ed));
                  }}
                  className="w-full rounded-lg border border-stone-800 bg-stone-950 px-2.5 py-1.5 text-stone-200 focus:border-amber-500 focus:outline-none"
                >
                  {Object.entries(ROUTE_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* 世界观模板导入弹窗 */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-stone-800 bg-stone-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-stone-800">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                <h3 className="text-base font-bold text-stone-100">选择世界地理预设</h3>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="rounded p-1 text-stone-400 hover:bg-stone-800 hover:text-stone-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-2 text-xs text-stone-400 leading-relaxed">
              一键导入经典小说世界地理框架，包含核心主城、宗派、禁忌险地及通路连线：
            </p>

            <div className="mt-4 space-y-3">
              {TEMPLATES.map((tpl, i) => (
                <div
                  key={i}
                  onClick={() => handleApplyTemplate(tpl)}
                  className="group flex flex-col gap-1 rounded-xl border border-stone-800 bg-stone-950 p-3.5 transition hover:border-amber-500/50 hover:bg-stone-800/40 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-stone-200 group-hover:text-amber-400 transition text-sm">
                      {tpl.name}
                    </span>
                    <span className="text-[11px] text-stone-500">
                      {tpl.nodes.length} 个地点
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

      {/* 新建地图弹窗 */}
      {showNewMapDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-stone-800 bg-stone-900 p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-stone-100 mb-3">创建新地图</h3>
            <input
              type="text"
              placeholder="如：中州细图、宗门后山秘境..."
              value={newMapName}
              onChange={e => setNewMapName(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-xs text-stone-100 focus:border-amber-500 focus:outline-none"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowNewMapDialog(false)}
                className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800"
              >
                取消
              </button>
              <button
                onClick={handleCreateNewMap}
                className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
