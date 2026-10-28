# ADR-0003 审批按「快照 + 显式决策」建模，不虚构状态机

- 状态：已采纳（本轮不实现，仅定契约）
- 关联：`server/src/db.ts:163`（`chapter_revisions`）、`server/src/routes/chapters.ts:147-179`、`server/src/routes/ai.ts:897-906`

## 背景

任务书假设流程是「生成 → 审校 → **审批** → 导出」，并要求把审批做成「可替换组件、能被测试桩驱动、无需人工点击即可跑完」。

实际代码里没有审批环节：

- `chapters` 只有 `status TEXT DEFAULT '草稿'`（`db.ts:76`），无 `pending/approved/rejected`
- 存在的是**版本快照**：`chapter_revisions`（`db.ts:163`），提供列表/详情/新建/恢复四个端点（`chapters.ts:147/156/167/176`）
- AI 改写前自动存快照，防止覆盖（`ai.ts:897-906`，`saveChapterRevision(chapterId, "AI生成前备份", ...)`）

也就是说，「审批」在现有产品里表现为**作者对 AI 产出的逐次确认与回滚**，而不是多人审批流。

## 决策

1. 不引入 `pending/approved/rejected` 状态机，不新增审批表——那是**产品语义变更**，超出「行为等价」重构范围。
2. 定义 `ApprovalGateway` 端口（见 `docs/ARCHITECTURE-TARGET.md` §3），把「当前语义」抽象成可替换组件：
   - `request()` → 生成快照并返回 `revisionId`（对应 `saveChapterRevision`）
   - `decide()` → 接受/拒绝；拒绝即调用 `restore` 恢复到指定 `revisionId`
   - `get()` → 查询某次决策记录
3. 生产实现映射到现有 `chapter_revisions`；测试桩实现为内存 Map，使编排器可在无人值守下跑完「生成 → 快照 → 接受/回滚 → 导出」。

## 备选方案与否决理由

| 方案 | 否决理由 |
|---|---|
| 直接加 `approvals` 表 + 状态机 | 改变用户可见行为（章节列表出现新状态、UI 需要新入口），违反本轮「行为等价」硬约束 |
| 保持现状，不做任何抽象 | 编排层无法在测试中跳过「人工确认」，D 阶段「无人工跑完全流程」无法实现 |
| 用 `chapter.status` 复用为审批状态 | `status` 已被「草稿/连载中/完结」占用，语义冲突，迁移会污染既有数据 |

## 后果

- 正面：零行为变更即可获得可测试的审批边界；将来若确需多人审批，只需替换 `ApprovalGateway` 实现 + 加表。
- 负面：本轮未实现端口与其实现，仅给出契约；「审批记录可追溯」仍依赖现有 `chapter_revisions`（有 `reason`、`created_at`，但无审批人字段）。
- 待确认：是否需要「谁批准」的审计字段（需产品决策，见 `docs/OPTIMIZATION-REPORT.md` 路线图 R-3）。
