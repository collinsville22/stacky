"use client";

import { useWallet } from "@/hooks/use-stacks-wallet";

export function WalletButton() {
  const { connected, address, loading, connect, disconnect } = useWallet();

  if (connected && address) {
    return (
      <button
        onClick={disconnect}
        className="h-full px-4 text-[12px] font-mono text-fg-2 hover:text-copper transition-colors cursor-pointer tabular-nums"
      >
        {address.slice(0, 4)}..{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={loading}
      className="h-full px-5 text-[12px] text-copper hover:bg-copper/10 transition-colors cursor-pointer disabled:opacity-40"
    >
      {loading ? ".." : "Connect"}
    </button>
  );
}
