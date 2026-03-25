#!/usr/bin/env node

import {
  fetchCallReadOnlyFunction,
  Cl,
  cvToJSON,
} from "@stacks/transactions";
import { createNetwork } from "@stacks/network";
import { DEPLOYER, HIRO_API_KEY, ONE_8, TOKENS_CONTRACT, ENGINE_URL } from "./lib/config.mjs";

const NET = process.env.NETWORK || "mainnet";
const NETWORK = createNetwork(HIRO_API_KEY ? { network: NET, apiKey: HIRO_API_KEY } : { network: NET });

const TIMEFRAMES = [
  { label: "updown-5m", durationMs: 5 * 60 * 1000, bettingBlocks: 1 },
  { label: "updown-15m", durationMs: 15 * 60 * 1000, bettingBlocks: 2 },
  { label: "updown-30m", durationMs: 30 * 60 * 1000, bettingBlocks: 3 },
  { label: "updown-1h", durationMs: 60 * 60 * 1000, bettingBlocks: 6 },
];

function serializeClArgs(args) {
  return args.map(a => {
    switch (a.type) {
      case "uint":    return { type: "uint", value: String(a.value) };
      case "int":     return { type: "int", value: String(a.value) };
      case "true":    return { type: "bool", value: true };
      case "false":   return { type: "bool", value: false };
      case "ascii":   return { type: "string-ascii", value: a.value };
      case "utf8":    return { type: "string-utf8", value: a.value };
      case "address": return { type: "principal", value: a.value };
      default:
        throw new Error(`Cannot serialize Clarity arg type "${a.type}": ${JSON.stringify(a, (k,v) => typeof v === "bigint" ? v.toString() : v)}`);
    }
  });
}

