/** Encrypts upstream API credentials at rest (AES-256-GCM). Buyers and the dashboard API never see them. */
import "dotenv/config";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const key = () => createHash("sha256").update(process.env.VENDO_ENCRYPTION_KEY || process.env.MPPX_SECRET_KEY || "dev-only-key").digest();

export function seal(obj: Record<string, string>): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function open(sealed?: string): Record<string, string> {
  if (!sealed) return {};
  const [iv, tag, data] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString("utf8"));
}
