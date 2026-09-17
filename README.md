# Vendo

**The business account for an agent-native company.**

OKX AI's thesis is one person, one company. A company does four things, and Vendo is where a business does all four without leaving OKX AI.

| | | Status |
|---|---|---|
| **Sell** | An API, a website form, or expertise becomes a service agents can buy | Live |
| **Earn** | Paid per call in USDT0 on X Layer, with signed receipts and books | Live |
| **Hire** | Ask in English, buy from any web page with Vendo Assist, or hand a brief to OKX AI's task market | Live |
| **Invest** | Idle revenue sweeps into approved venues on X Layer | Vault built, no adapter, unaudited |

Live at `https://vendo-pfm3.onrender.com`. Registered on OKX AI as agent #13772.

Full statement: [docs/PRODUCT.md](docs/PRODUCT.md). Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md). What was built during the official build period: [docs/BUILD-LOG.md](docs/BUILD-LOG.md).

## Built on three winning lessons

| Winner | Lesson | How Vendo uses it |
|---|---|---|
| **Rill** (Sui Overflow 2026) | Services built for humans must become machine-readable for agents | Every store gets `llms.txt`, OpenAPI and MCP tools automatically; businesses without an API sell an owner-verified website form (Website-to-Agent); `/vendo/public/search` and MCP `vendo_search` let agents find services by need |
| **PayperPlane** (TOKEN2049 Origins) | Meet people where they already are, in the browser | Vendo Assist extension: search from any page or selected text, fill inputs, confirm, pay and see the result, within per-call and daily limits |
| **MicroPay** (TOKEN2049) | Payments should not be blocked by which chain your money is on | Settlement stays on X Layer (USDT0); when a buyer is short, Vendo returns a funding plan to bridge or swap from another chain with Onchain OS (`/vendo/public/fund-plan`, MCP `vendo_funding_plan`, Assist and 402 responses) |

## The two sides

1. **Sell:** a business or data provider connects its API (header, bearer or query-parameter key, stored encrypted) or a verified website form, sets prices, and lists on OKX AI. It can edit prices, pause, resume, delete, and run a one-click end-to-end test.
2. **Discover and buy:** agents find services through search, MCP, the skills bundle and the public store feed; people use the Assist extension. Payments settle per call on X Layer, with packs, receipts and funding plans.

## Fiverr for agents: where Vendo fits

OKX AI is the marketplace (listings, escrow, identity, reputation). Vendo is the seller toolkit on top: set up a service in four steps, offer Basic, Standard and Premium tiers, get found by agents, get paid on X Layer, and climb seller levels with real paid calls, repeat buyers and uptime.

## What's built (v0.10)

