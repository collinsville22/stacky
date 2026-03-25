#!/usr/bin/env node
import {
  makeContractDeploy,
  makeContractCall,
  broadcastTransaction,
  PostConditionMode,
  Cl,
} from "@stacks/transactions";
import { readFileSync } from "fs";
import { DEPLOYER, PRIVATE_KEY } from "./lib/config.mjs";

const NETWORK = "mainnet";
const HIRO_API = "https://api.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";

async function getNonce() {
  const r = await fetch(`${HIRO_API}/extended/v1/address/${DEPLOYER}/nonces`);
  const d = await r.json();
  console.log(`  Nonce: ${d.possible_next_nonce} | Mempool: ${d.detected_mempool_nonces?.length || 0}`);
  return d.possible_next_nonce;
}

async function waitForTx(txid, label) {
  process.stdout.write(`  Waiting: ${label}`);
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 15000));
    try {
      const res = await fetch(`${HIRO_API}/extended/v1/tx/${txid}`);
      const d = await res.json();
      if (d.tx_status === "success") {
        console.log(` -> OK (block ${d.block_height})`);
        return { ok: true };
      }
      if (d.tx_status?.startsWith("abort")) {
        console.log(` -> FAIL: ${d.tx_result?.repr}`);
        return { ok: false, error: d.tx_result?.repr };
      }
    } catch {}
    process.stdout.write(".");
  }
  console.log(" -> TIMEOUT");
  return { ok: false, error: "timeout" };
}

const MAINNET_SBTC = "'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

async function deploy(name, file, nonce) {
  let code = readFileSync(file, "utf-8");
  code = code.replace(/\.sbtc-token/g, MAINNET_SBTC);
  console.log(`\n  Deploying ${name} (${code.length} bytes, nonce ${nonce})...`);
  const tx = await makeContractDeploy({
    contractName: name,
    codeBody: code,
    senderKey: PRIVATE_KEY,
    network: NETWORK,
    postConditionMode: PostConditionMode.Allow,
    fee: 200000,
    nonce,
    clarityVersion: 3,
  });
  const r = await broadcastTransaction({ transaction: tx, network: NETWORK });
  if (r.error || r.reason) {
    console.log(`  FAILED: ${r.error || r.reason} ${r.reason_data?.message || ""}`);
    return null;
  }
  console.log(`  TX: ${EXPLORER}/${r.txid}?chain=mainnet`);
  return r.txid;
}

async function auth(contract, fn, args, label, nonce) {
  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName: contract,
    functionName: fn,
    functionArgs: args,
    senderKey: PRIVATE_KEY,
    network: NETWORK,
    postConditionMode: PostConditionMode.Allow,
    fee: 10000,
    nonce,
  });
  const r = await broadcastTransaction({ transaction: tx, network: NETWORK });
  if (r.error || r.reason) {
    console.log(`  ${label}: FAILED -- ${r.error || r.reason}`);
    return null;
  }
  console.log(`  ${label}: broadcasted (${r.txid?.slice(0, 10)}...)`);
  return r.txid;
}

async function checkPrereqs() {
  console.log("Checking prerequisites...\n");

  const balRes = await fetch(`${HIRO_API}/extended/v1/address/${DEPLOYER}/balances`);
  const bal = await balRes.json();
  const stxBalance = parseInt(bal.stx.balance) / 1e6;
  console.log(`  STX Balance: ${stxBalance} STX`);
  if (stxBalance < 0.8) {
    console.log(`  ERROR: Need >= 0.8 STX (3 deploys @ 0.2 + auth calls). Fund ${DEPLOYER}`);
    return false;
  }

  const govRes = await fetch(`${HIRO_API}/v2/contracts/interface/${DEPLOYER}/stacky-governance-v2`);
  if (!govRes.ok) {
    console.log("  ERROR: stacky-governance-v2 not deployed");
    return false;
  }
  console.log("  stacky-governance-v2: EXISTS");

  const mathRes = await fetch(`${HIRO_API}/v2/contracts/interface/${DEPLOYER}/stacky-math`);
  if (!mathRes.ok) {
    console.log("  ERROR: stacky-math not deployed");
    return false;
  }
  console.log("  stacky-math: EXISTS");

  for (const name of ["stacky-oracle-v3", "stacky-outcome-tokens-v3", "stacky-exchange-v6"]) {
    const res = await fetch(`${HIRO_API}/v2/contracts/interface/${DEPLOYER}/${name}`);
    if (res.ok) {
      console.log(`  WARNING: ${name} ALREADY DEPLOYED -- will skip`);
    } else {
      console.log(`  ${name}: not yet deployed (OK)`);
    }
  }

  return true;
}

