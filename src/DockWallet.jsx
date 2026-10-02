import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { useTerminalWallet } from './terminal-wallet';

// One wallet key for the site: connecting lands on Robinhood Chain; once connected it opens the terminal balance.
export default function DockWallet() {
  const wallet = useTerminalWallet();
  if (wallet.account) return <Link className="dock-wallet on" to="/terminal" aria-label="Open your balance in the terminal"><Wallet size={16} /><span>{wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}</span></Link>;
  return <button type="button" className="dock-wallet" onClick={() => wallet.connect()} disabled={wallet.busy} aria-label="Connect wallet"><Wallet size={16} /><span>{wallet.busy ? 'Waiting for wallet' : 'Connect wallet'}</span></button>;
}
