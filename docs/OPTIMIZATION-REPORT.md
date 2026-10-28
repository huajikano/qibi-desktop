# OPTIMIZATION-REPORT 重构报告（1.2.5）

- 基线：`9df3827`（v1.2.4，tag `baseline-1.2.4`）
- 交付：`1.2.5`
- 范围：**提示词外置 + 测试设施**（阶段 A/B/C 与 D 的测试骨架）；未做的是大规模分层拆分与审批状态机，理由见 §5

## 1. 结论

在不改变任何用户可见行为的前提下，把 **16 条**提示词（全项目 26 条中的 61.5%）从代码迁到 `prompts/*.md`，建立「md 源 → 生成 TS 注册表 → 严格渲染层」链路，并补上项目**首个测试设施**（6 个用例全绿）。`tsc` 编译通过、web 构建通过、portable 打包通过、实机冒烟通过。

**行为等价的核心证据**：16 条提示词与改造前基线**逐字符相同**（`tests/prompts.test.ts` 断言 `===`），`ai.ts`/`agent.ts` 中已无这 16 条正文。

**未覆盖的 10 条**：`mcp.ts` 3 条（含 `${...}` 插值）、`ai.ts:1345` 1 条、`skillAuthors.ts` 6 条（蒸馏链路）。它们仍硬编码，属已知缺口（L-3、L-8），因此验收标准「`prompts/` 之外不存在提示词正文」**未完全满足**。

## 2. 逐项改造（改前 / 改后 / 验证方式）

| # | 项 | 改前 | 改后 | 验证方式 |
|---|---|---|---|---|
| R-1 | 提示词存放 | `ai.ts:48-57`（10 条）、`agent.ts:554-558`（5 条）、`agent.ts:675`（1 条）硬编码 | `prompts/<stage>/<id>.md` 16 个文件，frontmatter 含 `id/version/stage/variables/source` | `npm run prompts:check` exit 0；`tests/prompts.test.ts` 逐字符比对 |
| R-2 | 重复提示词 | `ai` 与 `agent` 各存一份，4 对逐字节相同、deslop 近似（252/210 字符） | 单一来源；`agent.ts` 复用 `ai-*` 四条，`deslop` 保留 `agent-deslop` 独立条目 | 运行时断言 `PROMPTS['agent-draft'] === PROMPTS['ai-draft']`，`agent-deslop !== ai-deslop` |
| R-3 | 提示词渲染 | 直接字符串赋值，无校验 | `renderPrompt(id, vars)`：只替换 `{{var}}`；缺变量抛 `PromptRenderError` 并列出缺失项；渲染后残留占位符立即报错 | `renderTemplate` 单测 4 组断言（替换/缺变量/多余变量/残留） |
| R-4 | 生成一致性 | 无 | `scripts/build-prompts.mjs`，支持 `--check`；`.gitattributes` 固定 LF | 测试内 spawn `--check`，退出码 0 |
| R-5 | 测试设施 | 无（`AGENTS.md:31`） | `node --import tsx --test tests/*.test.ts`，零新增依赖 | `npm test` → 6 pass / 0 fail |
| R-6 | 文档 | 仅 `AGENTS.md`/`CLAUDE.md`（含过期的 `起笔-1.0.0-portable.exe`） | 新增 `docs/ARCHITECTURE-AUDIT.md`、`ARCHITECTURE-TARGET.md`、`docs/adr/0001-0003`、`docs/TESTING.md`、本报告 | 文件存在性 + 内容含 `file:line` 证据 |

## 3. 证据（命令与结果）

```text
$ npm run build -w server        # tsc -p tsconfig.json
EXIT=0

$ npm test
✔ 提示词数量与基线一致（16 条）
✔ 每条提示词与改造前逐字符一致
✔ 无变量模板渲染后与原文完全相同
✔ 渲染器：占位符替换、缺变量报错、无残留
✔ prompts/*.md 与 generated.ts 保持同步
✔ 提示词正文已从调用点移除（ai.ts / agent.ts）
tests 6 / pass 6 / fail 0   duration_ms 262

$ npm run prompts:check
prompts:check OK
```

- 编译日志：`_audit/tsc-1.2.5.log`
- 测试日志：`_audit/test-1.2.5.log`
- 打包与冒烟：见 §4、`_audit/build-*-v125.log`、`_audit/smoke-window-1.2.5.png`

## 4. 回归与发布验证

