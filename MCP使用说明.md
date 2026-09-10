# 起笔 (NovelForge) · Model Context Protocol (MCP) 使用说明

本平台已内置完整的 **Model Context Protocol (MCP)** 服务，支持 **Claude Code**、**AstrBot**、**Claude Desktop**、**Cursor**、**Windsurf**、**Cline / Roo Code**、**Dify / FastGPT** 等所有支持 MCP 协议的 AI Agent 工具连接与自动化管理。

---

## 🌟 MCP 赋予 Agent 的全部能力（共 25 项 Tools + 3 项 Prompts）

通过 MCP 连接后，外部 Agent 可直接调度以下专业能力：

### 1. 小说作品管理
- `novelforge_list_novels`: 获取书库全部小说列表（ID、书名、作者、类型、总字数、连载状态、更新时间）。
- `novelforge_get_novel`: 获取指定小说的完整详情与章节统计。
- `novelforge_create_novel`: 自动新建一部小说作品。
- `novelforge_update_novel`: 修改小说书名、简介、分类、连载状态。
- `novelforge_delete_novel`: 删除小说项目（支持防误删二次确认）。

### 2. 章节全生命周期管理
- `novelforge_list_chapters`: 获取小说的完整章节目录树。
- `novelforge_get_chapter`: 读取指定章节的全部正文与字数。
- `novelforge_create_chapter`: 自动创建新章节（支持直接填入正文并计算中文字数）。
- `novelforge_update_chapter`: 修改正文、标题或发布状态（**自动创建历史版本备份**）。
- `novelforge_delete_chapter`: 删除指定章节。
- `novelforge_list_chapter_revisions`: 查看章节历史版本快照列表。
- `novelforge_restore_chapter_revision`: 一键回滚/恢复正文至指定历史版本。

### 3. 细纲与大纲规划
- `novelforge_get_outlines`: 获取小说的大纲/细纲节点列表。
- `novelforge_update_outline`: 新增或更新细纲条目（支持与特定章节绑定）。

### 4. 角色设定库（人设卡）
- `novelforge_list_characters`: 获取小说全部角色库。
- `novelforge_get_character`: 获取单个角色的人设卡卡片（外貌、性格、背景、金手指、人际关系）。
- `novelforge_create_character`: 为小说新增角色设定。
- `novelforge_update_character`: 更新角色设定。
- `novelforge_delete_character`: 删除角色设定。

### 5. 世界观设定与地图
- `novelforge_get_world_map`: 获取世界观架构、地理分布与势力关系数据。
- `novelforge_update_world_map`: 结构化更新世界观与地图节点。

### 6. 创作备忘与伏笔追踪 (Foreshadowing)
- `novelforge_get_writer_state`: 获取小说的写作进度笔记与草蛇灰线伏笔追踪清单。
- `novelforge_update_writer_state`: 登记或标记已埋设/已收回的伏笔。

### 7. 导出与全局检索
- `novelforge_export_novel`: 将整部小说（含大纲、人设卡、所有正文章节）一键导出为标准排版的 Markdown 或 TXT 文本。
- `novelforge_search`: 全局跨章节、人设、大纲深度关键词检索。

### 8. 网文特色 Prompt 模板
- `deslop_text`: 7 Gate 门禁网文去 AI 味精修提示词。
- `review_chapter`: 资深主编 + 挑剔老读者双重视角对抗式找茬审查提示词。
- `analyze_chapter`: 爆款小说故事核与黄金三章结构拆解提示词。

---

## 🚀 导入与连接方式

### 方案一：在 Claude Code 中直接使用（已自动配置）

本项目根目录已自动生成 `.mcp.json`，在终端运行 Claude Code 时即可自动识别：

```bash
# 若需手动添加至全局 Claude Code 配置：
claude mcp add novelforge node "C:\Users\Administrator\Desktop\xm\XXS\mcp\server.mjs"
```

---

### 方案二：在 AstrBot (AstrBot Agent) 中配置导入

AstrBot 支持 **Stdio 本地模式** 与 **SSE 网络模式** 两种方式：

#### 1. 本地 Stdio 模式（推荐，无需后台常驻网页服务）
在 AstrBot 的 MCP 配置文件中加入：
```json
{
  "novelforge": {
    "type": "stdio",
    "command": "node",
    "args": [
      "C:\\Users\\Administrator\\Desktop\\xm\\XXS\\mcp\\server.mjs"
    ],
    "env": {
      "DATA_DIR": "C:\\Users\\Administrator\\Desktop\\xm\\XXS\\data"
    }
  }
}
```

#### 2. SSE 网络模式（适用于起笔服务器正在运行时远程调用）
若你的起笔平台正在运行（如 `npm run start` 或便携版正在监听 `http://127.0.0.1:3000` 或局域网 IP）：
在 AstrBot 中添加 MCP SSE 服务端点：
- **SSE 端点 URL**：`http://127.0.0.1:3000/api/mcp/sse`
- **消息发送端点**：`http://127.0.0.1:3000/api/mcp/messages`

---

### 方案三：在 Claude Desktop 官方桌面端中配置

打开配置文件 `%APPDATA%\Claude\claude_desktop_config.json`（可直接拷贝根目录下的 `claude_desktop_config.json` 内容）：

```json
{
  "mcpServers": {
    "起笔-小说创作平台": {
      "command": "node",
      "args": [
        "C:\\Users\\Administrator\\Desktop\\xm\\XXS\\mcp\\server.mjs"
      ],
      "env": {
        "DATA_DIR": "C:\\Users\\Administrator\\Desktop\\xm\\XXS\\data"
      }
    }
  }
}
```

---

### 方案四：在 Cursor / Windsurf / VS Code (Cline / Roo Code) 中使用

在对应编辑器的 MCP 设置面板或 `mcpServers` JSON 中添加：

```json
{
  "mcpServers": {
    "novelforge": {
      "command": "node",
      "args": [
        "C:\\Users\\Administrator\\Desktop\\xm\\XXS\\mcp\\server.mjs"
      ]
    }
  }
}
```

---

## 🛠️ 测试与验证

可在终端执行以下指令快速验证 MCP 服务响应：

```bash
node mcp/server.mjs
```

服务将通过标准输入输出 (Stdio) 监听并响应 JSON-RPC 2.0 协议。
如需指定数据库存放路径或多用户身份，可通过环境变量传入：
- `DATA_DIR`: 自定义 SQLite 数据库所在目录
- `NOVELFORGE_USER_ID`: 默认操作的用户 ID（默认 1）
- `NOVELFORGE_USERNAME`: 默认操作的用户名
