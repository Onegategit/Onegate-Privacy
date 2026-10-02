import { TerminalError, getBalances, getCandles, getCoin, getHolder, getList, getQuote, simulate } from "../server/terminal.js";

// One function for the coin terminal: list, coin, candles, quote, balances, holder (GET) and simulate (POST).
const readBody = (req) => new Promise((resolve, reject) => {
  if (req.body && typeof req.body === "object") return resolve(req.body);
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 64000) reject(new TerminalError("Request too large.", 413)); });
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new TerminalError("Invalid JSON.", 400)); } });
  req.on("error", reject);
});

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const url = new URL(req.url, "http://localhost"), q = Object.fromEntries(url.searchParams), action = q.action;
  try {
    let data, cache = "no-store";
    if (req.method === "POST" && action === "simulate") data = await simulate(await readBody(req));
    else if (req.method !== "GET") throw new TerminalError("Method not allowed.", 405);
    else if (action === "list") { data = await getList(); cache = "public, s-maxage=30, stale-while-revalidate=120"; }
    else if (action === "coin") { data = await getCoin(q.address); cache = "public, s-maxage=20, stale-while-revalidate=60"; }
    else if (action === "candles") { data = await getCandles(q.pool, q.frame); cache = "public, s-maxage=30, stale-while-revalidate=120"; }
    else if (action === "quote") data = await getQuote(q);
    else if (action === "balances") data = await getBalances(q.account);
    else if (action === "holder") data = await getHolder(q.account);
    else throw new TerminalError("Unknown action.", 400);
    res.setHeader("Cache-Control", cache);
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = e instanceof TerminalError ? e.status : 500;
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: e instanceof TerminalError ? e.message : "The terminal could not complete this request." }));
  }
}
