import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

// Two lanes of running coins in a slot at the foot of the first section, moving in opposite directions.
// Every coin opens the terminal: Robinhood Chain coins on their own page, majors on the reference tab.
const price = p => p == null ? '—' : '$' + (p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 })
  : p >= 1 ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : p.toLocaleString('en-US', { maximumSignificantDigits: 3 }));
const pct = c => c == null ? '—' : (c > 0 ? '+' : '') + c.toFixed(2) + '%';

function Lane({ groups, copy }) {
  return <div className="lane-set" aria-hidden={copy ? 'true' : undefined}>
    {groups.map(g => <Fragment key={g.id}>
      <span className="lane-label">{g.label}</span>
      {g.coins ? g.coins.map(c => <Link key={c.key} className="coin" to={c.to} tabIndex={copy ? -1 : undefined} title={c.name}>
        {c.image ? <img src={c.image} alt="" width="20" height="20" loading="lazy" referrerPolicy="no-referrer" /> : <em>{c.symbol.slice(0, 1)}</em>}
        <b>{c.symbol}</b><span>{price(c.priceUsd)}</span><i data-dir={c.change24h > 0 ? 'up' : c.change24h < 0 ? 'down' : undefined}>{pct(c.change24h)}</i>
      </Link>) : Array.from({ length: 6 }, (_, i) => <span key={i} className="coin-skeleton" />)}
    </Fragment>)}
  </div>;
}

export default function CoinTape() {
  const [data, setData] = useState(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false, timer = 0;
    const read = () => fetch('/api/terminal?action=list', { signal: AbortSignal.timeout(20000) })
      .then(r => r.ok ? r.json() : Promise.reject(Error('list')))
      .then(d => { if (!stop && (d?.memes || d?.stocks)) { setData(d); setFailed(false); } })
      .catch(() => { if (!stop) setFailed(true); });
    const tick = () => { if (!document.hidden) read(); timer = setTimeout(tick, 90000); };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  const chain = (list, n) => list?.length ? list.filter(c => c.priceUsd != null).slice(0, n).map(c => ({ ...c, key: c.address, to: '/terminal/' + c.address })) : null;
  const lanes = [
    [
      { id: 'majors', label: 'Majors', coins: data?.majors?.length ? data.majors.map(m => ({ ...m, key: m.id, to: '/terminal?tab=majors' })) : null, failed },
      { id: 'stocks', label: 'Robinhood Chain stocks', coins: chain(data?.stocks, 10), failed },
    ],
    [{ id: 'memes', label: 'Robinhood Chain memes', coins: chain(data?.memes, 18), failed }],
  ];
  // Nothing to show is shown as nothing: no empty box, no error line in the first view.
  if (failed && !data) return null;
  return <div className="tape" role="region" aria-label="Coin prices" data-ready={data ? '' : undefined}>
    {lanes.map((groups, i) => <div className={'lane' + (i ? ' reverse' : '')} key={i}>
      <div className="lane-track"><Lane groups={groups} /><Lane groups={groups} copy /></div>
    </div>)}
  </div>;
}
