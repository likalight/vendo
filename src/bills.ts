/** Scheduled bills paid from the treasury vault (only approved payees, within onchain caps and limits). */
import { db } from "./db.js";
import * as treasury from "./treasury.js";

export function listBills() { return db.prepare(`SELECT * FROM bills ORDER BY next_due`).all(); }

export function addBill(input: { payee: string; amountUsd: number; ref: string; everyDays: number; firstDue?: string }) {
  if (!input.payee) throw new Error("payee is required");
  if (!(input.amountUsd > 0)) throw new Error("amountUsd must be above 0");
  if (!(input.everyDays >= 1 && input.everyDays <= 366)) throw new Error("everyDays must be 1-366");
  const due = input.firstDue ? new Date(input.firstDue) : new Date();
  if (isNaN(due.getTime())) throw new Error("firstDue must be a date");
  const r = db.prepare(`INSERT INTO bills (payee, amount_usd, ref, every_days, next_due) VALUES (?, ?, ?, ?, ?)`)
    .run(input.payee, input.amountUsd, String(input.ref || "bill").slice(0, 31), Math.round(input.everyDays), due.toISOString());
  return r.lastInsertRowid;
}

export function setActive(id: number, active: boolean) { db.prepare(`UPDATE bills SET active = ? WHERE id = ?`).run(active ? 1 : 0, id); }

export async function runDueBills(now = new Date()) {
  const due = db.prepare(`SELECT * FROM bills WHERE active = 1 AND next_due <= ?`).all(now.toISOString()) as any[];
  const results: any[] = [];
  for (const b of due) {
    try {
      const res = await treasury.payBill(b.payee, b.amount_usd, b.ref);
      const next = new Date(new Date(b.next_due).getTime() + b.every_days * 864e5).toISOString();
      db.prepare(`UPDATE bills SET next_due = ?, last_result = ? WHERE id = ?`).run(next, JSON.stringify({ ok: true, at: now.toISOString(), res }), b.id);
      results.push({ id: b.id, ok: true, res });
    } catch (e: any) {
      db.prepare(`UPDATE bills SET last_result = ? WHERE id = ?`).run(JSON.stringify({ ok: false, at: now.toISOString(), error: e.shortMessage ?? e.message }), b.id);
      results.push({ id: b.id, ok: false, error: e.shortMessage ?? e.message });
    }
  }
  return results;
}

export function startBillLoop(minutes = Number(process.env.BILL_CHECK_MINUTES ?? 30)) {
  if (!(minutes > 0) || treasury.treasuryMode() === "not-configured") return;
  setInterval(() => runDueBills().catch(() => {}), minutes * 60e3).unref();
}
