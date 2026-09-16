/**
 * Discovery: score a listing, run a find-test (would agents pick it?), and suggest fixes.
 * Uses an LLM when ANTHROPIC_API_KEY is set ("llm" mode), otherwise a transparent heuristic ("simulated" mode).
 */
import type { Business } from "./businesses.js";
import { listBusinesses } from "./registry.js";
import { askJson, llmEnabled } from "./llm.js";
import { db } from "./db.js";

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

export function score(b: Business) {
  const issues: { weight: number; issue: string; fix: string }[] = [];
  if (b.description.length < 80) issues.push({ weight: 15, issue: "Description is short", fix: "Say what it returns, for whom, and one concrete use case in 1-2 sentences." });
  if (!/\b(get|look up|lookup|convert|check|search|returns?|find)\b/i.test(b.description)) issues.push({ weight: 10, issue: "Description doesn't say what action it performs", fix: "Start with a verb agents search for, e.g. 'Look up', 'Convert', 'Check'." });
  for (const r of b.routes) {
    if (!r.params.length) issues.push({ weight: 8, issue: `${r.method} ${r.path} has no described inputs`, fix: "Describe every input with a name, meaning and example." });
    if (r.params.some((p) => !p.example)) issues.push({ weight: 7, issue: `${r.method} ${r.path} has inputs without examples`, fix: "Add an example value for each input." });
    if (!r.sampleRequest || r.sampleRequest === r.path) issues.push({ weight: 10, issue: `${r.method} ${r.path} has no example call`, fix: "Add a full example request with realistic values." });
    if (!r.sampleResponseNote || r.sampleResponseNote === "JSON response") issues.push({ weight: 10, issue: `${r.method} ${r.path} doesn't describe its output`, fix: "Describe the fields an agent will get back." });
  }
  const penalty = Math.min(90, issues.reduce((a, i) => a + i.weight, 0));
  return { score: 100 - penalty, issues };
}

type Pick = { agent: string; picked: string; reason: string };

export async function findTest(target: Business, task: string, agents = 5) {
  const candidates = listBusinesses().filter((b) => !b.local);
  if (!candidates.find((c) => c.id === target.id)) candidates.push(target);
  let mode: "llm" | "simulated" = "simulated";
  let picks: Pick[] = [];

  if (llmEnabled()) {
    const catalog = candidates.map((c) => ({ id: c.id, title: c.title, description: c.description,
      endpoints: c.routes.map((r) => ({ summary: r.summary, price: r.priceUsd, inputs: r.params.map((p) => p.name) })) }));
    const out = await askJson<{ picks: Pick[] }>(
      `You simulate ${agents} independent AI agents with different styles (cautious, cheapest-first, fastest, detail-oriented, generalist). Each must pick exactly one service id from the catalog for the task, or "none" if nothing fits.`,
      JSON.stringify({ task, catalog, output: { picks: [{ agent: "string", picked: "service id or none", reason: "short" }] } })
    );
    if (out?.picks?.length) { picks = out.picks.slice(0, agents); mode = "llm"; }
  }
  if (!picks.length) {
    const tw = new Set(words(task));
    const rank = (c: Business) => {
      const text = [c.title, c.description, ...c.routes.flatMap((r) => [r.summary, ...r.params.map((p) => p.description)])].join(" ");
      const overlap = words(text).filter((w) => tw.has(w)).length;
      return overlap * 10 + score(c).score / 10;
    };
    const ranked = candidates.map((c) => ({ c, s: rank(c) })).sort((a, b) => b.s - a.s);
    const styles = ["cautious", "cheapest-first", "fastest", "detail-oriented", "generalist"];
    picks = styles.slice(0, agents).map((agent, i) => {
      // Agents lean on listing quality differently: low-quality listings lose the pickier agents.
      const top = ranked[0];
      const quality = score(top.c).score;
      const picky = i / (agents - 1 || 1);
      const picked = top.s > 0 && quality >= 40 + picky * 45 ? top.c.id : "none";
      return { agent, picked, reason: picked === "none" ? "Listing unclear for this task" : "Best keyword and quality match" };
    });
  }
  const chosen = picks.filter((p) => p.picked === target.id).length;
  const result = { business: target.id, task, mode, agents: picks.length, chosen, picks, ...score(target), at: new Date().toISOString() };
  db.prepare(`INSERT INTO discovery_runs (at, business_id, json) VALUES (?, ?, ?)`).run(result.at, target.id, JSON.stringify(result));
  return result;
}

/** Suggest an improved listing. LLM rewrite if available, otherwise templated fixes. */
export async function suggestFixes(b: Business) {
  if (llmEnabled()) {
    const out = await askJson<{ description: string; routes: { path: string; summary: string; sampleResponseNote: string }[] }>(
      "You improve API marketplace listings so AI agents understand and choose them. Keep facts accurate; do not invent capabilities.",
      JSON.stringify({ listing: b, output: { description: "1-2 sentences starting with a verb", routes: [{ path: "same path", summary: "clear", sampleResponseNote: "fields returned" }] } })
    );
    if (out?.description) return { mode: "llm", ...out };
  }
  return {
    mode: "template",
    description: b.description.match(/^(Look up|Convert|Check|Get|Search)/) ? b.description : `Look up ${b.title.toLowerCase()}: ${b.description}`,
    routes: b.routes.map((r) => ({ path: r.path, summary: r.summary, sampleResponseNote: r.sampleResponseNote === "JSON response" ? `JSON with the result of: ${r.summary.toLowerCase()}` : r.sampleResponseNote })),
  };
}

export function latestRuns(businessId: string) {
  return (db.prepare(`SELECT json FROM discovery_runs WHERE business_id = ? ORDER BY id DESC LIMIT 10`).all(businessId) as { json: string }[]).map((r) => JSON.parse(r.json));
}
