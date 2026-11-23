import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db/index.js";

test("a fresh database has the canonical source registry", () => {
  const dir = mkdtempSync(join(tmpdir(), "buy-scout-sources-"));
  const db = openDb(join(dir, "test.db"));
  try {
    const rows = (db
      .prepare("SELECT id, enabled, status FROM sources ORDER BY id")
      .all() as Array<{ id: string; enabled: number; status: string }>).map((row) => ({
      id: row.id,
      enabled: row.enabled,
      status: row.status,
    }));
    assert.deepEqual(rows, [
      { id: "autoscout24", enabled: 1, status: "working" },
      { id: "autouncle", enabled: 0, status: "blocked" },
      { id: "kleinanzeigen", enabled: 1, status: "working" },
      { id: "mobile_de", enabled: 0, status: "blocked" },
    ]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
