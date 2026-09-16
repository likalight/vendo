/**
 * Verified business wallets: a registered company proves it controls a wallet on X Layer.
 * Agents can then check "is this wallet really Acme Ltd, and is Acme sanctioned?" before paying.
 * Flow: request a challenge -> sign it with the wallet -> Vendo checks the signature and the LEI in GLEIF.
 */
import { randomBytes } from "node:crypto";
import { verifyMessage, getAddress, isAddress } from "viem";
import { db } from "./db.js";
import { registryLookup } from "./finance.js";

db.exec(`CREATE TABLE IF NOT EXISTS wallet_links (
  address TEXT PRIMARY KEY, lei TEXT NOT NULL, legal_name TEXT, store_id TEXT, verified_at TEXT NOT NULL, signature TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wallet_challenges (address TEXT PRIMARY KEY, lei TEXT NOT NULL, nonce TEXT NOT NULL, created_at TEXT NOT NULL)`);

export function challengeMessage(address: string, lei: string, nonce: string) {
  return `Vendo business wallet verification\nWallet: ${address}\nLEI: ${lei}\nNonce: ${nonce}\nI confirm this wallet belongs to the legal entity above.`;
}

export function createChallenge(addressRaw: string, lei: string) {
  if (!isAddress(addressRaw)) throw new Error("address must be an EVM address");
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(lei)) throw new Error("lei must be a 20-character LEI");
  const address = getAddress(addressRaw);
  const nonce = randomBytes(12).toString("hex");
  db.prepare(`INSERT INTO wallet_challenges VALUES (?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET lei = excluded.lei, nonce = excluded.nonce, created_at = excluded.created_at`)
    .run(address, lei, nonce, new Date().toISOString());
  return { address, lei, message: challengeMessage(address, lei, nonce), expiresInMinutes: 30 };
}

export async function completeChallenge(addressRaw: string, signature: string, storeId?: string, opts: { skipRegistry?: boolean } = {}) {
  if (!isAddress(addressRaw)) throw new Error("address must be an EVM address");
  const address = getAddress(addressRaw);
  const c = db.prepare(`SELECT * FROM wallet_challenges WHERE address = ?`).get(address) as any;
  if (!c) throw new Error("No challenge for this wallet. Request one first.");
  if (Date.now() - new Date(c.created_at).getTime() > 30 * 60e3) throw new Error("Challenge expired. Request a new one.");
  const ok = await verifyMessage({ address, message: challengeMessage(address, c.lei, c.nonce), signature: signature as `0x${string}` }).catch(() => false);
  if (!ok) throw new Error("Signature does not match this wallet");
  let legalName: string | null = null;
  if (!opts.skipRegistry) {
    const rec = (await registryLookup({ lei: c.lei }))[0];
    if (!rec || rec.status !== "ACTIVE") throw new Error("LEI is not an active legal entity in GLEIF");
    legalName = rec.legalName;
  }
  db.prepare(`INSERT INTO wallet_links VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET lei = excluded.lei, legal_name = excluded.legal_name, store_id = excluded.store_id, verified_at = excluded.verified_at, signature = excluded.signature`)
    .run(address, c.lei, legalName, storeId ?? null, new Date().toISOString(), signature);
  db.prepare(`DELETE FROM wallet_challenges WHERE address = ?`).run(address);
  return { verified: true, address, lei: c.lei, legalName };
}

export function lookupWallet(addressRaw: string) {
  if (!isAddress(addressRaw)) return null;
  return db.prepare(`SELECT address, lei, legal_name, store_id, verified_at FROM wallet_links WHERE address = ?`).get(getAddress(addressRaw)) ?? null;
}
