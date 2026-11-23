import { readFileSync } from "node:fs";

export type EmailSource = "mobile_de" | "autoscout24" | "kleinanzeigen" | "unknown";

export interface EmailLead {
  source: EmailSource;
  externalId: string;
  url: string;
  emailFile: string;
  foundAt: string;
}

function clean(text: string): string {
  return text
    .replace(/=\r?\n/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sourceOf(url: string): EmailSource {
  if (/suchen\.mobile\.de|mobile\.de\/auto-inserat/i.test(url)) return "mobile_de";
  if (/autoscout24\.de\/angebote/i.test(url)) return "autoscout24";
  if (/kleinanzeigen\.de\/s-anzeige/i.test(url)) return "kleinanzeigen";
  return "unknown";
}

function externalIdOf(url: string, source: EmailSource): string {
  if (source === "autoscout24") {
    const match = url.match(/-([0-9a-f]{8}-[0-9a-f-]{27,})$/i);
    return match ? match[1] : url;
  }
  if (source === "kleinanzeigen") {
    const match = url.match(/\/(\d{6,})-216-/);
    return match ? match[1] : url;
  }
  if (source === "mobile_de") {
    const query = url.match(/[?&]id=(\d+)/);
    if (query) return query[1];
    const path = url.match(/\/(\d{6,})\.html/);
    if (path) return path[1];
  }
  return url;
}

export function extractListingLinks(text: string, emailFile = "inline"): EmailLead[] {
  const cleaned = clean(text);
  const urls = cleaned.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const seen = new Set<string>();
  const leads: EmailLead[] = [];

  for (const raw of urls) {
    const url = raw.replace(/[),.;]+$/, "");
    if (!/mobile\.de|autoscout24\.de|kleinanzeigen\.de/i.test(url)) continue;
    if (!/auto-inserat|fahrzeuge\/details|\/angebote\/|\/s-anzeige\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const source = sourceOf(url);
    leads.push({
      source,
      externalId: externalIdOf(url, source),
      url,
      emailFile,
      foundAt: new Date().toISOString(),
    });
  }

  return leads;
}

export function parseEmailFile(path: string): EmailLead[] {
  return extractListingLinks(readFileSync(path, "utf8"), path);
}
