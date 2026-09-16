# Vendo: context for Claude Code

## What this is
Vendo is a seller toolkit for **OKX AI** ("Fiverr for AI agents"), built for OKX Dev Day 2026 (Build a Company track, team Xtension Labs, submission deadline 25 Sep 2026 23:59 UTC).
- **Sell side:** businesses and data providers connect an API (encrypted key) or a verified website form, set prices and tiers, and list on OKX AI.
- **Discover and buy:** agents find services via search, MCP (`/mcp`), the skills bundle (`skills/vendo`) and public feed; people use the Chrome extension (`extension/`). Payments are per call in USDT0 on X Layer via x402.
- **Positioning:** real-world finance and business data for agents (counterparty check, sanctions, SEC filings, registry, FX, invoice maths).
- **Built-in lessons from past winners:** Rill (agent-readable services), PayperPlane (browser extension), MicroPay (funding plans for funds on other chains).

## Commands
- `npm install`
- `npm run dev:offline` : full product with simulated payments (no keys). Dashboard at `/app`, proof at `/proof`
- `npm run dev` : live payments (needs `.env`, see `.env.example`)
- `npm run test:all` : typecheck + end-to-end tests + finance tests
- `cd contracts && forge test` : vault contract tests (clone forge-std into `contracts/lib` first)
- `npm run buyer -- "sanctions screening" name="Example Trading LLC"` : live demo buyer (needs `BUYER_PRIVATE_KEY`, `VENDO_URL`)
- `npm run demo:seed && npm run demo:run` : offline sample data for rehearsal (label as sample)

## Repo
`https://github.com/likalight/vendo` (private). CI runs typecheck, e2e and finance tests on every push.

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

## Next steps (priority)
1. Fill `.env` with OKX Developer Portal keys, `VENDO_ADMIN_TOKEN`, `DEFAULT_PAY_TO`, `SEC_USER_AGENT`, `PUBLIC_URL`
2. Deploy (Dockerfile / docker-compose) to a public HTTPS domain, not a Hong Kong region
3. `npm run check:402 -- https://your-domain`, then run the buyer agent on X Layer testnet, then mainnet
4. Register and list services on OKX AI via Onchain OS (dashboard Go live steps); review takes up to 24h
5. Onboard real sellers; record the 2 to 4 minute demo video; submit

## Open questions for OKX mentors
- Do MPP payment splits work for OKX AI listings (fee without custody)?
- Can uptime/receipt data feed OKX AI reputation?
- Can agents search OKX AI listings programmatically?
