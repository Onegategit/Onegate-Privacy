import { expect } from "@playwright/test";
import { launch } from "./browser.mjs";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { checkDepositTransaction } from "../src/privacy-checks.ts";
import { writeFileSync, readdirSync } from "node:fs";
const base = process.env.BASE_URL || "http://localhost:5586";
const account = privateKeyToAccount(generatePrivateKey());
const signature = await account.signMessage({
  message: "Privacy Money account sign in",
});
const browser = await launch({
  headless: true,
});
try {
  const page = await browser.newPage();
  let prohibited = 0;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/relayer/**", (r) => {
    prohibited++;
    return r.abort();
  });
  await page.route("**/rpc/robinhood", (r) => {
    if (
      /eth_send(Transaction|RawTransaction)/.test(r.request().postData() || "")
    ) {
      prohibited++;
      return r.abort();
    }
    return r.continue();
  });
  // the holders gate in front of the workspace: this mock wallet reads as a holder
  await page.route("**/api/terminal?action=holder*", (r) => r.fulfill({ json: { account: new URL(r.request().url()).searchParams.get("account"), balance: "1", amount: 1e7, priceUsd: 0.00003, priceSource: "curve", worthUsd: 300, minUsd: 150, ok: true, at: new Date().toISOString() } }));
  await page.goto(base + "/privacy", { waitUntil: "networkidle" });
  const workerPath = process.env.BASE_URL
    ? "/assets/" +
      readdirSync("dist/assets").find((n) => /^privacy\.worker-.*\.js$/.test(n))
    : null;
  const result = await page.evaluate(
    async ({ signature, address, workerPath }) => {
      const Constructor = workerPath
        ? null
        : (await import("/src/privacy.worker.ts?worker")).default;
      const execute = (type) =>
        new Promise((resolve, reject) => {
          const w = workerPath
            ? new Worker(workerPath, { type: "module" })
            : new Constructor();
          const stages = [];
          const timer = setTimeout(() => {
            w.terminate();
            reject(Error("Local proof timeout"));
          }, 240000);
          const done = (fn, v) => {
            clearTimeout(timer);
            w.terminate();
            fn(v);
          };
          w.onerror = (e) => done(reject, Error(e.message));
          w.onmessage = (e) => {
            const { type: event, data } = e.data;
            if (event === "stage") stages.push(data);
            if (event === "error") done(reject, Error(data));
            if (event === "transaction") {
              w.postMessage({ type: "reject" });
              done(resolve, { tx: data, stages, cancelledBeforeWallet: true });
            }
            if (event === "result") done(resolve, { result: data, stages });
            if (event === "relay-review" || event === "submitted")
              done(reject, Error("Unexpected financial submission"));
          };
          w.postMessage({
            type,
            signature,
            address,
            token: "eth",
            amount: 0.0005,
          });
        });
      return {
        balance: await execute("balance"),
        proof: await execute("deposit"),
      };
    },
    { signature, address: account.address, workerPath },
  );
  expect(Number(result.balance.result.balance)).toBe(0);
  expect(
    checkDepositTransaction(result.proof.tx, "eth", 500000000000000n),
  ).toBe("Deposit ETH");
  expect(prohibited).toBe(0);
  expect(errors).toEqual([]);
  const safe = {
    network: "Robinhood",
    sdk: "1.3.3",
    unfundedEphemeralIdentity: true,
    balance: "0",
    proofGenerated: true,
    depositTransactionValidated: true,
    cancelledBeforeWallet: true,
    relayCalls: 0,
    broadcasts: 0,
    stages: result.proof.stages,
    errors,
  };
  writeFileSync(
    "artifacts/privacy-proof-verification.json",
    JSON.stringify(safe, null, 2),
  );
  console.log(JSON.stringify(safe));
} finally {
  await browser.close();
}
