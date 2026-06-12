// Pure parsers for DistroKid's READ-ONLY analytics pages, ported verbatim from
// the proven Go CLI (internal/cmd/stats.go + earnings.go). No browser imports —
// callers hand in raw HTML / #page-data scraped via distrokid-native.

export type StatsItem = { store?: string; date?: string; streams: number };

export type StatsOutput = {
  scope: string;
  view: string;
  url: string;
  items: StatsItem[];
  total: number;
  pending?: boolean;
  message?: string;
};

export type SelectorOption = { id: string | null; val: string | null; upc: string | null; txt: string };

export type EarningsPageData = {
  amount: string | null;
  currency: string | null;
  countryCode: string | null;
};

export type EarningsOutput = {
  balance: number;
  currency: string;
  pending: boolean;
  message?: string;
  url?: string;
};

// ---------------------------------------------------------------------------
// Stats: extract the amCharts dataProvider:[...] array injected in the page.
// ---------------------------------------------------------------------------

export function buildStatsUrl(opts: {
  album?: string;
  track?: string;
  view?: "streams" | "downloads";
  includeDeleted?: boolean;
}): string {
  const q = new URLSearchParams();
  if (opts.album) {
    q.set("type", "album");
    q.set("id", opts.album);
  } else if (opts.track) {
    q.set("type", "track");
    q.set("id", opts.track);
  } else {
    q.set("type", "all");
  }
  q.set("view", opts.view ?? "streams");
  q.set("data", "streams");
  if (opts.includeDeleted) q.set("includeDeleted", "1");
  return "https://distrokid.com/stats/?" + q.toString();
}

const EMPTY_STATS_RE = /haven.t released anything|check back here|once your music is in stores|no stream/i;
const DATA_PROVIDER_RE = /dataProvider\s*[:=]\s*(\[[\s\S]*?\])\s*[,;}]/gi;
const STREAM_VAL_RE = /"?(?:streams|downloads|value|count|y)"?\s*:\s*"?([\d,]+)"?/i;
const STORE_KEY_RE = /"?(?:store|category|label|title|name|x)"?\s*:\s*"([^"]+)"/i;
const DATE_KEY_RE = /"?(?:date|day|when)"?\s*:\s*"([^"]+)"/i;

function parseIntComma(s: string): number {
  return parseInt(s.trim().replace(/,/g, ""), 10) || 0;
}

function toNum(v: unknown): number {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") return parseIntComma(v);
  return 0;
}

function objToItem(obj: Record<string, unknown>): StatsItem | null {
  let streams: number | null = null;
  for (const k of ["streams", "downloads", "value", "count", "y"]) {
    if (k in obj) {
      streams = toNum(obj[k]);
      break;
    }
  }
  if (streams === null) return null;
  const it: StatsItem = { streams };
  for (const k of ["store", "category", "label", "title", "name", "x"]) {
    const v = obj[k];
    if (typeof v === "string" && v !== "") {
      it.store = v;
      break;
    }
  }
  for (const k of ["date", "day", "when"]) {
    const v = obj[k];
    if (typeof v === "string" && v !== "") {
      it.date = v;
      break;
    }
  }
  return it;
}

