import { PROMPTS, PROMPT_META } from "./generated.js";

export type PromptId = keyof typeof PROMPT_META;
export { PROMPTS, PROMPT_META };

export class PromptRenderError extends Error {
  constructor(
    public readonly promptId: string,
    public readonly missing: string[],
  ) {
    super(`提示词 ${promptId} 缺少变量: ${missing.join(", ")}`);
    this.name = "PromptRenderError";
  }
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** 纯函数：按 {{var}} 替换；缺变量抛错，绝不静默填空或留占位符。 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
  declared: readonly string[] = [],
): string {
  const used = [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const required = [...new Set([...declared, ...used])];
  const missing = required.filter((k) => vars[k] === undefined);
  if (missing.length) throw new PromptRenderError(declared[0] ?? used[0] ?? "unknown", missing);
  const rendered = template.replace(PLACEHOLDER, (_m, k: string) => vars[k]);
  if (/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(rendered)) {
    throw new Error(`渲染后仍存在未替换占位符: ${rendered.slice(0, 80)}`);
  }
  return rendered;
}

/** 渲染提示词；变量集合来自 prompts/*.md 的 frontmatter。 */
export function renderPrompt(id: PromptId, vars: Record<string, string> = {}): string {
  const template = PROMPTS[id];
  if (template === undefined) throw new Error(`未知提示词: ${String(id)}`);
  try {
    return renderTemplate(template, vars, PROMPT_META[id].variables as readonly string[]);
  } catch (err) {
    if (err instanceof PromptRenderError) throw new PromptRenderError(id, err.missing);
    throw err;
  }
}
