/**
 * End-to-end tests in offline demo mode (no keys, no network needed except where noted).
 * Starts a real Vendo server on a random port with a temporary database and exercises both sides.
 * Run: npm test
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const ADMIN = "test-admin-token";
const ASSIST = "test-assist-token";
const dir = mkdtempSync(join(tmpdir(), "vendo-e2e-"));
let server: ChildProcess;
// Launch tsx through this Node binary: spawning "npx" directly fails on Windows (npx is a .cmd).
const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");

const j = { "content-type": "application/json" };
const admin = { ...j, "x-vendo-admin": ADMIN };
const get = (p: string, h: Record<string, string> = {}) => fetch(BASE + p, { headers: h });
const post = (p: string, body: unknown, h: Record<string, string> = admin) => fetch(BASE + p, { method: "POST", headers: h, body: JSON.stringify(body) });

before(async () => {
  server = spawn(process.execPath, [tsxCli, "src/app.ts"], {
    cwd: process.cwd(), stdio: "ignore",
    env: { ...process.env, VENDO_OFFLINE: "1", PORT: String(PORT), PUBLIC_URL: BASE, VENDO_DB: join(dir, "vendo.db"),
      OKX_API_KEY: "t", OKX_SECRET_KEY: "t", OKX_PASSPHRASE: "t", MPPX_SECRET_KEY: "dGVzdHNlY3JldGtleXRlc3RzZWNyZXQ=",
      DEFAULT_PAY_TO: "0x1111111111111111111111111111111111111111", VENDO_TREASURY_WALLET: "0x2222222222222222222222222222222222222222",
      VENDO_ADMIN_TOKEN: ADMIN, VENDO_ASSIST_TOKEN: ASSIST, HEALTH_CHECK_MINUTES: "0", BILL_CHECK_MINUTES: "0" },
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await get("/health")).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
});
after(async () => {
  // Wait for the child to exit before deleting the db: Windows keeps the SQLite file locked while it runs.
  if (server && server.exitCode === null && server.signalCode === null) {
    await new Promise<void>((resolve) => {
      const done = setTimeout(resolve, 5000);
      server.once("exit", () => { clearTimeout(done); resolve(); });
      server.kill();
    });
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

// ------------------------------------------------------------------ sell side
test("sell: validation rejects incomplete stores", async () => {
  const r = await post("/vendo/api/businesses", { id: "Bad Id", routes: [] });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.ok(body.errors.length >= 3);
});

test("sell: create self-listed store with encrypted key, paywalled immediately", async () => {
  const r = await post("/vendo/api/businesses", {
    id: "ratesco", title: "RatesCo benchmark rates", description: "Look up interest rate benchmarks by currency and date.",
    baseUrl: "https://github.com", payTo: "0x3333333333333333333333333333333333333333", ownerApproved: true,
    upstreamAuth: { type: "bearer", value: "sk_live_SECRET" },
    routes: [{ method: "GET", path: "/v1/rates", priceUsd: 0.02, summary: "Benchmark rates", params: [{ name: "currency", in: "query", required: true, description: "Currency", example: "USD" }] }],
  });
  assert.equal(r.status, 201);
  const listed = await (await get("/vendo/api/businesses")).text();
  assert.ok(!listed.includes("sk_live_SECRET"), "credential must never be returned");
  const unpaid = await get("/ratesco/v1/rates?currency=USD");
  assert.equal(unpaid.status, 402);
  assert.equal((await unpaid.json()).payTo, "0x3333333333333333333333333333333333333333");
});

test("sell: edit price keeps credentials, pause stops charging, resume restores", async () => {
  const u = await (await post("/vendo/api/businesses/ratesco/update", { routes: [{ method: "GET", path: "/v1/rates", priceUsd: 0.05, summary: "Benchmark rates" }] })).json();
  assert.equal(u.business.routes[0].priceUsd, 0.05);
  assert.equal(u.business.hasUpstreamAuth, true);
  assert.equal((await (await get("/ratesco/v1/rates")).json()).price, "$0.05");
  await post("/vendo/api/businesses/ratesco/status", { status: "paused" });
  assert.equal((await get("/ratesco/v1/rates")).status, 503);
  const s = await (await get("/vendo/public/search?q=benchmark%20rates")).json();
  assert.ok(!s.items.some((i: any) => i.store === "ratesco"));
  await post("/vendo/api/businesses/ratesco/status", { status: "active" });
  assert.equal((await get("/ratesco/v1/rates")).status, 402);
});

test("sell: go-live guide and self test", async () => {
  const g = await (await get("/vendo/api/businesses/ratesco/go-live", admin)).json();
  assert.equal(g.receivingWallet, "0x3333333333333333333333333333333333333333");
  assert.ok(g.steps.some((s: any) => s.prompts?.[0]?.includes("A2MCP")));
  const t = await (await post("/vendo/api/businesses/bookkeeper/test", {})).json();
  assert.equal(t.unpaid.status, 402);
  assert.equal(t.demoPaid.receipt.valid, true);
});

test("sell: delete needs confirmation", async () => {
  assert.equal((await post("/vendo/api/businesses/ratesco/delete", { confirm: "nope" })).status, 400);
  assert.equal((await post("/vendo/api/businesses/ratesco/delete", { confirm: "ratesco" })).status, 200);
  assert.equal((await get("/ratesco/v1/rates")).status, 404);
});

// ------------------------------------------------------------- buy side
test("buy: search ranks relevant services and filters by price", async () => {
  const s = await (await get("/vendo/public/search?q=sanctions%20screening")).json();
  assert.equal(s.items[0].store, "counterparty");
  const cheap = await (await get("/vendo/public/search?q=fx%20rates&maxPrice=0.001")).json();
  assert.equal(cheap.count, 0);
});

test("buy: prepare builds URL and reports missing inputs", async () => {
  const item = (await (await get("/vendo/public/search?q=sec%20filings")).json()).items[0];
  const missing = await (await post("/vendo/assist/prepare", { item, values: {} }, j)).json();
  assert.deepEqual(missing.missing, ["cik"]);
  const ok = await (await post("/vendo/assist/prepare", { item, values: { cik: "320193" } }, j)).json();
  assert.ok(ok.url.endsWith("/filings/company?cik=320193"));
});

test("buy: assist run needs its token and respects the price limit", async () => {
  assert.equal((await post("/vendo/assist/run", { url: `${BASE}/bookkeeper/statement?business=fx` }, j)).status, 401);
  const r = await (await post("/vendo/assist/run", { url: `${BASE}/bookkeeper/statement?business=fx`, serviceKey: "bookkeeper GET /statement" }, { ...j, "x-vendo-assist": ASSIST })).json();
  assert.equal(r.paid, true);
  const outside = await (await post("/vendo/assist/run", { url: "https://evil.example/x" }, { ...j, "x-vendo-assist": ASSIST })).json();
  assert.equal(outside.status, 400);
});

test("buy: MCP exposes search, funding and service tools", async () => {
  const list = await (await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" }, j)).json();
  const names = list.result.tools.map((t: any) => t.name);
  assert.ok(names.includes("vendo_search") && names.includes("vendo_funding_plan"));
  const unpaid = await (await post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "bookkeeper_monthly_revenue_statement_for_a_business", arguments: { business: "fx" } } }, j)).json();
  assert.equal(unpaid.result.structuredContent.paymentRequired, true);
});

test("buy: funding plan for funds on another chain", async () => {
  const f = await (await get("/vendo/public/fund-plan?amountUsd=2&from=Base&token=USDC")).json();
  assert.equal(f.settlement.asset, "USDT0");
  assert.ok(typeof f.shortfallUsd === "number");
  assert.equal((await get("/vendo/public/fund-plan?amountUsd=0")).status, 400);
});

test("buy: packs mint credits that only work on their store", async () => {
  const pack = await (await get("/bookkeeper/pack/25", { "x-vendo-demo-paid": "1" })).json();
  assert.ok(pack.token.startsWith("vc_"));
  const use = await get("/bookkeeper/statement?business=fx", { "x-vendo-credit": pack.token });
  assert.equal(use.status, 200);
  assert.equal(use.headers.get("x-vendo-credits-left"), "24");
  assert.equal((await get("/discovery/check?business=fx", { "x-vendo-credit": pack.token })).status, 402);
});

test("buy: receipts verify and detect tampering", async () => {
  const r = await get("/bookkeeper/statement?business=fx", { "x-vendo-demo-paid": "1" });
  const body = await r.text();
  const receipt = r.headers.get("x-vendo-receipt")!;
  const ok = await (await post("/vendo/receipts/verify", { receipt, body }, j)).json();
  assert.equal(ok.valid, true); assert.equal(ok.responseMatches, true);
  const bad = await (await post("/vendo/receipts/verify", { receipt, body: body + "x" }, j)).json();
  assert.equal(bad.responseMatches, false);
});

// ------------------------------------------------------------- platform
test("platform: private APIs need the admin token, proof reads stay public", async () => {
  assert.equal((await get("/vendo/api/payouts")).status, 401);
  assert.equal((await get("/vendo/api/businesses")).status, 200);
  assert.equal((await post("/vendo/api/treasury/pay", {}, j)).status, 401);
});

test("platform: public pages and kit load", async () => {
  for (const p of ["/app", "/proof", "/how", "/llms.txt", "/vendo/public/stores.json", "/.well-known/vendo-receipts.json"]) {
    assert.equal((await get(p)).status, 200, p);
  }
});

test("security: internal addresses are refused for API base URLs and OpenAPI imports", async () => {
  const bad = await post("/vendo/api/businesses", {
    id: "internal", title: "Internal", description: "Should never be allowed to point at internal hosts.",
    baseUrl: "https://localhost", payTo: "0x3333333333333333333333333333333333333333", ownerApproved: true,
    routes: [{ method: "GET", path: "/x", priceUsd: 0.01, summary: "x" }],
  });
  assert.equal(bad.status, 400);
  const imp = await post("/vendo/api/import-openapi", { specUrl: "https://127.0.0.1/openapi.json" });
  assert.equal(imp.status, 400);
});

test("tiers: each tier has its own price and changes what the service returns", async () => {
  assert.equal((await (await get("/counterparty/t/basic/check?name=Acme")).json()).price, "$0.01");
  assert.equal((await (await get("/counterparty/t/premium/check?name=Acme")).json()).price, "$0.08");
  assert.equal((await get("/counterparty/t/gold/check?name=Acme")).status, 404);
  const basic = await (await get("/counterparty/t/basic/check?name=Acme%20Widgets", { "x-vendo-demo-paid": "1" })).json();
  assert.equal(basic.tier, "basic");
  assert.equal(basic.registry, undefined, "basic is sanctions only");
  const premium = await (await get("/counterparty/t/premium/check?name=Acme%20Widgets", { "x-vendo-demo-paid": "1" })).json();
  assert.equal(premium.tier, "premium");
  assert.ok(premium.reportSignature, "premium includes a signed report");
  const s = await (await get("/vendo/public/search?q=counterparty%20check")).json();
  const item = s.items.find((i: any) => i.store === "counterparty" && i.tiers.length === 3);
  assert.ok(item && item.tiers[2].url.endsWith("/counterparty/t/premium/check"));
});

test("tiers: validation and seller-created tiers", async () => {
  const bad = await post("/vendo/api/businesses", {
    id: "tiered-bad", title: "Tiered", description: "Look up something useful for agents with tiers.", baseUrl: "https://github.com",
    payTo: "0x3333333333333333333333333333333333333333", ownerApproved: true,
    routes: [{ method: "GET", path: "/x", priceUsd: 0.02, summary: "x", tiers: [{ name: "gold", priceUsd: 1, includes: "x" }] }],
  });
  assert.equal(bad.status, 400);
  const ok = await post("/vendo/api/businesses", {
    id: "ratesdesk", title: "RatesDesk", description: "Look up interest rate benchmarks by currency and date.", baseUrl: "https://github.com",
    payTo: "0x3333333333333333333333333333333333333333", ownerApproved: true,
    routes: [{ method: "GET", path: "/v1/rates", priceUsd: 0.03, summary: "Benchmark rate",
      tiers: [{ name: "basic", priceUsd: 0.01, includes: "Latest rate" }, { name: "premium", priceUsd: 0.09, includes: "Full history" }] }],
  });
  assert.equal(ok.status, 201);
  assert.equal((await (await get("/ratesdesk/t/premium/v1/rates")).json()).price, "$0.09");
  const mcp = await (await post("/mcp", { jsonrpc: "2.0", id: 9, method: "tools/list" }, j)).json();
  const tool = mcp.result.tools.find((t: any) => t.name.startsWith("ratesdesk_"));
  assert.deepEqual(tool.inputSchema.properties.tier.enum, ["basic", "premium"]);
});

test("levels: stores start as new sellers with a path to rising", async () => {
  const stores = await (await get("/vendo/public/stores.json")).json();
  const fx = stores.stores.find((s: any) => s.id === "fx");
  assert.equal(fx.sellerLevel.level, "new");
  assert.match(fx.sellerLevel.next, /Rising/);
});

test("track record: paid delivery evidence for a listed store", async () => {
  // Paywalled like any other listed service.
  assert.equal((await get("/trackrecord/asp?store=bookkeeper")).status, 402);

  const paid = { "x-vendo-demo-paid": "1" };
  await get("/bookkeeper/statement?business=fx", paid);

  const r = await get("/trackrecord/asp?store=bookkeeper", paid);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.store, "bookkeeper");
  assert.ok(body.delivery.paidCalls >= 1, "at least the call just made is recorded");
  assert.ok(body.delivery.successRate > 0 && body.delivery.successRate <= 1);
  assert.equal(body.level.level, "new");
  assert.match(body.receipts.verify, /\/vendo\/receipts\/verify$/);

  // An unknown store is a caller error, not a 502.
  assert.equal((await get("/trackrecord/asp?store=not-a-store", paid)).status, 400);
});

test("assist: hands off a full OKX AI task brief, not just a one-liner", async () => {
  const r = await post("/vendo/assist/match", { text: "audit our solidity staking contract before mainnet" }, { ...j, "x-vendo-assist": ASSIST });
  assert.equal(r.status, 200);
  const { okxTaskBrief: brief, okxTaskPrompt: prompt } = await r.json();

  // OKX AI task creation asks for title, description, budget and deadline.
  assert.ok(brief.title.length > 0 && brief.title.length <= 80);
  assert.match(brief.description, /staking contract/);
  assert.ok(brief.budgetUsdt0 > 0);
  assert.ok(new Date(brief.deadline).getTime() > Date.now());
  assert.ok(["automatic", "direct", "public"].includes(brief.matching));
  assert.ok(brief.acceptance.length >= 1);
  // Defaults must be labelled as defaults, not presented as estimates.
  assert.match(brief.note, /default/i);

  // The prompt carries every field so the agent does not have to ask for them.
  for (const field of ["Title:", "Description:", "Budget:", "Deadline:", "Matching:"]) {
    assert.ok(prompt.includes(field), `prompt missing ${field}`);
  }
});

test("import: a store can declare that its upstream speaks x402", async () => {
  const r = await post("/vendo/api/businesses", {
    id: "imported", title: "Imported x402 service",
    description: "A service that already speaks x402 elsewhere, re-exposed by Vendo as an X Layer listing.",
    baseUrl: "https://example.com", payTo: "0x4444444444444444444444444444444444444444",
    ownerApproved: true, upstreamX402: true,
    routes: [{ method: "GET", path: "/v1/thing", priceUsd: 0.02, summary: "Paid upstream", params: [] }],
  });
  assert.equal(r.status, 201);

  // The flag has to survive the round trip, otherwise paid upstreams are silently fetched unpaid.
  const listed = await (await get("/vendo/api/businesses")).json();
  const imported = listed.find((b: any) => b.id === "imported");
  assert.equal(imported.upstreamX402, true);

  // And it must be a boolean, not any truthy value.
  const bad = await post("/vendo/api/businesses", {
    id: "imported-bad", title: "Bad flag", description: "Rejects a non-boolean upstreamX402 value outright.",
    baseUrl: "https://example.com", payTo: "0x5555555555555555555555555555555555555555",
    ownerApproved: true, upstreamX402: "yes",
    routes: [{ method: "GET", path: "/v1/thing", priceUsd: 0.02, summary: "Paid upstream", params: [] }],
  });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).errors.some((e: string) => /upstreamX402/.test(e)));
});
