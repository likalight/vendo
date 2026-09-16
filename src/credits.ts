/**
 * Call packs: a buyer pays once (via x402) for N calls at a discount and gets a credit token.
 * Encourages repeat usage, which OKX AI needs before the marketplace leaves beta.
 */
import { randomBytes, createHash } from "node:crypto";
import { db } from "./db.js";

db.exec(`CREATE TABLE IF NOT EXISTS credits (
  token_hash TEXT PRIMARY KEY, business_id TEXT NOT NULL, calls_total INTEGER NOT NULL, calls_left INTEGER NOT NULL,
  payer TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
)`);

export const PACK_SIZES = [25, 100];
export const PACK_DISCOUNT = Number(process.env.VENDO_PACK_DISCOUNT ?? 0.15);
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export function packPrice(pricePerCall: number, calls: number) {
  return +(pricePerCall * calls * (1 - PACK_DISCOUNT)).toFixed(6);
}

export function mint(businessId: string, calls: number, payer?: string | null, days = 30) {
  const token = "vc_" + randomBytes(24).toString("base64url");
  const now = new Date();
  db.prepare(`INSERT INTO credits VALUES (?, ?, ?, ?, ?, ?, ?)`).run(hash(token), businessId, calls, calls, payer ?? null, now.toISOString(), new Date(now.getTime() + days * 864e5).toISOString());
  return { token, businessId, calls, expiresAt: new Date(now.getTime() + days * 864e5).toISOString() };
}

/** Atomically use one credit. Returns remaining calls, or null if the token can't be used for this store. */
export function consume(token: string | undefined, businessId: string): number | null {
  if (!token || !token.startsWith("vc_")) return null;
  const r = db.prepare(`UPDATE credits SET calls_left = calls_left - 1
    WHERE token_hash = ? AND business_id = ? AND calls_left > 0 AND expires_at > ?`).run(hash(token), businessId, new Date().toISOString());
  if (r.changes !== 1) return null;
  return (db.prepare(`SELECT calls_left FROM credits WHERE token_hash = ?`).get(hash(token)) as { calls_left: number }).calls_left;
}

export function refund(token: string, businessId: string) {
  db.prepare(`UPDATE credits SET calls_left = calls_left + 1 WHERE token_hash = ? AND business_id = ? AND calls_left < calls_total`).run(hash(token), businessId);
}

export function balance(token: string) {
  return db.prepare(`SELECT business_id, calls_total, calls_left, expires_at FROM credits WHERE token_hash = ?`).get(hash(token)) ?? null;
}
