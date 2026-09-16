/**
 * Hosted OKX reverse proxy: one Service per business, each route priced in USDT0
 * and paid to that business's own wallet. Vendo never holds funds.
 */
import { Mppx } from "@okxweb3/mpp";
import { charge } from "@okxweb3/mpp/evm/server";
import { SaApiClient } from "@okxweb3/mpp/evm";
import { Proxy, Service } from "mppx/proxy";
import { env } from "./env.js";
import type { Business } from "./businesses.js";
import { listBusinesses, seedIfEmpty } from "./registry.js";
import { toAtomic } from "./network.js";
import { recordSale } from "./ledger.js";

const saClient = new SaApiClient({
  apiKey: env.okxApiKey,
  secretKey: env.okxSecretKey,
  passphrase: env.okxPassphrase,
  baseUrl: "https://web3.okx.com",
  onError: (e: unknown) => console.error("[okx-sa]", e),
} as any);

const mppx = Mppx.create({
  methods: [charge({ saClient })],
  realm: new URL(env.publicUrl).host,
  secretKey: env.mppxSecretKey,
});

function payToFor(b: Business) {
  const addr = b.payTo || env.defaultPayTo;
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr) || /^0x0{40}$/.test(addr)) {
    throw new Error(`Business "${b.id}" needs a real payTo wallet (set payTo or DEFAULT_PAY_TO).`);
  }
  return addr;
}

function serviceFor(b: Business) {
  const payTo = payToFor(b);
  const routes: Record<string, any> = {};
  const priceByRoute = new Map<string, string>();
  for (const r of b.routes) {
    const key = `${r.method} ${r.path}`;
    const amount = toAtomic(r.priceUsd);
    priceByRoute.set(key, amount);
    // Optional Vendo fee via payment splits (MPP charge supports up to 10 split recipients).
    // Verify split semantics on testnet before relying on it; x402 A2MCP listings use a single payTo.
    const feeBps = Number(process.env.VENDO_SPLIT_FEE_BPS ?? 0);
    const feeWallet = process.env.VENDO_TREASURY_WALLET;
    const fee = feeWallet && feeBps > 0 && b.listingModel !== "managed" ? Math.floor((Number(amount) * feeBps) / 10_000) : 0;
    routes[key] = mppx.charge({
      amount,
      currency: env.network.usdt0,
      recipient: payTo,
      description: `${b.title}: ${r.summary}`,
      methodDetails: { chainId: env.network.chainId, feePayer: true, ...(fee > 0 ? { splits: [{ amount: String(fee), recipient: feeWallet, memo: "vendo-fee" }] } : {}) },
    } as any);
  }

  return Service.from(b.id, {
    title: b.title,
    description: b.description,
    baseUrl: b.baseUrl,
    ...(b.headers ? { headers: b.headers } : {}),
    routes,
    // Only reached after payment is verified and upstream responded.
    rewriteResponse: (res: Response, ctx: any) => {
      const method = ctx.request.method as string;
      const matched = b.routes.find((r) => r.method === method && matchPath(r.path, ctx.upstreamPath));
      if (matched) {
        recordSale({
          business_id: b.id,
          route: `${method} ${matched.path}`,
          amount_atomic: priceByRoute.get(`${method} ${matched.path}`) ?? "0",
          pay_to: payTo,
          upstream_status: res.status,
          receipt: res.headers.get("payment-receipt") ?? res.headers.get("payment-response"),
        });
      }
      return res;
    },
  } as any);
}

function matchPath(pattern: string, actual: string) {
  const p = pattern.split("/").filter(Boolean);
  const a = actual.split("?")[0].split("/").filter(Boolean);
  return p.length === a.length && p.every((seg, i) => seg.startsWith(":") || seg === "*" || seg === a[i]);
}

seedIfEmpty();
export const proxy = Proxy.create({
  title: "Vendo",
  description: "Paid business APIs for AI agents, settled on X Layer.",
  services: listBusinesses().filter((b) => !b.local).map(serviceFor),
});