async function main() {
  console.log("");
  console.log("======================================");
  console.log("  PREDICTION MARKET v2 -- MAINNET");
  console.log("======================================");
  console.log(`  Deployer: ${DEPLOYER}`);
  console.log(`  Network:  ${NETWORK}`);
  console.log(`  sBTC:     SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`);
  console.log("");

  const ok = await checkPrereqs();
  if (!ok) {
    console.log("\nPrerequisites not met. Aborting.");
    process.exit(1);
  }

  let n = await getNonce();

  console.log("\n--- Phase 1: Deploy new contracts ---");

  const deployResults = {};

  for (const [name, file] of [
    ["stacky-oracle-v3", "contracts/prediction/stacky-oracle-v3.clar"],
    ["stacky-outcome-tokens-v3", "contracts/prediction/stacky-outcome-tokens-v3.clar"],
    ["stacky-exchange-v6", "contracts/prediction/stacky-exchange-v6.clar"],
  ]) {
    const res = await fetch(`${HIRO_API}/v2/contracts/interface/${DEPLOYER}/${name}`);
    if (res.ok) {
      console.log(`\n  SKIP: ${name} (already deployed)`);
      deployResults[name] = "exists";
    } else {
      const txid = await deploy(name, file, n++);
      deployResults[name] = txid;
    }
  }

  const deployTxids = Object.entries(deployResults).filter(([, v]) => v && v !== "exists");
  if (deployTxids.length > 0) {
    console.log("\n  Waiting for deploys to confirm...");
    for (const [name, txid] of deployTxids) {
      const result = await waitForTx(txid, name);
      if (!result.ok) {
        console.log(`\n  FATAL: ${name} deploy failed. Stopping.`);
        process.exit(1);
      }
    }
  }

  console.log("\n--- Phase 2: Authorize contracts on governance-v2 ---");
  n = await getNonce();

  const authTxids = [];
  authTxids.push(await auth("stacky-governance-v2", "set-authorized",
    [Cl.principal(`${DEPLOYER}.stacky-oracle-v3`), Cl.bool(true)],
    "Auth oracle-v3", n++));

  authTxids.push(await auth("stacky-governance-v2", "set-authorized",
    [Cl.principal(`${DEPLOYER}.stacky-outcome-tokens-v3`), Cl.bool(true)],
    "Auth outcome-tokens-v2", n++));

  authTxids.push(await auth("stacky-governance-v2", "set-authorized",
    [Cl.principal(`${DEPLOYER}.stacky-exchange-v6`), Cl.bool(true)],
    "Auth exchange-v5", n++));

  console.log("\n--- Phase 3: Set initial oracle price ---");

  let btcPrice = 85000;
  try {
    const r = await fetch("https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
      { signal: AbortSignal.timeout(5000) });
    const d = await r.json();
    btcPrice = Math.round(parseFloat(d.price));
    console.log(`  Live BTC price: $${btcPrice.toLocaleString()}`);
  } catch {
    console.log(`  Could not fetch live price, using $${btcPrice.toLocaleString()}`);
  }

  const priceInContract = BigInt(btcPrice) * BigInt(100_000_000);
  authTxids.push(await auth("stacky-oracle-v3", "set-btc-price",
    [Cl.uint(priceInContract)],
    `Oracle v3 price $${btcPrice.toLocaleString()}`, n++));

  console.log("\n  Waiting for auth TXs to confirm...");
  const lastAuth = authTxids.filter(Boolean).pop();
  if (lastAuth) await waitForTx(lastAuth, "Authorization");

  console.log("\n======================================");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("======================================");
  console.log(`\n  Prediction Market contracts:`);
  console.log(`    ${DEPLOYER}.stacky-oracle-v3`);
  console.log(`    ${DEPLOYER}.stacky-outcome-tokens-v3`);
  console.log(`    ${DEPLOYER}.stacky-exchange-v6`);
  console.log(`\n  Uses REAL mainnet sBTC:`);
  console.log(`    SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`);
  console.log(`\n  Explorer:`);
  console.log(`    https://explorer.hiro.so/address/${DEPLOYER}?chain=mainnet`);
  console.log(`\n  Next steps:`);
  console.log(`    1. Start matching engine: node scripts/matching-engine.mjs`);
  console.log(`    2. Start keeper: node scripts/keeper.mjs`);
  console.log(`    3. (Optional) Start market maker: node scripts/market-maker.mjs`);
  console.log("");
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
