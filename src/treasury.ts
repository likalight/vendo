/**
 * Treasury: talks to a business's VendoVault on X Layer as the OPERATOR.
 * The operator can only sweep to approved venues, pay approved payees within limits, pause and tighten.
 * Offline mode keeps a simulated vault with the same rules so the dashboard can be demoed without keys.
 */
import { createPublicClient, createWalletClient, http, parseAbi, defineChain, type Address, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "./env.js";

const abi = parseAbi([
  "function idle() view returns (uint256)",
  "function invested() view returns (uint256)",
  "function buffer() view returns (uint256)",
  "function dailyLimit() view returns (uint256)",
  "function spentToday() view returns (uint256)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function operator() view returns (address)",
  "function sweep(address venue, uint256 amount)",
  "function recall(address venue, uint256 amount)",
  "function payBill(address payee, uint256 amount, bytes32 ref)",
  "function pause()",
]);

const OFFLINE = process.env.VENDO_OFFLINE === "1";
const vaultAddress = process.env.VAULT_ADDRESS as Address | undefined;
const chain = defineChain({
  id: env.network.chainId, name: `X Layer ${env.networkName}`, nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC ?? (env.networkName === "mainnet" ? "https://rpc.xlayer.tech" : "https://testrpc.xlayer.tech")] } },
});

const sim = { idle: 1200e6, invested: 0, buffer: 100e6, dailyLimit: 500e6, spentToday: 0, paused: false, venues: new Set(["0xVenueUSDG"]), payees: new Map<string, number>([["0xHosting", 200e6]]) };
export const treasuryMode = () => (OFFLINE ? "simulated" : vaultAddress ? "onchain" : "not-configured");

export async function state() {
  if (OFFLINE) return { mode: "simulated", ...sim, venues: [...sim.venues], payees: Object.fromEntries(sim.payees) };
  if (!vaultAddress) return { mode: "not-configured", hint: "Deploy contracts/ and set VAULT_ADDRESS, OPERATOR_PRIVATE_KEY, XLAYER_RPC" };
  const pc = createPublicClient({ chain, transport: http() });
  const read = (fn: any) => pc.readContract({ address: vaultAddress, abi, functionName: fn }) as Promise<any>;
  const [idle, invested, buffer, dailyLimit, spentToday, paused, owner, operator] = await Promise.all(
    ["idle", "invested", "buffer", "dailyLimit", "spentToday", "paused", "owner", "operator"].map(read));
  return { mode: "onchain", vault: vaultAddress, idle: Number(idle), invested: Number(invested), buffer: Number(buffer), dailyLimit: Number(dailyLimit), spentToday: Number(spentToday), paused, owner, operator, explorer: `${env.network.explorer}/address/${vaultAddress}` };
}

async function write(functionName: "sweep" | "recall" | "payBill" | "pause", args: any[]) {
  const pk = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!vaultAddress || !pk) throw new Error("Set VAULT_ADDRESS and OPERATOR_PRIVATE_KEY");
  const account = privateKeyToAccount(pk);
  const wc = createWalletClient({ account, chain, transport: http() });
  const pc = createPublicClient({ chain, transport: http() });
  const { request } = await pc.simulateContract({ account, address: vaultAddress, abi, functionName, args } as any);
  const hash = await wc.writeContract(request as any);
  const receipt = await pc.waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status, explorer: `${env.network.explorer}/tx/${hash}` };
}

const units = (usd: number) => Math.round(usd * 1e6);

export async function sweep(venue: string, usd: number) {
  if (OFFLINE) {
    const a = units(usd);
    if (sim.paused) throw new Error("Vault is paused");
    if (!sim.venues.has(venue)) throw new Error("Venue is not approved by the owner");
    if (sim.idle - a < sim.buffer) throw new Error("That would drop cash below the buffer");
    sim.idle -= a; sim.invested += a; return { simulated: true, action: "sweep", amount: usd };
  }
  return write("sweep", [venue, BigInt(units(usd))]);
}

