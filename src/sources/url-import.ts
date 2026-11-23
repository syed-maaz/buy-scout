import { load } from "cheerio";
import type { NormalisedListing, SourceId } from "../core/types.js";
import { fetchHtmlWithBrowser, isChallengePage } from "../core/browser.js";
import { sha256 } from "../core/parse.js";
import { estimateDistanceFromWiesloch } from "./autouncle.js";
import {
  parseKleinanzeigenDetail,
  type KleinanzeigenCard,
} from "./kleinanzeigen.js";

export interface UrlImportResult {
  listing: NormalisedListing;
  fetchedVia: "http" | "browser";
  finalUrl: string;
  warnings: string[];
}

const HEADERS = {
  "accept-language": "de-DE,de;q=0.9",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
};

function cleanUrl(raw: string): string {
  const url = new URL(raw);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || key.startsWith("au_")) url.searchParams.delete(key);
  }
  return url.toString();
}

function sourceFromUrl(url: string): SourceId {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (host.endsWith("mobile.de")) return "mobile_de";
  if (host.endsWith("kleinanzeigen.de")) return "kleinanzeigen";
  throw new Error(`Unsupported listing host: ${host}`);
}

async function fetchPage(url: string): Promise<{ html: string; finalUrl: string; via: "http" | "browser" }> {
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    const html = await response.text();
    if (response.ok && html.length > 5_000 && !isChallengePage(html)) {
      return { html, finalUrl: response.url || url, via: "http" };
    }
  } catch {
    // Browser fallback below.
  }
  const page = await fetchHtmlWithBrowser(url);
  return { html: page.html, finalUrl: page.finalUrl, via: "browser" };
}

function parseEuro(text: string): number | null {
  const match = text.replace(/\s/g, "").match(/(\d[\d.]*)\s*€/);
  if (!match) return null;
  const value = Number(match[1].replace(/\./g, ""));
  return Number.isFinite(value) ? value : null;
}

function parseKleinanzeigen(html: string, url: string): NormalisedListing {
  const $ = load(html);
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const detailText = $("#viewad-details").text().replace(/\s+/g, " ").trim() || bodyText;
  const title =
    $("#viewad-title").first().text().replace(/\s+/g, " ").trim() ||
    $("h1").first().text().replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Kleinanzeigen detail page has no title");

  const externalId = url.match(/-(\d{8,})-\d+-\d+/)?.[1] ?? url.match(/\/(\d{8,})/)?.[1];
  if (!externalId) throw new Error("Kleinanzeigen URL has no listing id");

  const locality = $("#viewad-locality").first().text().replace(/\s+/g, " ").trim();
  const zip = locality.match(/\b(\d{5})\b/)?.[1] ?? null;
  const city = locality
    .replace(/^\d{5}\s*/, "")
    .replace(/^Baden-Württemberg\s*-\s*/i, "")
    .split(",")[0]
    ?.trim() || null;
  const description = $("#viewad-description-text").text().replace(/\s+/g, " ").trim();
  const price = parseEuro($("#viewad-price").text()) ?? parseEuro(bodyText);
  const card: KleinanzeigenCard = {
    externalId,
    url,
    title,
    priceEur: price,
    city,
    zip,
    description,
    imageUrl: $('meta[property="og:image"]').attr("content") ?? null,
    locationText: locality,
    text: bodyText,
  };

  const listing = parseKleinanzeigenDetail(html, card);

  if (listing.seats === null) {
    const seats = detailText.match(/(?:Anzahl Sitzplätze|Sitzplätze)\s*:?\s*(\d+)/i);
    if (seats) listing.seats = Number(seats[1]);
  }
  if (listing.hasIsofix === null && /isofix/i.test(detailText)) listing.hasIsofix = true;
  if (listing.damaged === null) {
    if (/Unfallfrei|Unbeschädigtes Fahrzeug/i.test(detailText)) listing.damaged = false;
    else if (/Unfallschaden|Unfallwagen/i.test(detailText)) listing.damaged = true;
  }
  if (listing.firstRegistration === null) {
    const registration = detailText.match(/Erstzulassung\s+([A-Za-zäöüÄÖÜ]+)\s+(\d{4})/i);
    if (registration) {
      const months: Record<string, string> = {
        januar: "01", februar: "02", "märz": "03", april: "04", mai: "05", juni: "06",
        juli: "07", august: "08", september: "09", oktober: "10", november: "11", dezember: "12",
      };
      const month = months[registration[1].toLowerCase()];
      if (month) listing.firstRegistration = `${registration[2]}-${month}-01`;
    }
  }
  if (listing.huDue === null) {
    const hu = detailText.match(/HU(?:\s+bis)?\s*(\d{1,2})\/(\d{4})/i);
    if (hu) listing.huDue = `${hu[2]}-${hu[1].padStart(2, "0")}-01`;
  }
  if (!listing.bodyType) {
    const body = detailText.match(/\b(Kombi|Van\/Bus|Kleinwagen|Limousine|SUV|Cabrio)\b/i);
    if (body) listing.bodyType = body[1];
  }
  if (listing.sellerType === "unknown" && /Privatanbieter|Privater Nutzer/i.test(bodyText)) {
    listing.sellerType = "private";
  }
  listing.city = listing.city ?? city;
  listing.zip = listing.zip ?? zip;
  listing.distanceKm = listing.distanceKm ?? estimateDistanceFromWiesloch(listing.zip);
  listing.rawJson = JSON.stringify({ card, importedFrom: "kleinanzeigen-url", bodyText: bodyText.slice(0, 20_000) });
  return listing;
}

