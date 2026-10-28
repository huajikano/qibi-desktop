# ARCHITECTURE-AUDIT 现状审计

- 审计对象：`huajikano/qibi-desktop`，commit `9df3827`（v1.2.4 发布态），工作副本 `_work/qibi-desktop`
- 审计日期：2026-10-29
- 审计方法：静态阅读 + `git grep`/`Select-String` 精确定位 + `tsc` 编译验证 + 实机启动

## 0. 与任务书假设的差异（重要）

| 任务书假设 | 实际情况 | 影响 |
|---|---|---|
| 项目位于 `D:\XiangMu\插件制作\审批起笔` | 该目录只是工作区，真实项目在 `_work\qibi-desktop` | 所有命令以 `_work\qibi-desktop` 为根执行 |
| 「该目录当前不是 git 仓库」 | 根目录确实不是；**项目本身是 git 仓库，origin 指向 GitHub，已有 v1.0.0–v1.2.4 tag** | 「先建版本控制」已天然满足，改为打 `baseline-1.2.4` 标签锁定重构起点（未做 `git init`，避免覆盖真实历史） |
| 技术栈未经证实 | TypeScript：Express 5 + `node:sqlite`（server）、React/Vite（web）、Electron（desktop） | 测试用 `node:test` + 已有 `tsx`，零新增依赖 |
| 「审批」是流程中的门禁节点 | 实际是**章节版本快照 + 人工恢复**（`chapter_revisions`），无状态机、无 approve/reject 语义 | 审批抽象按现状建模，不虚构状态机（见 `docs/adr/0003`） |
| 模型供应商未定 | Anthropic 原生 + OpenAI 兼容双协议，运行时从用户配置解析 | 保持不变 |

## 1. 运行形态与入口

```
desktop/main.mjs（Electron 主进程）
  └─ 启动内嵌 Express（server-bundle.mjs，由 server/src/index.ts 经 esbuild 打包）
       └─ server/src/index.ts:112-125 挂载 12 个路由前缀
web/dist（Vite 产物）由 Express 静态托管，前端同源调用 /api
```

证据：
- `desktop/main.mjs`：`isServerMode`、`WEB_DIST`、导入 `server-bundle.mjs`、`app.whenReady()`
- `server/src/index.ts:112-125`：`/api/auth`、`/api`（novels/chapters/outlines/characters/maps/skillAuthors/mcp/kb/skills）、`/api/ai`、`/api/admin`、`/api/agent`
- `server/src/index.ts:45`：`express.json({ limit: "2mb" })`

## 2. 模块与依赖现状

| 层 | 目录 | 规模（行） | 说明 |
|---|---|---|---|
| 入口/装配 | `server/src/index.ts` | 172 | 路由挂载、静态托管、错误处理 |
| 路由 | `server/src/routes/*.ts` | 15 文件，约 3,600 | `ai.ts` 1,315 行、`skillAuthors.ts` 378、`skills.ts` 262 |
| 领域逻辑 | `server/src/agent.ts`、`mcp.ts`、`kb.ts`、`skills.ts` | 694 / 938 / 166 / 46 | Agent 工具循环、MCP 工具、知识库 |
| 持久化 | `server/src/db.ts` | 396 | 建表 + CRUD + 快照 |
| 前端 | `web/src/pages/**` | `Workspace.tsx` 2,564、`Settings.tsx` 1,916 | 单文件承载大量交互 |

依赖方向：`routes → db / agent / mcp / skills`，`agent → db`，无循环依赖，但**没有领域层**——业务规则散在路由里。

## 3. 提示词清点（全项目 26 条）

改造前分布（`file:line`，字符数，SHA256 前 12 位）：

