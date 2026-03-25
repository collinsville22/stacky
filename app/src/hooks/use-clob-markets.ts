"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Cl, cvToJSON } from "@stacks/transactions";
import { useWallet } from "./use-stacks-wallet";
import { useContractWrite } from "./use-contract-write";
import { callReadOnly } from "@/lib/stacks";
import { CONTRACT_NAMES, MATCHING_ENGINE_URL, ONE_8, DEPLOYER } from "@/lib/constants";

const TOKENS = CONTRACT_NAMES.OUTCOME_TOKENS;
const EXCHANGE = CONTRACT_NAMES.EXCHANGE;

export type Timeframe = "updown-5m" | "updown-15m" | "updown-30m" | "updown-1h";

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "updown-5m": "5m",
  "updown-15m": "15m",
  "updown-30m": "30m",
  "updown-1h": "1h",
};

export interface MarketData {
  id: number;
  creator: string;
  question: string;
  targetPrice: bigint;
  resolutionHeight: number;
  collateralLocked: bigint;
  resolved: boolean;
  outcome: boolean;
  cancelled: boolean;
  marketType: string;
  startPrice: bigint;
}

export interface OrderBookLevel {
  price: number;
  amount: number;
  orders: number;
}

export interface OrderBook {
  marketId: number;
  yes: { bids: OrderBookLevel[]; asks: OrderBookLevel[] };
  no: { bids: OrderBookLevel[]; asks: OrderBookLevel[] };
  yesPrice: number | null;
  noPrice: number | null;
}

export interface Trade {
  id: number;
  marketId: number;
  matchType: string;
  maker: string;
  taker: string;
  outcome: string;
  side: boolean;
  amount: number;
  price: number;
  timestamp: number;
  settled?: boolean;
  txid?: string;
}

export interface Order {
  id: number;
  marketId: number;
  user: string;
  side: string;
  outcome: string;
  amount: number;
  price: number;
  timestamp: number;
  status: string;
}

function parseMarket(id: number, cv: unknown): MarketData | null {
  const json = cv as { type: string; value?: { type: string; value: Record<string, unknown> } };
  if (json.type === "none") return null;
  const t = json.value?.value ?? json.value;
  if (!t || typeof t !== "object") return null;
  const tuple = t as Record<string, { type: string; value: unknown }>;
  return {
    id,
    creator: String(tuple["creator"]?.value ?? ""),
    question: String(tuple["question"]?.value ?? ""),
    targetPrice: BigInt(String(tuple["target-price"]?.value ?? "0")),
    resolutionHeight: Number(tuple["resolution-height"]?.value ?? 0),
    collateralLocked: BigInt(String(tuple["collateral-locked"]?.value ?? "0")),
    resolved: tuple["resolved"]?.value === true || tuple["resolved"]?.type === "true",
    outcome: tuple["outcome"]?.value === true || tuple["outcome"]?.type === "true",
    cancelled: tuple["cancelled"]?.value === true || tuple["cancelled"]?.type === "true",
    marketType: String(tuple["market-type"]?.value ?? ""),
    startPrice: BigInt(String(tuple["start-price"]?.value ?? "0")),
  };
}

