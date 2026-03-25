"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Cl, cvToJSON } from "@stacks/transactions";
import { useWallet } from "./use-stacks-wallet";
import { useContractWrite } from "./use-contract-write";
import { callReadOnly, callReadOnlyExternal, fetchSbtcBalance } from "@/lib/stacks";
import {
  STRATEGY_CONTRACTS,
  RECEIPT_TOKENS,
  EXTERNAL,
  ONE_8,
  USDC_DECIMALS,
} from "@/lib/constants";

const TRAIT_ARGS = {
  sbtcVault: Cl.contractPrincipal(EXTERNAL.SBTC_VAULT.address, EXTERNAL.SBTC_VAULT.name),
  usdcVault: Cl.contractPrincipal(EXTERNAL.USDC_VAULT.address, EXTERNAL.USDC_VAULT.name),
  stxVault: Cl.contractPrincipal(EXTERNAL.STX_VAULT.address, EXTERNAL.STX_VAULT.name),
  swapPool: Cl.contractPrincipal(EXTERNAL.BITFLOW_POOL.address, EXTERNAL.BITFLOW_POOL.name),
  aeusdc: Cl.contractPrincipal(EXTERNAL.AEUSDC.address, EXTERNAL.AEUSDC.name),
  usdcx: Cl.contractPrincipal(EXTERNAL.USDCX.address, EXTERNAL.USDCX.name),
  v1Lp: Cl.contractPrincipal("SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N", "zaeusdc-v2-0"),
  v1Asset: Cl.contractPrincipal("SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K", "token-aeusdc"),
  v1Incentives: Cl.contractPrincipal("SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N", "incentives-v2-2"),
};

export type StrategyKey = "CARRY" | "STX_CARRY" | "HERMETICA";

export interface Strategy {
  key: StrategyKey;
  contract: string;
  receiptToken: string | null;
  name: string;
  description: string;
  mechanism: string;
  minDeposit: number;
  hasCarryTrade: boolean;
  baseApy: number;
}

export const STRATEGIES: Record<StrategyKey, Strategy> = {
  CARRY: {
    key: "CARRY",
    contract: STRATEGY_CONTRACTS.CARRY,
    receiptToken: RECEIPT_TOKENS.CARRY,
    name: "sBTC Carry",
    description: "Collateralize sBTC on Zest v2, borrow USDC, lend aeUSDC on Zest v1",
    mechanism: "Carry trade spread between borrow rate and lending rate",
    minDeposit: 100_000,
    hasCarryTrade: true,
    baseApy: 7.2,
  },
  STX_CARRY: {
    key: "STX_CARRY",
    contract: STRATEGY_CONTRACTS.STX_CARRY,
    receiptToken: RECEIPT_TOKENS.STX_CARRY,
    name: "Granite Carry",
    description: "Collateralize sBTC, borrow USDC, lend aeUSDC on Granite for ~7.4% yield",
    mechanism: "Carry trade via Granite Protocol lending pool",
    minDeposit: 100_000,
    hasCarryTrade: true,
    baseApy: 7.4,
  },
  HERMETICA: {
    key: "HERMETICA",
    contract: STRATEGY_CONTRACTS.HERMETICA,
    receiptToken: RECEIPT_TOKENS.HERMETICA,
    name: "stSTX Yield",
    description: "Collateralize sBTC, borrow USDC, swap to stSTX for PoX stacking yield",
    mechanism: "sBTC collateral, borrow cheap USDC, route through aeUSDC/STX to stSTX",
    minDeposit: 100_000,
    hasCarryTrade: true,
    baseApy: 6.0,
  },
};

export interface StrategyState {
  sharePrice: number;
  totalSbtc: bigint;
  totalShares: bigint;
  totalBorrowed: bigint;
  userShares: bigint;
  userDebt: bigint;
  minDeposit: bigint;
  liveApy: number;
}

