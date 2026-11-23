import type {
  NormalisedListing,
  RawDetail,
  RawPage,
  RawRef,
  SearchBrief,
  SourceAdapter,
  SourceSearchResult,
} from "../core/types.js";
import { absoluteUrl, parseDistance, parseFirstRegistration, parseGermanInt, parsePower, sha256 } from "../core/parse.js";
import { checkFilterIntegrity } from "../core/integrity.js";
import { extractAs24Detail, mergeAs24Detail } from "./autoscout24-detail.js";

const BASE_URL = "https://www.autoscout24.de";
const SEARCH_PATH = "/lst";

export interface As24Listing {
  id: string;
  title: string;
  url: string;
  images?: string[];
  price?: { priceRaw?: number | null; priceEvaluation?: number | null };
  vehicle?: {
    make?: string;
    model?: string;
    variant?: string;
    motorTypeName?: string;
    transmission?: string;
    fuel?: string;
    mileageInKm?: string;
    engineDisplacementInCCM?: string;
    isCurrentlyDamaged?: boolean;
    subtitle?: string;
  };
  location?: {
    zip?: string;
    city?: string;
    distanceToSearchLocationInKm?: number;
  };
  seller?: {
    type?: string;
    companyName?: string;
    contactName?: string;
  };
  tracking?: {
    firstRegistration?: string;
    priceLabel?: string;
  };
  vehicleDetails?: Array<{ ariaLabel?: string; data?: string }>;
}

interface As24PageProps {
  numberOfResults?: number;
  listings?: As24Listing[];
}

