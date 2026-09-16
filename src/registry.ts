import { db } from "./db.js";
import { businesses as seeds, type Business, type SellRoute } from "./businesses.js";
import { seal, open } from "./secrets.js";
import { localUpstreamAllowed } from "./web-agent.js";

const now = () => new Date().toISOString();

export function listBusinesses(): Business[] {
  return (db.prepare(`SELECT json FROM businesses ORDER BY created_at`).all() as { json: string }[]).map((r) => JSON.parse(r.json));
}
export function getBusiness(id: string): Business | undefined {
  const r = db.prepare(`SELECT json FROM businesses WHERE id = ?`).get(id) as { json: string } | undefined;
  return r ? JSON.parse(r.json) : undefined;
}
export function saveBusiness(b: Business) {
  const existing = getBusiness(b.id);
  db.prepare(
    `INSERT INTO businesses (id, json, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).run(b.id, JSON.stringify(b), existing ? now() : now(), now());
}
export function seedIfEmpty() {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM businesses`).get() as { n: number }).n;
  if (n === 0) seeds.forEach(saveBusiness);
}

const RESERVED = new Set(["vendo", "app", "proof", "health", "discover", "llms.txt"]);

export function validateBusiness(input: any): { ok: true; value: Business } | { ok: false; errors: string[] } {
  const e: string[] = [];
  const id = String(input?.id ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) e.push("id must be 2-41 lowercase letters, numbers or dashes");
  if (RESERVED.has(id)) e.push(`id "${id}" is reserved`);
  if (!input?.title) e.push("title is required");
  if (!input?.description || String(input.description).length < 20) e.push("description must be at least 20 characters");
  const baseUrlOk = (() => {
    const raw = String(input?.baseUrl ?? "");
    if (/^https:\/\//.test(raw)) return true;
    try { return localUpstreamAllowed(new URL(raw)); } catch { return false; }
  })();
  if (!input?.local && !baseUrlOk) e.push("baseUrl must be an https URL");
  if (input?.payTo && !/^0x[0-9a-fA-F]{40}$/.test(input.payTo)) e.push("payTo must be a 0x wallet address");
  const listingModel = input?.listingModel === "managed" ? "managed" : "self";
  if (!input?.local && listingModel === "self" && !input?.payTo) e.push("Self-listed stores need the business's own receiving wallet (payTo), the one used to register on OKX AI");
  const feeBps = Number(input?.feeBps ?? process.env.VENDO_FEE_BPS ?? 1000);
  if (listingModel === "managed" && !(feeBps >= 0 && feeBps <= 5000)) e.push("feeBps must be between 0 and 5000");
  const auth = input?.upstreamAuth;
  const authType = auth ? String(auth.type ?? "header") : null;
  if (auth) {
    if (!["header", "bearer", "query"].includes(authType!)) e.push("upstreamAuth.type must be header, bearer or query");
    if (!auth.value) e.push("upstreamAuth needs a value");
    if (authType === "header" && !/^[A-Za-z0-9-]{2,60}$/.test(String(auth.headerName ?? ""))) e.push("upstreamAuth needs a header name");
    if (authType === "query" && !/^[A-Za-z0-9_.-]{1,60}$/.test(String(auth.paramName ?? ""))) e.push("upstreamAuth needs a query parameter name");
  }
  if (input?.upstreamX402 != null && typeof input.upstreamX402 !== "boolean") e.push("upstreamX402 must be true or false");
  if (input?.ownerApproved !== true) e.push("the business owner must approve listing (ownerApproved: true)");
  const routes: SellRoute[] = Array.isArray(input?.routes) ? input.routes : [];
  if (!routes.length) e.push("at least one route is required");
  routes.forEach((r, i) => {
    if (!["GET", "POST"].includes(r.method)) e.push(`route ${i + 1}: method must be GET or POST`);
    if (!String(r.path ?? "").startsWith("/")) e.push(`route ${i + 1}: path must start with /`);
    if (!(Number(r.priceUsd) > 0 && Number(r.priceUsd) <= 100)) e.push(`route ${i + 1}: priceUsd must be between 0 and 100`);
    if (!r.summary) e.push(`route ${i + 1}: summary is required`);
    r.params = Array.isArray(r.params) ? r.params : [];
    if (r.tiers != null) {
      if (!Array.isArray(r.tiers) || r.tiers.length > 3) e.push(`route ${i + 1}: up to 3 tiers`);
      const seen = new Set<string>();
      (r.tiers ?? []).forEach((tr: any) => {
        if (!["basic", "standard", "premium"].includes(tr?.name)) e.push(`route ${i + 1}: tier name must be basic, standard or premium`);
        if (seen.has(tr?.name)) e.push(`route ${i + 1}: duplicate tier ${tr?.name}`); seen.add(tr?.name);
        if (!(Number(tr?.priceUsd) > 0 && Number(tr?.priceUsd) <= 100)) e.push(`route ${i + 1}: tier ${tr?.name} needs a price between 0 and 100`);
        if (!tr?.includes || String(tr.includes).length > 140) e.push(`route ${i + 1}: tier ${tr?.name} needs a short description of what it includes`);
      });
      if (!r.tiers?.length) delete r.tiers;
    }
    r.sampleRequest = r.sampleRequest || r.path;
    r.sampleResponseNote = r.sampleResponseNote || "JSON response";
  });
  if (e.length) return { ok: false, errors: e };
  return {
    ok: true,
    value: {
      id, title: String(input.title), description: String(input.description), baseUrl: String(input.baseUrl ?? ""),
      payTo: input.payTo || undefined, licence: String(input.licence ?? "Listed with the owner's permission."),
      headers: input.headers, routes, local: !!input.local, ownerApproved: true, webForm: input.webForm,
      upstreamX402: !!input.upstreamX402,
      listingModel, feeBps: listingModel === "managed" ? feeBps : undefined,
      secretHeaders: auth ? seal(authType === "query"
        ? { __query: JSON.stringify({ [String(auth.paramName)]: String(auth.value) }) }
        : authType === "bearer" ? { Authorization: `Bearer ${String(auth.value)}` } : { [String(auth.headerName)]: String(auth.value) }) : input.secretHeaders,
      status: input.status === "paused" ? "paused" : "active",
      listing: input.listing ?? { status: "not_registered" },
    } as Business,
  };
}

export function matchRoute(b: Business, method: string, pathOnly: string) {
  const a = pathOnly.split("/").filter(Boolean);
  return b.routes.find((r) => {
    if (r.method !== method) return false;
    const p = r.path.split("/").filter(Boolean);
    return p.length === a.length && p.every((seg, i) => seg.startsWith(":") || seg === a[i]);
  });
}

/** Safe to return from the API: no credentials. */
export function publicView(b: Business) {
  const { secretHeaders, ...rest } = b;
  return { ...rest, hasUpstreamAuth: !!secretHeaders };
}

/** Headers sent to the business's own API: public headers plus decrypted credentials. */
export function upstreamHeaders(b: Business): Record<string, string> {
  const { __query, ...h } = open(b.secretHeaders);
  return { ...(b.headers ?? {}), ...h };
}

/** Query-string credentials (e.g. ?api_key=) appended only when forwarding a paid call. */
export function upstreamQuery(b: Business): Record<string, string> {
  const { __query } = open(b.secretHeaders);
  return __query ? JSON.parse(__query) : {};
}

export function setStatus(id: string, status: "active" | "paused") {
  const b = getBusiness(id); if (!b) return null;
  b.status = status; saveBusiness(b); return b;
}

export function deleteBusiness(id: string) {
  return db.prepare(`DELETE FROM businesses WHERE id = ?`).run(id).changes === 1;
}

/** Update editable fields; credentials are kept unless new ones are supplied. */
export function updateBusiness(id: string, patch: any) {
  const b = getBusiness(id); if (!b) return { ok: false as const, errors: ["unknown business"] };
  const merged = { ...b, ...patch, id, ownerApproved: true, local: b.local, webForm: b.webForm, listing: b.listing, secretHeaders: b.secretHeaders };
  if (b.local && !merged.baseUrl) merged.baseUrl = "";
  const v = validateBusiness({ ...merged, local: b.local || undefined, payTo: merged.payTo ?? (b.listingModel === "managed" ? undefined : b.payTo) });
  if (!v.ok) return v;
  v.value.local = b.local; v.value.webForm = b.webForm;
  saveBusiness(v.value);
  return v;
}

export function updateListing(id: string, patch: { status?: string; agentId?: string; listingUrl?: string }) {
  const b = getBusiness(id);
  if (!b) return null;
  const allowed = ["not_registered", "pending_review", "live"];
  const status = allowed.includes(String(patch.status)) ? (patch.status as any) : b.listing?.status ?? "not_registered";
  if (patch.listingUrl && !/^https:\/\//.test(patch.listingUrl)) throw new Error("listingUrl must be an https link");
  b.listing = { status, agentId: patch.agentId?.slice(0, 64) || b.listing?.agentId, listingUrl: patch.listingUrl || b.listing?.listingUrl, updatedAt: new Date().toISOString() };
  saveBusiness(b);
  return b;
}

/** Resolve a request path to a route and optional tier: /check or /t/premium/check. */
export function resolveRoute(b: Business, method: string, rest: string) {
  const tm = rest.match(/^\/t\/(basic|standard|premium)(\/.*)$/);
  const path = tm ? tm[2] : rest;
  const route = matchRoute(b, method, path);
  if (!route) return null;
  const tier = tm ? route.tiers?.find((x) => x.name === tm[1]) : undefined;
  if (tm && !tier) return null;
  return { route, tier, path, price: tier ? tier.priceUsd : route.priceUsd };
}
