/**
 * Pay from any chain (MicroPay lesson): a buyer's funds sitting on another chain should not block a purchase.
 * Vendo settles on X Layer in USDT0. If a buyer is short on X Layer, Vendo returns a funding plan the buyer's
 * agent can execute with Onchain OS (Agentic Wallet includes swaps and cross-chain bridging), then retry the call.
 */
import { createPublicClient, http, parseAbi, defineChain, isAddress, type Address } from "viem";
import { env } from "./env.js";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const chain = defineChain({
  id: env.network.chainId, name: `X Layer ${env.networkName}`, nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC ?? (env.networkName === "mainnet" ? "https://rpc.xlayer.tech" : "https://testrpc.xlayer.tech")] } },
});

export async function usdt0Balance(address: string): Promise<number | null> {
  if (process.env.VENDO_OFFLINE === "1") return Number(process.env.VENDO_DEMO_BUYER_BALANCE ?? 5);
  if (!isAddress(address)) return null;
  try {
    const pc = createPublicClient({ chain, transport: http() });
    const raw = await pc.readContract({ address: env.network.usdt0 as Address, abi: erc20, functionName: "balanceOf", args: [address as Address] });
    return Number(raw) / 1e6;
  } catch { return null; }
}

export function fundingPlan(input: { amountUsd: number; fromChain?: string; fromToken?: string; wallet?: string; balanceUsd?: number | null }) {
  const need = Math.max(0, +(input.amountUsd - (input.balanceUsd ?? 0)).toFixed(6));
  const topUp = +(Math.max(need, 0.5) * 1.05).toFixed(2); // small buffer for fees and a few more calls
  const from = input.fromChain?.trim() || "the chain where your stablecoins are";
  const token = input.fromToken?.trim() || "USDC or USDT";
  return {
    settlement: { network: env.network.caip2, asset: "USDT0", assetAddress: env.network.usdt0 },
    wallet: input.wallet ?? null,
    balanceOnXLayerUsd: input.balanceUsd ?? null,
    shortfallUsd: need,
    needsFunding: need > 0,
    suggestedTopUpUsd: need > 0 ? topUp : 0,
    steps: need > 0 ? [
      { step: "Bridge or swap into USDT0 on X Layer with your Agentic Wallet", prompt: `Using Onchain OS, bridge ${topUp} ${token} from ${from} to USDT0 on X Layer for my Agentic Wallet, show me the quote and fees first` },
      { step: "Confirm the balance arrived", prompt: "Using Onchain OS, show my USDT0 balance on X Layer" },
      { step: "Retry the Vendo call; it will settle on X Layer" },
    ] : [{ step: "Balance is enough; pay the 402 and retry" }],
    note: "Quotes, routes and fees come from Onchain OS at execution time. Vendo never moves the buyer's funds.",
  };
}
