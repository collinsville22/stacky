export const DEPLOYER = process.env.NEXT_PUBLIC_DEPLOYER || "";

export const NETWORK = (process.env.NEXT_PUBLIC_NETWORK || "mainnet") as "mainnet" | "testnet";

export const MATCHING_ENGINE_URL =
  process.env.NEXT_PUBLIC_MATCHING_ENGINE_URL || "http://localhost:3001";

export const HIRO_API_KEY = process.env.NEXT_PUBLIC_HIRO_API_KEY || "";

export const HIRO_API =
  NETWORK === "mainnet"
    ? "https://api.mainnet.hiro.so"
    : "https://api.testnet.hiro.so";

export const SBTC_TOKEN =
  NETWORK === "testnet"
    ? `${DEPLOYER}.sbtc-token`
    : "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

export const SBTC_DECIMALS = 8;
export const ONE_8 = 100_000_000;
export const USDC_DECIMALS = 6;

export const STRATEGY_CONTRACTS = {
  CARRY: "stacky-carry-v31",
  STX_CARRY: "stacky-granite-carry-v2",
  HERMETICA: "stacky-stx-staking-v10",
} as const;

export const RECEIPT_TOKENS = {
  CARRY: "token-scbtc",
  STX_CARRY: "token-sabtc",
  HERMETICA: "token-sbbtc",
} as const;

export const EXTERNAL = {
  SBTC_VAULT: {
    address: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7",
    name: "v0-vault-sbtc",
  },
  USDC_VAULT: {
    address: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7",
    name: "v0-vault-usdc",
  },
  STX_VAULT: {
    address: "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7",
    name: "v0-vault-stx",
  },
  BITFLOW_POOL: {
    address: "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR",
    name: "stableswap-pool-aeusdc-usdcx-v-1-1",
  },
  AEUSDC: {
    address: "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K",
    name: "token-aeusdc",
  },
  USDCX: {
    address: "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE",
    name: "usdcx",
  },
} as const;

export const ROUTER_CONTRACT = "stacky-router";

export const CONTRACT_NAMES = {
  MATH: "stacky-math",
  GOVERNANCE: "stacky-governance-v2",
  OUTCOME_TOKENS: "stacky-outcome-tokens-v3",
  EXCHANGE: "stacky-exchange-v6",
  ORACLE: "stacky-oracle-v3",
} as const;

export function contractId(name: string): string {
  return `${DEPLOYER}.${name}`;
}
