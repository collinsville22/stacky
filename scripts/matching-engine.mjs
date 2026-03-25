#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  makeContractCall,
  broadcastTransaction,
  fetchCallReadOnlyFunction,
  Cl,
  PostConditionMode,
  cvToJSON,
} from "@stacks/transactions";
import { createNetwork } from "@stacks/network";
import { DEPLOYER, PRIVATE_KEY, HIRO_API_KEY, NETWORK as NETWORK_NAME, TX_FEE, ONE_8, EXCHANGE_CONTRACT, TOKENS_CONTRACT } from "./lib/config.mjs";

const PORT = Number(process.env.PORT) || 3001;
const NETWORK = createNetwork(HIRO_API_KEY ? { network: NETWORK_NAME, apiKey: HIRO_API_KEY } : { network: NETWORK_NAME });

const STATE_FILE = path.join(process.cwd(), "data", "engine-state.json");
const PERSIST_INTERVAL_MS = 5000;
let persistTimer = null;
let persistDirty = false;

const DEFAULT_TICK = 100_000;
const FINE_TICK = 10_000;

const MAKER_REBATE_RATE = 0.20;
const makerRebates = new Map();

const books = new Map();

const ordersById = new Map();

const trades = [];
const MAX_TRADES = 500;

let orderNonce = 0;
let tradeNonce = 0;

const marketsCache = { data: null, lastFetch: 0 };

const marketTimes = new Map();

const managedMarkets = new Map();

const priceHistory = new Map();
const MAX_PRICE_HISTORY = 500;

const lastSnapshotTime = new Map();
const SNAPSHOT_COOLDOWN_MS = 1500;

const btcPriceHistory = new Map();
const MAX_BTC_PRICE_HISTORY = 500;
let latestBtcPrice = 0;

let btcFetchInFlight = false;
async function fetchBtcPriceForChart() {
  if (btcFetchInFlight) return; // prevent pile-up
  btcFetchInFlight = true;
  try {
    let price = 0;
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        { signal: AbortSignal.timeout(8000) }
      );
      const data = await res.json();
      price = data?.bitcoin?.usd || 0;
    } catch {}
    if (!price) {
      try {
        const res = await fetch(
          "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
          { signal: AbortSignal.timeout(8000) }
        );
        const data = await res.json();
        price = parseFloat(data.price);
      } catch {}
    }
    if (price > 0) {
      latestBtcPrice = price;
      const now = Date.now();
      for (const [marketId, info] of marketTimes) {
        const elapsed = now - info.createdAt;
        if (elapsed < 0 || elapsed > info.durationMs + 60000) continue;
        if (!btcPriceHistory.has(marketId)) btcPriceHistory.set(marketId, []);
        const hist = btcPriceHistory.get(marketId);
        hist.push({ time: now, price: latestBtcPrice });
        if (hist.length > MAX_BTC_PRICE_HISTORY) hist.shift();
      }
    }
  } catch (e) {
    console.log(`[btc-price] Error: ${e.message}`);
  } finally {
    btcFetchInFlight = false;
  }
}

setInterval(fetchBtcPriceForChart, 10000); // 10s interval, not 2s
fetchBtcPriceForChart().then(() => console.log(`[btc-price] Initial: $${latestBtcPrice}`));

function recordPriceSnapshot(marketId) {
  const book = getBook(marketId);
  const yesBids = book.bids.filter((o) => o.outcome === "yes");
  const yesAsks = book.asks.filter((o) => o.outcome === "yes");

  if (yesBids.length === 0 || yesAsks.length === 0) return;

  const mid = (yesBids[0].price + yesAsks[0].price) / 2 / ONE_8;

  const lastTime = lastSnapshotTime.get(marketId) || 0;
  const now = Date.now();
  if (now - lastTime < SNAPSHOT_COOLDOWN_MS) return;

  if (!priceHistory.has(marketId)) priceHistory.set(marketId, []);
  const hist = priceHistory.get(marketId);

  if (hist.length === 0 || Math.abs(hist[hist.length - 1].price - mid) > 0.005) {
    hist.push({ time: now, price: mid });
    lastSnapshotTime.set(marketId, now);
    if (hist.length > MAX_PRICE_HISTORY) hist.shift();
  }
}

function schedulePersist() {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistDirty) persistState();
  }, PERSIST_INTERVAL_MS);
}

function serializeOrder(o) {
  return { id: o.id, marketId: o.marketId, user: o.user, side: o.side, outcome: o.outcome, amount: o.amount, price: o.price, timestamp: o.timestamp, status: o.status, type: o.type || "gtc", expiration: o.expiration || null };
}

