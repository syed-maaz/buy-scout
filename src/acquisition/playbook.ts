export type AccessSymptom =
  | "http_403"
  | "cloudflare"
  | "akamai"
  | "login_wall"
  | "captcha"
  | "rate_limited"
  | "filter_ignored"
  | "empty_payload"
  | "js_only"
  | "unknown";

export type AccessStrategy =
  | "direct_http"
  | "json_ld"
  | "playwright_headless"
  | "playwright_headful"
  | "cdp_attach"
  | "firecrawl"
  | "firecrawl_actions"
  | "jina_reader"
  | "saved_search_email"
  | "official_api"
  | "rss_feed"
  | "manual_url"
  | "extension_capture"
  | "local_filter";

export interface StrategyRecommendation {
  strategy: AccessStrategy;
  why: string;
  evidence?: string;
}

export interface PlaybookEntry {
  symptom: AccessSymptom;
  label: string;
  signals: RegExp[];
  strategies: StrategyRecommendation[];
}

const ENTRIES: Record<AccessSymptom, PlaybookEntry> = {
  http_403: {
    symptom: "http_403",
    label: "HTTP 403 / access denied",
    signals: [/403/i, /access denied/i, /zugriff verweigert/i, /forbidden/i],
    strategies: [
      { strategy: "playwright_headless", why: "A real browser sometimes passes where plain HTTP is fingerprinted." },
      { strategy: "playwright_headful", why: "Headful + persistent profile is the next step when headless is denied." },
      { strategy: "firecrawl", why: "Hosted fetcher with proxy/edge fallback; confirmed on mobile.de." },
      { strategy: "jina_reader", why: "Reader proxy; confirmed on AutoUncle, not on mobile.de." },
      { strategy: "saved_search_email", why: "Platform-initiated digest is the most reliable no-key trigger." },
      { strategy: "manual_url", why: "Last-resort user-assisted path." },
    ],
  },
  cloudflare: {
    symptom: "cloudflare",
    label: "Cloudflare challenge",
    signals: [/just a moment/i, /cloudflare/i, /cf_chl/i, /sicherheitsüberprüfung/i],
    strategies: [
      { strategy: "jina_reader", why: "Confirmed working on AutoUncle (2026-10-28)." },
      { strategy: "firecrawl", why: "Hosted fetcher; confirmed on AutoUncle." },
      { strategy: "playwright_headful", why: "Can pass some challenges, but not reliable headless." },
      { strategy: "manual_url", why: "Do not build a CAPTCHA-solving arms race." },
    ],
  },
  akamai: {
    symptom: "akamai",
    label: "Akamai bot challenge",
    signals: [/_abck/i, /bm_sz/i, /akamai/i],
    strategies: [
      { strategy: "playwright_headful", why: "Persistent profile + real browser is the best first attempt." },
      { strategy: "cdp_attach", why: "Attach to the user's normal Chrome session." },
      { strategy: "firecrawl", why: "Hosted fallback when the browser is blocked." },
      { strategy: "saved_search_email", why: "Avoid the challenge entirely for ongoing monitoring." },
    ],
  },
  login_wall: {
    symptom: "login_wall",
    label: "Login wall",
    signals: [/sign in/i, /log in/i, /anmelden/i, /login/i],
    strategies: [
      { strategy: "cdp_attach", why: "Use the user's already-authenticated browser session." },
      { strategy: "extension_capture", why: "Capture only pages the user opens." },
      { strategy: "manual_url", why: "Never store or replay marketplace credentials." },
    ],
  },
  captcha: {
    symptom: "captcha",
    label: "CAPTCHA",
    signals: [/captcha/i, /robot/i, /are you human/i],
    strategies: [
      { strategy: "official_api", why: "Use the licensed/partner route instead of solving CAPTCHAs." },
      { strategy: "saved_search_email", why: "Platform-initiated path avoids the challenge." },
      { strategy: "manual_url", why: "User-assisted fallback." },
    ],
  },
  rate_limited: {
    symptom: "rate_limited",
    label: "Rate limited",
    signals: [/429/i, /rate limit/i, /too many requests/i],
    strategies: [
      { strategy: "direct_http", why: "Back off, cache, and lower frequency before changing tools." },
      { strategy: "saved_search_email", why: "Shift monitoring to the platform's digest." },
    ],
  },
  filter_ignored: {
    symptom: "filter_ignored",
    label: "Filters silently ignored",
    signals: [/implausibly broad/i, /filter.*leak/i, /filter.*ignored/i],
    strategies: [
      { strategy: "local_filter", why: "Assert max price/radius/count, then filter locally." },
      { strategy: "firecrawl_actions", why: "Set filters through the UI before scraping." },
      { strategy: "playwright_headless", why: "Drive the filter UI instead of hand-built URLs." },
      { strategy: "saved_search_email", why: "Let the platform apply the filters." },
    ],
  },
  empty_payload: {
    symptom: "empty_payload",
    label: "Empty or truncated payload",
    signals: [/body too small/i, /zero cards/i, /zero listings/i, /empty/i],
    strategies: [
      { strategy: "playwright_headless", why: "Wait for content instead of networkidle." },
      { strategy: "jina_reader", why: "Try a reader proxy; confirmed on AutoUncle." },
      { strategy: "firecrawl", why: "Hosted renderer with retries." },
    ],
  },
  js_only: {
    symptom: "js_only",
    label: "JavaScript-only page",
    signals: [/no listing nodes/i, /app shell/i, /javascript/i],
    strategies: [
      { strategy: "playwright_headless", why: "Render the page and wait for listing selectors." },
      { strategy: "firecrawl", why: "Hosted renderer." },
      { strategy: "json_ld", why: "Prefer structured data when present." },
    ],
  },
  unknown: {
    symptom: "unknown",
    label: "Unclassified block",
    signals: [],
    strategies: [
      { strategy: "direct_http", why: "Confirm the baseline with a minimal request." },
      { strategy: "playwright_headless", why: "Try a real browser." },
      { strategy: "firecrawl", why: "Try a hosted fetcher." },
      { strategy: "manual_url", why: "Keep the pipeline alive while investigating." },
    ],
  },
};

