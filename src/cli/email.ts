import { readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEmailFile, type EmailLead } from "../ingest/email.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const dir = resolve(arg("dir", "./data/emails"));
const out = resolve(arg("out", "./data/email-leads.json"));
const leads: EmailLead[] = [];

try {
  for (const file of readdirSync(dir)) {
    if (!/\.(eml|html?|txt)$/i.test(file)) continue;
    leads.push(...parseEmailFile(join(dir, file)));
  }
} catch (error) {
  console.error(`Cannot read ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

const unique = [...new Map(leads.map((lead) => [lead.url, lead])).values()];
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), leads: unique }, null, 2), "utf8");

const bySource = unique.reduce<Record<string, number>>((acc, lead) => {
  acc[lead.source] = (acc[lead.source] ?? 0) + 1;
  return acc;
}, {});

console.log(`Read ${leads.length} links; ${unique.length} unique.`);
console.log(bySource);
console.log(`Wrote ${out}`);