function persistState() {
  persistDirty = false;
  try {
    const state = {
      orderNonce,
      tradeNonce,
      books: Object.fromEntries([...books].map(([k, v]) => [k, {
        bids: v.bids.map(serializeOrder),
        asks: v.asks.map(serializeOrder),
      }])),
      trades: trades.slice(0, 100),
      marketTimes: Object.fromEntries(marketTimes),
      managedMarkets: Object.fromEntries(managedMarkets),
      lastTradePrice: Object.fromEntries(lastTradePrice),
      makerRebates: Object.fromEntries(makerRebates),
    };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE + ".tmp", JSON.stringify(state));
    fs.renameSync(STATE_FILE + ".tmp", STATE_FILE);
  } catch (e) {
    console.log(`[persist] Error: ${e.message}`);
  }
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    orderNonce = raw.orderNonce || 0;
    tradeNonce = raw.tradeNonce || 0;
    if (raw.books) {
      for (const [k, v] of Object.entries(raw.books)) {
        const mid = Number(k);
        const book = { bids: [], asks: [] };
        for (const o of v.bids || []) { const order = { ...o, type: o.type || "gtc", expiration: o.expiration || null }; ordersById.set(order.id, order); book.bids.push(order); }
        for (const o of v.asks || []) { const order = { ...o, type: o.type || "gtc", expiration: o.expiration || null }; ordersById.set(order.id, order); book.asks.push(order); }
        books.set(mid, book);
      }
    }
    if (raw.trades) { trades.push(...raw.trades); }
    if (raw.marketTimes) {
      for (const [k, v] of Object.entries(raw.marketTimes)) marketTimes.set(Number(k), v);
    }
    if (raw.managedMarkets) {
      for (const [k, v] of Object.entries(raw.managedMarkets)) managedMarkets.set(Number(k), v);
    }
    if (raw.lastTradePrice) {
      for (const [k, v] of Object.entries(raw.lastTradePrice)) lastTradePrice.set(Number(k), v);
    }
    if (raw.makerRebates) {
      for (const [k, v] of Object.entries(raw.makerRebates)) makerRebates.set(k, v);
    }
    console.log(`[persist] Loaded state: ${ordersById.size} orders, ${books.size} books, ${trades.length} trades`);
    return true;
  } catch (e) {
    console.log(`[persist] Load error: ${e.message}`);
    return false;
  }
}

let wss = null;
const wsSubscriptions = new Map();

function initWebSocket(server) {
  wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    wsSubscriptions.set(ws, new Set());
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "subscribe" && msg.channel) {
          wsSubscriptions.get(ws)?.add(msg.channel);
        } else if (msg.type === "unsubscribe" && msg.channel) {
          wsSubscriptions.get(ws)?.delete(msg.channel);
        } else if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {}
    });
    ws.on("close", () => wsSubscriptions.delete(ws));
  });
  console.log(`[ws] WebSocket server attached`);
}

function broadcast(channel, event, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ channel, event, ...payload });
  for (const [ws, channels] of wsSubscriptions) {
    if (channels.has(channel) && ws.readyState === 1) {
      try { ws.send(msg); } catch {}
    }
  }
}

function getTickSize(marketId) {
  const book = getBook(marketId);
  const yesBids = book.bids.filter(o => o.outcome === "yes");
  const yesAsks = book.asks.filter(o => o.outcome === "yes");
  const bestBid = yesBids.length > 0 ? yesBids[0].price : 0;
  const bestAsk = yesAsks.length > 0 ? yesAsks[0].price : ONE_8;
  if (bestBid > 0.96 * ONE_8 || bestAsk < 0.04 * ONE_8) return FINE_TICK;
  return DEFAULT_TICK;
}

let currentNonce = null;
const nonceLock = { pending: null };

