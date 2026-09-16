/**
 * Vendo Assist backend: match a task (typed or highlighted on a web page) to paid services,
 * then pay and run it from a capped buyer wallet using the x402 client.
 */
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@okxweb3/x402-core/client";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/client";
import type { Business, SellRoute } from "./businesses.js";
import { listBusinesses } from "./registry.js";
import { askJson, llmEnabled } from "./llm.js";
import { env } from "./env.js";
import { recordPurchase, spentTodayAtomic } from "./ledger.js";
import { usdt0Balance, fundingPlan } from "./funding.js";

export type Offer = {
  serviceKey: string; businessId: string; title: string; summary: string; priceUsd: number;
  url: string; confidence: number; why: string;
};

const STOP = new Set(["the","and","for","with","this","that","from","into","your","you","our","are","was","can","get","new","any","all","per","via","how","what","who","why","when","use","about","please","need","want","some","one","two","out","its","has","have","help","make","find"]);
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w));
const CURRENCIES = ["USD","EUR","SGD","GBP","JPY","CNY","HKD","AUD","CAD","CHF","INR","MYR","IDR","THB","VND","PHP","KRW","AED"];

function fillParams(b: Business, r: SellRoute, text: string): string | null {
  let path = r.path;
  const query = new URLSearchParams();
  for (const p of r.params) {
    let v: string | undefined;
    if (p.name === "lei") v = text.match(/\b[A-Z0-9]{18}[0-9]{2}\b/)?.[0];
    else if (p.name === "base" || p.name === "symbols") {
      const found = CURRENCIES.filter((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
      if (p.name === "base") v = found[0]; else v = found.slice(1).join(",") || undefined;
    } else if (/legalName/.test(p.name)) {
      v = text.match(/"([^"]{2,80})"/)?.[1] ?? text.match(/\b([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)*\s+(?:Inc\.?|Ltd\.?|LLC|GmbH|Pte\.?\s*Ltd\.?|PLC|AG|SA|BV))\b/)?.[1];
    } else if (p.name === "business") v = text.match(/\bbusiness[:= ]+([a-z0-9-]+)/i)?.[1];
    else if (p.name === "task") v = text.slice(0, 200);
    if (!v && p.example && !(p.in === "path" || p.required)) continue;
    if (!v) { if (p.in === "path" || p.required) return null; continue; }
    if (p.in === "path") path = path.replace(`:${p.name}`, encodeURIComponent(v));
    else query.set(p.name, v);
  }
  const qs = query.toString();
  return `${env.publicUrl}/${b.id}${path}${qs ? `?${qs}` : ""}`;
}

export async function match(text: string, limit = 3): Promise<{ mode: string; offers: Offer[] }> {
  const all = listBusinesses().flatMap((b) => b.routes.map((r) => ({ b, r })));
  if (llmEnabled()) {
    const catalog = all.map(({ b, r }) => ({ key: `${b.id} ${r.method} ${r.path}`, title: b.title, summary: r.summary, price: r.priceUsd,
      inputs: r.params.map((p) => ({ name: p.name, in: p.in, required: p.in === "path" || !!p.required, example: p.example })) }));
    const out = await askJson<{ offers: { key: string; confidence: number; why: string; path: string; query: Record<string, string> }[] }>(
      "You match a business user's task to paid API services. Only choose services that can genuinely do the task. Fill inputs from the text; never invent identifiers.",
      JSON.stringify({ task: text.slice(0, 2000), catalog, output: { offers: [{ key: "catalog key", confidence: "0-1", why: "short", path: "route path with params filled", query: { name: "value" } }] } })
    );
    if (out?.offers) {
      const offers = out.offers.slice(0, limit).flatMap((o) => {
        const hit = all.find(({ b, r }) => `${b.id} ${r.method} ${r.path}` === o.key);
        if (!hit) return [];
        const qs = new URLSearchParams(o.query ?? {}).toString();
        return [{ serviceKey: o.key, businessId: hit.b.id, title: hit.b.title, summary: hit.r.summary, priceUsd: hit.r.priceUsd,
          url: `${env.publicUrl}/${hit.b.id}${o.path || hit.r.path}${qs ? `?${qs}` : ""}`, confidence: o.confidence, why: o.why }];
      });
      return { mode: "llm", offers };
    }
  }
  const tw = new Set(words(text));
  const scored = all
    .filter(({ b }) => !b.local)
    .map(({ b, r }) => {
      const hay = words([b.title, b.description, r.summary, ...r.params.map((p) => p.description)].join(" "));
      let s = hay.filter((w) => tw.has(w)).length;
      const hasCurrency = CURRENCIES.some((c) => new RegExp(`\\b${c}\\b`, "i").test(text));
      if (r.params.some((p) => p.name === "base")) s = hasCurrency ? s + 3 : 0;
      if (/legalName|lei/.test(r.params.map((p) => p.name).join()) && /(company|supplier|registered|legal|entity|vendor)/i.test(text)) s += 3;
      return { b, r, s };
    })
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s);
  const offers: Offer[] = [];
  for (const { b, r, s } of scored) {
    const url = fillParams(b, r, text);
    if (!url) continue;
    offers.push({ serviceKey: `${b.id} ${r.method} ${r.path}`, businessId: b.id, title: b.title, summary: r.summary, priceUsd: r.priceUsd,
      url, confidence: Math.min(0.95, 0.35 + s * 0.1), why: "Keyword and input match" });
    if (offers.length >= limit) break;
  }
  return { mode: "keyword", offers };
}

