import {
  Cl,
  ClarityValue,
  fetchCallReadOnlyFunction,
  cvToJSON,
} from "@stacks/transactions";
import { createNetwork } from "@stacks/network";
import { DEPLOYER, NETWORK, HIRO_API_KEY, HIRO_API, SBTC_TOKEN } from "./constants";

export { Cl, cvToJSON };
export type { ClarityValue };

const STACKS_NETWORK = createNetwork({ network: NETWORK, apiKey: HIRO_API_KEY });

export async function callReadOnly(
  contractName: string,
  functionName: string,
  args: ClarityValue[] = [],
  senderAddress?: string
): Promise<ClarityValue> {
  const sender = senderAddress || DEPLOYER;
  if (!DEPLOYER) throw new Error("DEPLOYER address not configured");

  const result = await fetchCallReadOnlyFunction({
    contractAddress: DEPLOYER,
    contractName,
    functionName,
    functionArgs: args,
    senderAddress: sender,
    network: STACKS_NETWORK,
  });

  return result;
}

export async function callReadOnlyExternal(
  contractAddress: string,
  contractName: string,
  functionName: string,
  args: ClarityValue[] = [],
  senderAddress?: string
): Promise<ClarityValue> {
  const sender = senderAddress || DEPLOYER;
  const result = await fetchCallReadOnlyFunction({
    contractAddress,
    contractName,
    functionName,
    functionArgs: args,
    senderAddress: sender,
    network: STACKS_NETWORK,
  });
  return result;
}

export function extractUint(cv: ClarityValue): bigint {
  const json = cvToJSON(cv);
  if (json.type === "uint") return BigInt(json.value);
  if (json.value?.type === "uint") return BigInt(json.value.value);
  if (json.type === "ok" && json.value?.type === "uint") return BigInt(json.value.value);
  throw new Error(`Cannot extract uint from ${JSON.stringify(json)}`);
}

export function extractBool(cv: ClarityValue): boolean {
  const json = cvToJSON(cv);
  if (json.type === "bool") return json.value;
  if (json.value?.type === "bool") return json.value.value;
  throw new Error(`Cannot extract bool from ${JSON.stringify(json)}`);
}

export function extractOptional(cv: ClarityValue): ClarityValue | null {
  const json = cvToJSON(cv);
  if (json.type === "none" || json.type === "(optional)" && json.value === null) return null;
  return cv;
}

export async function fetchSbtcBalance(address: string): Promise<bigint> {
  try {
    const res = await fetch(
      `${HIRO_API}/extended/v1/address/${address}/balances`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return BigInt(0);
    const data = await res.json();
    const ft = data.fungible_tokens || {};
    const sbtcKey = Object.keys(ft).find((k) => k.includes("sbtc-token"));
    if (sbtcKey && ft[sbtcKey]?.balance) {
      return BigInt(ft[sbtcKey].balance);
    }
    return BigInt(0);
  } catch {
    return BigInt(0);
  }
}

export async function fetchStxBalance(address: string): Promise<bigint> {
  try {
    const res = await fetch(`${HIRO_API}/v2/accounts/${address}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return BigInt(0);
    const data = await res.json();
    return BigInt(data.balance) - BigInt(data.locked || "0");
  } catch {
    return BigInt(0);
  }
}

export async function fetchBtcPrice(): Promise<number> {
  try {
    const res = await fetch("https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
      { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const p = parseFloat(data.price);
    if (p > 0) return p;
  } catch {}
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return data.bitcoin?.usd || 0;
  } catch {
    return 0;
  }
}
