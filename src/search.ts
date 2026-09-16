/** Service search across all active Vendo stores. Used by the extension, MCP and the skills bundle. */
import { listBusinesses } from "./registry.js";
import { uptime } from "./health.js";
import { retention } from "./ledger.js";
import { env } from "./env.js";
import { sellerLevels } from "./levels.js";

const STOP = new Set(["the","and","for","with","this","that","from","into","your","you","our","are","can","get","new","any","all","per","how","what","who","why","when","use","please","need","want","some","find","check","data","service"]);
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []).filter((w) => !STOP.has(w));

export function searchServices(q: string, opts: { maxPriceUsd?: number; limit?: number } = {}) {
  const qw = [...new Set(words(q))];
  const up = new Map(uptime(24).map((u) => [u.business_id, u.uptimePct]));
  const rep = new Map(retention().map((r) => [r.business_id, r.repeatRate]));
  const levels = sellerLevels();
  const items = listBusinesses().filter((b) => b.status !== "paused").flatMap((b) => b.routes.map((r) => {
    const hay = words([b.title, b.description, r.summary, ...r.params.map((p) => `${p.name} ${p.description}`)].join(" "));
    const title = new Set(words(`${b.title} ${r.summary}`));
    let score = 0;
    for (const w of qw) {
      if (title.has(w)) score += 3;
      else if (hay.includes(w)) score += 1;
      else if (hay.some((h) => h.startsWith(w) || w.startsWith(h))) score += 0.5;
    }
    if (!qw.length) score = 1;
    if (score > 0) {
      const lvl = levels.get(b.id)?.level;
      score += (up.get(b.id) ?? 95) / 100 + (rep.get(b.id) ?? 0) + (b.listing?.status === "live" ? 0.5 : 0) + (lvl === "top" ? 0.6 : lvl === "rising" ? 0.3 : 0);
    }
    return {
      store: b.id, storeTitle: b.title, summary: r.summary, description: b.description, method: r.method,
      url: `${env.publicUrl}/${b.id}${r.path}`, example: `${env.publicUrl}/${b.id}${r.sampleRequest}`, priceUsd: r.priceUsd,
      params: r.params.map((p) => ({ name: p.name, in: p.in, required: p.in === "path" || !!p.required, description: p.description, example: p.example })),
      tiers: (r.tiers ?? []).map((t) => ({ ...t, url: `${env.publicUrl}/${b.id}/t/${t.name}${r.path}` })),
      sellerLevel: levels.get(b.id)?.level ?? "new",
      uptime24h: up.get(b.id) ?? null, repeatRate: rep.get(b.id) ?? 0, listing: b.listing?.status ?? "not_registered", score: +score.toFixed(2),
    };
  }))
    .filter((i) => i.score > 0 && (opts.maxPriceUsd == null || Math.min(i.priceUsd, ...i.tiers.map((t) => t.priceUsd)) <= opts.maxPriceUsd))
    .sort((a, b) => b.score - a.score || a.priceUsd - b.priceUsd)
    .slice(0, Math.min(50, opts.limit ?? 10));
  return { query: q, count: items.length, items };
}

/** Build a callable URL from a route template and user-supplied inputs. */
export function buildCallUrl(template: string, method: string, params: { name: string; in: string; required: boolean }[], values: Record<string, string>) {
  let url = template;
  const qs = new URLSearchParams();
  const missing: string[] = [];
  for (const p of params) {
    const v = values[p.name];
    if (v == null || v === "") { if (p.required) missing.push(p.name); continue; }
    if (p.in === "path") url = url.replace(`:${p.name}`, encodeURIComponent(v)); else qs.set(p.name, v);
  }
  return { url: qs.toString() ? `${url}?${qs}` : url, missing, method };
}
