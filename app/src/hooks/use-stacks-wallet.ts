"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";

interface WalletState {
  connected: boolean;
  address: string | null;
  publicKey: string | null;
  loading: boolean;
}

interface WalletContextType extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
}

const defaultCtx: WalletContextType = {
  connected: false,
  address: null,
  publicKey: null,
  loading: false,
  connect: async () => {},
  disconnect: () => {},
};

export const WalletContext = createContext<WalletContextType>(defaultCtx);

export function useWallet() {
  return useContext(WalletContext);
}

function findStxEntry(addresses: unknown[]): { address: string; publicKey: string } | null {
  for (const a of addresses) {
    const entry = a as any;
    const addr = entry?.address || "";
    if (
      addr.startsWith("SP") || addr.startsWith("ST") ||
      entry?.purpose === "stacks" ||
      entry?.addressType === "stacks"
    ) {
      return { address: addr, publicKey: entry?.publicKey || "" };
    }
  }
  return null;
}

export function useWalletProvider() {
  const [state, setState] = useState<WalletState>({
    connected: false,
    address: null,
    publicKey: null,
    loading: false,
  });

  useEffect(() => {
    import("@stacks/connect").then(({ isConnected, getLocalStorage }) => {
      if (isConnected()) {
        const stored = getLocalStorage();
        const allAddresses = stored?.addresses?.stx || [];
        const stxEntry = findStxEntry(allAddresses);
        if (stxEntry?.address) {
          setState({
            connected: true,
            address: stxEntry.address,
            publicKey: stxEntry.publicKey || null,
            loading: false,
          });
        }
      }
    }).catch(() => {});
  }, []);

  const connect = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const { connect: stacksConnect } = await import("@stacks/connect");
      const result = await stacksConnect();
      const addresses = result?.addresses || [];
      const stxEntry = findStxEntry(addresses);
      if (stxEntry?.address) {
        setState({
          connected: true,
          address: stxEntry.address,
          publicKey: stxEntry.publicKey || null,
          loading: false,
        });
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    } catch (err) {
      console.error("Wallet connect error:", err);
      setState((s) => ({ ...s, loading: false }));
    }
  }, []);

  const disconnect = useCallback(() => {
    import("@stacks/connect").then(({ disconnect: d }) => d()).catch(() => {});
    setState({ connected: false, address: null, publicKey: null, loading: false });
  }, []);

  return { ...state, connect, disconnect };
}