| # | 位置 | 角色 | 字符 | sha | 重复情况 |
|---|---|---|---|---|---|
| 1 | `server/src/routes/ai.ts:48` | draft | 187 | `7ea5c3098788` | 与 #11 **逐字节相同** |
| 2 | `ai.ts:49` | continue | 115 | `a3acd5c58f98` | 与 #12 相同 |
| 3 | `ai.ts:50` | deslop | 252 | `14caa663ce85` | 与 #13 **近似**（252 vs 210） |
| 4 | `ai.ts:51` | polish | 102 | `5963d2e49e54` | 与 #14 相同 |
| 5 | `ai.ts:52` | expand | 90 | `a290a558f15e` | 与 #15 相同 |
| 6 | `ai.ts:53` | review | 249 | `b67fa6549a2b` | 与 #18 近似（含 338 字符版本） |
| 7 | `ai.ts:54` | analyze | 215 | `52693eea8b2b` | 与 #19 近似 |
| 8 | `ai.ts:55` | outline | 91 | `ad03e89e60c5` | 唯一 |
| 9 | `ai.ts:56` | summary | 58 | `d6b600b0847d` | 唯一 |
| 10 | `ai.ts:57` | suggest | 81 | `85d17fbe1a8d` | 唯一 |
| 11 | `server/src/agent.ts:554` | draft | 187 | 同上 | 复制自 #1 |
| 12 | `agent.ts:555` | continue | 115 | 同上 | 复制自 #2 |
| 13 | `agent.ts:556` | deslop | 210 | `ed58fcf88dd4` | #3 的删减版 |
| 14 | `agent.ts:557` | polish | 102 | 同上 | 复制自 #4 |
| 15 | `agent.ts:558` | expand | 90 | 同上 | 复制自 #5 |
| 16 | `agent.ts:675` | AGENT_SYSTEM_PROMPT | 1,460 | `2d8aea691a8a` | 唯一，最长 |
| 17 | `server/src/mcp.ts:932` | deslop_text | 305 | `eeb39dd35599` | **含 `${a.text}` 插值** |
| 18 | `mcp.ts:958` | review | 338 | `0699e332820b` | 含 `${a.chapterContent}` 插值 |
| 19 | `mcp.ts:978` | analyze | 237 | `58e45349239f` | 含 `${a.text}` 插值 |
| 20 | `server/src/routes/ai.ts:1345` | 章节 JSON 提炼 | 189 | `c6c498ff747a` | 唯一（`const system`，函数内） |
| 21 | `server/src/routes/skillAuthors.ts:211` | 蒸馏·文风 system | 56 | `59f6a3a72523` | 唯一 |
| 22 | `skillAuthors.ts:211` | 蒸馏·文风 user | 156 | `083363b815ac` | 唯一 |
| 23 | `skillAuthors.ts:217` | 蒸馏·人格 system | 54 | `931d3b1685af` | 唯一 |
| 24 | `skillAuthors.ts:217` | 蒸馏·人格 user | 130 | `5fd1a6a4d684` | 唯一 |
| 25 | `skillAuthors.ts:223` | 蒸馏·合并 system | 73 | `2e5a5678df01` | 唯一 |
| 26 | `skillAuthors.ts:223` | 蒸馏·合并 user | 187 | `e695166acd8b` | 唯一 |

> **清点口径修正**：首轮清点（仅扫描顶层 `SYSTEM_PROMPTS` 对象与特定变量名）漏掉了 #20–#26 共 7 条——它们分别是函数体内的 `const system = "..."` 与 `run(label, system, user, maxTokens)` 调用的内联参数。改用「全量字符串字面量 + 提示词特征词」扫描后才补全。这是本次审计的过程缺陷，已保留记录。

**重复结论**：26 条中有 4 对逐字节重复（8 条实为 4 条），deslop 存在 2 个近似版本（252/210），mcp 3 条是「正文 + 插值」混合体。合计重复正文约 494 字符；真正风险是**改一处忘另一处**。

## 4. 硬编码配置清点