async function initNonce() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const delay = 3000 + attempt * 2000;
      const res = await fetch(
        `https://api.mainnet.hiro.so/extended/v1/address/${DEPLOYER}/nonces`,
        HIRO_API_KEY ? { headers: { "x-hiro-api-key": HIRO_API_KEY } } : {}
      );
      if (!res.ok) {
        console.log(`[nonce] API returned ${res.status}, retrying in ${delay/1000}s... (${attempt + 1}/10)`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      const data = await res.json();
      currentNonce = data.possible_next_nonce;
      console.log(`[nonce] Initialized: ${currentNonce}`);
      return;
    } catch (e) {
      const delay = 3000 + attempt * 2000;
      console.log(`[nonce] Error: ${e.message}, retrying in ${delay/1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  currentNonce = 0;
  console.log(`[nonce] Failed to fetch, starting at 0`);
}

function acquireNonce() {
  const execute = async () => {
    if (currentNonce === null) await initNonce();
    return currentNonce++;
  };
  nonceLock.pending = (nonceLock.pending || Promise.resolve()).then(execute);
  return nonceLock.pending;
}

async function callWrite(contractName, functionName, args = [], label = "", customAddr = null) {
  const nonce = await acquireNonce();

  try {
    const freshNetwork = createNetwork(HIRO_API_KEY ? { network: NETWORK_NAME, apiKey: HIRO_API_KEY } : { network: NETWORK_NAME });
    const tx = await makeContractCall({
      contractAddress: customAddr || DEPLOYER,
      contractName,
      functionName,
      functionArgs: args,
      senderKey: PRIVATE_KEY,
      network: freshNetwork,
      postConditionMode: PostConditionMode.Allow,
      fee: TX_FEE,
      nonce,
    });
    const result = await Promise.race([
      broadcastTransaction({ transaction: tx, network: freshNetwork }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("broadcast timeout")), 30000)),
    ]);
    if (result.error || result.reason) {
      console.log(`  [FAIL] ${label || functionName} (nonce ${nonce}): ${result.error || result.reason}`);
      return { ok: false, error: result.error || result.reason };
    }
    console.log(`  [TX] ${label || functionName}: ${result.txid} (nonce ${nonce})`);
    return { ok: true, txid: result.txid };
  } catch (e) {
    console.log(`  [FAIL] ${label || functionName} (nonce ${nonce}): ${e.message}`);
    return { ok: false, error: e.message };
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

function getBook(marketId) {
  if (!books.has(marketId)) {
    books.set(marketId, { bids: [], asks: [] });
  }
  return books.get(marketId);
}

function placeOrder({ marketId, user, side, outcome, amount, price, type = "gtc", expiration = null }) {
  const id = ++orderNonce;
  const order = {
    id,
    marketId,
    user,
    side,
    outcome,
    amount,
    originalAmount: amount,
    price,
    timestamp: Date.now(),
    status: "open",
    type,
    expiration,
  };

  ordersById.set(id, order);
  const matched = matchOrder(order);

  if (type === "fok" && order.amount > 0) {
    for (const trade of matched) {
      if (trade._restingOrder) {
        trade._restingOrder.amount += trade.amount;
        if (trade._restingOrder.status === "filled") {
          trade._restingOrder.status = "open";
          const book = getBook(marketId);
          const restSide = trade._restingOrder.side === "buy" ? book.bids : book.asks;
          restSide.push(trade._restingOrder);
          restSide.sort(trade._restingOrder.side === "buy"
            ? (a, b) => b.price - a.price || a.timestamp - b.timestamp
            : (a, b) => a.price - b.price || a.timestamp - b.timestamp);
        }
      }
    }
    for (const trade of matched) {
      const idx = trades.indexOf(trade);
      if (idx !== -1) trades.splice(idx, 1);
    }
    order.amount = order.originalAmount;
    order.status = "cancelled";
    ordersById.delete(id);
    return { order, trades: [], error: "FOK not fully filled" };
  }

  if (type === "fak" && order.amount > 0) {
    order.status = order.amount < order.originalAmount ? "partial" : "cancelled";
    ordersById.delete(id);
    const book = getBook(marketId);
    const fakSide = side === "buy" ? book.bids : book.asks;
    const fakIdx = fakSide.findIndex((o) => o.id === id);
    if (fakIdx !== -1) fakSide.splice(fakIdx, 1);
    recordPriceSnapshot(order.marketId);
    broadcast(`market:${marketId}`, "book", { snapshot: getBookSnapshot(marketId) });
    schedulePersist();
    return { order, trades: matched };
  }

  if (order.amount > 0 && order.status === "open") {
    const book = getBook(marketId);
    if (side === "buy") {
      book.bids.push(order);
      book.bids.sort((a, b) => b.price - a.price || a.timestamp - b.timestamp);
    } else {
      book.asks.push(order);
      book.asks.sort((a, b) => a.price - b.price || a.timestamp - b.timestamp);
    }
  }

  recordPriceSnapshot(order.marketId);

  broadcast(`market:${marketId}`, "book", { snapshot: getBookSnapshot(marketId) });
  schedulePersist();

  return { order, trades: matched };
}

function matchOrder(incoming) {
  const book = getBook(incoming.marketId);
  const matched = [];

  if (incoming.side === "buy" && incoming.amount > 0) {
    const oppositeOutcome = incoming.outcome === "yes" ? "no" : "yes";
    const oppBook = book.bids;

    for (let i = 0; i < oppBook.length && incoming.amount > 0; ) {
      const resting = oppBook[i];
      if (resting.outcome !== oppositeOutcome) { i++; continue; }
      if (resting.user === incoming.user) { i++; continue; }

      if (incoming.price + resting.price < ONE_8) { i++; continue; }

      const fillAmount = Math.min(incoming.amount, resting.amount);
      const yesPrice = incoming.outcome === "yes" ? incoming.price : resting.price;

      const yesBuyer = incoming.outcome === "yes" ? incoming.user : resting.user;
      const noBuyer = incoming.outcome === "no" ? incoming.user : resting.user;

      const trade = {
        id: ++tradeNonce,
        marketId: incoming.marketId,
        matchType: "mint",
        maker: resting.user,
        taker: incoming.user,
        outcome: "mint",
        side: incoming.outcome === "yes",
        amount: fillAmount,
        price: yesPrice,
        timestamp: Date.now(),
        _restingOrder: resting,
      };

      incoming.amount -= fillAmount;
      resting.amount -= fillAmount;
      matched.push(trade);

      if (resting.amount === 0) {
        resting.status = "filled";
        oppBook.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  if (incoming.side === "sell" && incoming.amount > 0) {
    const oppositeOutcome = incoming.outcome === "yes" ? "no" : "yes";
    const oppSells = book.asks;

    for (let i = 0; i < oppSells.length && incoming.amount > 0; ) {
      const resting = oppSells[i];
      if (resting.outcome !== oppositeOutcome) { i++; continue; }
      if (resting.user === incoming.user) { i++; continue; }

      const yesPrice = incoming.outcome === "yes" ? incoming.price : resting.price;

      const fillAmount = Math.min(incoming.amount, resting.amount);

      const trade = {
        id: ++tradeNonce,
        marketId: incoming.marketId,
        matchType: "merge",
        maker: resting.user,
        taker: incoming.user,
        outcome: "merge",
        side: incoming.outcome === "yes" ? (incoming.side === "sell") : (resting.side === "sell"),
        amount: fillAmount,
        price: yesPrice,
        timestamp: Date.now(),
        _restingOrder: resting,
      };

      incoming.amount -= fillAmount;
      resting.amount -= fillAmount;
      matched.push(trade);

      if (resting.amount === 0) {
        resting.status = "filled";
        oppSells.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  if (incoming.amount > 0) {
    const oppSide = incoming.side === "buy" ? book.asks : book.bids;
    for (let i = 0; i < oppSide.length && incoming.amount > 0; ) {
      const resting = oppSide[i];
      if (resting.outcome !== incoming.outcome) { i++; continue; }
      if (resting.user === incoming.user) { i++; continue; }

      const buyer = incoming.side === "buy" ? incoming : resting;
      const seller = incoming.side === "sell" ? incoming : resting;
      if (buyer.price < seller.price) { i++; continue; }

      const fillAmount = Math.min(incoming.amount, resting.amount);
      const fillPrice = resting.price;

      const trade = {
        id: ++tradeNonce,
        marketId: incoming.marketId,
        matchType: "complementary",
        maker: resting.user,
        taker: incoming.user,
        outcome: incoming.outcome,
        side: seller.outcome === "yes",
        amount: fillAmount,
        price: fillPrice,
        timestamp: Date.now(),
        _restingOrder: resting,
      };

      incoming.amount -= fillAmount;
      resting.amount -= fillAmount;
      matched.push(trade);

      if (resting.amount === 0) {
        resting.status = "filled";
        oppSide.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  if (incoming.amount === 0) {
    incoming.status = "filled";
  }

  for (const trade of matched) {
    trades.unshift(trade);
    if (trades.length > MAX_TRADES) trades.pop();
    if (trade.price > 0) {
      lastTradePrice.set(trade.marketId, trade.price / ONE_8);
    }
    recordPriceSnapshot(trade.marketId);
    broadcast(`market:${trade.marketId}`, "trade", { trade: {
      id: trade.id, marketId: trade.marketId, matchType: trade.matchType,
      maker: trade.maker, taker: trade.taker, outcome: trade.outcome,
      side: trade.side, amount: trade.amount, price: trade.price, timestamp: trade.timestamp,
    }});
    const approxFee = trade.amount * trade.price / ONE_8 * 0.02;
    const rebate = Math.round(approxFee * MAKER_REBATE_RATE);
    if (rebate > 0) {
      makerRebates.set(trade.maker, (makerRebates.get(trade.maker) || 0) + rebate);
    }
    settleTrade(trade).catch((e) =>
      console.log(`[settle] Error: ${e.message}`)
    );
  }

  return matched;
}

function cancelOrder(orderId) {
  const order = ordersById.get(orderId);
  if (!order || order.status !== "open") return null;

  order.status = "cancelled";
  const book = getBook(order.marketId);
  const side = order.side === "buy" ? book.bids : book.asks;
  const idx = side.findIndex((o) => o.id === orderId);
  if (idx !== -1) side.splice(idx, 1);

  try {
    broadcast(`market:${order.marketId}`, "book", { snapshot: getBookSnapshot(order.marketId) });
  } catch (e) {
    console.log(`[ws] Broadcast error in cancelOrder: ${e.message}`);
  }
  schedulePersist();

  return order;
}

function filterExpiredOrders(marketId) {
  const book = getBook(marketId);
  const now = Date.now();
  const filterExpired = (orders) => {
    for (let i = orders.length - 1; i >= 0; i--) {
      if (orders[i].type === "gtd" && orders[i].expiration && orders[i].expiration <= now) {
        orders[i].status = "expired";
        ordersById.delete(orders[i].id);
        orders.splice(i, 1);
      }
    }
  };
  filterExpired(book.bids);
  filterExpired(book.asks);
}

const MATCH_TYPE_MAP = { complementary: 0, mint: 1, merge: 2 };

async function settleTrade(trade) {
  const matchType = MATCH_TYPE_MAP[trade.matchType];
  console.log(
    `[settle] ${trade.matchType} market=${trade.marketId} amount=${trade.amount} price=${trade.price}`
  );

  const result = await callWrite(
    EXCHANGE_CONTRACT,
    "fill-order",
    [
      Cl.uint(trade.marketId),
      Cl.principal(trade.maker),
      Cl.principal(trade.taker),
      Cl.bool(trade.side),
      Cl.uint(trade.amount),
      Cl.uint(trade.price),
      Cl.uint(matchType),
      Cl.uint(trade.id),
    ],
    `fill ${trade.matchType} #${trade.id}`
  );

  trade.settled = result.ok;
  trade.txid = result.txid || null;
  return result;
}

function parseBody(req) {
  const MAX_BODY = 1_048_576;
  return new Promise((resolve, reject) => {
    const contentLength = parseInt(req.headers["content-length"], 10);
    if (contentLength > MAX_BODY) {
      req.resume();
      return reject(Object.assign(new Error("Request body too large"), { status: 413 }));
    }
    let data = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        return reject(Object.assign(new Error("Request body too large"), { status: 413 }));
      }
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

const lastTradePrice = new Map();

function getBookSnapshot(marketId) {
  const book = getBook(marketId);

  const aggregate = (orders) => {
    const levels = new Map();
    for (const o of orders) {
      const key = o.price;
      if (!levels.has(key)) levels.set(key, { price: key, amount: 0, orders: 0 });
      const lv = levels.get(key);
      lv.amount += o.amount;
      lv.orders++;
    }
    return [...levels.values()];
  };

  const yesBids = book.bids.filter((o) => o.outcome === "yes");
  const yesAsks = book.asks.filter((o) => o.outcome === "yes");

  const complementOrders = (orders) =>
    orders.map(o => ({ ...o, price: ONE_8 - o.price }));

  const noBidsFromYes = complementOrders(yesAsks);
  const noAsksFromYes = complementOrders(yesBids);

  const nativeNoBids = book.bids.filter((o) => o.outcome === "no");
  const nativeNoAsks = book.asks.filter((o) => o.outcome === "no");
  const allNoBids = [...noBidsFromYes, ...nativeNoBids].sort((a, b) => b.price - a.price);
  const allNoAsks = [...noAsksFromYes, ...nativeNoAsks].sort((a, b) => a.price - b.price);

  const bestYesBid = yesBids.length > 0 ? yesBids[0].price : null;
  const bestYesAsk = yesAsks.length > 0 ? yesAsks[0].price : null;

  let yesPrice = null;
  if (bestYesBid !== null && bestYesAsk !== null) {
    const spread = (bestYesAsk - bestYesBid) / ONE_8;
    if (spread <= 0.10) {
      yesPrice = ((bestYesBid + bestYesAsk) / 2) / ONE_8;
    } else {
      yesPrice = lastTradePrice.get(marketId) ?? ((bestYesBid + bestYesAsk) / 2) / ONE_8;
    }
  } else if (bestYesBid !== null) {
    yesPrice = bestYesBid / ONE_8;
  } else if (bestYesAsk !== null) {
    yesPrice = bestYesAsk / ONE_8;
  } else {
    yesPrice = lastTradePrice.get(marketId) ?? null;
  }

  const noPrice = yesPrice !== null ? 1 - yesPrice : null;

  return {
    marketId,
    yes: { bids: aggregate(yesBids), asks: aggregate(yesAsks) },
    no: { bids: aggregate(allNoBids), asks: aggregate(allNoAsks) },
    yesPrice,
    noPrice,
    bestYesBid: bestYesBid !== null ? bestYesBid / ONE_8 : null,
    bestYesAsk: bestYesAsk !== null ? bestYesAsk / ONE_8 : null,
    lastTradePrice: lastTradePrice.get(marketId) ?? null,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    return json(res, 200, {});
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (req.method === "POST" && path === "/order") {
      const body = await parseBody(req);
      const { marketId, user, side, outcome, amount, price, type, expiration } = body;

      if (marketId == null || !user || !side || !outcome || !amount || !price) {
        return json(res, 400, { error: "Missing fields: marketId, user, side, outcome, amount, price" });
      }
      if (!["buy", "sell"].includes(side)) {
        return json(res, 400, { error: "side must be 'buy' or 'sell'" });
      }
      if (!["yes", "no"].includes(outcome)) {
        return json(res, 400, { error: "outcome must be 'yes' or 'no'" });
      }
      if (amount <= 0 || price <= 0 || price >= ONE_8) {
        return json(res, 400, { error: "Invalid amount or price" });
      }
      const orderType = type || "gtc";
      if (!["gtc", "gtd", "fok", "fak"].includes(orderType)) {
        return json(res, 400, { error: "type must be 'gtc', 'gtd', 'fok', or 'fak'" });
      }
      const tick = getTickSize(Number(marketId));
      if (Math.round(Number(price)) % tick !== 0) {
        return json(res, 400, { error: `Price must be a multiple of tick size ${tick}` });
      }

      const result = placeOrder({
        marketId: Number(marketId),
        user,
        side,
        outcome,
        amount: Number(amount),
        price: Number(price),
        type: orderType,
        expiration: expiration ? Number(expiration) : null,
      });

      return json(res, 200, result);
    }

    if (req.method === "DELETE" && path.startsWith("/order/") && !path.startsWith("/orders/")) {
      const id = Number(path.split("/")[2]);
      const order = cancelOrder(id);
      if (!order) return json(res, 404, { error: "Order not found or already filled" });
      return json(res, 200, { order });
    }

    if (req.method === "DELETE" && path.startsWith("/orders/user/")) {
      const user = decodeURIComponent(path.split("/orders/user/")[1]);
      const marketId = url.searchParams.get("marketId");
      let cancelled = 0;
      for (const [id, order] of ordersById) {
        if (order.user === user && order.status === "open") {
          if (marketId != null && order.marketId !== Number(marketId)) continue;
          cancelOrder(id);
          cancelled++;
        }
      }
      return json(res, 200, { cancelled });
    }

    if (req.method === "GET" && path.startsWith("/book/")) {
      const marketId = Number(path.split("/")[2]);
      return json(res, 200, getBookSnapshot(marketId));
    }

    if (req.method === "GET" && path === "/trades") {
      const marketId = url.searchParams.get("marketId");
      const filtered = marketId != null
        ? trades.filter((t) => t.marketId === Number(marketId))
        : trades;
      return json(res, 200, { trades: filtered.slice(0, 50) });
    }

    if (req.method === "GET" && path === "/markets") {
      const now = Date.now();

      if (!marketsCache.data || now - marketsCache.lastFetch > 30_000) {
        try {
          const count = await callRead(TOKENS_CONTRACT, "get-market-count");
          const total = Number(count.value);
          const showCount = Math.min(total, 30);
          for (let i = total - showCount; i < total; i++) {
            if (managedMarkets.has(i)) continue;
            try {
              const m = await callRead(TOKENS_CONTRACT, "get-market", [Cl.uint(i)]);
              const val = m.value?.value || m.value;
              if (val) managedMarkets.set(i, { id: i, ...val });
            } catch (_) {}
          }
          marketsCache.lastFetch = now;
        } catch (e) {
          console.log(`[markets] Chain backfill error: ${e.message}`);
        }
      }

      if (now - (marketsCache.lastResolveSync || 0) > 15_000) {
        marketsCache.lastResolveSync = now;
        for (const [id, m] of managedMarkets) {
          const isResolved = m.resolved?.value === true || m.resolved?.type === "true";
          if (isResolved) continue;
          try {
            const chain = await callRead(TOKENS_CONTRACT, "get-market", [Cl.uint(id)]);
            const val = chain.value?.value || chain.value;
            if (val) {
              const chainResolved = val.resolved?.value === true || val.resolved?.type === "true";
              if (chainResolved) {
                managedMarkets.set(id, { id, ...val });
              }
            }
          } catch (_) {}
        }
      }

      const markets = [];
      for (const [id, m] of managedMarkets) {
        const entry = { ...m };
        const timing = marketTimes.get(id);
        if (timing?.startPrice) {
          entry["start-price"] = { type: "uint", value: String(timing.startPrice) };
          entry["target-price"] = { type: "uint", value: String(timing.startPrice) };
        }
        markets.push(entry);
      }
      markets.sort((a, b) => a.id - b.id);

      const recent = markets.slice(-30);
      return json(res, 200, { total: markets.length > 0 ? Math.max(...markets.map(m => m.id)) + 1 : 0, markets: recent });
    }

    if (req.method === "POST" && path === "/market-created") {
      const body = await parseBody(req);
      const { marketId, timeframe, durationMs, startPrice } = body;
      if (marketId == null || !durationMs) {
        return json(res, 400, { error: "marketId and durationMs required" });
      }
      const mid = Number(marketId);
      const sp = startPrice ? String(startPrice) : "0";

      marketTimes.set(mid, {
        createdAt: Date.now(),
        durationMs: Number(durationMs),
        timeframe: timeframe || "unknown",
        startPrice: startPrice ? Number(startPrice) : null,
      });

      managedMarkets.set(mid, {
        id: mid,
        creator: { type: "principal", value: DEPLOYER },
        question: { type: "(string-ascii 9)", value: timeframe || "unknown" },
        "target-price": { type: "uint", value: sp },
        "resolution-height": { type: "uint", value: "999999" },
        "collateral-locked": { type: "uint", value: "0" },
        resolved: { type: "bool", value: false },
        outcome: { type: "bool", value: false },
        cancelled: { type: "bool", value: false },
        "market-type": { type: "(string-ascii 9)", value: timeframe || "unknown" },
        "start-price": { type: "uint", value: sp },
      });

      console.log(`[market] #${mid} registered (${timeframe}, ${durationMs}ms, start=$${(Number(sp) / ONE_8).toFixed(2)})`);
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && path === "/market-resolved") {
      const body = await parseBody(req);
      const { marketId, outcome } = body;
      if (marketId == null) {
        return json(res, 400, { error: "marketId required" });
      }
      const mid = Number(marketId);

      const existing = managedMarkets.get(mid);
      if (existing) {
        existing.resolved = { type: "bool", value: true };
        if (outcome !== undefined) {
          existing.outcome = { type: "bool", value: !!outcome };
        }
      }

      const book = getBook(mid);
      const cancelledCount = book.bids.length + book.asks.length;
      for (const o of [...book.bids, ...book.asks]) {
        o.status = "cancelled";
        ordersById.delete(o.id);
      }
      book.bids = [];
      book.asks = [];

      console.log(`[market] #${mid} resolved: cleared ${cancelledCount} orders`);

      const resolvedOutcome = !!outcome;
      const winningId = resolvedOutcome ? mid * 2 : mid * 2 + 1;

      const marketUsers = new Set();
      for (const t of trades) {
        if (t.marketId === mid) {
          marketUsers.add(t.maker);
          marketUsers.add(t.taker);
        }
      }

      let redeemed = 0;
      for (const user of marketUsers) {
        try {
          const bal = await callRead(EXCHANGE_CONTRACT, "get-token-escrow",
            [Cl.uint(winningId), Cl.principal(user)]);
          const amount = Number(bal?.value || 0);
          if (amount <= 0) continue;

          const result = await callWrite(
            EXCHANGE_CONTRACT, "redeem-for",
            [Cl.uint(mid), Cl.principal(user)],
            `redeem #${mid} for ${user.slice(0, 8)}`
          );
          if (result.ok) redeemed++;
        } catch (e) {
        }
      }
      if (redeemed > 0) {
        console.log(`[market] #${mid} auto-redeemed for ${redeemed} winners`);
      }

      return json(res, 200, { ok: true, cancelled: cancelledCount, redeemed });
    }

    if (req.method === "GET" && path === "/market-times") {
      const result = {};
      for (const [id, info] of marketTimes) {
        result[id] = info;
      }
      return json(res, 200, result);
    }

    if (req.method === "GET" && path.startsWith("/price-history/")) {
      const marketId = Number(path.split("/")[2]);
      const hist = priceHistory.get(marketId) || [];
      const bucketMs = Number(url.searchParams.get("bucket") || "0");

      if (bucketMs > 0 && hist.length > 0) {
        const bucketed = [];
        let bStart = hist[0].time;
        let bSum = 0, bCount = 0;
        for (const pt of hist) {
          if (pt.time - bStart >= bucketMs && bCount > 0) {
            bucketed.push({ time: bStart + bucketMs / 2, price: bSum / bCount });
            bStart = pt.time;
            bSum = 0; bCount = 0;
          }
          bSum += pt.price;
          bCount++;
        }
        if (bCount > 0) {
          bucketed.push({ time: bStart + bucketMs / 2, price: bSum / bCount });
        }
        return json(res, 200, { marketId, points: bucketed });
      }

      return json(res, 200, { marketId, points: hist });
    }

    if (req.method === "POST" && path === "/reset-nonce") {
      try {
        const r = await fetch(`https://api.mainnet.hiro.so/extended/v1/address/${DEPLOYER}/nonces`);
        const data = await r.json();
        currentNonce = data.possible_next_nonce;
        console.log(`[nonce] Reset to ${currentNonce}`);
        return json(res, 200, { ok: true, nonce: currentNonce });
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }

    if (req.method === "POST" && path === "/tx") {
      const body = await parseBody(req);
      const { contractAddress: customAddr, contractName, functionName, args, label } = body;
      if (!contractName || !functionName) {
        return json(res, 400, { error: "contractName and functionName required" });
      }

      const clArgs = (args || []).map(a => {
        switch (a.type) {
          case "uint": return Cl.uint(a.value);
          case "int": return Cl.int(a.value);
          case "bool": return Cl.bool(a.value);
          case "string-ascii": return Cl.stringAscii(a.value);
          case "string-utf8": return Cl.stringUtf8(a.value);
          case "principal": return Cl.principal(a.value);
          case "buffer": return Cl.buffer(Buffer.from(a.value, "hex"));
          case "none": return Cl.none();
          case "some": return Cl.some(Cl.stringUtf8(a.value));
          default: throw new Error(`Unknown Clarity type: ${a.type}`);
        }
      });

      const result = await callWrite(contractName, functionName, clArgs, label || "", customAddr);
      return json(res, result.ok ? 200 : 500, result);
    }

    if (req.method === "GET" && path === "/btc-price") {
      return json(res, 200, { price: latestBtcPrice, timestamp: Date.now() });
    }

    if (req.method === "GET" && path.startsWith("/btc-history/")) {
      const marketId = Number(path.split("/")[2]);
      const hist = btcPriceHistory.get(marketId) || [];
      return json(res, 200, { marketId, points: hist });
    }

    if (req.method === "GET" && path === "/status") {
      const activeBooks = [];
      for (const [mId, book] of books) {
        activeBooks.push({
          marketId: mId,
          bids: book.bids.length,
          asks: book.asks.length,
        });
      }
      return json(res, 200, {
        uptime: process.uptime(),
        totalOrders: orderNonce,
        totalTrades: trades.length,
        activeBooks,
      });
    }

    if (req.method === "GET" && path.startsWith("/prices/")) {
      const marketId = Number(path.split("/")[2]);
      const snap = getBookSnapshot(marketId);
      return json(res, 200, {
        marketId,
        yes: snap.yesPrice,
        no: snap.noPrice,
        yesComplement: snap.noPrice != null ? 1 - snap.noPrice : null,
      });
    }

    if (req.method === "GET" && path.startsWith("/orders/user/")) {
      const user = decodeURIComponent(path.split("/orders/user/")[1]);
      const marketId = url.searchParams.get("marketId");
      const userOrders = [];
      for (const [id, order] of ordersById) {
        if (order.user === user && order.status === "open") {
          if (marketId != null && order.marketId !== Number(marketId)) continue;
          userOrders.push({ id, ...order });
        }
      }
      return json(res, 200, { orders: userOrders });
    }

    if (req.method === "GET" && path.startsWith("/rebates/")) {
      const addr = decodeURIComponent(path.split("/rebates/")[1]);
      const rebate = makerRebates.get(addr) || 0;
      return json(res, 200, { address: addr, rebate });
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    console.error("[http] Error:", e.message);
    json(res, e.status || 500, { error: e.message });
  }
});
async function main() {
  console.log("=== STACKY MATCHING ENGINE ===");
  console.log(`  Deployer: ${DEPLOYER}`);
  console.log(`  Network:  ${NETWORK}`);
  console.log(`  Port:     ${PORT}`);
  console.log("");

  loadState();

  await initNonce();

  try {
    const count = await callRead(TOKENS_CONTRACT, "get-market-count");
    const total = Number(count.value);
    const showCount = Math.min(total, 30);
    for (let i = total - showCount; i < total; i++) {
      try {
        const m = await callRead(TOKENS_CONTRACT, "get-market", [Cl.uint(i)]);
        const val = m.value?.value || m.value;
        if (val) managedMarkets.set(i, { id: i, ...val });
      } catch (_) {}
    }
    marketsCache.lastFetch = Date.now();
    console.log(`[registry] Loaded ${managedMarkets.size} markets from chain`);
  } catch (e) {
    console.log(`[registry] Failed to load markets: ${e.message}`);
  }

  server.listen(PORT, () => {
    console.log(`[engine] Listening on http://localhost:${PORT}`);
    console.log(`  POST   /order              -- place order (gtc/gtd/fok/fak)`);
    console.log(`  DELETE /order/:id          -- cancel order`);
    console.log(`  GET    /book/:marketId     -- order book`);
    console.log(`  GET    /trades             -- trade history`);
    console.log(`  GET    /markets            -- list markets`);
    console.log(`  GET    /prices/:id         -- current prices`);
    console.log(`  GET    /orders/user/:addr  -- user's open orders`);
    console.log(`  GET    /rebates/:addr      -- maker rebates`);
    console.log(`  POST   /market-created     -- keeper reports market creation`);
    console.log(`  GET    /market-times       -- market creation/resolution times`);
    console.log(`  GET    /status             -- engine status`);
    console.log(`  WS     ws://localhost:${PORT} -- real-time events`);
  });

  initWebSocket(server);

  setInterval(() => {
    for (const [marketId] of books) {
      filterExpiredOrders(marketId);
    }
  }, 5000);

  setInterval(async () => {
    const unsettled = trades.filter(t => t.settled === false && !t.retrying && (t.retryCount || 0) < 3);
    for (const trade of unsettled.slice(0, 2)) {
      trade.retrying = true;
      trade.retryCount = (trade.retryCount || 0) + 1;
      console.log(`[retry] Trade #${trade.id} attempt ${trade.retryCount}/3`);
      try {
        const result = await settleTrade(trade);
        if (!result.ok) {
          console.log(`[retry] Trade #${trade.id} failed: ${result.error}`);
          if (trade.retryCount >= 3) {
            console.log(`[retry] Trade #${trade.id} giving up after 3 attempts`);
          }
        }
      } catch (e) {
        console.log(`[retry] Trade #${trade.id} error: ${e.message}`);
      } finally {
        trade.retrying = false;
      }
    }
  }, 60000);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
