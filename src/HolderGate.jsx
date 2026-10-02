import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, LockKeyhole, RefreshCw, Wallet } from 'lucide-react';
import { HOLDER_MIN_USD, IDENTITY } from './identity';
import { useTerminalWallet } from './terminal-wallet';
import ContractTag from './ContractTag';

const usd = (v) => '$' + v.toLocaleString('en-US', Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);

// The account the privacy workspace will use: the injected wallet's first account, else the one connected in the header.
function useWorkspaceAccount(fallback) {
  const [account, setAccount] = useState(null);
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.request) return;
    const read = () => provider.request({ method: 'eth_accounts' }).then((a) => setAccount(Array.isArray(a) && a[0] ? a[0].toLowerCase() : null)).catch(() => setAccount(null));
    read();
    const changed = (a) => setAccount(Array.isArray(a) && a[0] ? a[0].toLowerCase() : null);
    provider.on?.('accountsChanged', changed);
    return () => provider.removeListener?.('accountsChanged', changed);
  }, [fallback]);
  return account || fallback || null;
}

/**
 * The privacy workspace opens for wallets holding at least HOLDER_MIN_USD of $OGATE. Connecting reads the balance on
 * Robinhood Chain and prices it on the launch curve (or its pool once it has one); nothing is signed and nothing moves.
 * The workspace is unmounted when the account changes to one that does not qualify.
 */
export default function HolderGate({ children }) {
  const wallet = useTerminalWallet();
  const account = useWorkspaceAccount(wallet.account);
  const [check, setCheck] = useState({ status: 'idle' });

  const run = useCallback(async () => {
    if (!account) { setCheck({ status: 'idle' }); return; }
    setCheck((c) => ({ status: 'checking', data: c.data?.account === account ? c.data : null }));
    try {
      const r = await fetch('/api/terminal?action=holder&account=' + account, { headers: { accept: 'application/json' } });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'The balance could not be read.');
      setCheck({ status: data.ok ? 'open' : data.worthUsd == null ? 'unknown' : 'short', data });
    } catch (e) {
      setCheck({ status: 'error', error: e instanceof Error ? e.message : 'The balance could not be read.' });
    }
  }, [account]);
  useEffect(() => { void run(); }, [run]);

  if (check.status === 'open' && check.data?.account === account) return children;

  const d = check.data;
  const share = d?.worthUsd != null ? Math.min(1, d.worthUsd / HOLDER_MIN_USD) : 0;
  return <main className="page gate-page">
    <div className="page-heading"><span className="eyebrow">Robinhood Chain · holders</span><h1>Privacy workspace</h1><p>Open to wallets holding at least {usd(HOLDER_MIN_USD)} of {IDENTITY.ticker}</p></div>
    <section className="gate-card" aria-live="polite">
      <div className="gate-head"><LockKeyhole size={22} /><div><h2>Hold {usd(HOLDER_MIN_USD)} of {IDENTITY.ticker} to open it</h2><p>Connect the wallet you will use here. Onegate reads its {IDENTITY.ticker} balance on Robinhood Chain and prices it {d?.priceSource === 'curve' ? 'on the launch curve' : 'on its pool'}. Nothing is signed and nothing moves.</p></div></div>

      {!account && <div className="gate-actions">
        <button type="button" className="button" onClick={() => wallet.connect()} disabled={wallet.busy}>{wallet.busy ? 'Waiting for wallet' : 'Connect wallet'}<Wallet /></button>
        {wallet.error && <p className="gate-note warn" role="alert">{wallet.error}</p>}
      </div>}

      {account && <>
        <dl className="gate-read">
          <div><dt>Wallet</dt><dd>{short(account)}</dd></div>
          <div><dt>Holds</dt><dd>{d ? d.amount.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' ' + IDENTITY.ticker.slice(1) : '—'}</dd></div>
          <div><dt>Worth</dt><dd>{d?.worthUsd != null ? (d.worthUsd > 0 ? 'about ' : '') + usd(d.worthUsd) : '—'}</dd></div>
          <div><dt>Needed</dt><dd>{usd(HOLDER_MIN_USD)}{d?.priceUsd ? ' · about ' + Math.ceil(HOLDER_MIN_USD / d.priceUsd).toLocaleString('en-US') + ' ' + IDENTITY.ticker.slice(1) : ''}</dd></div>
        </dl>
        <div className="gate-meter" role="progressbar" aria-label={'Share of the ' + usd(HOLDER_MIN_USD) + ' needed'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}><i style={{ width: share * 100 + '%' }} /></div>
        {check.status === 'checking' && <p className="gate-note">Reading the {IDENTITY.ticker} balance of {short(account)}</p>}
        {check.status === 'short' && <p className="gate-note">{d.amount > 0 ? <>This wallet holds about {usd(d.worthUsd)} of {IDENTITY.ticker}. Add about {usd(Math.max(0, HOLDER_MIN_USD - d.worthUsd))} more to open the workspace.</> : <>This wallet holds no {IDENTITY.ticker} yet. Hold {usd(HOLDER_MIN_USD)} of it to open the workspace.</>}</p>}
        {check.status === 'unknown' && <p className="gate-note warn">The {IDENTITY.ticker} price could not be read right now, so the check cannot finish. Try again in a moment.</p>}
        {check.status === 'error' && <p className="gate-note warn" role="alert">{check.error}</p>}
        <div className="gate-actions">
          <Link className="button" to={'/terminal/' + IDENTITY.contract}>Buy {IDENTITY.ticker} in the terminal<ArrowUpRight /></Link>
          <button type="button" className="button paper" onClick={run} disabled={check.status === 'checking'}>Check again<RefreshCw /></button>
        </div>
      </>}

      <p className="gate-ca">{IDENTITY.ticker} · CA <ContractTag /></p>
    </section>
  </main>;
}
