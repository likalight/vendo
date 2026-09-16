/** Seller levels, Fiverr style, earned from real Vendo data: paid calls, repeat buyers and uptime. */
import { db } from "./db.js";
import { retention } from "./ledger.js";
import { uptime } from "./health.js";

export type Level = { level: "new" | "rising" | "top"; label: string; paidCalls30d: number; repeatRate: number; uptime7d: number | null; next?: string };

export function sellerLevels(): Map<string, Level> {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const calls = new Map((db.prepare(`SELECT business_id, COUNT(*) AS n FROM sales WHERE at >= ? AND upstream_status < 400 AND amount_atomic != '0' GROUP BY business_id`).all(since) as { business_id: string; n: number }[]).map((r) => [r.business_id, r.n]));
  const rep = new Map(retention().map((r) => [r.business_id, r.repeatRate]));
  const up = new Map(uptime(168).map((u) => [u.business_id, u.uptimePct]));
  const ids = (db.prepare(`SELECT id FROM businesses`).all() as { id: string }[]).map((r) => r.id);
  return new Map(ids.map((id) => {
    const c = calls.get(id) ?? 0, rr = rep.get(id) ?? 0, u = up.get(id) ?? null;
    const reliable = (min: number) => u == null || u >= min;
    let lv: Level;
    if (c >= 200 && rr >= 0.3 && reliable(99)) lv = { level: "top", label: "Top seller", paidCalls30d: c, repeatRate: rr, uptime7d: u };
    else if (c >= 25 && reliable(95)) lv = { level: "rising", label: "Rising seller", paidCalls30d: c, repeatRate: rr, uptime7d: u, next: `Top: ${Math.max(0, 200 - c)} more paid calls, repeat rate 30%+, uptime 99%+` };
    else lv = { level: "new", label: "New seller", paidCalls30d: c, repeatRate: rr, uptime7d: u, next: `Rising: ${Math.max(0, 25 - c)} more paid calls with uptime 95%+` };
    return [id, lv] as const;
  }));
}
