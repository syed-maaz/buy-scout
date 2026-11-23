import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyAccessFailure,
  recommendStrategies,
  formatRecommendations,
  playbookEntries,
} from "../src/acquisition/playbook.js";

test("classifies HTTP 403", () => {
  assert.equal(classifyAccessFailure(new Error("HTTP 403"), { status: 403 }), "http_403");
});

test("classifies Cloudflare challenge", () => {
  assert.equal(
    classifyAccessFailure(new Error("Just a moment..."), { body: "Sicherheitsüberprüfung" }),
    "cloudflare",
  );
});

test("classifies ignored filters", () => {
  assert.equal(
    classifyAccessFailure(new Error("result set implausibly broad: 212501 listings")),
    "filter_ignored",
  );
});

test("classifies truncated payload", () => {
  assert.equal(
    classifyAccessFailure(new Error("AutoUncle/Jina: body too small (6106 bytes)")),
    "empty_payload",
  );
});

test("cloudflare recommends Jina Reader first", () => {
  assert.equal(recommendStrategies("cloudflare")[0].strategy, "jina_reader");
});

test("playbook covers all symptoms and formats recommendations", () => {
  const entries = playbookEntries();
  assert.ok(entries.length >= 9);
  const text = formatRecommendations("filter_ignored");
  assert.match(text, /local_filter/);
  assert.match(text, /firecrawl_actions/);
});
