#!/usr/bin/env node

import { ENGINE_URL, ONE_8, MM_ADDRESS } from "./lib/config.mjs";

const MM_USER = MM_ADDRESS;
const TICK = 100_000;

const REPRICE_INTERVAL = 2000;

const ANNUAL_VOL = 0.55;
const SIGMA_PER_MIN = ANNUAL_VOL / Math.sqrt(525600);

const MIN_TIME_REMAINING = 0.1;

const LEVEL_OFFSETS = [
  { offset: 0.01, size: 0.08 },
  { offset: 0.02, size: 0.07 },
  { offset: 0.03, size: 0.06 },
  { offset: 0.04, size: 0.05 },
  { offset: 0.05, size: 0.05 },
  { offset: 0.07, size: 0.04 },
  { offset: 0.10, size: 0.04 },
  { offset: 0.15, size: 0.03 },
  { offset: 0.20, size: 0.03 },
  { offset: 0.25, size: 0.02 },
  { offset: 0.30, size: 0.02 },
  { offset: 0.35, size: 0.02 },
  { offset: 0.40, size: 0.02 },
  { offset: 0.45, size: 0.01 },
  { offset: 0.48, size: 0.01 },
];

let activeMarkets = new Map();
let lastFairValues = new Map();
let tickRunning = false;

function normalCDF(x) {
  if (x < -8) return 0;
  if (x > 8) return 1;

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}

function calculateFairValue(currentPrice, strikePrice, timeRemainingMin) {
  if (strikePrice <= 0 || currentPrice <= 0) return 0.50;

  const T = Math.max(timeRemainingMin, MIN_TIME_REMAINING);
  const sigmaRootT = SIGMA_PER_MIN * Math.sqrt(T);

  if (sigmaRootT < 1e-10) return currentPrice >= strikePrice ? 0.99 : 0.01;

  const d2 = Math.log(currentPrice / strikePrice) / sigmaRootT;
  const fairValue = normalCDF(d2);

  return Math.max(0.02, Math.min(0.98, fairValue));
}

