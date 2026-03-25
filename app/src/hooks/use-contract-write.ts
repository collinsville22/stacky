"use client";

import { useState, useCallback } from "react";
import { ClarityValue, PostConditionMode } from "@stacks/transactions";
import { DEPLOYER, NETWORK } from "@/lib/constants";

type TxStatus = "idle" | "pending" | "success" | "error";

interface UseContractWriteResult {
  write: (
    contractName: string,
    functionName: string,
    args: ClarityValue[],
    contractAddress?: string
  ) => Promise<string | null>;
  status: TxStatus;
  txId: string | null;
  error: string | null;
  reset: () => void;
}

export function useContractWrite(): UseContractWriteResult {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [txId, setTxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const write = useCallback(
    async (
      contractName: string,
      functionName: string,
      args: ClarityValue[],
      contractAddress?: string
    ): Promise<string | null> => {
      if (!DEPLOYER) {
        setError("Deployer address not configured");
        setStatus("error");
        return null;
      }

      setStatus("pending");
      setError(null);
      setTxId(null);

      try {
        const { openContractCall } = await import("@stacks/connect");

        const id: string | null = await new Promise((resolve) => {
          openContractCall({
            contractAddress: contractAddress || DEPLOYER,
            contractName,
            functionName,
            functionArgs: args,
            network: NETWORK,
            postConditionMode: PostConditionMode.Allow,
            onFinish: (data) => resolve(data.txId),
            onCancel: () => resolve(null),
          });
        });

        if (id) {
          setTxId(id);
          setStatus("success");
          return id;
        }

        setError("Transaction cancelled");
        setStatus("error");
        return null;
      } catch (err: unknown) {
        let msg = "Transaction failed";
        if (err instanceof Error) msg = err.message;
        console.error("Contract write error:", err);
        setError(msg);
        setStatus("error");
        return null;
      }
    },
    []
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setTxId(null);
    setError(null);
  }, []);

  return { write, status, txId, error, reset };
}
