/**
 * Vendo main server (use this for OKX AI listings).
 * - x402 paywall via OKX Payment SDK (PAYMENT-REQUIRED header, validated by OKX AI listing review)
 * - dynamic seller registry (onboard without restarting)
 * - forwards paid calls upstream, or serves Vendo's own paid services (Bookkeeper, Discovery Check)
 * - dashboard (/app), proof page (/proof), agent-ready kit, Assist API
 */
import "urlpattern-polyfill";
import express from "express";
import { readFileSync } from "node:fs";
import { paymentMiddleware, x402ResourceServer } from "@okxweb3/x402-express";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { env } from "./env.js";
import type { Business } from "./businesses.js";
import { listBusinesses, getBusiness, saveBusiness, seedIfEmpty, validateBusiness, matchRoute, resolveRoute, publicView, upstreamHeaders, upstreamQuery, updateListing, setStatus, deleteBusiness, updateBusiness } from "./registry.js";
import { recordSale, settleSale, listSales, listPurchases, statement, statementCsv, payoutSummary, recordPayout, listPayouts, decodeSettlement, retention } from "./ledger.js";
import { llmsTxt, openApi, mcpTools } from "./kit.js";
import { score, findTest, suggestFixes, latestRuns } from "./discovery.js";
import { match, run, okxTaskPrompt, okxTaskBrief, fillParams } from "./assist.js";
import { importOpenApi } from "./openapi-import.js";
import { llmEnabled } from "./llm.js";
import { inspectPage, verifyOwnership, formToBusiness, submitForm, verificationToken, assertPublicHttps } from "./web-agent.js";
import * as treasury from "./treasury.js";
import { runChecks, uptime, startHealthLoop } from "./health.js";
import { listBills, addBill, setActive, runDueBills, startBillLoop } from "./bills.js";
import { handleMcp } from "./mcp.js";
import { requireAdmin, requireAssist, rateLimit } from "./security.js";
import * as receipts from "./receipts.js";
import * as credits from "./credits.js";
import { screenName, registryLookup, secCompany, invoiceCalc, nameSimilarity } from "./finance.js";
import { createChallenge, completeChallenge, lookupWallet } from "./entity-wallets.js";
import { searchServices, buildCallUrl } from "./search.js";
import { sellerLevels } from "./levels.js";
import { fundingPlan, usdt0Balance } from "./funding.js";
import { validateEndpoint } from "./validate.js";
import { fetchPaidUpstream } from "./upstream-x402.js";

seedIfEmpty();

const facilitator = new OKXFacilitatorClient({ apiKey: env.okxApiKey, secretKey: env.okxSecretKey, passphrase: env.okxPassphrase } as any);
const resourceServer = new x402ResourceServer(facilitator as any);
resourceServer.register(env.network.caip2 as any, new ExactEvmScheme());

/** self: the business's own wallet (it owns the listing). managed: Vendo's treasury wallet (Vendo owns the listing and pays out). */
const payToFor = (b: Business) =>
  b.listingModel === "managed" ? (process.env.VENDO_TREASURY_WALLET || env.defaultPayTo) : (b.payTo || env.defaultPayTo);

function buildRoutes() {
  const routes: Record<string, any> = {};
  for (const b of listBusinesses().filter((x) => x.status !== "paused")) {
    for (const r of b.routes) {
      routes[`${r.method} /${b.id}${r.path}`] = {
        accepts: [{ scheme: "exact", network: env.network.caip2, payTo: payToFor(b), price: `$${r.priceUsd}` }],
        description: `${b.title}: ${r.summary}`,
        mimeType: "application/json",
      };
      for (const tier of r.tiers ?? []) {
        routes[`${r.method} /${b.id}/t/${tier.name}${r.path}`] = {
          accepts: [{ scheme: "exact", network: env.network.caip2, payTo: payToFor(b), price: `$${tier.priceUsd}` }],
          description: `${b.title}: ${r.summary} (${tier.name}: ${tier.includes})`,
          mimeType: "application/json",
        };
      }
    }
    const base = minPrice(b);
    if (base) for (const n of credits.PACK_SIZES) {
      routes[`GET /${b.id}/pack/${n}`] = {
        accepts: [{ scheme: "exact", network: env.network.caip2, payTo: payToFor(b), price: `$${credits.packPrice(base, n)}` }],
        description: `${b.title}: pack of ${n} calls`,
        mimeType: "application/json",
      };
    }
  }
  return routes;
}

export const OFFLINE = process.env.VENDO_OFFLINE === "1";
/** Packs are priced from a store's cheapest route (a pack credit covers one call on any of its routes up to that price tier). */
function minPrice(b: Business) { const ps = b.routes.map((r) => r.priceUsd).filter((x) => x > 0); return ps.length ? Math.min(...ps) : 0; }

/** Offline demo paywall: same routes, no real payments. Requests with x-vendo-demo-paid: 1 pass. Never use for listings. */
function offlinePaywall(req: express.Request, res: express.Response, next: express.NextFunction) {
  const m = req.path.match(/^\/([a-z0-9-]+)(\/.*)$/);
  const b = m && getBusiness(m[1]);
  const pack = b && req.method === "GET" && m![2].match(/^\/pack\/(\d+)$/);
  const rr = b && (pack ? null : resolveRoute(b, req.method, m![2]));
  const price = pack && credits.PACK_SIZES.includes(Number(pack[1])) ? credits.packPrice(minPrice(b!), Number(pack[1])) : rr?.price;
  if (!price) return next();
  if (req.header("x-vendo-demo-paid") === "1") { res.setHeader("payment-response", "offline-demo"); return next(); }
  res.status(402).json({ offline: true, error: "Payment required", price: `$${price}`, network: env.network.caip2, payTo: payToFor(b!) });
}

let paywall: express.RequestHandler = OFFLINE ? offlinePaywall : paymentMiddleware(buildRoutes(), resourceServer);
function refreshPaywall() { if (!OFFLINE) paywall = paymentMiddleware(buildRoutes(), resourceServer, undefined, undefined, false); }

