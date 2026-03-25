"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { clsx } from "clsx";
import { GradientButton } from "@/components/ui/gradient-button";
import { TxStatus } from "@/components/ui/tx-status";
import { PriceChart } from "@/components/ui/price-chart";
import {
  useClobMarkets,
  useEngineWebSocket,
  MarketData,
  OrderBook,
  OrderBookLevel,
  Trade,
  Order,
  Timeframe,
  TIMEFRAME_LABELS,
  WSEvent,
} from "@/hooks/use-clob-markets";
import { useBtcPrice } from "@/hooks/use-btc-price";
import { useWallet } from "@/hooks/use-stacks-wallet";
import { useContractWrite } from "@/hooks/use-contract-write";
import { ONE_8, NETWORK, MATCHING_ENGINE_URL } from "@/lib/constants";

type Side = "yes" | "no";
type TradeMode = "buy" | "sell";
type OrderType = "limit" | "market";
type ActivityTab = "order-book" | "trades" | "my-orders" | "how-it-works";
type ChartMode = "btc" | "share";

const TIMEFRAMES: Timeframe[] = ["updown-5m", "updown-15m", "updown-30m", "updown-1h"];

const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "updown-5m": 5,
  "updown-15m": 15,
  "updown-30m": 30,
  "updown-1h": 60,
};

const FAQ_ITEMS = [
  {
    q: "What is BTC Up or Down?",
    a: "A binary prediction market where you bet whether BTC will be higher or lower than the starting price when the timeframe ends. Buy UP shares if you think BTC will rise, DOWN shares if you think it'll fall.",
  },
  {
    q: "How does the order book work?",
    a: "Like Polymarket: place limit orders at any price between $0.01 and $0.99. Orders are matched off-chain and settled on-chain. Three match types: Complementary (buy meets sell), Mint (two buyers create new tokens), Merge (two sellers burn tokens).",
  },
  {
    q: "How are markets resolved?",
    a: "When the timer reaches zero, the keeper bot fetches the current BTC price from Binance and compares it to the starting price. If BTC is higher → UP wins. If lower → DOWN wins. Winning shares redeem for 1 sBTC each.",
  },
  {
    q: "What do the share prices mean?",
    a: "Share prices reflect the market's probability estimate. UP at $0.65 means the market thinks there's a 65% chance BTC will be higher. Share prices move based on BTC price changes and time remaining.",
  },
  {
    q: "What are the fees?",
    a: "Dynamic fees like Polymarket: max ~1.56% at 50/50, drops to ~0.2% at 90/10, near-zero at extremes. No fees on deposits, withdrawals, splits, or merges.",
  },
];

function truncateAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return addr.slice(0, 6) + "..." + addr.slice(-5);
}

function formatSbtc(sats: bigint): string {
  const num = Number(sats) / ONE_8;
  if (num === 0) return "0";
  if (num < 0.001) return num.toFixed(8);
  if (num < 1) return num.toFixed(4);
  return num.toFixed(4);
}