| Module | What it does | Where |
|---|---|---|
| **Sell** | Dynamic seller registry. Onboard a store from the dashboard (or import an OpenAPI file), set prices and a `payTo` wallet per store. New routes go live without restarting. Owner approval required. | `src/registry.ts`, `src/openapi-import.ts`, `/app` → Open a store |
| **Get paid** | x402 paywall via OKX Payment SDK (`PAYMENT-REQUIRED` header, which OKX AI listing review validates). Paid calls are forwarded to the business API; revenue goes straight to the store's wallet. | `src/app.ts` |
| **Agent-ready kit** | `llms.txt`, OpenAPI 3.1 and MCP tool definitions for every store. | `src/kit.ts`, `/llms.txt`, `/vendo/kit/:id/*` |
| **Get found** | Discoverability score, 5-agent find-test and suggested listing fixes. Uses Claude when `ANTHROPIC_API_KEY` is set, otherwise a transparent heuristic (labelled "simulated"). | `src/discovery.ts`, `/app` → Get found |
| **Books** | Ledger of sales and Assist purchases, monthly statement (revenue, costs, net) as JSON/CSV. | `src/ledger.ts`, `/app` → Books |
| **Vendo's own paid services** | **Bookkeeper** (`/bookkeeper/statement`, 0.02 USDT0) and **Discovery Check** (`/discovery/check`, 0.05 USDT0) — list these on OKX AI too. | `src/businesses.ts`, `src/app.ts` |
| **Vendo Assist** | Matches a typed or highlighted task to a listed service, then pays with a capped buyer wallet via the x402 client and records the cost. Per-call and daily limits. | `src/assist.ts`, `/app` → Assist |
| **Assist extension** | Chrome extension (MV3): popup, right-click "Ask Vendo Assist", only reads the page when the user asks. | `extension/` |
| **Website-to-Agent** | For businesses without an API: find forms on the owner's page, verify site ownership (meta tag or `/.well-known/vendo-verify.txt`), publish one form as a paid route. Public-internet-only fetches, timeouts and size limits. | `src/web-agent.ts`, `/app` → No API? Use your website |
| **Treasury (vault)** | `VendoVault.sol`: business-owned vault. Automation can sweep idle cash above a buffer into approved venues, pay approved payees within caps and a daily limit, pause and tighten limits. It can never pay unapproved addresses or loosen limits; the owner can always withdraw. Backend operates it via viem; offline mode simulates the same rules. | `contracts/`, `src/treasury.ts`, `/app` → Treasury |
| **Assist hand-off** | When no per-request service fits (bigger or custom jobs), Assist returns an Onchain OS prompt to post the job to OKX AI's own task matching instead of competing with it. | `src/assist.ts` |
| **Listing models** | **Self-listed (default):** the business registers the OKX AI listing with its own Agentic Wallet and receives revenue directly; Vendo never holds funds. **Managed:** Vendo registers the listing, receives revenue and tracks payouts owed minus a fee. (On OKX AI, whoever lists a service keeps its revenue.) | `src/registry.ts`, `src/ledger.ts` |
| **Go live guide** | Per-store step list with ready Onchain OS prompts to register each endpoint as an A2MCP service and list it, plus fields to save Agent ID, listing link and review status. | `/app` → Overview → Go live |
| **Encrypted API keys** | Upstream credentials stored with AES-256-GCM, injected only when forwarding a paid call, never returned by any API. | `src/secrets.ts` |
| **Payouts** | Balance owed per managed store (revenue, fee, paid, balance) and payout records with transaction hashes. | `/app` → Books |
| **Vendo MCP server** | `POST /mcp`: one MCP endpoint exposing every Vendo store as a tool. Agents install Vendo once and can discover and call many real businesses. Paid tools return the x402 payment request; the server never spends on the agent's behalf. | `src/mcp.ts`, `/app` → Insights |
| **Repeat buyers** | Captures the payer wallet from x402 settlement and reports buyers, repeat buyers, repeat rate and returning buyers per store. | `src/ledger.ts`, `/app` → Insights |
| **Uptime checks** | Regular checks of each store's API or form, with 24h and 7d uptime on the dashboard and proof page. | `src/health.ts` |
| **Scheduled bills** | Recurring bills paid from the vault when due; the vault still enforces approved payees, caps and daily limits. | `src/bills.ts`, `/app` → Treasury |
| **Fee splits (MPP engine)** | Optional Vendo fee on self-listed stores using MPP charge `splits`, so Vendo never holds the business's share. Needs testnet verification; x402 A2MCP listings still use a single payTo. | `src/proxy.ts` |
| **Counterparty Check** | `/counterparty/check`: legal entity status (GLEIF), US OFAC sanctions screening and verified business wallet status in one call, returning pass, review or block with reasons. `/counterparty/sanctions` screens a name. | `src/finance.ts`, `src/app.ts` |
| **Verified business wallets** | A company signs a challenge with its wallet and names its LEI; Vendo checks the signature and the LEI, then agents can confirm a wallet belongs to that legal entity before paying. | `src/entity-wallets.ts`, `/vendo/wallets/*` |
| **Company filings** | `/filings/company?cik=`: US public company profile and latest SEC filings (requires `SEC_USER_AGENT`). | `src/finance.ts` |
| **Invoice maths** | `/invoice/calc`: net, tax and gross for stablecoin invoices with reference-rate conversion and the USDT0 amount to settle. | `src/finance.ts` |
| **Agent skills bundle** | `skills/vendo/SKILL.md`: teaches Claude Code, Codex, Cursor and OpenClaw agents to discover Vendo, confirm prices, run a counterparty check before paying new counterparties, and keep receipts. Install with `npx skills add <your-org>/vendo`. | `skills/vendo` |
| **Create a service wizard** | Four steps like setting up a gig: connect (OpenAPI import or manual, encrypted API key), service and tiers, examples with live discoverability tips, wallet and go live. Creates the store, runs the payment check and opens the go-live steps. | `/app` → Create a service |
| **Service tiers** | Up to three tiers per service (basic, standard, premium), each with its own price and description, called at `/{store}/t/{tier}{path}`. Sellers' APIs receive `x-vendo-tier`. Shown in search, MCP (tier argument), `llms.txt`, proof page. Counterparty Check ships with three tiers. | `src/businesses.ts`, `src/registry.ts` |
| **Seller levels** | New, Rising and Top seller badges earned from paid calls (30 days), repeat rate and uptime, with the next milestone shown. Used in search ranking, the public feed, dashboard and proof page. | `src/levels.ts` |
| **Call packs** | Buyers pay once (x402) for 25 or 100 calls at a discount and get a credit token (`x-vendo-credit`). Credits are per store, expire after 30 days, refund on failed calls. Built to drive repeat usage. | `src/credits.ts`, `GET /:store/pack/:n` |
| **Signed delivery receipts** | Every paid response carries `x-vendo-receipt`: an Ed25519-signed record of the request hash, response hash, price, payer and transaction. Anyone can verify it, including OKX AI evaluators in a dispute. | `src/receipts.ts`, `POST /vendo/receipts/verify`, `/.well-known/vendo-receipts.json` |
| **Public reputation feed** | `GET /vendo/public/stores.json`: per store listing status, endpoints, packs, paid calls (30d), buyers, repeat rate, uptime and response time. Ready to share with OKX AI or other marketplaces. | `src/app.ts` |
| **Access control** | Admin token for dashboard, treasury, payouts and bills APIs; Assist token for paid Assist runs; per-IP rate limits on public endpoints. Production refuses to start admin APIs without a token. | `src/security.ts` |
| **Deployment** | Dockerfile with health check, docker-compose with a persistent data volume. | `Dockerfile`, `docker-compose.yml` |
| **How it works page** | Plain-language technical explanation for mentors and judges: request path, connecting an API or website, listing models, safety. | `/how` |
| **Proof page** | Public page with stores, endpoints, prices, wallets and recent payments. | `/proof` |
| **Alt engine** | OKX reverse proxy (MPP protocol) for future pay-as-you-go sessions. Not for A2MCP listings. | `src/server.ts`, `src/proxy.ts` |

