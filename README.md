# Stacky

**sBTC DeFi on Stacks — Prediction Markets & Yield Strategies**

Live on Stacks mainnet. Real sBTC. Real yield. Every transaction verifiable on-chain.

![stacky](app/public/logo.jpg)

[![Demo Video](https://img.youtube.com/vi/TYzhMTyhnW8/maxresdefault.jpg)](https://www.youtube.com/watch?v=TYzhMTyhnW8)

[Watch Demo](https://www.youtube.com/watch?v=TYzhMTyhnW8) | [Explorer](https://explorer.hiro.so/address/SPCG3TNZXGFP36E4QGQN92TBM3JYF7E4PHGGR120?chain=mainnet)

---

## What This Is

Stacky is two products built on Stacks L2, both using real Bitcoin-backed sBTC:

1. **Prediction Markets** — Binary YES/NO markets on BTC price movements. A Polymarket-style CLOB (Central Limit Order Book) with off-chain matching and on-chain settlement. Users bet whether BTC goes UP or DOWN within a timeframe (5m to 1h). Winner takes the pool.

2. **Yield Strategies** — Automated DeFi strategies that deposit sBTC as collateral on Zest Protocol, borrow stablecoins, and deploy the borrowed capital into lending pools (Zest v1, Granite Finance) or liquid staking (stSTX) to earn yield. Each strategy is a single contract that handles the entire flow atomically.

Both products are deployed on Stacks mainnet, tested with real sBTC, and verified through on-chain transactions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js)                  │
│  Markets Page ──── use-clob-markets.ts ──── WebSocket   │
│  Vaults Page  ──── use-vault.ts ──────────── Hiro API   │
└────────────┬───────────────────────────────┬────────────┘
             │                               │
     ┌───────▼────────┐             ┌────────▼──────────┐
     │ Matching Engine │             │  Yield Contracts  │
     │  (Node.js)      │             │  (Clarity)        │
     │                 │             │                   │
     │ Order Book      │             │ carry-v31         │
     │ 3 Match Types   │             │ granite-carry-v2  │
     │ WebSocket       │             │ stx-staking-v10   │
     │ Settlement      │             │                   │
     └───────┬─────────┘             └────────┬──────────┘
             │                                │
     ┌───────▼────────────────────────────────▼──────────┐
     │              STACKS MAINNET (L2)                   │
     │                                                    │
     │  Prediction Market Contracts:                      │
     │    outcome-tokens-v3  exchange-v6  oracle-v3       │
     │                                                    │
     │  External Protocols:                               │
     │    Zest v2 (lending)  Granite (lending)             │
     │    Bitflow (DEX)      StackingDAO (stSTX)          │
     │                                                    │
     │  Collateral: SM3VDXK3WZZSA84XXFKAFAF15NNZX32C..   │
     │              .sbtc-token (real mainnet sBTC)        │
     └────────────────────────────────────────────────────┘
```

---

## Prediction Markets — Deep Dive

### How It Works

A market has a **strike price** — the BTC/USD price at market creation. When the market resolves:

- If BTC >= strike → **YES (UP) wins**
- If BTC < strike → **NO (DOWN) wins**

Winners redeem their tokens 1:1 for sBTC. Losers get nothing.

### Trade Types

The exchange supports three settlement mechanisms:

**MINT** — Two opposing bets create new tokens. Alice buys YES, Bob buys NO at complementary prices. The exchange mints 1 YES + 1 NO token pair, funded by both sides. This is how new liquidity enters the market.

**COMPLEMENTARY** — Standard secondary market trade. Alice sells her YES tokens to Charlie at a new price. No new tokens are minted — ownership transfers. This is how mid-session profit-taking works.

**MERGE** — Two holders of complementary tokens (YES + NO) burn them to recover the underlying sBTC collateral. Removes liquidity from the market.

### Contract Architecture

| Contract | Purpose | Mainnet Address |
|----------|---------|-----------------|
| `stacky-outcome-tokens-v3` | Market creation, token minting/burning, resolution, redemption | [Explorer](https://explorer.hiro.so/address/SPCG3TNZXGFP36E4QGQN92TBM3JYF7E4PHGGR120.stacky-outcome-tokens-v3?chain=mainnet) |
| `stacky-exchange-v6` | Escrow-based CLOB settlement, 3 match types, order nonce tracking | [Explorer](https://explorer.hiro.so/address/SPCG3TNZXGFP36E4QGQN92TBM3JYF7E4PHGGR120.stacky-exchange-v6?chain=mainnet) |
| `stacky-oracle-v3` | BTC/USD price oracle with Pyth integration | [Explorer](https://explorer.hiro.so/address/SPCG3TNZXGFP36E4QGQN92TBM3JYF7E4PHGGR120.stacky-oracle-v3?chain=mainnet) |

### Escrow Model

Users deposit sBTC into the exchange contract before trading. The contract holds funds in escrow — no custodian, no intermediary. Settlement happens atomically: the matching engine submits matched trades to `fill-order`, which debits/credits escrow balances and tracks order nonces to prevent replay.

### Off-Chain Matching Engine

The order book lives off-chain for performance (sub-second matching). The engine:

- Maintains bids/asks per market
- Runs a 3-phase matching algorithm (MINT → MERGE → COMPLEMENTARY)
- Settles each matched trade on-chain via `fill-order`
- Broadcasts real-time updates via WebSocket
- Supports GTC, GTD, FOK, FAK order types

### Mainnet Demo — Verified On-Chain

Full 3-participant demo with real sBTC. Alice bets UP, Bob bets DOWN, Charlie buys mid-session:

| Step | Transaction | Explorer |
|------|-------------|----------|
| Create market (strike $69,858) | `create-updown-market` | [TX](https://explorer.hiro.so/txid/0x7a656e6771b77af15f0bc6e4a2c3296bc4688edc560369095b7df1fc1f7ac808?chain=mainnet) |
| MINT trade settled | `fill-order` (Alice YES + Bob NO) | Settled via engine |
| COMPLEMENTARY trade settled | `fill-order` (Alice sells to Charlie) | Settled via engine |
| Market resolved (DOWN) | `resolve-updown-market` | [TX](https://explorer.hiro.so/txid/0x2023b0f30e1b0430492e650d0c1eecdc79810b526abe5f667b2aa05de4f5e745?chain=mainnet) |
| Bob auto-redeemed (winner) | `redeem-for` | Auto-redeemed by engine |

Result: Bob (DOWN) won. Alice limited loss by selling mid-session. Charlie (bought YES at $0.60) lost.

---

## Yield Strategies — Deep Dive

### Strategy 1: sBTC Carry (v31)

**Flow:** sBTC → Zest v2 collateral → borrow USDCx → swap to aeUSDC (Bitflow) → lend on Zest v1

**Yield source:** Zest v1 aeUSDC supply rate (live from `pool-0-reserve::get-reserve-state`)

**Borrow cost:** Zest v2 USDC vault rate (live from `v0-vault-usdc::get-interest-rate`)

| Metric | Value | Source |
|--------|-------|--------|
| Earn rate | 6.82% | Zest v1 aeUSDC supply |
| Borrow cost | 1.02% | Zest v2 USDC vault |
| Net spread | 5.80% | On borrowed capital |
| At 40% LTV | ~2.3% | On deposited sBTC |

Verified on-chain:
- Deposit: [TX](https://explorer.hiro.so/txid/0x2442b84130f32af7f8e6401f7a7f10b059931e22e86708344c9af47db3930c00?chain=mainnet)
- Withdraw: [TX](https://explorer.hiro.so/txid/0x653473785a2be78714f0ce6519059708bf062a8574e146127b81e6823184ddce?chain=mainnet)

### Strategy 2: Granite Carry (v2)

**Flow:** sBTC → Zest v2 collateral → borrow USDCx → swap to aeUSDC (Bitflow) → deposit on Granite Finance

**Yield source:** Granite LP yield (92% utilization, 7.06% earn APY per Granite UI)

Same borrow cost as sBTC Carry. Granite has higher utilization than Zest v1, resulting in slightly higher yield.

Verified on-chain:
- Deposit: [TX](https://explorer.hiro.so/txid/0x8d27f5b0169bbdde491fd001502a86ba34ab75e0ed11bb52b0607dbcefd648e1?chain=mainnet)
- Withdraw: [TX](https://explorer.hiro.so/txid/0xa1649a034c47443b22944c59c73f46eb2fb382e8055af0374371f5a6bcf0e6b6?chain=mainnet)

### Strategy 3: stSTX Yield (v10)

**Flow:** sBTC → Zest v2 collateral → borrow USDCx → swap to aeUSDC (Bitflow stableswap) → swap to STX (Bitflow XYK AMM) → swap to stSTX (Bitflow stableswap)

This strategy routes through 3 DEX swaps to convert cheap borrowed USDCx into stSTX, which earns PoX stacking yield. The key insight: borrowing USDCx (1.02%) instead of STX directly (5.83%) dramatically improves the spread.

**Yield source:** stSTX PoX stacking (~6%)

| Metric | Old (v3, borrow STX) | New (v10, borrow USDCx) |
|--------|---------------------|------------------------|
| Borrow cost | 5.83% | 1.02% |
| Net spread | 0.17% | 4.98% |
| At 40% LTV | 0.07% | ~2.0% |
| Max LTV | 30% (sBTC+STX) | 60% (sBTC+USDC) |

Verified on-chain:
- Deposit: [TX](https://explorer.hiro.so/txid/0x269bdc916414a40f5c6ab49ecb556d0c42a645ad10424f097230cb5e92d55993?chain=mainnet)
- Withdraw: [TX](https://explorer.hiro.so/txid/0x027954807e4f492bfd808caf7eb57e99c9b50d32acfe44ba29d9aa54b79f318a?chain=mainnet)

### How Withdrawal Works

On withdrawal, the strategy unwinds itself atomically:

1. Withdraw/redeem yield tokens (aeUSDC from Zest/Granite, or stSTX)
2. Swap back through the reverse route to USDCx
3. Repay the USDCx loan to Zest v2
4. If swap output < debt (slippage), pull the small gap (~$0.50-1) from user's wallet
5. Remove sBTC collateral and return to user

The user gets their sBTC back plus any profit (yield earned minus borrow cost minus swap slippage).

---

## Project Structure

```
stacky/
├── contracts/
│   ├── prediction/          # Prediction market contracts
│   │   ├── stacky-math.clar
│   │   ├── stacky-governance-v2.clar
│   │   ├── stacky-oracle-v3.clar
│   │   ├── stacky-outcome-tokens-v3.clar
│   │   └── stacky-exchange-v6.clar
│   ├── yield/               # Yield strategy contracts
│   │   ├── stacky-carry-v31.clar
│   │   ├── stacky-granite-carry-v2.clar
│   │   ├── stacky-stx-staking-v10.clar
│   │   ├── token-scbtc.clar / token-sabtc.clar / token-sbbtc.clar
│   │   └── stacky-aggregator.clar / stacky-router.clar
│   └── mock/                # Testing only
│       └── sbtc-token.clar
├── scripts/
│   ├── matching-engine.mjs  # Off-chain order book + settlement
│   ├── keeper.mjs           # Market lifecycle (create/resolve)
│   ├── market-maker.mjs     # Algorithmic liquidity (Black-Scholes)
│   ├── mainnet-e2e-test.mjs # Self-contained mainnet demo
│   ├── deploy-prediction-market.mjs
│   └── lib/config.mjs
├── tests/                   # Clarinet unit tests (73 passing)
├── app/                     # Next.js frontend
│   └── src/
│       ├── app/markets/     # Prediction market trading UI
│       ├── app/loans/       # Yield vault UI
│       ├── hooks/           # Contract interaction hooks
│       └── lib/             # Constants, helpers
└── Clarinet.toml
```

---

## Running Locally

### Prerequisites

- Node.js 20+
- Clarinet 3.8+
- Stacks wallet (Leather or Xverse)

### Setup

```bash
git clone https://github.com/collinsville22/stacky.git
cd stacky
npm install
cd app && npm install && cd ..
```

### Tests

```bash
npm test
```

5 test files, 73 tests covering all prediction market contracts.

### Development

```bash
# Start matching engine
node scripts/matching-engine.mjs

# Start frontend
cd app && npm run dev

# (Optional) Start keeper for continuous markets
node scripts/keeper.mjs 5m

# (Optional) Start market maker for liquidity
node scripts/market-maker.mjs
```

### Mainnet E2E Demo

Self-contained test that creates a market, funds 3 wallets with real sBTC, executes MINT and COMPLEMENTARY trades, resolves, redeems, and returns all funds:

```bash
node scripts/matching-engine.mjs  # in one terminal
node scripts/mainnet-e2e-test.mjs # in another
```

---

## Deployed Contracts

All contracts deployed at: [`SPCG3TNZXGFP36E4QGQN92TBM3JYF7E4PHGGR120`](https://explorer.hiro.so/address/SPCG3TNZXGFP36E4QGQN92TBM3JYF7E4PHGGR120?chain=mainnet)

### Prediction Market
| Contract | Purpose |
|----------|---------|
| `stacky-outcome-tokens-v3` | Market creation, YES/NO tokens, resolution |
| `stacky-exchange-v6` | Escrow settlement, 3 match types |
| `stacky-oracle-v3` | BTC/USD oracle (Pyth + manual) |
| `stacky-governance-v2` | Access control, pause mechanism |
| `stacky-math` | Fixed-point arithmetic library |

### Yield Strategies
| Contract | Strategy | Yield Source |
|----------|----------|-------------|
| `stacky-carry-v31` | sBTC → borrow USDC → lend aeUSDC on Zest v1 | Zest lending rate |
| `stacky-granite-carry-v2` | sBTC → borrow USDC → lend aeUSDC on Granite | Granite lending rate |
| `stacky-stx-staking-v10` | sBTC → borrow USDC → swap to stSTX | PoX stacking yield |

### External Protocol Integrations
| Protocol | Contract | Usage |
|----------|----------|-------|
| Zest v2 | `SP1A27KFY4XERQCCRCARCYD1CC5N7M6688BSYADJ7.v0-4-market` | Collateral, borrowing |
| Zest v1 | `SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-0-reserve` | aeUSDC lending |
| Granite | `SP26NGV9AFZBX7XBDBS2C7EC7FCPSAV9PKREQNMVS.liquidity-provider-v1` | aeUSDC lending |
| Bitflow | `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.stableswap-*` | Token swaps |
| Bitflow XYK | `SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-core-v-1-1` | aeUSDC/STX swaps |
| StackingDAO | `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token` | Liquid staking |
| sBTC | `SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token` | Bitcoin-backed collateral |

---

## Frontend

Built with Next.js 15, Tailwind CSS v4, and custom design system.

Design: warm dark theme ("Copper Terminal") with Instrument Serif headlines, Outfit body text, IBM Plex Mono for data. Asymmetric layouts, dense information panels, copper/amber accents.

The frontend queries live protocol rates from Zest and Granite every 30 seconds to display real-time APY for each yield strategy.

---

## Security Notes

- All yield strategy contracts have comprehensive emergency functions for manual unwind
- Prediction market exchange uses order nonce tracking to prevent replay attacks
- Governance-v2 controls authorization for all contract interactions
- Oracle uses Pyth price feeds with staleness checks (36 block max)
- No private keys in the repository
- All contracts deployed with Clarity version 3
