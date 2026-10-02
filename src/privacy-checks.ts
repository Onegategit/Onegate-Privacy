import {
  decodeFunctionData,
  erc20Abi,
  isAddress,
  parseUnits,
  type Abi,
  type Hex,
} from "viem";
import poolAbi from "./privacy-pool-abi.json";
import { PRIVACY, type PrivacyToken } from "./privacy-config";
export const decimalsFor = (token: PrivacyToken) => (token === "eth" ? 18 : 6);
export function amountUnits(input: string, token: PrivacyToken) {
  const decimals = decimalsFor(token);
  if (
    !new RegExp("^(0|[1-9]\\d{0,8})(\\.\\d{1," + decimals + "})?$").test(input)
  )
    throw Error("Enter a positive decimal amount with no separators");
  const value = parseUnits(input, decimals),
    numeric = Number(input);
  if (value <= 0n) throw Error("Amount must be greater than zero");
  if (
    !Number.isFinite(numeric) ||
    numeric.toString().includes("e") ||
    parseUnits(numeric.toString(), decimals) !== value
  )
    throw Error(
      "Amount exceeds the SDK precision limit. Use fewer decimal places.",
    );
  return value;
}
export function integer(value: unknown): bigint {
  if (typeof value === "object" && value !== null && "hex" in value)
    return integer((value as { hex: string }).hex);
  const text = String(value);
  if (text.startsWith("-0x")) return -BigInt(text.slice(1));
  if (!/^-?\d+$|^0x[\da-f]+$/i.test(text))
    throw Error("Invalid transaction integer");
  return BigInt(text);
}
export function validRecipient(address: string) {
  return (
    isAddress(address, { strict: true }) &&
    !/^0x0{40}$/i.test(address) &&
    ![PRIVACY.ethPool, PRIVACY.usdgPool, PRIVACY.usdgToken].some(
      (p) => p.toLowerCase() === address.toLowerCase(),
    )
  );
}
export function checkDepositTransaction(
  tx: Record<string, unknown>,
  token: PrivacyToken,
  amount: bigint,
) {
  if (integer(tx.chainId) !== 4663n) throw Error("Transaction chain mismatch");
  const target = String(tx.to).toLowerCase(),
    pool = token === "eth" ? PRIVACY.ethPool : PRIVACY.usdgPool;
  const value = tx.value == null ? 0n : integer(tx.value);
  if (token === "usdg" && target === PRIVACY.usdgToken.toLowerCase()) {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: tx.data as Hex });
    if (
      decoded.functionName !== "approve" ||
      decoded.args[0].toLowerCase() !== pool.toLowerCase() ||
      decoded.args[1] !== amount ||
      value !== 0n
    )
      throw Error("Unexpected token approval");
    return "Approve USDG";
  }
  if (
    target !== pool.toLowerCase() ||
    value !== (token === "eth" ? amount : 0n)
  )
    throw Error("Deposit target or value mismatch");
  const decoded = decodeFunctionData({
    abi: poolAbi as Abi,
    data: tx.data as Hex,
  });
  const ext = (decoded.args as unknown[] | undefined)?.[1] as
    { extAmount: bigint; fee: bigint } | undefined;
  if (
    decoded.functionName !== "transact" ||
    !ext ||
    ext.extAmount !== amount ||
    ext.fee !== 0n
  )
    throw Error("Deposit call does not match the reviewed amount");
  return "Deposit " + token.toUpperCase();
}
export function checkRelayPayload(
  body: Record<string, unknown>,
  token: PrivacyToken,
  amount: bigint,
  recipient: string,
  quotedFee: bigint,
) {
  const ext = body.extData as Record<string, unknown>;
  if (body.chain !== "robinhood" || body.token !== token || !ext)
    throw Error("Relay network mismatch");
  const fee = integer(ext.fee),
    external = integer(ext.extAmount);
  if (
    String(ext.recipient).toLowerCase() !== recipient.toLowerCase() ||
    String(ext.feeRecipient).toLowerCase() !==
      PRIVACY.feeRecipient.toLowerCase()
  )
    throw Error("Relay recipient mismatch");
  if (
    fee !== quotedFee ||
    external >= 0n ||
    -external + fee !== amount ||
    fee * 2n >= amount
  )
    throw Error("Relay amount or fee changed. Refresh and review a new quote.");
  return { fee, received: -external };
}
