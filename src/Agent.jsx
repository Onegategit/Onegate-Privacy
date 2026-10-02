import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, ArrowUp, ArrowUpRight, Check, CircleHelp, Coins, EyeOff, LayoutList, LockKeyhole, PenLine, RefreshCw, ShieldCheck, Square, TriangleAlert, Wallet, X } from 'lucide-react';
import { HOLDER_MIN_USD, IDENTITY } from './identity';
import { useTerminalWallet, walletError } from './terminal-wallet';
import { AGENT_MAX_INPUT, AGENT_SESSION_HOURS, SUGGESTIONS, agentSignInMessage } from './agent-message';
import ContractTag from './ContractTag';
import './agent.css';

const usd = (v, max = 2) => v == null ? '—' : '$' + v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : max, minimumFractionDigits: v >= 1000 || Number.isInteger(v) ? 0 : Math.min(2, max) });
const price = (v) => v == null ? '—' : v >= 1 ? usd(v) : '$' + v.toPrecision(4);
const big = (v) => v == null ? '—' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : usd(v);
const amt = (v) => v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : 6 });
const pct = (v) => v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(2) + '%';
const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
const KEY = 'onegate.agent.session.v1';

const TOOLS = [
  [LayoutList, 'The board', 'Coins on the terminal with price, liquidity and volume'],
  [Coins, 'A token', 'Price source, pools, route and the last 24 hours'],
  [ArrowLeftRight, 'A buy quote', 'Route, amount and minimum, then the terminal reviews it'],
  [Wallet, 'Your wallet', 'ETH, coins and your $OGATE against the gate'],
  [ShieldCheck, 'The private pools', 'Notes, 24 hour activity, fees and minimums'],
  [EyeOff, 'A withdrawal plan', 'Fee, amount received and what could link it'],
];

/** The logo's slot as the agent's mark: a pinched opening with ember on its straight edges; the edges breathe while it works. */
const Slot = ({ live }) => <svg className={'agent-slot' + (live ? ' live' : '')} viewBox="0 0 44 26" aria-hidden="true">
  <rect width="44" height="26" rx="4" />
  <path d="M3 4 L15 11 L29 11 L41 4 L41 22 L29 15 L15 15 L3 22 Z" />
  <line x1="15" y1="11" x2="29" y2="11" /><line x1="15" y1="15" x2="29" y2="15" />
</svg>;

/** Agent text: paragraphs, "- " lists and **bold**. Everything else stays plain text. */
function Prose({ text }) {
  const blocks = text.replace(/\s*—\s*/g, ', ').trim().split(/\n{2,}/);
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/).map((x, i) => x.startsWith('**') && x.endsWith('**') ? <b key={k + '-' + i}>{x.slice(2, -2)}</b> : x);
  return blocks.map((b, i) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ''), i + '-' + j)}</li>)}</ul>;
    return <p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l, i + '-' + j)}</span>)}</p>;
  });
}

const LEVEL = { pass: [Check, 'Pass'], warn: [TriangleAlert, 'Watch'], risk: [X, 'Risk'], block: [X, 'Blocked'], unknown: [CircleHelp, 'Not given'] };

