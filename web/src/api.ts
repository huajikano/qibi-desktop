import type {
  Chapter,
  DistilledAuthor,
  DistilledAuthorDetail,
  DistilledAuthorSource,
  DistilledAuthorVersion,
  NovelWriterState,
} from "./types";

// 统一 API 客户端：同源 cookie 会话，错误归一化
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

// 章节正文专用保存：text/plain 直传，避免大段正文走 JSON 转义与 2MB 请求体限制
export async function saveChapterContent(chapterId: number, content: string): Promise<Chapter> {
  const res = await fetch(`/api/chapters/${chapterId}/content`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: content,
  });
  if (!res.ok) {
    let msg = `正文保存失败 (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  const payload = (await res.json()) as { ok: boolean; chapter: Chapter };
  return payload.chapter;
}

// AI 流式请求（SSE）
// SSE 流通用读取器：按空行切事件，解析 data:（可多行）/ event: 字段，逐事件回调。
// 返回值由调用方决定（last 事件或拼接全文），这里只负责传输与解析。
export async function readSseEvents(
  res: Response,
  onEvent: (eventName: string, payload: any) => void | boolean // 返回 true 表示结束并提前返回
): Promise<void> {
  if (!res.body) throw new ApiError(502, "服务没有返回响应内容");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const handle = (event: string): boolean => {
    let name = "message";
    const data = event
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => line.startsWith("data:") || line.startsWith("event:"))
      .map((line) => {
        if (line.startsWith("event:")) {
          name = line.slice(6).trim();
          return null;
        }
        return line.slice(5).trimStart();
      })
      .filter((x): x is string => x !== null)
      .join("\n");
    if (!data) return false;
    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new ApiError(502, "流式响应格式无效");
    }
    return onEvent(name, payload) === true;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const event of events) if (handle(event)) return;
  }
  buf += decoder.decode();
  if (buf.trim()) handle(buf);
}

// 统一的 AI SSE POST：错误归一化后交给 readSseEvents
export async function ssePost(
  url: string,
  body: unknown,
  onEvent: (eventName: string, payload: any) => void | boolean,
  options?: { signal?: AbortSignal; failMessage?: string; invalidMessage?: string }
): Promise<Response> {
  const res = await fetch(`/api${url}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!res.ok) {
    let msg = options?.failMessage || "请求失败";
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, msg);
  }
  return res;
}

export async function aiStream(
  url: string,
  body: unknown,
  onDelta: (text: string) => void,
  options?: { signal?: AbortSignal }
): Promise<string> {
  const res = await ssePost(url, body, () => {}, { ...options, failMessage: "AI 请求失败" });
  let full = "";
  let receivedDone = false;
  await readSseEvents(res, (_name, payload) => {
    if (payload.type === "delta" && typeof payload.text === "string") {
      full += payload.text;
      onDelta(payload.text);
    } else if (payload.type === "error") {
      throw new ApiError(Number(payload.status) || 502, payload.error || "AI 请求失败");
    } else if (payload.type === "done") {
      receivedDone = true;
      return true;
    }
    return false;
  });
  if (!receivedDone) throw new ApiError(502, "AI 连接提前结束，请重试");
  if (!full.trim()) throw new ApiError(502, "AI 服务没有返回可显示的文本");
  return full;
}

export interface DistillSseEvent {
  type: "stage" | "delta" | "preview" | "done" | "error";
  stage?: string;
  status?: string;
  text?: string;
  error?: string;
  author?: DistilledAuthor;
  version?: DistilledAuthorVersion;
}

async function binaryRequest(url: string, body: BodyInit, headers: Record<string, string> = {}) {
  const res = await fetch(`/api${url}`, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body,
  });
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const payload = await res.json();
      if (payload?.error) message = payload.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

