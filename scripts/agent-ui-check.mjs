// Agent page check in a browser, with no model: the gate states, then a conversation whose cards come from the real tools
// (live chain and pool data) and whose sentences are a fixture built from those same readings. For layout and behaviour only;
// the stream is not a model answer. Usage: node scripts/agent-ui-check.mjs [base url]
import { launch } from "./browser.mjs";
import { runTool } from "../server/agent.js";
import { IDENTITY } from "../src/identity.js";

const BASE = process.argv[2] || "http://localhost:5586";
const ACCOUNT = "0x3333333333333333333333333333333333333333";
const sse = (events) => events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join("");
const k = (v) => (v >= 1000 ? "$" + (v / 1000).toFixed(1) + "K" : "$" + v);

const retry = async (f) => { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 4000)); } } };
const token = await retry(() => runTool("token_report", { address: IDENTITY.contract }));
const quote = await retry(() => runTool("quote_buy", { address: IDENTITY.contract, eth: "0.01" }));
const plan = await retry(() => runTool("check_withdrawal", { token: "eth", amount: "0.137", deposit_amount: "0.137", hours_since_deposit: 1, to_new_address: false }));
const t = token.out, q = quote.out, p = plan.out;
const answers = [
  sse([["tool", { id: "a", name: "token_report", state: "run", label: "Reading the token on chain" }], ["tool", { id: "a", name: "token_report", state: "done", label: token.label, card: token.card }],
    ["tool", { id: "b", name: "quote_buy", state: "run", label: "Quoting 0.01 ETH" }], ["tool", { id: "b", name: "quote_buy", state: "done", label: quote.label, card: quote.card }],
    ["text", { delta: `OGATE trades at $${t.priceUsd} on its ${t.route?.venue} pool, ${t.change24h}% over 24 hours, with ${k(Math.round(t.liquidityUsd))} of liquidity and ${k(Math.round(t.volume24h))} traded.\n\n` }],
    ["text", { delta: `- ${t.buys24h} buys and ${t.sells24h} sells in that time\n- 0.01 ETH gets about ${q.expected?.toLocaleString("en-US")} OGATE, at least ${q.minimum?.toLocaleString("en-US")} at 1% slippage\n\nThe card opens it in the terminal, where you review and sign.` }], ["done", {}]]),
  sse([["tool", { id: "c", name: "check_withdrawal", state: "run", label: "Checking a 0.137 ETH withdrawal" }], ["tool", { id: "c", name: "check_withdrawal", state: "done", label: plan.label, card: plan.card }],
    ["text", { delta: `That plan is easy to trace. ${p.passed} of ${p.of} checks pass.\n\n- The same 0.137 ETH in and out pairs the two\n- One hour leaves few notes in between\n- Your own wallet links them directly\n\nWithdraw a round amount like 0.1 ETH to a fresh address after a day. The fee would be ${p.fee} ETH.` }], ["done", {}]]),
];

const browser = await launch();
let failed = 0;
const fail = (m) => { failed++; console.log("FAIL", m); };
for (const [w, h] of [[1366, 900], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((account) => {
    localStorage.setItem("onegate.terminal.wallet.v1", "injected");
    sessionStorage.setItem("onegate.agent.session.v1", JSON.stringify({ account, token: "fixture", expiresAt: Date.now() + 3600e3 }));
    window.ethereum = { request: async ({ method }) => { if (method === "eth_accounts" || method === "eth_requestAccounts") return [account]; if (method === "eth_chainId") return "0x1237"; throw Object.assign(new Error("unsupported " + method), { code: 4200 }); }, on() {}, removeListener() {} };
  }, ACCOUNT);
  let n = 0;
  await page.route("**/api/agent?action=status", (r) => r.fulfill({ json: { configured: true, minUsd: 150, sessionHours: 6 } }));
  await page.route("**/api/agent?action=chat", async (r) => {
    const body = r.request().postDataJSON();
    if (body.token !== "fixture" || body.messages.at(-1).role !== "user") fail("chat request shape");
    await r.fulfill({ status: 200, headers: { "content-type": "text/event-stream; charset=utf-8" }, body: answers[Math.min(n++, answers.length - 1)] });
  });
  await page.goto(BASE + "/agent", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /How is \$OGATE trading/ }).click();
  await page.locator(".agent-card").nth(1).waitFor({ timeout: 20000 });
  await page.fill("#agent-input", "Check my plan: deposit 0.137 ETH, withdraw it in an hour to my own wallet");
  await page.keyboard.press("Enter");
  await page.locator(".agent-checks").waitFor({ timeout: 20000 });
  await page.waitForTimeout(400);
  const link = await page.locator(".agent-card a.button", { hasText: "Review in the terminal" }).getAttribute("href");
  if (link !== `/terminal/${IDENTITY.contract}?buy=0.01`) fail("quote link " + link);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (overflow > 0) fail(`horizontal overflow ${overflow}px at ${w}`);
  const levels = await page.locator(".agent-checks li").evaluateAll((li) => li.map((x) => x.dataset.level).join(","));
  if (!levels.includes("risk")) fail("checks did not render levels");
  await page.screenshot({ path: `artifacts/agent-chat-${w}.png`, fullPage: w < 600 });
  await page.locator(".agent-list").evaluate((el) => { el.scrollTop = 0; });
  await page.screenshot({ path: `artifacts/agent-chat-top-${w}.png` });
  if (errors.length) fail("page errors: " + errors.join(" | "));
  // the terminal picks up the amount from the quote card
  await page.goto(BASE + link, { waitUntil: "domcontentloaded" });
  const field = page.locator('input[aria-label="Amount of ETH"]');
  await field.waitFor({ timeout: 90000 }).catch(() => {});
  const amount = await field.inputValue().catch(() => null);
  if (amount !== "0.01") fail("terminal prefill " + amount);
  console.log(`${w}: link ${link}, levels ${levels}, terminal amount ${amount}`);
  await page.close();
}
await browser.close();
console.log(failed ? `${failed} FAILED` : "PASS agent page: cards from live readings, quote hand-off to the terminal, no overflow, no page errors");
process.exit(failed ? 1 : 0);
