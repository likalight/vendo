/**
 * Vendo MCP server: one endpoint that exposes every Vendo store as MCP tools.
 * An agent installs Vendo once and can discover and call many real businesses.
 * Minimal JSON-RPC over HTTP (MCP Streamable HTTP, JSON responses only).
 * Paid tools return the payment request so the agent's wallet can pay and retry; tools never spend on their own.
 */
import type { Request, Response } from "express";
import { listBusinesses, getBusiness } from "./registry.js";
import { mcpTools } from "./kit.js";
import { env } from "./env.js";
import { searchServices } from "./search.js";
import { fundingPlan } from "./funding.js";

const PROTOCOL = "2025-06-18";

function toolIndex() {
  const map = new Map<string, { businessId: string; routeIndex: number }>();
  for (const b of listBusinesses()) mcpTools(b).forEach((t, i) => map.set(t.name, { businessId: b.id, routeIndex: i }));
  return map;
}

function rpc(id: any, result: any) { return { jsonrpc: "2.0", id, result }; }
function rpcErr(id: any, code: number, message: string) { return { jsonrpc: "2.0", id, error: { code, message } }; }

const META_TOOLS = [
  { name: "vendo_search", description: "Search all Vendo services by what you need (free). Returns services with price per call, inputs, uptime and repeat rate.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "What you need, e.g. 'sanctions check' or 'SEC filings'" }, maxPriceUsd: { type: "number" } }, required: ["query"] }, annotations: { readOnlyHint: true } },
  { name: "vendo_funding_plan", description: "Free. If your USDT0 on X Layer is short, get steps to bridge or swap from another chain with Onchain OS before paying.",
    inputSchema: { type: "object", properties: { amountUsd: { type: "number" }, fromChain: { type: "string" }, fromToken: { type: "string" } }, required: ["amountUsd"] }, annotations: { readOnlyHint: true } },
];

async function callTool(name: string, args: Record<string, unknown>, paymentHeaders: Record<string, string>) {
  if (name === "vendo_search") { const r = searchServices(String(args.query ?? ""), { maxPriceUsd: args.maxPriceUsd as number | undefined }); return { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r }; }
  if (name === "vendo_funding_plan") { const r = fundingPlan({ amountUsd: Number(args.amountUsd ?? 0), fromChain: args.fromChain as string, fromToken: args.fromToken as string }); return { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r }; }
  const hit = toolIndex().get(name);
  if (!hit) return { isError: true, content: [{ type: "text", text: `Unknown tool ${name}` }] };
  const b = getBusiness(hit.businessId)!;
  const r = b.routes[hit.routeIndex];
  const tierName = args.tier ? String(args.tier) : "";
  if (tierName && !r.tiers?.some((x) => x.name === tierName)) return { isError: true, content: [{ type: "text", text: `Unknown tier ${tierName}. Options: ${(r.tiers ?? []).map((x) => x.name).join(", ") || "none"}` }] };
  let path = r.path;
  const qs = new URLSearchParams();
  for (const p of r.params) {
    const v = args[p.name];
    if (v == null || v === "") { if (p.in === "path" || p.required) return { isError: true, content: [{ type: "text", text: `Missing required input: ${p.name}` }] }; continue; }
    if (p.in === "path") path = path.replace(`:${p.name}`, encodeURIComponent(String(v))); else qs.set(p.name, String(v));
  }
  const url = `${env.publicUrl}/${b.id}${tierName ? `/t/${tierName}` : ""}${path}${qs.toString() ? `?${qs}` : ""}`;
  const price = tierName ? r.tiers!.find((x) => x.name === tierName)!.priceUsd : r.priceUsd;
  const res = await fetch(url, { method: r.method, headers: paymentHeaders });
  const text = await res.text();
  if (res.status === 402) {
    return {
      isError: true,
      content: [{ type: "text", text: `Payment required: ${price} USDT0 on X Layer. Pay with your x402 wallet and retry the URL, or pass the payment signature header to this tool.` }],
      structuredContent: { paymentRequired: true, url, priceUsd: price, network: env.network.caip2, challengeHeader: res.headers.get("payment-required"), body: safe(text),
        fundsOnAnotherChain: "Call vendo_funding_plan to bridge or swap into USDT0 on X Layer first." },
    };
  }
  return { isError: res.status >= 400, content: [{ type: "text", text: text.slice(0, 20000) }], structuredContent: { status: res.status, url, body: safe(text) } };
}

const safe = (s: string) => { try { return JSON.parse(s); } catch { return s; } };

export async function handleMcp(req: Request, res: Response) {
  const msg = req.body;
  const batch = Array.isArray(msg) ? msg : [msg];
  const pay: Record<string, string> = {};
  for (const h of ["payment-signature", "x-payment", "x-vendo-demo-paid"]) { const v = req.header(h); if (v) pay[h] = v; }
  const out: any[] = [];
  for (const m of batch) {
    if (!m || m.jsonrpc !== "2.0") { out.push(rpcErr(m?.id ?? null, -32600, "Invalid request")); continue; }
    if (m.id === undefined) continue; // notification
    switch (m.method) {
      case "initialize":
        out.push(rpc(m.id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: true } }, serverInfo: { name: "vendo", version: "0.5.0" },
          instructions: "Tools are real businesses selling services per call. Paid tools return a payment request (x402, USDT0 on X Layer); pay and retry." }));
        break;
      case "ping": out.push(rpc(m.id, {})); break;
      case "tools/list": out.push(rpc(m.id, { tools: [...META_TOOLS, ...listBusinesses().filter((b) => b.status !== "paused").flatMap((b) => mcpTools(b).map(({ annotations, ...t }) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: true } })))] })); break;
      case "tools/call": out.push(rpc(m.id, await callTool(String(m.params?.name ?? ""), m.params?.arguments ?? {}, pay))); break;
      default: out.push(rpcErr(m.id, -32601, `Method not found: ${m.method}`));
    }
  }
  if (!out.length) return res.status(202).end();
  res.json(Array.isArray(msg) ? out : out[0]);
}
