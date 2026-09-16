/**
 * Agent-ready kit (Rill-inspired): machine-readable descriptions for every service,
 * so agents and OKX AI listings can understand and call them.
 */
import type { Business } from "./businesses.js";
import { env } from "./env.js";

const priceLabel = (usd: number) => `${usd} USDT0 per call`;

export function llmsTxt(bs: Business[]) {
  const out = [`# Vendo services`, ``, `> Paid APIs for AI agents. Pay per call via HTTP 402 on X Layer (${env.network.caip2}).`, ``];
  for (const b of bs) {
    out.push(`## ${b.title}`, ``, b.description, ``);
    for (const r of b.routes) {
      out.push(`- ${r.method} ${env.publicUrl}/${b.id}${r.path} — ${r.summary}. ${priceLabel(r.priceUsd)}.`);
      out.push(`  Example: ${r.method} ${env.publicUrl}/${b.id}${r.sampleRequest}`);
      for (const tr of r.tiers ?? []) out.push(`  Tier ${tr.name} (${tr.priceUsd} USDT0): ${tr.includes}. ${r.method} ${env.publicUrl}/${b.id}/t/${tr.name}${r.path}`);
    }
    out.push(``, `Licence: ${b.licence}`, ``);
  }
  return out.join("\n");
}

export function openApi(b: Business) {
  const paths: Record<string, any> = {};
  for (const r of b.routes) {
    const oaPath = `/${b.id}${r.path.replace(/:(\w+)/g, "{$1}")}`;
    paths[oaPath] = {
      [r.method.toLowerCase()]: {
        summary: r.summary,
        description: `${r.summary}. Costs ${priceLabel(r.priceUsd)}. Without payment the server replies 402 with a payment challenge; pay and retry.`,
        parameters: r.params.map((p) => ({
          name: p.name, in: p.in, required: p.in === "path" ? true : !!p.required, description: p.description,
          schema: { type: "string" }, example: p.example,
        })),
        responses: {
          "200": { description: r.sampleResponseNote },
          "402": { description: "Payment required. Challenge in the payment header." },
        },
        "x-price": { amount: r.priceUsd, asset: "USDT0", network: env.network.caip2 },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: b.title, description: b.description, version: "1.0.0" },
    servers: [{ url: env.publicUrl }],
    paths,
  };
}

/** MCP-style tool definitions agents can load. */
export function mcpTools(b: Business) {
  return b.routes.map((r) => {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const p of r.params) {
      properties[p.name] = { type: "string", description: p.description, examples: p.example ? [p.example] : undefined };
      if (p.in === "path" || p.required) required.push(p.name);
    }
    const name = `${b.id}_${r.summary.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`.slice(0, 64).replace(/_+$/, "");
    return {
      name,
      description: `${r.summary}. ${b.description} Costs ${priceLabel(r.priceUsd)}, paid via x402 on X Layer.`,
      inputSchema: { type: "object", properties: r.tiers?.length ? { ...properties, tier: { type: "string", enum: r.tiers.map((x) => x.name), description: r.tiers.map((x) => `${x.name} ${x.priceUsd} USDT0: ${x.includes}`).join("; ") } } : properties, required },
      annotations: { readOnlyHint: true, endpoint: `${r.method} ${env.publicUrl}/${b.id}${r.path}` },
    };
  });
}
