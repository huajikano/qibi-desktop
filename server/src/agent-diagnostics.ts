// Agent 错误诊断助手模块
// 将常见错误转化为用户可理解的诊断建议

export interface DiagnosticResult {
  error: string;
  diagnosis: string;
  suggestions: string[];
  severity: "low" | "medium" | "high";
}

export function diagnoseAgentError(err: any, context?: { baseUrl?: string; model?: string }): DiagnosticResult {
  const errorMsg = err?.message || String(err);
  const errorLower = errorMsg.toLowerCase();

  // 1. API Key 问题
  if (errorLower.includes("401") || errorLower.includes("unauthorized") || errorLower.includes("invalid_api_key")) {
    return {
      error: errorMsg,
      diagnosis: "API 密钥验证失败",
      suggestions: [
        "检查「设置」→「管家 Agent」中的 API Key 是否正确填写",
        "确认 API Key 是否已过期或被撤销",
        "如果使用站方配置，请联系管理员确认站方密钥状态",
        "尝试重新保存 API Key（有时会因加密问题导致验证失败）"
      ],
      severity: "high"
    };
  }

  // 2. 工具调用不支持
  if (errorLower.includes("tool") || errorLower.includes("function") || errorLower.includes("not support")) {
    return {
      error: errorMsg,
      diagnosis: "当前模型不支持工具调用（Function Calling）",
      suggestions: [
        `当前模型: ${context?.model || "未知"}`,
        "推荐使用支持工具调用的模型：Claude 3.5+ / GPT-4 / GPT-4o / DeepSeek V3",
        "检查「设置」→「管家 Agent」→「模型名称」是否填写正确",
        "如果使用自定义端点，确认该端点完整支持 OpenAI Function Calling 或 Anthropic Tools 协议"
      ],
      severity: "high"
    };
  }

  // 3. 上下文长度溢出
  if (errorLower.includes("context") || errorLower.includes("max_tokens") || errorLower.includes("too long")) {
    return {
      error: errorMsg,
      diagnosis: "上下文长度超限（小说内容或对话历史过长）",
      suggestions: [
        "尝试删减部分历史章节或细纲，保留最近 20-30 章即可",
        "使用更大上下文的模型（如 Claude 3.7: 200K, GPT-4o: 128K）",
        "简化 Agent 任务指令，避免一次性处理过多章节",
        "清理创作进度中的冗余备注与伏笔记录"
      ],
      severity: "medium"
    };
  }

  // 4. 网络连接问题
  if (errorLower.includes("timeout") || errorLower.includes("econnrefused") || errorLower.includes("network")) {
    return {
      error: errorMsg,
      diagnosis: "网络连接失败或超时",
      suggestions: [
        `当前端点: ${context?.baseUrl || "未知"}`,
        "检查网络连接是否正常",
        "如果使用自定义端点，确认地址格式正确（如 http://127.0.0.1:15721/v1）",
        "尝试切换到官方端点或其他可用代理",
        "检查防火墙或代理设置是否阻止了连接"
      ],
      severity: "high"
    };
  }

  // 5. 速率限制
  if (errorLower.includes("429") || errorLower.includes("rate limit") || errorLower.includes("quota")) {
    return {
      error: errorMsg,
      diagnosis: "API 速率限制或配额用尽",
      suggestions: [
        "等待 1-5 分钟后重试（速率限制通常会自动解除）",
        "检查 API 账户余额是否充足",
        "如果使用免费 API，考虑升级到付费套餐",
        "降低 Agent 任务频率，避免短时间内大量调用"
      ],
      severity: "medium"
    };
  }

  // 6. 数据库锁定
  if (errorLower.includes("database is locked") || errorLower.includes("sqlite")) {
    return {
      error: errorMsg,
      diagnosis: "数据库被占用（多个操作同时访问）",
      suggestions: [
        "稍等片刻后重试（数据库锁通常在几秒内释放）",
        "避免同时运行多个 Agent 任务",
        "关闭其他可能正在访问数据库的程序"
      ],
      severity: "low"
    };
  }

  // 7. 工具执行失败
  if (errorLower.includes("无权") || errorLower.includes("不存在") || errorLower.includes("permission")) {
    return {
      error: errorMsg,
      diagnosis: "工具执行权限不足或目标数据不存在",
      suggestions: [
        "检查操作的章节/小说 ID 是否正确",
        "确认当前用户拥有该作品的访问权限",
        "尝试刷新页面后重新操作",
        "如果问题持续，可能是数据库记录已被删除"
      ],
      severity: "medium"
    };
  }

  // 8. JSON 解析错误
  if (errorLower.includes("json") || errorLower.includes("parse")) {
    return {
      error: errorMsg,
      diagnosis: "模型返回格式异常（JSON 解析失败）",
      suggestions: [
        "这通常是模型输出格式不规范导致的临时问题",
        "重新运行相同任务，问题可能消失",
        "简化任务指令，使用更明确的语言描述需求",
        "如果持续失败，尝试更换模型"
      ],
      severity: "low"
    };
  }

  // 默认：未知错误
  return {
    error: errorMsg,
    diagnosis: "未知错误",
    suggestions: [
      "查看完整错误信息以获取更多线索",
      "尝试重新运行任务",
      "简化任务指令或减少一次性处理的数据量",
      "如果问题持续，请联系技术支持并提供错误日志"
    ],
    severity: "medium"
  };
}

// 格式化诊断结果为用户友好的文本
export function formatDiagnosticMessage(diagnostic: DiagnosticResult): string {
  const icon = diagnostic.severity === "high" ? "🚨" : diagnostic.severity === "medium" ? "⚠️" : "ℹ️";

  let message = `${icon} **${diagnostic.diagnosis}**\n\n`;
  message += `**错误详情**: ${diagnostic.error}\n\n`;
  message += `**建议解决方案**:\n`;

  diagnostic.suggestions.forEach((suggestion, i) => {
    message += `${i + 1}. ${suggestion}\n`;
  });

  return message;
}
