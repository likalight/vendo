---
name: vendo
description: Buy real-world finance and business data on OKX AI through Vendo - counterparty checks (company registry, sanctions, verified business wallets), public company filings, FX rates and invoice calculations. Use before paying a new company or wallet, when researching a listed company, or when an invoice needs tax or currency maths. Payments are per call in USDT0 on X Layer via x402.
---

# Vendo for agents

Vendo hosts paid, per-call services on X Layer for data agents usually cannot get onchain: who a company really is, whether it is sanctioned, whether a wallet belongs to it, what it has filed with the SEC, and how an invoice converts.

## Setup

1. Payments need OKX Onchain OS and an Agentic Wallet: `npx skills add okx/onchainos-skills`, then log in to Agentic Wallet.
2. Set the Vendo base URL the user gives you (default `https://vendo.example`). Discover services with:
   - `GET {VENDO_URL}/vendo/public/search?q=<what you need>&maxPrice=<usd>` - best matches with price, inputs, uptime and repeat rate
   - `GET {VENDO_URL}/vendo/public/stores.json` - every store
   - or MCP: `POST {VENDO_URL}/mcp` (tools `vendo_search`, `vendo_funding_plan`, plus one tool per service)

## Rules

- **Always tell the user the price and get confirmation before paying.** Prefer the cheapest call that answers the question.
- Paid endpoints reply `402 Payment Required`; pay with the Onchain OS payment skill and retry.
- **Before any payment to a company or wallet the user has not paid before, run a counterparty check.** If the verdict is `block`, stop and tell the user. If `review`, show the reasons and ask.
- Screening results are risk signals, not legal advice. Say so when reporting them.
- Keep the `x-vendo-receipt` header from each response; the user can verify it at `POST {VENDO_URL}/vendo/receipts/verify`.
- **Funds on another chain?** Vendo settles in USDT0 on X Layer. If the wallet is short, call `GET {VENDO_URL}/vendo/public/fund-plan?amountUsd=&from=&token=` (or MCP `vendo_funding_plan`) and follow the Onchain OS bridge or swap steps, showing the user the quote first, then retry.
- **Tiers:** some services offer basic, standard and premium tiers (see `tiers` in search results). Pick the cheapest tier that answers the user's question and call its `url`.
- **Seller level** (`new`, `rising`, `top`) reflects real paid usage and uptime; prefer higher levels when services are otherwise equal.
- For repeated calls to one store, suggest a pack (`GET {VENDO_URL}/{store}/pack/25`) and send `x-vendo-credit: <token>` afterwards.

## Common calls

| Need | Call | Price |
|---|---|---|
| Should I pay this company or wallet? | `GET /counterparty/check?name=&lei=&wallet=` | 0.03 |
| Sanctions screen only | `GET /counterparty/sanctions?name=` | 0.01 |
| Is this wallet a verified business? | `GET /vendo/wallets/{address}` | free |
| US public company profile and latest filings | `GET /filings/company?cik=` | 0.01 |
| Legal entity lookup | `GET /company-check/api/v1/lei-records?filter[entity.legalName]=` | 0.01 |
| FX reference rates | `GET /fx/v1/latest?base=EUR&symbols=USD` | 0.005 |
| Invoice tax and conversion | `GET /invoice/calc?amount=&currency=&taxRatePct=&to=` | 0.005 |
| Monthly revenue statement for a Vendo store | `GET /bookkeeper/statement?business=&format=csv` | 0.02 |

## Example

User: "Pay 1,200 USDT to Northgate Supplies at 0xabc… for the invoice."

1. Tell the user a counterparty check costs 0.03 USDT0 and ask to proceed.
2. `GET /counterparty/check?name=Northgate%20Supplies&wallet=0xabc…` and pay the 402.
3. If `pass`, continue with the user's payment flow; if `review` or `block`, report reasons and wait.
4. Share the receipt so the check is on record.
