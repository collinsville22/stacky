"use client";

import { useState, useEffect } from "react";
import { clsx } from "clsx";
import { GradientButton } from "@/components/ui/gradient-button";
import { TxStatus } from "@/components/ui/tx-status";
import { useVault, STRATEGIES, type StrategyKey } from "@/hooks/use-vault";
import { useWallet } from "@/hooks/use-stacks-wallet";
import { ONE_8, USDC_DECIMALS, NETWORK } from "@/lib/constants";
import { formatBtc } from "@/lib/format";

type Tab = "deposit" | "withdraw";

const STRATEGY_KEYS: StrategyKey[] = ["CARRY", "STX_CARRY", "HERMETICA"];

export default function VaultPage() {
  const [tab, setTab] = useState<Tab>("deposit");
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyKey>("HERMETICA");
  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const [ltv, setLtv] = useState(40);

  const { connected, address } = useWallet();
  const vault = useVault();

  const strategy = STRATEGIES[selectedStrategy];
  const state = vault.states[selectedStrategy];

  const depositSats = Math.floor((parseFloat(depositInput) || 0) * ONE_8);
  const withdrawShares = Math.floor((parseFloat(withdrawInput) || 0) * ONE_8);

  const depositBelowMin = depositSats > 0 && depositSats < Number(state.minDeposit);

  const usdcBorrow = strategy.hasCarryTrade && vault.btcPrice > 0
    ? vault.calcUsdcBorrow(BigInt(depositSats), ltv)
    : BigInt(0);

  const depositValueUsd = vault.btcPrice > 0
    ? (depositSats / ONE_8) * vault.btcPrice
    : 0;

  const userValueSbtc = state.userShares > BigInt(0)
    ? Number(state.userShares) * state.sharePrice / ONE_8
    : 0;

  const handleDeposit = async () => {
    if (depositSats <= 0 || depositBelowMin || (strategy.hasCarryTrade && vault.btcPrice <= 0)) return;
    const maxLtv = selectedStrategy === "HERMETICA" ? 25 : 40;
    const safeLtv = Math.min(ltv, maxLtv);
    await vault.deposit(selectedStrategy, BigInt(depositSats), safeLtv);
    setDepositInput("");
    setTimeout(vault.refreshAll, 8000);
  };

  const handleWithdraw = async () => {
    if (withdrawShares <= 0) return;
    await vault.withdraw(selectedStrategy, BigInt(withdrawShares));
    setWithdrawInput("");
    setTimeout(vault.refreshAll, 8000);
  };

  const handleMaxDeposit = () => {
    if (vault.sbtcBalance > BigInt(0)) {
      setDepositInput(formatBtc(vault.sbtcBalance));
    }
  };

  const handleMaxWithdraw = () => {
    if (state.userShares > BigInt(0)) {
      setWithdrawInput((Number(state.userShares) / ONE_8).toFixed(8).replace(/0+$/, "").replace(/\.$/, ""));
    }
  };

  useEffect(() => {
    vault.reset();
  }, [selectedStrategy]);

  const totalTvl = STRATEGY_KEYS.reduce(
    (sum, k) => sum + Number(vault.states[k].totalSbtc),
    0
  );

  return (
    <div className="max-w-[1400px] mx-auto px-6 pb-20">
      <div className="pt-10 pb-6 border-b border-line animate-enter">
        <p className="text-[10px] font-mono text-gain tracking-widest uppercase mb-3">Yield Strategies</p>
        <h1 className="text-[clamp(2rem,5vw,3rem)] font-serif font-bold tracking-tight text-fg">
          Earn Yield on sBTC
        </h1>
      </div>

      <div className="grid grid-cols-3 gap-0 border-b border-line animate-enter" style={{ animationDelay: "0.05s" }}>
        {[
          { n: "01", t: "Pick Strategy", d: "Each strategy deploys your sBTC to earn yield through different DeFi protocols on Stacks." },
          { n: "02", t: "Deposit sBTC", d: "Your deposit is deployed automatically. Share price rises as yield accrues." },
          { n: "03", t: "Withdraw Anytime", d: "Burn your shares to receive sBTC back plus accumulated yield." },
        ].map((s, i) => (
          <div key={s.n} className={`py-6 ${i < 2 ? "pr-5 border-r border-line" : "pl-5"} ${i === 1 ? "pl-5" : ""}`}>
            <span className="text-[11px] font-mono text-gain">{s.n}</span>
            <h3 className="text-[14px] font-bold text-fg mt-1.5 mb-1">{s.t}</h3>
            <p className="text-[12px] text-fg-2 leading-relaxed">{s.d}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
        <div className="lg:col-span-3 lg:pr-10 lg:border-r lg:border-line">
          <div className="py-6 border-b border-line animate-enter" style={{ animationDelay: "0.08s" }}>
            <h3 className="text-[13px] font-bold text-fg uppercase tracking-wide mb-4">Strategy Selection</h3>
            <div className="grid grid-cols-2 gap-3">
              {STRATEGY_KEYS.map((key) => {
                const s = STRATEGIES[key];
                const st = vault.states[key];
                return (
                  <button key={key} onClick={() => setSelectedStrategy(key)}
                    className={clsx(
                      "text-left p-4 border-2 transition-colors cursor-pointer",
                      selectedStrategy === key ? "border-gain bg-gain/5" : "border-line hover:border-fg-4"
                    )}>
                    <p className="text-[14px] font-bold text-fg">{s.name}</p>
                    <p className="text-[11px] text-fg-3 mt-1 leading-relaxed">{s.description}</p>
                    <div className="flex items-baseline gap-4 mt-3">
                      <div>
                        <p className="text-[9px] font-mono text-fg-4 uppercase">Share Price</p>
                        <p className="text-[15px] font-mono text-gain font-bold">{st.sharePrice.toFixed(4)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-mono text-fg-4 uppercase">Live APY</p>
                        <p className="text-[13px] font-mono text-copper font-bold">
                          {st.liveApy > 0 ? `${st.liveApy.toFixed(1)}%` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] font-mono text-fg-4 uppercase">TVL</p>
                        <p className="text-[13px] font-mono text-fg">{formatBtc(st.totalSbtc)} sBTC</p>
                      </div>
                    </div>
                    {st.userShares > BigInt(0) && (
                      <div className="mt-2 pt-2 border-t border-line">
                        <p className="text-[10px] font-mono text-gain">
                          Your shares: {(Number(st.userShares) / ONE_8).toFixed(4)}
                        </p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex divide-x-2 divide-line border-b border-line py-6 animate-enter" style={{ animationDelay: "0.12s" }}>
            {[
              { label: "Total TVL", value: `${formatBtc(totalTvl)} sBTC` },
              { label: "BTC Price", value: vault.btcPrice > 0 ? `$${vault.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "Loading..." },
              { label: "Your sBTC", value: connected ? `${formatBtc(vault.sbtcBalance)}` : "Connect wallet" },
            ].map((s, i) => (
              <div key={s.label} className={`flex-1 ${i > 0 ? "pl-5" : ""} ${i < 2 ? "pr-5" : ""}`}>
                <p className="text-[10px] font-mono text-fg-3 uppercase tracking-wider mb-1">{s.label}</p>
                <p className="text-xl font-serif font-bold text-fg">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="py-6 animate-enter" style={{ animationDelay: "0.14s" }}>
            <h3 className="text-[13px] font-bold text-fg uppercase tracking-wide mb-3">
              {strategy.name} Details
            </h3>
            <table className="w-full text-[13px]">
              <tbody>
                {[
                  ["Contract", `${NETWORK === "mainnet" ? "" : "testnet "}${strategy.contract}`],
                  ["Receipt Token", strategy.receiptToken || "Internal shares"],
                  ["Min Deposit", `${formatBtc(state.minDeposit)} sBTC`],
                  ["Share Price", `${state.sharePrice.toFixed(8)} sBTC`],
                  ["Total Deposited", `${formatBtc(state.totalSbtc)} sBTC`],
                  ["Total Shares", `${formatBtc(state.totalShares)}`],
                  ["Mechanism", strategy.mechanism],
                ].map(([k, v]) => (
                  <tr key={k} className="border-b border-line">
                    <td className="py-2 text-fg-3 pr-4">{k}</td>
                    <td className="py-2 font-mono text-fg text-right text-[12px] break-all">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-2 lg:pl-10 pt-6 animate-enter" style={{ animationDelay: "0.06s" }}>
          <div className="sticky top-20">
            <div className="flex border-b border-line mb-6">
              {(["deposit", "withdraw"] as const).map((t) => (
                <button key={t} onClick={() => { setTab(t); vault.reset(); }}
                  className={clsx(
                    "flex-1 pb-3 text-[13px] font-bold uppercase tracking-wide transition-colors cursor-pointer",
                    tab === t ? "text-fg border-b border-gain -mb-[2px]" : "text-fg-3 hover:text-fg-2"
                  )}
                >{t}</button>
              ))}
            </div>

            {tab === "deposit" && (
              <div className="space-y-5">
                {connected && (
                  <div className="flex justify-between items-baseline">
                    <span className="text-[11px] font-mono text-fg-3 uppercase tracking-wider">
                      Your sBTC Balance
                    </span>
                    <span className="text-[13px] font-mono text-fg">
                      {formatBtc(vault.sbtcBalance)} sBTC
                    </span>
                  </div>
                )}

                <div>
                  <div className="flex justify-between items-baseline mb-2">
                    <label className="text-[11px] font-mono text-fg-3 uppercase tracking-wider">
                      Deposit Amount (sBTC)
                    </label>
                    {connected && vault.sbtcBalance > BigInt(0) && (
                      <button onClick={handleMaxDeposit}
                        className="text-[10px] font-mono text-gain hover:underline cursor-pointer">
                        MAX
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    value={depositInput}
                    onChange={(e) => setDepositInput(e.target.value)}
                    placeholder="0.00000000"
                    className="w-full bg-raised border border-line px-4 py-3 text-xl font-mono text-fg placeholder:text-fg-4 focus:outline-none focus:border-line transition-colors"
                  />
                  {depositBelowMin && (
                    <p className="text-[11px] text-loss mt-1">
                      Minimum deposit: {formatBtc(state.minDeposit)} sBTC
                    </p>
                  )}
                </div>

                {strategy.hasCarryTrade && depositSats > 0 && vault.btcPrice > 0 && (
                  <div className="space-y-3 p-3 border border-line bg-raised">
                    <div className="flex justify-between text-[11px] font-mono">
                      <span className="text-fg-3 uppercase tracking-wider">Borrow LTV</span>
                      <span className="text-fg font-bold">{ltv}%</span>
                    </div>
                    <input
                      type="range"
                      min="20"
                      max="60"
                      value={ltv}
                      onChange={(e) => setLtv(parseInt(e.target.value))}
                      className="w-full"
                    />
                    <div className="text-[11px] font-mono text-fg-3 space-y-1">
                      <div className="flex justify-between">
                        <span>Deposit value</span>
                        <span className="text-fg">${depositValueUsd.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>USDC to borrow</span>
                        <span className="text-fg">${(Number(usdcBorrow) / 10 ** USDC_DECIMALS).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Health ratio</span>
                        <span className={clsx(
                          "font-bold",
                          (100 / ltv) > 2 ? "text-gain" : (100 / ltv) > 1.5 ? "text-copper" : "text-loss"
                        )}>
                          {(100 / ltv).toFixed(1)}x
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {depositSats > 0 && !depositBelowMin && (
                  <div className="text-[11px] font-mono text-fg-3 space-y-1 pt-2">
                    <div className="flex justify-between">
                      <span>You deposit</span>
                      <span className="text-fg">{(depositSats / ONE_8).toFixed(8)} sBTC</span>
                    </div>
                    <div className="flex justify-between">
                      <span>You receive</span>
                      <span className="text-fg">~{(depositSats / ONE_8 / state.sharePrice).toFixed(4)} shares</span>
                    </div>
                  </div>
                )}

                <GradientButton
                  className="w-full"
                  variant="secondary"
                  disabled={!connected || depositSats <= 0 || depositBelowMin || vault.status === "pending"}
                  onClick={handleDeposit}
                >
                  {!connected
                    ? "Connect Wallet"
                    : vault.status === "pending"
                      ? "Confirming..."
                      : `Deposit to ${strategy.name}`}
                </GradientButton>

                <TxStatus status={vault.status} txId={vault.txId} error={vault.error} onReset={vault.reset} />
              </div>
            )}

            {tab === "withdraw" && (
              <div className="space-y-5">
                {state.userShares > BigInt(0) ? (
                  <>
                    <div className="p-3 border border-line bg-raised">
                      <p className="text-[10px] font-mono text-fg-3 uppercase mb-1">Your Position</p>
                      <p className="text-lg font-serif font-bold text-fg">
                        {(Number(state.userShares) / ONE_8).toFixed(4)} shares
                      </p>
                      <p className="text-[12px] font-mono text-fg-3 mt-1">
                        Worth ~{userValueSbtc.toFixed(8)} sBTC
                        {vault.btcPrice > 0 && ` ($${(userValueSbtc * vault.btcPrice).toFixed(2)})`}
                      </p>
                      {state.userDebt > BigInt(0) && (
                        <p className="text-[11px] text-fg-3 mt-2 pt-2 border-t border-line">
                          Keep ~$1 USDCx in wallet for withdrawal slippage
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="flex justify-between items-baseline mb-2">
                        <label className="text-[11px] font-mono text-fg-3 uppercase tracking-wider">
                          Shares to Withdraw
                        </label>
                        <button onClick={handleMaxWithdraw}
                          className="text-[10px] font-mono text-gain hover:underline cursor-pointer">
                          MAX
                        </button>
                      </div>
                      <input
                        type="number"
                        value={withdrawInput}
                        onChange={(e) => setWithdrawInput(e.target.value)}
                        placeholder="0.0000"
                        className="w-full bg-raised border border-line px-4 py-3 text-xl font-mono text-fg placeholder:text-fg-4 focus:outline-none focus:border-line transition-colors"
                      />
                    </div>

                    {withdrawShares > 0 && (
                      <div className="text-[11px] font-mono text-fg-3 space-y-1">
                        <div className="flex justify-between">
                          <span>You burn</span>
                          <span className="text-fg">{(withdrawShares / ONE_8).toFixed(4)} shares</span>
                        </div>
                        <div className="flex justify-between">
                          <span>You receive</span>
                          <span className="text-fg">~{((withdrawShares / ONE_8) * state.sharePrice).toFixed(8)} sBTC</span>
                        </div>
                      </div>
                    )}

                    {state.userDebt > BigInt(0) && (
                      <div className="p-3 border border-line bg-raised">
                        <p className="text-[10px] text-fg-3 leading-relaxed">
                          On withdrawal, the strategy unwinds automatically — yield earned repays the loan. Keep a small USDCx balance (~$1) in your wallet to cover swap slippage.
                        </p>
                      </div>
                    )}
                    <GradientButton
                      className="w-full"
                      variant="secondary"
                      disabled={!connected || withdrawShares <= 0 || vault.status === "pending"}
                      onClick={handleWithdraw}
                    >
                      {vault.status === "pending"
                        ? "Confirming..."
                        : "Withdraw sBTC"}
                    </GradientButton>

                    <TxStatus status={vault.status} txId={vault.txId} error={vault.error} onReset={vault.reset} />
                  </>
                ) : (
                  <div className="py-12 text-center">
                    <p className="text-[13px] text-fg-3">No position in {strategy.name}.</p>
                    <p className="text-[12px] text-fg-4 mt-1">Deposit sBTC to get started.</p>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
