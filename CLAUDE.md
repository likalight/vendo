# Vendo: context for Claude Code

## What this is
Vendo is **the business account for an agent-native company**, built for OKX Dev Day 2026 (Build a Company track, team Xtension Labs, submission deadline 25 Sep 2026 23:59 UTC). See `docs/PRODUCT.md` for the full statement.

Four things a company does, all without leaving OKX AI:
- **Sell** (live): an API, a verified website form, or expertise becomes a service agents can buy. Prices, tiers, packs, encrypted upstream credentials.
- **Earn** (live): paid per call in USDT0 on X Layer via x402. Signed Ed25519 receipts, books, uptime, seller levels. Vendo never holds funds for self-listed stores.
- **Hire** (live): Vendo Ask routes a plain English question to the right service and pays it. Vendo Assist (`extension/`) does the same from any web page with a capped wallet. Bigger jobs get a full OKX AI task brief and are handed to OKX's own task market.
- **Invest** (building): `contracts/VendoVault.sol` sweeps idle revenue above a buffer into approved venues and pays approved payees within caps. No venue adapter yet, unaudited. Aave is live on X Layer and accepts USDT0.

**Import** is how supply is acquired, not a product: an endpoint already speaking x402 elsewhere can be re-exposed as an X Layer listing (`src/upstream-x402.ts`). Vendo never pays an upstream more than the buyer paid, discloses the cost, and requires a stated permission basis.

- **Positioning:** real-world finance and business data for agents (counterparty check, sanctions, SEC filings, registry, FX, invoice maths), sold through the same pipeline Vendo gives everyone else.
- **Reference projects (verify before relying on these):** MicroPay won a category prize at the TOKEN2049 Origins hackathon for cross-chain agent payments, confirmed by CoinDesk and The Defiant. "Rill" and "Paper Plane" came from an earlier planning chat and could not be verified against a primary source. None of the three won an OKX event, so do not present them as OKX precedent. For real OKX precedent see the OKX.AI Genesis Hackathon gallery on HackQuest.

## Commands
- `npm install`
- `npm run dev:offline` : full product with simulated payments (no keys). Dashboard at `/app`, proof at `/proof`
- `npm run dev` : live payments (needs `.env`, see `.env.example`)
- `npm run test:all` : typecheck + end-to-end tests + finance tests
- `cd contracts && forge test` : vault contract tests (clone forge-std into `contracts/lib` first)
- `npm run buyer -- "sanctions screening" name="Example Trading LLC"` : live demo buyer (needs `BUYER_PRIVATE_KEY`, `VENDO_URL`)
- `npm run demo:seed && npm run demo:run` : offline sample data for rehearsal (label as sample)

## Repo
`https://github.com/likalight/vendo` (public). CI runs typecheck, e2e and finance tests on every push.

## Live
`https://vendo-pfm3.onrender.com` on Render (free plan, Singapore). Live mode, X Layer testnet, chain 1952.
`npm run check:402 -- https://vendo-pfm3.onrender.com` passes: the base64 `PAYMENT-REQUIRED` header matches the OKX A2MCP spec field for field.

Free plan has no persistent disk, so the container wipes `data/` on every restart, not just on deploy. The eight seeded stores return automatically; runtime-created stores and the sales ledger do not. Keep a free uptime pinger on `/health` every 10 minutes so the instance never sleeps.

## Local setup (Windows)
- Node 22 LTS. On Node 24 the install fails; switch with `nvm use 22.22.2`.
- Install with `npm install --ignore-scripts`. better-sqlite3 ships its own prebuilt binary in
  `node_modules/better-sqlite3/prebuilds/`, but npm still tries an implicit `node-gyp rebuild` that needs
  MSVC and fails. Skipping install scripts uses the prebuilt binary and works.
- `dev:offline` defaults to port 3000. If something else already holds it, run
  `PORT=3100 PUBLIC_URL=http://localhost:3100 npm run dev:offline`.
- Offline mode needs no `.env`: `src/env.ts` supplies placeholder credentials when `VENDO_OFFLINE=1`.
- The tests spawn tsx via `process.execPath`, not `npx` (`npx` is a `.cmd` and cannot be spawned directly).

## Key files
- `src/app.ts` server and routes; `src/registry.ts` stores, validation, tiers; `src/businesses.ts` seed services
- `src/finance.ts` registry, sanctions, filings, invoices; `src/entity-wallets.ts` verified business wallets
- `src/search.ts`, `src/mcp.ts`, `src/kit.ts` discovery; `src/funding.ts` pay from any chain
- `src/security.ts` admin/assist tokens and rate limits; `src/receipts.ts` signed receipts; `src/credits.ts` packs; `src/levels.ts` seller levels
- `src/treasury.ts`, `src/bills.ts`, `contracts/` vault
- `public/app.html` dashboard (includes Create a service wizard); `public/proof.html`, `public/how.html`

## Rules
- Never commit `.env` or keys. Never log or return upstream API credentials.
- Vendo never custodies funds for self-listed stores; payments go to the store's `payTo`.
- OKX AI listing review validates the x402 `PAYMENT-REQUIRED` header: use `src/app.ts` (x402), not `src/server.ts` (MPP), for listings.
- Screening output is a risk signal, not legal advice. Keep that wording.
- Keep tests passing (`npm run test:all`) after every change. Offline mode must stay clearly labelled.

## Hackathon dates
Online build period 17 to 25 Sep 2026. Submission by 25 Sep 23:59 UTC. Live finale Singapore 6 Oct 2026.
Judging explicitly considers onchain data, so real paid X Layer transactions count.
See `docs/BUILD-LOG.md` for what predates the build period and what was built inside it.

## Next steps (priority)
1. Fill `.env` with OKX Developer Portal keys, `VENDO_ADMIN_TOKEN`, `DEFAULT_PAY_TO`, `SEC_USER_AGENT`, `PUBLIC_URL`
2. DONE: deployed to Render, Singapore. Note on regions: the OKX docs call Hong Kong the top pick generally, and only warn against it if the service calls Claude, OpenAI or Gemini, which refuse HK connections. Vendo uses ANTHROPIC_API_KEY optionally, so avoiding HK keeps that option open.
3. `npm run check:402 -- https://your-domain`, then run the buyer agent on X Layer testnet, then mainnet
4. Register and list services on OKX AI via Onchain OS (dashboard Go live steps); review takes up to 24h
5. Onboard real sellers; record the 2 to 4 minute demo video; submit

## Open questions for OKX mentors
- Do MPP payment splits work for OKX AI listings (fee without custody)?
- Can uptime/receipt data feed OKX AI reputation?
- Can agents search OKX AI listings programmatically?
