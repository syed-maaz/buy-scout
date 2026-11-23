import { openDb } from "../db/index.js";
import { checkHealth } from "../core/health.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
const report = checkHealth(db);

console.log("source          enabled  status    last_ok                    last_new");
for (const source of report.sources) {
  console.log(
    `${source.id.padEnd(15)} ${String(source.enabled).padStart(7)}  ${source.status.padEnd(8)} ` +
      `${(source.lastOkAt ?? "—").padEnd(26)} ${source.lastNewAt ?? "—"}`,
  );
}

console.log("\nDB counts:", report.counts);
console.log(
  report.healthy
    ? `\nHEALTHY: newest successful insert ${report.lastNewAt ?? "—"}.`
    : `\nDEGRADED: ${report.warnings.join("; ")}.`,
);
if (!report.healthy) process.exitCode = 1;
