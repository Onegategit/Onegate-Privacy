import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Copy, Check, Search, Wallet, X, RefreshCw } from 'lucide-react';
import { formatUnits, parseEther } from 'viem';
import { SWAP_ROUTER02, UNIVERSAL_ROUTER, encodeCurveBuy, encodeV3Buy, encodeV4Buy } from './terminal-route';
import { EXPLORER, useTerminalWallet, walletError } from './terminal-wallet';
import { WordmarkSvg } from './Wordmark';
import DockWallet from './DockWallet';
import GithubMark from './GithubMark';
import { IDENTITY } from './identity';
import './terminal.css';

// The coin terminal: Robinhood Chain coins, a chart, the pools, and a buy with ETH from the user's own wallet.
const api = (q, init) => fetch('/api/terminal?' + new URLSearchParams(q), { signal: AbortSignal.timeout(30000), ...init }).then(async r => { const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.error || 'The terminal is unavailable.'); return b; });
const price = p => p == null ? '—' : '$' + (p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 1 ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p.toLocaleString('en-US', { maximumSignificantDigits: 4 }));
const usd = v => v == null ? '—' : '$' + (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0));
const pct = c => c == null ? '—' : (c > 0 ? '+' : '') + c.toFixed(2) + '%';
const dir = c => c > 0 ? 'up' : c < 0 ? 'down' : undefined;
const amount = (raw, decimals, max = 4) => { if (raw == null || decimals == null) return '—'; const n = Number(formatUnits(BigInt(raw), decimals)); return n === 0 ? '0' : n < 1e-4 ? n.toExponential(2) : n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : max }); };
const short = a => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const isAddress = v => /^0x[0-9a-fA-F]{40}$/.test(v);

function Logo({ src, symbol, size = 28 }) {
  const [bad, setBad] = useState(false);
  return src && !bad ? <img className="t-logo" src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <span className="t-logo t-logo-text" style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size / (Math.min(4, (symbol || '?').length) + 1))) }}>{(symbol || '?').slice(0, 4)}</span>;
}

function Chart({ pool }) {
  const [frame, setFrame] = useState('1h'), [data, setData] = useState(null), [error, setError] = useState('');
  const canvas = useRef(null), [hover, setHover] = useState(null);
  useEffect(() => {
    if (!pool) return;
    let alive = true; setData(null); setError('');
    api({ action: 'candles', pool, frame }).then(d => { if (alive) setData(d.candles); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [pool, frame]);
  const draw = useCallback(() => {
    const cv = canvas.current; if (!cv || !data?.length) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const padR = 72, padT = 16, padB = 24, cw = (w - padR) / data.length;
    const lo = Math.min(...data.map(c => c.l)), hi = Math.max(...data.map(c => c.h)), span = hi - lo || hi * .01 || 1;
    const y = v => padT + (1 - (v - lo) / span) * (h - padT - padB);
    ctx.font = '500 11px "Spline Sans Mono Variable", monospace'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = lo + span * i / 4, yy = Math.round(y(v)) + .5;
      ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillStyle = '#7d8ca3'; ctx.fillText(price(v), w - padR + 8, yy);
    }
    data.forEach((c, i) => {
      const x = i * cw + cw / 2, up = c.c >= c.o, col = up ? '#6ee0a6' : '#ffb4a3';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, y(c.h)); ctx.lineTo(Math.round(x) + .5, y(c.l)); ctx.stroke();
      const top = y(Math.max(c.o, c.c)), bh = Math.max(1, y(Math.min(c.o, c.c)) - top), bw = Math.max(1, cw * .62);
      ctx.fillRect(x - bw / 2, top, bw, bh);
    });
    const last = data[data.length - 1], ly = Math.round(y(last.c)) + .5;
    ctx.strokeStyle = '#ff8a3d'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(w - padR, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ff8a3d'; ctx.fillRect(w - padR + 2, ly - 9, padR - 4, 18); ctx.fillStyle = '#04050f'; ctx.fillText(price(last.c), w - padR + 8, ly);
    if (hover != null && data[hover]) { const x = Math.round(hover * cw + cw / 2) + .5; ctx.strokeStyle = 'rgba(245,249,255,.35)'; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, h - padB); ctx.stroke(); }
  }, [data, hover]);
  useEffect(() => { draw(); const ro = new ResizeObserver(draw); if (canvas.current) ro.observe(canvas.current); return () => ro.disconnect(); }, [draw]);
  const c = hover != null && data?.[hover] ? data[hover] : data?.[data.length - 1];
  return <div className="t-chart">
    <div className="t-chart-bar">
      <div className="t-ohlc">{c ? <><span>O <b>{price(c.o)}</b></span><span>H <b>{price(c.h)}</b></span><span>L <b>{price(c.l)}</b></span><span>C <b>{price(c.c)}</b></span><span>{new Date(c.t * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></> : <span>Price in USD</span>}</div>
      <div className="t-frames" role="group" aria-label="Chart interval">{['15m', '1h', '4h', '1d'].map(f => <button key={f} type="button" aria-pressed={frame === f} onClick={() => setFrame(f)}>{f}</button>)}</div>
    </div>
    <div className="t-chart-body">
      {data?.length ? <canvas ref={canvas} aria-label="Price chart" onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.min(data.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / ((r.width - 72) / data.length))))); }} onPointerLeave={() => setHover(null)} />
        : <p className="t-chart-state">{!pool ? 'No pool to chart' : error ? error : data ? 'No trades in this window' : 'Loading the chart'}</p>}
    </div>
  </div>;
}

