/**
 * Paying an upstream that itself speaks x402.
 *
 * Thousands of endpoints already answer 402 on other chains. They are absent from OKX AI because
 * listing there means re-plumbing payments onto X Layer. Vendo can close that gap: the buyer pays
 * Vendo in USDT0 on X Layer, Vendo pays the upstream in whatever it asks for, and the result comes
 * back as an ordinary listed service.
 *
 * Two rules keep this honest:
 *  - Vendo never pays an upstream more than the buyer paid Vendo. A call that would run at a loss
 *    is refused rather than absorbed, so a mispriced route cannot drain the wallet.
 *  - The upstream cost and its transaction are reported back, so the buyer can see what was spent
 *    on their behalf rather than taking the margin on trust.
 */
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";
import { env } from "./env.js";

export type UpstreamResult = {
  status: number;
  body: string;
  contentType: string | null;
  /** What Vendo paid the upstream, in USD. 0 when the upstream turned out to be free. */
  costUsd: number;
  /** Settlement transaction on the upstream's chain, when it reported one. */
  tx?: string;
  network?: string;
  /** Set when the call was refused before any payment was made. */
  refused?: string;
};

/**
 * Networks Vendo is willing to pay an upstream on. X Layer always, plus anything listed in
 * UPSTREAM_NETWORKS as CAIP-2 ids (e.g. "eip155:8453" for Base). Paying on a chain means holding
 * that chain's stablecoin, so this stays opt-in rather than accepting whatever a challenge asks for.
 */
function allowedNetworks(): string[] {
  const extra = String(process.env.UPSTREAM_NETWORKS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([env.network.caip2, ...extra])];
}

let payer: { http: x402HTTPClient; address: string; networks: string[] } | null = null;
function getPayer() {
  if (payer) return payer;
  // A dedicated key is preferred so upstream spending is separable from Assist's buyer wallet.
  const pk = process.env.UPSTREAM_PRIVATE_KEY || process.env.BUYER_PRIVATE_KEY;
  if (!pk) return null;
  const account = privateKeyToAccount(pk as `0x${string}`);
  const client = new x402Client();
  const networks = allowedNetworks();
  registerExactEvmScheme(client, { signer: account as any, networks: networks as any });
  payer = { http: new x402HTTPClient(client), address: account.address, networks };
  return payer;
}

export function upstreamPayerAddress() { return getPayer()?.address ?? null; }

/**
 * Fetch an upstream, paying its x402 challenge if it asks for one.
 *
 * @param budgetUsd what the buyer paid Vendo for this call. The upstream may not exceed it.
 */
export async function fetchPaidUpstream(url: string, init: RequestInit, budgetUsd: number): Promise<UpstreamResult> {
  const first = await fetch(url, init);
  const ct = first.headers.get("content-type");

  // Not a paid upstream after all: hand the response straight back.
  if (first.status !== 402) {
    return { status: first.status, body: await first.text(), contentType: ct, costUsd: 0 };
  }

  const p = getPayer();
  if (!p) {
    return { status: 502, body: JSON.stringify({ error: "This service forwards to a paid upstream, but Vendo has no wallet configured to pay it." }),
      contentType: "application/json", costUsd: 0, refused: "no upstream wallet" };
  }

  let required: any, accept: any;
  try {
    required = p.http.getPaymentRequiredResponse((h) => first.headers.get(h));
    accept = required?.accepts?.[0];
  } catch { accept = null; }

  if (!accept) {
    return { status: 502, body: JSON.stringify({ error: "Upstream asked for payment but its challenge could not be read." }),
      contentType: "application/json", costUsd: 0, refused: "unreadable challenge" };
  }

  const network = String(accept.network ?? "");
  if (!p.networks.includes(network)) {
    return { status: 502, body: JSON.stringify({ error: `Upstream wants payment on ${network}, which Vendo is not funded for.`, allowed: p.networks }),
      contentType: "application/json", costUsd: 0, refused: `network ${network} not allowed` };
  }

  // Stablecoins used here are 6 decimals. Treat minor units as USD micros.
  const minor = Number(accept.amount ?? accept.maxAmountRequired ?? 0);
  const costUsd = minor / 1e6;
  if (!(minor > 0)) {
    return { status: 502, body: JSON.stringify({ error: "Upstream challenge carried no readable amount." }),
      contentType: "application/json", costUsd: 0, refused: "no amount" };
  }

  // Never spend more than the buyer paid. A loss-making route is a pricing bug, not something to absorb.
  //
  // Known limitation: the x402 middleware settles the buyer payment before this handler runs, so a
  // route priced below its upstream charges the buyer and then returns this 502. The buyer is out
  // of pocket for a call that never happened. The fix is to check the upstream price when the store
  // is registered rather than on the first paid call. See docs/ROADMAP.md.
  if (costUsd > budgetUsd) {
    return { status: 502, body: JSON.stringify({ error: "Upstream costs more than this call was priced at, so it was not paid.", upstreamUsd: costUsd, chargedUsd: budgetUsd }),
      contentType: "application/json", costUsd: 0, refused: "upstream above budget" };
  }

  // Sign the challenge, then replay the original request carrying the payment signature.
  const payload = await p.http.createPaymentPayload(required);
  const signedInit: RequestInit = { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), ...p.http.encodePaymentSignatureHeader(payload) } };
  const paid = await fetch(url, signedInit);
  const body = await paid.text();
  let tx: string | undefined;
  try { tx = (p.http.getPaymentSettleResponse((h: string) => paid.headers.get(h)) as any)?.transaction; } catch { /* optional */ }

  return { status: paid.status, body, contentType: paid.headers.get("content-type"), costUsd, tx, network };
}
