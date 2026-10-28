# ADR-0001 提示词以 Markdown 为源、编译期生成 TS 注册表

- 状态：已采纳（2026-10-29）
- 决策者：重构实施方
- 关联：`prompts/**/*.md`、`scripts/build-prompts.mjs`、`server/src/prompts/generated.ts`

## 背景

提示词原本硬编码在 `server/src/routes/ai.ts:48-57`、`server/src/agent.ts:554-558`、`mcp.ts:932-996`，其中 4 对逐字节重复，deslop 有 2 个近似版本。需要外置、可版本化、可校验，同时**不能破坏 Electron 打包**。

## 决策

`prompts/<stage>/<id>.md` 为唯一源（frontmatter：`id/version/stage/variables/source`），构建脚本生成 `server/src/prompts/generated.ts`（随仓库提交），运行时零文件 IO。

渲染层 `renderPrompt(id, vars)`：只替换 `{{var}}`，缺变量抛 `PromptRenderError`，渲染后若仍有占位符立即报错。

## 备选方案与否决理由

| 方案 | 否决理由 |
|---|---|
| 运行时 `fs.readFile` 读取 `prompts/` | Electron 打包后 asar 内路径与开发态不同，需改 `files` 白名单与运行时路径解析，失败模式隐蔽 |
| 直接 `import` md（esbuild text loader） | 需改 `desktop/build-server.mjs` 与 `tsc` 双份配置；`tsc` 不支持 md 导入，测试与生产行为分叉 |
| 提示词放数据库 | 版本无法随代码 review，回滚依赖备份；与「提示词即代码资产」的定位冲突 |
| 保留硬编码，仅抽公共常量 | 只解决重复，不解决「外置 + 可版本化」，且无法被非 TS 角色维护 |

## 后果

- 正面：改提示词只需编辑 md；`prompts:check` 可在 CI 拦截「改了 md 忘了生成」；快照测试可逐字符比对历史版本。
- 负面：多一个生成步骤；`generated.ts` 属生成物但必须提交（否则 `tsc` 构建失败）。已用 `.gitattributes` 固定 LF，避免跨平台 diff。
- 约束：md 正文不得包含 `${` 插值；含插值者（mcp 3 条）暂不迁移。