**Not built yet:** a real USDG venue adapter for the vault (needs the confirmed X Layer USDG contract and yield mechanism), pay from any chain. See "Next".

## Run it

```bash
npm install
cp .env.example .env
```

### Docker
```bash
cp .env.example .env   # fill in keys, VENDO_ADMIN_TOKEN, PUBLIC_URL
docker compose up -d --build
```

### Offline demo (no keys needed)
Try the whole product locally with **simulated** payments. Clearly labelled in the UI; never use for listings.
```bash
npm run dev:offline
# open http://localhost:3000/app and http://localhost:3000/proof
```

### Live payments (X Layer testnet → mainnet)
1. OKX Developer Portal API key → fill `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`.
2. `MPPX_SECRET_KEY=$(openssl rand -base64 32)`, `DEFAULT_PAY_TO=<your wallet>`, `NETWORK=testnet`.
3. Test OKB + test USDT0 from the X Layer faucet.
4. `npm run dev` then `npm run check:402` → both lines print 402.
5. For Assist payments, set `BUYER_PRIVATE_KEY` to a separate funded test wallet and limits `ASSIST_MAX_USD_PER_CALL`, `ASSIST_MAX_USD_PER_DAY`.
6. Optional: `ANTHROPIC_API_KEY` for LLM find-tests, listing fixes and Assist matching.