export function buildAs24Url(
  brief: SearchBrief,
  page: number,
  opts: { sort?: string; priceFrom?: number } = {},
): string {
  const url = new URL(SEARCH_PATH, BASE_URL);
  url.searchParams.set("atype", "C");
  url.searchParams.set("cy", "D");
  url.searchParams.set("priceto", String(brief.purchaseMaxEur));
  if (brief.hard.minFirstRegistrationYear > 0) {
    url.searchParams.set("fregfrom", String(brief.hard.minFirstRegistrationYear));
  }
  if (brief.hard.maxMileageKm > 0) {
    url.searchParams.set("kmto", String(brief.hard.maxMileageKm));
  }
  if (opts.priceFrom !== undefined && opts.priceFrom > 0) {
    url.searchParams.set("pricefrom", String(opts.priceFrom));
  }
  url.searchParams.set("zip", brief.location.zip);
  url.searchParams.set("zipr", String(brief.location.radiusKm));
  const sort = opts.sort ?? "age";
  url.searchParams.set("sort", sort);
  // AutoScout24 requires desc=1 for "Neueste Angebote zuerst"; sort=age alone
  // renders as the default "Beste Ergebnisse" order.
  if (sort === "age") url.searchParams.set("desc", "1");
  url.searchParams.set("ustate", "N,U");
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

export function extractNextData(html: string): As24PageProps {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("AutoScout24: __NEXT_DATA__ not found");
  const parsed = JSON.parse(match[1]) as {
    props?: { pageProps?: As24PageProps };
  };
  const pageProps = parsed.props?.pageProps;
  if (!pageProps) throw new Error("AutoScout24: pageProps missing");
  return pageProps;
}

function detailValue(listing: As24Listing, label: string): string | null {
  const entry = listing.vehicleDetails?.find((d) => d.ariaLabel === label);
  return entry?.data ?? null;
}

export function normaliseAs24Listing(listing: As24Listing): NormalisedListing {
  const now = new Date().toISOString();
  const power = parsePower(detailValue(listing, "Leistung"));
  const mileage =
    parseGermanInt(listing.vehicle?.mileageInKm) ??
    parseGermanInt(detailValue(listing, "Kilometerstand"));
  const firstRegistration =
    parseFirstRegistration(listing.tracking?.firstRegistration) ??
    parseFirstRegistration(detailValue(listing, "Erstzulassung"));
  const distance =
    typeof listing.location?.distanceToSearchLocationInKm === "number"
      ? listing.location.distanceToSearchLocationInKm
      : parseDistance(detailValue(listing, "Entfernung"));

  const rawJson = JSON.stringify(listing);
  const contentHash = sha256(
    [
      listing.title,
      listing.price?.priceRaw ?? "",
      mileage ?? "",
      firstRegistration ?? "",
      listing.vehicle?.fuel ?? "",
      listing.vehicle?.transmission ?? "",
    ].join("|"),
  ).slice(0, 16);

  const sellerType =
    listing.seller?.type === "Dealer"
      ? "dealer"
      : listing.seller?.type === "Private"
        ? "private"
        : "unknown";

  return {
    source: "autoscout24",
    externalId: listing.id,
    url: absoluteUrl(BASE_URL, listing.url),
    title: listing.title,
    priceEur: listing.price?.priceRaw ?? null,
    currency: "EUR",
    make: listing.vehicle?.make ?? null,
    model: listing.vehicle?.model ?? null,
    variant: listing.vehicle?.motorTypeName ?? listing.vehicle?.variant ?? null,
    firstRegistration,
    mileageKm: mileage,
    fuel: listing.vehicle?.fuel ?? detailValue(listing, "Kraftstoff"),
    transmission:
      listing.vehicle?.transmission ?? detailValue(listing, "Getriebe"),
    powerKw: power.kw,
    powerPs: power.ps,
    bodyType: null,
    seats: null,
    doors: null,
    sellerType,
    sellerName: listing.seller?.companyName ?? listing.seller?.contactName ?? null,
    city: listing.location?.city ?? null,
    zip: listing.location?.zip ?? null,
    distanceKm: distance,
    priceLabel: listing.tracking?.priceLabel ?? null,
    priceEvaluation: listing.price?.priceEvaluation ?? null,
    priceMedianEur: null,
    damaged: listing.vehicle?.isCurrentlyDamaged ?? null,
    commercialOnly: null,
    hasIsofix: null,
    huDue: null,
    warranty: null,
    carfaxUrl: null,
    description: null,
    equipment: [],
    redFlags: [],
    summary: listing.vehicle?.subtitle ?? null,
    imageUrl: listing.images?.[0] ?? null,
    firstSeenAt: now,
    lastSeenAt: now,
    contentHash,
    rawJson,
  };
}

function refFromListing(listing: As24Listing, page: number): RawRef {
  return {
    source: "autoscout24",
    externalId: listing.id,
    url: absoluteUrl(BASE_URL, listing.url),
    page,
    payload: listing,
  };
}

export class AutoScout24Adapter implements SourceAdapter {
  id = "autoscout24" as const;
  label = "AutoScout24";
  enabled = true;
  statusNote = "direct HTTP; newest-first adaptive pages";
  accessMethod = "direct_http" as const;

  async search(
    brief: SearchBrief,
    opts: { maxPages?: number; delayMs?: number; sort?: string; priceFrom?: number; onPage?: (source: string, page: RawPage, refs: RawRef[]) => boolean } = {},
  ): Promise<SourceSearchResult> {
    const maxPages = Math.max(1, opts.maxPages ?? 1);
    const delayMs = Math.max(0, opts.delayMs ?? 3000);
    const refs: RawRef[] = [];
    const pages: RawPage[] = [];
    const warnings: string[] = [];
    let totalResults: number | null = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const url = buildAs24Url(brief, page, { sort: opts.sort, priceFrom: opts.priceFrom });
      const response = await fetch(url, {
        headers: {
          "accept-language": "de-DE,de;q=0.9",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`AutoScout24 page ${page}: HTTP ${response.status}`);
      }

      const html = await response.text();
      const pageProps = extractNextData(html);
      const listings = pageProps.listings ?? [];
      if (pageProps.numberOfResults !== undefined) totalResults = pageProps.numberOfResults;

      if (listings.length === 0) {
        if (page === 1) warnings.push("AutoScout24 page 1 parsed zero listings");
        break;
      }

      const pageRefs = listings.map((listing) => refFromListing(listing, page));
      refs.push(...pageRefs);
      const rawPage: RawPage = {
        source: "autoscout24",
        page,
        url,
        fetchedAt: new Date().toISOString(),
        httpStatus: response.status,
        html,
        listingCount: listings.length,
        totalResults,
      };
      pages.push(rawPage);

      if (opts.onPage?.("autoscout24", rawPage, pageRefs)) break;

      if (page < maxPages && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return {
      source: "autoscout24",
      refs,
      pages,
      totalResults,
      integrity: checkFilterIntegrity(brief, refs, totalResults),
      warnings,
    };
  }

  async checkAvailability(ref: RawRef): Promise<"available" | "gone" | "unknown"> {
    try {
      const response = await fetch(ref.url, {
        headers: {
          "accept-language": "de-DE,de;q=0.9",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404 || response.status === 410) return "gone";
      if (!response.ok) return "unknown";
      const html = await response.text();
      // AutoScout24 serves a 200 shell for some removed ads; the gone page has
      // a stable class, while the same words exist in the translation payload.
      if (/GonePage_title__/.test(html)) return "gone";
      // A consent, challenge or error page is also a 200. Only a real detail
      // payload is positive evidence that the car is still listed.
      return /__NEXT_DATA__/.test(html) && /"listingDetails"/.test(html) ? "available" : "unknown";
    } catch {
      return "unknown";
    }
  }

  async fetchDetail(ref: RawRef): Promise<RawDetail> {
    const response = await fetch(ref.url, {
      headers: {
        "accept-language": "de-DE,de;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`AutoScout24 detail ${ref.externalId}: HTTP ${response.status}`);
    }
    const html = await response.text();
    const detail = extractAs24Detail(html);
    const base = normaliseAs24Listing(ref.payload as As24Listing);
    return {
      source: "autoscout24",
      externalId: ref.externalId,
      url: ref.url,
      fetchedAt: new Date().toISOString(),
      httpStatus: response.status,
      html,
      payload: detail,
      listing: mergeAs24Detail(base, detail),
    };
  }
}
