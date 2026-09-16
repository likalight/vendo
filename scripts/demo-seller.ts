/**
 * Onboards a real third-party API as a Vendo seller, through the same public endpoint a
 * business owner would use from the dashboard. Nothing here is a built-in: the store is
 * created at runtime, so the demo shows the actual onboarding path.
 *
 * Source: World Bank Open Data (https://api.worldbank.org). Licensed CC BY 4.0, which permits
 * commercial use and redistribution with attribution. No API key, no rate-limit key needed.
 * Vendo is not affiliated with and not endorsed by the World Bank.
 *
 * Run:  npm run demo:seller
 *       VENDO_URL=https://your-domain VENDO_ADMIN_TOKEN=... npm run demo:seller
 */

const base = (process.env.VENDO_URL ?? "http://localhost:3100").replace(/\/$/, "");
const token = process.env.VENDO_ADMIN_TOKEN ?? "";
const payTo = process.env.DEMO_SELLER_PAY_TO ?? process.env.DEFAULT_PAY_TO ?? "0x0000000000000000000000000000000000000000";

const store = {
  id: "worldbank",
  title: "Country economic indicators (World Bank)",
  description:
    "Look up a country's economic indicators from World Bank Open Data: GDP, inflation, population and any other World Bank indicator code, as a time series or the most recent value. Useful for country risk, macro research and counterparty context.",
  baseUrl: "https://api.worldbank.org",
  payTo,
  listingModel: "self",
  ownerApproved: true,
  licence:
    "World Bank Open Data, licensed CC BY 4.0. Attribution: The World Bank. Data retrieved via the public World Bank API. Not endorsed by or affiliated with the World Bank.",
  routes: [
    {
      method: "GET",
      path: "/v2/country/:country/indicator/:indicator",
      priceUsd: 0.01,
      summary: "Economic indicator time series for a country",
      params: [
        { name: "country", in: "path", required: true, description: "ISO country code, or several separated by semicolons", example: "SG" },
        { name: "indicator", in: "path", required: true, description: "World Bank indicator code", example: "NY.GDP.MKTP.CD" },
        // The World Bank API returns XML unless format=json is passed, so callers must send it.
        { name: "format", in: "query", required: true, description: "Response format, use json", example: "json" },
        { name: "per_page", in: "query", description: "How many observations to return", example: "5" },
        { name: "mrnev", in: "query", description: "Set to 1 for the most recent non-empty value only", example: "1" },
      ],
      sampleRequest: "/v2/country/SG/indicator/NY.GDP.MKTP.CD?format=json&per_page=5",
      sampleResponseNote: "JSON array: paging metadata, then one object per year with country, date, indicator name and value",
    },
  ],
};

const headers: Record<string, string> = { "content-type": "application/json" };
if (token) headers["x-vendo-admin"] = token;

const r = await fetch(`${base}/vendo/api/businesses`, { method: "POST", headers, body: JSON.stringify(store) });
const body = await r.json().catch(() => ({}));

if (r.status === 201) {
  console.log(`Listed "${store.title}" as /${store.id}`);
  console.log(`  paid route   GET ${base}/${store.id}${store.routes[0].sampleRequest}`);
  console.log(`  price        ${store.routes[0].priceUsd} USDT0 per call`);
  console.log(`  agent kit    ${base}/vendo/kit/${store.id}/openapi.json`);
  console.log(`\nSelf check (should be 402 with a PAYMENT-REQUIRED header):`);
  console.log(`  curl -i "${base}/${store.id}${store.routes[0].sampleRequest}"`);
} else if (r.status === 409 || String((body as any).error ?? "").includes("exists")) {
  console.log(`"${store.id}" is already listed. Nothing to do.`);
} else {
  console.error(`Could not list the store (HTTP ${r.status}).`);
  console.error((body as any).errors ?? (body as any).error ?? body);
  process.exit(1);
}
