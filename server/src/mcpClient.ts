import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomUUID } from "node:crypto";

// 一个用户可以挂载多个 MCP 客户端；每个客户端以 id 区分。
// 全部会话状态保存在内存中，重启后清空（公网用户可重新连接）。
export type McpClientRecord = {
  id: string;
  ownerId: number;
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  status: "connecting" | "ready" | "error" | "closed";
  errorMessage?: string;
  connectedAt: number;
  client: Client;
  // 缓存的 tools / prompts / resources 列表，连接成功后刷新
  tools: Array<{ name: string; description?: string; inputSchema?: any }>;
  prompts: Array<{ name: string; description?: string; arguments?: any[] }>;
  resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>;
};

const clients = new Map<string, McpClientRecord>();

export type ConnectOptions =
  | { kind: "stdio"; name: string; command: string; args?: string[]; env?: Record<string, string> }
  | { kind: "sse"; name: string; url: string }
  | { kind: "http"; name: string; url: string };

export function listClients(ownerId: number): Array<Omit<McpClientRecord, "client">> {
  return Array.from(clients.values())
    .filter((c) => c.ownerId === ownerId)
    .map(({ client: _client, ...rest }) => rest);
}

export async function connectClient(ownerId: number, opts: ConnectOptions): Promise<McpClientRecord> {
  const id = randomUUID();
  const client = new Client({ name: `novelforge-client-${ownerId}`, version: "1.0.0" }, { capabilities: {} });
  const rec: McpClientRecord = {
    id,
    ownerId,
    name: opts.name,
    transport: opts.kind,
    command: opts.kind === "stdio" ? opts.command : undefined,
    args: opts.kind === "stdio" ? opts.args : undefined,
    env: opts.kind === "stdio" ? opts.env : undefined,
    url: opts.kind === "sse" || opts.kind === "http" ? opts.url : undefined,
    status: "connecting",
    connectedAt: Date.now(),
    client,
    tools: [],
    prompts: [],
    resources: [],
  };
  clients.set(id, rec);

  try {
    let transport;
    if (opts.kind === "stdio") {
      transport = new StdioClientTransport({ command: opts.command, args: opts.args || [], env: opts.env as any });
    } else if (opts.kind === "sse") {
      transport = new SSEClientTransport(new URL(opts.url));
    } else {
      transport = new StreamableHTTPClientTransport(new URL(opts.url));
    }
    await client.connect(transport);

    // 缓存 tools / prompts / resources
    try {
      const toolsRes = await client.listTools();
      rec.tools = (toolsRes.tools || []).map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    } catch { rec.tools = []; }
    try {
      const promptsRes = await client.listPrompts();
      rec.prompts = (promptsRes.prompts || []).map((p: any) => ({ name: p.name, description: p.description, arguments: p.arguments }));
    } catch { rec.prompts = []; }
    try {
      const resRes = await client.listResources();
      rec.resources = (resRes.resources || []).map((r: any) => ({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType }));
    } catch { rec.resources = []; }

    rec.status = "ready";
    rec.errorMessage = undefined;
  } catch (err: any) {
    rec.status = "error";
    rec.errorMessage = String(err?.message || err);
    try { await client.close(); } catch { /* ignore */ }
  }
  return rec;
}

export async function disconnectClient(ownerId: number, id: string): Promise<boolean> {
  const rec = clients.get(id);
  if (!rec || rec.ownerId !== ownerId) return false;
  try { await rec.client.close(); } catch { /* ignore */ }
  clients.delete(id);
  return true;
}

export function getClient(ownerId: number, id: string): McpClientRecord | undefined {
  const rec = clients.get(id);
  if (!rec || rec.ownerId !== ownerId) return undefined;
  return rec;
}

export async function callTool(ownerId: number, id: string, toolName: string, args: any): Promise<any> {
  const rec = getClient(ownerId, id);
  if (!rec) throw new Error("客户端未找到或不属于当前用户");
  if (rec.status !== "ready") throw new Error(`客户端不可用：${rec.errorMessage || rec.status}`);
  return rec.client.callTool({ name: toolName, arguments: args || {} });
}

export async function readPrompt(ownerId: number, id: string, promptName: string, args?: any): Promise<any> {
  const rec = getClient(ownerId, id);
  if (!rec) throw new Error("客户端未找到或不属于当前用户");
  if (rec.status !== "ready") throw new Error(`客户端不可用：${rec.errorMessage || rec.status}`);
  return rec.client.getPrompt({ name: promptName, arguments: args || {} });
}

export async function readResource(ownerId: number, id: string, uri: string): Promise<any> {
  const rec = getClient(ownerId, id);
  if (!rec) throw new Error("客户端未找到或不属于当前用户");
  if (rec.status !== "ready") throw new Error(`客户端不可用：${rec.errorMessage || rec.status}`);
  return rec.client.readResource({ uri });
}

// 把外部 MCP 工具规范化为 Anthropic tool_use 格式，供 agent 循环直接使用
export function listAllExternalTools(ownerId: number): Array<{ id: string; clientName: string; toolName: string; description: string; inputSchema: any }> {
  return listClients(ownerId).flatMap((rec) =>
    rec.tools.map((t) => ({
      id: rec.id,
      clientName: rec.name,
      toolName: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || { type: "object", properties: {} },
    }))
  );
}