async function engineFetch(path, options) {
  const res = await fetch(`${ENGINE_URL}${path}`, options);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Engine ${res.status}: ${text}`);
  }
  return res.json();
}

async function postOrder(marketId, side, outcome, amount, price) {
  const snapped = Math.round(price / TICK) * TICK;
  const clampedPrice = Math.max(TICK, Math.min(ONE_8 - TICK, snapped));
  if (clampedPrice <= 0 || clampedPrice >= ONE_8) return null;

  try {
    const result = await engineFetch("/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        marketId,
        user: MM_USER,
        side,
        outcome,
        amount: Math.round(amount),
        price: clampedPrice,
      }),
    });
    if (result?.error) {
    }
    return result?.order?.id || null;
  } catch (e) {
    return null;
  }
}

async function cancelAllOrders(marketId) {
  try {
    await engineFetch(`/orders/user/${MM_USER}?marketId=${marketId}`, { method: "DELETE" });
  } catch {}
}

async function postBook(marketId, fairValue) {
  const orderPromises = [];

  for (const { offset, size } of LEVEL_OFFSETS) {
    const bidPrice = (fairValue - offset) * ONE_8;
    const askPrice = (fairValue + offset) * ONE_8;
    const amount = size * ONE_8;

    if (bidPrice > 0 && bidPrice < ONE_8) {
      orderPromises.push(postOrder(marketId, "buy", "yes", amount, bidPrice));
    }
    if (askPrice > 0 && askPrice < ONE_8) {
      orderPromises.push(postOrder(marketId, "sell", "yes", amount, askPrice));
    }
  }

  const results = await Promise.all(orderPromises);
  return results.filter(id => id != null).length;
}

async function repriceMarket(marketId, market, btcPrice) {
  const { startPrice, createdAt, durationMs } = market;

  if (!startPrice || startPrice <= 0) return;

  const elapsed = Date.now() - createdAt;
  const remainingMs = Math.max(0, durationMs - elapsed);
  const remainingMin = remainingMs / 60000;

  if (remainingMs <= 0) return;

  const strikeUsd = startPrice / ONE_8;

  const fairValue = calculateFairValue(btcPrice, strikeUsd, remainingMin);

  const roundedFV = Math.round(fairValue * 1000) / 1000;

  const lastFV = lastFairValues.get(marketId);
  if (lastFV !== undefined && Math.abs(roundedFV - lastFV) < 0.005) {
    return;
  }

  await cancelAllOrders(marketId);
  const posted = await postBook(marketId, roundedFV);

  const prevFV = lastFV !== undefined ? lastFV.toFixed(3) : "new";
  lastFairValues.set(marketId, roundedFV);

  const progress = ((elapsed / durationMs) * 100).toFixed(0);
  console.log(
    `  [market ${marketId}] FV: ${prevFV} -> ${roundedFV.toFixed(3)} ` +
    `| BTC: $${btcPrice.toFixed(0)} vs $${strikeUsd.toFixed(0)} ` +
    `| ${remainingMin.toFixed(1)}min left (${progress}%) ` +
    `| ${posted} orders`
  );
}

async function discoverMarkets() {
  try {
    const times = await engineFetch("/market-times");
    const data = await engineFetch("/markets");
    if (!data.markets) return;

    const newActive = new Map();
    for (const m of data.markets) {
      const resolved = m["resolved"]?.value === true || m["resolved"]?.type === "true";
      const cancelled = m["cancelled"]?.value === true || m["cancelled"]?.type === "true";
      if (resolved || cancelled) continue;

      const timing = times[m.id] || {};
      const timeframe = m["market-type"]?.value || "unknown";
      const TIMEFRAME_DURATIONS = {
        "updown-5m": 300000,
        "updown-15m": 900000,
        "updown-30m": 1800000,
        "updown-1h": 3600000,
      };
      const durationMs = timing.durationMs || TIMEFRAME_DURATIONS[timeframe] || 300000;
      const createdAt = timing.createdAt || Date.now();

      const startPrice = timing.startPrice ||
        (m["start-price"]?.value ? Number(m["start-price"].value) : null) ||
        (m["target-price"]?.value ? Number(m["target-price"].value) : null);

      const elapsed = Date.now() - createdAt;
      if (elapsed > durationMs + 30000) continue;

      newActive.set(m.id, { timeframe, createdAt, durationMs, startPrice });
    }

    for (const id of lastFairValues.keys()) {
      if (!newActive.has(id)) lastFairValues.delete(id);
    }

    activeMarkets = newActive;
  } catch (e) {
    console.log(`[discover] Error: ${e.message}`);
  }
}

async function tick() {
  if (tickRunning) return;
  tickRunning = true;

  try {
    if (activeMarkets.size === 0) return;

    let btcPrice;
    try {
      const priceData = await engineFetch("/btc-price");
      btcPrice = priceData.price;
    } catch (e) {
      console.log(`[tick] Can't fetch BTC price: ${e.message}`);
      return;
    }

    if (!btcPrice || btcPrice <= 0) return;

    for (const [marketId, market] of activeMarkets) {
      await repriceMarket(marketId, market, btcPrice);
    }
  } finally {
    tickRunning = false;
  }
}

async function main() {
  console.log("=== STACKY MARKET MAKER (Binary Option Pricing) ===");
  console.log(`  Engine:      ${ENGINE_URL}`);
  console.log(`  Model:       P(UP) = N(d2), d2 = ln(S/K) / (sigma*sqrt(T))`);
  console.log(`  Volatility:  ${(ANNUAL_VOL * 100).toFixed(0)}% annualized (${(SIGMA_PER_MIN * 100).toFixed(4)}%/min)`);
  console.log(`  Levels:      ${LEVEL_OFFSETS.length} per side`);
  console.log(`  Reprice:     ${REPRICE_INTERVAL}ms`);
  console.log("");

  try {
    const result = await engineFetch(`/orders/user/${MM_USER}`, { method: "DELETE" });
    console.log(`[init] Cleared ${result.cancelled || 0} stale MM orders`);
  } catch {}

  await discoverMarkets();
  console.log(`[init] Found ${activeMarkets.size} active markets`);

  for (const [id, m] of activeMarkets) {
    const strikeUsd = m.startPrice ? (m.startPrice / ONE_8).toFixed(0) : "unknown";
    const remaining = Math.max(0, m.durationMs - (Date.now() - m.createdAt));
    console.log(`  Market ${id}: ${m.timeframe} | strike $${strikeUsd} | ${(remaining / 60000).toFixed(1)}min left`);
  }

  if (activeMarkets.size > 0) {
    await tick();
  }

  setInterval(async () => {
    try {
      await tick();
    } catch (e) {
      console.log(`[tick] Error: ${e.message}`);
    }
  }, REPRICE_INTERVAL);

  setInterval(async () => {
    try {
      await discoverMarkets();
    } catch (e) {
      console.log(`[discover] Error: ${e.message}`);
    }
  }, 5_000);
}

process.on("SIGINT", () => {
  console.log("\n[mm] Shutting down...");
  process.exit(0);
});

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
