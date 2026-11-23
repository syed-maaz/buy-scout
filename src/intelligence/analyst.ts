import { z } from "zod";
import type { NormalisedListing } from "../core/types.js";
import type { CarEvaluation } from "../domain/cars/evaluate.js";
import { callLlmJson, readLlmConfig } from "./llm.js";

const AnalysisSchema = z.object({
  summary: z.string(),
  contradictions: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  negotiation: z.array(z.string()).default([]),
  risk_notes: z.array(z.string()).default([]),
});

export type ListingAnalysis = z.infer<typeof AnalysisSchema> & {
  source: "llm" | "fallback";
  provider: string;
  model: string;
  generatedAt: string;
};

function fallbackQuestions(listing: NormalisedListing, evaluation: CarEvaluation): string[] {
  const questions: string[] = [];
  if (listing.hasIsofix === null) questions.push("Ist ISOFIX vorhanden? Bitte Ausstattungsliste/Fotos senden.");
  if (listing.seats === null) questions.push("Wie viele Sitzplätze hat das Fahrzeug?");
  if (listing.doors === null) questions.push("Ist es ein 5-Türer?");
  if (!listing.huDue) questions.push("Wann ist die nächste HU/AU fällig? Bitte HU-Bericht senden.");
  if (!listing.description?.match(/scheckheft|service|wartung/i)) {
    questions.push("Ist das Fahrzeug scheckheftgepflegt? Bitte Servicehistorie senden.");
  }
  questions.push("Ist das Fahrzeug unfallfrei? Bitte VIN und HU-Bericht senden.");
  questions.push("Wie viele Vorbesitzer gibt es, und warum wird das Auto verkauft?");
  if (evaluation.unknowns.length > 0) {
    questions.push(`Bitte bestätigen: ${evaluation.unknowns.join(", ")}.`);
  }
  return [...new Set(questions)].slice(0, 8);
}

export function fallbackAnalysis(
  listing: NormalisedListing,
  evaluation: CarEvaluation,
): ListingAnalysis {
  const summary = evaluation.hardFailures.length
    ? `Hard fail: ${evaluation.hardFailures.join("; ")}`
    : `Verdict ${evaluation.verdict} with score ${evaluation.score}. ${evaluation.reasons.join("; ")}`;

  const contradictions = evaluation.unknowns.map((field) => `${field} is not stated in the listing`);

  return {
    summary,
    contradictions,
    questions: fallbackQuestions(listing, evaluation),
    negotiation: [
      "Angebot nur unter Vorbehalt der Besichtigung und HU-Prüfung.",
      "Bei fehlender Servicehistorie oder Mängeln Preisnachlass verhandeln.",
      "Keine Anzahlung vor Besichtigung und VIN-Abgleich.",
    ],
    risk_notes: listing.redFlags,
    source: "fallback",
    provider: "none",
    model: "deterministic-fallback",
    generatedAt: new Date().toISOString(),
  };
}

export async function analyzeListing(
  listing: NormalisedListing,
  evaluation: CarEvaluation,
): Promise<ListingAnalysis> {
  const config = readLlmConfig();
  if (!config) return fallbackAnalysis(listing, evaluation);

  const prompt = `Du bist ein deutscher Gebrauchtwagen-Analyst. Analysiere nur die gelieferten Daten; erfinde keine Historie, keinen VIN und keine Unfallfreiheit.

Listing:
${JSON.stringify(listing, null, 2)}

Regel-Ergebnis:
${JSON.stringify(evaluation, null, 2)}

Antworte ausschließlich als JSON:
{
  "summary": "string",
  "contradictions": ["string"],
  "questions": ["string"],
  "negotiation": ["string"],
  "risk_notes": ["string"]
}`;

  const result = await callLlmJson({
    system: "Du antwortest nur mit validem JSON. Keine Halluzinationen.",
    user: prompt,
    timeoutMs: config.timeoutMs,
  });
  if (!result) return fallbackAnalysis(listing, evaluation);

  const parsed = AnalysisSchema.safeParse(result.data);
  if (!parsed.success) return fallbackAnalysis(listing, evaluation);

  return {
    ...parsed.data,
    source: "llm",
    provider: result.provider,
    model: result.model,
    generatedAt: new Date().toISOString(),
  };
}