function Card({ card }) {
  if (card.kind === 'quote') return <div className="agent-card">
    <header><b>Buy {card.symbol}</b><span>{card.venue ? `${card.venue} · via ${card.via}` : 'No route'}</span></header>
    {card.reason ? <p className="agent-card-note">{card.reason}</p> : <dl>
      <div><dt>You pay</dt><dd>{card.eth} ETH</dd></div>
      <div><dt>You receive about</dt><dd>{amt(card.expected)} {card.symbol}</dd></div>
      <div><dt>At least</dt><dd>{amt(card.minimum)} {card.symbol} · {card.slippagePercent}% slippage</dd></div>
    </dl>}
    {!card.reason && <><Link className="button" to={card.link}>Review in the terminal<ArrowUpRight /></Link>
      <p className="agent-card-note">Opens the terminal with {card.eth} ETH filled in. The terminal quotes again, dry-runs the call and your wallet asks before anything moves.</p></>}
  </div>;
  if (card.kind === 'privacy') return <div className="agent-card">
    <header><b>Withdrawal check · {card.amount} {card.symbol}</b><span>{card.passed} of {card.of} pass</span></header>
    <dl>
      <div><dt>Fee</dt><dd>{card.fee == null ? '—' : `${amt(card.fee)} ${card.symbol}`}<small>{card.flatFee != null && card.feeRateBps != null ? `${card.flatFee} flat + ${card.feeRateBps / 100}%` : ''}</small></dd></div>
      <div><dt>You receive</dt><dd>{card.receive == null ? '—' : `${amt(card.receive)} ${card.symbol}`}</dd></div>
    </dl>
    <ul className="agent-checks">{card.checks.map((c) => { const [Icon, word] = LEVEL[c.level] || LEVEL.unknown; return <li key={c.id} data-level={c.level}><Icon size={15} aria-label={word} /><span><b>{c.title}</b>{c.detail}</span></li>; })}</ul>
    <Link className="button paper" to="/privacy">Open the workspace<ArrowUpRight /></Link>
    <p className="agent-card-note">{card.note}</p>
  </div>;
  if (card.kind === 'pools') return <div className="agent-card">
    <header><b>Private pools</b><span>fee = flat + {card.feeRateBps / 100}%</span></header>
    <table className="agent-table"><thead><tr><th /><th>ETH</th><th>USDG</th></tr></thead><tbody>
      {[['Notes', (p) => p.notes?.toLocaleString('en-US') ?? '—'], ['New in 24h', (p) => p.notes24h ?? '—'], ['Min. deposit', (p) => p.minimumDeposit], ['Min. withdrawal', (p) => p.minimumWithdrawal], ['Flat fee', (p) => p.flatFee]].map(([label, f]) =>
        <tr key={label}><th>{label}</th><td>{f(card.pools.eth)}</td><td>{f(card.pools.usdg)}</td></tr>)}
    </tbody></table>
  </div>;
  if (card.kind === 'wallet') { const share = card.ogate.worthUsd != null ? Math.min(1, card.ogate.worthUsd / card.ogate.gateUsd) : 0; return <div className="agent-card">
    <header><b>Your wallet</b><span>{short(card.account)}</span></header>
    <dl>
      <div><dt>ETH</dt><dd>{amt(card.eth)}</dd></div>
      <div><dt>$OGATE</dt><dd>{amt(card.ogate.amount)}<small>{usd(card.ogate.worthUsd)}</small></dd></div>
    </dl>
    <div className="gate-meter" role="progressbar" aria-label={`Share of the $${card.ogate.gateUsd} gate`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}><i style={{ width: share * 100 + '%' }} /></div>
    {card.holdings.length > 0 && <table className="agent-table"><tbody>{card.holdings.map((h) => <tr key={h.address}><th>{h.symbol}</th><td>{amt(h.amount)}</td><td>{usd(h.usd)}</td></tr>)}</tbody></table>}
  </div>; }
  if (card.kind === 'token') return <div className="agent-card">
    <header><b>{card.symbol}</b><span>{short(card.address)}{card.holders != null ? ` · ${card.holders.toLocaleString('en-US')} holders` : ''}</span></header>
    <dl className="agent-grid">
      <div><dt>Price</dt><dd>{price(card.priceUsd)}<small className={card.change24h > 0 ? 'up' : card.change24h < 0 ? 'down' : ''}>{pct(card.change24h)}</small></dd></div>
      <div><dt>Market cap</dt><dd>{big(card.marketCapUsd)}</dd></div>
      <div><dt>Liquidity</dt><dd>{big(card.liquidityUsd)}</dd></div>
      <div><dt>Volume 24h</dt><dd>{big(card.volume24h)}</dd></div>
      <div><dt>Buys / sells</dt><dd>{card.buys24h ?? '—'} / {card.sells24h ?? '—'}</dd></div>
      <div><dt>Route</dt><dd>{card.route ? card.route.venue : 'None'}</dd></div>
    </dl>
    <Link className="button paper" to={'/terminal/' + card.address}>Open in the terminal<ArrowUpRight /></Link>
  </div>;
  if (card.kind === 'board') return <div className="agent-card">
    <header><b>{card.query ? `Board · ${card.query.toUpperCase()}` : 'The board'}</b><span>{card.coins.length} shown</span></header>
    <table className="agent-table"><tbody>{card.coins.map((c) => <tr key={c.address}><th><Link to={'/terminal/' + c.address}>{c.symbol}</Link><small>{short(c.address)}</small></th><td>{price(c.priceUsd)}</td><td className={c.change24h > 0 ? 'up' : c.change24h < 0 ? 'down' : ''}>{pct(c.change24h)}</td><td>{big(c.liquidityUsd)}</td></tr>)}</tbody></table>
  </div>;
  return null;
}

