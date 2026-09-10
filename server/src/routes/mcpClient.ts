import express from "express";
import { requireAuth, currentUser } from "../auth.js";
import {
  listClients, connectClient, disconnectClient, getClient,
  callTool, readPrompt, readResource, listAllExternalTools,
} from "../mcpClient.js";

const router = express.Router();
router.use(requireAuth);

router.get("/clients", (req, res) => {
  const user = currentUser(req)!;
  res.json({ clients: listClients(user.id) });
});

router.post("/clients/connect", async (req, res) => {
  const user = currentUser(req)!;
  const { kind, name, command, args, env, url } = req.body || {};
  if (!kind || !name) return res.status(400).json({ error: "缺少 kind 或 name" });

  // 安全审计：stdio 仅允许显式命令；URL 仅允许 http/https；公网模式下限制 stdio
  if (kind === "stdio") {
    if (!command) return res.status(400).json({ error: "stdio 模式需要填写 command" });
    if (typeof command !== "string") return res.status(400).json({ error: "command 必须为字符串" });
    if (!Array.isArray(args) && args !== undefined) return res.status(400).json({ error: "args 必须为字符串数组" });
    if (env !== undefined && (typeof env !== "object" || Array.isArray(env))) return res.status(400).json({ error: "env 必须为对象" });
    // 公网服务器仅允许管理员创建 stdio 连接，避免任意进程被启动
    if (process.env.PUBLIC_SERVER === "true" && user.role !== "admin") {
      return res.status(403).json({ error: "公网服务器模式下仅管理员可以挂载 stdio 类型的 MCP 客户端" });
    }
  } else if (kind === "sse" || kind === "http") {
    if (!url || typeof url !== "string") return res.status(400).json({ error: `${kind} 模式需要填写 url` });
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return res.status(400).json({ error: "url 必须为 http/https 协议" });
    } catch {
      return res.status(400).json({ error: "url 格式无效" });
    }
  } else {
    return res.status(400).json({ error: "未知连接类型，仅支持 stdio / sse / http" });
  }

  try {
    const rec = await connectClient(user.id, { kind, name, command, args, env, url } as any);
    const { client: _c, ...rest } = rec;
    res.json({ ok: rec.status === "ready", client: rest, error: rec.errorMessage });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "连接失败" });
  }
});

router.delete("/clients/:id", async (req, res) => {
  const user = currentUser(req)!;
  const ok = await disconnectClient(user.id, req.params.id);
  res.json({ ok });
});

router.post("/clients/:id/call", async (req, res) => {
  const user = currentUser(req)!;
  const { toolName, args } = req.body || {};
  if (!toolName) return res.status(400).json({ error: "缺少 toolName" });
  try {
    const result = await callTool(user.id, req.params.id, toolName, args);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "调用失败" });
  }
});

router.post("/clients/:id/prompt", async (req, res) => {
  const user = currentUser(req)!;
  const { promptName, args } = req.body || {};
  if (!promptName) return res.status(400).json({ error: "缺少 promptName" });
  try {
    const result = await readPrompt(user.id, req.params.id, promptName, args);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "读取提示失败" });
  }
});

router.post("/clients/:id/resource", async (req, res) => {
  const user = currentUser(req)!;
  const { uri } = req.body || {};
  if (!uri) return res.status(400).json({ error: "缺少 uri" });
  try {
    const result = await readResource(user.id, req.params.id, uri);
    res.json({ ok: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "读取资源失败" });
  }
});

router.get("/external-tools", (req, res) => {
  const user = currentUser(req)!;
  res.json({ tools: listAllExternalTools(user.id) });
});

export default router;
