import { useEffect, useSyncExternalStore } from 'react';

// Wallet link for the terminal: EIP-6963 discovery, connect lands on Robinhood Chain in the same gesture,
// every send re-checks account and chain first. Separate from the privacy workspace's own wallet flow.
export const CHAIN_HEX = '0x1237';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
const CHAIN_PARAMS = { chainId: CHAIN_HEX, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: [EXPLORER] };
const KEY = 'onegate.terminal.wallet.v1';
const found = new Map();
let state = { account: null, wallet: null, chainHex: null, error: null, busy: false, providers: [] };
let active = null;
const listeners = new Set();
const set = patch => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };
const address = v => (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null);
const hex = v => (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v) ? '0x' + parseInt(v, 16).toString(16) : null);

if (typeof window !== 'undefined') {
  window.addEventListener('eip6963:announceProvider', e => {
    const d = e.detail;
    if (!d?.info?.uuid || !d.provider || found.has(d.info.uuid)) return;
    found.set(d.info.uuid, d); set({ providers: [...found.values()].map(x => x.info) });
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}
const injected = () => (typeof window !== 'undefined' && window.ethereum) || null;

export const walletError = (e, fallback) => {
  const code = e?.code;
  return code === 4001 ? 'Request cancelled in the wallet.' : code === -32002 ? 'The wallet already has a request open.' : code === 4100 ? 'The wallet asked to reconnect.' : code === 4902 ? 'Robinhood Chain is not in this wallet yet.' : e?.message && e.message.length < 160 ? e.message : fallback;
};
function attach(provider, name, account) {
  active = provider;
  set({ account, wallet: name, error: null, busy: false });
  provider.request({ method: 'eth_chainId' }).then(id => set({ chainHex: hex(id) })).catch(() => {});
  provider.on?.('accountsChanged', next => set({ account: Array.isArray(next) ? address(next[0]) : null }));
  provider.on?.('chainChanged', id => set({ chainHex: hex(id) }));
}
export async function switchChain() {
  if (!active) return false;
  set({ busy: true, error: null });
  try { await active.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] }); }
  catch (e) {
    if (e?.code !== 4902) { set({ busy: false, error: walletError(e, 'The wallet did not switch network.') }); return false; }
    try { await active.request({ method: 'wallet_addEthereumChain', params: [CHAIN_PARAMS] }); }
    catch (added) { set({ busy: false, error: walletError(added, 'The wallet did not add Robinhood Chain.') }); return false; }
  }
  const id = hex(await active.request({ method: 'eth_chainId' }).catch(() => null));
  set({ busy: false, chainHex: id });
  return id === CHAIN_HEX;
}
export async function connect(uuid) {
  const detail = uuid ? found.get(uuid) : found.size === 1 ? [...found.values()][0] : null;
  const provider = detail?.provider || injected();
  if (!provider) { set({ error: 'No wallet found in this browser.' }); return; }
  set({ busy: true, error: null });
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const account = Array.isArray(accounts) ? address(accounts[0]) : null;
    if (!account) throw new Error('The wallet returned no account.');
    attach(provider, detail?.info.name || 'Wallet', account);
    try { localStorage.setItem(KEY, detail?.info.rdns || 'injected'); } catch { /* private mode */ }
    const id = hex(await provider.request({ method: 'eth_chainId' }).catch(() => null));
    if (id !== CHAIN_HEX) await switchChain();
  } catch (e) { set({ busy: false, error: walletError(e, 'The wallet did not return an account.') }); }
}
export function disconnect() { active = null; set({ account: null, wallet: null, chainHex: null, error: null }); try { localStorage.removeItem(KEY); } catch { /* private mode */ } }
/** Send a prepared transaction after re-reading the wallet's account and chain. Returns the hash. */
export async function sendTransaction(tx) {
  if (!active) throw new Error('Connect a wallet first.');
  if (!address(tx.to) || !/^0x(?:[\da-f]{2})*$/i.test(tx.data) || !/^(0|[1-9]\d{0,30})$/.test(tx.value) || (tx.gas && !/^[1-9]\d{0,9}$/.test(tx.gas))) throw new Error('Invalid transaction request.');
  const accounts = await active.request({ method: 'eth_accounts' });
  const account = Array.isArray(accounts) ? address(accounts[0]) : null;
  if (!account || account !== state.account || account !== tx.from) throw new Error('The wallet account changed. Review again.');
  if (hex(await active.request({ method: 'eth_chainId' })) !== CHAIN_HEX) throw new Error('Switch to Robinhood Chain and review again.');
  const hash = await active.request({ method: 'eth_sendTransaction', params: [{ from: account, to: tx.to, data: tx.data, value: '0x' + BigInt(tx.value).toString(16), ...(tx.gas ? { gas: '0x' + BigInt(tx.gas).toString(16) } : {}) }] });
  if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('The wallet returned no transaction hash. Check its activity before retrying.');
  return hash.toLowerCase();
}

/** Sign a plain-text message (personal_sign) after re-reading the wallet's account. Never a transaction. */
export async function signMessage(message, from) {
  if (!active) throw new Error('Connect a wallet first.');
  const accounts = await active.request({ method: 'eth_accounts' });
  const account = Array.isArray(accounts) ? address(accounts[0]) : null;
  if (!account || account !== state.account || account !== from) throw new Error('The wallet account changed. Try again.');
  const hexMessage = '0x' + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, '0')).join('');
  const signature = await active.request({ method: 'personal_sign', params: [hexMessage, account] });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130,}$/.test(signature)) throw new Error('The wallet returned no signature.');
  return signature;
}

export function useTerminalWallet() {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (state.account) return;
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
    if (!saved) return;
    const restore = () => {
      if (state.account) return;
      const detail = [...found.values()].find(d => d.info.rdns === saved);
      const provider = detail?.provider || (saved === 'injected' ? injected() : null);
      provider?.request({ method: 'eth_accounts' }).then(a => { const account = Array.isArray(a) ? address(a[0]) : null; if (account && !state.account) attach(provider, detail?.info.name || 'Wallet', account); }).catch(() => {});
    };
    restore(); const t = setTimeout(restore, 450);
    return () => clearTimeout(t);
  }, []);
  return { ...s, onChain: s.chainHex === CHAIN_HEX, connect, disconnect, switchChain, sendTransaction, signMessage };
}
