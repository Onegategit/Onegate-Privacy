import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Plus } from 'lucide-react';
import Scene from './Scene';
import CoinTape from './CoinTape';
import Wordmark from './Wordmark';
import { IDENTITY } from './identity';
import ContractTag from './ContractTag';
import { activation, stateAt } from './flight';
import { usePoolLive, fmt } from './pool-live';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const steps = [
  ['Connect', 'Reads your public ETH balance on Robinhood Chain. No signature and no transfer.'],
  ['Unlock', 'Sign one fixed message to derive your private account. The signature stays in this tab.', 'Privacy Money account sign in'],
  ['Prove', 'A separate browser worker builds the proof from the pinned circuit files.'],
  ['Review', 'Amount, recipient and fees on one screen before your wallet or the relay is asked anything.'],
];
const GLYPHS = '░▒▓█NX/';
const scramble = (n, seed) => Array.from({ length: n }, (_, i) => GLYPHS[(i * 7 + seed * 13 + ((i * seed) % 5)) % GLYPHS.length]).join('');
const updates = [
  ['Oct 2, 2026', '$OGATE is live on Robinhood Chain at 0xbe5d…80d6, a Pons launch paired with ETH. The terminal buys it on its curve, dry-run from your account like every other coin.'],
  ['Oct 2, 2026', 'The source is public on GitHub: the pages, the terminal server, the privacy worker and the tests, checked on every change.'],
  ['Oct 2, 2026', 'The terminal now opens like a trading app: one bar with search, chain, ETH price and your wallet, and the columns fill the screen.'],
  ['Oct 1, 2026', 'The terminal: Robinhood Chain coins with a chart, your balance, and buys on Uniswap V3, Uniswap V4 and Pons curves, dry-run from your account before the wallet opens.'],
  ['Oct 1, 2026', 'The logo’s own lettering, traced from the artwork, now gathers from ember dust and comes apart where your pointer is.'],
  ['Oct 1, 2026', 'The site was rebuilt around the gate: one scroll through the logo, with live pool numbers read from the chain.'],
  ['Oct 1, 2026', 'Private pools on Robinhood Chain: deposit, local proofs and relay withdrawal, each reviewed before anything is signed.'],
];
const faq = [
  ['Does Onegate hold my funds?', 'No custodial balance. Funds go into external Privacy Cash pool contracts, which carry their own contract and service risks.'],
  ['Is my wallet connection private?', 'No. Your wallet address and every deposit and withdrawal are public on chain. RPC, indexer and relay providers can see network metadata.'],
  ['How do I recover a private balance?', 'Sign the same fixed unlock message with the same wallet and signing method. A different signature can derive a different private account. Never share it.'],
  ['Has a funded deposit been tested?', 'Not yet. Amount, approval, recipient and relay guards are tested with fixtures. This integration is unaudited.'],
  ['Where do $OGATE fees go?', 'After launch, creator fees are split between a shared privacy balance for holders, $OGATE stake and the Onegate treasury. The shares are TBA and will be posted on the docs page.'],
];

// Unannounced chapters keep their titles in shifting glyphs until they ship.
function Glyphs({ n }) {
  const [seed, setSeed] = useState(1);
  useEffect(() => { if (matchMedia('(prefers-reduced-motion: reduce)').matches) return; const t = setInterval(() => setSeed(s => s % 97 + 1), 900); return () => clearInterval(t); }, []);
  return <span className="glyphs" aria-hidden="true">{scramble(n, seed)} / {scramble(Math.max(3, n - 2), seed + 3)}</span>;
}

function Ticker() {
  return <p className="ticker-line"><b>{IDENTITY.ticker}</b> · CA <ContractTag full /></p>;
}

