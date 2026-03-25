"use client";

import { NETWORK } from "@/lib/constants";

interface TxStatusProps {
  status: "idle" | "pending" | "success" | "error";
  txId: string | null;
  error: string | null;
  onReset?: () => void;
}

export function TxStatus({ status, txId, error, onReset }: TxStatusProps) {
  if (status === "idle") return null;

  const explorerUrl = NETWORK === "mainnet"
    ? `https://explorer.hiro.so/txid/${txId}`
    : `https://explorer.hiro.so/txid/${txId}?chain=testnet`;

  return (
    <div className="mt-4 p-3 border border-line text-[13px]">
      {status === "pending" && (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-fg-2">Confirming in wallet...</span>
        </div>
      )}
      {status === "success" && txId && (
        <div>
          <p className="text-gain font-bold mb-1">Transaction submitted</p>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-3 font-mono text-[11px] hover:text-fg-2 underline"
          >
            {txId.slice(0, 10)}...{txId.slice(-6)}
          </a>
          {onReset && (
            <button onClick={onReset} className="ml-3 text-[11px] text-fg-3 hover:text-fg cursor-pointer">
              Dismiss
            </button>
          )}
        </div>
      )}
      {status === "error" && (
        <div>
          <p className="text-loss font-bold mb-1">Transaction failed</p>
          <p className="text-fg-3 text-[12px]">{error || "Unknown error"}</p>
          {onReset && (
            <button onClick={onReset} className="mt-1 text-[11px] text-fg-3 hover:text-fg cursor-pointer">
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