| 项 | 结果 |
|---|---|
| `npm ci`（在既有 `node_modules` 上增量验证） | 未重装；沿用 1.2.4 已验证依赖树 |
| `npm run build -w web` | exit 0 |
| `npm run build -w server` | exit 0 |
| `electron-builder --win --x64 --publish never` | exit 0 |
| 产物 | `起笔-1.2.5-portable.exe`，**91,341,714 字节**，SHA256 `A0838016C7571083290C6822F6A5E2EBEA8D4918C1C3C3A97382C4BBA51657D2` |
| `app.asar` | 4,335,603 字节（含 `generated.ts` 提示词注册表） |
| 提示词是否进产物 | 是。`asar` 内 `ai-draft` 键出现 3 次；中文因 esbuild ASCII 输出为 `\uXXXX` 转义（直接搜中文会误判为缺失） |
| 冒烟 | 5 进程存活；窗口「起笔 · 小说创作平台」；端口 64958；`/api/health` = `{"ok":true,"time":"2026-10-28T18:08:58.240Z"}`；首页 HTTP 200 / 883 B |
| 生成结果语义 | **无变化**：提示词逐字符一致，调用参数与协议解析未改动 |

## 5. 未落地项与路线图

| ID | 项 | 为什么没做 | 工作量 |
|---|---|---|---|
| L-1 | `LlmClient` 端口 + `FakeLlm`，离线跑通生成→审校→审批→导出 | 需改动 `ai.ts` 全部 6 个调用点并注入依赖；无回归测试网前风险过高 | M（1–2 天） |
| L-2 | 拆分 `ai.ts`（1,315 行：路由/鉴权/配置/双协议/SSE） | 同上；建议先做 L-1 再拆 | L（3–5 天） |
| L-3 | mcp 3 条提示词外置 | 正文含 `${a.text}` 等 TS 插值，需先定义插值变量语法（如 `{{text}}`）并改造 3 处调用 | S（0.5 天） |
| L-4 | `config/` 统一配置 | `ai.ts:13-14`、`db.ts:11-12`、`index.ts:53-54` 需同步收敛，涉及数据目录迁移 | S（0.5 天） |
| L-5 | 审批状态机 | 属产品语义变更，需先确认「是否需要多人审批/审批人审计」（ADR-0003） | L（3 天+） |
| L-6 | `engines` / `.nvmrc` | 与本次重构无关，1.2.4 报告中已列为 C-07 | S（5 分钟） |
| L-7 | 应用图标 / 代码签名 | 发布质量项，见 1.2.4 报告 C-02/C-03 | S–M |
| L-8 | `ai.ts:1345`、`skillAuthors.ts:211/217/223` 共 7 条提示词外置 | 首轮清点漏检（见 `ARCHITECTURE-AUDIT.md` §8）；其中 6 条为 `run(label, system, user, maxTokens)` 内联参数，需先确认蒸馏链路是否允许逐字改动 | S（0.5 天） |

## 6. 假设清单

1. **项目位置**：任务书假设项目在 `D:\XiangMu\插件制作\审批起笔` 且非 git 仓库；实际项目在 `_work\qibi-desktop`，已有完整 git 历史与远端。因此未执行 `git init`，改为在基线提交上打 `baseline-1.2.4` 标签，避免覆盖真实历史。
2. **审批语义**：按「快照 + 人工恢复」的现状建模，不引入 `approved/rejected` 状态（ADR-0003）。
3. **模型供应商**：Anthropic 原生 + OpenAI 兼容双协议保持不变，未做适配层重写。
4. **基线采集**：本机无可用 API key，未做真实模型端到端基线；`baseline/` 记录的是固定输入与提示词渲染快照，不是模型输出。
5. **测试框架**：选用 Node 内置 test runner（ADR-0002），未新增依赖。
6. **行尾**：仓库 `core.autocrlf=true`，已用 `.gitattributes` 将提示词与生成物固定为 LF。

## 7. 遗留风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| `generated.ts` 是生成物但必须提交 | 手改会被 `--check` 覆盖 | 文件头标注「勿手工编辑」；测试拦截不一致 |
| mcp 3 条提示词仍在代码内 | `prompts/` 之外仍有提示词正文，验收标准 2 未完全满足 | 已登记 L-3，明确为已知缺口 |
| 另有 7 条（`ai.ts:1345` + `skillAuthors.ts` 6 条）未外置 | 覆盖率 16/26；「提示词全部外置」不成立 | 已登记 L-8；审计报告 §8 记录了漏检原因 |
| 无编排层测试 | 重构 `ai.ts` 时无安全网 | 先做 L-1 再拆 L-2 |
| 未做真实模型回归 | 无法证明「输出文本完全一致」 | 提示词逐字符一致 + 调用参数未改，逻辑上等价；但采样随机性无法用快照覆盖 |
| 前端巨型组件未拆 | `Workspace.tsx` 2,564 行，后续改动风险高 | 不在本轮范围，建议单独排期 |
