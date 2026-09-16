/**
 * Demo buyer agent for the video and for proving the end-to-end flow on X Layer.
 * It discovers a service by need, checks the price, pays the x402 request from its own wallet,
 * verifies the signed delivery receipt, and prints the explorer link.
 *
 *   BUYER_PRIVATE_KEY=0x... VENDO_URL=https://your-vendo npx tsx scripts/buyer-agent.ts "sanctions screening" name="Example Trading LLC"
 *
 * Use a separate, lightly funded test wallet. It refuses to pay more than MAX_USD (default 0.10).
 */
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";

const VENDO = (process.env.VENDO_URL ?? "http://localhost:3000").replace(/\/$/, "");
const MAX_USD = Number(process.env.MAX_USD ?? 0.1);
const [need = "sanctions screening", ...pairs] = process.argv.slice(2);
const values = Object.fromEntries(pairs.map((p) => p.split("=")).filter((kv) => kv.length === 2));

const log = (step: string, detail?: unknown) => console.log(`\n▸ ${step}` + (detail !== undefined ? `\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}` : ""));

async function main() {
  const pk = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error("Set BUYER_PRIVATE_KEY to a funded test wallet on X Layer");
  const account = privateKeyToAccount(pk);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account as any });
  const http = new x402HTTPClient(client);
  log(`Buyer wallet ${account.address}`);

  log(`Searching Vendo for "${need}"`);
  const found = await (await fetch(`${VENDO}/vendo/public/search?q=${encodeURIComponent(need)}&limit=3`)).json();
  if (!found.items?.length) throw new Error("No matching service");
  const item = found.items[0];
  log(`Best match: ${item.storeTitle}: ${item.summary} (${item.priceUsd} USDT0)`);
  if (item.priceUsd > MAX_USD) throw new Error(`Price ${item.priceUsd} is above MAX_USD ${MAX_USD}`);

  const built = await (await fetch(`${VENDO}/vendo/assist/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item, values }) })).json();
  if (built.missing?.length) throw new Error(`Missing inputs: ${built.missing.join(", ")} (pass as name=value)`);
  log("Calling", built.url);

  const first = await fetch(built.url, { method: item.method });
  if (first.status !== 402) { log(`Unexpected status ${first.status}`, await first.text()); return; }
  const required = http.getPaymentRequiredResponse((h) => first.headers.get(h));
  const accept: any = (required as any).accepts?.[0];
  const amount = Number(accept?.amount ?? accept?.maxAmountRequired ?? 0) / 1e6;
  log(`Payment requested: ${amount} USDT0 to ${accept?.payTo} on ${accept?.network}`);
  if (amount > MAX_USD) throw new Error("Challenge price above limit");

  const payload = await http.createPaymentPayload(required);
  const paid = await fetch(built.url, { method: item.method, headers: http.encodePaymentSignatureHeader(payload) });
  const body = await paid.text();
  log(`Response ${paid.status}`, body.slice(0, 1200));

  let tx: string | undefined;
  try { const s: any = http.getPaymentSettleResponse((h) => paid.headers.get(h)); tx = s?.transaction; log("Settlement", s); } catch { /* optional */ }
  const receipt = paid.headers.get("x-vendo-receipt");
  if (receipt) {
    const v = await (await fetch(`${VENDO}/vendo/receipts/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt, body }) })).json();
    log(`Signed receipt valid: ${v.valid}, response matches: ${v.responseMatches}`);
  }
  if (tx) {
    const cfg = await (await fetch(`${VENDO}/vendo/api/config`)).json();
    log("Explorer", `${cfg.explorer}/tx/${tx}`);
  }
}

main().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });
