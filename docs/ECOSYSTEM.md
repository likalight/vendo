# OKX AI: what works, what is missing, and what would move it

Field notes from building on OKX AI during the Dev Day 2026 build period. Everything below was
measured or reproduced, not inferred. Where something is a judgement call it says so.

Written to be useful to OKX, not to pitch at them.

---

## What the numbers say

Measured 17 September 2026 from OKX AI's own public pages.

**Task marketplace**

| | |
|---|---|
| Total volume | $9,357 |
| Total tasks | 79,129 |
| Completed | 76,037 |
| In progress | 245 |
| **Value per task** | **$0.12** |

**Agent directory**

| | |
|---|---|
| Listings visible | 21 |
| Total sales across them | ~3,545 |
| Top two listings | 1.49K and 1.22K sales, **76% of all sales** |
| Remaining nineteen | ~42 sales each |
| Offering anything free | 5 of 21 |
| Offering a subscription | 3 of 21 |
| Median starting price | ~0.05 USDT |

The rails work. Seventy-six thousand completed tasks is not a broken marketplace. But the economy
is $9,357, two listings carry three quarters of it, and one of those two is built by OKX's own
Blockchain Explorer team.

**The comparison that matters.** Coinbase's Agentic Market reports $54.4M volume across 27.1M
transactions, which is **$2.01 per transaction against OKX AI's $0.12**. Seventeen times the value.
Their sellers include Exa, Perplexity, CoinGecko, Alchemy, FlightAware, Amadeus and Wolfram. Real
API businesses.

**So the problem is not transactions. It is value per transaction.** The highest-volume listing on
OKX AI generates acrostic poetry from initials at 0.01 USDT. Nothing business-critical is being
bought, and the `FINANCE` and `SOFTWARE SERVICES` categories are nearly empty.

---

## Defects, with reproductions

### 1. The installer cannot run on Windows PowerShell 5.1

`npx -y @okxweb3/onchainos-installer install` fails with a cascade of parse errors:

```
install.ps1:322 Missing closing '}' in statement block or type definition.
install.ps1:302 Missing closing '}' in statement block or type definition.
install.ps1:487 The Try statement is missing its Catch or Finally block.
```

**Cause.** `lib/install.ps1` is UTF-8 **without a BOM** and contains em dashes in comments and
strings, starting on line 1. Windows PowerShell 5.1 reads a BOM-less file as ANSI, so `—` (E2 80 94)
becomes `â€"`. That stray double quote opens an unterminated string, which unbalances every block
after it.

**Fix.** Save the file as UTF-8 **with** a BOM, or replace the non-ASCII characters with ASCII.
Verified: prepending `EF BB BF` makes it parse cleanly and the install completes.

**Impact.** Every Windows builder on PowerShell 5.1, which is the Windows default, is blocked at
step one of ASP registration.

### 2. No stablecoin bridge route into X Layer

Through OKX's own cross-chain aggregator:

| From | Pair | Result |
|---|---|---|
| Base | USDC to USDT0, $50 | Insufficient liquidity |
| Ethereum | USDT to USDT, $50 | Insufficient liquidity |
| BSC | USDT to USDT, $100 and $1000 | No path |
| Arbitrum | USDC to USDT, $50 | Insufficient liquidity |
| Polygon | USDT to USDT, $50 | No path |

Five bridges list X Layer as a destination (Gas Zip, meson, ButterSwap, Stargate V2 OFT Mode,
relay), but none quotes a usable route for a stablecoin at any amount tried.

**Impact.** A new buyer cannot fund an X Layer wallet by bridging. The only route is buying on the
OKX exchange and withdrawing on the X Layer network. That is a cold-start tax on the first
transaction of every new buyer, and first transactions are exactly what the marketplace needs.

### 3. The A2MCP guide and the official mock merchant disagree

The A2MCP guide states that a v2 challenge must be base64 encoded into the `PAYMENT-REQUIRED`
response header, and that the header is what listing review validates.

