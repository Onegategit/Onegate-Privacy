import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createPublicClient, fallback, formatUnits, http, parseAbi, parseEther } from "viem";
import { HOLDER_MIN_USD, IDENTITY } from "../src/identity.js";
import { AGENT_MAX_INPUT, AGENT_SESSION_HOURS, agentSignInMessage } from "../src/agent-message.js";
import { getBalances, getCandles, getCoin, getHolder, getList, getQuote } from "./terminal.js";
import { health as privacyHealth } from "../api/privacy.js";

/**
 * The Onegate agent: a hosted language model with read-only tools over the terminal and the private pools.
 * Any OpenAI-compatible chat endpoint with tool calls works: AGENT_API_URL, AGENT_API_KEY and AGENT_MODEL are set on the server.
 * It reads the board, a token, a buy quote, the signed-in wallet, the pools, and checks a planned private withdrawal.
 * It never signs, sends or approves anything: a quote becomes a card that opens the terminal's own review, a withdrawal
 * plan points to the workspace. Holders of HOLDER_MIN_USD of $OGATE sign one message to open it; the session is an
 * HMAC token keyed from the server's API key, so no store is needed. Limits are kept in memory per instance.
 */
export class AgentError extends Error { constructor(message, status = 400, extra = null) { super(message); this.status = status; this.extra = extra; } }

const apiKey = () => (process.env.AGENT_API_URL && process.env.AGENT_API_KEY) || null;
const MODEL = () => process.env.AGENT_MODEL || "Qwen/Qwen3.6-35B-A3B";
// the tools carry the reasoning, so the model answers without a long think first (fast, and the first token arrives sooner)
const REASONING = () => process.env.AGENT_REASONING || "none";
const addr = (v) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null);
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const round = (v, d = 6) => (v == null ? null : Number(v.toPrecision(d)));

const RPCS = ["https://evm.privacycash.org/rpc/robinhood", "https://rpc.mainnet.chain.robinhood.com"];
const chain = createPublicClient({ transport: fallback(RPCS.map((u) => http(u, { timeout: 12000, retryCount: 0 }))) });
const POOLS = { eth: { address: "0xEC5266c9e44631e1ba22FD6377C38130c1F3B738", symbol: "ETH", decimals: 18 }, usdg: { address: "0xBB0C7F576B7bdAa8f2a119cb295076aCD0C9013f", symbol: "USDG", decimals: 6 } };
const indexAbi = parseAbi(["function nextIndex() view returns (uint32)"]);

const memo = new Map();
async function cached(key, ttl, load) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await load();
  memo.set(key, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------- sessions
const b64 = (v) => Buffer.from(v).toString("base64url");
const secret = () => createHash("sha256").update("onegate-agent-session-v1\0").update(apiKey() || "").digest();
export function issueToken(account, now = Date.now()) {
  const body = b64(JSON.stringify({ a: account, e: now + AGENT_SESSION_HOURS * 3600e3 }));
  return body + "." + b64(createHmac("sha256", secret()).update(body).digest());
}
export function readToken(token, now = Date.now()) {
  if (typeof token !== "string" || token.length > 400) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", secret()).update(body).digest(), got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(body, "base64url").toString());
    return addr(a) && Number.isFinite(e) && e > now ? { account: addr(a), expiresAt: e } : null;
  } catch { return null; }
}

export function status() { return { configured: Boolean(apiKey()), minUsd: HOLDER_MIN_USD, sessionHours: AGENT_SESSION_HOURS }; }

/** Verify the signed sign-in message, then the $OGATE holding, then issue a session token. */
export async function openSession(body) {
  if (!apiKey()) throw new AgentError("The agent is not configured yet.", 503);
  const b = body && typeof body === "object" ? body : {};
  const account = addr(b.account);
  const issued = typeof b.issued === "string" && b.issued.length < 40 ? b.issued : null, t = issued ? Date.parse(issued) : NaN;
  const nonce = typeof b.nonce === "string" && /^[0-9a-f]{16,64}$/.test(b.nonce) ? b.nonce : null;
  const signature = typeof b.signature === "string" && /^0x[0-9a-fA-F]{130,4000}$/.test(b.signature) ? b.signature : null;
  if (!account || !nonce || !signature || !Number.isFinite(t)) throw new AgentError("Invalid sign-in request.", 400);
  if (Math.abs(Date.now() - t) > 10 * 60e3) throw new AgentError("This sign-in has expired. Sign again.", 401);
  const valid = await chain.verifyMessage({ address: account, message: agentSignInMessage(account, issued, nonce), signature }).catch(() => false);
  if (!valid) throw new AgentError("The signature does not match this wallet.", 401);
  const holder = await getHolder(account);
  if (holder.worthUsd == null) throw new AgentError("The $OGATE price could not be read right now. Try again in a moment.", 503);
  if (!holder.ok) throw new AgentError(`The agent opens for wallets holding $${HOLDER_MIN_USD} of $OGATE.`, 403, { holder });
  const token = issueToken(account);
  return { token, account, expiresAt: readToken(token).expiresAt, holder: { amount: holder.amount, worthUsd: holder.worthUsd } };
}

