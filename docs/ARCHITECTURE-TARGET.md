# ARCHITECTURE-TARGET 目标架构

> 原则：**先可测，再拆分**。每一层都必须能在无网络、无 API key 的条件下被测试驱动。

## 1. 分层图

```
interface        server/src/routes/*.ts（Express handler，只做协议转换）
                 desktop/main.mjs（Electron 壳）
                    │ 只依赖 application
application      pipeline/（生成→审校→审批→导出 编排）
                 approval/（审批组件，可替换）
                    │ 只依赖 domain + ports
domain           领域模型与校验：Novel / Chapter / Outline / Character
                 纯函数、无 IO、无框架
                    │
ports（接口）      LlmClient / PromptRegistry / Repository / ApprovalGateway
                    ▲ 由 infrastructure 实现
infrastructure   llm/（Anthropic / OpenAI 兼容适配）
                 persistence/（node:sqlite）
                 fs/（数据目录、导入导出）
prompts/         提示词源文件（已落地）
config/          默认值 + 用户覆盖 + 环境变量（待落地）
```

依赖方向单向向内：`interface → application → domain`，`infrastructure` 实现 `ports`，`domain` 不依赖任何外层。

## 2. 模块职责表

| 模块 | 职责 | 现状 | 目标 |
|---|---|---|---|
| `interface/routes` | HTTP/SSE 协议转换、鉴权、参数校验 | `ai.ts` 1,315 行含全部逻辑 | 只保留 handler，逻辑下沉 |
| `application/pipeline` | 阶段编排、上下文组装、失败回退 | 分散在 `ai.ts` handler 内 | 独立可测编排器 |
| `application/approval` | 审批状态流转 | **不存在**（仅快照，`chapters.ts:147-179`） | 可替换组件 + 状态机 |
| `domain` | 实体、不变量、字数/章节校验 | 散落在路由与 `db.ts` | 纯函数集合 |
| `infrastructure/llm` | 双协议调用、流式、重试、错误映射 | `ai.ts:380-800` 内联 | `LlmClient` 实现 |
| `prompts` | 提示词源 + 版本 | **已落地 16 条** | 补 mcp 3 条（需插值支持） |
| `config` | 默认值/覆盖/环境变量 | 硬编码（`ai.ts:13-14`、`db.ts:11-12`） | 单入口 `loadConfig()` |

## 3. 接口契约草案

```ts
// ports/llm.ts —— 可被 FakeLlm 替换，离线跑通全流程
export interface LlmRequest {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  model?: string;
  temperature?: number;
  seed?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}
export interface LlmChunk { delta: string }
export interface LlmClient {
  stream(req: LlmRequest): AsyncIterable<LlmChunk>;
  complete(req: LlmRequest): Promise<string>;
}

// ports/approval.ts —— 谁触发、状态存哪、拒绝如何回退
export type ApprovalState = "pending" | "approved" | "rejected";
export interface ApprovalRequest {
  novelId: number;
  chapterId: number;
  revisionId: number;
  stage: "draft" | "review" | "export";
  payload: string;
}
export interface ApprovalGateway {
  request(req: ApprovalRequest): Promise<{ id: number; state: ApprovalState }>;
  decide(id: number, decision: "approved" | "rejected", note?: string): Promise<void>;
  get(id: number): Promise<{ state: ApprovalState; note?: string }>;
}

// ports/prompt.ts —— 已落地
export function renderPrompt(id: PromptId, vars?: Record<string, string>): string;
```

`ApprovalGateway` 的设计要点：**测试桩实现 `decide` 即可让流程无人值守跑完**；生产实现落库（新增 `approvals` 表），拒绝后回退到 `chapter_revisions` 指定版本。

## 4. 与现状的差距

| 目标能力 | 现状 | 差距 |
|---|---|---|
| Fake LLM 离线跑通 | 无 `LlmClient` 抽象，`fetch` 直连写在 handler | 需抽接口 + 依赖注入（M） |
| 审批可测 | 无审批组件 | 需新增表 + 组件 + 前端入口（L） |
| 提示词外置 | 16/19 已外置 | mcp 3 条需插值变量化（S） |
| 配置外置 | 散落硬编码 | `config/` + `loadConfig()`（S） |
| 领域模型 | 无 | 抽取实体与校验（M） |

工作量标记：S ≤ 0.5 天，M ≈ 1–2 天，L ≥ 3 天。