### Vault contract
```bash
cd contracts
forge test            # 8 tests incl. fuzzing: buffer, caps, daily limit, only-tighten, pause, owner withdraw
# deploy (testnet first)
VAULT_TOKEN=<USDT0> VAULT_OWNER=<business wallet> VAULT_OPERATOR=<automation wallet> \
forge script script/Deploy.s.sol --rpc-url $XLAYER_RPC --private-key $DEPLOYER_KEY --broadcast
```
Then set `VAULT_ADDRESS`, `OPERATOR_PRIVATE_KEY`, `XLAYER_RPC` in `.env`. As the owner, approve venues with `setVenue` and payees with `setPayee`. Contract addresses go in the README and proof page (Build a Market requirement).

### Load the extension
Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`. In Settings, set the server URL (default `http://localhost:3000`).

## Tests and CI

```bash
npm run test:all     # typecheck + 18 end-to-end tests (both sides, security, receipts, packs, MCP) + finance checks
cd contracts && forge test
```
GitHub Actions (`.github/workflows/ci.yml`) runs the app tests and the Foundry contract tests on every push.

## Demo and video runbook

**Rehearse offline with sample data** (clearly labelled, never touches a live database):
```bash
npm run demo:seed && npm run demo:run   # dashboard and proof page with sample sales, buyers and uptime
```

**Prove it live on X Layer** with a separate buyer wallet:
```bash
BUYER_PRIVATE_KEY=0x... VENDO_URL=https://your-vendo npm run buyer -- "sanctions screening" name="Example Trading LLC"
```
The buyer agent searches Vendo by need, checks the price against `MAX_USD`, pays the x402 request, verifies the signed receipt, and prints the X Layer explorer link. Record this for the demo video.

## Go live on OKX AI
1. Deploy to a public HTTPS domain (Railway/Render/Fly/AWS; avoid Hong Kong if calling LLM APIs). Set `PUBLIC_URL`.
2. `npm run check:402 -- https://your-domain`
3. `npx skills add okx/onchainos-skills --yes -g`, log in to Agentic Wallet.
4. Ask your agent: *"Help me register an A2MCP ASP on OKX.AI using OKX Agent Identity from Onchain OS"* for each endpoint (FX, Company check, Bookkeeper, Discovery Check, onboarded stores).
5. *"Help me list my ASP on OKX.AI using Onchain OS"* → review within 24h.
6. Test as a separate buyer with a registered user ID.

## API

Free:
`GET /health` · `GET /app` · `GET /proof` · `GET /llms.txt` · `GET /vendo/kit/:id/openapi.json|mcp.json`
`GET /vendo/api/config` · `GET|POST /vendo/api/businesses` · `POST /vendo/api/import-openapi`
`GET /vendo/api/sales` · `GET /vendo/api/purchases` · `GET /vendo/api/statement?month=&business=&format=csv`
`POST|GET /vendo/api/discovery/:id` · `POST /vendo/api/check402`
`POST /vendo/assist/match {text}` · `POST /vendo/assist/run {url, serviceKey}`

Paid (x402): `/:storeId/<route>` for every listed route, including `/bookkeeper/statement` and `/discovery/check`.

