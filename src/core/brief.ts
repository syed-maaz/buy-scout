import { z } from "zod";
import type { SearchBrief } from "./types.js";

export const SearchBriefSchema = z.object({
  category: z.literal("car"),
  budgetAllInEur: z.number().positive(),
  purchaseMaxEur: z.number().positive(),
  reserveEur: z.number().nonnegative(),
  location: z.object({
    zip: z.string().regex(/^\d{5}$/),
    radiusKm: z.number().positive(),
  }),
  hard: z.object({
    minSeats: z.number().int().min(2),
    minDoors: z.number().int().min(2),
    minFirstRegistrationYear: z.number().int().min(1950),
    maxMileageKm: z.number().int().positive(),
    fuel: z.enum(["any", "petrol", "diesel"]),
    transmission: z.enum(["any", "manual", "automatic"]),
    excludeDamaged: z.boolean(),
    excludeCommercialOnly: z.boolean(),
  }),
  soft: z.object({
    prioritise: z.array(z.enum(["family", "safety", "cost", "reliability", "deal"])),
  }),
  analysis: z
    .object({
      minScore: z.number().min(0).max(100),
      minConfidence: z.number().min(0).max(1),
      maxCards: z.number().int().min(1).max(100),
      autoRun: z.boolean(),
    })
    .default({ minScore: 60, minConfidence: 0.6, maxCards: 30, autoRun: false }),
  preferences: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        field: z.enum([
          "make",
          "model",
          "variant",
          "title",
          "equipment",
          "bodyType",
          "fuel",
          "transmission",
          "sellerType",
        ]),
        match: z.enum(["contains", "equals"]),
        value: z.string().min(1),
        weight: z.number().min(0).max(25),
        enabled: z.boolean().optional(),
      }),
    )
    .default([]),
});

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function defaultBrief(): SearchBrief {
  const purchaseMaxEur = envInt("PURCHASE_MAX_EUR", 7000);
  const reserveEur = envInt("RESERVE_EUR", 800);

  return {
    category: "car",
    budgetAllInEur: purchaseMaxEur + reserveEur,
    purchaseMaxEur,
    reserveEur,
    location: {
      zip: process.env.SEARCH_ZIP ?? "69168",
      radiusKm: envInt("SEARCH_RADIUS_KM", 200),
    },
    hard: {
      minSeats: 5,
      // 4 side doors = a 5-door car (tailgate not counted).
      minDoors: 4,
      minFirstRegistrationYear: 2010,
      maxMileageKm: 180000,
      fuel: "any",
      transmission: "any",
      excludeDamaged: true,
      excludeCommercialOnly: true,
    },
    soft: {
      prioritise: ["family", "safety", "cost", "reliability", "deal"],
    },
    preferences: [
      {
        id: "vw-make",
        label: "VW bias",
        field: "make",
        match: "contains",
        value: "Volkswagen",
        weight: 20,
        enabled: true,
      },
      {
        id: "vw-badge",
        label: "VW badge",
        field: "make",
        match: "equals",
        value: "VW",
        weight: 20,
        enabled: true,
      },
      {
        id: "automatic-bias",
        label: "Automatic preference",
        field: "transmission",
        match: "contains",
        value: "Automatik",
        weight: 10,
        enabled: true,
      },
      {
        id: "passat-bias",
        label: "Passat bias",
        field: "model",
        match: "contains",
        value: "Passat",
        weight: 15,
        enabled: true,
      },
    ],
    analysis: { minScore: 60, minConfidence: 0.6, maxCards: 30, autoRun: false },
  };
}


export function parseBriefJson(json: string): SearchBrief {
  return SearchBriefSchema.parse(JSON.parse(json)) as SearchBrief;
}

export function briefToJson(brief: SearchBrief): string {
  return JSON.stringify(brief);
}