export async function payBill(payee: string, usd: number, ref: string) {
  if (OFFLINE) {
    const a = units(usd), cap = sim.payees.get(payee) ?? 0;
    if (sim.paused) throw new Error("Vault is paused");
    if (!cap) throw new Error("Payee is not approved by the owner");
    if (a > cap) throw new Error("Above this payee's cap");
    if (sim.spentToday + a > sim.dailyLimit) throw new Error("Above the daily limit");
    if (sim.idle < a) { const pull = Math.min(sim.invested, a - sim.idle); sim.invested -= pull; sim.idle += pull; }
    if (sim.idle < a) throw new Error("Not enough funds");
    sim.idle -= a; sim.spentToday += a; return { simulated: true, action: "payBill", payee, amount: usd, ref };
  }
  return write("payBill", [payee, BigInt(units(usd)), toHex(ref.slice(0, 31), { size: 32 })]);
}

export async function pause() {
  if (OFFLINE) { sim.paused = true; return { simulated: true, action: "pause" }; }
  return write("pause", []);
}

/** Simulated incoming revenue so the offline demo shows money arriving. */
export function simulateRevenue(usd: number) { if (OFFLINE) sim.idle += units(usd); }


export type VaultCheck = {
  address: string;
  isVault: boolean;
  reason?: string;
  owner?: string;
  operator?: string;
  token?: string;
  expectedToken?: string;
  idle?: number;
  invested?: number;
  paused?: boolean;
  feedableBy?: string[];
};

/**
 * Confirm an address is a VendoVault on this network before revenue is pointed at it.
 *
 * The vault has no deposit function on purpose: idle() is simply its own token balance, so money
 * arrives by ordinary ERC-20 transfer. x402 already pays a route's payTo directly, which means
 * setting payTo to a vault address turns every paid call into a deposit. That is the whole link
 * between earning and investing, and it is also why it must be checked: a payTo pointed at the
 * wrong contract sends revenue somewhere it cannot be recovered from.
 *
 * Checks the contract answers the vault interface and settles in the same token this network pays
 * in. A vault holding a different asset would silently receive nothing.
 */
export async function verifyVault(address: string): Promise<VaultCheck> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { address, isVault: false, reason: "Not a wallet address" };
  if (OFFLINE) {
    return { address, isVault: true, reason: "Offline demo: not checked onchain", owner: "0xOwner", operator: "0xOperator",
      token: env.network.usdt0, expectedToken: env.network.usdt0, idle: sim.idle, invested: sim.invested, paused: sim.paused };
  }
  const pc = createPublicClient({ chain, transport: http() });
  const read = (fn: any) => pc.readContract({ address: address as Address, abi, functionName: fn }) as Promise<any>;
  try {
    const [owner, operator, token, idle, invested, paused] = await Promise.all(
      ["owner", "operator", "token", "idle", "invested", "paused"].map(read));
    const expected = env.network.usdt0;
    const tokenOk = String(token).toLowerCase() === expected.toLowerCase();
    return {
      address, isVault: tokenOk,
      reason: tokenOk ? undefined : `This vault settles in ${token}, but this network pays in ${expected}. Revenue sent here would not be recoverable by the vault.`,
      owner: String(owner), operator: String(operator), token: String(token), expectedToken: expected,
      idle: Number(idle), invested: Number(invested), paused: Boolean(paused),
    };
  } catch (e: any) {
    return { address, isVault: false, reason: `Address does not answer the vault interface: ${String(e.shortMessage ?? e.message)}` };
  }
}

/**
 * Which listed stores actually pay into a given vault. Revenue only reaches it when a store's
 * payTo is the vault address, so this answers "is anything feeding it" rather than assuming.
 */
export function storesFeeding(vault: string, stores: { id: string; payTo?: string }[], fallbackPayTo: string) {
  const v = vault.toLowerCase();
  return stores.filter((s) => (s.payTo || fallbackPayTo).toLowerCase() === v).map((s) => s.id);
}
