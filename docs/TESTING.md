# TESTING 测试说明

## 一条命令

```bash
npm test                 # 全量测试（当前 6 个用例）
npm run test:prompts     # 仅提示词相关
```

实现：`node --import tsx --test tests/*.test.ts`（Node 24 内置 test runner，`tsx` 为已有依赖，零新增包）。

## 当前覆盖

| 用例 | 断言内容 | 文件 |
|---|---|---|
| 数量一致 | 注册表与基线均为 16 条 | `tests/prompts.test.ts` |
| 逐字符一致 | 每条提示词 `===` 改造前基线 | 同上 |
| 渲染等价 | 无变量渲染结果与原文完全相同 | 同上 |
| 渲染语义 | 占位符替换、缺变量抛 `PromptRenderError`、禁止残留、未知 id 报错 | 同上 |
| 生成同步 | `prompts/*.md` 与 `generated.ts` 一致（调用 `--check`） | 同上 |
| 外置彻底 | `ai.ts`/`agent.ts` 不含提示词正文片段 | 同上 |

## 提示词工作流

```bash
# 1. 编辑提示词：只改 prompts/<stage>/<id>.md
# 2. 重新生成注册表
npm run prompts:build
# 3. 校验（CI 用；不一致则以退出码 1 失败）
npm run prompts:check
# 4. 跑测试，确认逐字符比对通过
npm test
```

新增提示词：在 `prompts/<stage>/` 建 `<id>.md`，frontmatter 必填 `id`（须与文件名一致）、`version`、`stage`（枚举：generation/polish/review/planning/agent/mcp）、`variables`（如 `[text, outline]`）。正文用 `{{text}}` 占位；**禁止**写 `${...}`（那是 TS 插值，不是提示词变量）。

## fixture 从哪来

- `tests/fixtures/prompts-baseline.json`：改造前（commit `9df3827`）从源码 AST 抽取的 19 条提示词原文，其中 16 条已外置、3 条 mcp 待迁移。它是**只读基线**，除「有意改动提示词」外不得修改。
- 有意修改提示词时：先改 md → 更新基线对应条目 → 在 `docs/OPTIMIZATION-REPORT.md` 记录「改前/改后/原因」。

## 离线与无密钥

当前测试只覆盖提示词与渲染层，**不触网**。编排层（生成→审校→审批→导出）尚未抽出 `LlmClient`，因此「无 API key 跑通全流程」尚未实现，路线图见 `docs/OPTIMIZATION-REPORT.md` L-1。

## 未覆盖（勿误判为已测）

- 路由与鉴权（`server/src/routes/*`）
- SSE 流式输出与空输出保护
- 数据库读写与快照恢复
- 前端任何逻辑
- Electron 打包产物（另由 `npm run build:exe` + 实机冒烟验证）

## 建议的下一步

1. 抽 `LlmClient` 端口 + `FakeLlm`，为 `aiStream` 写首个编排测试（S）。
2. 为 `chapter_revisions` 的保存/恢复加单测（需临时 `DATA_DIR`）（S）。
3. 加 `--experimental-test-coverage` 并在报告中记录基线覆盖率（S）。
