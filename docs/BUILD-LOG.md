# Build log: OKX Dev Day 2026

Team Xtension Labs. Track: Build a Company.

**Official online build period: 17 September 2026 to 25 September 2026.**
Submission deadline 25 September 2026, 23:59 UTC.

This log separates what existed before the build period opened from what was built inside it,
as the hackathon's existing-project rules require.

---

## Baseline: what existed before 17 September

Vendo v0.10, imported at commit `e2aeadf` on 17 September 00:56. The code itself predates the
build window, so **it is not claimed as build-period work.** It provided:

- Seller registry with validation, tiers and OpenAPI import
- x402 paywall via the OKX Payment SDK, priced per route in USDT0
- Website-to-Agent: domain-verified web forms published as paid routes
- Agent kit generation: OpenAPI, MCP tool definitions, `llms.txt`
- Vendo's own finance services: counterparty check, OFAC sanctions screening, SEC filings,
  invoice maths, FX rates, GLEIF registry lookup, bookkeeper
- Signed Ed25519 delivery receipts, uptime probes, seller levels, prepaid call packs
- Vendo Assist Chrome extension (MV3) and the Assist buyer runner
- `VendoVault.sol` treasury contract with Foundry tests
- Dockerfile, docker-compose and CI

**Status at the start of the build period:** ran locally on macOS/Linux only. Never deployed,
never listed, no live payments, 18 of 18 end-to-end tests failing on Windows.

---

## Built during the build period (17 September onward)

### Made it run at all on Windows
The v0.10 test harness spawned `npx` directly, which fails on Windows because `npx` is a `.cmd`.
All 18 end-to-end tests failed. Fixed in `tests/e2e.test.ts` by launching tsx through
`process.execPath`, and by making teardown wait for the child process to exit before deleting the
SQLite file, which Windows keeps locked.

Also fixed `npm install`, which attempted an implicit `node-gyp rebuild` of better-sqlite3
despite the package shipping prebuilt binaries.

Commit: `090cc27`

### Offline mode without credentials
`src/env.ts` threw on missing OKX keys even in offline mode, contradicting its own documented
behaviour. Offline now supplies clearly-labelled placeholder credentials so the product runs with
no `.env` at all.

Commit: `7e604e8`

### Landing page
`/` previously redirected straight to the operator dashboard, so the product link opened an
internal console. Added `public/index.html`: the value proposition, the four-step OKX AI
registration flow using the real Onchain OS prompts, what Vendo handles, the service price list,
and the Assist extension. Built on the existing design tokens, works in light and dark, no build
step.

Commits: `7e604e8`, `75eccc0`

### Production Docker build
Two defects that would have broken any deployment: `tsx` was a devDependency while
`NODE_ENV=production` made `npm ci` skip it, and `node:22-slim` has no build tools for
better-sqlite3's implicit gyp rebuild. Moved tsx to dependencies, installed with
`--ignore-scripts`, and ran tsx through node rather than npx.

Commit: `7e604e8`

### New service: ASP track record
`trackrecord GET /asp`, 0.01 USDT0. Returns a listed store's delivery history: paid calls,
success rate, uptime over 24 hours and 7 days, repeat-buyer rate, seller level, and where to
verify its signed receipts.

Built for a specific OKX AI mechanism: a disputed A2A delivery goes to at least five Evaluators,
who are told to pull historical delivery data from Agent Service Providers before voting, and who
are slashed for voting with the minority. This returns that evidence in one call. Agents choosing
between two providers use the same record.

Commit: `75eccc0`. Covered by a new end-to-end test.

### Onboarding a real third-party API
`scripts/demo-seller.ts` and `npm run demo:seller` onboard World Bank Open Data through
`POST /vendo/api/businesses`, the same public endpoint a business owner uses from the dashboard.
The store is created at runtime, not seeded, so it exercises the real onboarding path.

Source is CC BY 4.0, which permits commercial redistribution with attribution. Attribution and a
no-endorsement note are carried in the store's `licence` field.

Verified: unpaid returns 402, a paid call forwards live indicator data from the upstream, and the
response carries a signed delivery receipt.

Commit: `aaf991f`

### Deployed to production
`render.yaml` blueprint: Docker web service, Singapore region, health check on `/health`, every
secret marked `sync: false` so nothing is stored in the repository. The Ed25519 receipt signing
key is supplied through `VENDO_RECEIPT_KEY` rather than generated to disk, so receipts stay
verifiable across restarts on a plan with no persistent disk.

Live at **https://vendo-pfm3.onrender.com**

Commit: `563b34e`

### x402 compliance verified against the live deployment
`npm run check:402` against the production domain passes on both probed routes. The decoded
`PAYMENT-REQUIRED` header matches the OKX A2MCP specification field for field: `x402Version` 2,
scheme `exact`, network `eip155:1952`, the X Layer testnet USDT0 asset, amount in minor units,
`maxTimeoutSeconds` 300, and `extra` naming USD₮0 version 1. `payTo` resolves to the team wallet
and `resource.url` resolves to the public domain.

---

## Evidence

- Repository: https://github.com/likalight/vendo (public)
- Live service: https://vendo-pfm3.onrender.com
- Commit history: all build-period commits dated 17 September 2026 or later
- CI: typecheck, 19 end-to-end tests and 10 finance checks run on every push
