/**
 * Real-world finance and business data for agents on OKX AI.
 * - Company registry (GLEIF, CC0)
 * - Sanctions screening against the US OFAC SDN list (US government public data)
 * - Public company filings (SEC EDGAR; requires a descriptive User-Agent with contact details)
 * - Invoice maths for stablecoin invoices (tax and FX conversion)
 * - Counterparty check: registry + sanctions + verified business wallets in one call
 * Screening results are a risk signal, not legal or compliance advice.
 */
import { db } from "./db.js";

db.exec(`CREATE TABLE IF NOT EXISTS sanctions_cache (id INTEGER PRIMARY KEY CHECK (id = 1), fetched_at TEXT NOT NULL, json TEXT NOT NULL)`);

const TIMEOUT = 10_000;
async function getJson(url: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`Upstream ${new URL(url).host} returned ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- names
const LEGAL_SUFFIX = /\b(inc|incorporated|ltd|limited|llc|plc|gmbh|ag|sa|sas|bv|nv|pte|pty|co|corp|corporation|company|holdings?|group|the)\b/g;
export function normalizeName(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(LEGAL_SUFFIX, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string) { return new Set(normalizeName(s).split(" ").filter((w) => w.length > 1)); }
export function nameSimilarity(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; A.forEach((t) => B.has(t) && inter++);
  return inter / Math.max(A.size, B.size);
}

// ---------------------------------------------------------------- sanctions
type SdnEntry = { uid: string; name: string; type: string; program: string };
const SDN_URL = process.env.OFAC_SDN_URL ?? "https://www.treasury.gov/ofac/downloads/sdn.csv";

function parseCsvLine(line: string) {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out.map((s) => s.trim());
}
export function parseSdn(csv: string): SdnEntry[] {
  return csv.split(/\r?\n/).filter(Boolean).map(parseCsvLine).filter((c) => c.length >= 4 && /^\d+$/.test(c[0]))
    .map((c) => ({ uid: c[0], name: c[1], type: c[2] === "-0-" ? "entity" : c[2], program: c[3] }));
}

let sdnMemo: { at: number; list: SdnEntry[] } | null = null;
export async function sanctionsList(): Promise<{ list: SdnEntry[]; fetchedAt: string }> {
  if (sdnMemo && Date.now() - sdnMemo.at < 6 * 3600e3) return { list: sdnMemo.list, fetchedAt: new Date(sdnMemo.at).toISOString() };
  const cached = db.prepare(`SELECT fetched_at, json FROM sanctions_cache WHERE id = 1`).get() as { fetched_at: string; json: string } | undefined;
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < 24 * 3600e3) {
    sdnMemo = { at: new Date(cached.fetched_at).getTime(), list: JSON.parse(cached.json) };
    return { list: sdnMemo.list, fetchedAt: cached.fetched_at };
  }
  try {
    const r = await fetch(SDN_URL);
    if (!r.ok) throw new Error(`OFAC list returned ${r.status}`);
    const list = parseSdn(await r.text());
    if (list.length < 100) throw new Error("OFAC list looked incomplete");
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO sanctions_cache (id, fetched_at, json) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json`).run(at, JSON.stringify(list));
    sdnMemo = { at: Date.now(), list };
    return { list, fetchedAt: at };
  } catch (e) {
    if (cached) return { list: JSON.parse(cached.json), fetchedAt: cached.fetched_at };
    throw e;
  }
}
/** Seed or replace the list manually (tests, air-gapped deployments). */
export function loadSanctionsCsv(csv: string) {
  const list = parseSdn(csv); const at = new Date().toISOString();
  db.prepare(`INSERT INTO sanctions_cache (id, fetched_at, json) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json`).run(at, JSON.stringify(list));
  sdnMemo = { at: Date.now(), list };
  return list.length;
}

export async function screenName(name: string, threshold = 0.8) {
  if (!name || name.trim().length < 2) throw new Error("name is required");
  const { list, fetchedAt } = await sanctionsList();
  const matches = list.map((e) => ({ ...e, score: +nameSimilarity(name, e.name).toFixed(2) }))
    .filter((m) => m.score >= threshold).sort((a, b) => b.score - a.score).slice(0, 5);
  return { query: name, listSource: "US OFAC SDN", listFetchedAt: fetchedAt, possibleMatch: matches.length > 0, matches,
    note: "Automated name screening. Possible matches need human review; this is not legal advice." };
}