const app = express();
app.use(express.json({ limit: "200kb" }));
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, authorization, x-vendo-admin, x-vendo-assist, x-vendo-credit, payment-signature, x-payment");
  res.setHeader("access-control-expose-headers", "x-vendo-receipt, x-vendo-credits-left, payment-required, payment-response, x-vendo-upstream-cost, x-vendo-upstream-tx, x-vendo-upstream-network");
  res.setHeader("x-content-type-options", "nosniff");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const page = (name: string) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

// ---------- Access control ----------
app.use("/vendo/api", rateLimit(240), requireAdmin);
app.use("/vendo/assist/match", rateLimit(60));
app.use("/vendo/assist/run", rateLimit(30), requireAssist);
app.use("/mcp", rateLimit(120));

// ---------- Free: pages, kit, health ----------
app.get("/", (_q, s) => s.type("html").send(page("index.html")));
app.get("/app", (_q, s) => s.type("html").send(page("app.html")));
app.get("/proof", (_q, s) => s.type("html").send(page("proof.html")));
app.get("/how", (_q, s) => s.type("html").send(page("how.html")));
app.get("/health", (_q, s) => s.json({ ok: true, offline: OFFLINE, network: env.networkName, chainId: env.network.chainId, llm: llmEnabled(), assistBuyer: !!process.env.BUYER_PRIVATE_KEY }));
app.get(["/llms.txt", "/vendo/llms.txt"], (_q, s) => s.type("text/plain").send(llmsTxt(listBusinesses())));

// Paste-once install for any agent host that reads a SKILL.md. Served with this deployment's real
// base URL substituted, so an agent can use it without being told where Vendo lives.
app.get(["/SKILL.md", "/skill.md"], (_q, s) => {
  const md = readFileSync(new URL("../skills/vendo/SKILL.md", import.meta.url), "utf8")
    .replace(/\{VENDO_URL\}/g, env.publicUrl)
    .replace(/https:\/\/vendo\.example/g, env.publicUrl);
  s.type("text/markdown").send(md);
});

// Free: check an A2MCP endpoint against the OKX AI listing rules before submitting it for review.
// Vendo's own first submission was rejected for advertising the wrong chain, so this exists to
// catch that class of mistake before it costs a review cycle.
app.get("/vendo/validate", rateLimit(60), async (q, s) => {
  const url = String(q.query.url ?? "");
  if (!url) return s.status(400).json({ errors: ["url query parameter is required"] });
  try { s.json(await validateEndpoint(url)); }
  catch (e: any) { s.status(400).json({ errors: [String(e.message)] }); }
});
app.get("/vendo/kit/:id/:file", (q, s) => {
  const b = getBusiness(q.params.id);
  if (!b) return s.status(404).json({ error: "unknown business" });
  if (q.params.file === "openapi.json") return s.json(openApi(b));
  if (q.params.file === "mcp.json") return s.json({ tools: mcpTools(b) });
  s.status(404).end();
});

// ---------- Free: dashboard API ----------
app.get("/vendo/api/config", (_q, s) => s.json({ treasury: treasury.treasuryMode(), offline: OFFLINE, network: env.networkName, chainId: env.network.chainId, publicUrl: env.publicUrl, explorer: env.network.explorer, llm: llmEnabled() }));
app.get("/vendo/api/businesses", (_q, s) => { const lv = sellerLevels(); s.json(listBusinesses().map((b) => ({ ...publicView(b), payTo: payToFor(b), score: score(b).score, sellerLevel: lv.get(b.id) ?? null }))); });

