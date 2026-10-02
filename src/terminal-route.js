import { encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbi } from "viem";

// Addresses and calldata for the terminal's buy routes, shared by the server (which builds the call) and
// the browser (which builds it again and compares byte for byte before the wallet opens).
export * from "./terminal-addresses.js";
import { NATIVE } from "./terminal-addresses.js";

export const router02Abi = parseAbi(["struct ExactInputParams { bytes path; address recipient; uint256 amountIn; uint256 amountOutMinimum; }", "function exactInput(ExactInputParams params) payable returns (uint256 amountOut)", "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])"]);

export const routerAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

export const curveAbi = parseAbi(["function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)", "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)", "function sellableTokens() view returns (uint256)", "function readyToGraduate() view returns (bool)", "function graduated() view returns (bool)", "function feeBps() view returns (uint256)", "function creatorTaxBps() view returns (uint256)"]);

export const encodeV3Buy = (path, recipient, amountIn, minOut, deadline) => encodeFunctionData({ abi: router02Abi, functionName: "multicall", args: [deadline, [encodeFunctionData({ abi: router02Abi, functionName: "exactInput", args: [{ path, recipient, amountIn, amountOutMinimum: minOut }] })]] });
export const v3Path = (hops) => encodePacked(hops.map((_, i) => (i % 2 ? "uint24" : "address")), hops);
export const poolIdOf = (k) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
const pathKeys = { type: "tuple[]", components: [{ name: "intermediateCurrency", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }, { name: "hookData", type: "bytes" }] };
// The router's v4 periphery takes ExactInputParams with per-hop slippage (empty = none); the older layout reverts here.
const exactInParams = { type: "tuple", components: [{ name: "currencyIn", type: "address" }, { name: "path", ...pathKeys }, { name: "maxHopSlippage", type: "uint256[]" }, { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" }] };
/** Universal Router V4_SWAP: SWAP_EXACT_IN from native ETH along the pool keys, SETTLE_ALL ETH, TAKE_ALL the coin. */
export function encodeV4Buy(hops, amountIn, minOut, deadline) {
  let from = NATIVE;
  const path = hops.map((h) => { const next = h.key.currency0 === from ? h.key.currency1 : h.key.currency0; from = next; return { intermediateCurrency: next, fee: h.key.fee, tickSpacing: h.key.tickSpacing, hooks: h.key.hooks, hookData: "0x" }; });
  const swap = encodeAbiParameters([exactInParams], [{ currencyIn: NATIVE, path, maxHopSlippage: [], amountIn, amountOutMinimum: minOut }]);
  const input = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x070c0f", [swap, encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [NATIVE, amountIn]), encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [from, minOut])]]);
  return encodeFunctionData({ abi: routerAbi, functionName: "execute", args: ["0x10", [input], deadline] });
}
export const encodeCurveBuy = (amountIn, minOut, recipient) => encodeFunctionData({ abi: curveAbi, functionName: "buy", args: [amountIn, minOut, recipient] });

