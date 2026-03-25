"use client";

import { ReactNode } from "react";
import { WalletContext, useWalletProvider } from "@/hooks/use-stacks-wallet";

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWalletProvider();
  return (
    <WalletContext.Provider value={wallet}>
      {children}
    </WalletContext.Provider>
  );
}
