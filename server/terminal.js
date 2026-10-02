import { BaseError, createPublicClient, decodeFunctionResult, encodeFunctionData, erc20Abi, fallback, http, keccak256, parseAbi } from "viem";
import { MULTICALL3, NATIVE, PONS_FACTORY, POOL_MANAGER, QUOTER_V2, SWAP_ROUTER02, UNIVERSAL_ROUTER, USDG, V3_FACTORY, V4_QUOTER, WETH, curveAbi, encodeCurveBuy, encodeV3Buy, encodeV4Buy, poolIdOf, v3Path } from "../src/terminal-route.js";
export * from "../src/terminal-route.js";


/**
 * The coin terminal: Robinhood Chain coins from the public pool feed, priced and charted, and bought with
 * ETH from the user's own wallet through routes read and checked on chain:
 *  v3   Uniswap V3 pool against WETH, or against USDG with a first hop WETH -> USDG (SwapRouter02, QuoterV2)
 *  v4   Uniswap V4 pool against native ETH, or against USDG with a first hop ETH -> USDG (Universal Router, V4Quoter)
 *  pons a Pons V2 launch still on its bonding curve (curve.buy)
 * Pool keys come from the PoolManager's Initialize event and must hash to the pool id the feed reports.
 * Contract code hashes are pinned; a change pauses buys. Nothing here signs or holds funds.
 * The feed vendor is never named in the interface.
 */
const RPCS = ["https://rpc.mainnet.chain.robinhood.com", "https://evm.privacycash.org/rpc/robinhood"];
const client = createPublicClient({ transport: fallback(RPCS.map((u) => http(u, { timeout: 12000, retryCount: 0 }))) });
const FEED = "https://api.geckoterminal.com/api/v2/networks/robinhood";

const INITIALIZE = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";
// Runtime code hashes read on 2026-10-01 at block 77912990 (Uniswap's Robinhood Chain deployments and the Pons factory).
const PINNED = {
  [SWAP_ROUTER02]: "0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc",
  [QUOTER_V2]: "0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28",
  [V3_FACTORY]: "0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739",
  [UNIVERSAL_ROUTER]: "0x2ce6aaaf9f4151f5e1cbf774668772f17f532ae11b15e9284fd0a072a8b0fbde",
  [V4_QUOTER]: "0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6",
  [POOL_MANAGER]: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  [PONS_FACTORY]: "0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84",
};
// Tokenized stocks on Robinhood Chain, one contract per company (several impostors share names and symbols).
const STOCKS = {
  "0x117cc2133c37b721f49de2a7a74833232b3b4c0c": "SPY", "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": "NVDA", "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea": "SPCX",
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": "AAPL", "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3": "GOOGL", "0x322f0929c4625ed5bad873c95208d54e1c003b2d": "TSLA",
  "0xc0d6457c16cc70d6790dd43521c899c87ce02f35": "META", "0x6330d8c3178a418788df01a47479c0ce7ccf450b": "COIN", "0x12f190a9f9d7d37a250758b26824b97ce941bf54": "AMZN",
  "0xec262a75e413fafd0df80480274532c79d42da09": "MSTR", "0xe93237c50d904957cf27e7b1133b510c669c2e74": "MSFT", "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a": "PLTR",
  "0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5": "CRCL", "0xc72b96e0e48ecd4dc75e1e45396e26300bc39681": "INTC", "0x1b0e319c6a659f002271b69db8a7df2f911c153e": "GME",
  "0x58ffe4a942d3885baa22d7520691f611ef09e7aa": "TSM",
};
const QUOTES = new Set([WETH, USDG]);
const NOT_COINS = new Set([WETH, USDG, "0x0ff7a742b035504118a9d435c8264619a8428e1c"]);
// Kept off the board.
const EXCLUDE_NAMES = /boner/i;
const DEXES = { "uniswap-v3-robinhood": "v3", "uniswap-v4-robinhood": "v4", "pons-v2": "pons", "pons-v2-dex": "v4" };
const VENUE = { v3: "Uniswap V3", v4: "Uniswap V4", pons: "Pons curve" };
export const MAX_SLIPPAGE_BPS = 1000;