// Go live on OKX AI: the exact steps and Onchain OS prompts for this store.
app.get("/vendo/api/businesses/:id/go-live", (q, s) => {
  const b = getBusiness(q.params.id);
  if (!b) return s.status(404).json({ error: "unknown business" });
  const owner = b.listingModel === "managed" ? "Vendo (managed listing)" : "The business, with its own Agentic Wallet";
  const endpoints = b.routes.map((r) => ({
    name: `${b.title}: ${r.summary}`.slice(0, 80),
    endpoint: `${env.publicUrl}/${b.id}${r.path}`,
    example: `${env.publicUrl}/${b.id}${r.sampleRequest}`,
    priceUsd: r.priceUsd,
    description: `${r.summary}. ${b.description}`.slice(0, 400),
    registerPrompt: `Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS. Service name: "${`${b.title}: ${r.summary}`.slice(0, 80)}". Description: "${`${r.summary}. ${b.description}`.slice(0, 300)}". Price per call: ${r.priceUsd}. Endpoint: ${env.publicUrl}/${b.id}${r.path}`,
  }));
  s.json({
    store: b.id, listingModel: b.listingModel ?? "self", listingOwner: owner, receivingWallet: payToFor(b), listing: b.listing ?? { status: "not_registered" },
    steps: [
      { step: "Install Onchain OS in your AI agent", prompt: "Install Onchain OS via npx skills add okx/onchainos-skills --yes -g, then log in to Agentic Wallet with my email" },
      ...(b.listingModel === "managed" ? [] : [{ step: "Use the same wallet that receives payments", note: `Receiving wallet on this store: ${payToFor(b)}` }]),
      { step: "Check the endpoint asks for payment", command: `curl -i ${endpoints[0]?.example ?? ""}`, expect: "HTTP 402" },
      { step: "Register each endpoint as an A2MCP service", prompts: endpoints.map((e) => e.registerPrompt) },
      { step: "List it on the marketplace", prompt: "Help me list my ASP on OKX.AI using Onchain OS", note: "Review takes up to 24 hours; the result goes to the Agentic Wallet email." },
      { step: "Save the Agent ID and listing link in Vendo", note: "Shown on your proof page." },
    ],
    endpoints,
  });
});
app.post("/vendo/api/businesses/:id/listing", (q, s) => {
  try {
    const b = updateListing(q.params.id, q.body ?? {});
    if (!b) return s.status(404).json({ error: "unknown business" });
    s.json({ ok: true, listing: b.listing });
  } catch (e: any) { s.status(400).json({ errors: [e.message] }); }
});
app.post("/vendo/api/businesses/:id/update", (q, s) => {
  const v = updateBusiness(q.params.id, q.body ?? {});
  if (!v.ok) return s.status(400).json({ errors: v.errors });
  refreshPaywall(); s.json({ ok: true, business: publicView(v.value) });
});
app.post("/vendo/api/businesses/:id/status", (q, s) => {
  const status = q.body?.status === "paused" ? "paused" : "active";
  const b = setStatus(q.params.id, status);
  if (!b) return s.status(404).json({ errors: ["unknown business"] });
  refreshPaywall(); s.json({ ok: true, status });
});
app.post("/vendo/api/businesses/:id/delete", (q, s) => {
  if (q.body?.confirm !== q.params.id) return s.status(400).json({ errors: ["Send confirm with the store id to delete it"] });
  if (!deleteBusiness(q.params.id)) return s.status(404).json({ errors: ["unknown business"] });
  refreshPaywall(); s.json({ ok: true });
});
// End-to-end self test for a store: unpaid call must ask for payment; offline mode also runs a demo paid call and verifies the receipt.
app.post("/vendo/api/businesses/:id/test", async (q, s) => {
  const b = getBusiness(q.params.id);
  if (!b) return s.status(404).json({ errors: ["unknown business"] });
  const r = b.routes[Number(q.body?.route ?? 0)] ?? b.routes[0];
  const url = `${env.publicUrl}/${b.id}${r.sampleRequest}`;
  const unpaid = await fetch(url, { method: r.method });
  const result: any = { url, price: r.priceUsd, unpaid: { status: unpaid.status, asksForPayment: unpaid.status === 402, x402Header: !!unpaid.headers.get("payment-required") } };
  if (OFFLINE) {
    const paid = await fetch(url, { method: r.method, headers: { "x-vendo-demo-paid": "1" } });
    const body = await paid.text();
    const receipt = paid.headers.get("x-vendo-receipt");
    result.demoPaid = { status: paid.status, bodyPreview: body.slice(0, 400), receipt: receipt ? receipts.check(receipt, body) : null };
  } else {
    result.nextStep = { prompt: `Using Onchain OS, call ${url} and pay the x402 payment request with my Agentic Wallet, then show me the response`, note: "Run this from a separate buyer wallet to prove the end-to-end flow." };
  }
  result.pass = result.unpaid.asksForPayment && (!OFFLINE || (result.demoPaid.status < 400 && result.demoPaid.receipt?.valid));
  s.json(result);
});
app.get("/vendo/api/payouts", (_q, s) => s.json({ summary: payoutSummary(listBusinesses()), history: listPayouts() }));
app.post("/vendo/api/payouts", (q, s) => {
  const b = getBusiness(String(q.body?.business ?? ""));
  if (!b || b.listingModel !== "managed") return s.status(400).json({ errors: ["Payouts only apply to managed stores"] });
  const amt = Math.round(Number(q.body?.amountUsd) * 1e6);
  const bal = payoutSummary([b])[0].balanceUsdt0 * 1e6;
  if (!(amt > 0) || amt > bal + 1) return s.status(400).json({ errors: [`Amount must be between 0 and the balance owed (${bal / 1e6} USDT0)`] });
  if (q.body?.txHash && !/^0x[0-9a-fA-F]{64}$/.test(q.body.txHash)) return s.status(400).json({ errors: ["txHash must be a 0x transaction hash"] });
  recordPayout(b.id, amt, q.body?.txHash, q.body?.note);
  s.json({ ok: true, summary: payoutSummary([b])[0] });
});
app.post("/vendo/api/businesses", async (q, s) => {
  const v = validateBusiness(q.body);
  if (!v.ok) return s.status(400).json({ errors: v.errors });
  if (!v.value.local) { try { await assertPublicHttps(v.value.baseUrl); } catch (e: any) { return s.status(400).json({ errors: [`baseUrl: ${e.message}`] }); } }
  if (getBusiness(v.value.id) && !q.body.overwrite) return s.status(409).json({ errors: [`"${v.value.id}" already exists`] });
  saveBusiness(v.value); refreshPaywall();
  s.status(201).json({ ok: true, business: publicView(v.value), endpoints: v.value.routes.map((r) => `${r.method} ${env.publicUrl}/${v.value.id}${r.sampleRequest}`), goLive: `/vendo/api/businesses/${v.value.id}/go-live` });
});
app.post("/vendo/api/import-openapi", async (q, s) => {
  try { s.json(await importOpenApi(String(q.body?.specUrl ?? ""), Number(q.body?.priceUsd ?? 0.01))); }
  catch (e: any) { s.status(400).json({ errors: [e.message] }); }
});
app.get("/vendo/api/sales", (q, s) => s.json(listSales((q.query.business as string) || undefined)));
app.get("/vendo/api/purchases", (_q, s) => s.json(listPurchases()));
app.get("/vendo/api/statement", (q, s) => {
  const month = (q.query.month as string) || new Date().toISOString().slice(0, 7);
  const biz = (q.query.business as string) || undefined;
  q.query.format === "csv" ? s.type("text/csv").attachment(`vendo-${biz ?? "all"}-${month}.csv`).send(statementCsv(month, biz)) : s.json(statement(month, biz));
});
app.post("/vendo/api/discovery/:id", async (q, s) => {
  const b = getBusiness(q.params.id);
  if (!b) return s.status(404).json({ error: "unknown business" });
  const task = String(q.body?.task ?? b.routes[0]?.summary ?? "");
  s.json({ test: await findTest(b, task), fixes: await suggestFixes(b) });
});
app.get("/vendo/api/discovery/:id", (q, s) => s.json(latestRuns(q.params.id)));
app.post("/vendo/api/check402", async (q, s) => {
  const url = String(q.body?.url ?? "");
  if (!url.startsWith(env.publicUrl)) return s.status(400).json({ error: "Only Vendo URLs" });
  const r = await fetch(url);
  s.json({ status: r.status, paymentRequiredHeader: !!r.headers.get("payment-required") });
});

