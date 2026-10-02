import { AgentError, openSession, startChat, status } from "../server/agent.js";

// The agent: status (GET), session (POST, a signed sign-in message) and chat (POST, streamed as server-sent events).
const readBody = (req) => new Promise((resolve, reject) => {
  if (req.body && typeof req.body === "object") return resolve(req.body);
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 64000) reject(new AgentError("Request too large.", 413)); });
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new AgentError("Invalid JSON.", 400)); } });
  req.on("error", reject);
});
const json = (res, code, data) => {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
};

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  const action = new URL(req.url, "http://localhost").searchParams.get("action");
  try {
    if (req.method === "GET" && action === "status") return json(res, 200, status());
    if (req.method !== "POST") throw new AgentError("Method not allowed.", 405);
    if (!/^application\/json/i.test(req.headers["content-type"] || "")) throw new AgentError("Send JSON.", 415);
    const body = await readBody(req);
    if (action === "session") return json(res, 200, await openSession(body));
    if (action !== "chat") throw new AgentError("Unknown action.", 400);
    const run = await startChat(body);
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ac.abort(); });
    const emit = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    try { await run(emit, ac.signal); }
    catch (e) { if (!ac.signal.aborted) emit("error", { error: e instanceof AgentError ? e.message : "The agent could not finish this answer. Ask again." }); }
    res.end();
  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    json(res, e instanceof AgentError ? e.status : 500, { error: e instanceof AgentError ? e.message : "The agent could not complete this request.", ...(e instanceof AgentError && e.extra ? e.extra : {}) });
  }
}
