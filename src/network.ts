export type NetworkName = "testnet" | "mainnet";

export const NETWORKS = {
  mainnet: {
    chainId: 196,
    caip2: "eip155:196",
    usdt0: "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    explorer: "https://www.okx.com/web3/explorer/xlayer",
  },
  testnet: {
    chainId: 1952,
    caip2: "eip155:1952",
    usdt0: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
    explorer: "https://www.okx.com/web3/explorer/xlayer-test",
  },
} as const;

/** USDT0 has 6 decimals: 0.01 USDT0 -> "10000" */
export function toAtomic(usd: number): string {
  return Math.round(usd * 1_000_000).toString();
}
