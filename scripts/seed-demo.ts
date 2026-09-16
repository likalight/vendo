/**
 * Seeds an OFFLINE demo database with clearly labelled sample activity for UI screenshots and rehearsal.
 * Never run against a live database: it refuses unless VENDO_OFFLINE=1 and VENDO_DB points at a demo file.
 *   VENDO_OFFLINE=1 VENDO_DB=data/demo.db npx tsx scripts/seed-demo.ts
 */
if (process.env.VENDO_OFFLINE !== "1" || !String(process.env.VENDO_DB ?? "").includes("demo")) {
  console.error("Refusing: set VENDO_OFFLINE=1 and VENDO_DB to a file whose name contains 'demo'.");
  process.exit(1);
}
const { db } = await import("../src/db.js");
const { seedIfEmpty, listBusinesses } = await import("../src/registry.js");
seedIfEmpty();
const payers = ["0xA11CE0000000000000000000000000000000DEMO", "0xB0B0000000000000000000000000000000000DEMO", "0xCA7E000000000000000000000000000000000DEMO", "0xD00D000000000000000000000000000000000DEMO"];
const insert = db.prepare(`INSERT INTO sales (at, business_id, route, amount_atomic, pay_to, upstream_status, receipt, payer, tx_hash) VALUES (?, ?, ?, ?, ?, 200, 'demo-seed', ?, NULL)`);
const health = db.prepare(`INSERT INTO health_checks (at, business_id, ok, status, ms) VALUES (?, ?, 1, 200, ?)`);
let n = 0;
for (const b of listBusinesses()) {
  for (let d = 0; d < 7; d++) {
    const calls = 2 + ((b.id.length + d) % 5);
    for (let c = 0; c < calls; c++) {
      const r = b.routes[c % b.routes.length];
      const at = new Date(Date.now() - d * 864e5 - c * 3600e3).toISOString();
      insert.run(at, b.id, `${r.method} ${r.path}`, String(Math.round(r.priceUsd * 1e6)), "0x1111111111111111111111111111111111111111", payers[(c + d) % payers.length]);
      n++;
    }
    health.run(new Date(Date.now() - d * 864e5).toISOString(), b.id, 120 + (d * 17) % 90);
  }
}
console.log(`Seeded ${n} SAMPLE sales (receipt "demo-seed") and health checks. Label any screenshots as sample data.`);
