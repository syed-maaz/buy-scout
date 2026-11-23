export interface LlmConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  timeoutMs: number;
  jsonMode: boolean;
}

interface ProviderPreset {
  baseUrl?: string;
  model?: string;
  requiresKey: boolean;
}

const PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4.1-flash",
    requiresKey: true,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    requiresKey: true,
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    requiresKey: true,
  },
  ollama: {
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "llama3.1",
    requiresKey: false,
  },
};

function envValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

/**
 * One OpenAI-compatible chat config for every provider. LLM_* wins; the old
 * DEEPSEEK_* variables remain supported when the provider is deepseek.
 */
export function readLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const provider = (envValue(env, "LLM_PROVIDER") ?? "deepseek").toLowerCase();
  const preset = PRESETS[provider] ?? { requiresKey: true };
  const isDeepSeek = provider === "deepseek";
  const baseUrl =
    envValue(env, "LLM_BASE_URL") ??
    (isDeepSeek ? envValue(env, "DEEPSEEK_BASE_URL") : null) ??
    preset.baseUrl ??
    null;
  const model =
    envValue(env, "LLM_MODEL") ??
    (isDeepSeek ? envValue(env, "DEEPSEEK_MODEL") : null) ??
    preset.model ??
    null;
  const apiKey =
    envValue(env, "LLM_API_KEY") ??
    (isDeepSeek ? envValue(env, "DEEPSEEK_API_KEY") : null);
  const allowNoKey = envValue(env, "LLM_ALLOW_NO_KEY") === "1" || !preset.requiresKey;

  if (!baseUrl || !model) return null;
  if (!apiKey && !allowNoKey) return null;

  const timeout = Number(envValue(env, "LLM_TIMEOUT_MS") ?? "30000");
  return {
    provider,
    baseUrl,
    model,
    apiKey,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 30_000,
    jsonMode: envValue(env, "LLM_JSON_MODE") !== "0",
  };
}

export function llmStatus(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  provider: string;
  model: string | null;
} {
  const config = readLlmConfig(env);
  return {
    configured: config !== null,
    provider: (envValue(env, "LLM_PROVIDER") ?? "deepseek").toLowerCase(),
    model: config?.model ?? (envValue(env, "LLM_MODEL") ?? envValue(env, "DEEPSEEK_MODEL")),
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
  provider: string;
}

/**
 * Call an OpenAI-compatible chat endpoint and parse one JSON object. Returns
 * null on any transport, HTTP, shape or JSON failure so callers can fall back.
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
      provider: config.provider,
    };
  } catch {
    return null;
  }
}
