# Roadmap

Three bets, chosen because they address what OKX AI is visibly short of rather than what is fun
to build. Evidence for the diagnosis: the Genesis hackathon ran a $20,000 "Revenue Rocket" track
and awarded nothing, because no entrant met the revenue bar. OKX has listings. It does not yet
have transactions. Everything below attacks that.

Comparison point, measured 17 Sep 2026: Coinbase's Agentic Market reports $54.4M total payment
volume, 27.1M transactions over 30 days, and 20,249 buyers against 16,688 sellers, with real API
businesses selling (Exa, Perplexity, CoinGecko, Alchemy, FlightAware, Amadeus, Wolfram, Messari).
OKX AI shows roughly 21 live listings, mostly independent builders. The gap is supply.

---

## 1. Import existing x402 supply

**The bet.** Thousands of endpoints already speak x402 on other chains. They are not on X Layer
because listing there means re-plumbing payments. If Vendo can take an endpoint that already
speaks x402 elsewhere and re-expose it as an X Layer service, an entire working ecosystem becomes
listable on OKX AI without its owners doing the work.

**What already exists.** `src/proxy.ts` and the store registry forward a paid call to an upstream.
`src/assist.ts` already contains an x402 *client* that pays a challenge from a funded wallet, so
Vendo can act as a buyer, not only a seller. `src/secrets.ts` keeps upstream credentials
encrypted.

**What is missing.** Today Vendo assumes the upstream is an ordinary REST API. For an x402
upstream it has to pay before it can forward, which means:
- settling on the upstream's chain and asset, not only X Layer USDT0 (`src/network.ts` is
  currently X Layer only)
- pricing that covers the upstream cost plus a margin, and refusing the call when it would not
- surfacing the upstream payment on the receipt, so the buyer can see what was paid on their behalf

**Status: the mechanism is built and proven.** `src/upstream-x402.ts` pays an x402 upstream out of
what the buyer paid, refuses any call where the upstream costs more than was charged, and reports
the upstream cost, transaction and network back on `x-vendo-upstream-*` headers. Proven end to end
on X Layer testnet with two Vendo instances: buyer paid 0.020 USDT0, Vendo paid the upstream 0.010,
both settled onchain, result returned with a signed receipt.

**Still to do.** Paying on a chain other than X Layer needs a funded wallet there; the allow-list is
in `UPSTREAM_NETWORKS` but nothing is funded yet. And a route priced below its upstream currently
charges the buyer before the refusal is discovered, because the paywall settles before the handler
runs. The fix is to probe the upstream price at registration rather than on the first paid call.

**Risk.** Vendo starts holding float to pay upstreams. That contradicts "Vendo never holds funds"
unless the buyer's payment settles first and the upstream call is funded from it. Design that
ordering deliberately or the principle breaks.

---

## 2. Let buyers pay without pre-funding X Layer

**The bet.** Every purchase today requires the buyer to already hold USDT0 on X Layer. That is a
cold-start tax on the first transaction of every new buyer, and first transactions are exactly
what OKX is short of. MicroPay won a TOKEN2049 category prize for solving this shape of problem.

**What already exists.** `src/funding.ts` detects a short balance and returns a funding plan. The
Assist runner already falls back to it. The Onchain OS CLI ships a `cross-chain` bridge-swap
command.

**What is missing.** The plan is currently a set of prompts for a human or agent to follow.
Nothing executes. Turning it into an executed bridge means calling the Onchain OS cross-chain
route, waiting for settlement, then retrying the original paid call.

**Honest size.** One to two days. Smallest of the three and the best demo moment: a buyer with no
X Layer balance completes a purchase anyway.

**Risk.** Bridges fail and take time. The flow needs a clear pending state and a refusal path, not
an optimistic retry loop.

---

## 3. Serve the Evaluator role

**The bet.** OKX AI has three roles and almost nobody builds for the third. Evaluators stake at
least 100 OKB, are drawn five per dispute, decide by majority, and are slashed for voting with the
minority. The docs tell them to pull historical delivery data from providers to improve accuracy.

**What already exists.** The `trackrecord` service already returns exactly that evidence: paid
calls, success rate, uptime over 24h and 7d, repeat-buyer rate, seller level, and where to verify
a store's signed receipts.

**What is missing.** Everything on the evaluator side: the staked identity, an always-online
agent, and an evaluation Skill.

**Honest size.** Unknown, and gated on questions we have not answered. It needs real OKB staked,
and a dispute cannot be demonstrated alone because five evaluators are required for quorum.

**Why it is last.** An Evaluator has no listing and no service URL, so it cannot satisfy the Build
a Company minimum requirements on its own. The tractable version is what already exists: sell
evaluators the evidence they need rather than becoming one.

---

## Sequencing against the 25 September deadline

| When | Work |
|---|---|
| Now | Listing clears review. Nothing below matters until it does |
| Then | **Bet 2**, cross-chain buyer funding. Smallest, strongest demo beat |
| If time | **Bet 1**, one x402 upstream imported end to end |
| Record | Demo video, then submit |
| After | **Bet 3**, and multi-chain for bet 1 |

Bet 3 does not fit before the deadline and should not be forced into it. Three half-built bets
demo worse than one finished one.
