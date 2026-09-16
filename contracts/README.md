# VendoVault

Business-owned vault for agent revenue on X Layer.

| Role | Can do | Cannot do |
|---|---|---|
| Owner (business) | Everything: set operator, buffer, daily limit, approve venues and payees, unpause, withdraw anytime | - |
| Operator (Vendo automation) | Sweep idle cash above the buffer into approved venues, recall, pay approved payees within caps and daily limit, pause, lower caps and limits | Pay unapproved addresses, raise limits, unpause, withdraw |

`IVenue` is the adapter interface for yield venues (deposit, withdraw, balanceOf). A USDG adapter must be written against the confirmed USDG contract on X Layer.

```bash
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std   # first time only
# foundry.toml points solc at a local path; remove that line to let forge pick solc 0.8.26 itself
forge test -vv
```

Unaudited hackathon code. Testnet and small amounts only.
