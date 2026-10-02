import { test } from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { agentSignInMessage } from "../src/agent-message.js";

process.env.AGENT_API_KEY = "test-key-for-session-signing-only";
process.env.AGENT_API_URL = "http://127.0.0.1:9/v1";
const { AgentError, agentLoop, issueToken, openSession, readToken, startChat, withdrawCheck } = await import("../server/agent.js");

const config = { fee_rate: 35, rent_fees: { eth: 0.00055, usdg: 1.5 }, minimum_withdrawal: { eth: 0.005, usdg: 10 } };
const busy = { eth: { notes: 15376, notes24h: 258 }, usdg: { notes: 950, notes24h: 8 } };

test("session tokens round-trip, expire and refuse tampering", () => {
  const account = "0x1111111111111111111111111111111111111111";
  const t = issueToken(account, 1000);
  assert.equal(readToken(t, 2000).account, account);
  assert.equal(readToken(t, 1000 + 7 * 3600e3), null, "expired after the session hours");
  const [body, mac] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ a: "0x2222222222222222222222222222222222222222", e: 9e15 })).toString("base64url");
  assert.equal(readToken(forged + "." + mac, 2000), null, "another body with the same mac");
  assert.equal(readToken(body + "." + mac.slice(0, -2) + "AA", 2000), null, "a changed mac");
  assert.equal(readToken("nonsense", 2000), null);
});

test("the withdrawal fee follows the pool rule: flat relay fee plus the rate", () => {
  const r = withdrawCheck({ token: "eth", amount: "0.1" }, config, busy);
  assert.equal(r.fee, 0.0009);
  assert.equal(r.receive, 0.0991);
  const u = withdrawCheck({ token: "usdg", amount: "100" }, config, busy);
  assert.equal(u.fee, 1.85);
});

test("a linked plan is flagged on every point; a careful one passes", () => {
  const bad = withdrawCheck({ token: "eth", amount: "0.137", deposit_amount: "0.137", hours_since_deposit: 0.5, to_new_address: false }, config, busy);
  const level = Object.fromEntries(bad.checks.map((c) => [c.id, c.level]));
  assert.deepEqual(level, { minimum: "pass", shape: "warn", match: "risk", timing: "risk", recipient: "risk", crowd: "pass" });
  const good = withdrawCheck({ token: "eth", amount: "0.1", deposit_amount: "0.25", hours_since_deposit: 40, to_new_address: true }, config, busy);
  assert.equal(good.passed, good.of);
  const quiet = withdrawCheck({ token: "usdg", amount: "50" }, config, busy);
  assert.equal(quiet.checks.find((c) => c.id === "crowd").level, "warn");
  assert.equal(quiet.checks.find((c) => c.id === "match").level, "unknown", "unknown stays unknown");
  const low = withdrawCheck({ token: "eth", amount: "0.001" }, config, busy);
  assert.ok(low.checks.some((c) => c.level === "block"));
  assert.throws(() => withdrawCheck({ token: "eth", amount: "abc" }, config, busy), AgentError);
});

test("sign-in rejects a wrong signer, an old message and a non-holder", async () => {
  const signer = privateKeyToAccount(generatePrivateKey()), other = privateKeyToAccount(generatePrivateKey());
  const account = signer.address.toLowerCase(), nonce = "0123456789abcdef0123456789abcdef";
  const issued = new Date().toISOString();
  const wrong = await other.signMessage({ message: agentSignInMessage(account, issued, nonce) });
  await assert.rejects(openSession({ account, issued, nonce, signature: wrong }), (e) => e.status === 401);
  const oldIssued = new Date(Date.now() - 20 * 60e3).toISOString();
  const old = await signer.signMessage({ message: agentSignInMessage(account, oldIssued, nonce) });
  await assert.rejects(openSession({ account, issued: oldIssued, nonce, signature: old }), (e) => e.status === 401);
  // a valid signature from a fresh wallet: the signature passes, the $OGATE holding (read on chain) does not
  const good = await signer.signMessage({ message: agentSignInMessage(account, issued, nonce) });
  await assert.rejects(openSession({ account, issued, nonce, signature: good }), (e) => e.status !== 401, "past the signature, stopped at the holding");
});

test("a chat needs a valid session and a well-formed conversation", async () => {
  await assert.rejects(startChat({ token: "x", messages: [{ role: "user", text: "hi" }] }), (e) => e.status === 401);
  const token = issueToken("0x3333333333333333333333333333333333333333");
  await assert.rejects(startChat({ token, messages: [] }), (e) => e.status === 400);
  await assert.rejects(startChat({ token, messages: [{ role: "user", text: "a" }, { role: "user", text: "b" }] }), (e) => e.status === 400);
  await assert.rejects(startChat({ token, messages: [{ role: "user", text: "x".repeat(1300) }] }), (e) => e.status === 400);
});

test("the model loop streams text, assembles split tool calls and feeds the results back", async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      seen.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
      if (seen.length === 1) {
        send({ choices: [{ delta: { content: "Let me " } }] });
        send({ choices: [{ delta: { content: "check. " } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "no_such_tool", arguments: '{"a"' } }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] } }] });
        send({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
      } else {
        send({ choices: [{ delta: { content: "Done." } }] });
        send({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 3 } });
      }
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.AGENT_API_URL = `http://127.0.0.1:${server.address().port}/v1/`;
  try {
    const run = agentLoop("0x4444444444444444444444444444444444444444", [{ role: "user", content: "hi" }]);
    const events = [];
    await run((e, d) => events.push([e, d]), new AbortController().signal);
    assert.equal(seen[0].path, "/v1/chat/completions");
    assert.equal(seen[0].auth, "Bearer test-key-for-session-signing-only");
    assert.equal(seen[0].body.messages[0].role, "system");
    assert.equal(seen[0].body.tools.length, 6);
    assert.equal(events.filter(([e]) => e === "text").map(([, d]) => d.delta).join(""), "Let me check. Done.");
    assert.deepEqual(events.filter(([e]) => e === "tool").map(([, d]) => d.state), ["run", "error"]);
    const second = seen[1].body.messages;
    assert.deepEqual(second.at(-2).tool_calls, [{ id: "call_a", type: "function", function: { name: "no_such_tool", arguments: '{"a":1}' } }]);
    assert.equal(second.at(-1).role, "tool");
    assert.equal(second.at(-1).tool_call_id, "call_a");
    assert.deepEqual(events.at(-1), ["done", { usage: { input: 10, output: 3 }, account: "0x4444444444444444444444444444444444444444" }]);
  } finally { server.close(); }
});
