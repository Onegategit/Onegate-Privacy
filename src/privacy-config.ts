export const PRIVACY = {
  chainId: 4663,
  chainHex: "0x1237",
  rpc: "https://evm.privacycash.org/rpc/robinhood",
  indexer: "https://evm.privacycash.org",
  relay: "https://evm.privacycash.org/relayer/withdraw",
  ethPool: "0xEC5266c9e44631e1ba22FD6377C38130c1F3B738",
  usdgPool: "0xBB0C7F576B7bdAa8f2a119cb295076aCD0C9013f",
  usdgToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  feeRecipient: "0xe7E15cbF5FC58c37948D23788eACAef11Bf29e37",
  message: "Privacy Money account sign in",
  circuits: "/circuits/transaction",
} as const;
export type PrivacyToken = "eth" | "usdg";
export type PrivacyHealth = {
  checkedAt: number;
  chainId: number;
  configAvailable: boolean;
  config: {
    fee_rate: number;
    rent_fees: Record<PrivacyToken, number>;
    minimum_withdrawal: Record<PrivacyToken, number>;
    minimum_deposit: Record<PrivacyToken, number>;
  };
  pools: Record<
    PrivacyToken,
    { address: string; deployed: boolean; minimum: string; maximum: string }
  >;
};