function WalletKey({ wallet, big }) {
  const [pick, setPick] = useState(false);
  if (wallet.account) return <span className="t-wallet-on"><span className="t-key ghost"><Wallet size={16} />{short(wallet.account)}</span><button type="button" className="t-key icon" aria-label="Disconnect wallet" onClick={wallet.disconnect}><X size={16} /></button></span>;
  const open = () => { if (wallet.providers.length > 1) setPick(true); else wallet.connect(); };
  return <span className="t-wallet-off">
    <button type="button" className={'t-key primary' + (big ? ' big' : '')} onClick={open} disabled={wallet.busy}><Wallet size={16} />{wallet.busy ? 'Waiting for wallet' : 'Connect wallet'}</button>
    {pick && <span className="t-pick" role="dialog" aria-label="Choose a wallet">{wallet.providers.map(p => <button key={p.uuid} type="button" className="t-key" onClick={() => { setPick(false); wallet.connect(p.uuid); }}>{p.icon && <img src={p.icon} alt="" width="18" height="18" />}{p.name}</button>)}<button type="button" className="t-key ghost" onClick={() => setPick(false)}>Cancel</button></span>}
  </span>;
}

function Buy({ coin, wallet, ethRaw, onSent }) {
  const [input, setInput] = useState(''), [slip, setSlip] = useState(100), [quote, setQuote] = useState(null), [qErr, setQErr] = useState(''), [quoting, setQuoting] = useState(false), [step, setStep] = useState({ kind: 'idle' }), [tick, setTick] = useState(0);
  const wei = useMemo(() => { const v = input.trim(); if (!/^\d*\.?\d*$/.test(v) || !(Number(v) > 0)) return null; try { return parseEther(v); } catch { return null; } }, [input]);
  useEffect(() => { setInput(''); setQuote(null); setStep({ kind: 'idle' }); }, [coin.address]);
  useEffect(() => {
    if (wei == null) { setQuote(null); setQErr(''); setQuoting(false); return; }
    let alive = true; setQuoting(true);
    const t = setTimeout(() => api({ action: 'quote', address: coin.address, amount: wei.toString(), slippage: String(slip), ...(wallet.account ? { account: wallet.account } : {}) })
      .then(q => { if (alive) { setQuote(q); setQErr(''); } }).catch(e => { if (alive) { setQErr(e.message); setQuote(null); } }).finally(() => { if (alive) setQuoting(false); }), 350);
    return () => { alive = false; clearTimeout(t); };
  }, [wei, slip, coin.address, wallet.account, tick]);
  const lowEth = ethRaw != null && wei != null && BigInt(ethRaw) < wei;
  const run = async () => {
    if (!quote?.tx || !wallet.account) return;
    const account = wallet.account, amountIn = BigInt(quote.amountIn), minOut = BigInt(quote.minOut), r = quote.route;
    try {
      if (!wallet.onChain) { setStep({ kind: 'busy', label: 'Switching network' }); if (!(await wallet.switchChain())) throw new Error('Switch the wallet to Robinhood Chain and try again.'); }
      const expected = r.kind === 'v3' ? { to: SWAP_ROUTER02, data: encodeV3Buy(r.path, account, amountIn, minOut, BigInt(quote.deadline)) }
        : r.kind === 'v4' ? { to: UNIVERSAL_ROUTER, data: encodeV4Buy(r.keys.map(k => ({ key: { currency0: k.currency0, currency1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks }, zeroForOne: k.zeroForOne })), amountIn, minOut, BigInt(quote.deadline)) }
        : { to: r.curve, data: encodeCurveBuy(amountIn, minOut, account) };
      if (expected.to.toLowerCase() !== quote.tx.to.toLowerCase() || expected.data.toLowerCase() !== quote.tx.data.toLowerCase() || quote.tx.value !== quote.amountIn) throw new Error('The prepared call does not match this page. Quote again.');
      setStep({ kind: 'busy', label: 'Dry run on the chain' });
      const sim = await api({ action: 'simulate' }, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: account, to: quote.tx.to, data: quote.tx.data, value: quote.tx.value, token: coin.address }) });
      setStep({ kind: 'busy', label: 'Confirm in your wallet' });
      const hash = await wallet.sendTransaction({ from: account, to: quote.tx.to, data: quote.tx.data, value: quote.tx.value, gas: sim.gas });
      setStep({ kind: 'sent', hash }); setInput(''); onSent?.();
    } catch (e) { setStep({ kind: 'error', message: walletError(e, 'The buy did not go through.') }); }
  };
  const busy = step.kind === 'busy' || wallet.busy;
  const label = step.kind === 'busy' ? step.label : !wallet.account ? null : !wallet.onChain ? 'Switch to Robinhood Chain' : wei == null ? 'Enter an amount' : lowEth ? 'Not enough ETH' : quote?.reason ? 'No route for this coin' : quoting || !quote ? 'Getting a quote' : `Buy ${coin.symbol}`;
  const path = quote?.route ? [quote.route.venue, [...(quote.route.via || 'ETH').split(' → '), coin.symbol].join(' → ')].join(' · ') : coin.route ? `${coin.route.venue} · ${coin.route.pair}` : null;
  return <section className="t-panel t-buy" aria-label={`Buy ${coin.symbol}`}>
    <h2>Buy {coin.symbol}</h2>
    {!coin.route ? <p className="t-note">No Uniswap or Pons pool against ETH or USDG was found for this coin, so Onegate does not route a buy for it.</p> : <>
      <label className="t-in"><span>You pay</span><input inputMode="decimal" autoComplete="off" placeholder="0.00" value={input} onChange={e => { setInput(e.target.value.replace(',', '.')); if (step.kind !== 'busy') setStep({ kind: 'idle' }); }} aria-label="Amount of ETH" /><b>ETH</b></label>
      <div className="t-chips" role="group" aria-label="Quick amounts">{['0.001', '0.005', '0.01', '0.05'].map(v => <button key={v} type="button" onClick={() => setInput(v)} aria-pressed={input === v}>{v}</button>)}</div>
      <div className="t-out"><span>You receive</span><b>{quoting ? '…' : quote?.amountOut ? amount(quote.amountOut, quote.decimals) : '—'}</b><i>{coin.symbol}</i><button type="button" className="t-key icon" aria-label="Quote again" disabled={wei == null} onClick={() => setTick(t => t + 1)}><RefreshCw size={15} /></button></div>
      <dl className="t-terms">
        <dt>At least</dt><dd>{quote?.minOut ? `${amount(quote.minOut, quote.decimals)} ${coin.symbol}` : '—'}</dd>
        <dt>Slippage</dt><dd><span className="t-chips small" role="group" aria-label="Slippage">{[[50, '0.5%'], [100, '1%'], [300, '3%']].map(([b, l]) => <button key={b} type="button" aria-pressed={slip === b} onClick={() => setSlip(b)}>{l}</button>)}</span></dd>
        <dt>Route</dt><dd>{path || '—'}</dd>
      </dl>
      {quote?.reason && <p className="t-note warn">{quote.reason}</p>}
      {qErr && <p className="t-note warn">{qErr}</p>}
      {!wallet.account ? <WalletKey wallet={wallet} big /> : <button type="button" className="t-key primary big t-go" disabled={busy || (wallet.onChain && (!quote?.tx || !!quote.reason || lowEth))} onClick={() => wallet.onChain ? void run() : void wallet.switchChain()}>{label}</button>}
      {step.kind === 'sent' && <p className="t-note ok">Buy sent. <a href={`${EXPLORER}/tx/${step.hash}`} target="_blank" rel="noreferrer">Transaction {short(step.hash)}<ArrowUpRight size={13} /></a></p>}
      {step.kind === 'error' && <p className="t-note warn" role="alert">{step.message}</p>}
      <p className="t-fine">From your wallet straight to the pool. Onegate holds nothing, adds no fee, and dry-runs the exact call from your account before the wallet opens.</p>
    </>}
  </section>;
}

