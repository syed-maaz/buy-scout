import test from "node:test";
import assert from "node:assert/strict";
import { callLlmJson, readLlmConfig } from "../src/intelligence/llm.js";

test("reads the single configured endpoint", () => {
  const config = readLlmConfig({
    LLM_BASE_URL: "https://example.test/v1",
    LLM_MODEL: "test-model",
    LLM_API_KEY: "test-key",
  });
  assert.equal(config?.provider, "llm");
  assert.equal(config?.baseUrl, "https://example.test/v1");
  assert.equal(config?.model, "test-model");
});

test("refuses an incomplete endpoint", () => {
  assert.equal(readLlmConfig({ LLM_MODEL: "test-model", LLM_API_KEY: "test-key" }), null);
  assert.equal(readLlmConfig({ LLM_BASE_URL: "https://example.test/v1", LLM_API_KEY: "test-key" }), null);
});

test("allows a keyless local endpoint only when explicitly enabled", () => {
  const env = {
    LLM_BASE_URL: "http://127.0.0.1:11434/v1",
    LLM_MODEL: "llama3.1",
  };
  assert.equal(readLlmConfig(env), null);
  assert.equal(readLlmConfig({ ...env, LLM_ALLOW_NO_KEY: "1" })?.apiKey, null);
});

test("calls /chat/completions and accepts fenced JSON", async () => {
  const originalFetch = globalThis.fetch;
  const original = { ...process.env };
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
    assert.equal(result?.provider, "llm");
    assert.equal(result?.model, "served-model");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = original;
  }
});
