import { loadSanctionsCsv, screenName, nameSimilarity, invoiceCalc } from "../src/finance.js";
import { createChallenge, completeChallenge, lookupWallet } from "../src/entity-wallets.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const fixture = [
  '1001,"EXAMPLE SANCTIONED TRADING LLC","-0-","SDGT"',
  '1002,"BLUE HARBOR SHIPPING CO","-0-","IRAN"',
  '1003,"DOE, JOHN","individual","CYBER2"',
].join("\n");

let fail = 0;
const ok = (cond: boolean, msg: string) => { console.log(cond ? "PASS" : "FAIL", msg); if (!cond) fail++; };

ok(nameSimilarity("Example Sanctioned Trading, L.L.C.", "EXAMPLE SANCTIONED TRADING LLC") >= 0.95, "legal suffix and punctuation normalised");
ok(nameSimilarity("Northgate Bakery Ltd", "EXAMPLE SANCTIONED TRADING LLC") === 0, "unrelated names do not match");
ok(loadSanctionsCsv(fixture) === 3, "fixture list loaded");
const hit = await screenName("Example Sanctioned Trading LLC");
ok(hit.possibleMatch && hit.matches[0].uid === "1001", "exact sanctioned entity flagged");
const miss = await screenName("Brightside Learning Pte Ltd");
ok(!miss.possibleMatch, "clean company not flagged");
const partial = await screenName("Blue Harbor Logistics");
ok(!partial.possibleMatch, "partial overlap below threshold not flagged");

const inv = await invoiceCalc({ amount: "1090", taxRatePct: "9", taxInclusive: "true" });
ok(inv.net === 1000 && inv.tax === 90 && inv.gross === 1090, "tax-inclusive invoice maths");
let threw = false; try { await invoiceCalc({ amount: "-5" }); } catch { threw = true; }
ok(threw, "negative amount rejected");

const acct = privateKeyToAccount(generatePrivateKey());
const lei = "HWUPKR0MPOU8FGXBT394";
const ch = createChallenge(acct.address, lei);
const badSig = await privateKeyToAccount(generatePrivateKey()).signMessage({ message: ch.message });
let rejected = false; try { await completeChallenge(acct.address, badSig, "demo", { skipRegistry: true }); } catch { rejected = true; }
ok(rejected, "signature from another wallet rejected");
const sig = await acct.signMessage({ message: ch.message });
const done = await completeChallenge(acct.address, sig, "demo", { skipRegistry: true });
ok(done.verified && (lookupWallet(acct.address) as any)?.lei === lei, "wallet verified and linked to LEI");

console.log(fail ? `\n${fail} failing` : "\nall finance checks passed");
process.exit(fail ? 1 : 0);
