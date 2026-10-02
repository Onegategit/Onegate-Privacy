import { useEffect, useState } from 'react';
import { PRIVACY } from './privacy-config';

// Public reads only: pool limits from /api/privacy, pool balances and the latest block from the chain.
const rpc = (method, params) => fetch(PRIVACY.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(9000) })
  .then(r => r.json()).then(r => { if (r.error || typeof r.result !== 'string') throw Error('rpc'); return r.result; });
const units = (hex, decimals) => Number(BigInt(hex)) / 10 ** decimals;
const balanceOf = address => '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');

export const fmt = (n, max = 2) => n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: max });

export function usePoolLive() {
  const [live, setLive] = useState({ block: null, eth: null, usdg: null, limits: null });
  useEffect(() => {
    let stop = false, timer = 0;
    fetch('/api/privacy', { signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.json() : null).then(d => { if (!stop && d?.config) setLive(v => ({ ...v, limits: d })); }).catch(() => {});
    const read = async () => {
      const [block, eth, usdg] = await Promise.allSettled([
        rpc('eth_blockNumber', []),
        rpc('eth_getBalance', [PRIVACY.ethPool, 'latest']),
        rpc('eth_call', [{ to: PRIVACY.usdgToken, data: balanceOf(PRIVACY.usdgPool) }, 'latest']),
      ]);
      if (stop) return;
      setLive(v => ({
        ...v,
        block: block.status === 'fulfilled' ? Number(BigInt(block.value)) : v.block,
        eth: eth.status === 'fulfilled' ? units(eth.value, 18) : v.eth,
        usdg: usdg.status === 'fulfilled' && usdg.value.length >= 66 ? units(usdg.value.slice(0, 66), 6) : v.usdg,
      }));
    };
    const tick = () => { if (!document.hidden) read().catch(() => {}); timer = setTimeout(tick, 5000); };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, []);
  return live;
}
