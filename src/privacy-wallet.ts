import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther } from "viem";
import { PRIVACY, type PrivacyHealth } from "./privacy-config";

export function usePrivacyWallet() {
  const provider = (window as any).ethereum;
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const version = useRef(0);
  const sync = useCallback(async () => {
    const current = ++version.current;
    setBalance(null);
    if (!provider?.request) return;
    try {
      const accounts = await provider.request({ method: "eth_accounts" });
      const network = await provider.request({ method: "eth_chainId" });
      if (current !== version.current) return;
      setAddress(accounts?.[0] || "");
      setChain(network);
      if (accounts?.[0] && network === PRIVACY.chainHex) {
        const value = await provider.request({
          method: "eth_getBalance",
          params: [accounts[0], "latest"],
        });
        if (current === version.current) setBalance(formatEther(BigInt(value)));
      }
    } catch {
      if (current === version.current)
        setError("Wallet state could not be read. Refresh or reconnect.");
    }
  }, [provider]);
  useEffect(() => {
    void sync();
    const changed = () => {
      setAddress("");
      setChain("");
      void sync();
    };
    const disconnected = () => {
      ++version.current;
      setAddress("");
      setChain("");
      setBalance(null);
    };
    provider?.on?.("accountsChanged", changed);
    provider?.on?.("chainChanged", changed);
    provider?.on?.("disconnect", disconnected);
    return () => {
      ++version.current;
      provider?.removeListener?.("accountsChanged", changed);
      provider?.removeListener?.("chainChanged", changed);
      provider?.removeListener?.("disconnect", disconnected);
    };
  }, [provider, sync]);
  async function open() {
    if (connecting) return;
    setError("");
    if (!provider?.request)
      return setError(
        "No browser wallet detected. Open this page in a supported EVM wallet browser.",
      );
    setConnecting(true);
    try {
      await provider.request({ method: "eth_requestAccounts" });
      if (
        (await provider.request({ method: "eth_chainId" })) !== PRIVACY.chainHex
      ) {
        try {
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: PRIVACY.chainHex }],
          });
        } catch (e: any) {
          if (e.code !== 4902) throw e;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: PRIVACY.chainHex,
                chainName: "Robinhood Chain",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
                blockExplorerUrls: ["https://robin.etherscan.io"],
              },
            ],
          });
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: PRIVACY.chainHex }],
          });
        }
      }
      await sync();
    } catch {
      setError(
        "Connection or network change was not completed. No signature or transaction was requested.",
      );
    } finally {
      setConnecting(false);
    }
  }
  return { provider, address, chain, balance, open, error, connecting };
}

export function usePrivacyHealth() {
  const [data, setData] = useState<PrivacyHealth | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    const timeout = setTimeout(() => c.abort(), 25000);
    try {
      const res = await fetch("/api/privacy", {
        signal: c.signal,
        cache: "no-store",
      });
      const result = await res.json();
      if (!res.ok) throw Error(result.error || "Pool checks unavailable");
      if (!c.signal.aborted) {
        setData(result);
        setError("");
      }
    } catch (e: any) {
      if (controller.current === c) {
        setData(null);
        setError(c.signal.aborted ? "Provider check timed out" : e.message);
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === c) setBusy(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60000);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
      controller.current = null;
    };
  }, [refresh]);
  return { data, error, busy, refresh };
}
