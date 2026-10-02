import { expect } from "@playwright/test";
import { launch } from "./browser.mjs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
const base = process.env.BASE_URL || "http://localhost:5586";
const account = privateKeyToAccount(generatePrivateKey());
const signature = await account.signMessage({
  message: "Privacy Money account sign in",
});
const pool = "0xEC5266c9e44631e1ba22FD6377C38130c1F3B738",
  recipient = "0x3333333333333333333333333333333333333333",
  feeRecipient = "0xe7E15cbF5FC58c37948D23788eACAef11Bf29e37";
const abi = JSON.parse(readFileSync("src/privacy-pool-abi.json", "utf8"));
const amount = 1000000000000000n,
  z = "0x" + "0".repeat(64);
const depositTx = {
  chainId: 4663,
  to: pool,
  value: "0x" + amount.toString(16),
  data: encodeFunctionData({
    abi,
    functionName: "transact",
    args: [
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
        recipient,
        extAmount: amount,
        feeRecipient,
        fee: 0n,
        encryptedOutput1: "0x",
        encryptedOutput2: "0x",
      },
    ],
  }),
};
const browser = await launch({
  headless: true,
});
const results = [];
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/privacy", (r) =>
    r.fulfill({
      json: {
        checkedAt: Date.now(),
        chainId: 4663,
        configAvailable: true,
        config: {
          fee_rate: 35,
          rent_fees: { eth: 0.00055, usdg: 1.4 },
          minimum_withdrawal: { eth: 0.005, usdg: 10 },
          minimum_deposit: { eth: 0.0005, usdg: 10 },
        },
        pools: {
          eth: {
            address: pool,
            deployed: true,
            minimum: "500000000000000",
            maximum: "1000000000000000000000",
          },
          usdg: {
            deployed: true,
            minimum: "10000000",
            maximum: "1000000000000",
          },
        },
      },
    }),
  );
  await page.addInitScript(
    ({ address, signature, depositTx, recipient, feeRecipient }) => {
      window.methods = [];
      window.workerMessages = [];
      window.walletListeners = {};
      window.terminated = 0;
      window.mockChain = "0x1";
      window.ethereum = {
        request: async ({ method, params }) => {
          window.methods.push(method);
          if (method === "eth_accounts" || method === "eth_requestAccounts")
            return [address];
          if (method === "eth_chainId") return window.mockChain;
          if (method === "wallet_switchEthereumChain") {
            window.mockChain = params[0].chainId;
            window.walletListeners.chainChanged?.(window.mockChain);
            return null;
          }
          if (method === "eth_getBalance") return "0xde0b6b3a7640000";
          if (method === "personal_sign") return signature;
          if (method === "eth_sendTransaction")
            throw Error("Fixture: rejected in wallet before broadcast");
          throw Error("Unexpected wallet request: " + method);
        },
        on: (event, cb) => (window.walletListeners[event] = cb),
        removeListener: (event) => delete window.walletListeners[event],
      };
      window.Worker = class {
        postMessage(msg) {
          window.workerMessages.push(msg.type);
          const emit = (type, data) =>
            setTimeout(() => this.onmessage?.({ data: { type, data } }), 30);
          if (msg.type === "balance") emit("result", { balance: "1.0" });
          if (msg.type === "deposit") emit("transaction", depositTx);
          if (msg.type === "withdraw")
            emit("relay-review", {
              chain: "robinhood",
              token: "eth",
              extData: {
                recipient,
                feeRecipient,
                fee: "585000000000000",
                extAmount: "-9415000000000000",
              },
            });
          if (msg.type === "reject")
            emit("error", "Request cancelled before submission");
          if (msg.type === "approve")
            emit("error", "Fixture relay stopped before network submission");
        }
        terminate() {
          window.terminated++;
          this.onmessage = null;
        }
      };
    },
    { address: account.address, signature, depositTx, recipient, feeRecipient },
  );
  await page.goto(base + "/privacy", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("button", { name: "Switch to Robinhood", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.methods.includes("personal_sign")),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Switch to Robinhood", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Unlock private account" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Unlock private account" }).click();
  await expect(page.getByRole("status")).toContainText("Unlocked for this tab");
  expect(
    await page.evaluate(
      () => window.methods.filter((m) => m === "personal_sign").length,
    ),
  ).toBe(2);
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("onegate.privacy.key."),
        ).length,
    ),
  ).toBe(1);
  await page.getByLabel("Payment amount").fill("0.001");
  await page.getByRole("button", { name: "Prepare deposit" }).click();
  await expect(page.getByRole("dialog")).toContainText("Deposit ETH");
  expect(
    await page.evaluate(() => window.methods.includes("eth_sendTransaction")),
  ).toBe(false);
  await page.screenshot({
    path: "artifacts/privacy-deposit-review-fixture.png",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "cancelled" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Prepare deposit" }).click();
  await page.getByRole("button", { name: "Continue to wallet" }).click();
  await expect(
    page.getByRole("button", { name: "Withdraw", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => window.methods.filter((m) => m === "eth_sendTransaction").length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await page
    .getByRole("button", { name: "Refresh balance", exact: true })
    .click();
  await expect(page.locator(".privacy-balance strong")).toContainText("1.0");
  await page.getByLabel("Payment amount").fill("0.01");
  await page.getByLabel("Recipient wallet").fill(recipient);
  await page.getByRole("button", { name: "Prepare withdrawal" }).click();
  await expect(page.getByRole("dialog")).toContainText("0.009415");
  expect(
    await page.evaluate(() => window.workerMessages.includes("approve")),
  ).toBe(false);
  await page.getByRole("button", { name: "Confirm relay withdrawal" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Fixture relay stopped" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => window.workerMessages.filter((m) => m === "approve").length,
    ),
  ).toBe(1);
  await page.evaluate(() => {
    window.mockChain = "0x1";
    window.walletListeners.chainChanged?.("0x1");
  });
  await expect(
    page.getByRole("button", { name: "Switch to Robinhood", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Lock account", exact: true }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.terminated)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  results.push({
    mockedWallet: true,
    explicitSignatures: true,
    exactApproval: true,
    cancelBeforeSend: true,
    relayNeedsReview: true,
    chainChangeLocks: true,
    realTransactions: 0,
    errors,
  });
  await page.goto(base + "/privacy");
  await page
    .getByRole("button", { name: "Switch to Robinhood", exact: true })
    .click();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) =>
      k.startsWith("onegate.privacy.key."),
    );
    localStorage.setItem(key, "inconsistent-fingerprint");
  });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Unlock private account" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "differs from your saved" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Prepare deposit" }),
  ).toHaveCount(0);
  results.push({ inconsistentSignatureBlocked: true });
  writeFileSync(
    "artifacts/privacy-verification.json",
    JSON.stringify(results, null, 2),
  );
  console.log("Privacy safety workflow verified without real funds");
} finally {
  await browser.close();
}
