import { createPublicClient, http, parseAbi } from "viem";
const rpc = "https://evm.privacycash.org/rpc/robinhood";
const pools = {
  eth: "0xEC5266c9e44631e1ba22FD6377C38130c1F3B738",
  usdg: "0xBB0C7F576B7bdAa8f2a119cb295076aCD0C9013f",
};
let cached, pending;
export async function health() {
  if (cached && Date.now() - cached.checkedAt < 60000) return cached;
  if (pending) return pending;
  pending = (async () => {
    const client = createPublicClient({
      transport: http(rpc, { timeout: 9000, retryCount: 0 }),
    });
    const response = await fetch(
      "https://evm.privacycash.org/config?chain=robinhood",
      { signal: AbortSignal.timeout(9000) },
    );
    if (!response.ok) throw Error("Configuration unavailable");
    const source = await response.json();
    if (
      !Number.isSafeInteger(source.fee_rate) ||
      source.fee_rate < 0 ||
      source.fee_rate > 10000
    )
      throw Error("Invalid fee configuration");
    for (const field of ["rent_fees", "minimum_withdrawal", "minimum_deposit"])
      for (const token of ["eth", "usdg"])
        if (
          typeof source[field]?.[token] !== "number" ||
          !Number.isFinite(source[field][token]) ||
          source[field][token] < 0
        )
          throw Error("Invalid configuration");
    if ((await client.getChainId()) !== 4663) throw Error("Network mismatch");
    const checked = {};
    for (const [token, address] of Object.entries(pools)) {
      const code = await client.getCode({ address });
      if (!code || code === "0x") throw Error("Pool contract unavailable");
      const abi = parseAbi([
        "function minimumAmount() view returns (uint256)",
        "function maximumDepositAmount() view returns (uint256)",
      ]);
      const minimum = await client.readContract({
        address,
        abi,
        functionName: "minimumAmount",
      });
      const maximum = await client.readContract({
        address,
        abi,
        functionName: "maximumDepositAmount",
      });
      checked[token] = {
        address,
        deployed: true,
        minimum: String(minimum),
        maximum: String(maximum),
      };
    }
    cached = {
      checkedAt: Date.now(),
      chainId: 4663,
      configAvailable: true,
      config: {
        fee_rate: source.fee_rate,
        rent_fees: source.rent_fees,
        minimum_withdrawal: source.minimum_withdrawal,
        minimum_deposit: source.minimum_deposit,
      },
      pools: checked,
    };
    return cached;
  })().finally(() => {
    pending = null;
  });
  return pending;
}
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  try {
    const data = await health();
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30");
    res.end(JSON.stringify(data));
  } catch {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        error:
          "Privacy provider configuration or Robinhood pool verification is unavailable. No transaction can begin.",
      }),
    );
  }
}