| 类别 | 位置 | 值 | 可否覆盖 |
|---|---|---|---|
| 模型默认值 | `server/src/routes/ai.ts:13` | `claude-sonnet-4-5` | 是（`AI_MODEL`，但仅指站点默认，用户级配置另存 DB） |
| Base URL 默认 | `ai.ts:37`、`ai.ts:394` | `https://api.anthropic.com` | 是（`ANTHROPIC_BASE_URL`、会话、用户配置，三处优先级） |
| 站点密钥 | `ai.ts:12` | `ANTHROPIC_API_KEY` | 是 |
| **绝对路径** | `server/src/db.ts:11-12`、`server/src/index.ts:53-54` | `E:\起笔-公网服务器数据\data` | 仅当 `HOST=0.0.0.0` 且 `E:\` 存在 |
| 超时 | `ai.ts:1068` | `15000` ms（连通性探测） | 否 |
| 请求体上限 | `index.ts:45` | `2mb` | 否 |
| 协议判定 | `ai.ts:43`、`ai.ts:396` | `baseUrl.endsWith("/v1") → openai` | 否（隐式规则） |

`E:\...` 路径在 `db.ts` 与 `index.ts` **重复定义**，属于典型耦合点：改一处漏一处会导致数据目录分裂。

## 5. 耦合点清单

| ID | 耦合点 | 证据 | 影响面 | 严重度 |
|---|---|---|---|---|
| C-1 | `ai.ts` 单文件同时承担路由、鉴权、配置解析、双协议适配、SSE 流式、重试与错误映射 | `ai.ts` 1,315 行；`resolveBaseUrl/resolveProtocol/buildRuntimeConfig` 与 handler 混排 | 任何一处改动需回归全部 AI 能力（10 个角色） | 高 |
| C-2 | 提示词正文与调用逻辑同文件，且 `ai`/`agent` 各存一份 | 见 §3 #1–#15 | 提示词迭代易漏改、无法独立测试 | 高 |
| C-3 | 数据目录规则重复实现 | `db.ts:7-13` 与 `index.ts:50-55` | 数据分裂、迁移风险 | 中 |
| C-4 | 审批语义缺失：仅快照 + 恢复，无「待审/通过/驳回」状态 | `db.ts:163`（`chapter_revisions`）、`chapters.ts:147-179` | 无法用测试桩驱动「审批」流程，也无法审计谁批准 | 高（阻塞任务书 D 阶段目标） |
| C-5 | 无测试设施 | `AGENTS.md:31` 明示「There is no configured test suite」 | 重构缺少安全网 | 高 |
| C-6 | 协议判定依赖 URL 结尾 `/v1` 的隐式约定 | `ai.ts:43`、`ai.ts:396` | 换网关易误判 | 中 |
| C-7 | 前端巨型组件 | `Workspace.tsx` 2,564 行、`Settings.tsx` 1,916 行 | 前端改动风险高（本轮不改） | 中 |

## 6. 重构优先级

1. **P0**：建立测试设施（C-5）→ 已用 `node:test` + `tsx` 落地，零新增依赖。
2. **P0**：提示词外置并消除重复（C-2）→ 已完成 16 条，mcp 3 条因插值暂缓。
3. **P1**：拆 `ai.ts`（C-1）→ 未做，见 `docs/OPTIMIZATION-REPORT.md` 路线图。
4. **P1**：审批状态机（C-4）→ 未做，属产品语义变更，需先确认需求（`docs/adr/0003`）。
5. **P2**：数据目录规则收敛（C-3）、协议判定显式化（C-6）。

## 7. 本次审计未覆盖

- 未做真实模型端到端回归（无 API key）：`baseline/` 仅含固定输入与提示词渲染快照。
- 未审计前端渲染性能与打包体积构成。
- 未做安全审计（会话、越权、密钥加密仅按代码阅读判断）。

## 8. 审计过程缺陷记录

首轮提示词清点只覆盖了 `SYSTEM_PROMPTS` 对象字面量与 `AGENT_SYSTEM_PROMPT` 常量，遗漏 7 条：

- `server/src/routes/ai.ts:1345`（函数内 `const system = "..."`）
- `server/src/routes/skillAuthors.ts:211/217/223`（`run(label, system, user, maxTokens)` 的内联参数，每组 system + user 两条）

发现方式：迁移完成后用「长度 ≥ 80 的字符串字面量 + 提示词特征词（你是/请你/请根据/请将/你的任务）」全量扫描 `server/src`，命中 18 处（含 16 条已外置的生成物），据此定位缺口。

教训：**按变量名清点必然漏**；提示词清点应以「全量字符串字面量 + 语义特征」为准，并与「是否含变量插值」交叉判定。该缺陷导致本次外置覆盖率为 16/26（61.5%），而非最初以为的 16/19。
