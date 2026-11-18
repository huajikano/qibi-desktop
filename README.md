# 起笔 (QiBi) · AI 辅助小说创作工作台

<p align="center">
  <b>专为百万字长篇网络小说打造的本地优先创作与阅读平台</b><br/>
  分层动态记忆 · 管家 Agent · 世界观地图 · 知识库 RAG · 作者风格蒸馏
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.2.6-blue" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green" />
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20x64-lightgrey" />
  <img alt="node" src="https://img.shields.io/badge/node-%3E%3D24-brightgreen" />
</p>

---

## 📖 这是什么

「起笔」是一款 **本地优先（local-first）** 的中文小说创作工作台。创作数据 100% 存在你自己电脑的 SQLite 里，AI 则通过你自己配置的 API Key 调用——素材不上传任何第三方服务器。

它有两种运行形态：

| 模式 | 适用场景 | 形态 |
|---|---|---|
| **单机写作版** | 一个人安静写书 | Windows 便携版 EXE，双击即用 |
| **公网多作者版** | 多人协作、手机平板接入 | 同一套程序 + Cloudflare 隧道 + 图形化控制台 |

---

## ✨ 核心能力

### ✍️ 创作工作台
- **三栏布局**：作品总纲 / CodeMirror 正文编辑器 / 章节树与本章细纲，左右栏宽度可拖拽
- **1.5 秒防抖自动保存**，静默落库不打断心流
- **中文小说排版**：段落自动首行缩进 2 字符，一键规范全章排版
- **6 套编辑器配色**（暗夜 / 纸黄 / 象牙 / 墨韵 / 复古 / 焦糖），支持自定义前景背景色
- **沉浸模式** `Alt + F`：自动收起左右栏，编辑器居中放大
- **查找替换**：支持正则与大小写敏感，`Enter` / `Shift + Enter` 跳转
- **移动端自适应**：手机访问自动切换 Tab 布局（正文 / 细纲 / 总纲）

### 🕒 版本安全网
- 每次 AI 改写、版本恢复前**自动全量快照**
- 每章保留最近 **50 个**历史版本
- AI 完成后顶部浮现「一键撤回上个版本」
- 历史版本抽屉：时间轴 + 内容预览 + 一键恢复

### 🤖 AI 创作引擎

13 种任务模式：

| 类别 | 模式 |
|---|---|
| 正文 | 按细纲生成 · 智能续写 · 去 AI 味（7 Gate） · 润色 · 扩写 |
| 选区 | 润色选区 · 扩写选区（流式预览后应用替换） |
| 分析 | 对抗式审查 · 爆款拆文 · 章节摘要 · 细纲建议 · 剧情顾问 |

### 🧠 长篇连贯性记忆
- **分层记忆**：全书梗概 → 分卷大纲 → 章节微摘要 → 前情提要链
- **角色动态账本**：实时追踪境界修为、当前位置、持有法宝、伤病状态
- **知识库 RAG**：BM25 检索最相关片段，长篇不必全塞进上下文

### 🗺️ 世界观与人物
- **人物库**：称号 / 定位 / 性格 / 外貌 / 背景 / 关系网
- **AI 提取角色**：通读正文自动挖掘登场人物，交互式审核后批量导入
- **地图编辑器**：多图层画布，势力领地 / 名城关隘 / 山川要道 / 人物据点
- **AI 完善地图**：从正文提炼地理要素并分配合理坐标

### 🎭 作者风格蒸馏
- 导入 TXT / EPUB / Markdown 长文材料（分片上传，单文件可达 100MB）
- 提炼 **writing skill**（写作技巧）+ **author persona**（语言人格）
- 版本管理与回滚，支持「追加进化」
- 写作时自动代入蒸馏出的文风

### 🤝 双向外接
- **对内**：内置 MCP 服务端，25 个工具 + 3 个 Prompt 模板，可被 Claude Code / Cursor / Cline 等调用
- **对外**：可连接外部 MCP 服务器，其工具以 `ext:` 前缀并入管家 Agent 工具池

---

## 🚀 快速开始

### 方式一：下载便携版（推荐）

