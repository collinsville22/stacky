"use client";

import Link from "next/link";
import Image from "next/image";
import { useBtcPrice } from "@/hooks/use-btc-price";

export default function HomePage() {
  const { price, change24h } = useBtcPrice();
  const isUp = (change24h ?? 0) >= 0;

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_380px]">
        <div className="p-8 lg:p-14 lg:pr-20 flex flex-col justify-center animate-enter">
          <div className="flex items-center gap-3 mb-8">
            <Image src="/logo.jpg" alt="stacky" width={32} height={32} className="invert brightness-75 sepia hue-rotate-[350deg] saturate-[3]" />
            <span className="text-fg-3 text-sm">stacky prediction markets</span>
          </div>
          <h1 className="font-serif text-[clamp(2.8rem,6vw,5.5rem)] leading-[0.92] mb-6 text-fg">
            Will Bitcoin<br />
            go <em className="text-copper">up</em> or <em className="text-loss">down</em>?
          </h1>
          <p className="text-fg-3 text-[15px] leading-relaxed max-w-lg mb-10">
            Place your bet with real sBTC. Pick a timeframe — 5 minutes to
            1 hour. If BTC beats the strike price, UP wins. If it drops, DOWN
            wins. Winner takes the pool. Trade positions mid-session or hold
            to resolution. Every trade settles on Stacks, every payout is
            trustless.
          </p>
          <div className="flex gap-3">
            <Link href="/markets"
              className="px-7 py-3 text-sm bg-copper text-base hover:brightness-110 transition-all cursor-pointer">
              Start Trading
            </Link>
            <Link href="/loans"
              className="px-7 py-3 text-sm border border-line text-fg-3 hover:text-fg hover:border-fg-4 transition-colors cursor-pointer">
              Yield Vaults
            </Link>
          </div>
        </div>

        <div className="border-t lg:border-t-0 lg:border-l border-line flex flex-col animate-enter" style={{ animationDelay: "0.1s" }}>
          <div className="p-6 border-b border-line">
            <p className="text-[10px] font-mono text-fg-4 tracking-wider mb-3">BTC / USD</p>
            {price > 0 ? (
              <>
                <p className="font-mono text-3xl text-fg tabular-nums">
                  ${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className={`font-mono text-sm mt-1 ${isUp ? "text-gain" : "text-loss"}`}>
                  {isUp ? "+" : ""}{(change24h ?? 0).toFixed(2)}% 24h
                </p>
              </>
            ) : (
              <p className="font-mono text-3xl text-fg-4">..</p>
            )}
          </div>

          <div className="flex-1 flex flex-col">
            <div className="px-6 py-5 border-b border-line">
              <p className="text-[10px] font-mono text-fg-4 tracking-wider mb-2">HOW IT WORKS</p>
              <div className="space-y-3">
                {[
                  "Market opens with a BTC strike price",
                  "Buy UP if you think BTC will rise, DOWN if it will fall",
                  "Trade your position mid-session at any price",
                  "Market resolves — winning tokens redeem for sBTC",
                ].map((step, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-[10px] font-mono text-copper shrink-0 mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[13px] text-fg-2 leading-snug">{step}</span>
                  </div>
                ))}
              </div>
            </div>

            {[
              { label: "Collateral", value: "sBTC", sub: "Bitcoin-backed" },
              { label: "Settlement", value: "On-chain", sub: "Stacks L2" },
              { label: "Timeframes", value: "5m to 1h", sub: "4 options" },
            ].map((row, i) => (
              <div key={row.label} className={`px-6 py-4 flex items-center justify-between ${i < 2 ? "border-b border-line" : ""}`}>
                <div>
                  <p className="text-sm text-fg">{row.value}</p>
                  <p className="text-[11px] text-fg-4">{row.sub}</p>
                </div>
                <p className="text-[10px] font-mono text-fg-4 tracking-wider">{row.label}</p>
              </div>
            ))}
          </div>

          <Link href="/markets" className="p-5 border-t border-line flex items-center justify-between group cursor-pointer hover:bg-raised-2 transition-colors">
            <span className="text-sm text-copper group-hover:translate-x-1 transition-transform">Open markets</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-copper">
              <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>

      <footer className="border-t border-line py-4 px-6 flex items-center justify-between">
        <span className="text-[11px] text-fg-4">stacky</span>
        <span className="text-[10px] font-mono text-fg-4">Stacks mainnet</span>
      </footer>
    </div>
  );
}
