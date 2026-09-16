/**
 * Website-to-Agent: turn one owner-approved form on the owner's own website into a paid, agent-callable service.
 * Safety: domain ownership verification, public-internet-only targets (SSRF guard), timeouts and size limits.
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Business } from "./businesses.js";

export type WebFormField = { name: string; label: string; type: string; required: boolean; options?: string[] };
export type WebForm = { pageUrl: string; action: string; method: "GET" | "POST"; fields: WebFormField[] };

const MAX_BYTES = 400_000;
const TIMEOUT_MS = 8_000;

function isPrivate(ip: string) {
  if (isIP(ip) === 6) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80") || ip.startsWith("::ffff:127.");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export async function assertPublicHttps(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Only https pages are supported");
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw new Error("That address is not on the public internet");
  return u;
}

async function fetchText(url: string, init: RequestInit = {}) {
  await assertPublicHttps(url);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual", headers: { "user-agent": "VendoAgent/0.2 (+https://vendo)", ...(init.headers ?? {}) } });
    const buf = new Uint8Array(await res.arrayBuffer()).slice(0, MAX_BYTES);
    return { status: res.status, type: res.headers.get("content-type") ?? "", text: new TextDecoder().decode(buf) };
  } finally { clearTimeout(t); }
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Find forms on a page and describe their fields. */
export async function inspectPage(pageUrl: string): Promise<{ title: string; forms: WebForm[] }> {
  const page = await fetchText(pageUrl);
  const html = page.text;
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const forms: WebForm[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const open = m[1], body = m[2];
    const method = (attr(open, "method") ?? "GET").toUpperCase() === "POST" ? "POST" : "GET";
    const action = new URL(attr(open, "action") ?? pageUrl, pageUrl).toString();
    const labels = new Map<string, string>();
    for (const l of body.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) { const f = attr(l[1], "for"); if (f) labels.set(f, strip(l[2])); }
    const fields: WebFormField[] = [];
    for (const i of body.matchAll(/<(input|select|textarea)\b([^>]*)>(?:([\s\S]*?)<\/(?:select|textarea)>)?/gi)) {
      const kind = i[1].toLowerCase(), a = i[2];
      const name = attr(a, "name"); if (!name) continue;
      const type = kind === "input" ? (attr(a, "type") ?? "text").toLowerCase() : kind;
      if (["hidden", "submit", "button", "password", "file", "image", "reset"].includes(type)) continue;
      const id = attr(a, "id");
      const options = kind === "select" ? [...(i[3] ?? "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((o) => attr(o[1], "value") ?? strip(o[2])) : undefined;
      fields.push({ name, type, required: /\brequired\b/i.test(a), label: (id && labels.get(id)) || attr(a, "placeholder") || attr(a, "aria-label") || name, options });
    }
    if (fields.length) forms.push({ pageUrl, action, method, fields });
  }
  return { title, forms };
}

/** Ownership token the business places on its site. */
export function verificationToken(storeId: string, host: string) {
  const secret = process.env.MPPX_SECRET_KEY ?? "vendo";
  return "vendo-" + createHash("sha256").update(`${storeId}:${host}:${secret}`).digest("hex").slice(0, 24);
}

export async function verifyOwnership(storeId: string, pageUrl: string) {
  const u = await assertPublicHttps(pageUrl);
  const token = verificationToken(storeId, u.host);
  const wellKnown = await fetchText(`${u.origin}/.well-known/vendo-verify.txt`).catch(() => null);
  if (wellKnown && wellKnown.status === 200 && wellKnown.text.includes(token)) return { verified: true, method: "well-known", token };
  const page = await fetchText(pageUrl).catch(() => null);
  if (page && new RegExp(`<meta[^>]+name=["']vendo-verify["'][^>]+content=["']${token}["']`, "i").test(page.text)) return { verified: true, method: "meta", token };
  return { verified: false, token, howTo: [`Add <meta name="vendo-verify" content="${token}"> to ${pageUrl}`, `or serve ${token} at ${u.origin}/.well-known/vendo-verify.txt`] };
}

/** Build a store definition that sells one form as a paid route. */
export function formToBusiness(input: { id: string; title: string; description: string; payTo?: string; priceUsd: number; form: WebForm }): Business {
  return {
    id: input.id, title: input.title, description: input.description, baseUrl: new URL(input.form.pageUrl).origin,
    payTo: input.payTo, licence: "Owner-verified website form listed with the owner's permission.", ownerApproved: true, local: true,
    webForm: input.form,
    routes: [{
      method: "GET", path: "/submit", priceUsd: input.priceUsd, summary: `Submit: ${input.title}`,
      params: input.form.fields.map((f) => ({ name: f.name, in: "query" as const, required: f.required, description: f.label + (f.options?.length ? ` (one of: ${f.options.slice(0, 8).join(", ")})` : ""), example: f.options?.[0] })),
      sampleRequest: "/submit?" + input.form.fields.map((f) => `${encodeURIComponent(f.name)}=${encodeURIComponent(f.options?.[0] ?? "example")}`).join("&"),
      sampleResponseNote: "JSON with the page title and readable text of the business's response",
    }],
  } as Business;
}

/** Paid call: submit the form on behalf of the agent and return a readable result. */
export async function submitForm(form: WebForm, values: Record<string, string>) {
  const missing = form.fields.filter((f) => f.required && !values[f.name]).map((f) => f.name);
  if (missing.length) return { status: 400, body: { error: "Missing required fields", missing } };
  const data = new URLSearchParams();
  for (const f of form.fields) if (values[f.name] != null) data.set(f.name, String(values[f.name]).slice(0, 500));
  const res = form.method === "GET"
    ? await fetchText(`${form.action}${form.action.includes("?") ? "&" : "?"}${data}`)
    : await fetchText(form.action, { method: "POST", body: data, headers: { "content-type": "application/x-www-form-urlencoded" } });
  const title = strip(res.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  return { status: res.status >= 400 ? 502 : 200, body: { upstreamStatus: res.status, title, text: strip(res.text).slice(0, 4000) } };
}