// ---------------------------------------------------------------- registry
export async function registryLookup(q: { name?: string; lei?: string }) {
  const base = "https://api.gleif.org/api/v1/lei-records";
  const h = { accept: "application/vnd.api+json" };
  const toRec = (d: any) => ({
    lei: d.id, legalName: d.attributes?.entity?.legalName?.name, status: d.attributes?.entity?.status,
    jurisdiction: d.attributes?.entity?.jurisdiction, country: d.attributes?.entity?.legalAddress?.country,
    registrationStatus: d.attributes?.registration?.status, nextRenewal: d.attributes?.registration?.nextRenewalDate,
  });
  if (q.lei) {
    if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(q.lei)) throw new Error("lei must be a 20-character LEI");
    return [toRec((await getJson(`${base}/${q.lei}`, h)).data)];
  }
  if (!q.name) throw new Error("name or lei is required");
  const j = await getJson(`${base}?filter[entity.legalName]=${encodeURIComponent(q.name)}&page[size]=5`, h);
  return (j.data ?? []).map(toRec);
}

// ---------------------------------------------------------------- filings
export async function secCompany(cikRaw: string) {
  const cik = String(cikRaw ?? "").replace(/\D/g, "");
  if (!cik || cik.length > 10) throw new Error("cik must be a numeric SEC Central Index Key");
  const ua = process.env.SEC_USER_AGENT;
  if (!ua) throw new Error("Set SEC_USER_AGENT (e.g. 'Vendo ops@yourdomain.com') as required by SEC fair access rules");
  const j = await getJson(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, { "user-agent": ua });
  const r = j.filings?.recent ?? {};
  const recent = (r.form ?? []).slice(0, 15).map((form: string, i: number) => ({ form, filed: r.filingDate?.[i], reportDate: r.reportDate?.[i], accession: r.accessionNumber?.[i] }));
  return { cik, name: j.name, tickers: j.tickers, exchanges: j.exchanges, sic: j.sicDescription, stateOfIncorporation: j.stateOfIncorporation, recentFilings: recent };
}

// ---------------------------------------------------------------- invoices
export async function invoiceCalc(q: { amount: string; currency?: string; taxRatePct?: string; taxInclusive?: string; to?: string }) {
  const amount = Number(q.amount);
  if (!(amount > 0 && amount < 1e12)) throw new Error("amount must be a positive number");
  const rate = q.taxRatePct == null ? 0 : Number(q.taxRatePct);
  if (!(rate >= 0 && rate <= 50)) throw new Error("taxRatePct must be between 0 and 50");
  const inclusive = q.taxInclusive === "true";
  const net = inclusive ? amount / (1 + rate / 100) : amount;
  const tax = net * (rate / 100);
  const gross = net + tax;
  const currency = (q.currency ?? "USD").toUpperCase();
  let fx: any = null;
  if (q.to && q.to.toUpperCase() !== currency) {
    const to = q.to.toUpperCase();
    if (!/^[A-Z]{3}$/.test(to) || !/^[A-Z]{3}$/.test(currency)) throw new Error("currencies must be 3-letter codes");
    const j = await getJson(`https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=${to}`);
    const r = j.rates?.[to];
    if (!r) throw new Error(`No reference rate for ${currency} to ${to}`);
    fx = { to, rate: r, date: j.date, net: +(net * r).toFixed(2), tax: +(tax * r).toFixed(2), gross: +(gross * r).toFixed(2), source: "Frankfurter reference rates" };
  }
  return { currency, taxRatePct: rate, taxInclusive: inclusive, net: +net.toFixed(2), tax: +tax.toFixed(2), gross: +gross.toFixed(2),
    stablecoinSettlement: currency === "USD" ? { asset: "USDT0", amount: +gross.toFixed(6) } : null, fx,
    note: "Arithmetic only. The caller supplies the tax rate; confirm rates with a tax professional." };
}
