import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FileJson,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Send,
  Shield,
  Wallet,
  X,
  Activity,
} from "lucide-react";
import {
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  stringToHex,
  keccak256,
  verifyMessage,
  toHex,
  type Hex,
} from "viem";
import {
  usePrivacyWallet as useWallet,
  usePrivacyHealth,
} from "./privacy-wallet";
import { Link } from "react-router-dom";
import { short } from "./shared";
import {
  PRIVACY,
  type PrivacyHealth,
  type PrivacyToken,
} from "./privacy-config";
import {
  amountUnits,
  checkDepositTransaction,
  checkRelayPayload,
  decimalsFor,
  integer,
  validRecipient,
} from "./privacy-checks";

type Entry = { id: number; title: string; state: string; hash?: string };
type Review = {
  type: "transaction" | "relay-review";
  data: Record<string, unknown>;
  label: string;
  received?: string;
  fee?: string;
};
const client = createPublicClient({
  transport: http(PRIVACY.rpc, { timeout: 15000, retryCount: 1 }),
});
export default function Privacy() {
  const wallet = useWallet(),
    health = usePrivacyHealth();
  const [mode, setMode] = useState<"deposit" | "withdraw" | "activity">(
      "deposit",
    ),
    [token, setToken] = useState<PrivacyToken>("eth"),
    [amount, setAmount] = useState(""),
    [recipient, setRecipient] = useState(""),
    [ack, setAck] = useState(false),
    [unlocked, setUnlocked] = useState(false),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState("Wallet not unlocked"),
    [error, setError] = useState(""),
    [balance, setBalance] = useState<string | null>(null),
    [review, setReview] = useState<Review | null>(null),
    [events, setEvents] = useState<Entry[]>([]),
    [engine, setEngine] = useState("Not loaded"),
    [clock, setClock] = useState(Date.now());
  const signature = useRef(""),
    worker = useRef<Worker | null>(null),
    version = useRef(0),
    walletRef = useRef(wallet),
    busyRef = useRef(false),
    submitted = useRef(""),
    reviewRef = useRef<Review | null>(null);
  walletRef.current = wallet;
  reviewRef.current = review;
  useEffect(() => {
    if (!review) return;
    const previous = document.activeElement as HTMLElement | null;
    const box = document.querySelector<HTMLElement>(".payment-review");
    const controls = () =>
      Array.from(box?.querySelectorAll<HTMLElement>("button,a[href]") ?? []);
    controls()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        worker.current?.postMessage({ type: "reject" });
        setReview(null);
      }
      if (e.key === "Tab") {
        const items = controls(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [review]);
  const lock = () => {
    version.current++;
    worker.current?.terminate();
    worker.current = null;
    signature.current = "";
    busyRef.current = false;
    setUnlocked(false);
    setBalance(null);
    setBusy(false);
    setReview(null);
    setStage("Wallet locked");
  };
  useEffect(() => {
    lock();
    setError("");
  }, [wallet.address, wallet.chain, wallet.provider]);
  useEffect(() => {
    setBalance(null);
    setAmount("");
    setReview(null);
  }, [token]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      version.current++;
      worker.current?.terminate();
      signature.current = "";
    };
  }, []);
  const cfg = health.data?.config,
    decimals = decimalsFor(token);
  const fresh = Boolean(
    health.data && clock - health.data.checkedAt < 120000 && !health.error,
  );
  let units = 0n,
    fee = 0n,
    receive = 0n,
    amountError = "";
  try {
    if (amount) {
      units = amountUnits(amount, token);
      if (cfg) {
        fee =
          parseUnits(cfg.rent_fees[token].toFixed(decimals), decimals) +
          (units * BigInt(cfg.fee_rate)) / 10000n;
        receive = units - fee;
      }
    }
  } catch (e) {
    amountError = (e as Error).message;
  }
  const identity = async (captured = version.current) => {
    const w = walletRef.current;
    if (
      !w.provider ||
      !w.address ||
      w.chain !== PRIVACY.chainHex ||
      captured !== version.current
    )
      throw Error("Connect the same wallet on Robinhood Chain");
    const accounts = await w.provider.request({ method: "eth_accounts" }),
      chain = await w.provider.request({ method: "eth_chainId" });
    if (
      captured !== version.current ||
      chain !== PRIVACY.chainHex ||
      !Array.isArray(accounts) ||
      String(accounts[0]).toLowerCase() !== w.address.toLowerCase()
    )
      throw Error("Wallet changed. Unlock again.");
    return w;
  };
  const event = (title: string, state: string, hash?: string) =>
    setEvents((old) =>
      [{ id: Date.now(), title, state, hash }, ...old].slice(0, 30),
    );
  async function unlock() {
    if (busyRef.current) return;
    if (!ack) {
      setError("Read and accept the key recovery notice first");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    const captured = version.current;
    try {
      const w = await identity(captured);
      setStage("Confirm the unlock message in your wallet");
      const first = await w.provider!.request({
        method: "personal_sign",
        params: [stringToHex(PRIVACY.message), w.address],
      });
      await identity(captured);
      if (
        typeof first !== "string" ||
        !/^0x[\da-f]{130}$/i.test(first) ||
        !(await verifyMessage({
          address: w.address as Hex,
          message: PRIVACY.message,
          signature: first as Hex,
        }))
      )
        throw Error("Wallet signature verification failed");
      const fingerprint = keccak256(first as Hex),
        key = "onegate.privacy.key." + w.address.toLowerCase();
      const previous = localStorage.getItem(key);
      if (previous && previous !== fingerprint)
        throw Error(
          "This signature differs from your saved key fingerprint. Do not deposit. Return to the original wallet and signing method.",
        );
      if (!previous) {
        setStage("Sign the same message again to check key consistency");
        const second = await w.provider!.request({
          method: "personal_sign",
          params: [stringToHex(PRIVACY.message), w.address],
        });
        await identity(captured);
        if (second !== first)
          throw Error(
            "This wallet produced different signatures. Deposits are blocked to protect recovery.",
          );
        localStorage.setItem(key, fingerprint);
      }
      await identity(captured);
      signature.current = first;
      setUnlocked(true);
      setStage("Unlocked for this tab");
      event("Private account", "Unlocked locally");
    } catch (e) {
      if (captured === version.current) setError((e as Error).message);
    } finally {
      if (captured === version.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  async function confirmHash(hash: string, label: string, captured: number) {
    if (!/^0x[\da-f]{64}$/i.test(hash))
      throw Error("Provider returned an invalid transaction hash");
    submitted.current = hash;
    event(label, "Submitted", hash);
    setStage("Waiting for onchain receipt");
    const receipt = await client.waitForTransactionReceipt({
      hash: hash as Hex,
      confirmations: 1,
      timeout: 120000,
    });
    if (receipt.status !== "success") {
      event(label, "Reverted", hash);
      throw Error("Transaction reverted onchain");
    }
    event(label, "Confirmed onchain", hash);
    if (captured !== version.current)
      throw Error(
        "Wallet changed after submission. Check the transaction in the explorer.",
      );
    return hash;
  }
  async function run(operation: "ready" | "balance" | "deposit" | "withdraw") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setReview(null);
    submitted.current = "";
    const captured = version.current,
      selectedToken = token,
      selectedRecipient = recipient.trim(),
      selectedUnits = units,
      selectedFee = fee;
    try {
      let w = walletRef.current;
      if (operation !== "ready") {
        w = await identity(captured);
        if (!signature.current)
          throw Error("Unlock your private account first");
      }
      if (operation === "deposit" || operation === "withdraw") {
        if (!fresh || !health.data)
          throw Error("Refresh provider and pool status before continuing");
        if (amountError || selectedUnits <= 0n)
          throw Error(amountError || "Enter an amount");
        if (operation === "deposit") {
          const limits = health.data.pools[selectedToken];
          if (
            selectedUnits < BigInt(limits.minimum) ||
            selectedUnits > BigInt(limits.maximum)
          )
            throw Error("Amount is outside the current onchain deposit limits");
          if (
            selectedToken === "eth" &&
            w.balance !== null &&
            selectedUnits >= parseUnits(w.balance, 18)
          )
            throw Error("Leave enough public ETH for gas");
        } else {
          if (!validRecipient(selectedRecipient))
            throw Error(
              "Enter a valid recipient address, not a pool or token contract",
            );
          if (balance === null)
            throw Error("Refresh your private balance first");
          if (selectedUnits > parseUnits(balance, decimalsFor(selectedToken)))
            throw Error("Insufficient private balance");
          if (
            selectedUnits <
              parseUnits(
                cfg!.minimum_withdrawal[selectedToken].toFixed(
                  decimalsFor(selectedToken),
                ),
                decimalsFor(selectedToken),
              ) ||
            selectedFee * 2n >= selectedUnits
          )
            throw Error(
              "Amount is below the provider minimum or too small after fees",
            );
        }
      }
      worker.current?.terminate();
      const instance = new Worker(
        new URL("./privacy.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = instance;
      setEngine("Loading");
      setStage(
        operation === "ready"
          ? "Loading privacy engine"
          : "Preparing " + operation,
      );
      instance.onerror = () => {
        if (captured !== version.current) return;
        setError(
          "Privacy engine failed to load. No automatic retry or transfer was performed.",
        );
        setEngine("Unavailable");
        setBusy(false);
        busyRef.current = false;
        instance.terminate();
      };
      instance.onmessage = async (e) => {
        if (captured !== version.current) return;
        const { type, data } = e.data;
        setEngine("Ready");
        if (type === "stage") {
          setStage(data);
          return;
        }
        if (type === "transaction") {
          try {
            await identity(captured);
            const label = checkDepositTransaction(
              data,
              selectedToken,
              selectedUnits,
            );
            setReview({ type, data, label });
            setStage("Review wallet transaction");
          } catch (err) {
            instance.postMessage({ type: "reject" });
            setError((err as Error).message);
          }
          return;
        }
        if (type === "relay-review") {
          try {
            await identity(captured);
            const check = checkRelayPayload(
              data,
              selectedToken,
              selectedUnits,
              selectedRecipient,
              selectedFee,
            );
            setReview({
              type,
              data,
              label: "Relay withdrawal",
              received: formatUnits(check.received, decimalsFor(selectedToken)),
              fee: formatUnits(check.fee, decimalsFor(selectedToken)),
            });
            setStage("Review relay submission");
          } catch (err) {
            instance.postMessage({ type: "reject" });
            setError((err as Error).message);
          }
          return;
        }
        if (type === "submitted") {
          submitted.current = data;
          event("Withdrawal", "Submitted to chain", data);
          return;
        }
        if (type === "error") {
          setError(
            submitted.current
              ? "A transaction was already submitted. Check its receipt before retrying. Provider message: " +
                  String(data)
              : String(data),
          );
          setStage(
            submitted.current
              ? "Check submitted transaction"
              : "Operation stopped",
          );
          setBusy(false);
          busyRef.current = false;
          setReview(null);
          instance.terminate();
          return;
        }
        if (type === "result") {
          try {
            if (operation === "balance") {
              setBalance(data.balance);
              setStage("Private balance updated");
            } else if (operation === "ready") setStage("Privacy engine loaded");
            else if (operation === "withdraw") {
              await confirmHash(data, "Withdrawal", captured);
              setBalance(null);
              setStage("Withdrawal confirmed");
            } else {
              setBalance(null);
              setStage("Deposit confirmed; refresh private balance");
            }
          } catch (err) {
            if (captured === version.current) setError((err as Error).message);
          } finally {
            if (captured === version.current) {
              setBusy(false);
              busyRef.current = false;
              setReview(null);
            }
            instance.terminate();
          }
        }
      };
      instance.postMessage({
        type: operation,
        signature: signature.current,
        address: w.address,
        token: selectedToken,
        amount: Number(amount),
        recipient: selectedRecipient,
      });
    } catch (e) {
      if (captured === version.current) {
        setError((e as Error).message);
        setBusy(false);
        busyRef.current = false;
      }
    }
  }
  async function approveReview() {
    const pending = reviewRef.current,
      instance = worker.current,
      captured = version.current;
    if (!pending || !instance) return;
    reviewRef.current = null;
    setReview(null);
    try {
      const w = await identity(captured);
      const response = await fetch("/api/privacy", {
        cache: "no-store",
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok)
        throw Error("Provider checks unavailable. Nothing was submitted.");
      const current = (await response.json()) as PrivacyHealth;
      if (
        current.chainId !== PRIVACY.chainId ||
        Date.now() - current.checkedAt > 120000
      )
        throw Error("Provider checks expired. Prepare a new operation.");
      await identity(captured);
      const exactAmount = amountUnits(amount, token);
      if (pending.type === "relay-review") {
        const latestFee =
          parseUnits(
            current.config.rent_fees[token].toFixed(decimalsFor(token)),
            decimalsFor(token),
          ) +
          (exactAmount * BigInt(current.config.fee_rate)) / 10000n;
        checkRelayPayload(
          pending.data,
          token,
          exactAmount,
          recipient.trim(),
          latestFee,
        );
      } else {
        const limits = current.pools[token];
        if (
          exactAmount < BigInt(limits.minimum) ||
          exactAmount > BigInt(limits.maximum)
        )
          throw Error("Deposit limits changed. Prepare a new deposit.");
        checkDepositTransaction(pending.data, token, exactAmount);
      }
      if (pending.type === "relay-review") {
        instance.postMessage({ type: "approve", value: true });
        event("Withdrawal", "Relay submission approved");
        return;
      }
      const tx = pending.data;
      const rpcTx: Record<string, unknown> = {
        from: w.address,
        to: tx.to,
        data: tx.data,
        chainId: PRIVACY.chainHex,
      };
      for (const [field, out] of [
        ["value", "value"],
        ["gasLimit", "gas"],
        ["gasPrice", "gasPrice"],
        ["maxFeePerGas", "maxFeePerGas"],
        ["maxPriorityFeePerGas", "maxPriorityFeePerGas"],
      ])
        if (tx[field] != null) rpcTx[out] = toHex(integer(tx[field]));
      setStage("Confirm " + pending.label.toLowerCase() + " in your wallet");
      const hash = await w.provider!.request({
        method: "eth_sendTransaction",
        params: [rpcTx],
      });
      await confirmHash(String(hash), pending.label, captured);
      instance.postMessage({ type: "approve", value: hash });
    } catch (e) {
      instance.postMessage({ type: "reject" });
      setError((e as Error).message);
    }
  }

  const activeToken = token.toUpperCase();
  function cancelReview() {
    worker.current?.postMessage({ type: "reject" });
    reviewRef.current = null;
    setReview(null);
  }
  return (
    <main className="workspace privacy-workspace">
      <div className="workspace-heading">
        <div>
          <span className="section-label">Robinhood Chain</span>
          <h1>Privacy workspace</h1>
          <p>Private pool access with local proofs and a withdrawal relay</p>
        </div>
        <Link className="privacy-guide" to="/docs#privacy">
          Keys & recovery <ArrowUpRight size={18} />
        </Link>
      </div>
      <div className="privacy-desk">
        <aside className="privacy-sidebar">
          <h2>Private account</h2>
          <span className="privacy-address">
            {wallet.address ? short(wallet.address) : "No wallet connected"}
          </span>
          <dl>
            <dt>Network</dt>
            <dd>
              {wallet.chain === PRIVACY.chainHex
                ? "Robinhood"
                : wallet.chain
                  ? "Switch network"
                  : "--"}
            </dd>
            <dt>Public ETH</dt>
            <dd>{wallet.balance ?? "--"}</dd>
            <dt>Private key</dt>
            <dd>{unlocked ? "Unlocked in this tab" : "Locked"}</dd>
          </dl>
          <button
            className="privacy-button"
            onClick={wallet.open}
            disabled={wallet.connecting || busy}
          >
            <Wallet size={16} />
            {wallet.connecting
              ? "Connecting"
              : wallet.address
                ? "Check wallet"
                : "Connect wallet"}
          </button>
          {wallet.error && (
            <p className="privacy-error" role="alert">
              {wallet.error}
            </p>
          )}
          <div className="privacy-balance">
            <span>Private balance</span>
            <strong>
              {balance ?? "--"} <small>{activeToken}</small>
            </strong>
            <button
              className="privacy-button secondary"
              disabled={!unlocked || busy}
              onClick={() => void run("balance")}
            >
              <RefreshCw size={15} />
              Refresh balance
            </button>
            <p>Encrypted notes are read and decrypted locally</p>
          </div>
          <Link className="privacy-inspector" to="/vault">
            <FileJson size={23} />
            <span>
              File vault<small>Encrypt files on this device</small>
            </span>
            <ArrowUpRight size={18} />
          </Link>
        </aside>
        <section className="privacy-editor">
          <div
            className="privacy-tabs"
            role="group"
            aria-label="Privacy operation"
          >
            {(["deposit", "withdraw", "activity"] as const).map((v) => (
              <button
                key={v}
                aria-pressed={mode === v}
                disabled={busy}
                onClick={() => {
                  setMode(v);
                  setError("");
                }}
              >
                {v === "deposit"
                  ? "Deposit"
                  : v === "withdraw"
                    ? "Withdraw"
                    : "Activity"}
              </button>
            ))}
          </div>
          {mode === "activity" ? (
            <div className="privacy-activity">
              <h2>Session activity</h2>
              <p>
                Records stay in this tab and are not a complete wallet history
              </p>
              {events.length ? (
                events.map((e) => (
                  <article key={e.id + e.title + e.state}>
                    <Activity size={18} />
                    <div>
                      <strong>{e.title}</strong>
                      <p>{e.state}</p>
                      {e.hash && (
                        <a
                          href={"https://robin.etherscan.io/tx/" + e.hash}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction <ArrowUpRight size={14} />
                        </a>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <p className="privacy-empty">No operations in this session</p>
              )}
            </div>
          ) : (
            <>
              <div className="privacy-form-title">
                <h2>
                  {mode === "deposit" ? "Into the pool" : "To a recipient"}
                </h2>
                <p>
                  {mode === "deposit"
                    ? "Review a deposit from your public wallet"
                    : "Build a local proof before you approve relay submission"}
                </p>
              </div>
              <div className="privacy-form">
                <label>
                  Asset
                  <select
                    aria-label="Privacy asset"
                    disabled={busy}
                    value={token}
                    onChange={(e) => setToken(e.target.value as PrivacyToken)}
                  >
                    <option value="eth">ETH / Ether</option>
                    <option value="usdg">USDG / Global Dollar</option>
                  </select>
                </label>
                <label>
                  {mode === "deposit"
                    ? "Deposit amount"
                    : "Withdrawal amount including fees"}
                  <div className="privacy-amount">
                    <input
                      aria-label="Payment amount"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amount}
                      disabled={busy}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <b>{activeToken}</b>
                  </div>
                </label>
                {mode === "withdraw" && (
                  <label>
                    Recipient wallet
                    <input
                      aria-label="Recipient wallet"
                      placeholder="0x..."
                      value={recipient}
                      disabled={busy}
                      onChange={(e) => setRecipient(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                )}
                {amountError && <p className="privacy-error">{amountError}</p>}
                <dl className="privacy-summary">
                  <dt>
                    {mode === "deposit"
                      ? "Private balance increase"
                      : "Recipient receives"}
                  </dt>
                  <dd>
                    {units > 0n
                      ? formatUnits(
                          mode === "deposit"
                            ? units
                            : receive > 0n
                              ? receive
                              : 0n,
                          decimals,
                        )
                      : "--"}{" "}
                    {activeToken}
                  </dd>
                  <dt>
                    {mode === "deposit"
                      ? "Network gas"
                      : "Estimated withdrawal fees"}
                  </dt>
                  <dd>
                    {mode === "deposit"
                      ? "Quoted by wallet"
                      : cfg && units > 0n
                        ? formatUnits(fee, decimals) + " " + activeToken
                        : "--"}
                  </dd>
                </dl>
                {mode === "deposit" && token === "usdg" && (
                  <p className="privacy-note">
                    USDG approval is limited to the exact deposit amount and may
                    require a separate wallet transaction
                  </p>
                )}
                {!unlocked && (
                  <div className="privacy-recovery">
                    <KeyRound size={23} />
                    <div>
                      <h3>Your signature is your recovery key</h3>
                      <p>
                        The protocol message is{" "}
                        <strong>Privacy Money account sign in</strong>. Only
                        sign here when you intend to unlock. Never share the
                        signature. Use the same wallet and signing method to
                        recover funds. Hardware wallets are not supported by
                        this SDK.
                      </p>
                      <label>
                        <input
                          type="checkbox"
                          checked={ack}
                          disabled={busy}
                          onChange={(e) => setAck(e.target.checked)}
                        />
                        I understand the signature and recovery requirement
                      </label>
                    </div>
                  </div>
                )}
                <div className="privacy-form-actions">
                  {!wallet.address || wallet.chain !== PRIVACY.chainHex ? (
                    <button
                      className="privacy-button"
                      disabled={wallet.connecting || busy}
                      onClick={wallet.open}
                    >
                      <Wallet size={16} />
                      {wallet.address
                        ? "Switch to Robinhood"
                        : "Connect wallet"}
                    </button>
                  ) : !unlocked ? (
                    <button
                      className="privacy-button"
                      disabled={busy || !ack}
                      onClick={() => void unlock()}
                    >
                      <KeyRound size={16} />
                      Unlock private account
                    </button>
                  ) : (
                    <button
                      className="privacy-button"
                      disabled={busy || !fresh || !amount || !!amountError}
                      onClick={() => void run(mode)}
                    >
                      {mode === "deposit" ? (
                        <ArrowDownLeft size={16} />
                      ) : (
                        <Send size={16} />
                      )}
                      {mode === "deposit"
                        ? "Prepare deposit"
                        : "Prepare withdrawal"}
                    </button>
                  )}
                  {(unlocked || busy) && (
                    <button className="privacy-button secondary" onClick={lock}>
                      <LockKeyhole size={16} />
                      {busy ? "Stop and lock" : "Lock account"}
                    </button>
                  )}
                </div>
                <p className="privacy-stage" role="status">
                  {busy && <RefreshCw size={14} />} {stage}
                </p>
                {error && (
                  <p className="privacy-error" role="alert">
                    {error}
                  </p>
                )}
                {submitted.current && (
                  <a
                    className="privacy-tx"
                    target="_blank"
                    rel="noreferrer"
                    href={"https://robin.etherscan.io/tx/" + submitted.current}
                  >
                    Check submitted transaction {short(submitted.current)}{" "}
                    <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
            </>
          )}
          <div className="privacy-boundary">
            <Shield size={20} />
            <p>
              Deposits and withdrawals are public onchain. Timing, amounts and
              address reuse can reveal links. This integration is not
              independently audited. Stopping after submission does not reverse
              a transaction. Private withdrawals do not settle x402 requests.
            </p>
          </div>
        </section>
        <aside className="privacy-context">
          <div>
            <h2>Execution</h2>
            <dl>
              <dt>Engine</dt>
              <dd>{engine}</dd>
              <dt>Proofs</dt>
              <dd>This browser</dd>
              <dt>Network</dt>
              <dd>Robinhood</dd>
              <dt>Pool checks</dt>
              <dd>{fresh ? "Passed" : "Unavailable"}</dd>
            </dl>
            <button
              className="privacy-button secondary"
              disabled={busy}
              onClick={() => void run("ready")}
            >
              <RefreshCw size={15} />
              Check engine
            </button>
            <p>
              Checks verify configuration and pool bytecode, not a completed
              withdrawal
            </p>
          </div>
          <div>
            <h2>Limits & fees</h2>
            <dl>
              <dt>Min. deposit</dt>
              <dd>
                {health.data
                  ? formatUnits(
                      BigInt(health.data.pools[token].minimum),
                      decimals,
                    )
                  : "--"}{" "}
                {activeToken}
              </dd>
              <dt>Max. deposit</dt>
              <dd>
                {health.data
                  ? formatUnits(
                      BigInt(health.data.pools[token].maximum),
                      decimals,
                    )
                  : "--"}{" "}
                {activeToken}
              </dd>
              <dt>Min. withdrawal</dt>
              <dd>
                {cfg?.minimum_withdrawal[token] ?? "--"} {activeToken}
              </dd>
              <dt>Flat fee</dt>
              <dd>
                {cfg?.rent_fees[token] ?? "--"} {activeToken}
              </dd>
              <dt>Protocol fee</dt>
              <dd>{cfg ? cfg.fee_rate / 100 + "%" : "--"}</dd>
            </dl>
            <button
              className="privacy-button secondary"
              disabled={health.busy || busy}
              onClick={health.refresh}
            >
              <RefreshCw size={15} />
              Refresh provider
            </button>
            {health.error && (
              <p role="alert" className="privacy-error">
                {health.error}
              </p>
            )}
          </div>
          <div>
            <h2>Pool contract</h2>
            <a
              className="privacy-contract"
              href={
                "https://robin.etherscan.io/address/" +
                (token === "eth" ? PRIVACY.ethPool : PRIVACY.usdgPool)
              }
              target="_blank"
              rel="noreferrer"
            >
              {token === "eth" ? PRIVACY.ethPool : PRIVACY.usdgPool}
              <ArrowUpRight size={14} />
            </a>
            <p>
              The external relay submits approved withdrawal proofs. Onegate
              does not operate the relay or take custody.
            </p>
            <Link to="/docs#privacy">
              Read the integration notes <ArrowUpRight size={14} />
            </Link>
          </div>
        </aside>
      </div>
      {review &&
        createPortal(
          <div className="privacy-backdrop">
            <section
              className="payment-review"
              role="dialog"
              aria-modal="true"
              aria-labelledby="review-title"
            >
              <button
                className="icon-btn review-close"
                aria-label="Cancel transaction review"
                onClick={cancelReview}
              >
                <X size={20} />
              </button>
              <Shield size={30} />
              <h2 id="review-title">{review.label}</h2>
              <p>
                {review.type === "relay-review"
                  ? "This sends a withdrawal proof to the external relay and can move private funds without another wallet prompt."
                  : "Continue opens a wallet transaction request. Verify its chain, contract and amount."}
              </p>
              <dl>
                <dt>Network</dt>
                <dd>Robinhood Chain</dd>
                <dt>Asset</dt>
                <dd>{activeToken}</dd>
                <dt>Amount</dt>
                <dd>{amount}</dd>
                <dt>
                  {review.type === "relay-review" ? "Recipient" : "Contract"}
                </dt>
                <dd>
                  {review.type === "relay-review"
                    ? recipient
                    : String(review.data.to)}
                </dd>
                {review.received && (
                  <>
                    <dt>Recipient receives</dt>
                    <dd>
                      {review.received} {activeToken}
                    </dd>
                    <dt>Fees</dt>
                    <dd>
                      {review.fee} {activeToken}
                    </dd>
                  </>
                )}
              </dl>
              <button
                className="privacy-button secondary"
                autoFocus
                onClick={cancelReview}
              >
                Cancel
              </button>
              <button
                className="privacy-button"
                onClick={() => void approveReview()}
              >
                <Check size={16} />
                {review.type === "relay-review"
                  ? "Confirm relay withdrawal"
                  : "Continue to wallet"}
              </button>
            </section>
          </div>,
          document.body,
        )}
    </main>
  );
}
