"use client";

import { useState, useEffect, useCallback } from "react";
import { ClarityValue, callReadOnly, cvToJSON } from "@/lib/stacks";
import { DEPLOYER } from "@/lib/constants";

interface UseContractReadResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useContractRead<T = ClarityValue>(
  contractName: string,
  functionName: string,
  args: ClarityValue[] = [],
  transform?: (cv: ClarityValue) => T,
  enabled = true
): UseContractReadResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!enabled || !DEPLOYER) return;
    setLoading(true);
    setError(null);
    try {
      const result = await callReadOnly(contractName, functionName, args);
      const value = transform ? transform(result) : (result as unknown as T);
      setData(value);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Read failed");
    } finally {
      setLoading(false);
    }
  }, [contractName, functionName, enabled]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

export function useReadUint(
  contractName: string,
  functionName: string,
  args: ClarityValue[] = [],
  enabled = true
) {
  return useContractRead<bigint>(
    contractName,
    functionName,
    args,
    (cv) => {
      const json = cvToJSON(cv);
      if (json.type === "uint") return BigInt(json.value);
      if (json.value?.type === "uint") return BigInt(json.value.value);
      return BigInt(0);
    },
    enabled
  );
}