function Turn({ m }) {
  if (m.role === 'user') return <div className="agent-turn user"><p>{m.text}</p></div>;
  const empty = !m.parts.length;
  return <div className="agent-turn agent">
    <Slot live={m.live} />
    <div className="agent-body">
      {empty && m.live && <p className="agent-wait">Reading</p>}
      {m.parts.map((p, i) => p.type === 'text' ? <div className="agent-prose" key={i}><Prose text={p.text} /></div>
        : p.type === 'tool' ? <div className="agent-tool" key={i} data-state={p.state}><span className="agent-dot" />{p.label}{p.card && p.state === 'done' && <Card card={p.card} />}</div>
        : <p className="agent-error" role="alert" key={i}>{p.text}</p>)}
    </div>
  </div>;
}

async function* events(response) {
  const reader = response.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      let event = 'message', data = '';
      for (const line of chunk.split('\n')) { if (line.startsWith('event: ')) event = line.slice(7); else if (line.startsWith('data: ')) data += line.slice(6); }
      if (data) yield { event, data: JSON.parse(data) };
    }
  }
}
const wire = (m) => m.role === 'user' ? { role: 'user', text: m.text } : { role: 'assistant', text: m.parts.filter((p) => p.type === 'text').map((p) => p.text).join('').trim() || 'I could not answer that.' };

function readSession(account) {
  try { const s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return s && s.account === account && s.expiresAt > Date.now() + 60e3 ? s : null; } catch { return null; }
}

