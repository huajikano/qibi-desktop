import express, { Response } from "express";
import { requireAuth, currentUser } from "../auth.js";
import { db } from "../db.js";
import { listAllTools, dispatchAgentTool, AGENT_SYSTEM_PROMPT, AGENT_TOOL_SPECS, setAgentRuntimeConfig } from "../agent.js";
import { chatWithTools, formatAiError } from "./ai.js";
import { resolveAgentRuntimeConfig } from "./ai.js";
import { buildSkillInjection } from "../skills.js";
import { diagnoseAgentError, formatDiagnosticMessage } from "../agent-diagnostics.js";

const router = express.Router();
router.use(requireAuth);

const STATION_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.AI_MODEL || "claude-sonnet-4-5";
const BASE_URL = (process.env.ANTHROPIC_BASE_URL || "").replace(/\/+$/, "");
const ALLOW_PUBLIC_STATION_KEY = process.env.ALLOW_PUBLIC_STATION_KEY === "true";

function getStationKey(user: any): string {
  if (!STATION_KEY) return "";
  if (user?.role === "admin" || ALLOW_PUBLIC_STATION_KEY) return STATION_KEY;
  return "";
}

// 返回工具清单（包含外部 MCP 客户端工具）供前端 UI 展示
router.get("/tools", (req, res) => {
  const user = currentUser(req)!;
  const includeExternal = req.query.includeExternal !== "false";
  res.json({
    tools: listAllTools(user.id, includeExternal),
    includeExternal,
  });
});