export default function Home() {
  const live = usePoolLive();
  const stage = useRef(null), chapters = useRef([]), keys = useRef([]);
  const cfg = live.limits?.config, pools = live.limits?.pools;

  const onFrame = useCallback((st, g) => {
    const s = stage.current; if (!s) return;
    s.style.setProperty('--half', g.half.toFixed(1) + 'px');
    s.style.setProperty('--flash', g.flash.toFixed(3));
    document.documentElement.toggleAttribute('data-dock-dark', innerHeight / 2 - g.half < 46);
    chapters.current.forEach((c, i) => {
      if (!c) return;
      const a = activation(st.f, i, st.snap);
      c.style.setProperty('--a', a.toFixed(3));
      c.toggleAttribute('data-on', a > .01); c.toggleAttribute('data-live', a > .6);
    });
    const k = st.snap ? +(Math.round(st.f) >= 3) : clamp((st.f - 2.8) / .36);
    keys.current.forEach((el, i) => el?.toggleAttribute('data-lit', k * 4 > i + .02 || (i === 0 && k > 0)));
  }, []);
  useLayoutEffect(() => { const st = stateAt(0, false, innerWidth < 700); onFrame(st, { half: st.band * innerHeight / 2, flash: 0 }); }, [onFrame]);
  useEffect(() => () => document.documentElement.removeAttribute('data-dock-dark'), []);
  const ch = i => el => { chapters.current[i] = el; };

  return <main className="home">
    <section className="flight" aria-label="How Onegate works">
      <div className="stage" ref={stage}>
        <Scene onFrame={onFrame} />

        <article className="ch ch-hero ch-first" ref={ch(0)}>
          <div className="zone top"><div className="row lift">
            <p className="hero-line">Fees come back <em>as privacy</em></p>
            <p className="hero-sub">Creator fees from {IDENTITY.ticker} fill a shared privacy balance on Robinhood Chain</p>
          </div></div>
          <div className="zone band"><h1 className="wordmark lift"><span className="sr-only">Onegate Privacy</span><Wordmark intro /></h1></div>
          <div className="zone bot"><div className="row lift">
            <div className="keys">
              <Link className="button" to="/privacy">Open privacy workspace<ArrowUpRight size={20} /></Link>
              <Link className="button paper" to="/terminal">Open terminal<ArrowUpRight size={20} /></Link>
            </div>
            <Ticker />
          </div></div>
          <CoinTape />
        </article>

        <article className="ch" ref={ch(1)}>
          <div className="zone top"><div className="row lift split">
            <h2>Every transfer on a chain is <em>public</em></h2>
            <p>Your wallet address, the amount and the time go into a block that anyone can read. A privacy pool sits between your deposit and your withdrawal.</p>
          </div></div>
          <div className="zone bot"><div className="row lift">
            <dl className="figures">
              <div><dt>Latest block</dt><dd>{fmt(live.block, 0)}</dd></div>
              <div><dt>ETH in the pool</dt><dd>{fmt(live.eth)}</dd></div>
              <div><dt>USDG in the pool</dt><dd>{fmt(live.usdg, 0)}</dd></div>
              <div><dt>Protocol fee</dt><dd>{cfg ? fmt(cfg.fee_rate / 100) + '%' : '—'}</dd></div>
            </dl>
            <p className="source">Read from Robinhood Chain and the Privacy Cash config every few seconds</p>
          </div></div>
        </article>

        <article className="ch" ref={ch(2)}>
          <div className="zone top"><div className="row lift split">
            <h2>Deposit from <em>your wallet</em></h2>
            <p>Pick ETH or USDG and an amount. Your wallet shows the chain, the pool contract and the amount before you sign.</p>
          </div></div>
          <div className="zone band"><div className="row lift">
            <p className="band-line">Inside the pool your deposit becomes an encrypted note<small>Only your private key can read it</small></p>
          </div></div>
          <div className="zone bot"><div className="row lift">
            <dl className="figures">
              <div><dt>Min deposit</dt><dd>{cfg ? fmt(cfg.minimum_deposit.eth, 6) : '—'}<small>ETH</small></dd></div>
              <div><dt>Max deposit</dt><dd>{pools ? fmt(Number(BigInt(pools.eth.maximum)) / 1e18, 0) : '—'}<small>ETH</small></dd></div>
              <div><dt>Min deposit</dt><dd>{cfg ? fmt(cfg.minimum_deposit.usdg) : '—'}<small>USDG</small></dd></div>
            </dl>
            <p className="source">The deposit transaction itself is public</p>
          </div></div>
        </article>

        <article className="ch ch-inside" ref={ch(3)}>
          <div className="zone band"><div className="inside lift">
            <div className="inside-head"><h2>Your private account opens <em>in this tab</em></h2><p>Four separate actions. Nothing moves until the last one.</p></div>
            <ol className="steps">{steps.map(([title, text, code], i) => <li key={title} ref={el => { keys.current[i] = el; }}>
              <span>{String(i + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{text}</p>{code && <code>{code}</code>}
            </li>)}</ol>
          </div></div>
        </article>

        <article className="ch" ref={ch(4)}>
          <div className="zone top"><div className="row lift split">
            <h2>Withdraw to <em>any address</em></h2>
            <p>Your browser builds the withdrawal proof. After you confirm it, the external relay submits it. Fees come out of the amount you withdraw.</p>
          </div></div>
          <div className="zone bot"><div className="row lift">
            <dl className="figures narrow">
              <div><dt>Min withdrawal</dt><dd>{cfg ? fmt(cfg.minimum_withdrawal.eth, 6) : '—'}<small>ETH</small></dd></div>
              <div><dt>Flat fee</dt><dd>{cfg ? fmt(cfg.rent_fees.eth, 6) : '—'}<small>ETH</small></dd></div>
              <div><dt>Protocol fee</dt><dd>{cfg ? fmt(cfg.fee_rate / 100) + '%' : '—'}</dd></div>
            </dl>
          </div></div>
        </article>

        <article className="ch ch-fees" ref={ch(5)}>
          <div className="zone top"><div className="row lift split">
            <h2>Where the fees <em>go</em></h2>
            <p>{IDENTITY.ticker} creator fees are collected and split three ways. The shares are TBA and will be posted here.</p>
          </div></div>
          <div className="zone band"><div className="row lift">
            <ol className="fee-split">
              <li><b>TBA</b><span>Shared privacy balance<small>Pays privacy costs for holders</small></span></li>
              <li><b>TBA</b><span>{IDENTITY.ticker} stake<small>For holders who stake</small></span></li>
              <li><b>TBA</b><span>Onegate treasury<small>Keeps the gate running</small></span></li>
            </ol>
          </div></div>
          <div className="zone bot"><div className="row lift">
            <p className="source left">Creator fees · collected after launch · shares announced at launch</p>
            <Link className="button paper" to="/docs#fees">How it will work<ArrowUpRight size={20} /></Link>
          </div></div>
        </article>

        <article className="ch" ref={ch(6)}>
          <div className="zone top"><div className="row lift split">
            <h2>What stays <em>public</em></h2>
            <ul className="facts"><li>Your wallet address</li><li>Deposit and withdrawal amounts and times</li><li>Network details seen by the RPC, indexer and relay</li></ul>
          </div></div>
          <div className="zone band"><div className="row lift split">
            <h3>What the pool keeps encrypted</h3>
            <ul className="facts"><li>The contents of your notes</li><li>Your private balance</li><li>The link between a deposit and a withdrawal, unless timing or amounts give it away</li></ul>
          </div></div>
          <div className="zone bot"><div className="row lift">
            <p className="warning">Unaudited integration. No funded deposit or withdrawal has been tested. Not affiliated with Robinhood or the protocols it uses.</p>
            <Link className="text-link" to="/docs">Read the docs<ArrowUpRight size={18} /></Link>
          </div></div>
        </article>

        <article className="ch ch-hero" ref={ch(7)}>
          <div className="zone top"><div className="row lift"><p className="hero-line">Your private side <em>starts here</em></p></div></div>
          <div className="zone band"><div className="wordmark lift" aria-hidden="true"><Wordmark /></div></div>
          <div className="zone bot"><div className="row lift">
            <p className="lede">Keep the same wallet and signing method for recovery. Onegate cannot reset a signature or a passphrase.</p>
            <div className="keys">
              <Link className="button" to="/privacy">Open the workspace<ArrowUpRight size={20} /></Link>
              <Link className="button paper" to="/terminal">Open terminal<ArrowUpRight size={20} /></Link>
            </div>
            <p className="small-line">A shared privacy balance. Room for every holder. <Link to="/docs#fees">See how fees work</Link></p>
          </div></div>
        </article>
      </div>
    </section>

    <section className="chapters" aria-label="Chapters">
      <div className="chapter now">
        <b className="chapter-n">00</b>
        <div className="chapter-id"><span>Chapter 0</span><small><i />We’re here. Just getting started.</small></div>
        <div className="chapter-body"><h2>Privacy <em>starts here</em></h2><p>We’re starting with private pools on Robinhood Chain and a terminal for its coins. After launch, creator fees fund a shared privacy balance for holders.</p>
          <p className="chapter-links"><Link to="/privacy">Open the workspace<ArrowUpRight size={14} /></Link><Link to="/terminal">Open terminal<ArrowUpRight size={14} /></Link></p></div>
      </div>
      {[['01', 'Holders get more', 9], ['02', 'Not announced', 7], ['03', 'Is it finished?', 8]].map(([n, title, len]) => <div className="chapter" key={n}>
        <b className="chapter-n">{n}</b>
        <div className="chapter-id"><span>Chapter {n}</span><small>{title}</small></div>
        <div className="chapter-body"><Glyphs n={len} /><span className="glyph-rule" aria-hidden="true" /></div>
      </div>)}
    </section>

    <section className="updates" aria-label="Dev updates">
      <div className="updates-head"><span>Dev updates</span><span>Notes from the dev</span></div>
      <div className="updates-body">
        <div><h2>A little closer.<br /><em>With every update.</em></h2><p>What’s new, what’s improved, and what’s happening at Onegate.</p></div>
        <ol>{updates.map(([d, t], i) => <li key={i}><time>{d}</time><p>{t}</p></li>)}</ol>
      </div>
    </section>

    <section className="faq">
      <h2>Before you deposit</h2>
      <div className="faq-list">{faq.map(([q, a]) => <details key={q}><summary>{q}<Plus size={20} /></summary><p>{a}</p></details>)}</div>
    </section>
  </main>;
}