export default function Terminal() {
  const { address: param } = useParams(), [search] = useSearchParams();
  const wallet = useTerminalWallet();
  const [list, setList] = useState(null), [listErr, setListErr] = useState(''), [tab, setTab] = useState(search.get('tab') === 'majors' ? 'majors' : search.get('tab') === 'stocks' ? 'stocks' : 'memes'), [q, setQ] = useState('');
  const [coin, setCoin] = useState(null), [coinErr, setCoinErr] = useState(''), [balances, setBalances] = useState(null), [copied, setCopied] = useState(false), [major, setMajor] = useState(null);
  useEffect(() => { let alive = true; const load = () => api({ action: 'list' }).then(d => { if (alive) { setList(d); setListErr(''); } }).catch(e => { if (alive) setListErr(e.message); }); load(); const t = setInterval(load, 60000); return () => { alive = false; clearInterval(t); }; }, []);
  const selected = param && isAddress(param) ? param.toLowerCase() : list?.memes?.[0]?.address || null;
  useEffect(() => {
    if (!selected) return;
    let alive = true; setCoinErr(''); setCoin(c => c?.address === selected ? c : null);
    const load = () => api({ action: 'coin', address: selected }).then(d => { if (alive) setCoin(d); }).catch(e => { if (alive) setCoinErr(e.message); });
    load(); const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [selected]);
  const loadBalances = useCallback(() => { if (!wallet.account) { setBalances(null); return; } api({ action: 'balances', account: wallet.account }).then(setBalances).catch(() => {}); }, [wallet.account]);
  useEffect(() => { loadBalances(); const t = setInterval(loadBalances, 20000); return () => clearInterval(t); }, [loadBalances]);
  const afterBuy = () => { [4000, 9000, 16000].forEach(ms => setTimeout(loadBalances, ms)); };

  const rows = useMemo(() => {
    if (!list) return [];
    // A search from the app bar looks across memes and stocks, like any trading app; majors keep their own tab.
    const s = q.trim().toLowerCase(), base = tab === 'majors' ? list.majors : s ? [...list.memes, ...list.stocks] : tab === 'stocks' ? list.stocks : list.memes;
    return s ? base.filter(c => c.symbol.toLowerCase().includes(s) || c.name.toLowerCase().includes(s) || c.address?.includes(s)) : base;
  }, [list, tab, q]);
  const all = useMemo(() => list ? [...list.memes, ...list.stocks] : [], [list]);
  const twins = useMemo(() => { const n = {}; all.forEach(c => { n[c.symbol] = (n[c.symbol] || 0) + 1; }); return n; }, [all]);
  const held = useMemo(() => !balances ? [] : balances.items.map(b => { const c = all.find(x => x.address === b.address); if (!c || c.decimals == null) return null; const n = Number(formatUnits(BigInt(b.raw), c.decimals)); return { ...c, held: b.raw, value: c.priceUsd != null ? n * c.priceUsd : null }; }).filter(Boolean).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)), [balances, all]);
  const coinBal = coin && balances ? (balances.items.find(b => b.address === coin.address)?.raw ?? '0') : null;
  const pasted = q.trim(); const pasteRow = isAddress(pasted) && !rows.some(r => r.address === pasted.toLowerCase());
  const find = useRef(null);
  useEffect(() => { const key = e => { if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); find.current?.focus(); } }; addEventListener('keydown', key); return () => removeEventListener('keydown', key); }, []);
  const eth = list?.majors?.find(m => m.symbol === 'ETH');
  const counts = list ? { memes: list.memes.length, stocks: list.stocks.length, majors: list.majors.length } : {};

  return <main className="terminal">
    <header className="t-appbar">
      <Link to="/" className="t-brand" aria-label="Onegate Privacy home"><WordmarkSvg /></Link>
      <nav className="t-nav" aria-label="Main navigation"><NavLink to="/terminal">Terminal</NavLink><NavLink to="/privacy">Workspace</NavLink><NavLink to="/docs">Docs</NavLink></nav>
      <label className="t-find"><Search size={16} /><input ref={find} placeholder="Search name or paste a contract" value={q} onChange={e => setQ(e.target.value)} aria-label="Search coins" spellCheck={false} /><kbd>/</kbd></label>
      <span className="t-chain"><i />Robinhood Chain</span>
      {eth && <span className="t-eth">ETH <b>{price(eth.priceUsd)}</b></span>}
      <a className="t-git" href={IDENTITY.repo} target="_blank" rel="noreferrer" aria-label="Source on GitHub" title="Source on GitHub"><GithubMark size={17} /></a>
      <DockWallet />
    </header>
    <div className="t-toolbar">
      <h1>Terminal</h1>
      <div className="t-gtabs" role="group" aria-label="Coin group">{[['memes', 'Memes'], ['stocks', 'Stocks'], ['majors', 'Majors']].map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}{counts[k] != null && <i>{counts[k]}</i>}</button>)}</div>
      <span className="t-tool-note">Routes <b>Uniswap V3</b> · <b>Uniswap V4</b> · <b>Pons curve</b></span>
      <span className="t-tool-note">No fee added</span>
    </div>
    {wallet.error && <p className="t-note warn t-wallet-error" role="alert">{wallet.error}</p>}
    <div className="t-grid">
      <aside className="t-panel t-list" aria-label="Coins">
        <div className="t-list-head"><span>{tab === 'majors' ? 'Majors · reference' : q.trim() ? 'Memes and stocks' : tab === 'stocks' ? 'Tokenized stocks' : 'Memes'}</span><span>Price · 24h</span></div>
        <div className="t-rows">
          {pasteRow && <Link className="t-row" to={'/terminal/' + pasted.toLowerCase()}><span className="t-logo t-logo-text">0x</span><span className="t-row-id"><b>Open contract</b><small>{short(pasted)}</small></span></Link>}
          {!list ? (listErr ? <p className="t-note warn">{listErr}</p> : Array.from({ length: 9 }, (_, i) => <span key={i} className="t-row t-skel" />))
            : tab === 'majors' ? rows.map(m => <button key={m.id} type="button" className="t-row" aria-pressed={major?.id === m.id} onClick={() => setMajor(m)}><Logo src={m.image} symbol={m.symbol} /><span className="t-row-id"><b>{m.symbol}</b><small>{m.name}</small></span><span className="t-row-px"><b>{price(m.priceUsd)}</b><small data-dir={dir(m.change24h)}>{pct(m.change24h)}</small></span></button>)
            : rows.map(c => <Link key={c.address} className="t-row" to={'/terminal/' + c.address} aria-current={c.address === selected ? 'true' : undefined} onClick={() => setMajor(null)}><Logo src={c.image} symbol={c.symbol} /><span className="t-row-id"><b>{c.symbol}</b><small>{twins[c.symbol] > 1 ? short(c.address) : c.pool?.venue || 'No route'} · {usd(c.liquidityUsd)}</small></span><span className="t-row-px"><b>{price(c.priceUsd)}</b><small data-dir={dir(c.change24h)}>{pct(c.change24h)}</small></span></Link>)}
          {list && !rows.length && !pasteRow && <p className="t-note">No coins match</p>}
        </div>
      </aside>

      <section className="t-main" aria-label="Coin">
        {major ? <div className="t-panel t-major">
          <div className="t-head"><Logo src={major.image} symbol={major.symbol} size={44} /><div><h2>{major.symbol}</h2><p>{major.name}</p></div><div className="t-head-px"><b>{price(major.priceUsd)}</b><span data-dir={dir(major.change24h)}>{pct(major.change24h)} 24h</span></div></div>
          <p className="t-note">{major.symbol} trades on its own chain. Onegate buys Robinhood Chain coins only, so this one is shown for reference.</p>
          <button type="button" className="t-key" onClick={() => { setMajor(null); setTab('memes'); }}>Back to Robinhood Chain coins</button>
        </div> : !coin ? <div className="t-panel t-loading">{coinErr ? <p className="t-note warn">{coinErr}</p> : <p className="t-note">Reading the coin</p>}</div> : <>
          <div className="t-panel">
            <div className="t-head">
              <Logo src={coin.image} symbol={coin.symbol} size={44} />
              <div><h2>{coin.symbol}</h2><p>{coin.name}</p></div>
              <button type="button" className="t-ca" onClick={() => { navigator.clipboard?.writeText(coin.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {}); }} aria-label="Copy contract address">{short(coin.address)}{copied ? <Check size={14} /> : <Copy size={14} />}</button>
              <div className="t-head-px"><b>{price(coin.priceUsd)}</b><span data-dir={dir(coin.change24h)}>{pct(coin.change24h)} 24h</span></div>
            </div>
            <dl className="t-stats">
              <div><dt>Volume 24h</dt><dd>{usd(coin.volume24h)}</dd></div>
              <div><dt>Liquidity</dt><dd>{usd(coin.liquidityUsd)}</dd></div>
              <div><dt>FDV</dt><dd>{usd(coin.fdvUsd)}</dd></div>
              <div><dt>Market cap</dt><dd>{usd(coin.marketCapUsd)}</dd></div>
              <div><dt>Buys / sells</dt><dd>{coin.buys24h ?? '—'} / {coin.sells24h ?? '—'}</dd></div>
              <div><dt>Route</dt><dd>{coin.route?.venue || 'None'}</dd></div>
            </dl>
          </div>
          <Chart pool={coin.chartPool} />
          <div className="t-panel t-pools">
            <h2>Pools</h2>
            {coin.pools.length ? <div className="t-table-wrap"><table><thead><tr><th>Pair</th><th>Venue</th><th>Liquidity</th><th>Volume 24h</th><th>24h</th><th>Buys / sells</th></tr></thead>
              <tbody>{coin.pools.map(p => <tr key={p.address} aria-current={p.address === coin.route?.pool ? 'true' : undefined}><td>{p.pair}</td><td>{p.venue}{p.address === coin.route?.pool && <i>route</i>}</td><td>{usd(p.liquidityUsd)}</td><td>{usd(p.volume24h)}</td><td data-dir={dir(p.change24h)}>{pct(p.change24h)}</td><td>{p.buys24h ?? '—'} / {p.sells24h ?? '—'}</td></tr>)}</tbody></table></div>
              : <p className="t-note">No pools found</p>}
            <a className="t-link" href={`${EXPLORER}/token/${coin.address}`} target="_blank" rel="noreferrer">Contract on the explorer<ArrowUpRight size={14} /></a>
          </div>
        </>}
      </section>

      <aside className="t-side" aria-label="Wallet and buy">
        <section className="t-panel t-balance">
          <h2>Balance</h2>
          {!wallet.account ? <><p className="t-note">Connect a wallet to see your ETH and coins on Robinhood Chain.</p><WalletKey wallet={wallet} big /></> : <>
            <p className="t-net"><span data-ok={wallet.onChain ? '' : undefined} />{wallet.onChain ? 'Robinhood Chain' : 'Another network'}{!wallet.onChain && <button type="button" className="t-key small" onClick={() => wallet.switchChain()}>Switch</button>}</p>
            <div className="t-bal"><span>ETH</span><b>{balances?.eth != null ? amount(balances.eth, 18, 5) : '—'}</b></div>
            {coin && !major && <div className="t-bal"><span>{coin.symbol}</span><b>{coinBal != null ? amount(coinBal, coin.decimals) : '—'}</b></div>}
            {held.length > 0 && <div className="t-held"><h3>Your coins</h3>{held.slice(0, 8).map(h => <Link key={h.address} to={'/terminal/' + h.address} className="t-held-row"><Logo src={h.image} symbol={h.symbol} size={20} /><b>{h.symbol}</b><span>{amount(h.held, h.decimals)}</span><i>{usd(h.value)}</i></Link>)}</div>}
          </>}
        </section>
        {coin && !major && <Buy coin={coin} wallet={wallet} ethRaw={balances?.eth ?? null} onSent={afterBuy} />}
      </aside>
    </div>
  </main>;
}
