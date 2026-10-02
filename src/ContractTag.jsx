import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IDENTITY } from './identity';

export const shortCA = (a) => a.slice(0, 6) + '…' + a.slice(-4);

// The $OGATE contract with a copy key. `full` shows the whole address on wide layouts and the short form on phones.
export default function ContractTag({ full = false }) {
  const [done, setDone] = useState(false);
  const ca = IDENTITY.contract;
  if (!ca) return <span>TBA</span>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(ca); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* clipboard blocked: the address stays visible in the title */ }
  };
  return <button type="button" className={'ca-tag' + (full ? ' has-full' : '')} onClick={copy} title={ca} aria-label={done ? 'Contract address copied' : 'Copy contract address ' + ca}>
    {full ? <><span className="ca-full">{ca}</span><span className="ca-short">{shortCA(ca)}</span></> : <span>{shortCA(ca)}</span>}
    {done ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
  </button>;
}
