import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Parse German-formatted integers such as "165.000 km" or "1.582 cm³". */
export function parseGermanInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  if (typeof value !== "string") return null;
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/** "06-2012" or "06/2012" -> "2012-06-01". */
export function parseFirstRegistration(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2})[-/](\d{4})$/);
  if (!match) return null;
  const month = Number.parseInt(match[1], 10);
  const year = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** "85 kW (116 PS)" -> { kw: 85, ps: 116 }. */
export function parsePower(value: unknown): { kw: number | null; ps: number | null } {
  if (typeof value !== "string") return { kw: null, ps: null };
  const kw = value.match(/(\d+)\s*kW/i);
  const ps = value.match(/(\d+)\s*PS/i);
  return {
    kw: kw ? Number.parseInt(kw[1], 10) : null,
    ps: ps ? Number.parseInt(ps[1], 10) : null,
  };
}

export function parseDistance(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  return Number.parseFloat(match[1].replace(",", "."));
}

export function absoluteUrl(base: string, path: string): string {
  return new URL(path, base).toString();
}
