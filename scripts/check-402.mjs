// Cross-platform self-check from the OKX A2MCP guide: paid endpoints without payment must return HTTP 402.
const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const paths = ["/fx/v1/latest?base=EUR&symbols=USD", "/counterparty/sanctions?name=Example"];
let ok = true;
for (const p of paths) {
  const r = await fetch(base + p).catch((e) => ({ status: `error: ${e.message}`, headers: new Headers() }));
  const header = r.headers.get?.("payment-required") ? " + PAYMENT-REQUIRED header" : "";
  console.log(`${r.status}${header}  ${base}${p}`);
  if (r.status !== 402) { ok = false; console.log("  ^ expected 402 (payment required)"); }
}
process.exit(ok ? 0 : 1);