// ---------------------------------------------------------------- limits
const hits = new Map();
function limit(account) {
  const now = Date.now(), list = (hits.get(account) || []).filter((t) => now - t < 24 * 3600e3);
  if (list.filter((t) => now - t < 10 * 60e3).length >= 12) throw new AgentError("That is 12 questions in 10 minutes. Wait a few minutes and ask again.", 429);
  if (list.length >= 80) throw new AgentError("This wallet reached today's 80 questions. It opens again tomorrow.", 429);
  list.push(now); hits.set(account, list);
}
function history(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 40) throw new AgentError("Invalid conversation.", 400);
  const out = raw.slice(-12).map((m) => {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
    const text = typeof m?.text === "string" ? m.text.trim() : "";
    if (!role || !text || text.length > (role === "user" ? AGENT_MAX_INPUT : 6000)) throw new AgentError("Invalid conversation.", 400);
    return { role, content: text };
  });
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length || out[out.length - 1].role !== "user") throw new AgentError("Invalid conversation.", 400);
  for (let i = 1; i < out.length; i++) if (out[i].role === out[i - 1].role) throw new AgentError("Invalid conversation.", 400);
  return out;
}

// ---------------------------------------------------------------- pool readings
/** Notes in each private pool now and 24 hours ago (the pool's own counter read at an older block). */
async function poolActivity() {
  return cached("pool:activity", 5 * 60e3, async () => {
    const head = await chain.getBlockNumber();
    const rate = await cached("pool:rate", 3600e3, async () => {
      const [a, b] = await Promise.all([chain.getBlock({ blockNumber: head }), chain.getBlock({ blockNumber: head - 100000n })]);
      return Number(a.timestamp - b.timestamp) / 100000;
    });
    const back = BigInt(Math.round(86400 / Math.max(0.01, rate)));
    const out = {};
    for (const [k, p] of Object.entries(POOLS)) {
      const [now, then] = await Promise.all([head, head - back].map((blockNumber) => chain.readContract({ address: p.address, abi: indexAbi, functionName: "nextIndex", blockNumber }).then(Number).catch(() => null)));
      out[k] = { notes: now, notes24h: now != null && then != null ? now - then : null };
    }
    return out;
  });
}

/**
 * Rules of thumb for a planned private withdrawal, with the live fee. Pure: the config and activity are passed in.
 * Levels: pass, warn, risk, block, unknown.
 */