// ---------- Free: Website-to-Agent ----------
app.post("/vendo/api/web/inspect", async (q, s) => {
  try { s.json(await inspectPage(String(q.body?.pageUrl ?? ""))); } catch (e: any) { s.status(400).json({ errors: [e.message] }); }
});
app.post("/vendo/api/web/token", (q, s) => {
  try { const u = new URL(String(q.body?.pageUrl)); s.json({ token: verificationToken(String(q.body?.id ?? ""), u.host) }); } catch { s.status(400).json({ errors: ["Invalid page URL"] }); }
});
app.post("/vendo/api/web/verify", async (q, s) => {
  try { s.json(await verifyOwnership(String(q.body?.id ?? ""), String(q.body?.pageUrl ?? ""))); } catch (e: any) { s.status(400).json({ errors: [e.message] }); }
});
app.post("/vendo/api/web/publish", async (q, s) => {
  const { id, title, description, payTo, priceUsd, form, ownerApproved, skipVerify, listingModel, feeBps } = q.body ?? {};
  if (ownerApproved !== true) return s.status(400).json({ errors: ["The business owner must approve listing"] });
  if (!form?.pageUrl) return s.status(400).json({ errors: ["Pick a form first"] });
  if (!(OFFLINE && skipVerify)) {
    const v = await verifyOwnership(String(id), form.pageUrl).catch((e) => ({ verified: false, error: e.message }));
    if (!v.verified) return s.status(403).json({ errors: ["Website ownership not verified yet"], verification: v });
  }
  const b = formToBusiness({ id, title, description, payTo, priceUsd: Number(priceUsd) || 0.02, form });
  const v = validateBusiness({ ...b, local: false, baseUrl: b.baseUrl, listingModel, feeBps });
  if (v.ok) v.value.local = true;
  if (!v.ok) return s.status(400).json({ errors: v.errors });
  if (getBusiness(b.id)) return s.status(409).json({ errors: [`"${b.id}" already exists`] });
  saveBusiness(v.value); refreshPaywall();
  s.status(201).json({ ok: true, business: publicView(v.value), endpoint: `GET ${env.publicUrl}/${b.id}${b.routes[0].sampleRequest}` });
});

// ---------- Free: Treasury (vault) ----------
app.get("/vendo/api/treasury", async (_q, s) => { try { s.json(await treasury.state()); } catch (e: any) { s.status(500).json({ errors: [e.message] }); } });
app.post("/vendo/api/treasury/sweep", async (q, s) => { try { s.json(await treasury.sweep(String(q.body?.venue), Number(q.body?.amountUsd))); } catch (e: any) { s.status(400).json({ errors: [e.shortMessage ?? e.message] }); } });
app.post("/vendo/api/treasury/pay", async (q, s) => { try { s.json(await treasury.payBill(String(q.body?.payee), Number(q.body?.amountUsd), String(q.body?.ref ?? "bill"))); } catch (e: any) { s.status(400).json({ errors: [e.shortMessage ?? e.message] }); } });
// Before a seller points revenue at a vault, confirm the address really is one and settles in the
// asset this network pays in. A payTo aimed at the wrong contract loses the money.
app.get("/vendo/api/treasury/verify", async (q, s) => {
  const address = String(q.query.address ?? process.env.VAULT_ADDRESS ?? "");
  if (!address) return s.status(400).json({ errors: ["address query parameter is required (or set VAULT_ADDRESS)"] });
  const check = await treasury.verifyVault(address);
  const feeding = treasury.storesFeeding(address, listBusinesses(), env.defaultPayTo);
  s.json({
    ...check,
    feedableBy: feeding,
    revenueReaching: feeding.length > 0,
    howToConnect: feeding.length
      ? `${feeding.length} store(s) already pay into this vault.`
      : "No listed store pays into this vault yet. Set a store's payTo to this address and every paid call becomes a deposit.",
  });
});

app.post("/vendo/api/treasury/pause", async (_q, s) => { try { s.json(await treasury.pause()); } catch (e: any) { s.status(400).json({ errors: [e.shortMessage ?? e.message] }); } });

// ---------- Free: public reputation feed and receipts ----------
app.get("/vendo/public/stores.json", rateLimit(120), (_q, s) => {
  const levels = sellerLevels();
  const ret = new Map(retention().map((r) => [r.business_id, r]));
  const up24 = new Map(uptime(24).map((u) => [u.business_id, u]));
  const up7 = new Map(uptime(168).map((u) => [u.business_id, u]));
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const calls = new Map((listSales() as any[]).filter((x) => x.at >= since && x.upstream_status < 400).reduce((m: Map<string, number>, x) => m.set(x.business_id, (m.get(x.business_id) ?? 0) + 1), new Map()));
  s.json({
    generatedAt: new Date().toISOString(), network: env.network.caip2, receiptsKey: `${env.publicUrl}/.well-known/vendo-receipts.json`,
    stores: listBusinesses().map((b) => ({
      id: b.id, title: b.title, listing: b.listing ?? { status: "not_registered" }, listingModel: b.listingModel ?? "self",
      endpoints: b.routes.map((r) => ({ method: r.method, url: `${env.publicUrl}/${b.id}${r.path}`, priceUsd: r.priceUsd,
        tiers: (r.tiers ?? []).map((t) => ({ ...t, url: `${env.publicUrl}/${b.id}/t/${t.name}${r.path}` })) })),
      sellerLevel: levels.get(b.id) ?? null,
      packs: minPrice(b) ? credits.PACK_SIZES.map((n) => ({ calls: n, priceUsd: credits.packPrice(minPrice(b), n), url: `${env.publicUrl}/${b.id}/pack/${n}` })) : [],
      paidCalls30d: calls.get(b.id) ?? 0, buyers: ret.get(b.id)?.buyers ?? 0, repeatRate: ret.get(b.id)?.repeatRate ?? 0,
      uptime24h: up24.get(b.id)?.uptimePct ?? null, uptime7d: up7.get(b.id)?.uptimePct ?? null, avgResponseMs: up24.get(b.id)?.avgMs ?? null,
    })),
  });
});
app.get("/vendo/public/search", rateLimit(120), (q, s) => {
  const max = q.query.maxPrice != null ? Number(q.query.maxPrice) : undefined;
  s.json(searchServices(String(q.query.q ?? ""), { maxPriceUsd: Number.isFinite(max) ? max : undefined, limit: Number(q.query.limit ?? 10) }));
});
app.get("/vendo/public/fund-plan", rateLimit(60), async (q, s) => {
  const amountUsd = Number(q.query.amountUsd ?? 0);
  if (!(amountUsd > 0)) return s.status(400).json({ errors: ["amountUsd must be above 0"] });
  const wallet = q.query.wallet ? String(q.query.wallet) : undefined;
  const balanceUsd = wallet ? await usdt0Balance(wallet) : null;
  s.json(fundingPlan({ amountUsd, fromChain: q.query.from as string, fromToken: q.query.token as string, wallet, balanceUsd }));
});
app.get("/.well-known/vendo-receipts.json", (_q, s) => s.json(receipts.publicKeyJwk()));
app.post("/vendo/receipts/verify", rateLimit(120), (q, s) => {
  try { s.json(receipts.check(String(q.body?.receipt ?? ""), q.body?.body)); } catch { s.status(400).json({ valid: false, reason: "Malformed receipt" }); }
});
app.get("/vendo/credits/balance", rateLimit(120), (q, s) => {
  const b = credits.balance(String(q.header("x-vendo-credit") ?? ""));
  b ? s.json(b) : s.status(404).json({ errors: ["Unknown credit token"] });
});