async function engineFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${MATCHING_ENGINE_URL}${path}`, options);
  if (!res.ok) throw new Error(`Engine ${res.status}`);
  return res.json();
}

const WS_URL = MATCHING_ENGINE_URL.replace(/^http/, "ws");

export interface WSEvent {
  channel: string;
  event: string;
  data: any;
}

export function useEngineWebSocket(
  marketId: number | null,
  onEvent: (evt: WSEvent) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (marketId == null) return;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let alive = true;

    function connect() {
      if (!alive) return;
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: "subscribe", channel: `market:${marketId}` }));
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event) onEventRef.current(msg);
        } catch {}
      };

      ws.onclose = () => {
        if (alive) {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => ws.close();
    }

    connect();

    const pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      clearInterval(pingInterval);
      ws?.close();
      wsRef.current = null;
    };
  }, [marketId]);
}

export function useClobMarkets() {
  const { address } = useWallet();
  const { write, status, txId, error, reset } = useContractWrite();

  const [marketCount, setMarketCount] = useState(0);
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(false);

  const fetchMarkets = useCallback(async () => {
    setLoadingMarkets(true);
    try {
      const data = await engineFetch("/markets");
      if (data.markets && Array.isArray(data.markets)) {
        const results: MarketData[] = [];
        for (const m of data.markets) {
          const market = parseMarket(m.id, { type: "some", value: { type: "tuple", value: m } });
          if (market) results.push(market);
        }
        setMarkets(results);
        setMarketCount(data.total || results.length);
        return;
      }
    } catch {
    }

    try {
      const cv = await callReadOnly(TOKENS, "get-market-count", []);
      const countJson = cvToJSON(cv) as { type: string; value: string };
      const count = Number(countJson.value || "0");
      setMarketCount(count);
      if (count === 0) { setMarkets([]); return; }

      const results: MarketData[] = [];
      for (let i = 0; i < count; i++) {
        const mcv = await callReadOnly(TOKENS, "get-market", [Cl.uint(i)]);
        const market = parseMarket(i, cvToJSON(mcv));
        if (market) results.push(market);
      }
      setMarkets(results);
    } catch {
    } finally {
      setLoadingMarkets(false);
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
    const id = setInterval(fetchMarkets, 2_000);
    return () => clearInterval(id);
  }, [fetchMarkets]);

  const refetchCount = fetchMarkets;

  const fetchOrderBook = useCallback(async (marketId: number): Promise<OrderBook | null> => {
    try {
      return await engineFetch(`/book/${marketId}`);
    } catch {
      return null;
    }
  }, []);

  const placeOrder = useCallback(async (
    marketId: number,
    side: "buy" | "sell",
    outcome: "yes" | "no",
    amount: number,
    price: number,
    type: "gtc" | "gtd" | "fok" | "fak" = "gtc",
  ) => {
    if (!address) throw new Error("Wallet not connected");
    return engineFetch("/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketId, user: address, side, outcome, amount, price, type }),
    });
  }, [address]);

  const cancelOrder = useCallback(async (orderId: number) => {
    return engineFetch(`/order/${orderId}`, { method: "DELETE" });
  }, []);

  const fetchTrades = useCallback(async (marketId?: number): Promise<Trade[]> => {
    try {
      const params = marketId != null ? `?marketId=${marketId}` : "";
      const data = await engineFetch(`/trades${params}`);
      return data.trades || [];
    } catch {
      return [];
    }
  }, []);

  const fetchUserOrders = useCallback(async (marketId?: number): Promise<Order[]> => {
    if (!address) return [];
    try {
      const params = marketId != null ? `?marketId=${marketId}` : "";
      const data = await engineFetch(`/orders/user/${encodeURIComponent(address)}${params}`);
      return data.orders || [];
    } catch {
      return [];
    }
  }, [address]);

  const depositSbtc = useCallback(async (amount: bigint) => {
    return write(EXCHANGE, "deposit-sbtc", [Cl.uint(amount)]);
  }, [write]);

  const withdrawSbtc = useCallback(async (amount: bigint) => {
    return write(EXCHANGE, "withdraw-sbtc", [Cl.uint(amount)]);
  }, [write]);

  const approveExchange = useCallback(async () => {
    const exchangePrincipal = `${DEPLOYER}.${EXCHANGE}`;
    return write(TOKENS, "set-approved-operator", [
      Cl.principal(exchangePrincipal),
      Cl.bool(true),
    ]);
  }, [write]);

  const depositTokens = useCallback(async (tokenId: number, amount: bigint) => {
    return write(EXCHANGE, "deposit-tokens", [Cl.uint(tokenId), Cl.uint(amount)]);
  }, [write]);

  const withdrawTokens = useCallback(async (tokenId: number, amount: bigint) => {
    return write(EXCHANGE, "withdraw-tokens", [Cl.uint(tokenId), Cl.uint(amount)]);
  }, [write]);

  const splitCollateral = useCallback(async (marketId: number, amount: bigint) => {
    return write(TOKENS, "split-collateral", [Cl.uint(marketId), Cl.uint(amount)]);
  }, [write]);

  const mergeTokens = useCallback(async (marketId: number, amount: bigint) => {
    return write(TOKENS, "merge-tokens", [Cl.uint(marketId), Cl.uint(amount)]);
  }, [write]);

  const redeem = useCallback(async (marketId: number) => {
    return write(TOKENS, "redeem", [Cl.uint(marketId)]);
  }, [write]);

  const fetchTokenBalance = useCallback(async (tokenId: number): Promise<bigint> => {
    if (!address) return BigInt(0);
    try {
      const cv = await callReadOnly(TOKENS, "get-balance", [Cl.uint(tokenId), Cl.principal(address)]);
      const json = cvToJSON(cv) as { type: string; value: string };
      return BigInt(json.value || "0");
    } catch {
      return BigInt(0);
    }
  }, [address]);

  const fetchEscrowBalance = useCallback(async (): Promise<bigint> => {
    if (!address) return BigInt(0);
    try {
      const cv = await callReadOnly(EXCHANGE, "get-sbtc-escrow", [Cl.principal(address)]);
      const json = cvToJSON(cv) as { type: string; value: string };
      return BigInt(json.value || "0");
    } catch {
      return BigInt(0);
    }
  }, [address]);

  const fetchTokenEscrow = useCallback(async (tokenId: number): Promise<bigint> => {
    if (!address) return BigInt(0);
    try {
      const cv = await callReadOnly(EXCHANGE, "get-token-escrow", [Cl.uint(tokenId), Cl.principal(address)]);
      const json = cvToJSON(cv) as { type: string; value: string };
      return BigInt(json.value || "0");
    } catch {
      return BigInt(0);
    }
  }, [address]);

  const fetchPrices = useCallback(async (marketId: number) => {
    try {
      return await engineFetch(`/prices/${marketId}`);
    } catch {
      return { yes: null, no: null };
    }
  }, []);

  const refetchAll = useCallback(() => {
    refetchCount();
    fetchMarkets();
  }, [refetchCount, fetchMarkets]);

  return {
    markets,
    marketCount: marketCount ? Number(marketCount) : 0,
    loadingMarkets,
    refetchAll,

    fetchOrderBook,
    placeOrder,
    cancelOrder,
    fetchTrades,
    fetchPrices,
    fetchUserOrders,

    depositSbtc,
    withdrawSbtc,
    approveExchange,
    depositTokens,
    withdrawTokens,
    splitCollateral,
    mergeTokens,
    redeem,

    fetchTokenBalance,
    fetchEscrowBalance,
    fetchTokenEscrow,

    status,
    txId,
    error,
    reset,
  };
}