export function withdrawCheck(input, config, activity) {
  const token = input?.token === "usdg" ? "usdg" : "eth", sym = token.toUpperCase();
  const raw = String(input?.amount ?? "").trim();
  if (!/^\d{1,9}(\.\d{1,18})?$/.test(raw) || !(Number(raw) > 0)) throw new AgentError("Give the amount as a plain number, like 0.1.", 400);
  const amount = Number(raw), rate = num(config?.fee_rate), flat = num(config?.rent_fees?.[token]), min = num(config?.minimum_withdrawal?.[token]);
  const fee = rate != null && flat != null ? flat + (amount * rate) / 10000 : null;
  const checks = [];
  checks.push(min == null ? { id: "minimum", level: "unknown", title: "Minimum unknown", detail: "The pool minimum could not be read." }
    : amount >= min ? { id: "minimum", level: "pass", title: `Above the ${min} ${sym} minimum`, detail: "The relay accepts this amount." }
    : { id: "minimum", level: "block", title: `Below the ${min} ${sym} minimum`, detail: `The relay takes withdrawals from ${min} ${sym}.` });
  if (fee != null && amount <= fee) checks.push({ id: "fee", level: "block", title: "The fee is larger than the amount", detail: "Nothing would arrive." });
  const places = (raw.split(".")[1] || "").replace(/0+$/, "").length, roundPlaces = token === "eth" ? 2 : 0;
  checks.push(places <= roundPlaces ? { id: "shape", level: "pass", title: "A common amount", detail: "Round amounts are shared by many notes, so they blend in." }
    : { id: "shape", level: "warn", title: "An unusual amount", detail: `${raw} ${sym} stands out. A round amount like ${token === "eth" ? Number(raw).toFixed(roundPlaces) : Math.round(amount)} ${sym} blends in better.` });
  const dep = input?.deposit_amount != null && /^\d{1,9}(\.\d{1,18})?$/.test(String(input.deposit_amount).trim()) ? Number(input.deposit_amount) : null;
  checks.push(dep == null ? { id: "match", level: "unknown", title: "Deposit amount not given", detail: "Withdrawing exactly what was deposited links the two." }
    : Math.abs(dep - amount) <= Math.max(dep, amount) * 0.005 ? { id: "match", level: "risk", title: "Same amount as the deposit", detail: `A ${dep} ${sym} deposit followed by a ${raw} ${sym} withdrawal is easy to pair. Withdraw a different amount or split it.` }
    : { id: "match", level: "pass", title: "Different from the deposit", detail: "The withdrawal does not mirror the deposit amount." });
  const hours = num(input?.hours_since_deposit);
  checks.push(hours == null ? { id: "timing", level: "unknown", title: "Timing not given", detail: "A withdrawal soon after its deposit is easy to pair." }
    : hours < 1 ? { id: "timing", level: "risk", title: "Within the hour of the deposit", detail: "Few other notes arrive in between, so timing alone can pair them. Wait longer." }
    : hours < 24 ? { id: "timing", level: "warn", title: `${Math.round(hours)} hour${Math.round(hours) === 1 ? "" : "s"} after the deposit`, detail: "More time lets more notes pass through the pool. A day or more is safer." }
    : { id: "timing", level: "pass", title: `${Math.round(hours)} hours after the deposit`, detail: "Plenty of pool activity in between." });
  const fresh = typeof input?.to_new_address === "boolean" ? input.to_new_address : null;
  checks.push(fresh == null ? { id: "recipient", level: "unknown", title: "Recipient not given", detail: "Sending to the wallet that deposited links them directly." }
    : fresh ? { id: "recipient", level: "pass", title: "A fresh recipient", detail: "The address has no history with the depositing wallet." }
    : { id: "recipient", level: "risk", title: "Back to a linked wallet", detail: "Withdrawing to the wallet that deposited, or one it funded, undoes the privacy. Use a fresh address." });
  const a = activity?.[token];
  checks.push(a?.notes24h == null ? { id: "crowd", level: "unknown", title: "Pool activity unknown", detail: "The pool counter could not be read." }
    : a.notes24h < 20 ? { id: "crowd", level: "warn", title: `${a.notes24h} new notes in 24 hours`, detail: `A quiet pool gives fewer notes to blend with. ${a.notes} notes in total.` }
    : { id: "crowd", level: "pass", title: `${a.notes24h} new notes in 24 hours`, detail: `${a.notes.toLocaleString("en-US")} notes in the ${sym} pool in total.` });
  const counted = checks.filter((c) => c.level !== "unknown");
  return {
    token, symbol: sym, amount: raw, feeRateBps: rate, flatFee: flat, fee: fee == null ? null : round(fee), receive: fee == null ? null : round(Math.max(0, amount - fee)),
    minimum: min, checks, passed: counted.filter((c) => c.level === "pass").length, of: counted.length,
    note: "Rules of thumb from public patterns. Privacy is not anonymity, and these checks are not a guarantee.",
  };
}