// ---------- Verified business wallets ----------
app.post("/vendo/wallets/challenge", rateLimit(30), (q, s) => { try { s.json(createChallenge(String(q.body?.address ?? ""), String(q.body?.lei ?? ""))); } catch (e: any) { s.status(400).json({ errors: [e.message] }); } });
app.post("/vendo/wallets/verify", rateLimit(30), async (q, s) => {
  try { s.json(await completeChallenge(String(q.body?.address ?? ""), String(q.body?.signature ?? ""), q.body?.storeId, { skipRegistry: OFFLINE && !!q.body?.skipRegistry })); }
  catch (e: any) { s.status(400).json({ errors: [e.message] }); }
});
app.get("/vendo/wallets/:address", rateLimit(120), (q, s) => { const w = lookupWallet(String(q.params.address)); w ? s.json({ verified: true, ...w }) : s.status(404).json({ verified: false }); });

// ---------- Free: insights, uptime, bills, MCP ----------
app.get("/vendo/api/insights", (q, s) => s.json({ retention: retention((q.query.business as string) || undefined), uptime24h: uptime(24), uptime7d: uptime(168) }));
app.post("/vendo/api/health/run", async (_q, s) => s.json(await runChecks()));
app.get("/vendo/api/bills", (_q, s) => s.json(listBills()));
app.post("/vendo/api/bills", (q, s) => { try { s.status(201).json({ id: addBill(q.body ?? {}) }); } catch (e: any) { s.status(400).json({ errors: [e.message] }); } });
app.post("/vendo/api/bills/:id/active", (q, s) => { setActive(Number(q.params.id), !!q.body?.active); s.json({ ok: true }); });
app.post("/vendo/api/bills/run", async (_q, s) => s.json(await runDueBills()));
app.post("/mcp", (req, res) => { handleMcp(req, res).catch((e) => res.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: String(e.message) } })); });
app.get("/mcp", (_q, s) => s.status(405).json({ error: "Use POST with JSON-RPC (MCP Streamable HTTP)" }));

// ---------- Free: Vendo Assist API (used by the browser extension) ----------
app.post("/vendo/assist/match", async (q, s) => { const text = String(q.body?.text ?? ""); const r = await match(text); s.json({ ...r, okxTaskPrompt: okxTaskPrompt(text), okxTaskBrief: okxTaskBrief(text) }); });
app.post("/vendo/assist/run", async (q, s) => {
  const out: any = await run(String(q.body?.url ?? ""), String(q.body?.serviceKey ?? ""), String(q.body?.buyer ?? "default"));
  if (!out.paid && out.status === 402 && out.priceUsdt0 == null && /BUYER_PRIVATE_KEY|balance|insufficient/i.test(String(out.error ?? ""))) {
    out.fundingPlan = fundingPlan({ amountUsd: Number(q.body?.priceUsd ?? 0.1), fromChain: q.body?.fromChain });
  }
  s.json(out);
});
app.post("/vendo/assist/prepare", rateLimit(60), (q, s) => {
  const item = q.body?.item;
  if (!item?.url || !Array.isArray(item.params)) return s.status(400).json({ errors: ["item from /vendo/public/search is required"] });
  if (!String(item.url).startsWith(env.publicUrl + "/")) return s.status(400).json({ errors: ["Only Vendo services"] });
  s.json(buildCallUrl(item.url, item.method ?? "GET", item.params, q.body?.values ?? {}));
});

