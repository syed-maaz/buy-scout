import type { AccessStrategy, AccessSymptom } from "../acquisition/playbook.js";

export type SourceId = "autoscout24" | "mobile_de" | "kleinanzeigen" | "autouncle" | string;

export type SellerType = "private" | "dealer" | "unknown";

export type PreferenceField =
  | "make"
  | "model"
  | "variant"
  | "title"
  | "equipment"
  | "bodyType"
  | "fuel"
  | "transmission"
  | "sellerType";

export interface AnalysisSettings {
  /** Minimum rule score (0-100) to be worth an analysis call. */
  minScore: number;
  /** Minimum evidence confidence (0-1). */
  minConfidence: number;
  /** Safety cap; not a top-N ranking. */
  maxCards: number;
  /** UI convenience: run analysis right after saving criteria. */
  autoRun: boolean;
}

export interface PreferenceRule {
  id: string;
  label: string;
  field: PreferenceField;
  match: "contains" | "equals";
  value: string;
  /** Ranking boost. Never a filter; 0 disables the rule. */
  weight: number;
  enabled?: boolean;
}

export interface SearchBrief {
  category: "car";
  /** All-in ceiling: purchase + reserve + fees. */
  budgetAllInEur: number;
  /** Maximum asking price used for the source query. */
  purchaseMaxEur: number;
  /** Money kept back for tyres, brakes, registration, first repairs. */
  reserveEur: number;
  location: {
    zip: string;
    radiusKm: number;
  };
  hard: {
    minSeats: number;
    /** Side doors. 4 side doors = a 5-door car. */
    minDoors: number;
    minFirstRegistrationYear: number;
    maxMileageKm: number;
    fuel: "any" | "petrol" | "diesel";
    transmission: "any" | "manual" | "automatic";
    excludeDamaged: boolean;
    excludeCommercialOnly: boolean;
  };
  soft: {
    prioritise: Array<"family" | "safety" | "cost" | "reliability" | "deal">;
  };
  /** Weighted ranking preferences. They boost, never exclude. */
  preferences?: PreferenceRule[];
  /** Thresholds for "good card" analysis. */
  analysis?: AnalysisSettings;
}

export interface RawRef {
  source: SourceId;
  externalId: string;
  url: string;
  page: number;
  payload: unknown;
}

export interface RawPage {
  source: SourceId;
  page: number;
  url: string;
  fetchedAt: string;
  httpStatus: number;
  html: string;
  listingCount: number;
  totalResults: number | null;
}

export interface RawDetail {
  source: SourceId;
  externalId: string;
  url: string;
  fetchedAt: string;
  httpStatus: number;
  html: string;
  payload: unknown;
  listing: NormalisedListing;
}

export interface FilterIntegrity {
  ok: boolean;
  reasons: string[];
  observedMaxPriceEur: number | null;
  observedMaxDistanceKm: number | null;
  totalResults: number | null;
}

export interface SourceSearchResult {
  source: SourceId;
  refs: RawRef[];
  pages: RawPage[];
  totalResults: number | null;
  integrity: FilterIntegrity;
  warnings: string[];
}

export interface NormalisedListing {
  source: SourceId;
  externalId: string;
  url: string;
  title: string;
  priceEur: number | null;
  currency: "EUR";
  make: string | null;
  model: string | null;
  variant: string | null;
  firstRegistration: string | null;
  mileageKm: number | null;
  fuel: string | null;
  transmission: string | null;
  powerKw: number | null;
  powerPs: number | null;
  bodyType: string | null;
  seats: number | null;
  doors: number | null;
  sellerType: SellerType;
  sellerName: string | null;
  city: string | null;
  zip: string | null;
  distanceKm: number | null;
  priceLabel: string | null;
  priceEvaluation: number | null;
  priceMedianEur: number | null;
  damaged: boolean | null;
  commercialOnly: boolean | null;
  hasIsofix: boolean | null;
  huDue: string | null;
  warranty: boolean | null;
  carfaxUrl: string | null;
  description: string | null;
  equipment: string[];
  redFlags: string[];
  summary: string | null;
  imageUrl: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** When a source confirmed the listing is gone. Null means still active. */
  delistedAt?: string | null;
  /** Human-readable evidence for the delisting, e.g. "AutoScout24 HTTP 410". */
  delistReason?: string | null;
  /** When availability was last checked, independent of last_seen_at. */
  availabilityCheckedAt?: string | null;
  contentHash: string;
  rawJson: string;
}

export interface SearchOptions {
  maxPages?: number;
  delayMs?: number;
  /** AutoScout24 sort value. Defaults to newest-first. */
  sort?: string;
  /** Optional lower price bound for incremental fetches. */
  priceFrom?: number;
  /** Called after each parsed page. Return true to stop before the next page. */
  onPage?: (source: SourceId, page: RawPage, refs: RawRef[]) => boolean;
}

export type AvailabilityStatus = "available" | "gone" | "unknown";

export interface SourceAdapter {
  id: SourceId;
  label: string;
  enabled: boolean;
  statusNote?: string;
  accessMethod?: AccessStrategy;
  search(brief: SearchBrief, opts?: SearchOptions): Promise<SourceSearchResult>;
  fetchDetail?(ref: RawRef): Promise<RawDetail>;
  /** A cheap detail-page check used to retire listings that disappeared. */
  checkAvailability?(ref: RawRef): Promise<AvailabilityStatus>;
}

export interface SourceFailure {
  source: SourceId;
  error: string;
  symptom: AccessSymptom;
  recommendations: AccessStrategy[];
}

export interface ParallelFetchResult {
  results: SourceSearchResult[];
  failures: SourceFailure[];
}
