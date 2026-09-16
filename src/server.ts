// Node < 23 lacks the global URLPattern that the OKX/mppx proxy router uses.
import "urlpattern-polyfill";
import { createServer } from "node:http";
import { env } from "./env.js";
import { proxy } from "./proxy.js";
import { listBusinesses } from "./registry.js";
const businesses = listBusinesses();
import { llmsTxt, openApi, mcpTools } from "./kit.js";
import { listSales, statement, statementCsv } from "./ledger.js";

function send(res: import("node:http").ServerResponse, status: number, body: string, type = "application/json") {
  res.writeHead(status, { "content-type": `${type}; charset=utf-8`, "access-control-allow-origin": "*" });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", env.publicUrl);
  const p = url.pathname;

  // Vendo's own endpoints (free): agent-ready kit, ledger, statements, health
  if (p === "/health") return send(res, 200, JSON.stringify({ ok: true, network: env.networkName }));
  if (p === "/vendo/llms.txt") return send(res, 200, llmsTxt(businesses), "text/plain");
  const kit = p.match(/^\/vendo\/kit\/([\w-]+)\/(openapi\.json|mcp\.json)$/);
  if (kit) {
    const b = businesses.find((x) => x.id === kit[1]);
    if (!b) return send(res, 404, JSON.stringify({ error: "unknown business" }));
    return send(res, 200, JSON.stringify(kit[2] === "openapi.json" ? openApi(b) : { tools: mcpTools(b) }, null, 2));
  }
  if (p === "/vendo/sales") return send(res, 200, JSON.stringify(listSales(url.searchParams.get("business") ?? undefined), null, 2));
  if (p === "/vendo/statement") {
    const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
    if (url.searchParams.get("format") === "csv") return send(res, 200, statementCsv(month), "text/csv");
    return send(res, 200, JSON.stringify(statement(month), null, 2));
  }

  // Everything else: OKX reverse proxy (402 challenge -> pay -> forward to business API).
  // It also serves /llms.txt and /discover automatically.
  return (proxy as any).listener(req, res);
});

server.listen(env.port, () => {
  console.log(`Vendo running on ${env.publicUrl} (${env.networkName}, chain ${env.network.chainId})`);
  for (const b of businesses) for (const r of b.routes)
    console.log(`  ${r.method} ${env.publicUrl}/${b.id}${r.sampleRequest}  [${r.priceUsd} USDT0]`);
  console.log(`  Kit: ${env.publicUrl}/vendo/llms.txt · /vendo/kit/<id>/openapi.json · /vendo/kit/<id>/mcp.json`);
  console.log(`  Books: ${env.publicUrl}/vendo/statement?format=csv`);
});