function mobileBodyType(value: unknown): string | null {
  const map: Record<string, string> = {
    EstateCar: "Kombi",
    Van: "Van",
    CompactCar: "Kleinwagen",
    Sedan: "Limousine",
    SUV: "SUV",
    Coupe: "Coupé",
    Convertible: "Cabrio",
  };
  return typeof value === "string" ? map[value] ?? value : null;
}

function parseMobileDe(html: string, url: string): NormalisedListing {
  const $ = load(html);
  const bodyText = $("body")
    .clone()
    .find("script,style,noscript,template")
    .remove()
    .end()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const scripts = $('script[type="application/ld+json"]')
    .toArray()
    .map((element) => {
      try {
        return JSON.parse($(element).text()) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((value): value is Record<string, unknown> => value !== null);
  const car = scripts.find((value) => value["@type"] === "Car");
  if (!car) throw new Error("mobile.de page has no Car JSON-LD block");

  const offer = (car.offers ?? {}) as Record<string, unknown>;
  const seller = (offer.offeredBy ?? {}) as Record<string, unknown>;
  const address = (seller.address ?? {}) as Record<string, unknown>;
  const brand = (car.brand ?? {}) as Record<string, unknown>;
  const mileage = (car.mileageFromOdometer ?? {}) as Record<string, unknown>;
  const title = String(car.name ?? $("h1").first().text() ?? "").trim();
  const first = bodyText.match(/Erstzulassung\s+(\d{1,2})\/(\d{4})/i);
  const fuel = bodyText.match(/Kraftstoffart\s+(Benzin|Diesel|Elektro|Hybrid|Plugin-Hybrid)/i)?.[1] ?? null;
  const transmission = bodyText.match(/Getriebe\s+(Automatik|Schaltgetriebe)/i)?.[1] ?? null;
  const power = bodyText.match(/Leistung\s+(\d+)\s*kW\s*\((\d+)\s*PS\)/i);
  const hu = bodyText.match(/HU\s+(\d{1,2})\/(\d{4})/i);
  const zip = typeof address.postalCode === "string" ? address.postalCode : null;
  const city = typeof address.addressLocality === "string" ? address.addressLocality : null;
  const now = new Date().toISOString();
  const externalId = url.match(/(\d{8,})\.html/)?.[1] ?? url.match(/(\d{8,})/)?.[1];
  if (!externalId) throw new Error("mobile.de URL has no listing id");

  const listing: NormalisedListing = {
    source: "mobile_de",
    externalId,
    url,
    title,
    priceEur: typeof offer.price === "number" ? offer.price : null,
    currency: "EUR",
    make: typeof brand.name === "string" ? brand.name : null,
    model: typeof car.model === "string" ? car.model : null,
    variant: null,
    firstRegistration: first ? `${first[2]}-${first[1].padStart(2, "0")}-01` : null,
    mileageKm: typeof mileage.value === "number" ? mileage.value : null,
    fuel,
    transmission,
    powerKw: power ? Number(power[1]) : null,
    powerPs: power ? Number(power[2]) : null,
    bodyType: mobileBodyType(car.bodyType),
    seats: typeof car.seatingCapacity === "number" ? car.seatingCapacity : null,
    doors: typeof car.numberOfDoors === "number" ? car.numberOfDoors : null,
    sellerType: seller["@type"] === "AutoDealer" ? "dealer" : seller["@type"] === "Person" ? "private" : "unknown",
    sellerName: typeof seller.name === "string" ? seller.name : null,
    city,
    zip,
    distanceKm: estimateDistanceFromWiesloch(zip),
    priceLabel: null,
    priceEvaluation: null,
    priceMedianEur: null,
    damaged: /Unfallfrei/i.test(bodyText) ? false : /Unfallschaden|Unfallwagen/i.test(bodyText) ? true : null,
    commercialOnly: null,
    hasIsofix: /\bIsofix\b/i.test(bodyText) ? true : null,
    huDue: hu ? `${hu[2]}-${hu[1].padStart(2, "0")}-01` : null,
    warranty: null,
    carfaxUrl: null,
    description: bodyText.slice(0, 4000),
    equipment: [],
    redFlags: [],
    summary: title,
    imageUrl: typeof car.image === "string" ? car.image : null,
    firstSeenAt: now,
    lastSeenAt: now,
    contentHash: sha256([title, offer.price, mileage.value, first?.[2]].join("|")).slice(0, 16),
    rawJson: JSON.stringify({ car, importedFrom: "mobile-de-url", bodyText: bodyText.slice(0, 20_000) }),
  };
  return listing;
}

export async function importListingUrl(rawUrl: string): Promise<UrlImportResult> {
  const url = cleanUrl(rawUrl);
  const source = sourceFromUrl(url);
  let page = await fetchPage(url);
  const warnings: string[] = [];
  if (page.via === "browser") warnings.push("plain HTTP was blocked; used a local browser");
  if (page.finalUrl !== url) warnings.push(`redirected to ${page.finalUrl}`);

  let listing: NormalisedListing;
  if (source === "kleinanzeigen") {
    listing = parseKleinanzeigen(page.html, url);
  } else {
    try {
      listing = parseMobileDe(page.html, url);
    } catch (error) {
      if (page.via === "browser") {
        throw new Error(
          "mobile.de blocked the request. Set BUY_SCOUT_CHROME_PROFILE to a Chrome profile that can open mobile.de, or import a Kleinanzeigen/AutoUncle listing.",
        );
      }
      page = await fetchHtmlWithBrowser(url).then((result) => ({
        html: result.html,
        finalUrl: result.finalUrl,
        via: "browser" as const,
      }));
      warnings.push("mobile.de HTTP page had no car data; used a local browser");
      try {
        listing = parseMobileDe(page.html, url);
      } catch {
        throw new Error(
          "mobile.de blocked the request. Set BUY_SCOUT_CHROME_PROFILE to a Chrome profile that can open mobile.de, or import a Kleinanzeigen/AutoUncle listing.",
        );
      }
    }
  }

  return { listing, fetchedVia: page.via, finalUrl: page.finalUrl, warnings };
}
