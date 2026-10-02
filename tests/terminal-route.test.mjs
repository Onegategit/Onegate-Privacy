import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, decodeFunctionData, parseEther } from "viem";
import { NATIVE, USDG, WETH, curveAbi, encodeCurveBuy, encodeV3Buy, encodeV4Buy, poolIdOf, routerAbi, router02Abi, v3Path } from "../src/terminal-route.js";

const ME = "0x3333333333333333333333333333333333333333";
const COIN = "0xc0d6457c16cc70d6790dd43521c899c87ce02f35";
// The ETH/USDG Uniswap V4 pool the stock routes start from, as read from the PoolManager's Initialize event.
const ETH_USDG = { currency0: NATIVE, currency1: USDG, fee: 8388608, tickSpacing: 10, hooks: "0x06a889870c8f83640d6816319f72e2aa579b6080" };

test("a V4 pool key hashes to the pool id the chain reports", () => {
  assert.equal(poolIdOf(ETH_USDG), "0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551");
  assert.notEqual(poolIdOf({ ...ETH_USDG, tickSpacing: 60 }), poolIdOf(ETH_USDG));
});

test("a V3 buy is one exactInput inside a deadline multicall, paid in ETH, sent to the buyer", () => {
  const path = v3Path([WETH, 500, USDG, 3000, COIN]);
  assert.equal(path.length, 2 + 2 * (20 * 3 + 3 * 2));
  const data = encodeV3Buy(path, ME, parseEther("0.01"), 123n, 1900000000n);
  assert.equal(data.slice(0, 10), "0x5ae401dc");
  const outer = decodeFunctionData({ abi: router02Abi, data });
  assert.equal(outer.functionName, "multicall");
  assert.equal(outer.args[0], 1900000000n);
  assert.equal(outer.args[1].length, 1);
  const inner = decodeFunctionData({ abi: router02Abi, data: outer.args[1][0] });
  assert.equal(inner.functionName, "exactInput");
  assert.deepEqual({ ...inner.args[0] }, { path, recipient: ME, amountIn: parseEther("0.01"), amountOutMinimum: 123n });
});

test("a V4 buy swaps exact ETH in, settles ETH and takes the last currency of the path", () => {
  const second = { currency0: COIN, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: NATIVE };
  const data = encodeV4Buy([{ key: ETH_USDG }, { key: second }], parseEther("0.01"), 77n, 1900000000n);
  assert.equal(data.slice(0, 10), "0x3593564c");
  const { args } = decodeFunctionData({ abi: routerAbi, data });
  assert.equal(args[0], "0x10");
  const [actions, params] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], args[1][0]);
  assert.equal(actions, "0x070c0f");
  const [settleCurrency, settleAmount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], params[1]);
  assert.equal(settleCurrency, NATIVE);
  assert.equal(settleAmount, parseEther("0.01"));
  const [takeCurrency, takeMin] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], params[2]);
  assert.equal(takeCurrency.toLowerCase(), COIN);
  assert.equal(takeMin, 77n);
});

test("a curve buy names the buyer as recipient", () => {
  const { functionName, args } = decodeFunctionData({ abi: curveAbi, data: encodeCurveBuy(parseEther("0.002"), 5n, ME) });
  assert.equal(functionName, "buy");
  assert.deepEqual(args, [parseEther("0.002"), 5n, ME]);
});