/** For bigger or custom jobs, hand off to OKX AI's own task matching instead of competing with it. */
export function okxTaskPrompt(text: string) {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 240);
  return `Post a job on OKX.AI using Onchain OS: ${clean}`;
}

let buyer: { http: x402HTTPClient; address: string } | null = null;
function getBuyer() {
  if (buyer) return buyer;
  const pk = process.env.BUYER_PRIVATE_KEY;
  if (!pk) return null;
  const account = privateKeyToAccount(pk as `0x${string}`);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account as any, networks: [env.network.caip2 as any] });
  buyer = { http: new x402HTTPClient(client), address: account.address };
  return buyer;
}

export async function run(url: string, serviceKey: string, buyerId = "default") {
  if (!url.startsWith(env.publicUrl + "/")) return { status: 400, error: "Assist only runs Vendo-listed services." };
  const maxCall = Number(process.env.ASSIST_MAX_USD_PER_CALL ?? 0.1) * 1e6;
  const maxDay = Number(process.env.ASSIST_MAX_USD_PER_DAY ?? 2) * 1e6;

  if (process.env.VENDO_OFFLINE === "1") {
    const r0 = await fetch(url);
    const price = r0.status === 402 ? Number(String((await r0.json() as any).price ?? "$0").slice(1)) * 1e6 : 0;
    if (price > maxCall) return { status: 402, paid: false, error: `Price ${price / 1e6} USDT0 is above your per-call limit.` };
    if (spentTodayAtomic(buyerId) + price > maxDay) return { status: 402, paid: false, error: "Daily Assist spending limit reached." };
    const r1 = await fetch(url, { headers: { "x-vendo-demo-paid": "1" } });
    const t1 = await r1.text();
    recordPurchase({ buyer: buyerId, service: serviceKey, url, amount_atomic: String(price), status: r1.status, settlement: "offline-demo" });
    return { status: r1.status, paid: r1.ok, offline: true, priceUsdt0: price / 1e6, body: safeJson(t1) };
  }
  const first = await fetch(url);
  if (first.status !== 402) {
    const body = await first.text();
    return { status: first.status, paid: false, body: safeJson(body) };
  }
  const b = getBuyer();
  if (!b) return { status: 402, paid: false, error: "Set BUYER_PRIVATE_KEY (a funded X Layer wallet) to let Assist pay." };

  const required = b.http.getPaymentRequiredResponse((h) => first.headers.get(h));
  const accept: any = (required as any).accepts?.[0];
  const amount = Number(accept?.amount ?? accept?.maxAmountRequired ?? 0);
  if (!(amount > 0)) return { status: 402, paid: false, error: "Could not read the price from the payment challenge." };
  if (amount > maxCall) return { status: 402, paid: false, error: `Price ${amount / 1e6} USDT0 is above your per-call limit.` };
  if (spentTodayAtomic(buyerId) + amount > maxDay) return { status: 402, paid: false, error: "Daily Assist spending limit reached." };

  const bal = await usdt0Balance(b.address);
  if (bal != null && bal * 1e6 < amount) {
    return { status: 402, paid: false, error: `Buyer wallet has ${bal} USDT0 on X Layer, needs ${amount / 1e6}.`, fundingPlan: fundingPlan({ amountUsd: amount / 1e6, wallet: b.address, balanceUsd: bal }) };
  }
  const payload = await b.http.createPaymentPayload(required);
  const headers = b.http.encodePaymentSignatureHeader(payload);
  const paid = await fetch(url, { headers });
  const text = await paid.text();
  let settlement: string | null = null;
  try { settlement = JSON.stringify(b.http.getPaymentSettleResponse((h) => paid.headers.get(h))); } catch { /* optional */ }
  recordPurchase({ buyer: buyerId, service: serviceKey, url, amount_atomic: String(amount), status: paid.status, settlement });
  return { status: paid.status, paid: paid.ok, priceUsdt0: amount / 1e6, payer: b.address, settlement: safeJson(settlement ?? ""), body: safeJson(text) };
}

function safeJson(s: string) { try { return JSON.parse(s); } catch { return s; } }
