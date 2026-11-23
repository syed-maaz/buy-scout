import test from "node:test";
import assert from "node:assert/strict";
import { defaultBrief } from "../src/core/brief.js";
import { buildKleinanzeigenUrl } from "../src/sources/kleinanzeigen.js";

test("Kleinanzeigen search carries the configured ZIP and radius", () => {
  const url = new URL(buildKleinanzeigenUrl(defaultBrief(), 1));
  assert.equal(url.searchParams.get("locationStr"), "69168");
  assert.equal(url.searchParams.get("radius"), "200");
  assert.equal(url.searchParams.get("price_to"), "7000");
});

test("Kleinanzeigen pagination keeps the location filters", () => {
  const url = new URL(buildKleinanzeigenUrl(defaultBrief(), 3));
  assert.equal(url.searchParams.get("page"), "3");
  assert.equal(url.searchParams.get("locationStr"), "69168");
  assert.equal(url.searchParams.get("radius"), "200");
});
