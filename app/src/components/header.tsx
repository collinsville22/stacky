"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet-button";
import { useBtcPrice } from "@/hooks/use-btc-price";

const NAV = [
  { href: "/markets", label: "Markets" },
  { href: "/loans", label: "Vaults" },
] as const;

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { price } = useBtcPrice();

  return (
    <>
      <header className="fixed top-0 inset-x-0 z-40 h-11 bg-raised border-b border-line">
        <div className="h-full flex items-center">
          <Link href="/" className="flex items-center gap-2.5 px-5 h-full border-r border-line cursor-pointer hover:bg-raised-2 transition-colors">
            <Image src="/logo.jpg" alt="stacky" width={22} height={22} className="invert brightness-75 sepia hue-rotate-[350deg] saturate-[3]" />
            <span className="text-[13px] font-medium text-fg tracking-wide">stacky</span>
          </Link>

          <nav className="hidden md:flex items-center h-full">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`h-full flex items-center px-5 text-[13px] border-r border-line transition-colors cursor-pointer ${
                  pathname === item.href
                    ? "text-copper bg-raised-2"
                    : "text-fg-3 hover:text-fg hover:bg-raised-2"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          {price > 0 && (
            <div className="hidden lg:flex items-center gap-2 px-5 h-full border-r border-line">
              <span className="text-[10px] text-fg-4 tracking-wider font-mono">BTC</span>
              <span className="text-[13px] font-mono text-fg tabular-nums">
                ${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center h-full">
            <div className="hidden sm:flex items-center gap-1.5 px-4 h-full border-l border-line">
              <div className="w-[5px] h-[5px] rounded-full bg-gain" style={{ animation: "glow 2s ease-in-out infinite" }} />
              <span className="text-[10px] font-mono text-fg-4 tracking-wider">mainnet</span>
            </div>
            <div className="h-full border-l border-line flex items-center">
              <WalletButton />
            </div>
            <button
              onClick={() => setOpen(!open)}
              className="md:hidden h-full px-4 border-l border-line text-fg-3 hover:text-fg cursor-pointer"
              aria-label="Menu"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {open ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-30 md:hidden" onClick={() => setOpen(false)}>
          <nav className="absolute top-11 left-0 right-0 bg-raised border-b border-line">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`block px-5 py-3 text-sm border-b border-line cursor-pointer ${
                  pathname === item.href ? "text-copper" : "text-fg-3"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