export const ACCESS_PLAYBOOK: Record<AccessSymptom, PlaybookEntry> = ENTRIES;

export function classifyAccessFailure(
  error: unknown,
  context: { status?: number; body?: string } = {},
): AccessSymptom {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const haystack = `${message} ${context.body ?? ""}`.toLowerCase();

  if (context.status === 429 || /429|rate limit|too many requests/.test(haystack)) {
    return "rate_limited";
  }
  if (/captcha|are you human|robot/.test(haystack)) return "captcha";
  if (/just a moment|cloudflare|cf_chl|sicherheitsüberprüfung/.test(haystack)) return "cloudflare";
  if (/_abck|bm_sz|akamai/.test(haystack)) return "akamai";
  if (/login|sign in|anmelden/.test(haystack)) return "login_wall";
  if (/implausibly broad|filter.*leak|filter.*ignored/.test(haystack)) return "filter_ignored";
  if (/body too small|zero cards|zero listings|empty/.test(haystack)) return "empty_payload";
  if (/no listing nodes|app shell|javascript/.test(haystack)) return "js_only";
  if (context.status === 403 || /403|forbidden|access denied|zugriff verweigert/.test(haystack)) {
    return "http_403";
  }
  return "unknown";
}

export function recommendStrategies(symptom: AccessSymptom): StrategyRecommendation[] {
  return ENTRIES[symptom].strategies;
}

export function playbookEntries(): PlaybookEntry[] {
  return Object.values(ENTRIES);
}

export function formatRecommendations(symptom: AccessSymptom): string {
  return recommendStrategies(symptom)
    .map((rec, index) => `${index + 1}. ${rec.strategy} — ${rec.why}`)
    .join("\n");
}
