#!/usr/bin/env node
import {
  makeContractCall, broadcastTransaction,
  PostConditionMode, AnchorMode, Cl, cvToJSON, fetchCallReadOnlyFunction,
  getAddressFromPrivateKey,
} from "@stacks/transactions";
import { createNetwork } from "@stacks/network";
import { DEPLOYER, EXCHANGE_CONTRACT, TOKENS_CONTRACT, ENGINE_URL } from "./lib/config.mjs";

const HIRO = "https://api.mainnet.hiro.so";
const EXPLORER = "https://explorer.hiro.so/txid";
const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4";
const ONE_8 = 100_000_000;

const SBTC_PER_WALLET = 3500;
const INITIAL_TRADE = 2000;
const MID_SESSION_TRADE = 1200;
const MID_SESSION_PRICE = 60_000_000;

const ALICE = { name: "Alice", key: "753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601", addr: "SP1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRCBGD7R" };
const BOB = { name: "Bob", key: "f9d7206a47f14d2870c163ebab4bf3e70d18f5d14ce1031f3902fbbc894fe4c701", addr: "SP2NEB84ASENDXKYGJPQW86YXQCEFEX2ZPB1S2EP" };
const CHARLIE = { name: "Charlie", key: "b463f0df6c05d2f156393eee73f8016c5372caa0e9e29a901bb7571ef6d3a60801", addr: "SP3FD8XYKK299BZDA9HNEMN48GMPA98D16EGG9SRP" };

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function retry(fn, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { if (i === attempts - 1) throw e; await sleep(3000 * (i + 1)); }
  }
}

async function read(cAddr, cName, fn, args = []) {
  return retry(async () => {
    const network = createNetwork({ network: "mainnet" });
    return cvToJSON(await fetchCallReadOnlyFunction({
      contractAddress: cAddr, contractName: cName, functionName: fn,
      functionArgs: args, senderAddress: DEPLOYER, network,
    }));
  });
}

function val(cv) { return Number(cv?.value?.value ?? cv?.value ?? 0); }
async function getEscrow(a) { return val(await read(DEPLOYER, EXCHANGE_CONTRACT, "get-sbtc-escrow", [Cl.principal(a)])); }
async function getTokens(t, a) { return val(await read(DEPLOYER, EXCHANGE_CONTRACT, "get-token-escrow", [Cl.uint(t), Cl.principal(a)])); }
async function getSbtc(a) { return val(await read(SBTC, "sbtc-token", "get-balance", [Cl.principal(a)])); }

async function engineTx(contractName, fn, args, label, contractAddress = null) {
  const res = await retry(async () => {
    const body = { contractName, functionName: fn, args, label };
    if (contractAddress) body.contractAddress = contractAddress;
    const r = await fetch(`${ENGINE_URL}/tx`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(20000), body: JSON.stringify(body),
    });
    return r.json();
  });
  if (!res.ok) throw new Error(`${label}: ${res.error}`);
  return res.txid;
}

async function directTx(senderKey, cAddr, cName, fn, args) {
  return retry(async () => {
    const addr = getAddressFromPrivateKey(senderKey, "mainnet");
    const r = await fetch(`${HIRO}/extended/v1/address/${addr}/nonces`, { signal: AbortSignal.timeout(10000) });
    const nonce = (await r.json()).possible_next_nonce;
    const tx = await makeContractCall({
      contractAddress: cAddr, contractName: cName, functionName: fn,
      functionArgs: args, senderKey, network: "mainnet",
      postConditionMode: PostConditionMode.Allow,
      fee: 10000n, nonce: BigInt(nonce), anchorMode: AnchorMode.Any,
    });
    const res = await broadcastTransaction({ transaction: tx, network: "mainnet" });
    if (res.error || res.reason) throw new Error(res.reason || res.error);
    return res.txid;
  });
}

async function confirm(txid, label, timeoutSec = 180) {
  const short = txid.slice(0, 10);
  process.stdout.write(`    TX ${short}... `);
  for (let i = 0; i < timeoutSec / 5; i++) {
    await sleep(5000);
    try {
      const r = await fetch(`${HIRO}/extended/v1/tx/${txid}`, { signal: AbortSignal.timeout(10000) });
      const d = await r.json();
      if (d.tx_status === "success") { console.log(`confirmed  ${EXPLORER}/${txid}?chain=mainnet`); return true; }
      if (d.tx_status?.startsWith("abort")) { console.log(`FAILED: ${d.tx_result?.repr}`); return false; }
    } catch {}
    process.stdout.write(".");
  }
  console.log("TIMEOUT"); return false;
}

