# Questions for OKX mentors

Ready to paste into the Dev Day Telegram. Each one has the evidence attached, so they can be
answered without a back-and-forth first.

---

**1. Which x402 challenge format does OKX AI listing review actually validate?**

The A2MCP guide says the v2 challenge must be base64-encoded into the `PAYMENT-REQUIRED` response
header, and that the header is what the marketplace validates rather than the body.

The official mock merchant at `https://www.okx.com/api/v1/pay/mock-merchant/resource` behaves
differently. It returns the challenge in the **body** with no `PAYMENT-REQUIRED` header, uses
`maxAmountRequired` rather than `amount`, `resource` as a string path rather than an object, and
`USDC_TEST` rather than USD₮0. It also advertises a second scheme, `aggr_deferred`.

We follow the A2MCP guide. Is the mock merchant an older variant, or does review accept either?

---

**2. Can agents search OKX AI listings programmatically?**

The marketplace web page calls
`GET https://www.okx.com/priapi/v2/wallet/agentic/agent/list?onlineStatus=1&pageNo=1&pageSize=20`.
Called from a server it returns `{"msg":"incorrect request sign parameters","code":50113}`, so it
is a signed private API.

Is there a public or partner endpoint for discovering listings? We want a buyer-side surface that
suggests relevant OKX AI services, and today the only compliant option is handing a task brief to
the user's own agent to post.

---

**3. Do MPP payment splits work for OKX AI listings?**

We would like to take a small fee on a seller's route without ever custodying their funds, using
MPP charge `splits`. A2MCP listings appear to use a single `payTo`. Is a split `payTo`
arrangement acceptable to listing review, or does the listed endpoint have to settle to exactly
one address?

---

**4. Can third-party uptime and receipt data feed OKX AI reputation?**

We issue an Ed25519-signed delivery receipt on every paid response, run uptime probes against
each listed store, and publish a per-store feed at `/vendo/public/stores.json`.

Is there a path for that data to inform an ASP's standing on OKX AI, or is reputation strictly
derived from on-platform task outcomes?

---

**5. Is the Evaluator role live and testable today?**

The docs describe staking at least 100 OKB, a five-evaluator quorum and majority rule, with
slashing for minority votes. Evaluators are told to pull historical delivery data from ASPs to
improve accuracy.

Two questions. Can a team test the evaluator flow during the build period without staking real
OKB? And is there an interface through which an evaluator's Skill can fetch an ASP's delivery
history, since that is the data we already produce?

---

**6. A2A and subscriptions**

Escrow Payment is listed as "coming soon" in the payment docs while A2A delivery already
describes escrow on X Layer with a one-day dispute window and a 5% bounty deposit. Are A2A
escrow and Subscription Payment both usable today, or is A2A currently limited to particular
partners?