// splitObjects breaks a `[ {...}, {...} ]` literal into per-object substrings
// without requiring strict JSON.
function splitObjects(arr: string): string[] {
  const objs: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        objs.push(arr.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objs;
}

function looseToItem(objStr: string): StatsItem | null {
  const m = STREAM_VAL_RE.exec(objStr);
  if (!m) return null;
  const it: StatsItem = { streams: parseIntComma(m[1]) };
  const sm = STORE_KEY_RE.exec(objStr);
  if (sm) it.store = sm[1];
  const dm = DATE_KEY_RE.exec(objStr);
  if (dm) it.date = dm[1];
  return it;
}

export function extractDataProvider(html: string): { items: StatsItem[]; total: number } {
  const items: StatsItem[] = [];
  let total = 0;
  for (const m of html.matchAll(DATA_PROVIDER_RE)) {
    const arr = m[1];
    // First try strict JSON (amCharts often emits valid JSON arrays).
    let strict: unknown;
    try {
      strict = JSON.parse(arr);
    } catch {
      strict = null;
    }
    if (Array.isArray(strict)) {
      for (const obj of strict) {
        if (obj && typeof obj === "object") {
          const it = objToItem(obj as Record<string, unknown>);
          if (it) {
            items.push(it);
            total += it.streams;
          }
        }
      }
      continue;
    }
    // Fallback: per-object scrape (handles single-quoted / loose JS).
    for (const objStr of splitObjects(arr)) {
      const it = looseToItem(objStr);
      if (it) {
        items.push(it);
        total += it.streams;
      }
    }
  }
  return { items, total };
}

export function parseStats(
  r: { url: string; html: string; selector: SelectorOption[] },
  opts: { album?: string; track?: string; view?: string } = {},
): StatsOutput {
  const scope = opts.album ? "album:" + opts.album : opts.track ? "track:" + opts.track : "account";
  const out: StatsOutput = {
    scope,
    view: opts.view ?? "streams",
    url: r.url,
    items: [],
    total: 0,
  };

  const emptyMarkup = EMPTY_STATS_RE.test(r.html);
  let scopedMissing = false;
  const scoped = !!(opts.album || opts.track);
  if (scoped) {
    const want = ((opts.album ?? "") + (opts.track ?? "")).toLowerCase();
    const found = r.selector.some((o) =>
      ((o.val ?? "") + (o.id ?? "") + (o.upc ?? "")).toLowerCase().includes(want),
    );
    if (r.selector.length > 0 && !found) scopedMissing = true;
  }

  const { items, total } = extractDataProvider(r.html);
  if (items.length === 0 && (emptyMarkup || scopedMissing || scoped)) {
    out.pending = true;
    out.message = "DistroKid hasn't ingested this release yet";
    return out;
  }
  out.items = items;
  out.total = total;
  return out;
}

// ---------------------------------------------------------------------------
// Earnings: parse /bank/overview/ #page-data (convertAmountToNum semantics).
// ---------------------------------------------------------------------------

const NO_EARNINGS_RE = /no earnings reported yet|class="no-earnings"/i;
const BALANCE_TEXT_RE = /([£$€])\s?([\d,]+\.\d{2})/;

function parseAmount(s: string): number {
  return parseFloat(s.trim().replace(/,/g, "")) || 0;
}

// convertAmountToNum mirrors DistroKid's own JS helper: drop a single leading
// non-digit (currency symbol), strip thousands separators, Number().
export function convertAmountToNum(num: string): number {
  num = num.trim();
  if (!num) return 0;
  if (!/^[0-9]/.test(num)) num = num.slice(1);
  return parseAmount(num);
}

function normalizeCurrency(s: string): { code: string; symbol: string } | null {
  switch (s.trim().toUpperCase()) {
    case "GBP":
    case "£":
      return { code: "GBP", symbol: "£" };
    case "USD":
    case "$":
      return { code: "USD", symbol: "$" };
    case "EUR":
    case "€":
      return { code: "EUR", symbol: "€" };
    default:
      return null;
  }
}

function resolveCurrency(pd: EarningsPageData, htmlSymbol?: string): string {
  if (pd.currency) {
    const c = normalizeCurrency(pd.currency);
    if (c) return c.code;
  }
  const amt = (pd.amount ?? "").trim();
  if (amt) {
    const c = normalizeCurrency(amt[0]);
    if (c) return c.code;
  }
  // Only trust an HTML-scraped symbol when the balance itself came from that
  // same HTML match — the bank page contains unrelated $-priced promo copy.
  if (htmlSymbol) {
    const c = normalizeCurrency(htmlSymbol);
    if (c) return c.code;
  }
  switch ((pd.countryCode ?? "").trim().toUpperCase()) {
    case "GB":
    case "UK":
      return "GBP";
    case "US":
      return "USD";
  }
  // Default: this account renders en-GB.
  return "GBP";
}

export function parseEarnings(r: { url: string; html: string; pageData: EarningsPageData }): EarningsOutput {
  const out: EarningsOutput = {
    balance: 0,
    currency: resolveCurrency(r.pageData),
    pending: false,
    url: r.url,
  };

  // Empty / no-earnings state => balance 0, pending:false (honest £0).
  if (NO_EARNINGS_RE.test(r.html)) {
    out.message = "No earnings reported yet";
    return out;
  }

  // Preferred: #page-data data-amount.
  if (r.pageData.amount) {
    out.balance = convertAmountToNum(r.pageData.amount);
    return out;
  }

  // Fallback: first currency-prefixed amount in the HTML — only this branch may
  // take its currency from the HTML match.
  const m = BALANCE_TEXT_RE.exec(r.html);
  if (m) {
    out.balance = parseAmount(m[2]);
    out.currency = resolveCurrency(r.pageData, m[1]);
    return out;
  }

  out.pending = true;
  out.message = "no balance element found on bank page";
  return out;
}
