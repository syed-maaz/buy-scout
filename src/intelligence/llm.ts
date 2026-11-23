export interface LlmConfig {
  provider: "llm";
  baseUrl: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
  jsonMode: boolean;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

/**
 * One OpenAI-compatible provider per deployment. Change the base URL and model
 * for DeepSeek, OpenAI, OpenRouter, Ollama or a custom endpoint; there is no
 * provider switch and no fallback to another provider.
 */
export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const baseUrl = envValue(env, "LLM_BASE_URL");
  const model = envValue(env, "LLM_MODEL");
  const apiKey = envValue(env, "LLM_API_KEY");
  if (!baseUrl || !model) return null;
  if (!apiKey && envValue(env, "LLM_ALLOW_NO_KEY") !== "1") return null;

  const timeout = Number(envValue(env, "LLM_TIMEOUT_MS") ?? "30000");
  return {
    provider: "llm",
    baseUrl,
    model,
    apiKey,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000,
    jsonMode: envValue(env, "LLM_JSON_MODE") !== "0",
  };
}

export function llmStatus(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  model: string | null;
} {
  const config = readLlmConfig(env);
  return {
    configured: config !== null,
    model: config?.model ?? envValue(env, "LLM_MODEL"),
  };
}

function endpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

function stripFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

export interface LlmJsonResult {
  data: unknown;
  model: string;
  provider: "llm";
}

/**
 * Call the configured OpenAI-compatible chat endpoint and parse one JSON
 * object. Returns null on any transport, HTTP, shape or JSON failure.
 */
export async function callLlmJson(args: {
  system: string;
  user: string;
  timeoutMs: number;
}): Promise<LlmJsonResult | null> {
  const config = readLlmConfig();
  if (!config) return null;

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  try {
    const response = await fetch(endpoint(config.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
        temperature: 0.2,
        ...(config.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(args.timeoutMs),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    return {
      data: JSON.parse(stripFence(content)) as unknown,
      model: payload.model ?? config.model,
      provider: "llm",
    };
  } catch {
    return null;
  }
}