export class TerminalError extends Error { constructor(message, status = 503) { super(message); this.status = status; } }
const addr = (v) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null);
const reason = (e) => (e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : "unknown error").replace(/\s+/g, " ").slice(0, 180);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---------- budgets and caches ----------
const stamps = { feed: [], rpc: [], pairs: [] };
function budget(kind, n, limit) {
  const now = Date.now(); stamps[kind] = stamps[kind].filter((t) => t > now - 60000);
  if (stamps[kind].length + n > limit) throw new TerminalError("The terminal is cooling down. Try again in a moment.", 429);
  for (let i = 0; i < n; i++) stamps[kind].push(now);
}
const cache = new Map(), inflight = new Map();
async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const p = load().then((value) => { cache.set(key, { at: Date.now(), value }); if (cache.size > 800) cache.delete(cache.keys().next().value); return value; })
    .catch((e) => { if (hit) return hit.value; throw e; }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
async function feed(path, ttl = 60000) {
  return cached("feed:" + path, ttl, async () => {
    budget("feed", 1, 26);
    const r = await fetch(FEED + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (r.status === 429) throw new TerminalError("The pool feed is busy. Try again shortly.", 429);
    if (!r.ok) throw new TerminalError("The pool feed is unavailable right now.", 502);
    return r.json();
  });
}

let pinnedAt = 0;
async function checkPinned() {
  if (Date.now() - pinnedAt < 600000) return;
  budget("rpc", 7, 400);
  for (const [address, hash] of Object.entries(PINNED)) {
    const code = await client.getBytecode({ address });
    if (!code || keccak256(code) !== hash) throw new TerminalError("A contract on the buy route changed. Buys are paused until it is reviewed.");
  }
  pinnedAt = Date.now();
}

// ---------- list ----------
const included = (json) => new Map((json.included || []).map((x) => [x.id, x]));
const idAddress = (id) => (typeof id === "string" ? id.split("_").pop().toLowerCase() : null);
function poolRow(p, inc) {
  const a = p.attributes, rel = p.relationships || {};
  const dex = rel.dex?.data?.id || null, base = idAddress(rel.base_token?.data?.id), quote = idAddress(rel.quote_token?.data?.id);
  return {
    address: a.address?.toLowerCase(), name: a.name, dex, kind: DEXES[dex] || null, base, quote,
    baseToken: inc?.get(rel.base_token?.data?.id)?.attributes || null,
    priceUsd: num(a.base_token_price_usd), change24h: num(a.price_change_percentage?.h24), volume24h: num(a.volume_usd?.h24),
    liquidityUsd: num(a.reserve_in_usd), fdvUsd: num(a.fdv_usd), marketCapUsd: num(a.market_cap_usd), createdAt: a.pool_created_at || null,
    buys24h: a.transactions?.h24?.buys ?? null, sells24h: a.transactions?.h24?.sells ?? null,
  };
}
const routable = (pool) => pool.kind && (pool.kind === "pons" || QUOTES.has(pool.quote) || pool.quote === NATIVE);
// Pool figures describe the pool's base token, so they are used only when this coin is that base.
const coinFrom = (token, pool, group) => {
  const address = token.address.toLowerCase(), own = pool && pool.base === address;
  return {
    address, symbol: String(token.symbol || "").slice(0, 16), name: String(token.name || "").replace(/&amp;/g, "&").slice(0, 80),
    image: group !== "stocks" && /^https:\/\//.test(token.image_url || "") && !/missing/.test(token.image_url) ? token.image_url : null, decimals: token.decimals ?? null, group,
    priceUsd: own ? pool.priceUsd : num(token.price_usd), change24h: own ? pool.change24h : null,
    volume24h: own ? pool.volume24h : num(token.volume_usd?.h24), liquidityUsd: own ? pool.liquidityUsd : num(token.total_reserve_in_usd),
    fdvUsd: own ? pool.fdvUsd : num(token.fdv_usd), marketCapUsd: own ? pool.marketCapUsd : num(token.market_cap_usd),
    pool: own ? { address: pool.address, venue: pool.kind ? VENUE[pool.kind] : null, pair: pool.name, routable: routable(pool) } : null,
  };
};

const MAJORS = ["bitcoin", "ethereum", "solana", "binancecoin", "ripple", "hyperliquid"];
async function majors() {
  return cached("majors", 90000, async () => {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${MAJORS.join(",")}&price_change_percentage=24h`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return [];
    const rows = await r.json();
    return MAJORS.map((id) => rows.find((x) => x.id === id)).filter(Boolean).map((x) => ({
      id: x.id, symbol: String(x.symbol).toUpperCase(), name: x.name, priceUsd: num(x.current_price), change24h: num(x.price_change_percentage_24h),
      image: /^https:\/\/(coin-images|assets)\.coingecko\.com\//.test(x.image || "") ? x.image.replace("/large/", "/small/") : null,
    }));
  }).catch(() => []);
}

export async function getList() {
  return cached("list", 60000, async () => {
    const pages = await Promise.all([1, 2, 3].map((page) => feed(`/pools?page=${page}&include=base_token,quote_token,dex`, 60000).catch(() => null)));
    const memes = new Map();
    for (const json of pages.filter(Boolean)) {
      const inc = included(json);
      for (const p of json.data || []) {
        const pool = poolRow(p, inc), token = pool.baseToken;
        if (!token || !pool.base || NOT_COINS.has(pool.base) || /^W?ETH$/i.test(token.symbol || "") || STOCKS[pool.base] || / • Robinhood Token$/.test(token.name || "") || EXCLUDE_NAMES.test(token.name || "")) continue;
        if (!QUOTES.has(pool.quote) && pool.quote !== NATIVE) continue;
        const prev = memes.get(pool.base);
        const better = !prev || (routable(pool) && !prev.pool.routable) || (routable(pool) === prev.pool.routable && (pool.liquidityUsd ?? 0) > (prev.liquidityUsd ?? 0));
        if (better) memes.set(pool.base, coinFrom({ ...token, address: pool.base }, pool, "memes"));
      }
    }
    let stocks = [];
    try {
      const json = await feed(`/tokens/multi/${Object.keys(STOCKS).join(",")}?include=top_pools`, 120000);
      const inc = included(json);
      stocks = (json.data || []).map((t) => {
        const pools = (t.relationships?.top_pools?.data || []).map((x) => inc.get(x.id)).filter(Boolean).map((p) => poolRow(p, inc));
        const address = t.attributes.address.toLowerCase(), own = pools.filter((p) => p.base === address);
        const pool = own.filter(routable).sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0] || own[0] || null;
        return coinFrom(t.attributes, pool, "stocks");
      }).filter((c) => STOCKS[c.address]).sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
    } catch { stocks = []; }
    // Thin pools are mostly copies of a real coin under the same name; keep them off the board (an unknown reserve stays).
    const memeList = [...memes.values()].filter((c) => !(c.liquidityUsd > 0 && c.liquidityUsd < 10000)).sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, 32);
    if (!memeList.length && !stocks.length) throw new TerminalError("The pool feed returned no coins right now.", 502);
    return { memes: memeList, stocks, majors: await majors(), at: new Date().toISOString() };
  });
}

// ---------- one coin ----------
const PAIRS = "https://api.dexscreener.com/latest/dex/tokens/";
async function pairsOf(address) {
  return cached("pairs:" + address, 30000, async () => {
    budget("pairs", 1, 240);
    const r = await fetch(PAIRS + address, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new TerminalError("The pair feed is unavailable right now.", 502);
    const json = await r.json();
    return (json.pairs || []).filter((p) => p.chainId === "robinhood");
  });
}
const pairKind = (p) => p.dexId === "uniswap" && p.labels?.includes("v3") ? "v3" : p.dexId === "uniswap" && p.labels?.includes("v4") ? "v4" : null;
const pairRoutable = (p, address) => {
  const kind = pairKind(p), quote = p.quoteToken?.address?.toLowerCase();
  if (p.baseToken?.address?.toLowerCase() !== address || !kind) return false;
  return kind === "v3" ? quote === WETH || quote === USDG : quote === NATIVE || quote === USDG;
};
const pairView = (p) => ({ address: String(p.pairAddress).toLowerCase(), pair: `${p.baseToken?.symbol} / ${p.quoteToken?.symbol}`, venue: pairKind(p) ? VENUE[pairKind(p)] : (p.dexId ? p.dexId[0].toUpperCase() + p.dexId.slice(1) : "Other venue"), liquidityUsd: num(p.liquidity?.usd), volume24h: num(p.volume?.h24), change24h: num(p.priceChange?.h24), buys24h: p.txns?.h24?.buys ?? null, sells24h: p.txns?.h24?.sells ?? null });

export async function getCoin(input) {
  const address = addr(input);
  if (!address) throw new TerminalError("Provide a token address.", 400);
  return cached("coin:" + address, 30000, async () => {
    const pairs = (await pairsOf(address)).filter((p) => p.baseToken?.address?.toLowerCase() === address || p.quoteToken?.address?.toLowerCase() === address)
      .sort((a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0));
    const own = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === address);
    const route = own.filter((p) => pairRoutable(p, address))[0] || null;
    const lead = route || own[0] || null;
    let token = lead?.baseToken || pairs[0]?.quoteToken || null, decimals = null;
    budget("rpc", 3, 400);
    const [symbol, name, dec] = await Promise.all(["symbol", "name", "decimals"].map((functionName) => client.readContract({ address, abi: erc20Abi, functionName }).catch(() => null)));
    if (dec == null && !token) throw new TerminalError("This address is not a token on Robinhood Chain.", 404);
    decimals = dec == null ? null : Number(dec);
    let pons = null;
    if (!route) {
      budget("rpc", 1, 400);
      const r = await client.readContract({ address: PONS_FACTORY, abi: ponsAbi, functionName: "getLaunchedToken", args: [address] }).catch(() => null);
      if (r?.exists && Number(r.phase) === 0 && r.pairToken.toLowerCase() === NATIVE) pons = { kind: "pons", venue: VENUE.pons, pool: r.curve.toLowerCase(), pair: `${symbol || token?.symbol} / ETH`, quote: NATIVE, createdAt: null };
    }
    const kind = route ? pairKind(route) : null;
    return {
      address, symbol: String(symbol || token?.symbol || "").slice(0, 16), name: String(name || token?.name || "").slice(0, 80), decimals,
      group: STOCKS[address] ? "stocks" : "memes",
      // Stock tokens carry one shared placeholder image on the feeds, so the interface sets their ticker instead.
      image: STOCKS[address] ? null : /^https:\/\//.test(lead?.info?.imageUrl || "") ? lead.info.imageUrl : null,
      priceUsd: num(lead?.priceUsd), change24h: num(lead?.priceChange?.h24), volume24h: num(lead?.volume?.h24), liquidityUsd: num(lead?.liquidity?.usd),
      fdvUsd: num(lead?.fdv), marketCapUsd: num(lead?.marketCap), buys24h: lead?.txns?.h24?.buys ?? null, sells24h: lead?.txns?.h24?.sells ?? null,
      chartPool: lead ? String(lead.pairAddress).toLowerCase() : null,
      route: route ? { kind, venue: VENUE[kind], pool: String(route.pairAddress).toLowerCase(), pair: `${route.baseToken.symbol} / ${route.quoteToken.symbol}`, quote: route.quoteToken.address.toLowerCase(), createdAt: route.pairCreatedAt ? new Date(route.pairCreatedAt).toISOString() : null } : pons,
      pools: pairs.slice(0, 8).map(pairView),
      at: new Date().toISOString(),
    };
  });
}

const FRAMES = { "15m": ["minute", 15, 96], "1h": ["hour", 1, 96], "4h": ["hour", 4, 90], "1d": ["day", 1, 90] };
export async function getCandles(poolInput, frameInput) {
  const pool = typeof poolInput === "string" && /^0x[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/.test(poolInput) ? poolInput.toLowerCase() : null;
  const frame = FRAMES[frameInput] ? frameInput : "1h";
  if (!pool) throw new TerminalError("Provide a pool.", 400);
  const [unit, aggregate, limit] = FRAMES[frame];
  const json = await feed(`/pools/${pool}/ohlcv/${unit}?aggregate=${aggregate}&limit=${limit}&currency=usd&token=base`, 60000);
  const list = (json.data?.attributes?.ohlcv_list || []).map((r) => r.map(Number)).filter((r) => r.length >= 6 && r.every(Number.isFinite)).sort((a, b) => a[0] - b[0]);
  return { pool, frame, candles: list.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v })) };
}

// ---------- routes ----------
const pool3Abi = parseAbi(["function factory() view returns (address)", "function fee() view returns (uint24)", "function token0() view returns (address)", "function token1() view returns (address)"]);
const factory3Abi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const quoterAbi = parseAbi(["function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"]);
const v4QuoterAbi = parseAbi(["struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }", "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }", "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)"]);
const ponsAbi = parseAbi(["struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }", "function getLaunchedToken(address token) view returns (LaunchedToken)"]);

async function v3Pool(pool) {
  return cached("v3:" + pool, 3600000, async () => {
    budget("rpc", 4, 400);
    const [factory, fee, token0, token1] = await Promise.all(["factory", "fee", "token0", "token1"].map((functionName) => client.readContract({ address: pool, abi: pool3Abi, functionName })));
    if (factory.toLowerCase() !== V3_FACTORY) throw new TerminalError("This pool does not belong to the Uniswap V3 factory.", 422);
    return { fee: Number(fee), token0: token0.toLowerCase(), token1: token1.toLowerCase() };
  });
}
async function v3Quote(path, amountIn) {
  budget("rpc", 1, 400);
  const data = encodeFunctionData({ abi: quoterAbi, functionName: "quoteExactInput", args: [path, amountIn] });
  const { data: ret } = await client.call({ to: QUOTER_V2, data });
  return decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInput", data: ret })[0];
}
// The block at a time: interpolate from the chain's own pace, then correct twice (a few reads, not a bisection).
async function blockAt(ts) {
  budget("rpc", 2, 400);
  const latest = await client.getBlock();
  if (BigInt(ts) >= latest.timestamp) return latest.number;
  const back = latest.number > 2000000n ? latest.number - 2000000n : 1n, ref = await client.getBlock({ blockNumber: back });
  let rate = Number(latest.number - back) / Math.max(1, Number(latest.timestamp - ref.timestamp)), guess = latest.number - BigInt(Math.round(Number(latest.timestamp - BigInt(ts)) * rate));
  for (let i = 0; i < 2; i++) {
    if (guess < 1n) guess = 1n;
    budget("rpc", 1, 400);
    const b = await client.getBlock({ blockNumber: guess }), off = Number(BigInt(ts) - b.timestamp);
    if (Math.abs(off) < 30) break;
    guess += BigInt(Math.round(off * rate));
  }
  return guess;
}
/** The V4 pool key from the PoolManager's Initialize event near the pool's creation time, checked against the pool id. */
async function v4Key(id, createdAt) {
  return cached("v4:" + id, 86400000, async () => {
    const center = await blockAt(Math.floor(Date.parse(createdAt || 0) / 1000) || 0);
    for (const [from, to] of [[center - 4000n, center + 5999n], [center - 14000n, center - 4001n], [center + 6000n, center + 15999n]]) {
      budget("rpc", 1, 400);
      const logs = await client.request({ method: "eth_getLogs", params: [{ address: POOL_MANAGER, topics: [INITIALIZE, id], fromBlock: "0x" + (from > 0n ? from : 0n).toString(16), toBlock: "0x" + to.toString(16) }] });
      const l = logs?.[0];
      if (!l) continue;
      const key = { currency0: "0x" + l.topics[2].slice(26), currency1: "0x" + l.topics[3].slice(26), fee: Number(BigInt(l.data.slice(0, 66))), tickSpacing: Number(BigInt.asIntN(24, BigInt("0x" + l.data.slice(66, 130)))), hooks: "0x" + l.data.slice(154, 194) };
      if (poolIdOf(key) !== id) throw new TerminalError("The pool key does not hash to the pool id.", 422);
      return key;
    }
    throw new TerminalError("The pool's opening record was not found, so it cannot be routed.", 422);
  });
}
async function v4Quote(key, zeroForOne, amountIn) {
  budget("rpc", 1, 400);
  const data = encodeFunctionData({ abi: v4QuoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne, exactAmount: amountIn, hookData: "0x" }] });
  const { data: ret } = await client.call({ to: V4_QUOTER, data });
  return decodeFunctionResult({ abi: v4QuoterAbi, functionName: "quoteExactInputSingle", data: ret })[0];
}
// The deepest ETH -> USDG legs, found once: V3 by the factory, V4 by the feed's ETH/USDG pools.
async function usdgLegV3() { return cached("leg:v3", 3600000, async () => { const out = []; for (const fee of [100, 500]) { budget("rpc", 1, 400); const p = await client.readContract({ address: V3_FACTORY, abi: factory3Abi, functionName: "getPool", args: [WETH, USDG, fee] }); if (p !== NATIVE) out.push(fee); } return out; }); }
// ETH/USDG on V4 (native ETH, dynamic fee hook), read from its Initialize event on 2026-10-01; the id is checked on use.
const ETH_USDG_V4 = { id: "0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551", key: { currency0: NATIVE, currency1: USDG, fee: 8388608, tickSpacing: 10, hooks: "0x06a889870c8f83640d6816319f72e2aa579b6080" } };
async function usdgLegV4() {
  if (poolIdOf(ETH_USDG_V4.key) === ETH_USDG_V4.id) return ETH_USDG_V4.key;
  return cached("leg:v4", 3600000, async () => {
    const json = await feed(`/tokens/${USDG}/pools?include=dex&page=1`, 3600000);
    const pool = (json.data || []).map((p) => poolRow(p, null)).find((p) => p.kind === "v4" && (p.base === WETH || p.quote === WETH || p.base === NATIVE || p.quote === NATIVE) && p.address?.length === 66);
    if (!pool) throw new TerminalError("No ETH and USDG pool on Uniswap V4 was found.", 422);
    const key = await v4Key(pool.address, pool.createdAt);
    if (key.currency0 !== NATIVE || key.currency1 !== USDG) throw new TerminalError("The ETH and USDG pool does not use native ETH.", 422);
    return key;
  });
}

let curves = new Map();
async function ponsQuote(token, amountIn) {
  budget("rpc", 1, 400);
  const r = await client.readContract({ address: PONS_FACTORY, abi: ponsAbi, functionName: "getLaunchedToken", args: [token] });
  if (!r.exists) return { reason: "This coin was not launched on Pons V2." };
  if (r.pairToken.toLowerCase() !== NATIVE) return { reason: "This launch trades against another token, not ETH." };
  if (Number(r.phase) !== 0) return { reason: "This launch has left its curve. Its pool route is used once the feed lists it." };
  const curve = r.curve.toLowerCase();
  budget("rpc", 6, 400);
  const [graduated, ready, reserves, sellable, feeBps, taxBps] = await Promise.all(["graduated", "readyToGraduate", "getReserves", "sellableTokens", "feeBps", "creatorTaxBps"].map((functionName) => client.readContract({ address: curve, abi: curveAbi, functionName })));
  if (graduated || ready) return { reason: "The curve is full and waiting to graduate. Buys are closed until the pool opens." };
  const [qr, tr] = reserves, BPS = 10000n, fee = (amountIn * (feeBps + taxBps)) / BPS, net = amountIn - fee;
  let out = (net * tr) / (qr + net);
  if (out > sellable) return { reason: "That buy is larger than what the curve still sells. Try a smaller amount." };
  curves.set(token, curve); if (curves.size > 200) curves = new Map();
  return { curve, amountOut: out, fee };
}

export async function getQuote({ address: input, amount, account: acct, slippage }) {
  const address = addr(input);
  if (!address) throw new TerminalError("Provide a token address.", 400);
  if (!/^[1-9]\d{0,30}$/.test(amount || "")) throw new TerminalError("Provide an amount in wei.", 400);
  const amountIn = BigInt(amount);
  if (amountIn >= 1n << 120n) throw new TerminalError("That amount is too large.", 400);
  const account = acct ? addr(acct) : null;
  if (acct && !account) throw new TerminalError("Invalid account.", 400);
  const slippageBps = Math.min(MAX_SLIPPAGE_BPS, Math.max(10, Math.floor(Number(slippage)) || 100));
  const coin = await getCoin(address);
  const base = { address, symbol: coin.symbol, decimals: coin.decimals, amountIn: amountIn.toString(), slippageBps, route: null, amountOut: null, minOut: null, tx: null, reason: null, at: new Date().toISOString() };
  if (!coin.route) return { ...base, reason: "No Uniswap or Pons pool against ETH or USDG was found for this coin, so Onegate cannot route a buy." };
  await checkPinned();
  const minOf = (out) => (out * BigInt(10000 - slippageBps)) / 10000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const { kind, pool, quote } = coin.route;
  try {
    if (kind === "v3") {
      const p = await v3Pool(pool);
      if (![p.token0, p.token1].includes(address)) throw new TerminalError("The pool does not hold this coin.", 422);
      let best = null;
      const legs = quote === WETH ? [[WETH, p.fee, address]] : (await usdgLegV3()).map((fee) => [WETH, fee, USDG, p.fee, address]);
      for (const hops of legs) { const path = v3Path(hops); const out = await v3Quote(path, amountIn); if (!best || out > best.out) best = { path, out, hops }; }
      if (!best || best.out === 0n) return { ...base, reason: "The pool returns nothing for that amount." };
      const minOut = minOf(best.out);
      return { ...base, route: { kind, venue: "Uniswap V3", via: quote === WETH ? "ETH" : "ETH → USDG", pool, path: best.path, fees: best.hops.filter((_, i) => i % 2).map(Number) }, amountOut: best.out.toString(), minOut: minOut.toString(), deadline: deadline.toString(), tx: account ? { to: SWAP_ROUTER02, data: encodeV3Buy(best.path, account, amountIn, minOut, deadline), value: amountIn.toString() } : null };
    }
    if (kind === "v4") {
      const key = await v4Key(pool, coin.route.createdAt);
      if (![key.currency0, key.currency1].includes(address)) throw new TerminalError("The pool does not hold this coin.", 422);
      const other = key.currency0 === address ? key.currency1 : key.currency0;
      const hops = [];
      if (other === NATIVE) hops.push({ key, zeroForOne: key.currency0 === NATIVE });
      else if (other === USDG) { const leg = await usdgLegV4(); hops.push({ key: leg, zeroForOne: true }, { key, zeroForOne: key.currency0 === USDG }); }
      else return { ...base, reason: "This pool trades against a token Onegate does not route through." };
      let out = amountIn;
      for (const h of hops) out = await v4Quote(h.key, h.zeroForOne, out);
      if (out === 0n) return { ...base, reason: "The pool returns nothing for that amount." };
      const minOut = minOf(out);
      return { ...base, route: { kind, venue: "Uniswap V4", via: hops.length > 1 ? "ETH → USDG" : "ETH", pool, keys: hops.map((h) => ({ ...h.key, zeroForOne: h.zeroForOne })) }, amountOut: out.toString(), minOut: minOut.toString(), deadline: deadline.toString(), tx: account ? { to: UNIVERSAL_ROUTER, data: encodeV4Buy(hops, amountIn, minOut, deadline), value: amountIn.toString() } : null };
    }
    if (kind === "pons") {
      const q = await ponsQuote(address, amountIn);
      if (q.reason) return { ...base, reason: q.reason };
      const minOut = minOf(q.amountOut);
      return { ...base, route: { kind, venue: "Pons curve", via: "ETH", pool: q.curve, curve: q.curve, feeWei: q.fee.toString() }, amountOut: q.amountOut.toString(), minOut: minOut.toString(), tx: account ? { to: q.curve, data: encodeCurveBuy(amountIn, minOut, account), value: amountIn.toString() } : null };
    }
  } catch (e) {
    if (e instanceof TerminalError) throw e;
    return { ...base, reason: `The route could not quote this amount (${reason(e)}).` };
  }
  return { ...base, reason: "This venue is not routed here." };
}

/** Dry-run the exact transaction the wallet is about to sign, from the user's own account. Only quoted routes. */
export async function simulate(body) {
  const b = body && typeof body === "object" ? body : {};
  const from = addr(b.from), to = addr(b.to), token = addr(b.token);
  const data = typeof b.data === "string" && /^0x(?:[0-9a-fA-F]{2}){4,16384}$/.test(b.data) ? b.data : null;
  const value = typeof b.value === "string" && /^(0|[1-9]\d{0,30})$/.test(b.value) ? BigInt(b.value) : null;
  if (!from || !to || !data || value === null || !token) throw new TerminalError("Invalid transaction to simulate.", 400);
  if (to !== SWAP_ROUTER02 && to !== UNIVERSAL_ROUTER && curves.get(token) !== to) throw new TerminalError("Only a quoted route can be simulated. Quote first.", 400);
  await checkPinned();
  budget("rpc", 2, 400);
  try {
    await client.call({ account: from, to, data, value });
    const gas = await client.estimateGas({ account: from, to, data, value });
    return { ok: true, gas: ((gas * 13n) / 10n).toString(), at: new Date().toISOString() };
  } catch (e) {
    throw new TerminalError(`The chain rejected this buy in a dry run: ${reason(e)}`, 422);
  }
}

const multicallAbi = parseAbi(["struct Call3 { address target; bool allowFailure; bytes callData; }", "struct Result { bool success; bytes returnData; }", "function aggregate3(Call3[] calls) payable returns (Result[] returnData)", "function getEthBalance(address addr) view returns (uint256 balance)"]);
/** ETH and the balance of every coin on the board, in one Multicall3 read. A failed call reads as unknown, never as zero. */
export async function getBalances(input) {
  const account = addr(input);
  if (!account) throw new TerminalError("Provide a wallet address.", 400);
  return cached("bal:" + account, 8000, async () => {
    const list = await getList();
    const coins = [...list.memes, ...list.stocks];
    const calls = [...coins.map((c) => ({ target: c.address, allowFailure: true, callData: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [account] }) })), { target: MULTICALL3, allowFailure: true, callData: encodeFunctionData({ abi: multicallAbi, functionName: "getEthBalance", args: [account] }) }];
    budget("rpc", 1, 400);
    const { data: ret } = await client.call({ to: MULTICALL3, data: encodeFunctionData({ abi: multicallAbi, functionName: "aggregate3", args: [calls] }) });
    const rows = decodeFunctionResult({ abi: multicallAbi, functionName: "aggregate3", data: ret }).map((r) => (r.success && r.returnData.length >= 66 ? BigInt(r.returnData.slice(0, 66)) : null));
    const eth = rows.pop();
    return { account, eth: eth == null ? null : eth.toString(), items: coins.map((c, i) => ({ address: c.address, raw: rows[i] == null ? null : rows[i].toString() })).filter((x) => x.raw !== "0"), at: new Date().toISOString() };
  });
}
