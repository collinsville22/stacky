import { readFileSync } from "fs";
import { resolve } from "path";

function loadEnv() {
  try {
    const envPath = resolve(import.meta.dirname, "../../.env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

loadEnv();

function required(name) {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required environment variable: ${name}`);
    console.error(`Set it in .env or export it before running.`);
    process.exit(1);
  }
  return val;
}

export const DEPLOYER = required("DEPLOYER_ADDRESS");
export const PRIVATE_KEY = required("DEPLOYER_PRIVATE_KEY");
export const HIRO_API_KEY = process.env.HIRO_API_KEY || "";
export const NETWORK = process.env.NETWORK || "testnet";
export const ENGINE_URL = process.env.MATCHING_ENGINE_URL || "http://localhost:3001";
export const TX_FEE = 10000;
export const ONE_8 = 100_000_000;

export const EXCHANGE_CONTRACT = "stacky-exchange-v6";
export const TOKENS_CONTRACT = "stacky-outcome-tokens-v3";
export const GOVERNANCE_CONTRACT = "stacky-governance-v2";
export const ORACLE_CONTRACT = "stacky-oracle-v3";
export const SBTC_CONTRACT = "sbtc-token";

export const MM_ADDRESS = process.env.MM_ADDRESS || "";
export const MM_PRIVATE_KEY = process.env.MM_PRIVATE_KEY || "";
