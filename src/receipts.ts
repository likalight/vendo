/**
 * Signed delivery receipts: proof of what a buyer asked for, what Vendo delivered, and the payment.
 * Useful as evidence for OKX AI evaluators and for buyers' own records. Ed25519 signatures.
 */
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, createHash, type KeyObject } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

let priv: KeyObject, pub: KeyObject;
function keys() {
  if (priv) return;
  const fromEnv = process.env.VENDO_RECEIPT_KEY;
  const file = "data/receipt-key.pem";
  if (fromEnv) priv = createPrivateKey(Buffer.from(fromEnv, "base64").toString("utf8"));
  else if (existsSync(file)) priv = createPrivateKey(readFileSync(file, "utf8"));
  else {
    const kp = generateKeyPairSync("ed25519");
    priv = kp.privateKey;
    mkdirSync("data", { recursive: true });
    writeFileSync(file, priv.export({ type: "pkcs8", format: "pem" }) as string, { mode: 0o600 });
  }
  pub = createPublicKey(priv);
}

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const b64u = (b: Buffer) => b.toString("base64url");

export type DeliveryReceipt = {
  v: 1; issuer: "vendo"; store: string; route: string; request: string; response: string;
  status: number; priceUsd: number; payer?: string | null; tx?: string | null; at: string;
};

export function issue(input: Omit<DeliveryReceipt, "v" | "issuer" | "at" | "request" | "response"> & { method: string; url: string; body: string }) {
  keys();
  const r: DeliveryReceipt = {
    v: 1, issuer: "vendo", store: input.store, route: input.route,
    request: sha(`${input.method} ${input.url}`), response: sha(input.body),
    status: input.status, priceUsd: input.priceUsd, payer: input.payer ?? null, tx: input.tx ?? null, at: new Date().toISOString(),
  };
  const payload = Buffer.from(JSON.stringify(r));
  const sig = sign(null, payload, priv);
  return `${b64u(payload)}.${b64u(sig)}`;
}

export function check(token: string, body?: string) {
  keys();
  const [p, s] = String(token).split(".");
  if (!p || !s) return { valid: false, reason: "Malformed receipt" };
  const payload = Buffer.from(p, "base64url");
  const valid = verify(null, payload, pub, Buffer.from(s, "base64url"));
  if (!valid) return { valid: false, reason: "Signature does not match" };
  const receipt = JSON.parse(payload.toString("utf8")) as DeliveryReceipt;
  const responseMatches = body == null ? undefined : sha(body) === receipt.response;
  return { valid: true, receipt, responseMatches };
}

export function publicKeyJwk() { keys(); return { issuer: "vendo", alg: "Ed25519", key: pub.export({ format: "jwk" }) }; }