async function callWrite(contractName, functionName, args = [], label = "") {
  try {
    const res = await fetch(`${ENGINE_URL}/tx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractName,
        functionName,
        args: serializeClArgs(args),
        label: label || functionName,
      }),
    });
    const result = await res.json();
    if (result.ok) {
      console.log(`  [TX]   ${label || functionName}: ${result.txid} (via engine)`);
    } else {
      console.log(`  [FAIL] ${label || functionName}: ${result.error || "unknown error"}`);
    }
    return result;
  } catch (e) {
    console.log(`  [FAIL] ${label || functionName}: Engine unreachable -- ${e.message}`);
    return { ok: false, error: e.message, txid: null };
  }
}

async function callRead(contractName, functionName, args = []) {
  const raw = await fetchCallReadOnlyFunction({
    contractAddress: DEPLOYER,
    contractName,
    functionName,
    functionArgs: args,
    senderAddress: DEPLOYER,
    network: NETWORK,
  });
  return cvToJSON(raw);
}

async function fetchBtcPriceUsd() {
  try {
    const res = await fetch(
      "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    const p = parseFloat(data.price);
    if (p > 0) return p;
  } catch {}
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    const p = data?.bitcoin?.usd;
    if (p > 0) return p;
  } catch {}
  try {
    const res = await fetch(`${ENGINE_URL}/btc-price`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    if (data.price > 0) return data.price;
  } catch {}
  return 0;
}

async function fetchBtcPriceWithRetry(label = "price") {
  for (let attempt = 1; attempt <= 10; attempt++) {
    const p = await fetchBtcPriceUsd();
    if (p > 0) return p;
    const delay = attempt * 3000;
    console.log(`[${label}] Oracle fetch attempt ${attempt}/10 failed, retrying in ${delay/1000}s...`);
    await sleep(delay);
  }
  console.log(`[${label}] WARNING: All oracle retries failed, using engine cached price`);
  try {
    const res = await fetch(`${ENGINE_URL}/btc-price`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.price > 0) return data.price;
  } catch {}
  console.log(`[${label}] CRITICAL: No price available at all`);
  return 0;
}

async function fetchBtcPriceAtTime(timestampMs) {
  try {
    const res = await fetch(
      `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&endTime=${timestampMs}&limit=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    if (data && data[0]) {
      const closePrice = parseFloat(data[0][4]);
      if (closePrice > 0) return closePrice;
    }
  } catch {}
  return fetchBtcPriceUsd();
}

async function updateOraclePrice() {
  const priceUsd = await fetchBtcPriceUsd();
  const price8dec = Math.round(priceUsd * ONE_8);
  console.log(
    `  [PRICE] BTC $${priceUsd.toLocaleString()} => ${price8dec} (8-dec)`
  );
  const tx = await callWrite("stacky-oracle-v3", "set-btc-price", [Cl.uint(price8dec)], "set-btc-price");
  await new Promise(r => setTimeout(r, 2000));
  return { tx, priceUsd, price8dec };
}

function getNextBoundary(durationMs) {
  const now = Date.now();
  return Math.ceil(now / durationMs) * durationMs;
}

function formatTime(ms) {
  return new Date(ms).toISOString().slice(11, 19);
}

async function runTimeframeLoop(tf) {
  const { label, durationMs, bettingBlocks } = tf;
  const durationStr =
    durationMs >= 60_000
      ? `${durationMs / 60_000}m`
      : `${durationMs / 1000}s`;

  console.log(`\n[${label}] Starting clock-aligned loop (${durationStr} per round)`);

  let previousMarketId = null;

  const firstBoundary = getNextBoundary(durationMs);
  const currentSessionStart = firstBoundary - durationMs;

  let closingPrice = await fetchBtcPriceAtTime(currentSessionStart);
  let closingPrice8dec = Math.round(closingPrice * ONE_8);
  console.log(`[${label}] Price to Beat: $${closingPrice.toLocaleString()} (BTC at ${formatTime(currentSessionStart)})`);

  const waitFirst = firstBoundary - Date.now();
  if (waitFirst > 5000) {
    console.log(`[${label}] Creating initial market (expires at ${formatTime(firstBoundary)}, ${(waitFirst/1000).toFixed(0)}s)...`);
    await updateOraclePrice();
    previousMarketId = await createMarket(label, bettingBlocks, waitFirst, closingPrice8dec);
    await sleep(Math.max(0, firstBoundary - Date.now()));
    const newPrice1 = await fetchBtcPriceWithRetry(label);
    if (newPrice1 > 0) {
      closingPrice = newPrice1;
      closingPrice8dec = Math.round(closingPrice * ONE_8);
    } else {
      console.log(`[${label}] WARNING: Using previous closing price $${closingPrice.toLocaleString()}`);
    }
    console.log(`[${label}] Session closed at $${closingPrice.toLocaleString()} -- this becomes next Price to Beat`);
  } else {
    await sleep(Math.max(0, waitFirst));
  }

  while (true) {
    const periodEnd = getNextBoundary(durationMs);
    const price8dec = closingPrice8dec;

    console.log(
      `\n[${label}] === Period ${formatTime(Date.now())} -> ${formatTime(periodEnd)} ===`
    );
    console.log(`[${label}] Price to Beat: $${closingPrice.toLocaleString()} (previous session closing price)`);

    await callWrite("stacky-oracle-v3", "set-btc-price", [Cl.uint(price8dec)], "set-btc-price");
    await new Promise(r => setTimeout(r, 2000));
    const marketId = await createMarket(label, bettingBlocks, durationMs, price8dec);
    if (marketId === null) {
      console.log(`[${label}] ERROR: Market creation failed, skipping this period`);
      const remaining = periodEnd - Date.now();
      if (remaining > 0) await sleep(remaining);
      const newPrice = await fetchBtcPriceWithRetry(label);
      if (newPrice > 0) { closingPrice = newPrice; closingPrice8dec = Math.round(closingPrice * ONE_8); }
      continue;
    }

    if (previousMarketId !== null) {
      resolveMarketDirect(label, previousMarketId).catch(async (e) => {
        console.log(`[${label}] Resolve error: ${e.message}, retrying in 10s...`);
        await sleep(10000);
        resolveMarketDirect(label, previousMarketId).catch(e2 =>
          console.log(`[${label}] Resolve retry failed: ${e2.message}`)
        );
      });
    }

    previousMarketId = marketId;

    const remaining = periodEnd - Date.now();
    if (remaining > 0) {
      console.log(`[${label}] Waiting ${(remaining/1000).toFixed(0)}s until ${formatTime(periodEnd)}...`);
      await sleep(remaining);
    }

    const newPrice2 = await fetchBtcPriceWithRetry(label);
    if (newPrice2 > 0) {
      closingPrice = newPrice2;
      closingPrice8dec = Math.round(closingPrice * ONE_8);
    } else {
      console.log(`[${label}] WARNING: Using previous closing price $${closingPrice.toLocaleString()}`);
    }
    console.log(`[${label}] Session closed at $${closingPrice.toLocaleString()} -- next Price to Beat`);
  }
}

let nextMarketId = null;
const createLock = { pending: Promise.resolve() };
async function createMarket(label, bettingBlocks, durationMs, startPrice8dec) {
  const result = await (createLock.pending = createLock.pending.then(async () => {
    console.log(`[${label}] Creating market...`);

    if (nextMarketId === null) {
      try {
        const countBefore = await callRead(TOKENS_CONTRACT, "get-market-count");
        nextMarketId = Number(countBefore.value);
      } catch {
        nextMarketId = 0;
      }
    }

    const marketId = nextMarketId;

    const createTx = await callWrite(
      TOKENS_CONTRACT,
      "create-updown-market",
      [Cl.stringAscii(label), Cl.uint(bettingBlocks)],
      `create ${label}`
    );

    if (!createTx.ok) {
      console.log(`[${label}] Market creation failed`);
      return null;
    }

    nextMarketId = marketId + 1;

    console.log(`[${label}] Market created: ID ${marketId} (start price: ${startPrice8dec})`);

    try {
      await fetch(`${ENGINE_URL}/market-created`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketId, timeframe: label, durationMs, startPrice: startPrice8dec }),
      });
    } catch (_) {}

    return marketId;
  }));

  return result;
}