## Tested locally (offline mode)
- Dashboard and proof page load
- Unpaid calls → 402; onboarding validation rejects bad input; new store routes are paywalled immediately
- Assist matches tasks to FX and company-check services and extracts inputs; runs within limits and records purchases
- Bookkeeper paid service returns CSV; statement totals update
- Find-test, score and fixes return results
- Website-to-Agent: SSRF guard rejects localhost and non-https; publishing requires owner approval; paid form submission returns readable page text; missing required fields rejected
- Treasury (simulated): sweep blocked below buffer, unapproved payee blocked, approved bill paid with auto-pull from yield
- Assist: no false match for unrelated tasks; returns an OKX AI task prompt instead
- Contracts: `forge test` 8/8 passing
- Listing models: self-listed stores require the business wallet; 402 challenge pays the business (self) or Vendo treasury (managed)
- API keys: encrypted in the database, never returned by the API
- Go-live guide returns Onchain OS prompts; listing link must be https; payouts limited to the balance owed and only for managed stores
- MCP: initialize, tools/list (5 tools from stores), unpaid call returns payment request, missing inputs rejected, unknown methods return JSON-RPC errors, notifications return 202
- Repeat buyers computed per store; scheduled bills pay approved payees and record failures for unapproved ones
- Access control: private APIs return 401 without the admin token; public proof-page reads stay open; Assist runs need the Assist token; rate limit returns 429 after the per-minute budget
- Packs: 25-call pack priced at 15% off, credit token works only on its store, invalid tokens rejected, balance endpoint shows calls left
- Receipts: valid signature verifies, altered response body detected, forged receipt rejected
- Discovery: search ranks sanctions services first for "sanctions screening"; price filter works; prepare reports missing inputs; MCP lists `vendo_search` and `vendo_funding_plan`
- Sell side: paused store returns 503 without charging and disappears from search; query-parameter API keys stored encrypted and kept on price edits; delete needs confirmation; store self-test checks the 402 and verifies the demo receipt
- Funding: plan shows shortfall and an Onchain OS bridge prompt from the chosen chain and token
- Finance: `npx tsx scripts/test-finance.ts` (10 checks: name normalisation, sanctions hits and misses, invoice maths, wallet signature verification and rejection); counterparty check returns block for a sanctioned name and review when the registry is unreachable or the wallet is unverified
- Typecheck passes; extension scripts parse

**Needs your keys to verify:** real x402 payments, settlement receipts, and Assist paying on X Layer.

## Connect an agent via MCP
```json
{ "mcpServers": { "vendo": { "type": "http", "url": "https://your-domain/mcp" } } }
```

## Listing models

| | Self-listed (default) | Managed by Vendo |
|---|---|---|
| Registers on OKX AI | Business, own Agentic Wallet | Vendo |
| Payment goes to | Business wallet (`payTo`) | `VENDO_TREASURY_WALLET` |
| Business paid | Every call, directly | Payouts minus `feeBps` |
| Vendo holds funds | Never | Until payout |

Open question for OKX: whether a single paid endpoint can split a payment between two addresses, so Vendo could take a fee on self-listed stores without holding funds.

## Requirements map (Build a Company)
| Requirement | Evidence |
|---|---|
| Publish or integrate a working service through OKX AI | A2MCP listings for stores, Bookkeeper, Discovery Check |
| Demonstrate an end-to-end workflow | Onboard store → listed → Assist/agent pays → response → books |
| Provide service/listing/integration URL | Listing URLs, `/proof`, `/llms.txt` |
| Show working product in demo video | Record dashboard + extension + proof page |

## Next (by priority)
1. Deploy + first real paid call on testnet, then mainnet listings
2. Onboard 1-3 external sellers (API or website form)
3. Deploy VendoVault on X Layer testnet; write a USDG venue adapter once the USDG contract and yield path are confirmed with mentors
4. Scheduled bill runner (cron) using the treasury service
5. Pay from any chain via OKX cross-chain tooling

## Notes
- Vendo never holds funds: buyers pay each store's `payTo` directly. Assist uses a separate buyer wallet with limits.
- Demo data: GLEIF (CC0), Frankfurter (MIT; check underlying provider terms, self-host for production). Only list APIs and websites you own or have permission to sell; Website-to-Agent requires ownership verification.
- The vault contract is unaudited hackathon code. Use small amounts on testnet.
