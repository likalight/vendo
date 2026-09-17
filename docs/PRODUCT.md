# Vendo

**The business account for an agent-native company.**

OKX AI's own thesis is OPC: one person, one company. A company needs four things, and Vendo is
where a business does all four without leaving OKX AI.

| | | Status |
|---|---|---|
| **Sell** | Your API, your website form, or your expertise becomes a service agents can buy | Built, listed |
| **Earn** | Paid per call in USDT0 on X Layer, straight to your wallet, with signed receipts and books | Built, proven onchain |
| **Invest** | Revenue that is sitting idle goes to work on X Layer instead of waiting in a wallet | Contract built, not deployed, no adapter, unaudited |
| **Hire** | Your agent buys from other agents, inside OKX AI | Partly built, partly blocked |

Sell and Earn are the product today. Invest and Hire are what make it a company rather than a
payment endpoint.

---

## Sell

Three ways in, because the constraint is what a business already has, not how technical it is.

- **Has an API.** Import an OpenAPI file or add routes by hand. Upstream credentials are encrypted
  at rest and injected only on a paid call.
- **Has only a website.** Point Vendo at a quote or booking form. Domain ownership is proven with a
  meta tag or a file before anything is listed.
- **Has expertise, not an interface.** That is negotiated, custom work, which belongs in OKX AI's
  own task market. Vendo writes the brief and hands it over rather than competing with it.

Every route gets a price, up to three tiers, optional prepaid packs, an OpenAPI file, MCP tool
definitions and an `llms.txt` entry. Registration on OKX AI is one prompt Vendo generates.

**Proven:** the World Bank's public API became a listed, priced, receipt-issuing service in one
command. Nothing changed on their end.

## Earn

Payment is x402 on X Layer, settled by the OKX Payment SDK. The buyer pays the seller's wallet
directly. For self-listed stores Vendo never holds the money.

Every paid response carries an Ed25519 delivery receipt over the request hash, response hash,
price, payer and transaction. Anyone can verify it against a published key. Sales are recorded with
the payer address and the settlement transaction, which is what turns raw calls into repeat-buyer
statistics, uptime and a seller level.

**Proven:** real payments on X Layer, money moved between two wallets, receipts verified,
tampering detected.

## Invest

Revenue that sits in a wallet is doing nothing. `VendoVault.sol` is a business-owned vault where
automation can sweep idle cash above a buffer into an approved venue, pay approved payees within
caps and a daily limit, pause, and tighten limits. It can never pay an unapproved address, never
loosen a limit, and the owner can always withdraw.

`IVenue` is the adapter interface a real yield venue plugs into. Its three functions map almost
exactly onto Aave, which went live on X Layer on 30 March 2026 and accepts USDT0 supply.

**Honest state, after an audit of the code rather than the intent:**

| | |
|---|---|
| Contract written and unit tested | Yes |
| Deployed to X Layer | **No** |
| `VAULT_ADDRESS` / `OPERATOR_PRIVATE_KEY` configured | **No.** `treasuryMode()` returns `not-configured` |
| A venue adapter implementing `IVenue` | **No.** Only the interface and a test mock |
| Revenue reaching the vault | **No** |
| Audited | **No** |

The dashboard's treasury panel works today only in offline mode, where `simulateRevenue()` moves a
simulated balance. That function is guarded by `if (OFFLINE)` and does nothing in live mode.

**The missing link, and it is smaller than it looks.** The vault has no deposit function on purpose:
`idle()` is simply the vault's own token balance. So money arrives by ordinary ERC-20 transfer, and
x402 already pays a route's `payTo` address directly. **Setting `payTo` to the vault address makes
every paid call a deposit**, and the sweep and bill machinery starts operating on real revenue. That
is one configuration value, not new plumbing.

What genuinely remains: deploy the vault, write an Aave adapter against `IVenue`, wire the operator
key, and get the contract audited before it holds anything that matters.

**Where this goes.** X Layer is where OKX is building lending, stablecoins, RWAs and yield markets
together. A business earning USDT0 there is already positioned to hold tokenised assets rather than
only cash. That is the difference between getting paid and running a balance sheet, and it is the
reason Invest belongs in the product rather than in a nice-to-have list.

## Hire

A business that sells on OKX AI is also a buyer. Vendo gives its agent three ways to spend:

- **Ask.** One question in plain English. Vendo ranks its own services, fills in the parameters
  from the question, calls the winner, and returns the answer with what that service charges
  standalone. One price, one answer, instead of a catalogue to learn.
- **Assist.** A Chrome extension. Select text on any page, get a service that fits, pay from a
  capped wallet. Per-call and daily limits are enforced server side.
- **Hand off.** When no service fits, Vendo writes a complete OKX AI task brief with title,
  description, budget, deadline, matching mode and acceptance criteria, ready for the user's own
  agent to post. Negotiation and escrow stay with OKX.

**Blocked, and not by us:** routing to *other* agents on OKX AI needs a way to search its listings.
The marketplace's own endpoint requires request signing and refuses outside callers, and no public
search API is documented. Until that exists, Vendo can only route to services it knows about.

## Import

Vendo is a proxy with a paywall. What changes is what it points at, and one of the options is a
service that already sells somewhere else.

An endpoint already speaking x402 on another chain can be re-exposed as an X Layer listing: the
buyer pays Vendo in USDT0, Vendo pays the upstream in whatever it asks for, and the result comes
back as an ordinary service. Vendo never pays an upstream more than the buyer paid, and the
upstream cost, transaction and network are disclosed on the response.

This is not a separate product. It is how Vendo acquires inventory without waiting for businesses
to sign up, which matters because OKX AI's shortage is supply. Coinbase's marketplace reports
16,688 sellers; OKX AI shows roughly 21 listings.

Reselling someone else's paid service requires a stated basis, recorded and shown publicly. The
rule is that you list what you own or have permission to sell, and the import path enforces it
rather than trusting it.

---

## The honest position

Nine of ten listed services are Vendo's own. The onboarding path is proven, the import path is
proven, and neither has been used yet by a business that is not us.

So today Vendo is an Agent Service Provider that owns a working on-ramp. It becomes the business
account described above the moment a second business walks through it.