// ---------------------------------------------------------------- tools
/** Holder count from the token feed (refreshed by the feed itself every so often), or null. */
async function holders(address) {
  return cached("holders:" + address, 5 * 60e3, async () => {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/${address}/info`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const h = (await r.json())?.data?.attributes?.holders;
    return Number.isFinite(h?.count) ? { count: h.count, updatedAt: h.last_updated || null } : null;
  }).catch(() => null);
}
const fmtAmount = (raw, decimals) => { if (raw == null || decimals == null) return null; const n = Number(formatUnits(BigInt(raw), decimals)); return round(n, 6); };
const coinRow = (c) => ({ symbol: c.symbol, name: c.name, address: c.address, group: c.group, priceUsd: c.priceUsd, change24h: c.change24h == null ? null : round(c.change24h, 4), liquidityUsd: c.liquidityUsd == null ? null : Math.round(c.liquidityUsd), volume24h: c.volume24h == null ? null : Math.round(c.volume24h), venue: c.pool?.venue ?? null, routable: c.pool?.routable ?? false });

export const TOOLS = [
  { name: "market_board", description: "Coins on the Onegate terminal board (Robinhood Chain memes and tokenized stocks) with price, 24h change, liquidity, 24h volume and whether the terminal can route a buy. Optional search by symbol or name.", input_schema: { type: "object", properties: { query: { type: "string", description: "Symbol or name to search, e.g. OGATE" }, group: { type: "string", enum: ["memes", "stocks"] }, limit: { type: "integer", minimum: 1, maximum: 15 } } } },
  { name: "token_report", description: "One token by contract address: price and its source, 24h change, volume, liquidity, buys and sells, market cap, holder count, its pools, the buy route, and the last 24 hourly candles summarised.", input_schema: { type: "object", properties: { address: { type: "string", description: "0x contract address" } }, required: ["address"] } },
  { name: "quote_buy", description: "Quote buying a token with ETH through the terminal's route. Read only, nothing is sent. Returns the route, the expected amount and the minimum at 1% slippage. The user reviews and signs it in the terminal.", input_schema: { type: "object", properties: { address: { type: "string", description: "0x contract address" }, eth: { type: "string", description: "ETH to spend, decimal string such as 0.05" } }, required: ["address", "eth"] } },
  { name: "my_wallet", description: "The signed-in wallet: ETH balance, $OGATE amount and its dollar worth against the holder gate, and the other board coins it holds.", input_schema: { type: "object", properties: {} } },
  { name: "privacy_pools", description: "The ETH and USDG private pools on Robinhood Chain: the withdrawal fee (a flat relay fee plus a rate), minimum deposit and withdrawal, notes in each pool and notes added in the last 24 hours.", input_schema: { type: "object", properties: {} } },
  { name: "check_withdrawal", description: "Check a planned private withdrawal before the user makes it: the fee and the amount received, and privacy checks on the amount's shape, matching the deposit amount, time since the deposit, the recipient and how busy the pool is. Rules of thumb, not a guarantee.", input_schema: { type: "object", properties: { token: { type: "string", enum: ["eth", "usdg"] }, amount: { type: "string", description: "Amount to withdraw, decimal string" }, deposit_amount: { type: "string", description: "The amount that was deposited, if the user said" }, hours_since_deposit: { type: "number", description: "Hours between the deposit and this withdrawal, if the user said" }, to_new_address: { type: "boolean", description: "true if the recipient is a fresh address with no link to the depositing wallet, false if it is the same or a linked wallet" } }, required: ["token", "amount"] } },
];

const RUN = {
  async market_board(input) {
    const list = await getList(), group = input?.group;
    let rows = [...(group !== "stocks" ? list.memes : []), ...(group !== "memes" ? list.stocks : [])];
    const q = typeof input?.query === "string" ? input.query.trim().replace(/^\$/, "").toLowerCase().slice(0, 40) : "";
    if (q) rows = rows.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.address === q);
    const n = Math.min(15, Math.max(1, Math.floor(Number(input?.limit)) || 8));
    const coins = rows.slice(0, n).map(coinRow);
    // $OGATE and pasted contracts open even when they are not among the board's busiest coins
    const direct = addr(q) || (q === IDENTITY.ticker.slice(1).toLowerCase() ? IDENTITY.contract : null);
    if (direct && !coins.some((c) => c.address === direct)) {
      const c = await getCoin(direct).catch(() => null);
      if (c) coins.unshift({ symbol: c.symbol, name: c.name, address: c.address, group: c.group, priceUsd: c.priceUsd, change24h: c.change24h, liquidityUsd: c.liquidityUsd == null ? null : Math.round(c.liquidityUsd), volume24h: c.volume24h == null ? null : Math.round(c.volume24h), venue: c.route?.venue ?? null, routable: Boolean(c.route) });
    }
    if (direct) rows = coins;
    return { out: { matches: rows.length, coins, at: list.at }, card: { kind: "board", query: q || null, coins: coins.slice(0, 6) }, label: q ? `Searched the board for ${q.toUpperCase()} · ${rows.length} found` : `Read the board · ${coins.length} coins` };
  },
  async token_report(input) {
    const address = addr(input?.address);
    if (!address) throw new AgentError("That is not a contract address.");
    const [coin, holderCount] = await Promise.all([getCoin(address), holders(address)]);
    let day = null;
    if (coin.chartPool) {
      const c = (await getCandles(coin.chartPool, "1h").catch(() => null))?.candles?.slice(-24);
      if (c?.length) day = { candles: c.length, open: round(c[0].o), high: round(Math.max(...c.map((x) => x.h))), low: round(Math.min(...c.map((x) => x.l))), last: round(c[c.length - 1].c), volumeUsd: Math.round(c.reduce((s, x) => s + x.v, 0)) };
    }
    const out = { symbol: coin.symbol, name: coin.name, address, priceUsd: coin.priceUsd, priceSource: coin.priceSource === "curve" ? "launch curve" : "pool", change24h: coin.change24h, volume24h: coin.volume24h, liquidityUsd: coin.liquidityUsd, marketCapUsd: coin.marketCapUsd ?? coin.fdvUsd, buys24h: coin.buys24h, sells24h: coin.sells24h, holders: holderCount?.count ?? null, holdersUpdatedAt: holderCount?.updatedAt ?? null, route: coin.route ? { venue: coin.route.venue, pair: coin.route.pair } : null, pools: coin.pools.slice(0, 4).map((p) => ({ pair: p.pair, venue: p.venue, liquidityUsd: p.liquidityUsd, volume24h: p.volume24h })), last24hHourly: day, isOgate: address === IDENTITY.contract };
    return { out, card: { kind: "token", ...out, image: coin.image }, label: `Read ${coin.symbol || short(address)} · ${coin.route ? coin.route.venue : "no route"}` };
  },
  async quote_buy(input) {
    const address = addr(input?.address), eth = String(input?.eth ?? "").trim();
    if (!address) throw new AgentError("That is not a contract address.");
    if (!/^\d{1,3}(\.\d{1,18})?$/.test(eth) || !(Number(eth) > 0)) throw new AgentError("Give the ETH amount as a plain number, like 0.05.");
    if (Number(eth) > 10) throw new AgentError("The agent quotes up to 10 ETH. Use the terminal for more.");
    const q = await getQuote({ address, amount: parseEther(eth).toString(), slippage: "100" });
    const out = { symbol: q.symbol, address, eth, venue: q.route?.venue ?? null, via: q.route?.via ?? null, expected: fmtAmount(q.amountOut, q.decimals), minimum: fmtAmount(q.minOut, q.decimals), slippagePercent: q.slippageBps / 100, reason: q.reason, quotedAt: q.at };
    return { out, card: { kind: "quote", ...out, link: `/terminal/${address}?buy=${eth}` }, label: q.reason ? `No route for ${q.symbol}` : `Quoted ${eth} ETH → ${q.symbol} on ${out.venue}` };
  },
  async my_wallet(_input, ctx) {
    const account = ctx.account;
    const [holder, bal, list] = await Promise.all([getHolder(account), getBalances(account).catch(() => null), getList().catch(() => null)]);
    const coins = new Map([...(list?.memes || []), ...(list?.stocks || [])].map((c) => [c.address, c]));
    const holdings = (bal?.items || []).map((i) => { const c = coins.get(i.address); const amount = c?.decimals != null ? fmtAmount(i.raw, c.decimals) : null; return c && amount ? { symbol: c.symbol, address: c.address, amount, usd: c.priceUsd != null ? Math.round(amount * c.priceUsd * 100) / 100 : null } : null; })
      .filter(Boolean).filter((h) => h.address !== IDENTITY.contract).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)).slice(0, 8);
    const out = { account, eth: bal?.eth != null ? fmtAmount(bal.eth, 18) : null, ogate: { amount: round(holder.amount), worthUsd: holder.worthUsd == null ? null : Math.round(holder.worthUsd * 100) / 100, priceSource: holder.priceSource, gateUsd: HOLDER_MIN_USD, opensWorkspace: holder.ok }, holdings };
    return { out, card: { kind: "wallet", ...out }, label: `Read your wallet ${short(account)}` };
  },
  async privacy_pools() {
    const [h, act] = await Promise.all([privacyHealth(), poolActivity().catch(() => null)]);
    const c = h.config, pools = {};
    for (const [k, p] of Object.entries(POOLS)) pools[k] = { symbol: p.symbol, notes: act?.[k]?.notes ?? null, notes24h: act?.[k]?.notes24h ?? null, maximumDeposit: h.pools?.[k]?.maximum ? fmtAmount(h.pools[k].maximum, p.decimals) : null, minimumDeposit: c.minimum_deposit[k], minimumWithdrawal: c.minimum_withdrawal[k], flatFee: c.rent_fees[k] };
    const out = { feeRateBps: c.fee_rate, feeRule: "withdrawal fee = flat relay fee + amount x rate", pools };
    return { out, card: { kind: "pools", ...out }, label: `Read the private pools · ${pools.eth.notes?.toLocaleString("en-US") ?? "—"} ETH notes` };
  },
  async check_withdrawal(input) {
    const [h, act] = await Promise.all([privacyHealth(), poolActivity().catch(() => null)]);
    const out = withdrawCheck(input, h.config, act);
    return { out, card: { kind: "privacy", ...out }, label: `Checked a ${out.amount} ${out.symbol} withdrawal · ${out.passed} of ${out.of} pass` };
  },
};
const startLabel = (name, input) => ({ market_board: input?.query ? `Searching the board for ${String(input.query).slice(0, 20)}` : "Reading the board", token_report: "Reading the token on chain", quote_buy: `Quoting ${String(input?.eth ?? "").slice(0, 12)} ETH`, my_wallet: "Reading your wallet", privacy_pools: "Reading the private pools", check_withdrawal: `Checking a ${String(input?.amount ?? "").slice(0, 12)} ${input?.token === "usdg" ? "USDG" : "ETH"} withdrawal` }[name] || "Reading");

const system = (account) => `You are the Onegate agent on onegate.lat, Robinhood Chain. You help $OGATE holders read the market and plan private transfers using Onegate's tools.

What Onegate is:
- Terminal: lists Robinhood Chain coins from public pool feeds and buys them with ETH from the user's own wallet through Uniswap V3, Uniswap V4 or a Pons curve. Routes are checked on chain, the call is rebuilt in the browser and dry-run before the wallet opens. Onegate adds no fee.
- Privacy workspace: an independent interface to Privacy Cash EVM 1.3.3 private pools for ETH and USDG on Robinhood Chain. Deposits are wallet transactions; withdrawals are proved in the browser and sent through an external relay. It opens for wallets holding $${HOLDER_MIN_USD} of $OGATE, like this agent. Privacy is not anonymity: amounts, timing and addresses can link a deposit to a withdrawal.
- File vault: encrypts files in the browser.
- $OGATE: contract ${IDENTITY.contract}, a Pons launch that migrated to a Uniswap V4 OGATE/ETH pool on Oct 2 2026. Creator fees are planned to be split between a shared privacy balance, $OGATE stake and the treasury; the shares are TBA.
- Source: ${IDENTITY.repo.replace("https://", "")}.

Rules:
- Every number you give comes from a tool result for the current question. Call the tools again for each new question, even when a similar number appeared earlier. Never calculate fees yourself; check_withdrawal does it. If a tool fails or a value is missing, say it is unknown. Never estimate or invent figures.
- You cannot sign, send, approve or move anything. For a buy, quote it and say the card opens it in the terminal for review. For a private transfer, check the plan and point to the workspace.
- Never ask for a seed phrase, private key or signature. If someone offers one, tell them never to share it.
- No price predictions and no advice on what to buy. Describe what the data shows.
- Never call a plan safe, private or guaranteed. Say which checks pass and which do not, and that the checks are rules of thumb.
- Reply in the language of the user's last message: Indonesian when they write Indonesian, English when they write English.
- Short answers: two to five sentences or a short list with "- " items. Plain words, no headings, no tables, no em dashes.
- Say Robinhood Chain for the network. Do not name data vendors; say the pool feed or on chain.
- Tokens are identified by contract address because many share a symbol. When a search returns several, list them with short addresses and ask which one.
- The signed-in wallet is ${account}. Use my_wallet for the user's own holdings.`;

const FUNCTIONS = TOOLS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
/**
 * One streamed chat completion: text deltas go to onText as they arrive, tool calls are assembled from their pieces.
 * Provider errors are not passed through to the reader.
 */
async function complete(messages, signal, onText, firstStep = false) {
  const res = await fetch(process.env.AGENT_API_URL.replace(/\/$/, "") + "/chat/completions", {
    method: "POST", signal: AbortSignal.any([signal, AbortSignal.timeout(55000)]),
    headers: { "content-type": "application/json", authorization: "Bearer " + process.env.AGENT_API_KEY },
    body: JSON.stringify({ model: MODEL(), messages, tools: FUNCTIONS, tool_choice: firstStep ? "required" : "auto", stream: true, stream_options: { include_usage: true }, temperature: 0.3, max_tokens: 1600, reasoning_effort: REASONING() }),
  });
  if (!res.ok || !res.body) throw new AgentError(res.status === 429 ? "The model is busy right now. Ask again in a minute." : "The model could not answer right now. Ask again.", 502);
  const reader = res.body.getReader(), dec = new TextDecoder(), calls = [];
  let buf = "", content = "", usage = { input: 0, output: 0 };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let chunk;
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens || 0, output: chunk.usage.completion_tokens || 0 };
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content) { content += delta.content; onText(delta.content); }
      for (const t of delta.tool_calls || []) {
        const at = Number.isInteger(t.index) ? t.index : calls.length;
        const c = (calls[at] ||= { id: "", name: "", args: "" });
        if (t.id) c.id = t.id;
        if (t.function?.name) c.name += t.function.name;
        if (t.function?.arguments) c.args += t.function.arguments;
      }
    }
  }
  return { content, usage, calls: calls.filter(Boolean).map((c, n) => ({ ...c, id: c.id || "call_" + n })) };
}

