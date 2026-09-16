import { db } from "./db.js";

export type Sale = { business_id: string; route: string; amount_atomic: string; pay_to: string; upstream_status: number; receipt?: string | null; payer?: string | null; tx_hash?: string | null };
export type Purchase = { buyer: string; service: string; url: string; amount_atomic: string; status: number; settlement?: string | null };
const now = () => new Date().toISOString();

export function recordSale(s: Sale) {
  db.prepare(`INSERT INTO sales (at, business_id, route, amount_atomic, pay_to, upstream_status, receipt, payer, tx_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(now(), s.business_id, s.route, s.amount_atomic, s.pay_to, s.upstream_status, s.receipt ?? null, s.payer ?? null, s.tx_hash ?? null);
}
export function recordPurchase(p: Purchase) {
  db.prepare(`INSERT INTO purchases (at, buyer, service, url, amount_atomic, status, settlement)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(now(), p.buyer, p.service, p.url, p.amount_atomic, p.status, p.settlement ?? null);
}
export function listSales(businessId?: string) {
  return businessId
    ? db.prepare(`SELECT * FROM sales WHERE business_id = ? ORDER BY id DESC LIMIT 500`).all(businessId)
    : db.prepare(`SELECT * FROM sales ORDER BY id DESC LIMIT 500`).all();
}
export function listPurchases(buyer?: string) {
  return buyer
    ? db.prepare(`SELECT * FROM purchases WHERE buyer = ? ORDER BY id DESC LIMIT 500`).all(buyer)
    : db.prepare(`SELECT * FROM purchases ORDER BY id DESC LIMIT 500`).all();
}
export function spentTodayAtomic(buyer: string) {
  const r = db.prepare(`SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)),0) AS s FROM purchases
    WHERE buyer = ? AND substr(at,1,10) = ? AND status < 400`).get(buyer, now().slice(0, 10)) as { s: number };
  return r.s;
}

export function statement(month: string, businessId?: string) {
  const where = businessId ? `AND business_id = ?` : ``;
  const args = businessId ? [month, businessId] : [month];
  const sales = db.prepare(`SELECT business_id, route, COUNT(*) AS calls, SUM(CAST(amount_atomic AS INTEGER)) AS atomic
    FROM sales WHERE substr(at,1,7) = ? AND upstream_status < 400 ${where}
    GROUP BY business_id, route ORDER BY business_id`).all(...args) as { business_id: string; route: string; calls: number; atomic: number }[];
  const costs = db.prepare(`SELECT service, COUNT(*) AS calls, SUM(CAST(amount_atomic AS INTEGER)) AS atomic
    FROM purchases WHERE substr(at,1,7) = ? AND status < 400 ${businessId ? "AND buyer = ?" : ""} GROUP BY service`)
    .all(...args) as { service: string; calls: number; atomic: number }[];
  const revenue = sales.reduce((a, r) => a + r.atomic, 0) / 1e6;
  const spend = costs.reduce((a, r) => a + r.atomic, 0) / 1e6;
  return {
    month, business: businessId ?? "all",
    revenue: sales.map((r) => ({ ...r, usdt0: r.atomic / 1e6 })),
    costs: costs.map((r) => ({ ...r, usdt0: r.atomic / 1e6 })),
    totals: { revenueUsdt0: +revenue.toFixed(6), costsUsdt0: +spend.toFixed(6), netUsdt0: +(revenue - spend).toFixed(6) },
  };
}
export function statementCsv(month: string, businessId?: string) {
  const s = statement(month, businessId);
  const rows = ["type,month,business_or_service,route,paid_calls,amount_usdt0"];
  s.revenue.forEach((r) => rows.push(["revenue", month, r.business_id, JSON.stringify(r.route), r.calls, r.usdt0].join(",")));
  s.costs.forEach((r) => rows.push(["cost", month, JSON.stringify(r.service), "", r.calls, -r.usdt0].join(",")));
  rows.push(["total_revenue", month, s.business, "", "", s.totals.revenueUsdt0].join(","));
  rows.push(["total_costs", month, s.business, "", "", -s.totals.costsUsdt0].join(","));
  rows.push(["net", month, s.business, "", "", s.totals.netUsdt0].join(","));
  return rows.join("\n");
}

/** Managed stores: Vendo receives revenue and owes the business its share. */
export function payoutSummary(businesses: { id: string; title: string; listingModel?: string; feeBps?: number }[]) {
  return businesses.filter((b) => b.listingModel === "managed").map((b) => {
    const rev = (db.prepare(`SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)),0) AS s FROM sales WHERE business_id = ? AND upstream_status < 400`).get(b.id) as { s: number }).s;
    const paid = (db.prepare(`SELECT COALESCE(SUM(CAST(amount_atomic AS INTEGER)),0) AS s FROM payouts WHERE business_id = ?`).get(b.id) as { s: number }).s;
    const fee = Math.floor((rev * (b.feeBps ?? 0)) / 10_000);
    const owed = rev - fee;
    return { business_id: b.id, title: b.title, feeBps: b.feeBps ?? 0, revenueUsdt0: rev / 1e6, feeUsdt0: fee / 1e6, owedUsdt0: owed / 1e6, paidUsdt0: paid / 1e6, balanceUsdt0: (owed - paid) / 1e6 };
  });
}
export function recordPayout(businessId: string, amountAtomic: number, txHash?: string, note?: string) {
  db.prepare(`INSERT INTO payouts (at, business_id, amount_atomic, tx_hash, note) VALUES (?, ?, ?, ?, ?)`).run(new Date().toISOString(), businessId, String(amountAtomic), txHash ?? null, note ?? null);
}
export function listPayouts() { return db.prepare(`SELECT * FROM payouts ORDER BY id DESC LIMIT 200`).all(); }

/** Decode the x402 settlement header (base64 JSON) to get payer and transaction hash. */
export function decodeSettlement(header: string | null | undefined): { payer?: string; tx_hash?: string } {
  if (!header || header === "offline-demo") return {};
  try {
    const j = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return { payer: j.payer ?? j.from, tx_hash: j.transaction ?? j.txHash ?? j.hash };
  } catch { return {}; }
}

/** Repeat usage: what OKX AI needs to see before the marketplace leaves beta. */
export function retention(businessId?: string) {
  const where = businessId ? `AND business_id = ?` : ``;
  const args = businessId ? [businessId] : [];
  const rows = db.prepare(`SELECT business_id, payer, COUNT(*) AS calls, MIN(at) AS first, MAX(at) AS last
    FROM sales WHERE upstream_status < 400 AND payer IS NOT NULL ${where} GROUP BY business_id, payer`).all(...args) as { business_id: string; payer: string; calls: number; first: string; last: string }[];
  const by = new Map<string, typeof rows>();
  rows.forEach((r) => by.set(r.business_id, [...(by.get(r.business_id) ?? []), r]));
  return [...by.entries()].map(([id, rs]) => {
    const buyers = rs.length, repeat = rs.filter((r) => r.calls > 1).length;
    const returning7d = rs.filter((r) => new Date(r.last).getTime() - new Date(r.first).getTime() >= 24 * 3600e3).length;
    return { business_id: id, buyers, repeatBuyers: repeat, repeatRate: buyers ? +(repeat / buyers).toFixed(3) : 0, returningAfterADay: returning7d,
      topBuyers: rs.sort((a, b) => b.calls - a.calls).slice(0, 5).map((r) => ({ payer: r.payer, calls: r.calls })) };
  });
}