export function useVault() {
  const { address, connected } = useWallet();
  const { write, status, txId, error, reset } = useContractWrite();

  const [sbtcBalance, setSbtcBalance] = useState<bigint>(BigInt(0));
  const [btcPrice, setBtcPrice] = useState(0);
  const [states, setStates] = useState<Record<StrategyKey, StrategyState>>({
    CARRY: emptyState(),
    STX_CARRY: emptyState(),
    HERMETICA: emptyState(),
  });
  const [loading, setLoading] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStrategyState = useCallback(async (key: StrategyKey): Promise<StrategyState> => {
    const strategy = STRATEGIES[key];
    const contract = strategy.contract;

    try {
      const [priceResult, stateResult, minResult] = await Promise.all([
        callReadOnly(contract, "get-share-price").catch(() => null),
        callReadOnly(contract, "get-state").catch(() => null),
        callReadOnly(contract, "get-min-deposit").catch(() => null),
      ]);

      let sharePrice = 1;
      if (priceResult) {
        const pj = cvToJSON(priceResult);
        sharePrice = Number(pj.value ?? pj) / ONE_8;
      }

      let totalSbtc = BigInt(0);
      let totalShares = BigInt(0);
      let totalBorrowed = BigInt(0);
      if (stateResult) {
        const sj = cvToJSON(stateResult);
        const v = sj.value || sj;
        totalSbtc = BigInt(v["total-sbtc"]?.value || 0);
        totalShares = BigInt(v["total-shares"]?.value || 0);
        totalBorrowed = BigInt(v["total-usdc-borrowed"]?.value || v["total-stx-borrowed"]?.value || 0);
      }

      let minDeposit = BigInt(strategy.minDeposit);
      if (minResult) {
        const mj = cvToJSON(minResult);
        minDeposit = BigInt(mj.value ?? mj);
      }

      let userShares = BigInt(0);
      if (address) {
        try {
          const userResult = await callReadOnly(contract, "get-user-shares", [Cl.principal(address)]);
          const uj = cvToJSON(userResult);
          userShares = BigInt(uj.value ?? uj);
        } catch {}
      }

      const userDebt = totalShares > BigInt(0)
        ? (userShares * totalBorrowed) / totalShares
        : BigInt(0);

      return { sharePrice, totalSbtc, totalShares, totalBorrowed, userShares, userDebt, minDeposit, liveApy: 0 };
    } catch {
      return emptyState();
    }
  }, [address]);

  const fetchLiveRates = useCallback(async () => {
    const ZEST_POOL = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
    const ZEST_VAULT = "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7";
    let zestEarnRate = 0;
    let usdcBorrowCost = 0;
    let stxBorrowCost = 0;

    try {
      const aeRes = await callReadOnlyExternal(ZEST_POOL, "pool-0-reserve", "get-reserve-state",
        [Cl.contractPrincipal("SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K", "token-aeusdc")]);
      const v = cvToJSON(aeRes).value?.value || cvToJSON(aeRes).value;
      zestEarnRate = Number(v["current-liquidity-rate"]?.value || 0) / 1e8 * 100;
    } catch {}

    try {
      const r = await callReadOnlyExternal(ZEST_VAULT, "v0-vault-usdc", "get-interest-rate", []);
      usdcBorrowCost = Number(cvToJSON(r).value?.value ?? cvToJSON(r).value ?? 0) / 100;
    } catch {}

    try {
      const r = await callReadOnlyExternal(ZEST_VAULT, "v0-vault-stx", "get-interest-rate", []);
      stxBorrowCost = Number(cvToJSON(r).value?.value ?? cvToJSON(r).value ?? 0) / 100;
    } catch {}

    return { zestEarnRate, usdcBorrowCost, stxBorrowCost };
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const keys: StrategyKey[] = ["CARRY", "STX_CARRY", "HERMETICA"];
      const [results, rates] = await Promise.all([
        Promise.all(keys.map((k) => fetchStrategyState(k))),
        fetchLiveRates(),
      ]);

      const LTV = 0.4;
      const STSTX_EARN = 6.0;
      const graniteEarn = rates.zestEarnRate > 0 ? rates.zestEarnRate * 1.04 : 0;
      results[0].liveApy = Math.max((rates.zestEarnRate - rates.usdcBorrowCost) * LTV, 0);
      results[1].liveApy = Math.max((graniteEarn - rates.usdcBorrowCost) * LTV, 0);
      results[2].liveApy = Math.max((STSTX_EARN - rates.usdcBorrowCost) * LTV, 0);

      const newStates: Record<StrategyKey, StrategyState> = {} as Record<StrategyKey, StrategyState>;
      keys.forEach((k, i) => { newStates[k] = results[i]; });
      setStates(newStates);

      if (address) {
        const bal = await fetchSbtcBalance(address);
        setSbtcBalance(bal);
      }

      const { fetchBtcPrice } = await import("@/lib/stacks");
      const price = await fetchBtcPrice();
      if (price > 0) setBtcPrice(price);
    } catch {} finally {
      setLoading(false);
    }
  }, [address, fetchStrategyState]);

  useEffect(() => {
    refreshAll();
    refreshTimerRef.current = setInterval(refreshAll, 30_000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [refreshAll]);

  useEffect(() => {
    if (connected && address) refreshAll();
  }, [connected, address, refreshAll]);

  const calcUsdcBorrow = useCallback((sbtcSats: bigint, ltvPercent: number): bigint => {
    if (btcPrice <= 0) return BigInt(0);
    const btcAmount = Number(sbtcSats) / ONE_8;
    const usdValue = btcAmount * btcPrice;
    const borrowUsd = usdValue * (ltvPercent / 100);
    return BigInt(Math.floor(borrowUsd * 10 ** USDC_DECIMALS));
  }, [btcPrice]);

  const deposit = useCallback(async (key: StrategyKey, sbtcSats: bigint, ltvPercent = 40) => {
    const strategy = STRATEGIES[key];
    const usdcBorrow = calcUsdcBorrow(sbtcSats, ltvPercent);

    switch (key) {
      case "CARRY": {
        const pythResp = await fetch(
          "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43&ids%5B%5D=eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a&encoding=hex"
        );
        const pythData = await pythResp.json();
        const priceFeedHex = pythData.binary?.data?.[0] || "";
        const priceFeedBuf = Cl.buffer(
          Uint8Array.from(priceFeedHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
        );
        return write(strategy.contract, "deposit", [
          Cl.contractPrincipal("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4", "sbtc-token"),
          TRAIT_ARGS.usdcx,
          TRAIT_ARGS.aeusdc, TRAIT_ARGS.usdcx, TRAIT_ARGS.swapPool,
          TRAIT_ARGS.v1Lp, TRAIT_ARGS.v1Asset, TRAIT_ARGS.v1Incentives,
          Cl.uint(sbtcSats), Cl.uint(usdcBorrow),
          priceFeedBuf,
        ]);
      }
      case "STX_CARRY": {
        const pythRespStx = await fetch(
          "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43&ids%5B%5D=eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a&encoding=hex"
        );
        const pythDataStx = await pythRespStx.json();
        const pfHexStx = pythDataStx.binary?.data?.[0] || "";
        const pfBufStx = Cl.buffer(
          Uint8Array.from(pfHexStx.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
        );
        return write(strategy.contract, "deposit", [
          Cl.uint(sbtcSats), Cl.uint(usdcBorrow), pfBufStx,
        ]);
      }
      case "HERMETICA": {
        const pythResp2 = await fetch(
          "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43&ids%5B%5D=eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a&encoding=hex"
        );
        const pythData2 = await pythResp2.json();
        const priceFeedHex2 = pythData2.binary?.data?.[0] || "";
        const priceFeedBuf2 = Cl.buffer(
          Uint8Array.from(priceFeedHex2.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
        );
        return write(strategy.contract, "deposit", [
          Cl.uint(sbtcSats), Cl.uint(usdcBorrow), priceFeedBuf2,
        ]);
      }
    }
  }, [write, calcUsdcBorrow]);

  const withdraw = useCallback(async (key: StrategyKey, shares: bigint) => {
    const strategy = STRATEGIES[key];
    switch (key) {
      case "CARRY": {
        const pythResp = await fetch(
          "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43&ids%5B%5D=eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a&encoding=hex"
        );
        const pythData = await pythResp.json();
        const priceFeedHex = pythData.binary?.data?.[0] || "";
        const priceFeedBuf = Cl.buffer(
          Uint8Array.from(priceFeedHex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
        );
        return write(strategy.contract, "withdraw", [
          Cl.contractPrincipal("SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7", "v0-vault-sbtc"),
          TRAIT_ARGS.usdcx,
          TRAIT_ARGS.aeusdc, TRAIT_ARGS.usdcx, TRAIT_ARGS.swapPool,
          TRAIT_ARGS.v1Lp, TRAIT_ARGS.v1Asset, TRAIT_ARGS.v1Incentives,
          Cl.uint(shares),
          priceFeedBuf,
        ]);
      }
      case "STX_CARRY": {
        const pythRespStxW = await fetch(
          "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43&ids%5B%5D=eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a&encoding=hex"
        );
        const pythDataStxW = await pythRespStxW.json();
        const pfHexStxW = pythDataStxW.binary?.data?.[0] || "";
        const pfBufStxW = Cl.buffer(
          Uint8Array.from(pfHexStxW.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
        );
        return write(strategy.contract, "withdraw", [Cl.uint(shares), pfBufStxW]);
      }
      case "HERMETICA": {
        const pythResp3 = await fetch(
          "https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43&ids%5B%5D=eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a&encoding=hex"
        );
        const pythData3 = await pythResp3.json();
        const priceFeedHex3 = pythData3.binary?.data?.[0] || "";
        const priceFeedBuf3 = Cl.buffer(
          Uint8Array.from(priceFeedHex3.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
        );
        return write(strategy.contract, "withdraw", [Cl.uint(shares), priceFeedBuf3]);
      }
    }
  }, [write]);

  const rescueRepayV23 = useCallback(async () => {
    return write("v0-4-market", "repay", [
      Cl.contractPrincipal("SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE", "usdcx"),
      Cl.uint(5000000), // Zest caps at actual debt
      Cl.some(Cl.principal("SPCG3TNZXGFP36E4QGQN92TBM3JYF7E4PHGGR120.stacky-stx-carry-v5")),
    ], "SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7" as string);
  }, [write]);

  const completeHermeticaWithdraw = useCallback(async (claimId: bigint) => {
    return write(STRATEGY_CONTRACTS.HERMETICA, "complete-withdraw", [Cl.uint(claimId)]);
  }, [write]);
  return {
    states,
    sbtcBalance,
    btcPrice,
    loading,
    deposit,
    withdraw,
    rescueRepayV23,
    completeHermeticaWithdraw,
    calcUsdcBorrow,
    refreshAll,
    status,
    txId,
    error,
    reset,
  };
}

function emptyState(): StrategyState {
  return {
    sharePrice: 1,
    totalSbtc: BigInt(0),
    totalShares: BigInt(0),
    totalBorrowed: BigInt(0),
    userShares: BigInt(0),
    userDebt: BigInt(0),
    minDeposit: BigInt(100_000),
    liveApy: 0,
  };
}