// 管家 agent 主循环：SSE 输出，每一步一个 type 事件
router.post("/run", async (req, res) => {
  const user = currentUser(req)!;
  const { task, novelId, history, includeExternal, maxSteps } = req.body || {};
  if (!task || typeof task !== "string") return res.status(400).json({ error: "缺少 task" });
  const userRuntime = resolveAgentRuntimeConfig(req, user);
  if (!userRuntime) {
    return res.status(400).json({ error: "未配置管家 Agent API 密钥：请在「设置」→「管家 Agent」或「小说写作助手」中填写" });
  }
  // 用户明确配置了个人密钥/自定义端点时，严格优先使用用户端点与模型，绝不被站方默认变量覆盖
  const runtime = userRuntime;
  setAgentRuntimeConfig(runtime);

  const tools = listAllTools(user.id, includeExternal !== false);
  const limit = Math.max(1, Math.min(20, Number(maxSteps) || 10));

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const ac = new AbortController();
  req.on("close", () => ac.abort());

  const send = (event: string, payload: any) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const messages: Array<{ role: "user" | "assistant"; content: any }> = [];
  const initialUserMsg = novelId
    ? `[novelId=${novelId}]\n${task}`
    : task;
  messages.push({ role: "user", content: initialUserMsg });

  send("start", { tools: tools.map((t) => ({ name: t.name, description: t.description })) });

  let step = 0;
  let finalText = "";
  let terminated = false;

  let systemPrompt = AGENT_SYSTEM_PROMPT;
  try {
    const skillBlock = buildSkillInjection(user.id, "writer");
    if (skillBlock) systemPrompt = systemPrompt + "\n\n" + skillBlock;
  } catch {
    /* ignore */
  }

  // 根据小说类型动态调整Agent提示词
  if (novelId) {
    try {
      const novel = db.prepare("SELECT genre FROM novels WHERE id = ?").get(novelId) as any;
      if (novel?.genre) {
        const genre = String(novel.genre).toLowerCase();
        let genreHint = "";

        if (genre.includes("言情") || genre.includes("都市") || genre.includes("现代")) {
          genreHint = "\n【当前小说类型：言情/都市】\n在更新角色动态账本时，重点提取：关系进展、社会地位、情感状态、身世秘密、情敌等信息。";
        } else if (genre.includes("悬疑") || genre.includes("推理") || genre.includes("犯罪")) {
          genreHint = "\n【当前小说类型：悬疑/推理】\n在更新角色动态账本时，重点提取：嫌疑等级、掌握线索、不在场证明、作案动机、当前行踪等信息。";
        } else if (genre.includes("历史") || genre.includes("架空")) {
          genreHint = "\n【当前小说类型：历史/架空】\n在更新角色动态账本时，重点提取：官职变动、政治立场、军事实力、封地势力、党派阵营等信息。";
        } else if (genre.includes("科幻") || genre.includes("未来")) {
          genreHint = "\n【当前小说类型：科幻】\n在更新角色动态账本时，重点提取：科技等级、改造程度、阵营组织、权限等级、特殊资源等信息。";
        } else if (genre.includes("游戏") || genre.includes("异界") || genre.includes("网游")) {
          genreHint = "\n【当前小说类型：游戏异界】\n在更新角色动态账本时，重点提取：等级、职业、技能、装备、公会等信息。";
        } else {
          genreHint = "\n【当前小说类型：修仙/玄幻】\n在更新角色动态账本时，重点提取：境界、功法、法宝、伤势、门派等信息。";
        }

        systemPrompt += genreHint;
      }
    } catch {
      /* ignore */
    }
  }

  try {
    while (step < limit && !terminated) {
      if (ac.signal.aborted) { terminated = true; break; }

      const result = await chatWithTools({
        key: runtime.key,
        system: systemPrompt,
        messages,
        tools,
        maxTokens: 4000,
        protocol: runtime.protocol as any,
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        signal: ac.signal,
      });

      step += 1;

      if (result.text) {
        send("assistant_text", { step, text: result.text });
        finalText += result.text;
      }

      if (!result.toolCalls.length) {
        // 模型认为完成
        messages.push({ role: "assistant", content: [{ type: "text", text: result.text || "" }] });
        break;
      }

      // 把 assistant 完整内容（包含 tool_use 块）回填给 messages
      const assistantBlocks: any[] = [];
      if (result.text) assistantBlocks.push({ type: "text", text: result.text });

      // 为每个 tool call 生成唯一 ID
      const toolUseIds: string[] = [];
      for (let i = 0; i < result.toolCalls.length; i++) {
        const c = result.toolCalls[i];
        const toolId = c.id || `toolu_${Date.now()}_${step}_${i}`;
        toolUseIds.push(toolId);
        assistantBlocks.push({ type: "tool_use", id: toolId, name: c.name, input: c.args });
      }
      messages.push({ role: "assistant", content: assistantBlocks });

      // 执行每个 tool 并回填 tool_result
      const toolResultBlocks: any[] = [];
      for (let i = 0; i < result.toolCalls.length; i++) {
        const c = result.toolCalls[i];
        const toolId = toolUseIds[i];
        send("tool_call", { step, index: i, name: c.name, args: c.args });
        let out: any;
        try {
          out = await dispatchAgentTool(user.id, c.name, c.args);
          out = typeof out === "string" ? out : JSON.stringify(out);
        } catch (err: any) {
          // 工具调用失败诊断
          const diagnostic = diagnoseAgentError(err, { baseUrl: runtime.baseUrl, model: runtime.model });
          const diagnosticMsg = formatDiagnosticMessage(diagnostic);
          out = JSON.stringify({ error: err?.message || String(err), diagnostic: diagnosticMsg });
          send("tool_error", { step, index: i, name: c.name, error: diagnosticMsg, severity: diagnostic.severity });
        }
        // 截断超大结果避免上下文爆掉
        const MAX = 50_000;
        if (typeof out === "string" && out.length > MAX) out = out.slice(0, MAX) + "\n…(内容过长已截断)";
        toolResultBlocks.push({ type: "tool_result", tool_use_id: toolId, content: out });
        send("tool_result", { step, index: i, name: c.name, preview: typeof out === "string" ? out.slice(0, 200) : String(out).slice(0, 200) });
      }
      messages.push({ role: "user", content: toolResultBlocks });
    }

    send("done", { steps: step, finalText, truncated: step >= limit });
    res.end();
  } catch (err: any) {
    const diagnostic = diagnoseAgentError(err, { baseUrl: runtime.baseUrl, model: runtime.model });
    const diagnosticMsg = formatDiagnosticMessage(diagnostic);
    send("error", { error: diagnosticMsg, severity: diagnostic.severity });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

export default router;
