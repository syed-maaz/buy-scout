import test from "node:test";
import assert from "node:assert/strict";
import { AutoScout24Adapter } from "../src/sources/autoscout24.js";
import { KleinanzeigenAdapter } from "../src/sources/kleinanzeigen.js";
import type { RawRef } from "../src/core/types.js";

function ref(source: "autoscout24" | "kleinanzeigen", url = "https://example.test/car"): RawRef {
  return { source, externalId: "x", url, page: 0, payload: {} };
}

async function withFetch(
  mock: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = mock as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("AutoScout24 availability distinguishes 410, a gone shell and a live page", async () => {
  const adapter = new AutoScout24Adapter();
  await withFetch(async (input) => {
    const url = String(input);
    if (url.endsWith("/410")) return new Response("", { status: 410 });
    if (url.endsWith("/gone")) return new Response('<div class="GonePage_title__x">gone</div>', { status: 200 });
    if (url.endsWith("/blocked")) return new Response("<html>Zugriff verweigert</html>", { status: 200 });
    return new Response(
      '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"listingDetails":{}}}}</script>',
      { status: 200 },
    );
  }, async () => {
    assert.equal(await adapter.checkAvailability(ref("autoscout24", "https://example.test/410")), "gone");
    assert.equal(await adapter.checkAvailability(ref("autoscout24", "https://example.test/gone")), "gone");
    assert.equal(await adapter.checkAvailability(ref("autoscout24", "https://example.test/live")), "available");
    assert.equal(await adapter.checkAvailability(ref("autoscout24", "https://example.test/blocked")), "unknown");
  });
});

test("AutoScout24 availability returns unknown on a network error", async () => {
  const adapter = new AutoScout24Adapter();
  await withFetch(async () => { throw new Error("timeout"); }, async () => {
    assert.equal(await adapter.checkAvailability(ref("autoscout24")), "unknown");
  });
});

test("Kleinanzeigen availability treats 404 and the gone notice as gone", async () => {
  const adapter = new KleinanzeigenAdapter();
  await withFetch(async (input) => {
    const url = String(input);
    if (url.endsWith("/404")) return new Response("", { status: 404 });
    if (url.endsWith("/gone")) return new Response("Anzeige ist nicht mehr verfügbar", { status: 200 });
    if (url.endsWith("/blocked")) return new Response("<html>Bitte bestätigen Sie, dass Sie ein Mensch sind.</html>", { status: 200 });
    return new Response('<div data-adid="123"><h1>Kia Ceed</h1><p>4.250 €</p></div>', { status: 200 });
  }, async () => {
    assert.equal(await adapter.checkAvailability(ref("kleinanzeigen", "https://example.test/404")), "gone");
    assert.equal(await adapter.checkAvailability(ref("kleinanzeigen", "https://example.test/gone")), "gone");
    assert.equal(await adapter.checkAvailability(ref("kleinanzeigen", "https://example.test/live")), "available");
    assert.equal(await adapter.checkAvailability(ref("kleinanzeigen", "https://example.test/blocked")), "unknown");
  });
});
