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

  const challengeBody = await first.clone().text().catch(() => "");
  const required = readChallenge(p, first, challengeBody);

  if (!required) {
    return { status: 502, body: JSON.stringify({ error: "Upstream asked for payment but its challenge could not be read." }),
      contentType: "application/json", costUsd: 0, refused: "unreadable challenge" };
  }

  // An upstream may offer several ways to pay. Take the first that is the exact scheme on a chain
  // Vendo actually holds funds on, rather than assuming the first entry is usable.
  const options: any[] = Array.isArray(required.accepts) ? required.accepts : [];
  const accept = options.find((a) => a?.scheme === "exact" && p.networks.includes(String(a?.network ?? "")));

  if (!accept) {
    const offered = options.map((a) => `${a?.scheme}@${a?.network}`).join(", ") || "none";
    return { status: 502, body: JSON.stringify({ error: "Upstream offers no payment option Vendo is funded for.", offered, allowed: p.networks }),
      contentType: "application/json", costUsd: 0, refused: `no usable option (offered: ${offered})` };
  }

  const network = String(accept.network);

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

  // Sign the challenge, then replay the original request carrying the payment signature. Only the
  // chosen option is offered, so the SDK cannot pick a scheme or chain Vendo is not funded for.
  //
  // Implementations differ on field names: the OKX A2MCP guide uses `amount` and an object
  // `resource`, while OKX's own mock merchant uses `maxAmountRequired` and a string `resource`.
  // Normalise to what the signing scheme expects rather than assuming one dialect.
  const normalised = {
    ...required,
    x402Version: required.x402Version ?? 2,
    resource: typeof required.resource === "object" && required.resource
      ? required.resource
      : { url: String(required.resource ?? url), description: "", mimeType: "application/json" },
    accepts: [{ ...accept, amount: String(accept.amount ?? accept.maxAmountRequired), maxTimeoutSeconds: Number(accept.maxTimeoutSeconds ?? 300) }],
  };

  let paid: Response;
  try {
    const payload = await p.http.createPaymentPayload(normalised as any);
    const signedInit: RequestInit = { ...init, headers: { ...(init.headers as Record<string, string> ?? {}), ...p.http.encodePaymentSignatureHeader(payload) } };
    paid = await fetch(url, signedInit);
  } catch (e: any) {
    // An upstream Vendo cannot sign for must not take the route down with it.
    return { status: 502, body: JSON.stringify({ error: "Could not sign a payment this upstream would accept.", detail: String(e?.message ?? e) }),
      contentType: "application/json", costUsd: 0, refused: "signing failed" };
  }
  const body = await paid.text();

  // A second 402 means the upstream rejected the payment, usually because Vendo holds no balance in
  // the asset it asked for. Nothing was spent, so do not report a cost that was never incurred.
  if (paid.status === 402) {
    return { status: 502, body: JSON.stringify({ error: "Upstream rejected the payment. Vendo may hold no balance in the asset it requires.", asset: accept.asset, network }),
      contentType: "application/json", costUsd: 0, refused: "payment rejected by upstream" };
  }

  let tx: string | undefined;
  try { tx = (p.http.getPaymentSettleResponse((h: string) => paid.headers.get(h)) as any)?.transaction; } catch { /* optional */ }

  return { status: paid.status, body, contentType: paid.headers.get("content-type"), costUsd, tx, network };
}


/**
 * Read an upstream's x402 challenge.
 *
 * The OKX A2MCP guide says a v2 challenge is base64 encoded into the PAYMENT-REQUIRED header, and
 * that is what OKX AI listing review validates. But OKX's own mock merchant, and endpoints built
 * against other x402 implementations, return the challenge as the 402 response body with no header
 * at all. Supporting only the header would make most of the existing x402 ecosystem unreadable, so
 * the header is preferred and the body is the fallback.
 */
function readChallenge(p: { http: x402HTTPClient }, res: Response, body: string): any | null {
  try {
    const fromHeader = p.http.getPaymentRequiredResponse((h: string) => res.headers.get(h));
    if (fromHeader && Array.isArray((fromHeader as any).accepts)) return fromHeader;
  } catch { /* fall through to the body */ }

  try {
    const parsed = JSON.parse(body);
    if (parsed && Array.isArray(parsed.accepts) && parsed.accepts.length) return parsed;
  } catch { /* not JSON */ }

  return null;
}
