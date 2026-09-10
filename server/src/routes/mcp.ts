import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createNovelForgeMcpServer } from "../mcp.js";

const router = express.Router();

// 存储活跃的 SSE Transport 会话
const transports = new Map<string, SSEServerTransport>();

// 1. SSE 接入端点（供远程/网络 Agent 如 AstraBot、Dify 等通过 HTTP SSE 接入）
router.get("/mcp/sse", async (req, res) => {
  try {
    const transport = new SSEServerTransport("/api/mcp/messages", res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    const mcpServer = createNovelForgeMcpServer();
    await mcpServer.connect(transport);

    req.on("close", () => {
      transports.delete(sessionId);
    });
  } catch (err: any) {
    console.error("[MCP SSE Error]", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "MCP SSE 连接初始化失败" });
    }
  }
});

// 2. 消息发送端点（配合 SSE 会话的双向通信）
router.post("/mcp/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId || !transports.has(sessionId)) {
    return res.status(404).json({ error: "MCP 会话不存在或已断开" });
  }

  const transport = transports.get(sessionId)!;
  try {
    await transport.handlePostMessage(req, res);
  } catch (err: any) {
    console.error("[MCP PostMessage Error]", err);
    res.status(500).json({ error: err.message || "处理 MCP 消息失败" });
  }
});

// 3. MCP 服务信息查询接口（便于在前端设置页或调试工具中一键查看连接参数）
router.get("/mcp/info", (_req, res) => {
  res.json({
    ok: true,
    server: "NovelForge MCP Server",
    version: "1.0.0",
    description: "起笔小说创作平台 Model Context Protocol 统一服务",
    supportedTransports: ["stdio", "sse"],
    sseEndpoint: "/api/mcp/sse",
    messagesEndpoint: "/api/mcp/messages",
    toolsCount: 25,
  });
});

export default router;
