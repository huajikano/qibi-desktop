#!/usr/bin/env node
/**
 * 起笔 (NovelForge) - Model Context Protocol (MCP) 独立启动器
 * 支持 Claude Code, AstrBot, Claude Desktop, Cursor, Cline 等 Agent 工具连接与自动化操作。
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// 优先查找 server/dist/mcp.js
const distMcpPath = path.join(rootDir, "server", "dist", "mcp.js");

if (fs.existsSync(distMcpPath)) {
  const fileUrl = pathToFileURL(distMcpPath).href;
  import(fileUrl).then((mod) => {
    if (typeof mod.runStdioMcpServer === "function") {
      mod.runStdioMcpServer();
    }
  }).catch((err) => {
    console.error("[NovelForge MCP 启动异常]", err);
    process.exit(1);
  });
} else {
  console.error(`[NovelForge MCP] 未找到编译产物: ${distMcpPath}，请先在项目根目录执行 npm run build -w server`);
  process.exit(1);
}
