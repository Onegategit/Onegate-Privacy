import { PRIVACY, type PrivacyToken } from "./privacy-config";
// SDK browser storage also works in a dedicated worker via IndexedDB.
(globalThis as unknown as { window: unknown }).window = globalThis;
let approval: {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
} | null = null;
let working = false;
const send = (type: string, data: unknown) => postMessage({ type, data });
const approve = (type: string, data: unknown) =>
  new Promise<unknown>((resolve, reject) => {
    approval = { resolve, reject };
    send(type, data);
  });
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url === PRIVACY.relay && init?.method === "POST") {
    const body = JSON.parse(String(init.body));
    await approve("relay-review", body);
    send("stage", "Submitting withdrawal to relay");
    const response = await originalFetch(input, init);
    const copy = response.clone();
    try {
      const data = await copy.json();
      if (response.ok && data.success && /^0x[\da-f]{64}$/i.test(data.txHash))
        send("submitted", data.txHash);
    } catch {}
    return response;
  }
  return originalFetch(input, { ...init, signal: AbortSignal.timeout(45000) });
};
self.onmessage = async (e: MessageEvent) => {
  const data = e.data;
  if (data.type === "approve") {
    approval?.resolve(data.value);
    approval = null;
    return;
  }
  if (data.type === "reject") {
    approval?.reject(Error("Request cancelled before submission"));
    approval = null;
    return;
  }
  if (working) return;
  working = true;
  try {
    const sdk = await import("privacycash-evm");
    sdk.setLogger((level, message) => {
      if (level !== "info") return;
      const safe = message.startsWith("decrypting utxo")
        ? "Scanning encrypted notes"
        : message.includes("generating ZK proof")
          ? "Generating proof locally"
          : message.includes("screening wallet")
            ? "Checking provider eligibility"
            : message.includes("confirming transaction")
              ? "Waiting for indexer confirmation"
              : null;
      if (safe) send("stage", safe);
    });
    const net = sdk.ROBINHOOD_NETWORK;
    if (
      net.chainId !== PRIVACY.chainId ||
      net.etherPoolAddress.toLowerCase() !== PRIVACY.ethPool.toLowerCase() ||
      net.usdgPoolAddress.toLowerCase() !== PRIVACY.usdgPool.toLowerCase() ||
      net.usdgTokenAddress.toLowerCase() !== PRIVACY.usdgToken.toLowerCase() ||
      net.feeRecipientAddress.toLowerCase() !==
        PRIVACY.feeRecipient.toLowerCase() ||
      net.rpcUrl !== PRIVACY.rpc ||
      net.indexerUrl !== PRIVACY.indexer
    )
      throw Error("SDK network configuration changed");
    if (data.type === "ready") {
      send("result", { version: "1.3.3", chainId: net.chainId });
      return;
    }
    const params = {
      signature: data.signature as string,
      address: data.address as string,
      token: data.token as PrivacyToken,
      network: net,
      keyBasePath: PRIVACY.circuits,
    };
    if (data.type === "balance") send("result", await sdk.getBalance(params));
    else if (data.type === "deposit")
      send(
        "result",
        await sdk.deposit({
          ...params,
          depositAmountInput: data.amount,
          txSender: async (tx: unknown) =>
            approve("transaction", JSON.parse(JSON.stringify(tx))),
        }),
      );
    else if (data.type === "withdraw")
      send(
        "result",
        await sdk.withdraw({
          ...params,
          withdrawAmountInput: data.amount,
          recipient: data.recipient,
        }),
      );
    else throw Error("Unknown operation");
  } catch (error) {
    send(
      "error",
      error instanceof Error ? error.message : "Privacy engine failed",
    );
  } finally {
    working = false;
  }
};
