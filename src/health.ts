/** Uptime checks for each store's upstream, so owners fix problems before agents (or OKX sampling calls) hit them. */
import { db } from "./db.js";
import { listBusinesses, upstreamHeaders } from "./registry.js";
import type { Business } from "./businesses.js";

async function probe(b: Business) {
  const url = b.webForm ? b.webForm.pageUrl : b.baseUrl ? b.baseUrl + (b.routes[0]?.sampleRequest ?? "/") : null;
  if (!url || b.local && !b.webForm) return null;
  const t0 = Date.now();
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { method: "GET", headers: b.webForm ? {} : upstreamHeaders(b), signal: ctrl.signal });
    return { ok: r.status < 500, status: r.status, ms: Date.now() - t0 };
  } catch { return { ok: false, status: 0, ms: Date.now() - t0 }; }
  finally { clearTimeout(timer); }
}

export async function runChecks() {
  const out: any[] = [];
  for (const b of listBusinesses()) {
    const r = await probe(b);
    if (!r) continue;
    db.prepare(`INSERT INTO health_checks (at, business_id, ok, status, ms) VALUES (?, ?, ?, ?, ?)`).run(new Date().toISOString(), b.id, r.ok ? 1 : 0, r.status, r.ms);
    out.push({ business_id: b.id, ...r });
  }
  db.prepare(`DELETE FROM health_checks WHERE at < ?`).run(new Date(Date.now() - 14 * 864e5).toISOString());
  return out;
}

export function uptime(hours = 24) {
  const since = new Date(Date.now() - hours * 3600e3).toISOString();
  return (db.prepare(`SELECT business_id, COUNT(*) AS checks, SUM(ok) AS up, AVG(ms) AS avg_ms, MAX(at) AS last
    FROM health_checks WHERE at >= ? GROUP BY business_id`).all(since) as any[])
    .map((r) => ({ business_id: r.business_id, checks: r.checks, uptimePct: +((100 * r.up) / r.checks).toFixed(1), avgMs: Math.round(r.avg_ms), last: r.last }));
}

export function startHealthLoop(minutes = Number(process.env.HEALTH_CHECK_MINUTES ?? 10)) {
  if (!(minutes > 0)) return;
  setTimeout(() => runChecks().catch(() => {}), 5000);
  setInterval(() => runChecks().catch(() => {}), minutes * 60e3).unref();
}
