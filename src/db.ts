import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";

mkdirSync("data", { recursive: true });
export const db = new Database(process.env.VENDO_DB ?? "data/vendo.db");
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, business_id TEXT NOT NULL, route TEXT NOT NULL,
  amount_atomic TEXT NOT NULL, pay_to TEXT NOT NULL, upstream_status INTEGER NOT NULL, receipt TEXT
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, buyer TEXT NOT NULL, service TEXT NOT NULL,
  url TEXT NOT NULL, amount_atomic TEXT NOT NULL, status INTEGER NOT NULL, settlement TEXT
);
CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, business_id TEXT NOT NULL, ok INTEGER NOT NULL, status INTEGER, ms INTEGER
);
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT, payee TEXT NOT NULL, amount_usd REAL NOT NULL, ref TEXT NOT NULL,
  every_days INTEGER NOT NULL, next_due TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, last_result TEXT
);
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, business_id TEXT NOT NULL, amount_atomic TEXT NOT NULL, tx_hash TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS discovery_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, business_id TEXT NOT NULL, json TEXT NOT NULL
);
`);

// migrations
const cols = (db.prepare(`PRAGMA table_info(sales)`).all() as { name: string }[]).map((c) => c.name);
if (!cols.includes("payer")) db.exec(`ALTER TABLE sales ADD COLUMN payer TEXT`);
if (!cols.includes("tx_hash")) db.exec(`ALTER TABLE sales ADD COLUMN tx_hash TEXT`);
