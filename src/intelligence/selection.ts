import type { AnalysisSettings, NormalisedListing, SearchBrief } from "../core/types.js";
import type { CarEvaluation } from "../domain/cars/evaluate.js";

export interface ScoredListing {
  listing: NormalisedListing;
  evaluation: CarEvaluation;
}

export interface AnalysisSelection {
  items: ScoredListing[];
  considered: number;
  minScore: number;
  minConfidence: number;
  maxCards: number;
  reason: string;
}

export function selectAnalysisCandidates(
  brief: SearchBrief,
  scored: ScoredListing[],
  overrides: Partial<Pick<AnalysisSettings, "minScore" | "minConfidence" | "maxCards">> = {},
): AnalysisSelection {
  const settings = brief.analysis ?? { minScore: 60, minConfidence: 0.6, maxCards: 30, autoRun: false };
  const minScore = overrides.minScore ?? settings.minScore;
  const minConfidence = overrides.minConfidence ?? settings.minConfidence;
  const maxCards = Math.max(1, Math.min(100, overrides.maxCards ?? settings.maxCards));

  const eligible = scored
    .filter(({ evaluation }) => evaluation.verdict !== "reject")
    .filter(({ evaluation }) => evaluation.score >= minScore && evaluation.confidence >= minConfidence)
    .sort((a, b) => b.evaluation.score - a.evaluation.score);

  return {
    items: eligible.slice(0, maxCards),
    considered: eligible.length,
    minScore,
    minConfidence,
    maxCards,
    reason:
      `${eligible.length} non-rejected cards >= score ${minScore} and confidence ${minConfidence}; ` +
      `analyzing ${Math.min(eligible.length, maxCards)} (cap ${maxCards})`,
  };
}
