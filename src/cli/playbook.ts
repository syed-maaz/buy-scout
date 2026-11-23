import { openDb } from "../db/index.js";
import {
  ACCESS_PLAYBOOK,
  formatRecommendations,
  playbookEntries,
  type AccessSymptom,
} from "../acquisition/playbook.js";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const db = openDb(arg("db", process.env.DB_PATH ?? "./data/buy-scout.db"));
const symptomArg = arg("symptom", "");
const symptoms = symptomArg
  ? [symptomArg as AccessSymptom]
  : playbookEntries().map((entry) => entry.symptom);

for (const symptom of symptoms) {
  const entry = ACCESS_PLAYBOOK[symptom];
  if (!entry) {
    console.error(`Unknown symptom: ${symptom}`);
    process.exitCode = 1;
    continue;
  }
  console.log(`\n## ${entry.symptom} — ${entry.label}`);
  console.log(formatRecommendations(entry.symptom));
}

const lessons = db
  .prepare(`SELECT scope, rule, evidence FROM rule_cards WHERE active = 1 ORDER BY scope, id`)
  .all() as Array<{ scope: string; rule: string; evidence: string | null }>;

console.log("\n## Approved lessons");
for (const lesson of lessons) {
  console.log(`- [${lesson.scope}] ${lesson.rule}`);
  if (lesson.evidence) console.log(`  evidence: ${lesson.evidence}`);
}

const attempts = db
  .prepare(
    `SELECT source, method, symptom, success, COUNT(*) AS n
       FROM access_attempts
      GROUP BY source, method, symptom, success
      ORDER BY source, method, symptom`,
  )
  .all() as Array<{ source: string; method: string; symptom: string | null; success: number; n: number }>;

console.log("\n## Attempt history");
for (const attempt of attempts) {
  console.log(
    `- ${attempt.source} | ${attempt.method} | ${attempt.symptom ?? "ok"} | ` +
      `${attempt.success ? "success" : "fail"} x${attempt.n}`,
  );
}
