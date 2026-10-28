# ADR-0002 测试用 node:test + 已有 tsx，不引入 vitest/jest

- 状态：已采纳（2026-10-29）
- 关联：`package.json`（`test` 脚本）、`tests/prompts.test.ts`

## 背景

项目此前**没有任何测试设施**（`AGENTS.md:31`：「There is no configured test suite」）。任务书要求「一条命令跑全量测试」，且约束「不引入重型框架」。

## 决策

用 Node 24 内置 `node:test` + `node:assert/strict`，TypeScript 由已存在的 `tsx`（`server/devDependencies`，已 hoist 到根 `node_modules`）即时编译：

```json
"test": "node --import tsx --test tests/*.test.ts"
```

## 备选方案与否决理由

| 方案 | 否决理由 |
|---|---|
| vitest | 需新增 `vitest` + 配置 + jsdom（若测前端），与「不引入重型框架」冲突；本项目当前测试面是纯函数，无需 watch/UI |
| jest + ts-jest | 同上，且 ESM 配置成本更高 |
| 先 `tsc` 编译再测 dist | 每次测试都要全量构建，反馈慢；且 dist 与 src 路径映射复杂 |
| 不写测试，仅靠 `tsc` | 无法证明「提示词逐字符一致」，正是本次重构的核心验收项 |

## 后果

- 正面：零新增依赖；`node --test` 输出 TAP，便于将来接 CI；`tsx` 已是现有依赖，无供应链新增面。
- 负面：无内置覆盖率（需 `--experimental-test-coverage`，Node 24 支持）；断言库比 jest 简洁，复杂 mock 需手写。
- 后续：需要覆盖率门禁时加 `--experimental-test-coverage`，不换框架。
