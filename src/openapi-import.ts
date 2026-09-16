/** Import an OpenAPI document and propose sellable routes (Sell step: "paste your API docs"). */
import type { SellRoute } from "./businesses.js";
import { assertPublicHttps } from "./web-agent.js";

const SENSITIVE = /(admin|internal|auth|login|token|password|secret|user|account|delete|billing|webhook)/i;

export async function importOpenApi(specUrl: string, defaultPriceUsd = 0.01) {
  if (!/^https:\/\//.test(specUrl)) throw new Error("Spec URL must be https");
  await assertPublicHttps(specUrl);
  const res = await fetch(specUrl, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Could not fetch spec (${res.status})`);
  const spec: any = await res.json();
  const baseUrl: string = spec.servers?.[0]?.url ?? new URL(specUrl).origin;
  const proposed: (SellRoute & { recommended: boolean; note?: string })[] = [];
  for (const [path, ops] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of ["get", "post"]) {
      const op = ops?.[method];
      if (!op) continue;
      const params = [...(ops.parameters ?? []), ...(op.parameters ?? [])]
        .filter((p: any) => p && (p.in === "query" || p.in === "path"))
        .map((p: any) => ({ name: p.name, in: p.in, required: !!p.required, description: p.description ?? p.name,
          example: p.example ?? p.schema?.example ?? p.schema?.default }));
      const sensitive = SENSITIVE.test(path) || (op.security?.length ?? 0) > 0;
      const expressPath = path.replace(/\{(\w+)\}/g, ":$1");
      const sample = expressPath.replace(/:(\w+)/g, (_: string, n: string) => String(params.find((p: any) => p.name === n)?.example ?? `{${n}}`));
      const qs = params.filter((p: any) => p.in === "query" && p.example != null).map((p: any) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.example)}`).join("&");
      proposed.push({
        method: method.toUpperCase() as "GET" | "POST",
        path: expressPath,
        priceUsd: defaultPriceUsd,
        summary: op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
        params,
        sampleRequest: qs ? `${sample}?${qs}` : sample,
        sampleResponseNote: op.responses?.["200"]?.description ?? "JSON response",
        recommended: method === "get" && !sensitive,
        note: sensitive ? "Looks private or requires auth — kept off by default" : undefined,
      });
    }
  }
  return { title: spec.info?.title ?? "Imported API", description: spec.info?.description ?? "", baseUrl, routes: proposed };
}
