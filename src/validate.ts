/**
 * Free endpoint checker for anyone listing an A2MCP service on OKX AI.
 *
 * Listing review rejects a non-compliant endpoint, and the rejection arrives as a terse message
 * after the fact. Vendo's own first submission was rejected for advertising the wrong chain, so
 * this runs the same checks up front and says exactly what to change.
 *
 * Free on purpose: it costs one outbound request, it is the cheapest possible reason for a seller
 * to arrive at Vendo, and a paywall on a compliance check would be perverse.
 */
import { env } from "./env.js";

export type Check = { name: string; pass: boolean; detail: string; fix?: string };
export type ValidationResult = {
  url: string;
  compliant: boolean;
  kind: "x402-paid" | "free" | "non-compliant";
  checks: Check[];
  challenge?: unknown;
  note: string;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function validateEndpoint(raw: string): Promise<ValidationResult> {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string, fix?: string) => { checks.push({ name, pass, detail, fix }); return pass; };

  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("url must be an absolute http(s) URL"); }

  add("https", url.protocol === "https:", url.protocol === "https:" ? "Endpoint is served over HTTPS" : `Endpoint uses ${url.protocol}`,
    "OKX AI requires a public HTTPS address tied to a domain.");
  if (url.hostname === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)) {
    add("public", false, `${url.hostname} is not reachable from the internet`, "Deploy to a public domain before registering.");
    return { url: raw, compliant: false, kind: "non-compliant", checks, note: NOTE };
  }

  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    res = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "VendoEndpointCheck/1.0" } });
  } catch (e: any) {
    add("reachable", false, `Could not reach the endpoint: ${e.name === "AbortError" ? "timed out after 15s" : String(e.message)}`,
      "Check the service is running and the domain resolves.");
    return { url: raw, compliant: false, kind: "non-compliant", checks, note: NOTE };
  } finally { clearTimeout(timer); }

  add("reachable", true, `Responded with HTTP ${res.status}`);

  // A free service is a valid A2MCP shape too: it answers 200 with the result and no billing.
  if (res.status === 200) {
    add("status", true, "Returns 200, which is the free-service shape", "Fine if the service is free. A paid service must answer 402 when unpaid.");
    return { url: raw, compliant: true, kind: "free", checks, note: NOTE };
  }

  if (!add("status", res.status === 402, `Unpaid call returned ${res.status}`, "A paid A2MCP endpoint must answer 402 Payment Required when called without payment.")) {
    return { url: raw, compliant: false, kind: "non-compliant", checks, note: NOTE };
  }

  const header = res.headers.get("payment-required");
  if (!add("payment-required header", !!header, header ? "PAYMENT-REQUIRED header present" : "No PAYMENT-REQUIRED header on the 402",
    "For x402 v2 the challenge must be base64 encoded into the PAYMENT-REQUIRED response header. That header is what listing review reads.")) {
    return { url: raw, compliant: false, kind: "non-compliant", checks, note: NOTE };
  }

  let challenge: any;
  try { challenge = JSON.parse(Buffer.from(header!, "base64").toString("utf8")); }
  catch {
    add("challenge decodes", false, "PAYMENT-REQUIRED is not valid base64 JSON", "Use the OKX Payment SDK, which encodes the challenge for you.");
    return { url: raw, compliant: false, kind: "non-compliant", checks, note: NOTE };
  }
  add("challenge decodes", true, "Challenge decodes as JSON");
  add("x402Version", challenge.x402Version === 2, `x402Version is ${JSON.stringify(challenge.x402Version)}`, "OKX AI expects x402Version 2.");

  const accept = Array.isArray(challenge.accepts) ? challenge.accepts[0] : null;
  if (!add("accepts", !!accept, accept ? "Challenge carries an accepts entry" : "Challenge has no accepts array", "The challenge must list at least one payment option.")) {
    return { url: raw, compliant: false, kind: "non-compliant", checks, challenge, note: NOTE };
  }

  add("scheme", accept.scheme === "exact", `scheme is ${JSON.stringify(accept.scheme)}`, 'A2MCP listings use the "exact" scheme.');

  // The rejection Vendo itself received: an endpoint quoting a chain the agent is not registered on.
  const okNetwork = accept.network === env.network.caip2;
  add("network", okNetwork, `network is ${JSON.stringify(accept.network)}, expected ${env.network.caip2}`,
    `Payment must be received on X Layer. Set the network to ${env.network.caip2} (chain ${env.network.chainId}). This is the most common listing rejection.`);

  const okAsset = typeof accept.asset === "string" && accept.asset.toLowerCase() === env.network.usdt0.toLowerCase();
  add("asset", okAsset, `asset is ${JSON.stringify(accept.asset)}`, `Settle in USDT0 on X Layer: ${env.network.usdt0}`);

  add("payTo", ADDRESS.test(String(accept.payTo ?? "")), `payTo is ${JSON.stringify(accept.payTo)}`,
    "payTo must be the wallet that receives payment, and should match the wallet your agent identity is registered with.");

  const amount = String(accept.amount ?? accept.maxAmountRequired ?? "");
  add("amount", /^\d+$/.test(amount) && Number(amount) > 0, amount ? `amount is ${amount} minor units (${(Number(amount) / 1e6).toFixed(6)} USDT0)` : "No amount on the challenge",
    "Amount is in minor units. USDT0 has 6 decimals, so 0.01 is \"10000\".");

  add("maxTimeoutSeconds", Number(accept.maxTimeoutSeconds) > 0, `maxTimeoutSeconds is ${JSON.stringify(accept.maxTimeoutSeconds)}`,
    "Give the payer a window to settle, for example 300.");

  const compliant = checks.every((c) => c.pass);
  return { url: raw, compliant, kind: compliant ? "x402-paid" : "non-compliant", checks, challenge, note: NOTE };
}

const NOTE = "Checks an endpoint against the OKX AI A2MCP listing rules. Passing here is not a guarantee of approval; OKX runs its own review.";