前往 [Releases](https://github.com/huajikano/qibi-desktop/releases/latest)：

| 产物 | 说明 |
|---|---|
| `起笔-1.2.6-portable.exe` | 单机写作版，双击启动 |
| `起笔-公网服务器-1.2.6-portable.exe` | 公网多作者版，内置 Cloudflare 隧道控制台 |

> 无需安装 Node.js、无需数据库服务。数据存于 `%APPDATA%\起笔\data\`。

**首次进入**：默认管理员 `admin` / `admin123456`，**请立即修改密码**。

### 方式二：从源码运行

**环境要求**：Node.js **≥ 24**（依赖内置 `node:sqlite`，无需编译原生模块）

```bash
git clone https://github.com/huajikano/qibi-desktop.git
cd qibi-desktop
npm install
```

开发模式需两个终端：

```bash
# 终端一：后端 API（默认 http://localhost:3000）
npm run dev:server

# 终端二：前端（默认 http://localhost:5173，已代理 /api）
npm run dev:web
```

健康检查：`http://localhost:3000/api/health` → `{"ok":true}`

---

## 🔧 配置 AI 接口

进入 **设置** 页面，AI 配置分为 **四路独立通道**，可分别指定服务商、网关、协议与模型：

| 通道 | 用途 | 回退行为 |
|---|---|---|
| **小说写作助手** | 草稿生成、续写、润色、扩写、细纲规划等高频任务 | — |
| **管家 Agent** | 多步自主操作的智能体（28 个内置工具） | 未配置时回退写作助手 |
| **角色与地图** | 人物提取与地图完善（一次性重任务） | 未配置时回退写作助手 |
| **蒸馏作者** | 百万字材料深度剖析，建议用长上下文模型 | 独立配置，不回退 |

每路通道可填四项：

- **API Key** — 大模型服务商密钥
- **Base URL** — 实际接口地址（**不是官网**），如 `https://api.deepseek.com/v1`
- **协议** — `Anthropic 原生`（`/v1/messages`）或 `OpenAI 兼容`（`/chat/completions`）；选 `auto` 时按 Base URL 是否以 `/v1` 结尾自动推断
- **模型** — 具体模型标识，如 `deepseek-chat`、`claude-sonnet-4-5`

**保存方式**：

- **持久保存** — AES-256-GCM 加密写入数据库，重启仍可用
- **仅本次会话** — 只存内存，关进程即失效，更私密

> 🔐 密钥用 `SESSION_SECRET` 派生密钥加密。桌面版首次启动会在数据目录生成 `.session-secret` 并长期复用，故重启后密钥依然有效；服务器部署请显式设置 `SESSION_SECRET`。

---

## 📚 使用教程

### 第一步：建作品

「我的书架」→ 新建作品，填书名、类型（玄幻/都市/历史/科幻/仙侠/悬疑/言情）、简介。

**可见性**：`🌐 公开` 会出现在首页书库供读者阅读；`🔒 私密` 彻底隐藏，仅作者可见。书架卡片与写作台顶栏均可一键切换。

### 第二步：搭骨架

1. **作品总纲** — 左栏写下主线、核心冲突、世界观要点
2. **新建章节** — 右栏章节树，支持上移/下移调节顺序
3. **本章细纲** — 为每章单独挂细纲，AI 生成时会严格对齐

### 第三步：写正文

| 方式 | 操作 |
|---|---|
| **自己写** | 直接在编辑器敲，1.5 秒后自动保存 |
| **AI 起草** | 顶栏「创作助手」→ 选「按细纲生成正文」→ 流式输出 |
| **选区加工** | 选中文字 → 右键 → AI 润色选区 / AI 扩写选区 → 预览满意后「应用替换」 |

### 第四步：保证长篇不崩

1. **章节微摘要** — 每章写完提炼「核心剧情 / 关键事件 / 章末钩子」，串成前情提要链
2. **角色动态账本** — 记录角色此刻的境界、位置、持有物、伤病，避免前后矛盾
3. **知识库检索** — 顶栏「知识库」重建索引后，AI 生成时用 BM25 检索最相关片段，而非硬塞全书

### 第五步：管住版本

- AI 改写前后自动备份原版本
- 顶栏「历史版本」抽屉：左侧时间轴（备份原因、时间、字数），右侧预览，点「恢复此版本」回滚
- 生成完成后顶部有快捷提示条，可一键撤回

### 第六步（可选）：蒸馏作者风格

1. 「蒸馏作者」页面上传参考材料（TXT / EPUB / Markdown）
2. 点击蒸馏，AI 提取写作技巧与语言人格
3. 回写作台，在「作者风格 Skill」下拉选中它
4. 之后 AI 生成正文自动代入该风格

> ⚠️ 请只使用你自己拥有版权或已获授权的材料。

---

## 🤖 管家 Agent

写作台右侧「管家 Agent」标签页，输入自然语言任务，Agent 多步自主调用工具完成。

**28 个内置工具**：

| 分类 | 工具 |
|---|---|
| 作品 | `list_novels` `get_novel` `list_chapters` `get_chapter` `create_chapter` `update_chapter` `delete_chapter` |
| 大纲 | `list_outlines` `create_outline` `update_outline` `delete_outline` |
| 人物 | `list_characters` `create_character` `update_character` `delete_character` |
| 记忆 | `get_chapter_summary` `update_chapter_summary` `get_character_states` `update_character_state` `list_volumes` |
| 进度 | `get_writer_state` `update_writer_state` |
| 知识库 | `kb_index_novel` `kb_query` `kb_stats` |
| 地图 | `list_maps` `create_map_location` |
| 生成 | `ai_draft`（draft / continue / deslop / polish / expand） |

特性：

- **逐请求隔离配置** — 公网多作者并发时密钥与端点互不干扰
- **步数上限** — 默认 10 步，可调至 20，防无限循环
- **实时可见** — SSE 流式推送每一步工具调用与结果
- **可中途中断** — 关闭页面即 abort

---

## 🔌 MCP 集成

起笔对外提供 **MCP（Model Context Protocol）** 服务，可接入 Claude Code、Claude Desktop、Cursor、Cline、AstrBot 等任意 MCP 客户端。

**25 个工具 + 3 个 Prompt 模板**：

- **作品/章节**：查询、创建、更新、删除、版本回滚、导出
- **大纲/人物/地图/伏笔**：完整 CRUD
- **全局检索**：跨章节、人设、大纲的关键词搜索
- **Prompt 模板**：`deslop_text`（7 Gate 去 AI 味）、`review_chapter`（对抗式审查）、`analyze_chapter`（爆款拆文）

```bash
# 方式 A：Stdio 本地模式（需先构建后端）
npm run build -w server
node mcp/server.mjs

# 方式 B：SSE 网络模式（起笔服务运行时）
# SSE 端点:  http://127.0.0.1:3000/api/mcp/sse
# 消息端点:  http://127.0.0.1:3000/api/mcp/messages
```

Claude Desktop / Cursor 配置示例：

```json
{
  "mcpServers": {
    "novelforge": {
      "command": "node",
      "args": ["/path/to/qibi-desktop/mcp/server.mjs"],
      "env": { "DATA_DIR": "/path/to/qibi-desktop/data" }
    }
  }
}
```

> 各客户端详细配置见 [MCP使用说明.md](MCP使用说明.md)。

---

## 🛠️ 构建打包

```bash
# 类型检查 + 前端构建
npm run build

# 单机写作版便携 EXE
npm run build:exe
# → desktop/release/起笔-1.2.6-portable.exe

# 公网服务器版便携 EXE（内置 Cloudflare 隧道）
npm run build:server-exe
# → desktop/release/起笔-公网服务器-1.2.6-portable.exe
```

**公网服务器版**特性：

- 双击后监听 `0.0.0.0:3000`（占用时自动选空闲端口）
- 自动拉起 cloudflared 隧道，控制台实时显示 `https://xxx.trycloudflare.com`
- 展示局域网 IP，手机同 WiFi 直连
- 一键重启隧道 / 一键打开数据目录

---

## 🧪 测试

```bash
npm test              # 全量测试
npm run test:prompts  # 仅提示词相关
```

当前覆盖提示词注册表与渲染层（6 个用例）。测试细节与**未覆盖范围**见 [docs/TESTING.md](docs/TESTING.md)。

---

## 📂 项目结构

```
qibi-desktop/
├── web/                  React 18 + Vite + Tailwind v4 + CodeMirror 6
│   └── src/pages/        首页 / 阅读器 / 书架 / 写作台 / 人物库 / 地图 / 蒸馏 / 设置
├── server/               Express + TypeScript + node:sqlite
│   ├── src/routes/       REST + SSE 端点
│   ├── src/prompts/      提示词注册表（由 prompts/*.md 生成）
│   └── src/{agent,kb,mcp,db,auth}.ts
├── desktop/              Electron 壳 + electron-builder 打包
├── prompts/              提示词源文件（frontmatter + {{变量}}）
├── mcp/server.mjs        MCP stdio 启动器
├── tests/                node:test 用例
└── docs/                 架构审计 / 目标架构 / ADR / 测试说明
```

**技术选型要点**：

- `node:sqlite`（Node 24 内置）—— 零原生依赖，无需 node-gyp
- 会话存内存 + 数据存 SQLite —— 无 Redis 等外部服务
- 同一份构建产物同时支撑单机与公网两种模式
- 提示词外置 Markdown，构建时生成 TS 注册表，测试保证与基线逐字符一致

---

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 服务监听端口 |
| `HOST` | `0.0.0.0` | 监听地址；桌面单机模式自动设为 `127.0.0.1` |
| `DATA_DIR` | `./data` | SQLite 与上传材料存放目录 |
| `SESSION_SECRET` | 首次随机生成 | 会话签名 + API Key 加密密钥，**生产环境务必显式设置** |
| `WEB_DIST` | 自动探测 | 前端构建产物路径 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123456` | 首次启动创建的初始管理员 |
| `ANTHROPIC_API_KEY` | 空 | 站方共享 Key（默认仅管理员可用） |
| `ANTHROPIC_BASE_URL` | 空 | 站方共享端点 |
| `AI_MODEL` | `claude-sonnet-4-5` | 站方默认模型 |
| `AI_DAILY_LIMIT` | `50` | 站方 Key 每日上限 |
| `ALLOW_PUBLIC_STATION_KEY` | `false` | 设为 `true` 允许普通用户用站方 Key |

---

## ❓ 常见问题

**Q：启动后页面只有背景色？**
先确认后端已起：访问 `http://localhost:3000/api/health`，返回 `{"ok":true}` 再刷新前端。

**Q：AI 返回 401 / 403？**
API Key 无效、过期或权限不足，也可能是协议选错（Anthropic Key 配了 OpenAI 协议）。

**Q：AI 返回 404？**
Base URL 填成了官网地址。需填实际接口地址，如 `http://127.0.0.1:15721/v1`，并确认 `/v1` 与协议匹配。

**Q：AI 返回 429？**
上游限流或站方每日额度用尽，稍后重试或更换网关。

**Q：重启后保存的 API Key 失效？**
1.2.4 起已修复（会话密钥持久化）。若仍复现，检查数据目录可写、`SESSION_SECRET` 是否被外部改动。

**Q：右键菜单没弹出来？**
需先用鼠标选中文本；未选中时保留浏览器原生菜单。

**Q：数据存在哪？**
桌面版：`%APPDATA%\起笔\data\novelforge.db`；服务器版：优先 `E:\起笔-公网服务器数据\data\`，无 E 盘则 D 盘，可由 `DATA_DIR` 覆盖。删除前请先备份。

---

## 🗺️ 路线图

详见 [docs/ARCHITECTURE-TARGET.md](docs/ARCHITECTURE-TARGET.md) 与 [docs/OPTIMIZATION-REPORT.md](docs/OPTIMIZATION-REPORT.md)。

- [ ] `LlmClient` 端口抽象 + `FakeLlm`，实现无密钥离线跑通全流程
- [ ] 拆分 `ai.ts` 与 `Workspace.tsx` 巨型模块
- [ ] 补齐路由、鉴权、SSE、数据库层测试覆盖
- [ ] 剩余 10 条提示词外置
- [ ] 统一 `config/` 配置入口
- [ ] 应用图标与代码签名

---

## 🤝 参与贡献

```bash
git checkout -b feature/你的功能      # 从最新 main 切
# ... 改动 ...
npm run build                         # 通过类型检查与构建
npm test                              # 通过测试
git commit -m "feat: 简明描述"
git push -u origin feature/你的功能   # 然后开 PR
```

提交信息建议遵循 Conventional Commits：`feat:` / `fix:` / `refactor:` / `perf:` / `docs:` / `chore:`。
改动提示词时请跑 `npm run prompts:build` 重新生成注册表。

---

## 📄 许可证

[MIT License](LICENSE) · 以笔为舟，渡万里山河。
