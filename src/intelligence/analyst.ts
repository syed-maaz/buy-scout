import { z } from "zod";
import type { NormalisedListing } from "../core/types.js";
import type { CarEvaluation } from "../domain/cars/evaluate.js";
import { callLlmJson, languageName, readLlmConfig } from "./llm.js";

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
  if (listing.hasIsofix === null) questions.push("Is ISOFIX present? Please send the equipment list or photos.");
  if (listing.seats === null) questions.push("How many seats does the car have?");
  if (listing.doors === null) questions.push("Is it a five-door?");
  if (!listing.huDue) questions.push("When is the next HU/AU due? Please send the inspection report.");
  if (!listing.description?.match(/scheckheft|service|wartung/i)) {
    questions.push("Does it have a full service history? Please send the service records.");
  }
  questions.push("Is the car accident-free? Please send the VIN and HU report.");
  questions.push("How many previous owners are there, and why is the car being sold?");
  if (evaluation.unknowns.length > 0) {
    questions.push(`Please confirm: ${evaluation.unknowns.join(", ")}.`);
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
      "Make an offer subject to inspection and a valid HU report.",
      "Negotiate a discount for missing service history or defects.",
      "Do not pay a deposit before inspection and VIN verification.",
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

  const compactListing = {
    title: listing.title,
    make: listing.make,
    model: listing.model,
    variant: listing.variant,
    year: listing.firstRegistration,
    priceEur: listing.priceEur,
    mileageKm: listing.mileageKm,
    fuel: listing.fuel,
    transmission: listing.transmission,
    bodyType: listing.bodyType,
    seats: listing.seats,
    doors: listing.doors,
    hasIsofix: listing.hasIsofix,
    huDue: listing.huDue,
    sellerType: listing.sellerType,
    city: listing.city,
    distanceKm: listing.distanceKm,
    priceLabel: listing.priceLabel,
    priceMedianEur: listing.priceMedianEur,
    damaged: listing.damaged,
    redFlags: listing.redFlags,
    equipment: listing.equipment.slice(0, 30),
    description: listing.description?.slice(0, 1200) ?? null,
  };
  const compactEvaluation = {
    verdict: evaluation.verdict,
    hardPass: evaluation.hardPass,
    score: evaluation.score,
    confidence: evaluation.confidence,
    reasons: evaluation.reasons,
    hardFailures: evaluation.hardFailures,
    unknowns: evaluation.unknowns,
  };
  const language = languageName(config);
  const prompt = `You are a used-car analyst. Analyse only the supplied data; do not invent history, a VIN or accident freedom. Answer every prose field in ${language}.

Listing:
${JSON.stringify(compactListing)}

Regel-Ergebnis:
${JSON.stringify(compactEvaluation)}

Return only JSON, with all prose in ${language}:
{
  "summary": "string",
  "contradictions": ["string"],
  "questions": ["string"],
  "negotiation": ["string"],
  "risk_notes": ["string"]
}`;

  const result = await callLlmJson({
    system: `Answer in ${language}. Return only valid JSON. Do not hallucinate.`,
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
