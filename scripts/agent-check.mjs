// Runs every agent tool against live Robinhood Chain data (no model, no key needed) and prints what the model would read.
import { runTool, TOOLS } from "../server/agent.js";
import { IDENTITY } from "../src/identity.js";
const show = (name, r) => console.log(`\n== ${name}: ${r.label}\n` + JSON.stringify(r.out).slice(0, 900));
const ctx = { account: (process.argv[2] || "0x4200000000000000000000000000000000000006").toLowerCase() };
let failed = 0;
for (const [name, input] of [
  ["market_board", { query: "OGATE" }],
  ["market_board", { limit: 5 }],
  ["token_report", { address: IDENTITY.contract }],
  ["quote_buy", { address: IDENTITY.contract, eth: "0.01" }],
  ["my_wallet", {}],
  ["privacy_pools", {}],
  ["check_withdrawal", { token: "eth", amount: "0.137", deposit_amount: "0.137", hours_since_deposit: 1, to_new_address: false }],
  ["check_withdrawal", { token: "eth", amount: "0.1", deposit_amount: "0.25", hours_since_deposit: 40, to_new_address: true }],
]) {
  try { show(name, await runTool(name, input, ctx)); } catch (e) { failed++; console.log(`\n== ${name}: FAILED ${e.message}`); }
}
console.log(`\n${TOOLS.length} tools declared; ${failed ? failed + " FAILED" : "all ran"}`);
process.exit(failed ? 1 : 0);