function formatUsd(n: number): string {
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPrice8(price8dec: bigint): string {
  return formatUsd(Number(price8dec) / ONE_8);
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
function CountdownTimer({ endTime }: { endTime: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const diff = Math.max(0, endTime - now);
  if (diff === 0) {
    return (
      <span className="text-loss font-mono font-bold text-lg animate-pulse">
        Resolving...
      </span>
    );
  }

  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const tenths = Math.floor((diff % 1000) / 100);

  return (
    <div className="flex items-baseline gap-0.5">
      <span className="font-mono font-bold text-xl tabular-nums text-fg">
        {String(mins).padStart(2, "0")}
      </span>
      <span className="font-mono font-bold text-xl text-fg-3 animate-pulse">:</span>
      <span className="font-mono font-bold text-xl tabular-nums text-fg">
        {String(secs).padStart(2, "0")}
      </span>
      <span className="font-mono text-sm text-fg-4 ml-0.5">.{tenths}</span>
    </div>
  );
}
function OrderBookPanel({ book, yesSpread }: { book: { bids: OrderBookLevel[]; asks: OrderBookLevel[] } | null; yesSpread?: number | null }) {
  if (!book) return <p className="text-[12px] text-fg-4 py-4 text-center">No orders yet</p>;

  const bids = book.bids.slice(0, 8);
  const asks = book.asks.slice(0, 8);
  const maxAmount = Math.max(
    ...bids.map((l) => l.amount),
    ...asks.map((l) => l.amount),
    1
  );

  const spread = yesSpread != null ? yesSpread : (
    asks.length > 0 && bids.length > 0
      ? Math.abs(asks[0].price - bids[0].price) / ONE_8
      : null
  );

  return (
    <div className="text-[12px] font-mono">
      <div className="flex justify-between text-[10px] text-fg-4 uppercase tracking-wider mb-1 px-1">
        <span>Price</span>
        <span>Amount</span>
      </div>
      {/* Asks (sells) - reversed so lowest ask is at bottom */}
      {asks.length > 0 ? (
        [...asks].reverse().map((level, i) => (
          <div key={level.price} className="relative flex justify-between py-0.5 px-1">
            <div
              className="absolute inset-0 bg-loss opacity-[0.07]"
              style={{ width: `${(level.amount / maxAmount) * 100}%`, right: 0, left: "auto" }}
            />
            <span className="text-loss relative z-10">${(level.price / ONE_8).toFixed(2)}</span>
            <span className="text-fg-2 relative z-10">{(level.amount / ONE_8).toFixed(4)}</span>
          </div>
        ))
      ) : (
        <p className="text-fg-4 text-center py-1">No asks</p>
      )}
      {/* Spread */}
      <div className="text-center text-[10px] text-fg-4 py-1 border-y border-line my-0.5">
        {spread != null ? `Spread: $${spread.toFixed(2)}` : "—"}
      </div>
      {/* Bids (buys) */}
      {bids.length > 0 ? (
        bids.map((level, i) => (
          <div key={level.price} className="relative flex justify-between py-0.5 px-1">
            <div
              className="absolute inset-0 bg-gain opacity-[0.07]"
              style={{ width: `${(level.amount / maxAmount) * 100}%`, right: 0, left: "auto" }}
            />
            <span className="text-gain relative z-10">${(level.price / ONE_8).toFixed(2)}</span>
            <span className="text-fg-2 relative z-10">{(level.amount / ONE_8).toFixed(4)}</span>
          </div>
        ))
      ) : (
        <p className="text-fg-4 text-center py-1">No bids</p>
      )}
    </div>
  );
}
function TradesList({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) return <p className="text-[12px] text-fg-4 py-4 text-center">No trades yet</p>;

  return (
    <div className="space-y-0">
      <div className="flex text-[10px] text-fg-4 uppercase tracking-wider mb-1 px-1">
        <span className="w-16">Time</span>
        <span className="flex-1">Type</span>
        <span className="w-20 text-right">Price</span>
        <span className="w-24 text-right">Amount</span>
      </div>
      {trades.slice(0, 20).map((t) => (
        <div key={t.id} className="flex items-center py-1.5 border-b border-line text-[12px] font-mono px-1">
          <span className="w-16 text-fg-3 shrink-0">{formatTimeAgo(t.timestamp)}</span>
          <span className={clsx(
            "flex-1 text-[10px] uppercase font-bold",
            t.matchType === "complementary" ? "text-fg-2" :
            t.matchType === "mint" ? "text-gain" : "text-copper"
          )}>
            {t.matchType}
          </span>
          <span className="w-20 text-right text-fg">${(t.price / ONE_8).toFixed(2)}</span>
          <span className="w-24 text-right text-fg-2">{(t.amount / ONE_8).toFixed(4)}</span>
        </div>
      ))}
    </div>
  );
}
function ResultsTimeline({ markets }: { markets: MarketData[] }) {
  if (markets.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1">
      {markets.slice(0, 20).map((m) => {
        const isUp = m.outcome;
        const isCancelled = m.cancelled;
        return (
          <div
            key={m.id}
            title={`#${m.id}: ${isCancelled ? "Cancelled" : isUp ? "UP" : "DOWN"}`}
            className={clsx(
              "w-3 h-3 rounded-full shrink-0 transition-transform hover:scale-150 cursor-default",
              isCancelled ? "bg-text-4" : isUp ? "bg-gain" : "bg-loss"
            )}
          />
        );
      })}
    </div>
  );
}
export default function MarketsPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>("updown-5m");
  const [side, setSide] = useState<Side>("yes");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [tradeMode, setTradeMode] = useState<TradeMode>("buy");
  const [activityTab, setActivityTab] = useState<ActivityTab>("order-book");
  const [chartMode, setChartMode] = useState<ChartMode>("btc");
  const [orderType, setOrderType] = useState<OrderType>("limit");
  const [userOrders, setUserOrders] = useState<Order[]>([]);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showShareToast, setShowShareToast] = useState(false);
  const shareToastRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [escrowBalance, setEscrowBalance] = useState<bigint>(BigInt(0));
  const [depositAmount, setDepositAmount] = useState("");
  const [showEscrow, setShowEscrow] = useState(false);
  const [sharePriceHistory, setSharePriceHistory] = useState<{ time: number; price: number }[]>([]);
  const [btcPriceHistory, setBtcPriceHistory] = useState<{ time: number; price: number }[]>([]);
  const [globalBtcHistory, setGlobalBtcHistory] = useState<{ time: number; price: number }[]>([]);

  const { connected, address } = useWallet();
  const isTestnet = NETWORK === "testnet";
  const faucet = useContractWrite();
  const { price: btcPrice, change24h } = useBtcPrice();
  const {
    markets, marketCount, loadingMarkets,
    fetchOrderBook, placeOrder, cancelOrder, fetchTrades, fetchPrices, fetchUserOrders,
    depositSbtc, withdrawSbtc, splitCollateral, mergeTokens, redeem,
    fetchEscrowBalance,
    refetchAll, status, txId, error, reset,
  } = useClobMarkets();

  useEffect(() => {
    try {
      if (localStorage.getItem("btc-bets-favorited") === "true") setIsFavorited(true);
    } catch {}
  }, []);

  const toggleFavorite = useCallback(() => {
    setIsFavorited((prev) => {
      const next = !prev;
      try { localStorage.setItem("btc-bets-favorited", String(next)); } catch {}
      return next;
    });
  }, []);

  const handleShare = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      clearTimeout(shareToastRef.current!);
      setShowShareToast(true);
      shareToastRef.current = setTimeout(() => setShowShareToast(false), 2000);
    }).catch(() => {
      clearTimeout(shareToastRef.current!);
      setShowShareToast(true);
      shareToastRef.current = setTimeout(() => setShowShareToast(false), 2000);
    });
  }, []);

  const filteredMarkets = useMemo(
    () => markets.filter((m) => m.marketType === timeframe && m.id < 100),
    [markets, timeframe]
  );

  const activeMarket = useMemo(
    () => {
      const unresolved = filteredMarkets.filter((m) => !m.resolved && !m.cancelled);
      return unresolved.length > 0 ? unresolved[unresolved.length - 1] : null;
    },
    [filteredMarkets]
  );

  const resolvedMarkets = useMemo(
    () => filteredMarkets.filter((m) => (m.resolved || m.cancelled) && m.id < 100).sort((a, b) => b.id - a.id).slice(0, 10),
    [filteredMarkets]
  );

  useEffect(() => {
    setOrderBook(null);
    setRecentTrades([]);
    setUserOrders([]);
    setSharePriceHistory([]);
    setBtcPriceHistory([]);
    setAmount("");
    setPrice("");
  }, [activeMarket?.id]);

  const tfMinutes = TIMEFRAME_MINUTES[timeframe];

  useEffect(() => {
    const fetchGlobalBtc = async () => {
      try {
        const limit = Math.max(tfMinutes, 10);
        const res = await fetch(
          `https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=${limit}`
        );
        const data = await res.json();
        if (Array.isArray(data)) {
          setGlobalBtcHistory(data.map((k: unknown[]) => ({
            time: k[0] as number,
            price: parseFloat(k[4] as string), // close price
          })));
        }
      } catch {}
    };
    fetchGlobalBtc();
    const id = setInterval(fetchGlobalBtc, 5_000);
    return () => clearInterval(id);
  }, [tfMinutes]);

  useEffect(() => {
    if (!activeMarket) return;
    const load = async () => {
      const book = await fetchOrderBook(activeMarket.id);
      if (book) setOrderBook(book);
      const trades = await fetchTrades(activeMarket.id);
      setRecentTrades(trades);
      try {
        const res = await fetch(`${MATCHING_ENGINE_URL}/price-history/${activeMarket.id}?bucket=5000`);
        const data = await res.json();
        if (data.points) setSharePriceHistory(data.points);
      } catch {}
      try {
        const res = await fetch(`${MATCHING_ENGINE_URL}/btc-history/${activeMarket.id}`);
        const data = await res.json();
        if (data.points) setBtcPriceHistory(data.points);
      } catch {}
    };
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [activeMarket, fetchOrderBook, fetchTrades]);

  const handleWSEvent = useCallback((evt: WSEvent) => {
    if (evt.event === "book" && evt.data) {
      setOrderBook(evt.data);
    } else if (evt.event === "trade" && evt.data) {
      setRecentTrades(prev => [evt.data, ...prev].slice(0, 50));
    }
  }, []);
  useEngineWebSocket(activeMarket?.id ?? null, handleWSEvent);

  useEffect(() => {
    if (!connected || !activeMarket) { setUserOrders([]); return; }
    const load = async () => {
      const orders = await fetchUserOrders(activeMarket.id);
      setUserOrders(orders);
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [connected, activeMarket, fetchUserOrders]);

  useEffect(() => {
    if (!connected) return;
    fetchEscrowBalance().then(setEscrowBalance).catch(() => {});
  }, [connected, fetchEscrowBalance, status]);

  useEffect(() => {
    if (status === "success") {
      const t = setTimeout(() => { refetchAll(); fetchEscrowBalance().then(setEscrowBalance).catch(() => {}); }, 3000);
      return () => clearTimeout(t);
    }
  }, [status, refetchAll, fetchEscrowBalance]);

  const durationMs = tfMinutes * 60 * 1000;
  const now = Date.now();
  const sessionStart = Math.floor(now / durationMs) * durationMs;
  const sessionEnd = sessionStart + durationMs;

  const sessionStartTime = new Date(sessionStart);
  const sessionEndTime = new Date(sessionEnd);
  const sessionLabel = `${sessionStartTime.getHours().toString().padStart(2, "0")}:${sessionStartTime.getMinutes().toString().padStart(2, "0")} → ${sessionEndTime.getHours().toString().padStart(2, "0")}:${sessionEndTime.getMinutes().toString().padStart(2, "0")}`;

  const marketEndTime = sessionEnd;

  const spendNum = parseFloat(amount) || 0; // sBTC the user wants to spend
  const priceNum = parseFloat(price) || 0;
  const effectivePrice = orderType === "market"
    ? (tradeMode === "buy" ? 0.99 : 0.01)
    : priceNum;
  const sharesNum = effectivePrice > 0 ? spendNum / effectivePrice : 0;
  const estimatedCost = spendNum;
  const potentialPayout = sharesNum; // each winning share redeems for 1 sBTC

  const startPriceUsd = activeMarket ? Number(activeMarket.startPrice) / ONE_8 : 0;

  const yesPrice = orderBook?.yesPrice ?? null;
  const noPrice = orderBook?.noPrice ?? null;
  const yesPct = yesPrice !== null ? yesPrice * 100 : 50;
  const noPct = noPrice !== null ? noPrice * 100 : 50;
  const yesPriceDisplay = yesPrice !== null ? yesPrice : 0.50;
  const noPriceDisplay = noPrice !== null ? noPrice : 0.50;

  const chartData = chartMode === "share"
    ? sharePriceHistory
    : (btcPriceHistory.length > 1 ? btcPriceHistory : globalBtcHistory);
  const chartRefLine = chartMode === "share"
    ? 0.50
    : (startPriceUsd > 0 ? startPriceUsd : undefined);
  const chartRefLabel = chartMode === "share" ? "50/50" : "PRICE TO BEAT";

  const btcAboveStart = btcPrice > 0 && startPriceUsd > 0 && btcPrice >= startPriceUsd;
  const handlePlaceOrder = async () => {
    if (!activeMarket || spendNum <= 0 || sharesNum <= 0) return;
    const isMarket = orderType === "market";
    const finalPrice = isMarket
      ? (tradeMode === "buy" ? 0.99 : 0.01)
      : priceNum;
    if (finalPrice <= 0 || finalPrice >= 1) return;
    try {
      await placeOrder(
        activeMarket.id,
        tradeMode,
        side,
        Math.floor(sharesNum * ONE_8),
        Math.floor(finalPrice * ONE_8),
        isMarket ? "fok" : "gtc",
      );
      setAmount("");
      const book = await fetchOrderBook(activeMarket.id);
      if (book) setOrderBook(book);
      const trades = await fetchTrades(activeMarket.id);
      setRecentTrades(trades);
      if (connected) fetchUserOrders(activeMarket.id).then(setUserOrders);
    } catch (e) {
      console.error("Order failed:", e);
    }
  };

  const handleCancelOrder = async (orderId: number) => {
    try {
      await cancelOrder(orderId);
      if (activeMarket) {
        const book = await fetchOrderBook(activeMarket.id);
        if (book) setOrderBook(book);
        fetchUserOrders(activeMarket.id).then(setUserOrders);
      }
    } catch (e) {
      console.error("Cancel failed:", e);
    }
  };

  const handleDeposit = async () => {
    const amt = parseFloat(depositAmount);
    if (amt <= 0) return;
    await depositSbtc(BigInt(Math.floor(amt * ONE_8)));
    setDepositAmount("");
  };

  const handleWithdraw = async () => {
    const amt = parseFloat(depositAmount);
    if (amt <= 0) return;
    await withdrawSbtc(BigInt(Math.floor(amt * ONE_8)));
    setDepositAmount("");
  };

  const handleRedeem = async (market: MarketData) => {
    await redeem(market.id);
  };

  const handleFaucetMint = async () => {
    if (!address) return;
    const { Cl } = await import("@stacks/transactions");
    await faucet.write("sbtc-token", "mint-for-testing", [
      Cl.uint(BigInt(100000000)),
      Cl.principal(address),
    ]);
  };

  return (
    <div className="max-w-[1400px] mx-auto px-6 pb-20 relative">
      {/* Share toast */}
      {showShareToast && (
        <div className="fixed top-6 right-6 z-50 bg-raised-2 text-fg px-4 py-2.5 text-[13px] font-mono animate-enter">
          Link copied to clipboard
        </div>
      )}

      {/* Header — Polymarket style with prominent title + BTC price */}
      <div className="pt-10 pb-5 border-b border-line animate-enter">
        <div className="flex items-center gap-2 mb-3">
          <p className="text-[10px] font-mono text-loss tracking-widest uppercase">
            BTC Prediction Markets
          </p>
          <div className="flex items-center gap-1.5 ml-auto">
            <button onClick={handleShare} className="p-1.5 text-fg-3 hover:text-fg transition-colors cursor-pointer" title="Share">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8v5a1 1 0 001 1h6a1 1 0 001-1V8" /><polyline points="11 4 8 1 5 4" /><line x1="8" y1="1" x2="8" y2="10" />
              </svg>
            </button>
            <button onClick={toggleFavorite} className={clsx("p-1.5 transition-colors cursor-pointer", isFavorited ? "text-loss" : "text-fg-3 hover:text-fg")} title="Favorite">
              <svg width="16" height="16" viewBox="0 0 16 16" fill={isFavorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 2.5l1.5 3 3.5.5-2.5 2.5.5 3.5L8 10.5 4.5 12l.5-3.5L2.5 6l3.5-.5z" />
              </svg>
            </button>
          </div>
        </div>

        <h1 className="text-[clamp(1.8rem,4vw,2.5rem)] font-serif font-bold tracking-tight text-fg mb-1">
          BTC Up or Down?
        </h1>

        {/* Live BTC Price — prominent */}
        <div className="flex items-baseline gap-3">
          <span className="text-[clamp(1.4rem,3vw,2rem)] font-serif font-bold text-fg tracking-tight">
            {btcPrice > 0 ? formatUsd(btcPrice) : "..."}
          </span>
          {change24h !== 0 && (
            <span className={clsx("text-[13px] font-mono font-bold", change24h >= 0 ? "text-gain" : "text-loss")}>
              {change24h >= 0 ? "+" : ""}{change24h.toFixed(2)}%
              <span className="text-[10px] text-fg-3 ml-1">24h</span>
            </span>
          )}
        </div>
      </div>

      {/* Timeframe Tabs — like Polymarket's 5 Min / 15 Min / 1 Hour */}
      <div className="flex border-b border-line animate-enter" style={{ animationDelay: "0.03s" }}>
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => { setTimeframe(tf); reset(); }}
            className={clsx(
              "px-5 py-3 text-[13px] font-bold uppercase tracking-wide transition-colors cursor-pointer",
              timeframe === tf ? "text-fg border-b border-copper -mb-[2px]" : "text-fg-3 hover:text-fg-2"
            )}
          >
            {TIMEFRAME_LABELS[tf]}
          </button>
        ))}
      </div>

      {/* Session Info + Price to Beat + Countdown + Past Results Timeline */}
      <div className="py-4 border-b border-line animate-enter" style={{ animationDelay: "0.04s" }}>
        {/* Session time bar */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-fg-4 uppercase tracking-wider">Session</span>
            <span className="text-[13px] font-mono font-bold text-fg tabular-nums">{sessionLabel}</span>
          </div>
          <span className="text-[10px] font-mono text-fg-4 uppercase tracking-wider">{TIMEFRAME_LABELS[timeframe]} Market</span>
        </div>

        {activeMarket && (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Price to Beat */}
            <div>
              <p className="text-[10px] font-mono text-fg-4 uppercase tracking-wider mb-1">Price to Beat</p>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-serif font-bold text-fg">{formatPrice8(activeMarket.startPrice)}</span>
                {btcPrice > 0 && (
                  <span className={clsx(
                    "text-[13px] font-mono font-bold",
                    btcAboveStart ? "text-gain" : "text-loss"
                  )}>
                    {btcAboveStart ? "▲ UP" : "▼ DOWN"}
                    <span className="text-fg-3 font-normal ml-1">
                      ({btcAboveStart ? "+" : ""}{startPriceUsd === 0 ? "0.000" : ((btcPrice - startPriceUsd) / startPriceUsd * 100).toFixed(3)}%)
                    </span>
                  </span>
                )}
              </div>
            </div>

            {/* Countdown */}
            <div className="text-right">
              <p className="text-[10px] font-mono text-fg-4 uppercase tracking-wider mb-1">Resolves in</p>
              <CountdownTimer endTime={marketEndTime} />
            </div>
          </div>
        )}

        {!activeMarket && (
          <div className="flex items-center justify-between gap-4">
            <p className="text-[13px] text-fg-3">Waiting for next session...</p>
            <div className="text-right">
              <p className="text-[10px] font-mono text-fg-4 uppercase tracking-wider mb-1">Next session in</p>
              <CountdownTimer endTime={marketEndTime} />
            </div>
          </div>
        )}

        {/* Past results timeline (green/red dots) */}
        {resolvedMarkets.length > 0 && (
          <div className="mt-3 pt-3 border-t border-line">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-mono text-fg-4 uppercase tracking-wider shrink-0">Recent</p>
              <ResultsTimeline markets={resolvedMarkets} />
            </div>
          </div>
        )}
      </div>

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
        {/* Left: Chart + Activity */}
        <div className="lg:col-span-3 lg:pr-10 lg:border-r lg:border-line">

          {/* Chart — BTC price (primary) or Share price (toggle) */}
          <div className="py-6 border-b border-line animate-enter" style={{ animationDelay: "0.05s" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {(["btc", "share"] as ChartMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setChartMode(mode)}
                    className={clsx("px-3 py-1 text-[11px] font-mono uppercase tracking-wider border transition-colors cursor-pointer",
                      chartMode === mode
                        ? "border-line text-fg bg-raised font-bold"
                        : "border-line text-fg-3 hover:text-fg-2"
                    )}
                  >
                    {mode === "btc" ? "BTC Price" : "Share Price"}
                  </button>
                ))}
              </div>
              {chartMode === "btc" && btcPrice > 0 && (
                <span className={clsx("text-[14px] font-mono font-bold",
                  btcAboveStart ? "text-gain" : "text-loss"
                )}>
                  {formatUsd(btcPrice)}
                </span>
              )}
            </div>

            <PriceChart
              data={chartData}
              mode={chartMode}
              refLine={chartRefLine}
              refLineLabel={chartRefLabel}
            />
          </div>

          {/* UP/DOWN share prices bar */}
          {activeMarket && (
            <div className="py-5 border-b border-line animate-enter" style={{ animationDelay: "0.07s" }}>
              <div className="flex justify-between text-[12px] font-mono mb-2">
                <span className="text-gain font-bold flex items-center gap-1.5">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 12V4M4 7l4-4 4 4" />
                  </svg>
                  UP {(yesPct).toFixed(0)}% &middot; ${yesPriceDisplay.toFixed(2)}
                </span>
                <span className="text-loss font-bold flex items-center gap-1.5">
                  ${noPriceDisplay.toFixed(2)} &middot; {(noPct).toFixed(0)}% DOWN
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 4v8M4 9l4 4 4-4" />
                  </svg>
                </span>
              </div>
              <div className="flex h-3 overflow-hidden bg-line">
                <div className="bg-gain transition-all duration-500" style={{ width: `${yesPct}%` }} />
                <div className="bg-loss transition-all duration-500" style={{ width: `${noPct}%` }} />
              </div>
            </div>
          )}

          {!activeMarket && !loadingMarkets && (
            <div className="py-10 text-center animate-enter" style={{ animationDelay: "0.1s" }}>
              <p className="text-fg-3 text-[14px]">No active market for {TIMEFRAME_LABELS[timeframe]} right now.</p>
              <p className="text-fg-4 text-[12px] mt-1">Check back soon or try another timeframe.</p>
            </div>
          )}

          {loadingMarkets && markets.length === 0 && (
            <div className="py-10 text-center animate-enter"><p className="text-fg-3 text-[13px]">Loading markets...</p></div>
          )}

          {/* Order Book / Trades / How It Works tabs */}
          {activeMarket && (
            <div className="py-6 border-b border-line animate-enter" style={{ animationDelay: "0.09s" }}>
              <div className="flex border-b border-line mb-4">
                {([
                  { key: "order-book" as ActivityTab, label: "Order Book" },
                  { key: "trades" as ActivityTab, label: "Trades" },
                  ...(connected ? [{ key: "my-orders" as ActivityTab, label: "My Orders" }] : []),
                  { key: "how-it-works" as ActivityTab, label: "How It Works" },
                ]).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActivityTab(tab.key)}
                    className={clsx("px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide transition-colors cursor-pointer",
                      activityTab === tab.key ? "text-fg border-b border-copper -mb-[2px]" : "text-fg-3 hover:text-fg-2"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activityTab === "order-book" && (() => {
                const yesAsks = orderBook?.yes?.asks ?? [];
                const yesBids = orderBook?.yes?.bids ?? [];
                const yesSpread = yesAsks.length > 0 && yesBids.length > 0
                  ? Math.abs(yesAsks[0].price - yesBids[0].price) / ONE_8
                  : null;
                return (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-mono text-gain uppercase tracking-wider mb-2 font-bold">UP</p>
                      <OrderBookPanel book={orderBook?.yes ?? null} yesSpread={yesSpread} />
                    </div>
                    <div>
                      <p className="text-[10px] font-mono text-loss uppercase tracking-wider mb-2 font-bold">DOWN</p>
                      <OrderBookPanel book={orderBook?.no ?? null} yesSpread={yesSpread} />
                    </div>
                  </div>
                );
              })()}

              {activityTab === "trades" && <TradesList trades={recentTrades} />}

              {activityTab === "my-orders" && (
                <div>
                  {userOrders.length === 0 ? (
                    <p className="text-fg-3 text-[13px] py-4 text-center">No open orders</p>
                  ) : (
                    <table className="w-full text-[12px] font-mono">
                      <thead>
                        <tr className="text-fg-3 border-b border-line">
                          <th className="text-left py-2">Side</th>
                          <th className="text-left py-2">Token</th>
                          <th className="text-right py-2">Price</th>
                          <th className="text-right py-2">Amount</th>
                          <th className="text-right py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {userOrders.map((o) => (
                          <tr key={o.id} className="border-b border-line hover:bg-raised-hover">
                            <td className={clsx("py-2", o.side === "buy" ? "text-gain" : "text-loss")}>
                              {o.side.toUpperCase()}
                            </td>
                            <td className="py-2">{o.outcome === "yes" ? "UP" : "DOWN"}</td>
                            <td className="py-2 text-right">${(o.price / ONE_8).toFixed(2)}</td>
                            <td className="py-2 text-right">{(o.amount / ONE_8).toFixed(4)}</td>
                            <td className="py-2 text-right">
                              <button
                                onClick={() => handleCancelOrder(o.id)}
                                className="text-loss hover:text-fg text-[10px] uppercase tracking-wider cursor-pointer"
                              >
                                Cancel
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {activityTab === "how-it-works" && (
                <ol className="space-y-2">
                  {[
                    "Deposit sBTC into the exchange escrow.",
                    "Choose UP or DOWN — set your limit price ($0.01–$0.99).",
                    "Orders are matched off-chain: Complementary, Mint, or Merge.",
                    "Settlements happen on-chain via the exchange contract.",
                    "When timer hits zero, winning shares redeem for 1 sBTC each.",
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3 items-baseline">
                      <span className="text-[11px] font-mono text-loss shrink-0">{String(i + 1).padStart(2, "0")}</span>
                      <p className="text-[12px] text-fg-2 leading-relaxed">{step}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Recent Results (detailed list) */}
          {resolvedMarkets.length > 0 && (
            <div className="py-6 animate-enter" style={{ animationDelay: "0.11s" }}>
              <h3 className="text-[13px] font-bold text-fg uppercase tracking-wide mb-4">Recent Results</h3>
              <div className="space-y-0">
                {resolvedMarkets.slice(0, 10).map((m) => {
                  const outcomeLabel = m.cancelled ? "CANCELLED" : m.outcome ? "UP" : "DOWN";
                  return (
                    <div key={m.id} className="flex items-center py-3 border-b border-line gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[11px] font-mono text-fg-3">#{m.id}</span>
                          <span className={clsx("text-[10px] font-mono px-1.5 py-0.5 font-bold",
                            m.cancelled ? "text-fg-3 bg-raised" : m.outcome ? "text-gain gain-dim" : "text-loss loss-dim"
                          )}>
                            {outcomeLabel}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] font-mono">
                          <span className="text-fg-3">Strike: </span>
                          <span className="text-fg-2">{formatPrice8(m.startPrice)}</span>
                        </div>
                      </div>
                      {m.resolved && !m.cancelled && connected && (
                        <button
                          onClick={() => handleRedeem(m)}
                          disabled={status === "pending"}
                          className="text-[11px] px-3 py-1.5 cursor-pointer transition-colors shrink-0 border border-copper text-copper hover:bg-copper/10"
                        >
                          Redeem
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* FAQ */}
          <div className="py-6 border-t border-line animate-enter" style={{ animationDelay: "0.15s" }}>
            <h3 className="text-[13px] font-bold text-fg uppercase tracking-wide mb-4">FAQ</h3>
            <div className="space-y-0">
              {FAQ_ITEMS.map((faq, i) => (
                <div key={i} className="border-b border-line">
                  <button
                    onClick={() => setOpenFaqIdx(openFaqIdx === i ? null : i)}
                    className="w-full flex justify-between items-center py-3.5 text-left cursor-pointer group"
                  >
                    <span className="text-[13px] font-bold text-fg group-hover:text-fg-2 transition-colors pr-4">{faq.q}</span>
                    <span className={clsx("text-fg-3 shrink-0 transition-transform duration-200", openFaqIdx === i && "rotate-45")}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="7" y1="2" x2="7" y2="12" /><line x1="2" y1="7" x2="12" y2="7" />
                      </svg>
                    </span>
                  </button>
                  <div className={clsx("overflow-hidden transition-all duration-200", openFaqIdx === i ? "max-h-40 pb-3.5" : "max-h-0")}>
                    <p className="text-[12px] text-fg-2 leading-relaxed pr-6">{faq.a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Trade Panel */}
        <div className="lg:col-span-2 lg:pl-10 pt-6 animate-enter" style={{ animationDelay: "0.06s" }}>
          <div className="sticky top-20">
            {activeMarket ? (
              <>
                {/* Escrow Balance */}
                <div className="mb-5 bg-raised border border-line p-3">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-[10px] font-mono text-fg-3 uppercase tracking-wider">Exchange Escrow</p>
                    <button
                      onClick={() => setShowEscrow(!showEscrow)}
                      className="text-[10px] font-mono text-fg-3 hover:text-fg cursor-pointer underline underline-offset-2"
                    >
                      {showEscrow ? "Hide" : "Manage"}
                    </button>
                  </div>
                  <p className="text-lg font-serif font-bold text-fg">{formatSbtc(escrowBalance)} sBTC</p>

                  {showEscrow && (
                    <div className="mt-3 pt-3 border-t border-line">
                      <input
                        type="number"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="Amount (sBTC)"
                        className="w-full bg-base border border-line px-3 py-2 text-[13px] font-mono text-fg placeholder:text-fg-4 focus:outline-none focus:border-line mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleDeposit}
                          disabled={status === "pending"}
                          className="flex-1 py-2 text-[11px] font-bold bg-gain text-base cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          Deposit
                        </button>
                        <button
                          onClick={handleWithdraw}
                          disabled={status === "pending"}
                          className="flex-1 py-2 text-[11px] font-bold bg-raised-2 text-fg cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          Withdraw
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Buy / Sell toggle */}
                <div className="flex border-b border-line mb-5">
                  <button
                    onClick={() => { setTradeMode("buy"); setAmount(""); setPrice(""); }}
                    className={clsx("flex-1 py-2.5 text-[13px] font-bold uppercase tracking-wide transition-colors cursor-pointer",
                      tradeMode === "buy" ? "text-fg border-b border-gain -mb-[2px]" : "text-fg-3 hover:text-fg-2"
                    )}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => { setTradeMode("sell"); setAmount(""); setPrice(""); }}
                    className={clsx("flex-1 py-2.5 text-[13px] font-bold uppercase tracking-wide transition-colors cursor-pointer",
                      tradeMode === "sell" ? "text-fg border-b border-copper -mb-[2px]" : "text-fg-3 hover:text-fg-2"
                    )}
                  >
                    Sell
                  </button>
                </div>

                {/* UP / DOWN toggle */}
                <div className="flex gap-2 mb-4">
                  <button
                    onClick={() => setSide("yes")}
                    className={clsx("flex-1 py-3 text-[14px] font-bold uppercase border-2 transition-all cursor-pointer flex flex-col items-center gap-1",
                      side === "yes" ? "border-gain text-gain gain-dim" : "border-line text-fg-3 hover:border-line-2"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 12V4M4 7l4-4 4 4" />
                      </svg>
                      UP
                    </div>
                    <span className="text-[11px] font-mono opacity-80">${yesPriceDisplay.toFixed(2)}</span>
                  </button>
                  <button
                    onClick={() => setSide("no")}
                    className={clsx("flex-1 py-3 text-[14px] font-bold uppercase border-2 transition-all cursor-pointer flex flex-col items-center gap-1",
                      side === "no" ? "border-copper text-loss loss-dim" : "border-line text-fg-3 hover:border-line-2"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 4v8M4 9l4 4 4-4" />
                      </svg>
                      DOWN
                    </div>
                    <span className="text-[11px] font-mono opacity-80">${noPriceDisplay.toFixed(2)}</span>
                  </button>
                </div>

                {/* Order type toggle */}
                <div className="flex gap-2 mb-3">
                  {(["limit", "market"] as OrderType[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setOrderType(t)}
                      className={clsx("flex-1 py-2 text-[12px] font-bold uppercase tracking-wide border-2 transition-colors cursor-pointer",
                        orderType === t
                          ? "border-line text-fg bg-raised"
                          : "border-line text-fg-3 hover:border-line-2"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                {/* Limit Price input (hidden for market orders) */}
                {orderType === "limit" && (
                  <div className="mb-3">
                    <label className="text-[11px] font-mono text-fg-3 uppercase tracking-wider block mb-2">
                      Limit Price ($0.01 – $0.99)
                    </label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.50"
                      step="0.01"
                      min="0.01"
                      max="0.99"
                      className="w-full bg-raised border border-line px-4 py-3 text-xl font-mono text-fg placeholder:text-fg-4 focus:outline-none focus:border-line transition-colors"
                    />
                    <div className="flex gap-2 mt-2">
                      {[0.10, 0.25, 0.50, 0.75, 0.90].map((v) => (
                        <button
                          key={v}
                          onClick={() => setPrice(String(v))}
                          className="flex-1 py-1.5 text-[11px] font-mono text-fg-3 border border-line hover:border-line-2 hover:text-fg transition-colors cursor-pointer"
                        >
                          ${v.toFixed(2)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {orderType === "market" && (
                  <div className="mb-3 bg-raised border border-line p-3">
                    <p className="text-[12px] text-fg-3 font-mono">
                      Market order — fills at best available price (FOK)
                    </p>
                  </div>
                )}

                {/* Amount input — sBTC to spend */}
                <div className="mb-5">
                  <label className="text-[11px] font-mono text-fg-3 uppercase tracking-wider block mb-2">
                    {tradeMode === "buy" ? "Amount to Spend (sBTC)" : "Amount to Sell (sBTC)"}
                  </label>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-raised border border-line px-4 py-3 text-xl font-mono text-fg placeholder:text-fg-4 focus:outline-none focus:border-line transition-colors"
                  />
                  <div className="flex gap-2 mt-2">
                    {[0.001, 0.005, 0.01, 0.05, 0.1].map((v) => (
                      <button
                        key={v}
                        onClick={() => setAmount(String(v))}
                        className="flex-1 py-1.5 text-[11px] font-mono text-fg-3 border border-line hover:border-line-2 hover:text-fg transition-colors cursor-pointer"
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Order preview */}
                {spendNum > 0 && (orderType === "market" || (priceNum > 0 && priceNum < 1)) && (
                  <div className="bg-raised border border-line p-3 mb-5 space-y-1.5">
                    <div className="flex justify-between text-[13px]">
                      <span className="text-fg-3">Side</span>
                      <span className={clsx("font-bold", side === "yes" ? "text-gain" : "text-loss")}>
                        {tradeMode === "buy" ? "Buy" : "Sell"} {side === "yes" ? "UP" : "DOWN"}
                      </span>
                    </div>
                    {orderType === "limit" && (
                      <div className="flex justify-between text-[13px]">
                        <span className="text-fg-3">Limit Price</span>
                        <span className="font-mono text-fg font-bold">${priceNum.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[13px]">
                      <span className="text-fg-3">{tradeMode === "buy" ? "You Pay" : "You Sell"}</span>
                      <span className="font-mono text-fg font-bold">{estimatedCost.toFixed(4)} sBTC</span>
                    </div>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-fg-3">Shares</span>
                      <span className="font-mono text-fg font-bold">{sharesNum.toFixed(4)}</span>
                    </div>
                    {tradeMode === "buy" && (
                      <div className="flex justify-between text-[13px]">
                        <span className="text-fg-3">Payout if Wins</span>
                        <span className={clsx("font-mono font-bold", side === "yes" ? "text-gain" : "text-loss")}>
                          {potentialPayout.toFixed(4)} sBTC
                          <span className="text-fg-3 font-normal ml-1">
                            ({estimatedCost > 0 ? (potentialPayout / estimatedCost).toFixed(2) : "0.00"}x)
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Market info */}
                <table className="w-full text-[13px] mb-5">
                  <tbody>
                    {[
                      ["Price to Beat", formatPrice8(activeMarket.startPrice)],
                      ["Current BTC", btcPrice > 0 ? formatUsd(btcPrice) : "..."],
                      ["Timeframe", `${tfMinutes} minutes`],
                      ["UP Price", `$${yesPriceDisplay.toFixed(4)}`],
                      ["DOWN Price", `$${noPriceDisplay.toFixed(4)}`],
                      ["Collateral", `${formatSbtc(activeMarket.collateralLocked)} sBTC`],
                    ].map(([k, v]) => (
                      <tr key={k} className="border-b border-line">
                        <td className="py-2 text-fg-3">{k}</td>
                        <td className="py-2 font-mono text-fg text-right">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Place Order button */}
                <GradientButton
                  className={clsx("w-full",
                    tradeMode === "buy"
                      ? side === "yes" ? "!bg-gain !text-fg hover:!opacity-90" : "!bg-loss !text-fg hover:!opacity-90"
                      : "!bg-raised-2 !text-fg hover:!opacity-90"
                  )}
                  disabled={spendNum <= 0 || (orderType === "limit" && (priceNum <= 0 || priceNum >= 1)) || !connected || status === "pending"}
                  onClick={handlePlaceOrder}
                >
                  {!connected
                    ? "Connect Wallet"
                    : status === "pending"
                    ? "Confirming..."
                    : orderType === "market"
                    ? `Market ${tradeMode === "buy" ? "Buy" : "Sell"} ${side === "yes" ? "UP" : "DOWN"}`
                    : `${tradeMode === "buy" ? "Buy" : "Sell"} ${side === "yes" ? "UP" : "DOWN"} @ $${priceNum.toFixed(2)}`}
                </GradientButton>

                <TxStatus status={status} txId={txId} error={error} onReset={reset} />

                {/* Faucet */}
                {connected && isTestnet && (
                  <div className="mt-4 pt-4 border-t border-line text-center">
                    <button
                      onClick={handleFaucetMint}
                      disabled={faucet.status === "pending"}
                      className="text-[12px] text-fg-3 hover:text-fg-2 underline underline-offset-2 cursor-pointer transition-colors disabled:opacity-50"
                    >
                      {faucet.status === "pending" ? "Minting..." : "Need test sBTC? Get 1 sBTC from faucet"}
                    </button>
                    {faucet.status === "success" && (
                      <p className="text-[11px] text-gain mt-1 font-mono">
                        Faucet tx submitted!{" "}
                        {faucet.txId && (
                          <a href={`https://explorer.hiro.so/txid/${faucet.txId}?chain=testnet`} target="_blank" rel="noopener noreferrer" className="underline">View tx</a>
                        )}
                      </p>
                    )}
                    {faucet.status === "error" && (
                      <p className="text-[11px] text-loss mt-1 font-mono">{faucet.error || "Faucet mint failed"}</p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-10">
                <p className="text-fg-3 text-[14px] mb-2">No active market</p>
                <p className="text-fg-4 text-[12px]">
                  There is no open {TIMEFRAME_LABELS[timeframe]} market right now. Markets are created periodically by the keeper.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