// ---------- Paid: everything else goes through the x402 paywall ----------
app.use((req, res, next) => {
  const pm = req.path.match(/^\/([a-z0-9-]+)\//);
  const pb = pm && getBusiness(pm[1]);
  if (pb && pb.status === "paused") return res.status(503).json({ error: "This store is paused by its owner. No payment was taken." });
  // Prepaid packs: a valid credit token for this store skips per-call payment.
  const token = req.header("x-vendo-credit");
  if (token) {
    const m = req.path.match(/^\/([a-z0-9-]+)(\/.*)$/);
    const b = m && getBusiness(m[1]);
    const rr = b && resolveRoute(b, req.method, m![2]);
    if (b && rr && !m![2].startsWith("/pack/")) {
      if (rr.price > minPrice(b) * 4) return res.status(402).json({ errors: ["This route costs more than a pack credit covers; pay per call instead"] });
      const left = credits.consume(token, b.id);
      if (left == null) return res.status(402).json({ errors: ["Credit token is invalid, expired, used up, or for a different store"] });
      res.locals.creditToken = token; res.setHeader("x-vendo-credits-left", String(left));
      return next();
    }
  }
  paywall(req, res, next);
});

// Buying a pack (paid via x402 above) mints a credit token.
app.get(/^\/([a-z0-9-]+)\/pack\/(\d+)$/, (req, res) => {
  const [, id, n] = req.path.match(/^\/([a-z0-9-]+)\/pack\/(\d+)$/)!;
  const b = getBusiness(id);
  if (!b || !credits.PACK_SIZES.includes(Number(n)) || !minPrice(b)) return res.status(404).json({ error: "No such pack" });
  const receipt = String(res.getHeader("payment-response") ?? "") || null;
  const settle = decodeSettlement(receipt);
  const price = credits.packPrice(minPrice(b), Number(n));
  recordSale({ business_id: b.id, route: `GET /pack/${n}`, amount_atomic: String(Math.round(price * 1e6)), pay_to: payToFor(b), upstream_status: 200, receipt, payer: settle.payer ?? (OFFLINE ? req.header("x-vendo-demo-payer") ?? null : null), tx_hash: settle.tx_hash ?? null });
  treasury.simulateRevenue(price);
  res.json({ ...credits.mint(b.id, Number(n), settle.payer), priceUsd: price, howToUse: "Send header x-vendo-credit: <token> on calls to this store's routes." });
});

app.all(/^\/([a-z0-9-]+)(\/.*)$/, async (req, res) => {
  const [, id, rest] = req.path.match(/^\/([a-z0-9-]+)(\/.*)$/)!;
  const b = getBusiness(id);
  const resolved = b && resolveRoute(b, req.method, rest);
  if (!b || !resolved) return res.status(404).json({ error: "No such service" });
  const r = resolved.route, tier = resolved.tier, price = resolved.price, realPath = resolved.path;
  const routeLabel = `${r.method} ${r.path}${tier ? ` [${tier.name}]` : ""}`;
  const qIndex = req.originalUrl.indexOf("?");
  const qs = qIndex >= 0 ? req.originalUrl.slice(qIndex) : "";
  const viaCredit = !!res.locals.creditToken;
  let settle: { payer?: string; tx_hash?: string } = {};
  const sale = (status: number) => {
    const receipt = viaCredit ? "credit" : String(res.getHeader("payment-response") ?? req.header("x-vendo-demo-payer") ?? "") || null;
    settle = viaCredit ? {} : decodeSettlement(receipt);
    if (viaCredit && status >= 400) credits.refund(res.locals.creditToken, b.id);
    const saleId = recordSale({ business_id: b.id, route: routeLabel, amount_atomic: viaCredit ? "0" : String(Math.round(price * 1e6)),
      pay_to: payToFor(b), upstream_status: status, receipt, payer: settle.payer ?? (OFFLINE ? req.header("x-vendo-demo-payer") ?? null : null), tx_hash: settle.tx_hash ?? null });
    // The paywall writes payment-response after this handler returns, so read it once the
    // response is done and backfill the payer and transaction hash.
    if (!viaCredit) res.on("finish", () => {
      const late = String(res.getHeader("payment-response") ?? "") || null;
      try { settleSale(saleId, decodeSettlement(late), late); } catch { /* ledger is best effort */ }
    });
  };
  const signed = (status: number, body: string) => res.setHeader("x-vendo-receipt", receipts.issue({
    store: b.id, route: routeLabel, method: req.method, url: req.originalUrl, body, status,
    priceUsd: viaCredit ? 0 : price, payer: settle.payer ?? null, tx: settle.tx_hash ?? null,
  }));

  if (b.local) {
    const out: { status: number; body: any; type?: string } = b.webForm
      ? await submitForm(b.webForm, req.query as Record<string, string>).catch((e) => ({ status: 502, body: { error: String(e.message) } }))
      : await localService(b.id, r.path, req.query as Record<string, string>, tier?.name);
    if ((out as any).status < 400 && !viaCredit) treasury.simulateRevenue(price);
    sale(out.status);
    const text = typeof out.body === "string" ? out.body : JSON.stringify(out.body);
    signed(out.status, text);
    return res.status(out.status).type(out.type ?? (typeof out.body === "string" ? "text/plain" : "application/json")).send(text);
  }
  try {
    await assertPublicHttps(b.baseUrl);
    const extraQ = new URLSearchParams(upstreamQuery(b)).toString();
    const upstreamUrl = b.baseUrl + realPath + (extraQ ? (qs ? `${qs}&${extraQ}` : `?${extraQ}`) : qs);
    const init: RequestInit = { method: r.method, headers: { ...upstreamHeaders(b), ...(tier ? { "x-vendo-tier": tier.name } : {}), ...(r.method === "POST" ? { "content-type": "application/json" } : {}) },
      body: r.method === "POST" ? JSON.stringify(req.body ?? {}) : undefined };

    // An upstream that speaks x402 has to be paid before it will answer. Vendo pays it out of
    // what the buyer paid for this call and never exceeds it.
    if (b.upstreamX402) {
      const out = await fetchPaidUpstream(upstreamUrl, init, viaCredit ? price : price);
      sale(out.status);
      if (out.status < 400 && !viaCredit) treasury.simulateRevenue(price);
      signed(out.status, out.body);
      if (out.costUsd > 0) {
        res.setHeader("x-vendo-upstream-cost", out.costUsd.toFixed(6));
        if (out.tx) res.setHeader("x-vendo-upstream-tx", out.tx);
        if (out.network) res.setHeader("x-vendo-upstream-network", out.network);
      }
      return res.status(out.status).type(out.contentType ?? "application/json").send(out.body);
    }

    const up = await fetch(upstreamUrl, init);
    const body = await up.text();
    sale(up.status);
    if (up.status < 400 && !viaCredit) treasury.simulateRevenue(price);
    signed(up.status, body);
    res.status(up.status).type(up.headers.get("content-type") ?? "application/json").send(body);
  } catch (e) {
    sale(502);
    res.status(502).json({ error: "upstream unavailable" });
  }
});

async function localService(id: string, path: string, q: Record<string, string>, tier?: string): Promise<{ status: number; body: any; type?: string }> {
  if (id === "bookkeeper" && path === "/statement") {
    if (!q.business || !getBusiness(q.business)) return { status: 400, body: { error: "business query parameter must be a listed business id" } };
    const month = q.month || new Date().toISOString().slice(0, 7);
    return q.format === "csv" ? { status: 200, body: statementCsv(month, q.business), type: "text/csv" } : { status: 200, body: statement(month, q.business) };
  }
  if (id === "discovery" && path === "/check") {
    const b = q.business && getBusiness(q.business);
    if (!b) return { status: 400, body: { error: "business query parameter must be a listed business id" } };
    return { status: 200, body: { test: await findTest(b, q.task || b.routes[0].summary), fixes: await suggestFixes(b) } };
  }
  try {
    if (id === "counterparty" && path === "/sanctions") return { status: 200, body: await screenName(q.name) };
    if (id === "counterparty" && path === "/check") return { status: 200, body: await counterpartyCheck(q, tier) };
    if (id === "ask" && path === "/q") return { status: 200, body: await askBroker(String(q.q ?? ""), tier) };
    if (id === "trackrecord" && path === "/asp") return { status: 200, body: aspTrackRecord(q) };
    if (id === "filings" && path === "/company") return { status: 200, body: await secCompany(q.cik) };
    if (id === "invoice" && path === "/calc") return { status: 200, body: await invoiceCalc(q as any) };
  } catch (e: any) {
    const msg = String(e.message ?? e);
    return { status: /required|must be|Set SEC_USER_AGENT/.test(msg) ? 400 : 502, body: { error: msg } };
  }
  return { status: 404, body: { error: "unknown local service" } };
}

/**
 * Ask a question, get a paid answer.
 *
 * Coinbase's marketplace sells outcomes rather than endpoints: one price, one answer, composed of
 * whatever services were needed. Every OKX AI listing today is a single endpoint an agent has to
 * find, understand and parameterise first. This collapses that into one call.
 *
 * It routes only to services Vendo operates. Brokering someone else's paid service would mean
 * marking up work Vendo has no permission to resell, which is the rule the import path already
 * enforces. Non-Vendo matches are returned as a pointer so the caller can go direct.
 *
 * The price is flat because an x402 challenge is fixed per route and cannot vary by question. That
 * means a cheap question costs more here than calling the service directly, so the response says so
 * plainly and reports what the underlying service charges on its own.
 */
async function askBroker(question: string, tier?: string) {
  if (!question.trim()) throw new Error("q is required: ask a question in plain English");

  // searchServices ranks every listed route, local ones included. assist.match() skips local
  // stores on purpose, because Assist pays real money and would be paying Vendo to call Vendo.
  const ranked = searchServices(question, { limit: 3 }).items;
  const best = ranked[0];
  if (!best) {
    // Nothing Vendo runs fits. Hand back a ready-to-post OKX AI task rather than a shrug.
    return { question, answered: false, reason: "No Vendo service can answer this.",
      okxTaskBrief: okxTaskBrief(question), checkedAt: new Date().toISOString() };
  }

  const store = getBusiness(best.store);
  const route = store && store.routes.find((r) => r.summary === best.summary && r.method === best.method);
  if (!store || !route) {
    return { question, answered: false, reason: "Matched a service that is no longer listed.", checkedAt: new Date().toISOString() };
  }

  const common = { question, answeredBy: { store: store.id, title: store.title, summary: route.summary },
    standalonePriceUsd: route.priceUsd, alternatives: ranked.slice(1).map((o) => ({ store: o.store, summary: o.summary, priceUsd: o.priceUsd })) };

  if (!store.local) {
    // Upstream services need their credentials and their own forwarding path. Rather than half-do
    // that here, point the caller at the exact URL so they can call it directly.
    return { ...common, answered: false, reason: "This answer comes from an upstream service. Call it directly.",
      callDirectly: best.url, checkedAt: new Date().toISOString() };
  }

  // Turn the question into concrete parameters. Without values there is nothing to call.
  const filled = fillParams(store, route, question);
  if (!filled) {
    return { ...common, answered: false, reason: "Could not read the inputs this service needs from the question.",
      needs: route.params.filter((x) => x.required || x.in === "path").map((x) => ({ name: x.name, description: x.description, example: x.example })),
      checkedAt: new Date().toISOString() };
  }
  const params = Object.fromEntries(new URL(filled, env.publicUrl).searchParams);
  const out = await localService(store.id, route.path, params, tier);

  return { ...common, answered: out.status < 400, status: out.status, usedParameters: params, answer: out.body,
    note: `Routed for you. Calling ${store.id}${route.path} directly costs ${route.priceUsd} USDT0.`,
    checkedAt: new Date().toISOString() };
}

/**
 * Delivery track record for one listed store, assembled from what Vendo already observes:
 * recorded sales, uptime probes, repeat buyers and seller level.
 *
 * On OKX AI a disputed A2A delivery goes to at least five Evaluators, who are told to pull
 * "historical delivery data from Agent Service Providers" before voting, and who are slashed
 * for voting with the minority. This returns that evidence in one call. Buyers choosing
 * between two sellers use the same record.
 */
function aspTrackRecord(q: Record<string, string>) {
  const b = q.store ? getBusiness(q.store) : null;
  if (!b) throw new Error("store query parameter must be a listed store id");
  const sales = listSales(b.id) as { at: string; upstream_status: number; amount_atomic: string }[];
  const delivered = sales.filter((s) => s.upstream_status < 400);
  const paid = delivered.filter((s) => s.amount_atomic !== "0");
  const failed = sales.filter((s) => s.upstream_status >= 400);
  const at = sales.map((s) => s.at).sort();
  const r = retention(b.id)[0] ?? null;
  const pick = (hours: number) => uptime(hours).find((u) => u.business_id === b.id) ?? null;

  return {
    store: b.id,
    title: b.title,
    listing: b.listing ?? { status: "not registered" },
    level: sellerLevels().get(b.id) ?? null,
    delivery: {
      paidCalls: paid.length,
      deliveredCalls: delivered.length,
      failedCalls: failed.length,
      // Share of recorded calls the upstream answered without an error status.
      successRate: sales.length ? +(delivered.length / sales.length).toFixed(3) : null,
      firstCall: at[0] ?? null,
      lastCall: at[at.length - 1] ?? null,
    },
    uptime: { last24h: pick(24), last7d: pick(168) },
    buyers: r ? { buyers: r.buyers, repeatBuyers: r.repeatBuyers, repeatRate: r.repeatRate, returningAfterADay: r.returningAfterADay } : null,
    receipts: { issuer: "vendo", alg: "Ed25519", verify: `${env.publicUrl}/vendo/receipts/verify`, publicKey: `${env.publicUrl}/.well-known/vendo-receipts.json` },
    checkedAt: new Date().toISOString(),
    note: "Delivery record observed by Vendo for this store. Evidence for an evaluation or a buying decision, not a guarantee of future delivery.",
  };
}

/** One call before paying someone: registry status + sanctions + verified wallet. */
async function counterpartyCheck(q: Record<string, string>, tier = "standard") {
  if (!q.name && !q.lei && !q.wallet) throw new Error("name, lei or wallet is required");
  if (tier === "basic") {
    if (!q.name) throw new Error("name is required for the basic tier");
    try {
      const sanctions = await screenName(q.name);
      const verdict = sanctions.possibleMatch ? (sanctions.matches[0].score >= 0.95 ? "block" : "review") : "pass";
      return { tier, verdict, reasons: [sanctions.possibleMatch ? `Possible OFAC sanctions match: ${sanctions.matches[0].name}` : "No sanctions match"], sanctions, checkedAt: new Date().toISOString(), note: "Risk signal, not legal or compliance advice." };
    } catch (e: any) {
      return { tier, verdict: "review", reasons: [`Sanctions list unavailable: ${e.message}`], sanctions: null, checkedAt: new Date().toISOString(), note: "Risk signal, not legal or compliance advice." };
    }
  }
  const reasons: string[] = [];
  let verdict: "pass" | "review" | "block" = "pass";
  const bump = (v: "review" | "block", why: string) => { reasons.push(why); if (v === "block" || verdict === "pass") verdict = v; };

  const wallet = q.wallet ? lookupWallet(q.wallet) as any : null;
  const lei = q.lei || wallet?.lei;
  let registry: any[] = [];
  try { registry = lei || q.name ? await registryLookup({ lei, name: lei ? undefined : q.name }) : []; }
  catch (e: any) { bump("review", `Registry lookup unavailable: ${e.message}`); }
  const best = registry[0];
  if ((q.name || lei) && !best) bump("review", "No matching legal entity found in the LEI registry");
  if (best && best.status !== "ACTIVE") bump("review", `Legal entity status is ${best.status}`);
  if (best && q.name && lei && nameSimilarity(q.name, best.legalName ?? "") < 0.5) bump("review", "Name does not match the LEI record");

  const nameToScreen = best?.legalName || q.name;
  let sanctions: any = null;
  if (nameToScreen) {
    try {
      sanctions = await screenName(nameToScreen);
      if (sanctions.possibleMatch) bump(sanctions.matches[0].score >= 0.95 ? "block" : "review", `Possible OFAC sanctions match: ${sanctions.matches[0].name}`);
    } catch (e: any) { bump("review", `Sanctions list unavailable: ${e.message}`); }
  }
  if (q.wallet) {
    if (!wallet) bump("review", "Wallet is not a verified business wallet");
    else if (lei && wallet.lei !== lei) bump("block", "Wallet is verified for a different legal entity");
  }
  if (!reasons.length) reasons.push("Active legal entity, no sanctions match" + (wallet ? ", verified business wallet" : ""));
  if (tier !== "premium" && q.wallet) { /* standard includes a wallet lookup only when asked */ }
  const result: any = { tier, verdict, reasons, registry: best ?? null, sanctions, wallet: wallet ?? (q.wallet ? { address: q.wallet, verified: false } : null),
    checkedAt: new Date().toISOString(), note: "Risk signal to support a payment decision, not legal or compliance advice." };
  if (tier === "premium") {
    result.report = { summary: `${verdict.toUpperCase()}: ${reasons.join("; ")}`, subject: { name: q.name ?? best?.legalName ?? null, lei: best?.lei ?? lei ?? null, wallet: q.wallet ?? null } };
    result.reportSignature = receipts.issue({ store: "counterparty", route: "GET /check [premium report]", method: "REPORT", url: JSON.stringify(result.report.subject), body: JSON.stringify(result.report), status: 200, priceUsd: 0.08 });
  }
  return result;
}

startHealthLoop();
startBillLoop();

app.listen(env.port, () => {
  console.log(`\nVendo${OFFLINE ? " [OFFLINE DEMO — no real payments]" : ""} on ${env.publicUrl} — ${env.networkName} (chain ${env.network.chainId}) · LLM: ${llmEnabled() ? "on" : "off"}`);
  console.log(`  Dashboard  ${env.publicUrl}/app`);
  console.log(`  Proof      ${env.publicUrl}/proof`);
  console.log(`  Kit        ${env.publicUrl}/llms.txt`);
  console.log(`  MCP        ${env.publicUrl}/mcp`);
  for (const b of listBusinesses()) for (const r of b.routes) console.log(`  $${r.priceUsd}  ${r.method} ${env.publicUrl}/${b.id}${r.sampleRequest}`);
});

process.on("unhandledRejection", (err: any) => {
  const msg = String(err?.cause?.message ?? err?.message ?? err);
  if (/getSupported failed: 40[13]/.test(msg)) {
    console.error("\n[vendo] OKX facilitator rejected your credentials (401/403). Check OKX_API_KEY / OKX_SECRET_KEY / OKX_PASSPHRASE.\n" +
      "        Tip: run `npm run dev:offline` to use the dashboard, kit, discovery and Assist matching without payments.\n");
  } else console.error("[vendo] error:", msg);
  if (!process.env.VENDO_OFFLINE) process.exit(1);
});
