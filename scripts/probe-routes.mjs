// Read-only probe of the buy routes the terminal uses on Robinhood Chain: node scripts/probe-routes.mjs
import { createPublicClient, http, parseAbi, encodeAbiParameters, keccak256, parseEther, formatUnits, encodePacked } from 'viem';

const rpc = process.env.RPC || 'https://evm.privacycash.org/rpc/robinhood';
const c = createPublicClient({ transport: http(rpc, { timeout: 20000 }) });
const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const QUOTER = '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7', ROUTER02 = '0xcaf681a66d020601342297493863e78c959e5cb2', V3F = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const PM = '0x8366a39cc670b4001a1121b8f6a443a643e40951', V4Q = '0x8dc178efb8111bb0973dd9d722ebeff267c98f94';
const INIT = '0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438';
const erc = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);
const pool3 = parseAbi(['function factory() view returns (address)', 'function fee() view returns (uint24)', 'function token0() view returns (address)', 'function token1() view returns (address)', 'function liquidity() view returns (uint128)']);
const quoter = parseAbi(['function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)']);
const r02 = parseAbi(['function WETH9() view returns (address)', 'function factory() view returns (address)']);
const v3f = parseAbi(['function getPool(address,address,uint24) view returns (address)']);

console.log('WETH symbol', await c.readContract({ address: WETH, abi: erc, functionName: 'symbol' }), 'router WETH9', await c.readContract({ address: ROUTER02, abi: r02, functionName: 'WETH9' }), 'router factory', await c.readContract({ address: ROUTER02, abi: r02, functionName: 'factory' }));
for (const fee of [100, 500, 3000]) {
  const p = await c.readContract({ address: V3F, abi: v3f, functionName: 'getPool', args: [WETH, USDG, fee] });
  const liq = p === '0x0000000000000000000000000000000000000000' ? 0n : await c.readContract({ address: p, abi: pool3, functionName: 'liquidity' });
  console.log('WETH/USDG v3 fee', fee, p, 'liquidity', liq);
}
const quote = async (path, amt) => (await c.simulateContract({ address: QUOTER, abi: quoter, functionName: 'quoteExactInput', args: [path, amt] })).result[0];
// VRAX / WETH (feed: uniswap-v3 0.01%), NVDA / USDG (0.05%)
for (const [label, poolAddr, viaUsdg] of [['VRAX', '0x97bf35f2603357d0be4dcd081ceccdbc9f9c2cc5', false], ['NVDA', '0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3', true]]) {
  try {
    const [f, fee, t0, t1] = await Promise.all(['factory', 'fee', 'token0', 'token1'].map(fn => c.readContract({ address: poolAddr, abi: pool3, functionName: fn })));
    const token = [t0, t1].find(t => t.toLowerCase() !== (viaUsdg ? USDG : WETH));
    const dec = await c.readContract({ address: token, abi: erc, functionName: 'decimals' });
    const path = viaUsdg ? encodePacked(['address', 'uint24', 'address', 'uint24', 'address'], [WETH, 100, USDG, fee, token]) : encodePacked(['address', 'uint24', 'address'], [WETH, fee, token]);
    const out = await quote(path, parseEther('0.01'));
    console.log(label, 'factory ok', f.toLowerCase() === V3F, 'fee', fee, 'token', token, '0.01 ETH ->', formatUnits(out, dec));
  } catch (e) { console.log(label, 'error', e.shortMessage || e.message); }
}
// V4 pool key discovery by the Initialize event around the pool's creation time.
const latest = await c.getBlock();
async function blockAt(ts) {
  let lo = 1n, hi = latest.number;
  while (hi - lo > 1n) { const mid = (lo + hi) / 2n; const b = await c.getBlock({ blockNumber: mid }); if (b.timestamp < BigInt(ts)) lo = mid; else hi = mid; }
  return hi;
}
async function v4Key(id, createdAt) {
  const center = await blockAt(Math.floor(Date.parse(createdAt) / 1000));
  for (const [from, to] of [[center - 5000n, center + 4999n], [center - 15000n, center - 5001n], [center + 5000n, center + 14999n]]) {
    const logs = await c.request({ method: 'eth_getLogs', params: [{ address: PM, topics: [INIT, id], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }] });
    if (logs.length) {
      const l = logs[0], [fee, tickSpacing, hooks] = [Number(BigInt(l.data.slice(0, 66))), Number(BigInt.asIntN(24, BigInt('0x' + l.data.slice(66, 130)))), '0x' + l.data.slice(154, 194)];
      const key = { currency0: '0x' + l.topics[2].slice(26), currency1: '0x' + l.topics[3].slice(26), fee, tickSpacing, hooks };
      const check = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
      return { key, block: l.blockNumber, idMatches: check === id };
    }
  }
  return null;
}
const feed = async id => (await (await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${id}`)).json()).data.attributes;
for (const id of ['0xbac3aa3b91584a53a5', '0x5875d407a42965b0e768c8']) {
  const list = await (await fetch(`https://api.geckoterminal.com/api/v2/search/pools?query=${id}&network=robinhood`)).json();
  const full = list.data?.[0]?.attributes?.address;
  if (!full) { console.log('feed miss', id); continue; }
  const a = await feed(full);
  const t0 = Date.now(); const found = await v4Key(full, a.pool_created_at);
  console.log(a.name, full, 'created', a.pool_created_at, '->', JSON.stringify(found, (k, v) => typeof v === 'bigint' ? v.toString() : v), Date.now() - t0, 'ms');
}
