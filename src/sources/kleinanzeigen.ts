import { load } from "cheerio";
import type {
  FilterIntegrity,
  NormalisedListing,
  RawDetail,
  RawPage,
  RawRef,
  SearchBrief,
  SourceAdapter,
  SourceSearchResult,
} from "../core/types.js";
import { sha256 } from "../core/parse.js";
import { estimateDistanceFromWiesloch } from "./autouncle.js";

const BASE = "https://www.kleinanzeigen.de";
const HEADERS = {
  "accept-language": "de-DE,de;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
};

export interface KleinanzeigenCard {
  externalId: string;
  url: string;
  title: string;
  priceEur: number | null;
  city: string | null;
  zip: string | null;
  description: string;
  imageUrl: string | null;
  locationText: string;
  text: string;
}

function absolute(href: string): string {
  return href.startsWith("http") ? href : `${BASE}${href}`;
}

function parseEuro(text: string): number | null {
  const match = text.replace(/\s/g, "").match(/(\d[\d.]*)\s*€/);
  if (!match) return null;
  const n = Number(match[1].replace(/\./g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseKleinanzeigenCards(html: string): KleinanzeigenCard[] {
  const $ = load(html);
  const cards: KleinanzeigenCard[] = [];
  $("article[data-adid]").each((_, element) => {
    const node = $(element);
    const externalId = node.attr("data-adid");
    const href = node.attr("data-href") ?? node.find("h3 a").first().attr("href") ?? "";
    if (!externalId || !href) return;
    const title = node.find("h3 a").first().text().trim() || node.find("h3").first().text().trim();
    if (!title) return;
    const text = node.text().replace(/\s+/g, " ").trim();
    const locationText = node.find("div.text-onSurfaceNonessential span").first().text().replace(/\s+/g, " ").trim();
    const zipMatch = locationText.match(/\b(\d{5})\b/) ?? text.match(/\b(\d{5})\s+[A-ZÄÖÜ]/);
    const zip = zipMatch ? zipMatch[1] ?? zipMatch[0].slice(0, 5) : null;
    const city = locationText
      ? locationText.replace(/^\d{5}\s*/, "").slice(0, 60)
      : zipMatch ? text.slice(zipMatch.index! + 5).split(/\s{2,}|Beschreibung|seit/)[0]?.trim().slice(0, 60) || null : null;
    const image = node.find("img").first().attr("src") ?? null;
    cards.push({
      externalId,
      url: absolute(href),
      title,
      priceEur: parseEuro(text),
      city,
      zip,
      description: node.find("p").first().text().replace(/\s+/g, " ").trim(),
      imageUrl: image && !image.includes("placeholder") ? image : null,
      locationText,
      text,
    });
  });
  return cards;
}

function attr(html: string, key: string): string | null {
  const match = html.match(new RegExp(`"${key}":"([^"]*)"`));
  return match ? match[1].replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16))) : null;
}

function descriptionFromHtml(html: string): string | null {
  const $ = load(html);
  const text = $("#viewad-description-text").text().replace(/\s+/g, " ").trim();
  return text || null;
}

