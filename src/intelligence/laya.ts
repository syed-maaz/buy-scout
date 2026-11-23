import type { Question } from "@receptron/laya";
import type { NormalisedListing, SearchBrief } from "../core/types.js";
import type { CarEvaluation } from "../domain/cars/evaluate.js";

let instance: Promise<import("@receptron/laya").Laya> | null = null;

export function layaEnabled(): boolean {
  return process.env.LAYA_ENABLED !== "0";
}

export async function getLaya(): Promise<import("@receptron/laya").Laya> {
  if (!instance) {
    instance = (async () => {
      const { Laya } = await import("@receptron/laya");
      return Laya.load({
        subfolder: process.env.LAYA_SUBFOLDER ?? "",
        revision: process.env.LAYA_REVISION,
        cacheDir: process.env.LAYA_CACHE,
      });
    })();
  }
  return instance;
}

export interface LayaClassification {
  enabled: boolean;
  model: string | null;
  familyFit: { choice: string; confidence: number } | null;
  risk: { score: number; confidence: number } | null;
  action: { choice: string; confidence: number } | null;
  deal: { noul: number; confidence: number } | null;
  confidence: number;
  deferToDeepSeek: boolean;
  reason: string;
}

function compactState(listing: NormalisedListing): Record<string, unknown> {
  return {
    title: listing.title,
    make: listing.make,
    model: listing.model,
    year: listing.firstRegistration?.slice(0, 4) ?? null,
    price_eur: listing.priceEur,
    mileage_km: listing.mileageKm,
    fuel: listing.fuel,
    transmission: listing.transmission,
    body_type: listing.bodyType,
    seats: listing.seats,
    doors: listing.doors,
    isofix: listing.hasIsofix,
    price_label: listing.priceLabel,
    price_median_eur: listing.priceMedianEur,
    distance_km: listing.distanceKm,
    seller_type: listing.sellerType,
    damaged: listing.damaged,
    commercial_only: listing.commercialOnly,
    hu_due: listing.huDue,
    warranty: listing.warranty,
    red_flags: listing.redFlags,
    description: listing.description?.slice(0, 500) ?? null,
  };
}

const QUESTIONS = {
  family_fit: {
    type: "choice",
    instructions: "How well does this car fit two adults, two children and a pram?",
    criteria: {
      poor: "3 doors or tiny boot",
      marginal: "5 doors, tight boot",
      good: "5 doors, 420L+, 2x ISOFIX",
      excellent: "estate/van, 500L+, easy access",
    },
  },
  risk: {
    type: "score",
    instructions: "How risky is this car for a private buyer at this price?",
    criteria: ["clean and documented", "minor ambiguity", "material gaps", "likely misrepresented"],
  },
  action: {
    type: "choice",
    instructions: "What should the buyer do next?",
    criteria: {
      skip: "disqualify",
      watch: "wait for price drop",
      ask: "clarify details first",
      inspect: "book a viewing",
    },
  },
  deal: {
    type: "noul",
    instructions: "Is this car priced clearly below comparable local listings?",
  },
} satisfies Record<string, Question>;

export async function classifyListingWithLaya(
  listing: NormalisedListing,
  _evaluation: CarEvaluation,
): Promise<LayaClassification> {
  if (!layaEnabled()) {
    return {
      enabled: false,
      model: null,
      familyFit: null,
      risk: null,
      action: null,
      deal: null,
      confidence: 0,
      deferToDeepSeek: true,
      reason: "LAYA_ENABLED is not 1",
    };
  }

  try {
    const laya = await getLaya();
    const result = await laya.systemOne(compactState(listing), QUESTIONS);
    const family = result.answers.family_fit;
    const risk = result.answers.risk;
    const action = result.answers.action;
    const deal = result.answers.deal;
    const confidence = (
      family.answer_confidence +
      risk.answer_confidence +
      action.answer_confidence +
      deal.answer_confidence
    ) / 4;
    // Provisional calibration: the local model is deliberately conservative on
    // broad car questions. Rules still own the verdict; Laya only triages.
    const deferToDeepSeek = confidence < 0.45 || action.answer_confidence < 0.3;

    return {
      enabled: true,
      model: result.model,
      familyFit: { choice: family.choice, confidence: family.answer_confidence },
      risk: { score: risk.score, confidence: risk.answer_confidence },
      action: { choice: action.choice, confidence: action.answer_confidence },
      deal: { noul: deal.noul, confidence: deal.answer_confidence },
      confidence,
      deferToDeepSeek,
      reason: deferToDeepSeek ? "low confidence; escalate to DeepSeek" : "confident enough for triage",
    };
  } catch (error) {
    return {
      enabled: false,
      model: null,
      familyFit: null,
      risk: null,
      action: null,
      deal: null,
      confidence: 0,
      deferToDeepSeek: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function characteriseNeedWithLaya(brief: SearchBrief): Promise<{
  enabled: boolean;
  profile: string | null;
  confidence: number;
  reason: string;
}> {
  if (!layaEnabled()) {
    return { enabled: false, profile: null, confidence: 0, reason: "LAYA_ENABLED is not 1" };
  }
  try {
    const laya = await getLaya();
    const result = await laya.systemOne(
      {
        family: "2 adults + 2 children",
        budget_eur: brief.budgetAllInEur,
        radius_km: brief.location.radiusKm,
        priorities: brief.soft.prioritise,
      },
      {
        profile: {
          type: "choice",
          instructions: "Which family-car profile should the search prioritise?",
          criteria: {
            city_hatch: "short hatch, easy parking",
            family_estate: "estate or MPV, 500L+ boot",
            seven_seat: "7 seats or 3 individual rear seats",
            wait: "no suitable profile under budget",
          },
        },
      },
    );
    return {
      enabled: true,
      profile: result.answers.profile.choice,
      confidence: result.answers.profile.answer_confidence,
      reason: "Laya need characterisation",
    };
  } catch (error) {
    return {
      enabled: false,
      profile: null,
      confidence: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