`https://www.okx.com/api/v1/pay/mock-merchant/resource` returns 402 with:

- the challenge in the **response body**, no `PAYMENT-REQUIRED` header at all
- `maxAmountRequired` rather than `amount`
- `resource` as a string path rather than an object
- `USDC_TEST` rather than USD₮0
- a second `aggr_deferred` scheme alongside `exact`

**Impact.** An implementer following the reference merchant fails review; one following the guide
cannot read the reference merchant. Both dialects exist in the wild, so anything consuming x402
must handle both.

### 4. Listings cannot be discovered programmatically

The marketplace page calls:

```
GET https://www.okx.com/priapi/v2/wallet/agentic/agent/list?onlineStatus=1&pageNo=1&pageSize=20
```

From any client outside the site it returns:

```json
{"msg":"incorrect request sign parameters","code":50113}
```

No public or documented search endpoint exists.

**Impact.** This is the deepest gap. OKX AI supports Claude Code, OpenClaw, Hermes and Codex as
agent clients, but an agent in any of them cannot search the marketplace. A human must browse and
paste. An agent-native marketplace where agents cannot see the catalogue is missing its own premise.

### 5. Listing review rejects without a pre-flight check

A first submission was rejected with:

> the x402 challenge specifies an incorrect payment blockchain: payment should be received on
> X Layer, but the configuration is ChainID: eip155:1952

Correct and fair, but only discoverable after submitting and waiting. There is no self-check that
tells a seller their endpoint will fail before a review cycle is spent.

**Impact.** Avoidable review cycles, and a poor first experience for exactly the builders the
marketplace is trying to attract.

---

## What would move the number

The bottleneck is not supply of listings, and it is not the rails. It is that nothing
business-critical is being bought.

### Open a public listing search API

Fixes defect 4 and unlocks agent-native demand. Until an agent can ask "what can answer this and
what does it cost", every purchase needs a human in the loop, which caps the economy at human
browsing speed.

### Fix the funding on-ramp

Fixes defect 2. Every buyer's first transaction is currently gated on holding an OKX exchange
account and knowing to withdraw over X Layer. Bridge liquidity, or a fiat-to-X-Layer path, converts
first-time buyers.

### Reward business-critical categories, not volume

`FINANCE` and `SOFTWARE SERVICES` are nearly empty while novelty generation carries the volume.
The Genesis hackathon's Revenue Rocket track went unawarded because nobody met the revenue bar.
Volume incentives produced 0.01 poetry. Value incentives would produce compliance checks,
diligence, and data businesses actually pay for.

### Encourage free tiers and composition

Only 5 of 21 listings offer anything free, so an agent must pay before it can evaluate. And every
listing is single-purpose, while the marketplace with seventeen times the value per transaction
sells composed outcomes at one price. Both are norms, not features, and norms are set early.

---

## What Vendo contributes

- **A free endpoint validator** at `/vendo/validate`, checking an A2MCP endpoint against the listing
  rules before submission: HTTPS, 402 when unpaid, a base64 `PAYMENT-REQUIRED` header, x402Version
  2, the exact scheme, the correct X Layer chain, the USDT0 asset, a valid `payTo`, an amount in
  minor units, and a settlement window. Every failure carries the fix. Built after defect 5 cost us
  a review cycle.
- **An x402 dialect reader** that accepts both the header and body forms and normalises field names,
  so services built against either dialect are usable.
- **Signed delivery receipts** over the request hash, response hash, price, payer and transaction,
  verifiable by anyone against a published key, plus per-store uptime and repeat-buyer data. This is
  the evidence Evaluators are told to go and find, and it does not currently exist anywhere else.
- **An import path** that re-exposes an endpoint already speaking x402 elsewhere as an X Layer
  listing, so supply that exists on other chains can reach OKX AI without its owners re-plumbing
  payments.

Reproductions for every defect above are available on request.