export function parseKleinanzeigenDetail(html: string, card: KleinanzeigenCard): NormalisedListing {
  const $ = load(html);
  const body = $("body").text().replace(/\s+/g, " ").trim();
  const details = $("#viewad-details").text().replace(/\s+/g, " ").trim() || body;
  const now = new Date().toISOString();
  const monthNames: Record<string, number> = {
    januar: 1, februar: 2, "märz": 3, april: 4, mai: 5, juni: 6,
    juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
  };
  const registration = details.match(/Erstzulassung\s+([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/i);
  const registrationMonth = registration ? monthNames[registration[1].toLowerCase()] : undefined;
  const year = Number(registration?.[2] ?? attr(html, "Erstzulassungsjahr"));
  const month = registrationMonth ?? Number(attr(html, "Erstzulassungsmonat"));
  const mileageText = details.match(/Kilometerstand\s+([\d.]+)\s*km/i)?.[1];
  const mileage = mileageText
    ? Number(mileageText.replace(/\./g, ""))
    : Number(attr(html, "Kilometerstand"));
  const visiblePrice = $("#viewad-price").text();
  const priceText = visiblePrice.match(/(\d[\d.]*)\s*€/)?.[1];
  const price = priceText ? Number(priceText.replace(/\./g, "")) : Number(attr(html, "ExactPreis") ?? attr(html, "Preis"));
  const gearbox = details.match(/Getriebe\s+(Automatik|Schaltgetriebe)/i)?.[1] ?? attr(html, "Getriebe");
  const fuel = details.match(/Kraftstoffart\s+(Benzin|Diesel|Elektro|Hybrid)/i)?.[1] ?? attr(html, "Kraftstoffart");
  const doorsRaw = details.match(/Anzahl Türen\s+(\d+)/i)?.[1] ?? attr(html, "Anzahl_Tueren");
  const doors = doorsRaw ? Number(doorsRaw.split("_")[0]) || null : null;
  const make = details.match(/Marke\s+([A-Za-zÄÖÜäöüß-]+)/)?.[1] ?? attr(html, "Marke");
  const model = details.match(/Modell\s+([A-Za-z0-9ÄÖÜäöüß /-]+?)\s+Kilometerstand/)?.[1]?.trim() ?? attr(html, "Modell")?.replace(/_/g, " ") ?? null;
  const ps = details.match(/Leistung\s+(\d+)\s*PS/i)?.[1];
  const powerKw = Number(attr(html, "Leistung"));
  const description = descriptionFromHtml(html) ?? card.description;
  const seatsMatch = details.match(/Anzahl Sitzplätze\s*:?\s*(\d+)/i) ?? description.match(/\b(\d)\s*Sitze\b/i);
  const isofix = /isofix/i.test(details) || /isofix/i.test(description) ? true : null;
  const seller = attr(html, "Verkaeufer");
  const sellerType = /Privatanbieter|Privater Nutzer/i.test(body) || seller?.toLowerCase().includes("privat")
    ? "private"
    : seller ? "dealer" : "unknown";
  const damaged = /Unfallfrei|Unbeschädigtes Fahrzeug/i.test(details)
    ? false
    : /Unfallschaden|Unfallwagen/i.test(body) ? true : null;
  const commercialOnly = /nur für Export|Exportfahrzeug|nur für Gewerbe/i.test(details)
    ? true
    : sellerType === "private" ? false : null;
  const huMatch = details.match(/HU(?:\s+bis)?\s+([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/i);
  const huMonth = huMatch ? monthNames[huMatch[1].toLowerCase()] : undefined;
  const huDue = huMatch && huMonth
    ? `${huMatch[2]}-${String(huMonth).padStart(2, "0")}-01`
    : attr(html, "HU_Jahr") ? `${attr(html, "HU_Jahr")}-${String(attr(html, "HU_Monat") ?? "01").padStart(2, "0")}-01` : null;
  const bodyType = details.match(/\b(Kombi|Van\/Bus|Kleinwagen|Limousine|SUV|Cabrio)\b/i)?.[1] ?? attr(html, "Fahrzeugtyp");
  const firstRegistration = Number.isFinite(year) && year > 1900
    ? `${year}-${String(Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1).padStart(2, "0")}-01`
    : null;
  const image = html.match(/"contentUrl":"(https:[^"]+)"/)?.[1]?.replace(/\\\//g, "/") ?? card.imageUrl;
  const contentHash = sha256([card.title, price, mileage, firstRegistration, description].join("|")).slice(0, 16);
  const equipment: string[] = [];
  for (const key of ["Klimaanlage", "Navigationssystem", "Sitzheizung", "Tempomat", "Einparkhilfe", "Anhaengerkupplung", "Leichtmetallfelgen"]) {
    if (attr(html, key) === "true" || new RegExp(key, "i").test(body)) equipment.push(key);
  }
  return {
    source: "kleinanzeigen",
    externalId: card.externalId,
    url: card.url,
    title: card.title,
    priceEur: Number.isFinite(price) && price > 0 ? price : card.priceEur,
    currency: "EUR",
    make: make ? make[0].toUpperCase() + make.slice(1) : null,
    model,
    variant: null,
    firstRegistration,
    mileageKm: Number.isFinite(mileage) && mileage > 0 ? mileage : null,
    fuel: fuel ? fuel[0].toUpperCase() + fuel.slice(1) : null,
    transmission: gearbox ? (gearbox.toLowerCase().includes("autom") ? "Automatik" : /manuell|schalt/i.test(gearbox) ? "Schaltgetriebe" : gearbox) : null,
    powerKw: ps ? Math.round(Number(ps) / 1.35962) : Number.isFinite(powerKw) && powerKw > 0 ? powerKw : null,
    powerPs: ps ? Number(ps) : Number.isFinite(powerKw) && powerKw > 0 ? Math.round(powerKw * 1.35962) : null,
    bodyType,
    seats: seatsMatch ? Number(seatsMatch[1]) : null,
    doors,
    sellerType,
    sellerName: null,
    city: card.city,
    zip: card.zip,
    distanceKm: estimateDistanceFromWiesloch(card.zip),
    priceLabel: null,
    priceEvaluation: null,
    priceMedianEur: null,
    damaged,
    commercialOnly,
    hasIsofix: isofix,
    huDue,
    warranty: null,
    carfaxUrl: null,
    description: description.slice(0, 4000),
    equipment,
    redFlags: [],
    summary: description.slice(0, 300),
    imageUrl: image,
    firstSeenAt: now,
    lastSeenAt: now,
    contentHash,
    rawJson: JSON.stringify({ card, attributes: {
      year, month, mileage, price, gearbox, fuel, doors: doorsRaw, make, model, ps, seller,
    } }),
  };
}

export function normaliseKleinanzeigenCard(card: KleinanzeigenCard): NormalisedListing {
  const now = new Date().toISOString();
  const contentHash = sha256([card.title, card.priceEur ?? "", card.description].join("|")).slice(0, 16);
  return {
    source: "kleinanzeigen",
    externalId: card.externalId,
    url: card.url,
    title: card.title,
    priceEur: card.priceEur,
    currency: "EUR",
    make: null,
    model: null,
    variant: null,
    firstRegistration: null,
    mileageKm: null,
    fuel: null,
    transmission: null,
    powerKw: null,
    powerPs: null,
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
    description: card.description,
    equipment: [],
    redFlags: [],
    summary: card.description.slice(0, 300),
    imageUrl: card.imageUrl,
    firstSeenAt: now,
    lastSeenAt: now,
    contentHash,
    rawJson: JSON.stringify(card),
  };
}

export function buildKleinanzeigenUrl(brief: SearchBrief, page: number): string {
  const url = new URL("/s-autos/k0c216", BASE);
  url.searchParams.set("price_to", String(brief.purchaseMaxEur));
  url.searchParams.set("locationStr", brief.location.zip);
  url.searchParams.set("radius", String(brief.location.radiusKm));
  if (brief.hard.minFirstRegistrationYear > 0) url.searchParams.set("year_from", String(brief.hard.minFirstRegistrationYear));
  if (brief.hard.maxMileageKm > 0) url.searchParams.set("mileage_to", String(brief.hard.maxMileageKm));
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

function integrity(cards: KleinanzeigenCard[], brief: SearchBrief): FilterIntegrity {
  const maxPrice = cards.reduce<number | null>((max, card) => card.priceEur === null ? max : Math.max(max ?? 0, card.priceEur), null);
  const maxDistance = cards.reduce<number | null>((max, card) => {
    const distance = estimateDistanceFromWiesloch(card.zip);
    return distance === null ? max : Math.max(max ?? 0, distance);
  }, null);
  const reasons: string[] = [];
  if (cards.length === 0) reasons.push("Kleinanzeigen parsed zero cards");
  if (maxPrice !== null && maxPrice > brief.purchaseMaxEur + 100) reasons.push(`price leak ${maxPrice} > ${brief.purchaseMaxEur}`);
  if (maxDistance !== null && maxDistance > brief.location.radiusKm + 15) reasons.push(`distance leak ${maxDistance} km`);
  return { ok: reasons.length === 0, reasons, observedMaxPriceEur: maxPrice, observedMaxDistanceKm: maxDistance, totalResults: null };
}

export class KleinanzeigenAdapter implements SourceAdapter {
  id = "kleinanzeigen" as const;
  label = "Kleinanzeigen";
  enabled = true;
  statusNote = "direct search + detail HTML";
  accessMethod = "direct_http" as const;

  async search(
    brief: SearchBrief,
    opts: { maxPages?: number; delayMs?: number; onPage?: (source: string, page: RawPage, refs: RawRef[]) => boolean } = {},
  ): Promise<SourceSearchResult> {
    const maxPages = Math.max(1, opts.maxPages ?? 2);
    const delayMs = Math.max(0, opts.delayMs ?? 2000);
    const refs: RawRef[] = [];
    const pages: RawPage[] = [];
    const warnings: string[] = [];
    let totalResults: number | null = null;

    for (let page = 1; page <= maxPages; page += 1) {
      const url = buildKleinanzeigenUrl(brief, page);
      const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Kleinanzeigen page ${page}: HTTP ${response.status}`);
      const html = await response.text();
      const parsedCards = parseKleinanzeigenCards(html);
      const cards = parsedCards.filter((card) => {
        if (card.priceEur === null) return false;
        if (/autoankauf|ankauf|suche|ankäufer/i.test(card.title)) return false;
        if (card.priceEur > brief.purchaseMaxEur) return false;
        const distance = estimateDistanceFromWiesloch(card.zip);
        if (distance !== null && distance > brief.location.radiusKm + 15) return false;
        return true;
      });
      if (parsedCards.length > 0 && cards.length === 0) {
        warnings.push(`Kleinanzeigen local filter removed all ${parsedCards.length} cards`);
      }
      if (cards.length === 0) {
        if (page === 1) warnings.push("Kleinanzeigen parsed zero cards");
        break;
      }
      const pageRefs: RawRef[] = cards.map((card) => ({
        source: "kleinanzeigen",
        externalId: card.externalId,
        url: card.url,
        page,
        payload: card,
      }));
      refs.push(...pageRefs);
      pages.push({
        source: "kleinanzeigen",
        page,
        url,
        fetchedAt: new Date().toISOString(),
        httpStatus: response.status,
        html,
        listingCount: cards.length,
        totalResults,
      });
      if (opts.onPage?.("kleinanzeigen", pages[pages.length - 1], pageRefs)) break;
      if (page < maxPages && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return { source: "kleinanzeigen", refs, pages, totalResults, integrity: integrity(refs.map((ref) => ref.payload as KleinanzeigenCard), brief), warnings };
  }

  async checkAvailability(ref: RawRef): Promise<"available" | "gone" | "unknown"> {
    try {
      const response = await fetch(ref.url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
      if (response.status === 404 || response.status === 410) return "gone";
      if (!response.ok) return "unknown";
      const html = await response.text();
      if (/Anzeige ist nicht mehr verfügbar|Diese Anzeige wurde gelöscht|ad is no longer available/i.test(html)) {
        return "gone";
      }
      // A consent/challenge page can also be a 200. Require the detail ad
      // container before treating the page as positive availability evidence.
      return /data-adid|id="ad-id"/.test(html) ? "available" : "unknown";
    } catch {
      return "unknown";
    }
  }

  async fetchDetail(ref: RawRef): Promise<RawDetail> {
    const response = await fetch(ref.url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Kleinanzeigen detail ${ref.externalId}: HTTP ${response.status}`);
    const html = await response.text();
    const listing = parseKleinanzeigenDetail(html, ref.payload as KleinanzeigenCard);
    return { source: "kleinanzeigen", externalId: ref.externalId, url: ref.url, fetchedAt: new Date().toISOString(), httpStatus: response.status, html, payload: listing.rawJson, listing };
  }
}
