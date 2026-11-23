import test from "node:test";
import assert from "node:assert/strict";
import { callLlmJson, readLlmConfig } from "../src/intelligence/llm.js";

test("reads a generic OpenAI-compatible provider", () => {
  const config = readLlmConfig({
    LLM_PROVIDER: "openai",
    LLM_BASE_URL: "https://example.test/v1",
    LLM_MODEL: "test-model",
    LLM_API_KEY: "test-key",
  });
  assert.equal(config?.provider, "openai");
  assert.equal(config?.baseUrl, "https://example.test/v1");
  assert.equal(config?.model, "test-model");
});

test("uses provider defaults when base and model are omitted", () => {
  const config = readLlmConfig({ LLM_PROVIDER: "openai", LLM_API_KEY: "test-key" });
  assert.equal(config?.provider, "openai");
  assert.equal(config?.baseUrl, "https://api.openai.com/v1");
  assert.equal(config?.model, "gpt-4o-mini");
});

test("allows a local Ollama endpoint without a key", () => {
  const config = readLlmConfig({
    LLM_PROVIDER: "ollama",
    LLM_BASE_URL: "http://127.0.0.1:11434/v1",
    LLM_MODEL: "llama3.1",
  });
  assert.equal(config?.provider, "ollama");
  assert.equal(config?.apiKey, null);
});

test("calls /chat/completions and accepts fenced JSON", async () => {
  const originalFetch = globalThis.fetch;
  const original = { ...process.env };
  process.env.LLM_PROVIDER = "custom";
  process.env.LLM_BASE_URL = "https://example.test/v1";
  process.env.LLM_MODEL = "test-model";
  process.env.LLM_API_KEY = "test-key";
  let calledUrl = "";
  globalThis.fetch = (async (input: string | URL) => {
    calledUrl = String(input);
    return {
      ok: true,
      json: async () => ({
        model: "served-model",
        choices: [{ message: { content: '```json\n{"summary":"ok"}\n```' } }],
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const result = await callLlmJson({ system: "s", user: "u", timeoutMs: 1000 });
    assert.equal(calledUrl, "https://example.test/v1/chat/completions");
    assert.deepEqual(result?.data, { summary: "ok" });
    assert.equal(result?.provider, "custom");
    assert.equal(result?.model, "served-model");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = original;
  }
});
