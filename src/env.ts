import "dotenv/config";
import { NETWORKS, type NetworkName } from "./network.js";

// Offline demo mode simulates payments, so real credentials are never used. Fall back to
// obvious placeholders instead of failing, so `npm run dev:offline` runs without a .env.
export const offline = process.env.VENDO_OFFLINE === "1";
const OFFLINE_PLACEHOLDERS: Record<string, string> = {
  OKX_API_KEY: "offline-demo",
  OKX_SECRET_KEY: "offline-demo",
  OKX_PASSPHRASE: "offline-demo",
  MPPX_SECRET_KEY: Buffer.from("vendo-offline-demo-signing-key").toString("base64"),
};

function need(name: string): string {
  const v = process.env[name];
  if (v) return v;
  const placeholder = offline ? OFFLINE_PLACEHOLDERS[name] : undefined;
  if (placeholder) return placeholder;
  throw new Error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
}

const networkName = (process.env.NETWORK ?? "testnet") as NetworkName;
if (!(networkName in NETWORKS)) throw new Error(`NETWORK must be "testnet" or "mainnet"`);

export const env = {
  okxApiKey: need("OKX_API_KEY"),
  okxSecretKey: need("OKX_SECRET_KEY"),
  okxPassphrase: need("OKX_PASSPHRASE"),
  mppxSecretKey: need("MPPX_SECRET_KEY"),
  network: NETWORKS[networkName],
  networkName,
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  port: Number(process.env.PORT ?? 3000),
  defaultPayTo: process.env.DEFAULT_PAY_TO ?? (offline ? "0x0000000000000000000000000000000000000000" : ""),
};