async function poll(fn, timeoutSec = 600) {
  for (let i = 0; i < timeoutSec / 5; i++) {
    try { if (await fn()) return true; } catch {}
    await sleep(5000);
  }
  return false;
}

function sats(n) { return `${n} sats (${(n / ONE_8).toFixed(8)} sBTC)`; }
function usd(p) { return `$${(p / ONE_8).toFixed(2)}`; }
function divider(t) { console.log(`\n${"=".repeat(64)}\n  ${t}\n${"=".repeat(64)}\n`); }
function section(t) { console.log(`\n--- ${t} ${"─".repeat(Math.max(0, 56 - t.length))}\n`); }

async function main() {
  divider("STACKY PREDICTION MARKET — MAINNET DEMO");

  console.log("  This demo runs a complete binary options prediction market");
  console.log("  on Stacks mainnet using real sBTC as collateral.\n");
  console.log("  Three participants trade on whether BTC goes UP or DOWN");
  console.log("  within one Bitcoin block (~10 minutes).\n");
  console.log("  Contracts:");
  console.log(`    Exchange:  ${DEPLOYER}.${EXCHANGE_CONTRACT}`);
  console.log(`    Tokens:    ${DEPLOYER}.${TOKENS_CONTRACT}`);
  console.log(`    sBTC:      ${SBTC}.sbtc-token\n`);
  console.log("  Participants:");
  console.log(`    Alice:     ${ALICE.addr}  (bets UP)`);
  console.log(`    Bob:       ${BOB.addr}  (bets DOWN)`);
  console.log(`    Charlie:   ${CHARLIE.addr}  (buys mid-session)\n`);

  try { await fetch(`${ENGINE_URL}/status`, { signal: AbortSignal.timeout(5000) }); }
  catch { console.log("  Engine not running. Start: node scripts/matching-engine.mjs"); process.exit(1); }
  console.log("  Matching engine: connected");
  console.log(`  Deployer sBTC:   ${sats(await getSbtc(DEPLOYER))}`);

  section("PHASE 1 — Create prediction market");

  console.log("  Creating the market first so the Bitcoin block advances while");
  console.log("  we fund wallets and deposit. This eliminates dead wait time.\n");

  const btcPrice = await retry(async () => {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      if (d?.bitcoin?.usd > 0) return d.bitcoin.usd;
    } catch {}
    const r = await fetch("https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT", { signal: AbortSignal.timeout(5000) });
    return parseFloat((await r.json()).price);
  });
  const price8 = Math.round(btcPrice * ONE_8);
  console.log(`  Live BTC price: $${btcPrice.toLocaleString()}`);
  console.log(`  Setting oracle and creating UP/DOWN market...\n`);

  let txid = await engineTx("stacky-oracle-v3", "set-btc-price",
    [{ type: "uint", value: String(price8) }], "oracle");
  await confirm(txid, "oracle");
  await sleep(2000);

  txid = await engineTx(TOKENS_CONTRACT, "create-updown-market",
    [{ type: "string-ascii", value: "updown-5m" }, { type: "uint", value: "1" }], "create-market");
  if (!await confirm(txid, "market")) { console.log("  FATAL"); process.exit(1); }

  const marketId = val(await read(DEPLOYER, TOKENS_CONTRACT, "get-market-count")) - 1;
  const yesId = marketId * 2, noId = marketId * 2 + 1;
  const mkt = await read(DEPLOYER, TOKENS_CONTRACT, "get-market", [Cl.uint(marketId)]);
  const resHeight = Number(mkt.value?.value?.["resolution-height"]?.value || 0);

  console.log(`\n  Market #${marketId} created. Strike: $${btcPrice.toLocaleString()}`);
  console.log(`  YES wins if BTC >= $${btcPrice.toLocaleString()} at block ${resHeight}`);
  console.log(`  Block timer is now running — we use this time to prepare.\n`);

  try { await fetch(`${ENGINE_URL}/market-created`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId, timeframe: "updown-5m", durationMs: 300000, startPrice: price8 }) }); } catch {}

  section("PHASE 2 — Fund participant wallets");

  console.log("  Transferring real sBTC to each participant while the Bitcoin");
  console.log("  block timer runs in the background.\n");

  for (const w of [ALICE, BOB, CHARLIE]) {
    const escrow = await getEscrow(w.addr);
    if (escrow >= INITIAL_TRADE) {
      console.log(`  ${w.name}: ${sats(escrow)} already in escrow — skipping`);
      continue;
    }
    const walletBal = await getSbtc(w.addr);
    if (walletBal < SBTC_PER_WALLET) {
      console.log(`  Sending ${sats(SBTC_PER_WALLET)} to ${w.name}...`);
      txid = await engineTx("sbtc-token", "transfer",
        [{ type: "uint", value: String(SBTC_PER_WALLET) },
         { type: "principal", value: DEPLOYER },
         { type: "principal", value: w.addr },
         { type: "none", value: "" }],
        `fund-${w.name}`, SBTC);
      if (!await confirm(txid, `fund ${w.name}`)) { console.log("  FATAL: funding failed"); process.exit(1); }
      await sleep(2000);
    } else {
      console.log(`  ${w.name}: wallet has ${sats(walletBal)} — sufficient`);
    }
  }

  section("PHASE 3 — Deposit sBTC into exchange escrow");

  console.log("  Each participant deposits sBTC into the on-chain exchange");
  console.log("  contract. Funds are held in escrow — no custodian.\n");

  for (const w of [ALICE, BOB, CHARLIE]) {
    const escrow = await getEscrow(w.addr);
    if (escrow >= INITIAL_TRADE) {
      console.log(`  ${w.name}: escrow = ${sats(escrow)} — sufficient`);
      continue;
    }
    const stxR = await fetch(`${HIRO}/extended/v1/address/${w.addr}/balances`, { signal: AbortSignal.timeout(10000) });
    const stx = parseInt((await stxR.json()).stx.balance);
    if (stx < 50000) { console.log(`  ${w.name}: insufficient STX for gas`); process.exit(1); }

    console.log(`  ${w.name} deposits ${sats(SBTC_PER_WALLET)} into exchange...`);
    txid = await directTx(w.key, DEPLOYER, EXCHANGE_CONTRACT, "deposit-sbtc", [Cl.uint(SBTC_PER_WALLET)]);
    if (!await confirm(txid, `${w.name} deposit`)) { console.log("  FATAL: deposit failed"); process.exit(1); }
  }

  console.log("");
  for (const w of [ALICE, BOB, CHARLIE]) console.log(`  ${w.name} escrow: ${sats(await getEscrow(w.addr))}`);

  section("PHASE 4 — Opening trades (MINT)");

  console.log("  Alice bets UP, Bob bets DOWN. Their opposing orders create a");
  console.log("  MINT trade: the exchange takes sBTC from both and mints new");
  console.log("  YES/NO outcome tokens, each pair backed 1:1 by collateral.\n");

  console.log(`  Alice: BUY ${INITIAL_TRADE} YES @ ${usd(50_000_000)}`);
  await retry(async () => (await fetch(`${ENGINE_URL}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId, user: ALICE.addr, side: "buy", outcome: "yes", amount: INITIAL_TRADE, price: 50_000_000, type: "gtc" }) })).json());

  console.log(`  Bob:   BUY ${INITIAL_TRADE} NO  @ ${usd(50_000_000)}`);
  const bobRes = await retry(async () => (await fetch(`${ENGINE_URL}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId, user: BOB.addr, side: "buy", outcome: "no", amount: INITIAL_TRADE, price: 50_000_000, type: "gtc" }) })).json());

  if (bobRes.trades?.length) console.log(`\n  MINT executed: ${INITIAL_TRADE} YES for Alice, ${INITIAL_TRADE} NO for Bob`);

  console.log("  Waiting for on-chain settlement...");
  await poll(async () => (await getTokens(yesId, ALICE.addr)) > 0 && (await getTokens(noId, BOB.addr)) > 0, 300);
  console.log(`    Alice: ${await getTokens(yesId, ALICE.addr)} YES tokens`);
  console.log(`    Bob:   ${await getTokens(noId, BOB.addr)} NO tokens`);

  section("PHASE 5 — Mid-session trade (COMPLEMENTARY)");

  console.log("  Charlie enters bullish. Alice sells some YES tokens at a");
  console.log(`  higher price (${usd(MID_SESSION_PRICE)} vs her ${usd(50_000_000)} entry), locking in profit.`);
  console.log("  This is a COMPLEMENTARY trade — tokens transfer between");
  console.log("  participants, no new minting.\n");

  console.log(`  Alice:   SELL ${MID_SESSION_TRADE} YES @ ${usd(MID_SESSION_PRICE)}`);
  await retry(async () => (await fetch(`${ENGINE_URL}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId, user: ALICE.addr, side: "sell", outcome: "yes", amount: MID_SESSION_TRADE, price: MID_SESSION_PRICE, type: "gtc" }) })).json());

  console.log(`  Charlie: BUY  ${MID_SESSION_TRADE} YES @ ${usd(MID_SESSION_PRICE)}`);
  const cRes = await retry(async () => (await fetch(`${ENGINE_URL}/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId, user: CHARLIE.addr, side: "buy", outcome: "yes", amount: MID_SESSION_TRADE, price: MID_SESSION_PRICE, type: "gtc" }) })).json());

  if (cRes.trades?.length) console.log(`\n  COMPLEMENTARY executed: ${MID_SESSION_TRADE} YES transferred Alice -> Charlie`);

  console.log("  Waiting for on-chain settlement...");
  await poll(async () => (await getTokens(yesId, CHARLIE.addr)) > 0, 300);

  console.log("\n  Current positions:");
  for (const w of [ALICE, BOB, CHARLIE]) {
    const yes = await getTokens(yesId, w.addr);
    const no = await getTokens(noId, w.addr);
    const esc = await getEscrow(w.addr);
    const parts = [];
    if (yes > 0) parts.push(`${yes} YES`);
    if (no > 0) parts.push(`${no} NO`);
    parts.push(`${esc} sats sBTC`);
    console.log(`    ${w.name.padEnd(8)} ${parts.join(", ")}`);
  }

  section("PHASE 6 — Resolve market");

  console.log(`  Resolution block: ${resHeight}`);

  let blockReady = false;
  try {
    const r = await fetch(`${HIRO}/extended/v2/burn-blocks?limit=1`, { signal: AbortSignal.timeout(10000) });
    const h = (await r.json()).results[0].burn_block_height;
    console.log(`  Current block:    ${h}`);
    if (h >= resHeight) {
      console.log("  Block already reached — resolving immediately.\n");
      blockReady = true;
    } else {
      console.log(`  Need ${resHeight - h} more block(s). Waiting...\n`);
    }
  } catch {}

  if (!blockReady) {
    await poll(async () => {
      const r = await fetch(`${HIRO}/extended/v2/burn-blocks?limit=1`, { signal: AbortSignal.timeout(10000) });
      const h = (await r.json()).results[0].burn_block_height;
      if (h >= resHeight) { console.log(`    Block ${h} reached.`); return true; }
      return false;
    }, 900);
  }

  let resolved = false;
  for (let i = 0; i < 15; i++) {
    try {
      const freshPrice = await retry(async () => {
        const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd", { signal: AbortSignal.timeout(8000) });
        return (await r.json()).bitcoin.usd;
      });
      console.log(`  Oracle update: $${freshPrice.toLocaleString()}`);
      await engineTx("stacky-oracle-v3", "set-btc-price",
        [{ type: "uint", value: String(Math.round(freshPrice * ONE_8)) }], "oracle-resolve");
      await sleep(2000);
      txid = await engineTx(TOKENS_CONTRACT, "resolve-updown-market",
        [{ type: "uint", value: String(marketId) }], "resolve");
      if (await confirm(txid, "resolve")) { resolved = true; break; }
    } catch (e) { if (i > 2) console.log(`    Attempt ${i + 1}: ${e.message}`); }
    await sleep(20000);
  }
  if (!resolved) { console.log("  FATAL: Could not resolve"); process.exit(1); }

  const final = await read(DEPLOYER, TOKENS_CONTRACT, "get-market", [Cl.uint(marketId)]);
  const outcome = final.value?.value?.outcome?.value === true || final.value?.value?.outcome?.type === "true";

  console.log(`\n  RESULT: ${outcome ? "YES (UP) — BTC held above strike" : "NO (DOWN) — BTC fell below strike"}\n`);
  if (outcome) {
    console.log("  Winners: Alice (held YES), Charlie (bought YES mid-session)");
    console.log("  Loser:   Bob (held NO)");
  } else {
    console.log("  Winner:  Bob (held NO)");
    console.log("  Loser:   Charlie (bought YES mid-session at $0.60)");
    console.log("  Neutral: Alice (sold YES mid-session, locked in profit)");
  }

  section("PHASE 7 — Redemption");

  console.log("  Winners redeem outcome tokens for sBTC. Each winning token");
  console.log("  is worth 1 sat. Losing tokens become worthless.\n");

  try { await fetch(`${ENGINE_URL}/market-resolved`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId, outcome }) }); } catch {}
  console.log("  Waiting for auto-redemption (30s)...");
  await sleep(30000);

  const winners = outcome ? [ALICE, CHARLIE] : [BOB];
  const winTokenId = outcome ? yesId : noId;
  for (const w of winners) {
    if (await getTokens(winTokenId, w.addr) > 0) {
      console.log(`  ${w.name}: submitting manual redeem...`);
      txid = await directTx(w.key, DEPLOYER, EXCHANGE_CONTRACT, "redeem", [Cl.uint(marketId)]);
      await confirm(txid, `${w.name} redeem`);
    } else {
      console.log(`  ${w.name}: auto-redeemed`);
    }
  }

  console.log("\n  Post-redemption balances:");
  for (const w of [ALICE, BOB, CHARLIE]) console.log(`    ${w.name.padEnd(8)} ${sats(await getEscrow(w.addr))}`);

  section("PHASE 8 — Withdraw and return funds");

  console.log("  Participants withdraw from escrow and return sBTC to deployer.\n");

  for (const w of [ALICE, BOB, CHARLIE]) {
    const esc = await getEscrow(w.addr);
    if (esc > 0) {
      console.log(`  ${w.name}: withdrawing ${sats(esc)}...`);
      txid = await directTx(w.key, DEPLOYER, EXCHANGE_CONTRACT, "withdraw-sbtc", [Cl.uint(esc)]);
      await confirm(txid, `${w.name} withdraw`);
    }
  }

  console.log("");
  for (const w of [ALICE, BOB, CHARLIE]) {
    const bal = await getSbtc(w.addr);
    if (bal > 0) {
      console.log(`  ${w.name}: returning ${sats(bal)} to deployer...`);
      txid = await directTx(w.key, SBTC, "sbtc-token", "transfer",
        [Cl.uint(bal), Cl.principal(w.addr), Cl.principal(DEPLOYER), Cl.none()]);
      await confirm(txid, `${w.name} return`);
    }
  }

  divider("DEMO COMPLETE");

  const deployerFinal = await getSbtc(DEPLOYER);
  const fees = val(await read(DEPLOYER, EXCHANGE_CONTRACT, "get-protocol-fees"));

  console.log("  Summary");
  console.log("  -------");
  console.log(`  Market #${marketId} | Strike $${btcPrice.toLocaleString()} | Result: ${outcome ? "UP" : "DOWN"}`);
  console.log(`  Protocol fees:   ${sats(fees)}`);
  console.log(`  Deployer sBTC:   ${sats(deployerFinal)}\n`);
  console.log("  Trade log");
  console.log("  ---------");
  console.log(`  1. Alice BUY  ${INITIAL_TRADE} YES @ $0.50  (MINT with Bob)`);
  console.log(`  2. Bob   BUY  ${INITIAL_TRADE} NO  @ $0.50  (MINT with Alice)`);
  console.log(`  3. Alice SELL ${MID_SESSION_TRADE} YES @ $0.60  (COMPLEMENTARY to Charlie)`);
  console.log(`  4. Charlie BUY  ${MID_SESSION_TRADE} YES @ $0.60  (COMPLEMENTARY from Alice)`);
  console.log(`  5. Market resolved: ${outcome ? "UP" : "DOWN"}`);
  if (outcome) {
    console.log(`  6. Alice redeemed ${INITIAL_TRADE - MID_SESSION_TRADE} YES + kept sale profit`);
    console.log(`  7. Charlie redeemed ${MID_SESSION_TRADE} YES`);
  } else {
    console.log(`  6. Bob redeemed ${INITIAL_TRADE} NO`);
    console.log(`  7. Alice kept profit from selling YES at $0.60`);
    console.log(`  8. Charlie lost — YES tokens worthless`);
  }
  console.log(`\n  Explorer: https://explorer.hiro.so/address/${DEPLOYER}?chain=mainnet\n`);
}

main().catch(e => { console.error("\nFATAL:", e.message || e); process.exit(1); });