export async function uploadSourceFile(
  authorId: number,
  file: File,
  options?: { kind?: "novel" | "comment" | "social"; onProgress?: (received: number, total: number) => void }
): Promise<DistilledAuthorSource> {
  const init = await api.post<{ uploadId: number }>(`/skill-authors/${authorId}/sources/init`, {
    filename: file.name,
    format: file.name.split(".").pop()?.toLowerCase(),
    kind: options?.kind || "novel",
    size: file.size,
  });
  const chunkSize = 8 * 1024 * 1024;
  let offset = 0;
  while (offset < file.size) {
    const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
    const result = await binaryRequest(`/skill-authors/sources/${init.uploadId}/chunk`, chunk, {
      "Content-Type": "application/octet-stream",
      "X-Upload-Offset": String(offset),
    }) as { received: number };
    offset = result.received;
    options?.onProgress?.(offset, file.size);
  }
  return api.post<DistilledAuthorSource>(`/skill-authors/sources/${init.uploadId}/complete`);
}

export async function distillAuthorStream(
  authorId: number,
  body: { sourceIds?: number[] },
  onEvent: (event: DistillSseEvent) => void,
  options?: { signal?: AbortSignal; evolve?: boolean }
): Promise<DistillSseEvent> {
  const url = `/skill-authors/${authorId}/${options?.evolve ? "evolve" : "distill"}`;
  const res = await ssePost(url, body, () => {}, { ...options, failMessage: "蒸馏请求失败" });
  let last: DistillSseEvent = { type: "done" };
  await readSseEvents(res, (_name, payload) => {
    last = payload as DistillSseEvent;
    onEvent(payload);
    if (payload.type === "error") throw new ApiError(502, payload.error || "蒸馏失败");
    return false;
  });
  return last;
}

export const skillAuthorApi = {
  list: () => api.get<DistilledAuthor[]>("/skill-authors"),
  detail: (id: number) => api.get<DistilledAuthorDetail>(`/skill-authors/${id}`),
  create: (name: string, profile?: Record<string, unknown>) => api.post<DistilledAuthor>("/skill-authors", { name, profile }),
  update: (id: number, body: { name?: string; profile?: Record<string, unknown> }) => api.patch<DistilledAuthor>(`/skill-authors/${id}`, body),
  remove: (id: number) => api.del<void>(`/skill-authors/${id}`),
  removeSource: (id: number) => api.del<void>(`/skill-authors/sources/${id}`),
  versions: (id: number) => api.get<DistilledAuthorVersion[]>(`/skill-authors/${id}/versions`),
  rollback: (id: number, versionId: number) => api.post<DistilledAuthor>(`/skill-authors/${id}/versions/${versionId}/rollback`),
};

export const writerStateApi = {
  get: (novelId: number) => api.get<NovelWriterState>(`/novels/${novelId}/writer-state`),
  update: (novelId: number, body: Partial<Pick<NovelWriterState, "distilled_author_id" | "progress" | "foreshadowing">>) =>
    api.patch<NovelWriterState>(`/novels/${novelId}/writer-state`, body),
};


export const chapterRevisionApi = {
  list: (chapterId: number) =>
    api.get<import("./types").ChapterRevision[]>(`/chapters/${chapterId}/revisions`),
  get: (chapterId: number, revisionId: number) =>
    api.get<import("./types").ChapterRevision>(`/chapters/${chapterId}/revisions/${revisionId}`),
  create: (chapterId: number, data: { title?: string; content?: string; reason?: string }) =>
    api.post<import("./types").ChapterRevision>(`/chapters/${chapterId}/revisions`, data),
  restore: (chapterId: number, revisionId: number) =>
    api.post<{ ok: boolean; chapter: import("./types").Chapter }>(`/chapters/${chapterId}/revisions/${revisionId}/restore`),
};


export const characterAiApi = {
  extract: (novelId: number, options?: { scope?: "all" | "recent"; maxChapters?: number }) =>
    api.post<{ characters: import("./types").Character[]; analyzedChapters: number }>(`/novels/${novelId}/characters/ai-extract`, options),
  batchImport: (novelId: number, characters: Partial<import("./types").Character>[]) =>
    api.post<{ ok: boolean; inserted: number; updated: number; characters: import("./types").Character[] }>(`/novels/${novelId}/characters/batch-import`, { characters }),
};


export const mapAiApi = {
  enrich: (novelId: number, mapId: number) =>
    api.post<{
      ok: boolean;
      analyzedChapters: number;
      shapes: import("./types").MapShape[];
      labels: import("./types").MapLabel[];
      paths: import("./types").MapPath[];
    }>(`/novels/${novelId}/maps/${mapId}/ai-enrich`),
};
