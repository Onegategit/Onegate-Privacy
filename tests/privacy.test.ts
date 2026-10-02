import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, erc20Abi, parseUnits, type Abi } from "viem";
import {
  amountUnits,
  checkDepositTransaction,
  checkRelayPayload,
  integer,
  validRecipient,
} from "../src/privacy-checks";
import { PRIVACY } from "../src/privacy-config";
import abi from "../src/privacy-pool-abi.json";
test("privacy amount parser preserves exact SDK representation", () => {
  assert.equal(amountUnits("0.001", "eth"), 1000000000000000n);
  assert.equal(amountUnits("10.25", "usdg"), 10250000n);
  for (const value of ["0", "-1", "1e3", "NaN", "1,000", ".1", "0.0000001"])
    assert.throws(() => amountUnits(value, "usdg"));
  assert.throws(() => amountUnits("0.123456789012345678", "eth"));
  assert.throws(() => amountUnits("0.0000001", "eth"));
});
test("withdraw recipient excludes zero, bad checksum and configured pools", () => {
  assert.ok(validRecipient("0x3333333333333333333333333333333333333333"));
  for (const address of [
    "0x0000000000000000000000000000000000000000",
    PRIVACY.ethPool,
    PRIVACY.usdgPool,
    PRIVACY.usdgToken,
    "invalid",
  ])
    assert.equal(validRecipient(address), false);
});
test("relay guard binds chain, amount, recipient and exact fee", () => {
  const recipient = "0x3333333333333333333333333333333333333333",
    amount = parseUnits("0.01", 18),
    fee = parseUnits("0.000585", 18);
  const body = {
    chain: "robinhood",
    token: "eth",
    extData: {
      fee: String(fee),
      extAmount: String(-amount + fee),
      recipient,
      feeRecipient: PRIVACY.feeRecipient,
    },
  };
  assert.equal(
    checkRelayPayload(body, "eth", amount, recipient, fee).received,
    amount - fee,
  );
  assert.equal(integer("-0xff"), -255n);
  for (const changed of [
    { ...body, chain: "base" },
    { ...body, token: "usdg" },
    { ...body, extData: { ...body.extData, fee: String(fee + 1n) } },
    { ...body, extData: { ...body.extData, recipient: PRIVACY.ethPool } },
    { ...body, extData: { ...body.extData, extAmount: String(-amount) } },
  ])
    assert.throws(() =>
      checkRelayPayload(changed, "eth", amount, recipient, fee),
    );
});
test("USDG approval is limited to reviewed deposit amount and pool", () => {
  const amount = 10000000n,
    data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [PRIVACY.usdgPool, amount],
    });
  assert.equal(
    checkDepositTransaction(
      { chainId: 4663, to: PRIVACY.usdgToken, data },
      "usdg",
      amount,
    ),
    "Approve USDG",
  );
  assert.throws(() =>
    checkDepositTransaction(
      { chainId: 1, to: PRIVACY.usdgToken, data },
      "usdg",
      amount,
    ),
  );
  assert.throws(() =>
    checkDepositTransaction(
      { chainId: 4663, to: PRIVACY.usdgToken, data },
      "usdg",
      1n,
    ),
  );
  assert.throws(() =>
    checkDepositTransaction(
      { chainId: 4663, to: PRIVACY.usdgToken, data, value: 1 },
      "usdg",
      amount,
    ),
  );
});
test("ETH deposit validates decoded amount, fee, target and native value", () => {
  const amount = 1000000000000000n,
    z = "0x" + "0".repeat(64);
  const args = [
    {
      pA: [0n, 0n],
      pB: [
        [0n, 0n],
        [0n, 0n],
      ],
      pC: [0n, 0n],
      root: z,
      inputNullifiers: [z, z],
      outputCommitments: [z, z],
      publicAmount: amount,
      extDataHash: z,
    },
    {
      recipient: "0x3333333333333333333333333333333333333333",
      extAmount: amount,
      feeRecipient: PRIVACY.feeRecipient,
      fee: 0n,
      encryptedOutput1: "0x",
      encryptedOutput2: "0x",
    },
  ];
  const data = encodeFunctionData({
      abi: abi as Abi,
      functionName: "transact",
      args,
    }),
    tx = {
      chainId: 4663,
      to: PRIVACY.ethPool,
      value: { hex: "0x" + amount.toString(16) },
      data,
    };
  assert.equal(checkDepositTransaction(tx, "eth", amount), "Deposit ETH");
  assert.throws(() =>
    checkDepositTransaction({ ...tx, to: PRIVACY.usdgPool }, "eth", amount),
  );
  assert.throws(() =>
    checkDepositTransaction({ ...tx, value: 1 }, "eth", amount),
  );
  assert.throws(() =>
    checkDepositTransaction({ ...tx, data: "0x" }, "eth", amount),
  );
});
