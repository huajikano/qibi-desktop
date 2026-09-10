// 起笔 · 用户 Skill 注入助手
//
// 提供 buildSkillInjection(userId, scope) → 把该用户对应 scope 的所有已启用 Skill
// 拼接成一段 Markdown 文本，供 AI 调用的系统提示词前缀注入使用。

import { db } from "./db.js";

export type SkillScope = "writer" | "distill" | "world" | "all";

export function loadActiveSkills(userId: number, scope: SkillScope): Array<{ id: number; name: string; slug: string; scope: string; content: string; priority: number }> {
  const rows = db
    .prepare(
      `SELECT id, name, slug, scope, content, priority
       FROM user_skills
       WHERE user_id = ? AND enabled = 1 AND (scope = ? OR scope = 'all')
       ORDER BY priority DESC, id ASC`
    )
    .all(userId, scope) as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    scope: r.scope,
    content: r.content,
    priority: r.priority,
  }));
}

export function buildSkillInjection(userId: number, scope: SkillScope): string {
  const skills = loadActiveSkills(userId, scope);
  if (!skills.length) return "";

  const blocks = skills
    .map((s, i) => {
      const body = (s.content || "").trim();
      if (!body) return null;
      return `### Skill ${i + 1}：${s.name}\n${body}`;
    })
    .filter(Boolean);

  if (!blocks.length) return "";

  return [
    "",
    "═══ 以下为作者自定义 Skill 注入（按优先级排序）═══",
    "作者已为本次写作配置以下 Skill 预设，请在所有正文生成、润色、续写、细纲规划、设定分析时严格遵循。",
    "若 Skill 之间存在冲突，按优先级（priority 越大越靠前）覆盖；若 Skill 与默认系统提示词冲突，以 Skill 为准。",
    "",
    blocks.join("\n\n"),
    "═══ Skill 注入结束 ═══",
    "",
  ].join("\n");
}