export default function Agent() {
  const wallet = useTerminalWallet(), account = wallet.account;
  const [status, setStatus] = useState(null);
  const [holder, setHolder] = useState({ state: 'idle' });
  const [session, setSession] = useState(null);
  const [sign, setSign] = useState({ state: 'idle' });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef(null), list = useRef(null), field = useRef(null), stick = useRef(true);

  useEffect(() => { fetch('/api/agent?action=status').then((r) => r.json()).then(setStatus).catch(() => setStatus({ configured: false, error: true })); }, []);
  useEffect(() => { setSession(account ? readSession(account) : null); setMessages([]); }, [account]);

  const check = useCallback(async () => {
    if (!account) { setHolder({ state: 'idle' }); return; }
    setHolder((h) => ({ state: 'checking', data: h.data?.account === account ? h.data : null }));
    try {
      const r = await fetch('/api/terminal?action=holder&account=' + account), d = await r.json();
      if (!r.ok) throw new Error(d?.error || 'The balance could not be read.');
      setHolder({ state: d.ok ? 'open' : d.worthUsd == null ? 'unknown' : 'short', data: d });
    } catch (e) { setHolder({ state: 'error', error: e.message }); }
  }, [account]);
  useEffect(() => { if (status?.configured && !session) void check(); }, [status?.configured, session, check]);

  const signIn = async () => {
    setSign({ state: 'busy' });
    try {
      const issued = new Date().toISOString(), nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      const signature = await wallet.signMessage(agentSignInMessage(account, issued, nonce), account);
      const r = await fetch('/api/agent?action=session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, issued, nonce, signature }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'The sign-in did not go through.');
      const s = { account: d.account, token: d.token, expiresAt: d.expiresAt };
      try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
      setSession(s); setSign({ state: 'idle' });
    } catch (e) { setSign({ state: 'error', error: walletError(e, e instanceof Error ? e.message : 'The sign-in did not go through.') }); }
  };
  const signOut = () => { try { sessionStorage.removeItem(KEY); } catch { /* private mode */ } setSession(null); setMessages([]); };

  const ask = async (text) => {
    const q = text.trim().slice(0, AGENT_MAX_INPUT);
    if (!q || busy || !session) return;
    const next = [...messages, { role: 'user', text: q }, { role: 'assistant', parts: [], live: true }];
    stick.current = true; setMessages(next); setInput(''); setBusy(true);
    const ac = new AbortController(); abort.current = ac;
    const patch = (fn) => setMessages((ms) => { const copy = ms.slice(), last = { ...copy[copy.length - 1] }; last.parts = fn(last.parts.slice()); copy[copy.length - 1] = last; return copy; });
    try {
      const r = await fetch('/api/agent?action=chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: session.token, messages: next.slice(0, -1).map(wire) }), signal: ac.signal });
      if (!r.ok || !(r.headers.get('content-type') || '').includes('text/event-stream')) {
        const d = await r.json().catch(() => ({}));
        if (r.status === 401 || r.status === 403) signOut();
        throw new Error(d.error || 'The agent could not answer.');
      }
      for await (const { event, data } of events(r)) {
        if (event === 'text') patch((parts) => { const last = parts[parts.length - 1]; if (last?.type === 'text') parts[parts.length - 1] = { ...last, text: last.text + data.delta }; else parts.push({ type: 'text', text: data.delta }); return parts; });
        else if (event === 'tool') patch((parts) => { const i = parts.findIndex((p) => p.type === 'tool' && p.id === data.id); const part = { ...(i >= 0 ? parts[i] : {}), type: 'tool', ...data }; if (i >= 0) parts[i] = part; else parts.push(part); return parts; });
        else if (event === 'error') patch((parts) => [...parts, { type: 'error', text: data.error }]);
      }
    } catch (e) {
      if (e?.name !== 'AbortError') patch((parts) => [...parts, { type: 'error', text: e instanceof Error ? e.message : 'The agent could not answer.' }]);
    } finally {
      setMessages((ms) => { const copy = ms.slice(); if (copy.length) copy[copy.length - 1] = { ...copy[copy.length - 1], live: false }; return copy; });
      setBusy(false); abort.current = null; field.current?.focus();
    }
  };
  // follow the answer while it streams, unless the reader has scrolled up
  useEffect(() => { const el = list.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [messages]);
  useEffect(() => () => abort.current?.abort(), []);

  const d = holder.data, share = d?.worthUsd != null ? Math.min(1, d.worthUsd / HOLDER_MIN_USD) : 0;
  let gate = null;
  if (!status) gate = <div className="agent-gate" aria-busy="true"><p className="gate-note">Checking the agent</p></div>;
  else if (!status.configured) gate = <div className="agent-gate"><div className="gate-head"><LockKeyhole size={22} /><div><h2>The agent is not switched on yet</h2><p>It opens here for holders of {usd(HOLDER_MIN_USD)} of {IDENTITY.ticker} as soon as its service key is set. The terminal and the workspace work as before.</p></div></div></div>;
  else if (!account) gate = <div className="agent-gate"><div className="gate-head"><LockKeyhole size={22} /><div><h2>Hold {usd(HOLDER_MIN_USD)} of {IDENTITY.ticker} to use it</h2><p>Connect the wallet you hold {IDENTITY.ticker} in. Onegate reads the balance on Robinhood Chain, then you sign one message to open the agent.</p></div></div>
    <div className="gate-actions"><button type="button" className="button" onClick={() => wallet.connect()} disabled={wallet.busy}>{wallet.busy ? 'Waiting for wallet' : 'Connect wallet'}<Wallet /></button></div>
    {wallet.error && <p className="gate-note warn" role="alert">{wallet.error}</p>}</div>;
  else if (!session) gate = <div className="agent-gate">
    <div className="gate-head">{holder.state === 'open' ? <PenLine size={22} /> : <LockKeyhole size={22} />}<div><h2>{holder.state === 'open' ? 'Sign in to the agent' : `Hold ${usd(HOLDER_MIN_USD)} of ${IDENTITY.ticker} to use it`}</h2>
      <p>{holder.state === 'open' ? `Your wallet signs one message. It is not a transaction and cannot move funds. The session lasts ${AGENT_SESSION_HOURS} hours in this tab.` : `Onegate reads the ${IDENTITY.ticker} balance of ${short(account)} on Robinhood Chain.`}</p></div></div>
    <dl className="gate-read">
      <div><dt>Wallet</dt><dd>{short(account)}</dd></div>
      <div><dt>Holds</dt><dd>{d ? amt(Math.round(d.amount)) + ' ' + IDENTITY.ticker.slice(1) : '—'}</dd></div>
      <div><dt>Worth</dt><dd>{d?.worthUsd != null ? usd(d.worthUsd) : '—'}</dd></div>
      <div><dt>Needed</dt><dd>{usd(HOLDER_MIN_USD)}</dd></div>
    </dl>
    <div className="gate-meter" role="progressbar" aria-label={'Share of the ' + usd(HOLDER_MIN_USD) + ' needed'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}><i style={{ width: share * 100 + '%' }} /></div>
    {holder.state === 'checking' && <p className="gate-note">Reading the {IDENTITY.ticker} balance of {short(account)}</p>}
    {holder.state === 'short' && <p className="gate-note">{d.amount > 0 ? `This wallet holds about ${usd(d.worthUsd)} of ${IDENTITY.ticker}. Add about ${usd(Math.max(0, HOLDER_MIN_USD - d.worthUsd))} more to open the agent.` : `This wallet holds no ${IDENTITY.ticker} yet.`}</p>}
    {holder.state === 'unknown' && <p className="gate-note warn">The {IDENTITY.ticker} price could not be read right now. Try again in a moment.</p>}
    {holder.state === 'error' && <p className="gate-note warn" role="alert">{holder.error}</p>}
    {holder.state === 'open' && <pre className="agent-message" aria-label="The message you sign">{agentSignInMessage(account, '<now>', '<random>')}</pre>}
    {sign.state === 'error' && <p className="gate-note warn" role="alert">{sign.error}</p>}
    <div className="gate-actions">
      {holder.state === 'open' ? <button type="button" className="button" onClick={signIn} disabled={sign.state === 'busy'}>{sign.state === 'busy' ? 'Waiting for the signature' : 'Sign in'}<PenLine /></button>
        : <Link className="button" to={'/terminal/' + IDENTITY.contract}>Buy {IDENTITY.ticker} in the terminal<ArrowUpRight /></Link>}
      {holder.state !== 'open' && <button type="button" className="button paper" onClick={check} disabled={holder.state === 'checking'}>Check again<RefreshCw /></button>}
    </div>
  </div>;

  return <main className="page agent-page">
    <div className="page-heading agent-heading"><div><span className="eyebrow">Robinhood Chain · holders</span><h1>Agent</h1></div><p>Ask about the market and plan private transfers. It reads the terminal and the private pools for you, and never signs or sends.</p></div>
    <div className="agent-layout">
      <section className="agent-panel" aria-label="Agent conversation">
        {gate || <>
          <div className="agent-list" ref={list} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
            {!messages.length && <div className="agent-empty">
              <Slot />
              <h2>What should it read for you?</h2>
              <div className="agent-suggest">{SUGGESTIONS.map((s) => <button type="button" key={s} onClick={() => ask(s)}>{s}<ArrowUpRight size={14} /></button>)}</div>
            </div>}
            {messages.map((m, i) => <Turn m={m} key={i} />)}
          </div>
          <form className="agent-compose" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
            <label className="sr-only" htmlFor="agent-input">Ask the agent</label>
            <textarea id="agent-input" ref={field} rows={1} value={input} maxLength={AGENT_MAX_INPUT} placeholder="Ask about a coin, a buy or a private withdrawal" onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(input); } }} />
            {busy ? <button type="button" className="agent-send stop" onClick={() => abort.current?.abort()} aria-label="Stop the answer"><Square size={16} /></button>
              : <button type="submit" className="agent-send" disabled={!input.trim()} aria-label="Send"><ArrowUp size={18} /></button>}
          </form>
        </>}
      </section>
      <aside className="agent-rail">
        <section><h3>What it reads</h3><ul className="agent-reads">{TOOLS.map(([Icon, title, sub]) => <li key={title}><Icon size={18} /><span><b>{title}</b>{sub}</span></li>)}</ul></section>
        <section><h3>What it never does</h3><ul className="agent-never"><li>Sign, send or approve anything</li><li>Ask for a seed phrase or private key</li><li>Tell you what to buy</li></ul></section>
        {session && <section><h3>Session</h3><dl className="agent-session"><div><dt>Wallet</dt><dd>{short(session.account)}</dd></div><div><dt>Until</dt><dd>{new Date(session.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</dd></div></dl><button type="button" className="text-link" onClick={signOut}>Sign out</button></section>}
        <p className="agent-ca">{IDENTITY.ticker} · CA <ContractTag /></p>
      </aside>
    </div>
  </main>;
}
