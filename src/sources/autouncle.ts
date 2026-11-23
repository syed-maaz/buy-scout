import * as cheerio from "cheerio";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
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
import { parseGermanInt, sha256 } from "../core/parse.js";

const AUTOUNCLE_BASE = "https://www.autouncle.de";
const JINA_BASE = "https://r.jina.ai/";
const REGION = "Baden-Württemberg";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((value): value is string => Boolean(value));

function isChallengePage(html: string): boolean {
  return /Just a moment|cf_chl|Enable JavaScript and cookies|Attention Required|Cloudflare/i.test(html);
}

async function fetchAutoUncleHtml(target: string): Promise<string> {
  try {
    const response = await fetch(buildJinaUrl(target), {
      headers: {
        "X-Return-Format": "html",
        "accept-language": "de-DE,de;q=0.9",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      },
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.text();
    if (response.ok && body.length >= 10_000 && !isChallengePage(body)) {
      return body;
    }
  } catch {
    // Jina is best-effort; fall through to a real browser.
  }

  const executablePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const context = await browser.newContext({
      locale: "de-DE",
      timezoneId: "Europe/Berlin",
      viewport: { width: 1440, height: 1000 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3_000);
    let html = await page.content();
    if (isChallengePage(html) || !/article/i.test(html)) {
      await page.waitForTimeout(5_000);
      html = await page.content();
    }
    if (isChallengePage(html)) {
      throw new Error("AutoUncle browser fallback hit a Cloudflare challenge");
    }
    return html;
  } finally {
    await browser.close();
  }
}

export interface AutoUncleCard {
  externalId: string;
  url: string;
  title: string;
  text: string;
  year: number | null;
  priceEur: number | null;
  mileageKm: number | null;
  firstRegistration: string | null;
  fuel: string | null;
  transmission: string | null;
  bodyType: string | null;
  city: string | null;
  zip: string | null;
  priceLabel: string | null;
  dealer: string | null;
  imageUrl: string | null;
}

export function autoUnclePriceCap(brief: SearchBrief): number {
  // AutoUncle only exposes coarse price buckets; 5200 is a 404, 6000 works.
  return Math.ceil(brief.purchaseMaxEur / 1000) * 1000;
}

/**
 * POC approximation for AutoUncle cards, which expose a ZIP but no distance.
 * Replace with a geocoder or a PLZ centroid table before production.
 */
export function estimateDistanceFromWiesloch(zip: string | null): number | null {
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  const prefix2 = zip.slice(0, 2);
  const prefix3 = zip.slice(0, 3);
  const exact: Record<string, number> = {
    "691": 5,   // Wiesloch / Walldorf
    "692": 15,  // Leimen / Nußloch
    "693": 25,  // Heidelberg
    "694": 30,  // Weinheim
    "685": 25,  // Ladenburg / Schriesheim
    "687": 30,  // Hockenheim / Waghäusel
    "670": 35,  // Ludwigshafen
    "681": 25,  // Mannheim
    "683": 25,  // Mannheim
    "766": 35,  // Bruchsal
    "761": 45,  // Karlsruhe
    "751": 45,  // Pforzheim
    "740": 45,  // Heilbronn
    "748": 35,  // Sinsheim
    "647": 55,  // Michelstadt / Odenwald
  };
  if (prefix3 in exact) return exact[prefix3];
  const by2: Record<string, number> = {
    "69": 25, "68": 30, "67": 35, "76": 45, "75": 50, "74": 50,
    "64": 65, "70": 90, "71": 90, "72": 100, "77": 90, "78": 150,
  };
  return by2[prefix2] ?? null;
}

export function buildAutoUncleUrl(brief: SearchBrief, page = 1): string {
  const region = encodeURIComponent(REGION);
  const base = `${AUTOUNCLE_BASE}/de/gebrauchtwagen/in/${region}/mp-unter-${autoUnclePriceCap(brief)}-euro`;
  return page > 1 ? `${base}?page=${page}` : base;
}

export function buildJinaUrl(target: string): string {
  return `${JINA_BASE}${target}`;
}

function textOf(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parsePrice(text: string): number | null {
  const matches = [...text.matchAll(/([\d.]+)\s*€/g)];
  if (matches.length === 0) return null;
  return parseGermanInt(matches[0][1]);
}

function parseMileage(text: string): number | null {
  // Cards concatenate the year and mileage: "Jun 2015145.957 km".
  // Require a thousands-separated number so we do not parse "2015" as km.
  const match = text.match(/(\d{1,3}(?:\.\d{3})+)\s*km/);
  return match ? parseGermanInt(match[1]) : null;
}

function parseRegistration(text: string): { year: number | null; iso: string | null } {
  const monthMap: Record<string, string> = {
    jan: "01", feb: "02", mär: "03", mar: "03", apr: "04", mai: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", okt: "10", nov: "11", dez: "12",
  };
  const monthYear = text.match(/\b(Jan|Feb|Mär|Mar|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez)\s+(\d{4})/i);
  if (monthYear) {
    const month = monthMap[monthYear[1].toLowerCase().slice(0, 3)];
    const year = Number.parseInt(monthYear[2], 10);
    return { year, iso: `${year}-${month}-01` };
  }
  const yearOnly = text.match(/\b(19|20)\d{2}\b/);
  if (yearOnly) {
    const year = Number.parseInt(yearOnly[0], 10);
    return { year, iso: `${year}-01-01` };
  }
  return { year: null, iso: null };
}

function parseLocation(text: string): { zip: string | null; city: string | null } {
  const match = text.match(/(\d{5})\s+([^,]+),\s*Baden-Württemberg/);
  if (!match) return { zip: null, city: null };
  return { zip: match[1], city: match[2].trim() };
}

function parsePriceLabel(text: string): string | null {
  const match = text.match(/(Superpreis|Guter Preis|Fairer Preis|Etwas zu teuer|Teuer)/);
  return match ? match[1] : null;
}

function parseFuel(text: string): string | null {
  const match = text.match(/(Elektrisch\/Benzin|Elektrisch\/Diesel|Benzin|Diesel|Elektro|Hybrid)/);
  return match ? match[1] : null;
}

function parseTransmission(text: string): string | null {
  if (/Schaltgetriebe/i.test(text)) return "Schaltgetriebe";
  if (/Automatik/i.test(text)) return "Automatik";
  return null;
}

function parseBodyType(text: string): string | null {
  const match = text.match(/(Kleinwagen|Kombi|Combi|SUV|Van \/ Kleinbus|Van|Limousine|Sportwagen\/Coupé|Cabrio\/Roadster)/);
  if (!match) return null;
  return match[1] === "Combi" ? "Kombi" : match[1];
}

export function parseAutoUncleCards(html: string): AutoUncleCard[] {
  const $ = cheerio.load(html);
  const cards: AutoUncleCard[] = [];

  $("article").each((_index, element) => {
    const article = $(element);
    const anchor = article.find('a[href*="/de/d/"]').first();
    const href = anchor.attr("href");
    if (!href) return;

    const text = textOf(article.text());
    const idMatch = href.match(/\/de\/d\/(\d+)/);
    if (!idMatch) return;

    const yearMatch = text.match(/(?:Gebraucht|Neu)\s*\((\d{4})\)/);
    const labelledTitle = text.match(
      /\d\s*\/\s*\d+\s*([^|]{3,90})\|\s*(?:Superpreis|Guter Preis|Fairer Preis|Etwas zu teuer|Teuer)/i,
    );
    const plainTitle = text.match(/([^|]{3,90})\|\s*(?:Superpreis|Guter Preis|Fairer Preis|Etwas zu teuer|Teuer)/i);
    const title = (labelledTitle?.[1] ?? plainTitle?.[1] ?? anchor.text())
      .replace(/^(?:Gebraucht|Neu)\s*\(\d{4}\)\s*/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
    const registration = parseRegistration(text);
    const location = parseLocation(text);
    const image = article.find("img").first().attr("src") ?? null;

    cards.push({
      externalId: idMatch[1],
      url: `${AUTOUNCLE_BASE}${href}`,
      title,
      text,
      year: yearMatch ? Number.parseInt(yearMatch[1], 10) : registration.year,
      priceEur: parsePrice(text),
      mileageKm: parseMileage(text),
      firstRegistration: registration.iso,
      fuel: parseFuel(text),
      transmission: parseTransmission(text),
      bodyType: parseBodyType(text),
      city: location.city,
      zip: location.zip,
      priceLabel: parsePriceLabel(text),
      dealer: null,
      imageUrl: image && !image.includes("placeholder") ? image : null,
    });
  });

  return cards;
}

export function normaliseAutoUncleCard(card: AutoUncleCard): NormalisedListing {
  const now = new Date().toISOString();
  const titleParts = card.title.split(/\s+/);
  const make = titleParts[0] ?? null;
  const model = titleParts.length > 1 ? titleParts.slice(1).join(" ") : null;
  const contentHash = sha256(
    [card.title, card.priceEur ?? "", card.mileageKm ?? "", card.firstRegistration ?? ""].join("|"),
  ).slice(0, 16);

  return {
    source: "autouncle",
    externalId: card.externalId,
    url: card.url,
    title: card.title,
    priceEur: card.priceEur,
    currency: "EUR",
    make,
    model,
    variant: null,
    firstRegistration: card.firstRegistration,
    mileageKm: card.mileageKm,
    fuel: card.fuel,
    transmission: card.transmission,
    powerKw: null,
    powerPs: null,
    bodyType: card.bodyType,
    seats: null,
    doors: null,
    sellerType: "unknown",
    sellerName: card.dealer,
    city: card.city,
    zip: card.zip,
    distanceKm: estimateDistanceFromWiesloch(card.zip),
    priceLabel: card.priceLabel,
    priceEvaluation: null,
    priceMedianEur: null,
    damaged: null,
    commercialOnly: null,
    hasIsofix: null,
    huDue: null,
    warranty: null,
    carfaxUrl: null,
    description: card.text,
    equipment: [],
    redFlags: [],
    summary: card.text.slice(0, 300),
    imageUrl: card.imageUrl,
    firstSeenAt: now,
    lastSeenAt: now,
    contentHash,
    rawJson: JSON.stringify(card),
  };
}

function checkIntegrity(
  cards: AutoUncleCard[],
  html: string,
  sourceCap: number,
): FilterIntegrity {
  const reasons: string[] = [];
  const prices = cards.map((card) => card.priceEur).filter((v): v is number => v !== null);
  const max = prices.length ? Math.max(...prices) : null;
  const distances = cards
    .map((card) => estimateDistanceFromWiesloch(card.zip))
    .filter((v): v is number => v !== null);
  const maxDistance = distances.length ? Math.max(...distances) : null;
  const totalMatch = html.match(/([\d.]+)\s+Fahrzeuge/);
  const total = totalMatch ? parseGermanInt(totalMatch[1]) : null;

  if (max !== null && max > sourceCap) {
    reasons.push(`price filter leaked: observed max ${max} EUR > source cap ${sourceCap} EUR`);
  }
  if (total !== null && total > 50_000) {
    reasons.push(`result set implausibly broad: ${total} listings`);
  }
  if (cards.length === 0) {
    reasons.push("zero cards parsed");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    observedMaxPriceEur: max,
    observedMaxDistanceKm: maxDistance,
    totalResults: total,
  };
}

function cardPageIsShort(cardCount: number): boolean {
  return cardCount < 20;
}

export class AutoUncleAdapter implements SourceAdapter {
  id = "autouncle" as const;
  label = "AutoUncle";
  enabled = true;
  statusNote = "Jina Reader with local browser fallback; no API key";
  accessMethod = "jina_reader" as const;

  async search(brief: SearchBrief, opts: SearchOptions = {}): Promise<SourceSearchResult> {
    const maxPages = Math.max(1, Math.min(opts.maxPages ?? 3, 20));
    const warnings: string[] = [];
    const refs: RawRef[] = [];
    const pages: RawPage[] = [];
    const seen = new Set<string>();
    let totalResults: number | null = null;
    const keptCards: AutoUncleCard[] = [];

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const target = buildAutoUncleUrl(brief, pageNumber);
      const html = await fetchAutoUncleHtml(target);
      const parsed = parseAutoUncleCards(html);
      if (parsed.length === 0) {
        warnings.push(`AutoUncle page ${pageNumber}: zero cards parsed`);
        break;
      }

      const totalMatch = html.match(/([\d.]+)\s+Fahrzeuge/);
      if (totalResults === null && totalMatch) totalResults = parseGermanInt(totalMatch[1]);


      const cards = parsed.filter((card) => {
        if (card.priceEur !== null && card.priceEur > brief.purchaseMaxEur) return false;
        const distance = estimateDistanceFromWiesloch(card.zip);
        if (distance !== null && distance > brief.location.radiusKm + 10) return false;
        return true;
      });
      if (cards.length !== parsed.length) {
        warnings.push(`AutoUncle page ${pageNumber} local filter: ${cards.length}/${parsed.length} cards kept`);
      }

      keptCards.push(...cards);
      const pageRefs: RawRef[] = cards
        .filter((card) => !seen.has(card.externalId))
        .map((card) => {
          seen.add(card.externalId);
          return {
            source: "autouncle",
            externalId: card.externalId,
            url: card.url,
            page: pageNumber,
            payload: card,
          } satisfies RawRef;
        });
      refs.push(...pageRefs);

      const rawPage: RawPage = {
        source: "autouncle",
        page: pageNumber,
        url: target,
        fetchedAt: new Date().toISOString(),
        httpStatus: 200,
        html,
        listingCount: cards.length,
        totalResults,
      };
      pages.push(rawPage);

      if (opts.onPage?.("autouncle", rawPage, pageRefs)) break;
      if (cardPageIsShort(parsed.length)) break;
    }

    return {
      source: "autouncle",
      refs,
      pages,
      totalResults,
      integrity: checkIntegrity(keptCards, pages.map((entry) => entry.html).join("\n"), autoUnclePriceCap(brief)),
      warnings,
    };
  }
}