async function resolveMarketDirect(label, marketId) {
  console.log(`[${label}] Resolving market ${marketId}...`);

  let resolved = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const resolveTx = await callWrite(
      TOKENS_CONTRACT,
      "resolve-updown-market",
      [Cl.uint(marketId)],
      `resolve ${label} #${marketId}`
    );
    if (resolveTx.ok) {
      const txid = resolveTx.txid;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 10000));
        try {
          const res = await fetch(`https://api.mainnet.hiro.so/extended/v1/tx/0x${txid}`);
          const d = await res.json();
          if (d.tx_status === "success") {
            console.log(`[${label}] Market ${marketId} resolved on-chain`);
            resolved = true;
            break;
          }
          if (d.tx_status?.startsWith("abort")) {
            console.log(`[${label}] Resolve TX aborted: ${d.tx_result?.repr}, retrying...`);
            break;
          }
        } catch {}
      }
      if (resolved) break;
    } else {
      console.log(`[${label}] Resolve attempt ${attempt + 1}/20 failed, waiting 30s...`);
    }
    await new Promise(r => setTimeout(r, 30000));
  }

  if (!resolved) {
    console.log(`[${label}] WARNING: Could not resolve market ${marketId} after 20 attempts`);
    return;
  }

  try {
    await fetch(`${ENGINE_URL}/market-resolved`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId }),
    });
    console.log(`[${label}] Engine notified, auto-redemption triggered`);
  } catch (_) {}
}

async function resolveWithOracle(label, marketId) {
  console.log(`[${label}] Updating oracle for market ${marketId}...`);
  try {
    await updateOraclePrice();
  } catch (e) {
    console.log(`[${label}] Price update error: ${e.message}`);
  }
  await sleep(2000);
  await resolveMarketDirect(label, marketId);
}

async function printStatus() {
  console.log(`\n[${new Date().toISOString()}] === STATUS ===`);
  try {
    const price = await callRead("stacky-oracle-v3", "get-btc-price");
    console.log(
      `  BTC Price:     $${(Number(price.value) / ONE_8).toLocaleString()}`
    );

    const markets = await callRead(TOKENS_CONTRACT, "get-market-count");
    const count = Number(markets.value);
    console.log(`  Total markets: ${count}`);

    const showCount = Math.min(count, 8);
    for (let i = count - showCount; i < count; i++) {
      try {
        const m = await callRead(TOKENS_CONTRACT, "get-market", [Cl.uint(i)]);
        const val = m.value?.value || m.value;
        const resolved =
          val?.resolved?.value === true || val?.resolved?.type === "true";
        const question = val?.question?.value || "n/a";
        console.log(
          `  Market ${i}: ${question} ${resolved ? "[RESOLVED]" : "[LIVE]"}`
        );
      } catch (_) {}
    }

    try {
      const fees = await callRead("stacky-exchange-v2", "get-protocol-fees");
      console.log(`  Protocol fees: ${Number(fees.value) / ONE_8} sBTC`);
      const tradeCount = await callRead("stacky-exchange-v2", "get-trade-count");
      console.log(`  Total trades:  ${Number(tradeCount.value)}`);
    } catch (_) {}
  } catch (e) {
    console.log(`  Status error: ${e.message}`);
  }
  console.log("");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const arg = process.argv[2];

  if (arg === "status") {
    await printStatus();
    return;
  }

  console.log("=== STACKY CLOB KEEPER ===");
  console.log(`  Deployer: ${DEPLOYER}`);
  console.log(`  Network:  ${NETWORK}`);
  console.log(`  Tokens:   ${TOKENS_CONTRACT}`);
  console.log("");

  try {
    const r = await fetch(`${ENGINE_URL}/btc-price`);
    if (!r.ok) throw new Error(`status ${r.status}`);
    console.log("  Engine:   connected");
  } catch (e) {
    console.error(`  Engine:   UNREACHABLE at ${ENGINE_URL} -- ${e.message}`);
    console.error("  Start the matching engine first: node scripts/matching-engine.mjs");
    process.exit(1);
  }
  console.log("");

  let selected = TIMEFRAMES;
  if (arg && arg !== "all") {
    const match = TIMEFRAMES.find(
      (tf) => tf.label === `updown-${arg}` || tf.label === arg
    );
    if (!match) {
      console.error(
        `Unknown timeframe "${arg}". Valid: ${TIMEFRAMES.map((t) => t.label).join(", ")}, all, status`
      );
      process.exit(1);
    }
    selected = [match];
  }

  console.log(
    `  Timeframes: ${selected.map((t) => t.label).join(", ")}\n`
  );

  const loops = selected.map((tf, i) =>
    sleep(i * 5000).then(() => runTimeframeLoop(tf))
  );
  await Promise.allSettled(loops);
}

process.on("SIGINT", () => {
  console.log("\n[keeper] Shutting down gracefully...");
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("[keeper] Terminated");
  process.exit(0);
});

main().catch((e) => {
  console.error("Keeper fatal error:", e);
  process.exit(1);
});
