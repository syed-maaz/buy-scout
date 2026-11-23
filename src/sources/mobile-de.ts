import * as cheerio from "cheerio";
import type {
  FilterIntegrity,
  NormalisedListing,
  RawPage,
  RawRef,
  SearchBrief,
  SearchOptions,
  SourceAdapter,
  SourceSearchResult,
} from "../core/types.js";
import { fetchHtmlPagesWithBrowser, fetchHtmlWithBrowser } from "../core/browser.js";
import { sha256 } from "../core/parse.js";
import { estimateDistanceFromWiesloch } from "./autouncle.js";

const MOBILE_BASE = "https://suchen.mobile.de";
const DEFAULT_LOCATION = {
  zip: "69168",
  name: "Wiesloch, Baden-Württemberg",
  ll: "49.29504,8.70178",
};

export interface MobileDeCard {
  externalId: string;
  url: string;
  title: string;
  priceEur: number | null;
  mileageKm: number | null;
  firstRegistration: string | null;
  fuel: string | null;
  transmission: string | null;
  powerKw: number | null;
  powerPs: number | null;
  city: string | null;
  zip: string | null;
  text: string;
}

function textOf(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseGermanInt(value: string): number {
  return Number(value.replace(/\./g, ""));
}

export function buildMobileDeUrl(brief: SearchBrief, page = 1, searchId?: string): string {
  if (brief.location.zip !== DEFAULT_LOCATION.zip) {
    throw new Error(
      `mobile.de search is configured for ZIP ${DEFAULT_LOCATION.zip}; got ${brief.location.zip}`,
    );
  }
  const url = new URL("/fahrzeuge/search.html", MOBILE_BASE);
  url.searchParams.set("asl", "true");
  url.searchParams.set("cn", "DE");
  url.searchParams.set("gn", DEFAULT_LOCATION.name);
  url.searchParams.set("isSearchRequest", "true");
  url.searchParams.set("ll", DEFAULT_LOCATION.ll);
  url.searchParams.set("p", `:${brief.purchaseMaxEur}`);
  url.searchParams.set("rd", String(brief.location.radiusKm));
  url.searchParams.set("s", "Car");
  url.searchParams.set("vc", "Car");
  if (page > 1) {
    url.searchParams.set("od", "up");
    url.searchParams.set("pageNumber", String(page));
    url.searchParams.set("ref", "srpNextPage");
    url.searchParams.set("sb", "rel");
    if (searchId) {
      url.searchParams.set("refId", searchId);
      url.searchParams.set("searchId", searchId);
    }
  }
  return url.toString();
}

export function parseMobileDeCards(html: string): MobileDeCard[] {
  const $ = cheerio.load(html);
  const cards: MobileDeCard[] = [];
  $('[data-testid^="base-result-listing-"], [data-testid^="top-result-listing-"]').each((_index, element) => {
    const node = $(element);
    const anchor = node.find('a[href*="details.html?id="]').first();
    const href = anchor.attr("href");
    if (!href) return;
    const externalId = href.match(/[?&]id=(\d+)/)?.[1];
    if (!externalId) return;

    const text = textOf(node.text());
    const priceMatch = text.match(/([\d.]+)\s*€/);
    const priceEur = priceMatch ? parseGermanInt(priceMatch[1]) : null;
    const beforePrice = priceMatch ? text.slice(0, priceMatch.index) : text;
    const title = beforePrice
      .replace(/^(?:Top|Gesponsert)\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const registration = text.match(/EZ\s+(\d{2})\/(\d{4})/i);
    const mileage = text.match(/([\d.]+)\s*km/i);
    const power = text.match(/(\d+)\s*kW\s*\((\d+)\s*PS\)/i);
    const fuel = text.match(/•\s*(Benzin|Diesel|Elektro|Hybrid|Plugin-Hybrid)/i)?.[1] ?? null;
    const transmission = /Schaltgetriebe/i.test(text) ? "Schaltgetriebe" : /Automatik/i.test(text) ? "Automatik" : null;
    const location = text.match(/(\d{5})\s+([A-Za-zÄÖÜäöüß .-]+)$/);
    const zip = location?.[1] ?? null;
    const city = location?.[2]?.trim() ?? null;

    cards.push({
      externalId,
      url: href.startsWith("http") ? href : `${MOBILE_BASE}${href}`,
      title,
      priceEur,
      mileageKm: mileage ? parseGermanInt(mileage[1]) : null,
      firstRegistration: registration ? `${registration[2]}-${registration[1]}-01` : null,
      fuel,
      transmission,
      powerKw: power ? Number(power[1]) : null,
      powerPs: power ? Number(power[2]) : null,
      city,
      zip,
      text,
    });
  });
  return cards;
}

export function normaliseMobileDeCard(card: MobileDeCard): NormalisedListing {
  const now = new Date().toISOString();
  const titleParts = card.title.split(/\s+/);
  return {
    source: "mobile_de",
    externalId: card.externalId,
    url: card.url,
    title: card.title,
    priceEur: card.priceEur,
    currency: "EUR",
    make: titleParts[0] ?? null,
    model: titleParts.length > 1 ? titleParts.slice(1).join(" ") : null,
    variant: null,
    firstRegistration: card.firstRegistration,
    mileageKm: card.mileageKm,
    fuel: card.fuel,
    transmission: card.transmission,
    powerKw: card.powerKw,
    powerPs: card.powerPs,
    bodyType: null,
    seats: null,
    doors: null,
    sellerType: "unknown",
    sellerName: null,
    city: card.city,
    zip: card.zip,
    distanceKm: estimateDistanceFromWiesloch(card.zip),
    priceLabel: null,
    priceEvaluation: null,
    priceMedianEur: null,
    damaged: null,
    commercialOnly: null,
    hasIsofix: null,
    huDue: null,
    warranty: null,
    carfaxUrl: null,
    description: card.text.slice(0, 4000),
    equipment: [],
    redFlags: [],
    summary: card.text.slice(0, 300),
    imageUrl: null,
    firstSeenAt: now,
    lastSeenAt: now,
    contentHash: sha256([card.title, card.priceEur ?? "", card.mileageKm ?? "", card.firstRegistration ?? ""].join("|")).slice(0, 16),
    rawJson: JSON.stringify(card),
  };
}

function integrity(cards: MobileDeCard[], brief: SearchBrief): FilterIntegrity {
  const prices = cards.map((card) => card.priceEur).filter((value): value is number => value !== null);
  const distances = cards.map((card) => estimateDistanceFromWiesloch(card.zip)).filter((value): value is number => value !== null);
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const maxDistance = distances.length ? Math.max(...distances) : null;
  const reasons: string[] = [];
  if (maxPrice !== null && maxPrice > brief.purchaseMaxEur) reasons.push(`price leak ${maxPrice} > ${brief.purchaseMaxEur}`);
  if (maxDistance !== null && maxDistance > brief.location.radiusKm + 15) reasons.push(`distance leak ${maxDistance} km`);
  return { ok: reasons.length === 0, reasons, observedMaxPriceEur: maxPrice, observedMaxDistanceKm: maxDistance, totalResults: null };
}

export class MobileDeAdapter implements SourceAdapter {
  id = "mobile_de" as const;
  label = "mobile.de";
  enabled = true;
  statusNote = "browser profile required; Akamai blocks fresh sessions";
  accessMethod = "playwright_headless" as const;

  async search(brief: SearchBrief, opts: SearchOptions = {}): Promise<SourceSearchResult> {
    if (!process.env.BUY_SCOUT_CHROME_PROFILE) {
      throw new Error("mobile.de search requires BUY_SCOUT_CHROME_PROFILE");
    }
    const maxPages = Math.max(1, Math.min(opts.maxPages ?? 1, 20));
    const warnings: string[] = [];
    const refs: RawRef[] = [];
    const pages: RawPage[] = [];
    const keptCards: MobileDeCard[] = [];
    const seen = new Set<string>();
    let totalResults: number | null = null;

    const firstTarget = buildMobileDeUrl(brief, 1);
    const firstPage = await fetchHtmlWithBrowser(firstTarget);
    const searchId = firstPage.html.match(/(?:searchId|refId)=([0-9a-f-]{20,})/)?.[1];
    const targets = [firstTarget];
    for (let pageNumber = 2; pageNumber <= maxPages; pageNumber += 1) {
      targets.push(buildMobileDeUrl(brief, pageNumber, searchId));
    }
    const fetchedPages = targets.length > 1
      ? await fetchHtmlPagesWithBrowser(targets)
      : [firstPage];
    for (let pageNumber = 1; pageNumber <= fetchedPages.length; pageNumber += 1) {
      const target = targets[pageNumber - 1];
      const page = fetchedPages[pageNumber - 1];
      if (totalResults === null) {
        const totalMatch = page.html.match(/([\d.]+)\s+Angebote/);
        if (totalMatch) totalResults = Number(totalMatch[1].replace(/\./g, ""));
      }
      const parsed = parseMobileDeCards(page.html);
      if (parsed.length === 0) {
        warnings.push(`mobile.de page ${pageNumber}: zero cards parsed`);
        break;
      }
      const cards = parsed.filter((card) => {
        if (card.priceEur !== null && card.priceEur > brief.purchaseMaxEur) return false;
        const distance = estimateDistanceFromWiesloch(card.zip);
        if (distance !== null && distance > brief.location.radiusKm + 15) return false;
        return true;
      });
      keptCards.push(...cards);
      const pageRefs: RawRef[] = cards
        .filter((card) => !seen.has(card.externalId))
        .map((card) => {
          seen.add(card.externalId);
          return { source: "mobile_de", externalId: card.externalId, url: card.url, page: pageNumber, payload: card } satisfies RawRef;
        });
      refs.push(...pageRefs);
      const rawPage: RawPage = {
        source: "mobile_de",
        page: pageNumber,
        url: target,
        fetchedAt: new Date().toISOString(),
        httpStatus: 200,
        html: page.html,
        listingCount: cards.length,
        totalResults,
      };
      pages.push(rawPage);
      if (opts.onPage?.("mobile_de", rawPage, pageRefs)) break;
      if (parsed.length < 20) break;
    }

    return {
      source: "mobile_de",
      refs,
      pages,
      totalResults,
      integrity: integrity(keptCards, brief),
      warnings: warnings.length > 0 ? warnings : refs.length === 0 ? ["mobile.de parsed zero cards"] : [],
    };
  }
}