/** Validate the request and return a runner that streams events through emit(event, data). Throws AgentError first. */
export async function startChat(body) {
  if (!apiKey()) throw new AgentError("The agent is not configured yet.", 503);
  const session = readToken(body?.token);
  if (!session) throw new AgentError("Your agent session ended. Sign in again.", 401);
  const msgs = history(body?.messages);
  const holder = await getHolder(session.account).catch(() => null);
  if (holder && holder.worthUsd != null && !holder.ok) throw new AgentError(`This wallet now holds less than $${HOLDER_MIN_USD} of $OGATE.`, 403);
  limit(session.account);
  return agentLoop(session.account, msgs);
}

/** The model and tool loop for one signed-in wallet, after the gate. Exported for the protocol test. */
export function agentLoop(account, msgs) {
  const session = { account };
  return async (emit, signal) => {
    const convo = [{ role: "system", content: system(session.account) }, ...msgs];
    let usage = { input: 0, output: 0 };
    for (let step = 0; step < 6; step++) {
      // the first step must read something, so an answer never starts from memory
      const r = await complete(convo, signal, (delta) => emit("text", { delta }), step === 0);
      usage = { input: usage.input + r.usage.input, output: usage.output + r.usage.output };
      convo.push({ role: "assistant", content: r.content || null, ...(r.calls.length ? { tool_calls: r.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })) } : {}) });
      if (!r.calls.length) break;
      for (const c of r.calls) {
        let input = {};
        try { input = c.args ? JSON.parse(c.args) : {}; } catch { /* reported below */ }
        emit("tool", { id: c.id, name: c.name, state: "run", label: startLabel(c.name, input) });
        try {
          if (!RUN[c.name]) throw new AgentError("Unknown tool.");
          if (c.args && typeof input !== "object") throw new AgentError("The tool input could not be read.");
          const out = await RUN[c.name](input, { account: session.account });
          emit("tool", { id: c.id, name: c.name, state: "done", label: out.label, card: out.card });
          convo.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(out.out) });
        } catch (e) {
          const message = e instanceof Error ? e.message.slice(0, 200) : "The reading failed.";
          emit("tool", { id: c.id, name: c.name, state: "error", label: message });
          convo.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ error: message }) });
        }
      }
      if (step === 5) emit("text", { delta: "\n\nI stopped after several readings. Ask again with one thing at a time." });
    }
    emit("done", { usage, account: session.account });
  };
}

/** One tool by name, for the checks in scripts/agent-check.mjs. */
export const runTool = (name, input, ctx = {}) => RUN[name](input, ctx);
