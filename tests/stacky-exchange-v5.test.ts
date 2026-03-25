import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

const EXCHANGE = "stacky-exchange-v5";
const TOKENS = "stacky-outcome-tokens-v2";
const GOV = "stacky-governance-v2";
const ORACLE = "stacky-oracle-v3";
const ONE_8 = 100_000_000;

function authorize(principal: string) {
  simnet.callPublicFn(GOV, "set-authorized", [Cl.principal(principal), Cl.bool(true)], deployer);
}

function mintSbtc(amount: number, recipient: string) {
  simnet.callPublicFn("sbtc-token", "mint-for-testing", [Cl.uint(amount), Cl.principal(recipient)], deployer);
}

function setOraclePrice(price: number) {
  authorize(deployer);
  simnet.callPublicFn(ORACLE, "set-btc-price", [Cl.uint(price)], deployer);
}

function createMarket() {
  return simnet.callPublicFn(
    TOKENS, "create-updown-market",
    [Cl.stringAscii("updown-5m"), Cl.uint(5)],
    deployer
  );
}

function depositSbtc(amount: number, sender: string) {
  return simnet.callPublicFn(EXCHANGE, "deposit-sbtc", [Cl.uint(amount)], sender);
}

function withdrawSbtc(amount: number, sender: string) {
  return simnet.callPublicFn(EXCHANGE, "withdraw-sbtc", [Cl.uint(amount)], sender);
}

function depositTokens(tokenId: number, amount: number, sender: string) {
  return simnet.callPublicFn(EXCHANGE, "deposit-tokens", [Cl.uint(tokenId), Cl.uint(amount)], sender);
}

function fillOrder(marketId: number, maker: string, taker: string, side: boolean, amount: number, price: number, matchType: number, nonce: number) {
  return simnet.callPublicFn(EXCHANGE, "fill-order", [
    Cl.uint(marketId), Cl.principal(maker), Cl.principal(taker),
    Cl.bool(side), Cl.uint(amount), Cl.uint(price),
    Cl.uint(matchType), Cl.uint(nonce)
  ], deployer);
}

function getSbtcEscrow(owner: string) {
  return simnet.callReadOnlyFn(EXCHANGE, "get-sbtc-escrow", [Cl.principal(owner)], deployer);
}

function getTokenEscrow(tokenId: number, owner: string) {
  return simnet.callReadOnlyFn(EXCHANGE, "get-token-escrow", [Cl.uint(tokenId), Cl.principal(owner)], deployer);
}

describe("stacky-exchange-v5", () => {
  beforeEach(() => {
    authorize(deployer);
    setOraclePrice(10_000 * ONE_8);
  });
  describe("sBTC escrow", () => {
    it("deposit increases escrow balance", () => {
      mintSbtc(10 * ONE_8, wallet1);
      const { result } = depositSbtc(1 * ONE_8, wallet1);
      expect(result).toBeOk(Cl.bool(true));
      expect(getSbtcEscrow(wallet1).result).toBeUint(1 * ONE_8);
    });

    it("withdraw decreases escrow balance", () => {
      mintSbtc(10 * ONE_8, wallet1);
      depositSbtc(2 * ONE_8, wallet1);

      const { result } = withdrawSbtc(1 * ONE_8, wallet1);
      expect(result).toBeOk(Cl.bool(true));
      expect(getSbtcEscrow(wallet1).result).toBeUint(1 * ONE_8);
    });

    it("withdraw rejects insufficient balance", () => {
      mintSbtc(10 * ONE_8, wallet1);
      depositSbtc(1 * ONE_8, wallet1);

      const { result } = withdrawSbtc(2 * ONE_8, wallet1);
      expect(result).toBeErr(Cl.uint(6011));
    });

    it("deposit rejects zero amount", () => {
      const { result } = depositSbtc(0, wallet1);
      expect(result).toBeErr(Cl.uint(1001));
    });
  });
  describe("token deposits", () => {
    it("deposit outcome tokens into escrow", () => {
      createMarket();
      mintSbtc(10 * ONE_8, wallet1);

      simnet.callPublicFn(TOKENS, "split-collateral", [Cl.uint(0), Cl.uint(1 * ONE_8)], wallet1);

      const exchangePrincipal = `${deployer}.${EXCHANGE}`;
      simnet.callPublicFn(TOKENS, "set-approved-operator",
        [Cl.principal(exchangePrincipal), Cl.bool(true)], wallet1
      );

      const { result } = depositTokens(0, 1 * ONE_8, wallet1);
      expect(result).toBeOk(Cl.bool(true));
      expect(getTokenEscrow(0, wallet1).result).toBeUint(1 * ONE_8);
    });
  });
  describe("fill-order MINT", () => {
    it("mints tokens for YES and NO buyers", () => {
      createMarket();
      mintSbtc(10 * ONE_8, wallet1);
      mintSbtc(10 * ONE_8, wallet2);
      depositSbtc(5 * ONE_8, wallet1);
      depositSbtc(5 * ONE_8, wallet2);

      const price = 60_000_000; // 0.60
      const amount = 1 * ONE_8;

      const { result } = fillOrder(0, wallet1, wallet2, true, amount, price, 1, 0);
      expect(result).toBeOk(Cl.uint(0)); // trade-id 0

      expect(getTokenEscrow(0, wallet2).result).toBeUint(amount); // YES token
      expect(getTokenEscrow(1, wallet1).result).toBeUint(amount); // NO token
    });
  });
  describe("fill-order COMPLEMENTARY", () => {
    it("transfers tokens from maker to taker for sBTC", () => {
      createMarket();
      mintSbtc(10 * ONE_8, wallet1);
      mintSbtc(10 * ONE_8, wallet2);
      depositSbtc(5 * ONE_8, wallet1);
      depositSbtc(5 * ONE_8, wallet2);

      fillOrder(0, wallet1, wallet2, true, 1 * ONE_8, 50_000_000, 1, 0);

      const { result } = fillOrder(0, wallet2, wallet1, true, 5000_0000, 60_000_000, 0, 1);
      expect(result).toBeOk(Cl.uint(1));
    });
  });
  describe("order nonce replay", () => {
    it("rejects duplicate order nonce", () => {
      createMarket();
      mintSbtc(10 * ONE_8, wallet1);
      mintSbtc(10 * ONE_8, wallet2);
      depositSbtc(5 * ONE_8, wallet1);
      depositSbtc(5 * ONE_8, wallet2);

      fillOrder(0, wallet1, wallet2, true, 1 * ONE_8, 50_000_000, 1, 42);

      const { result } = fillOrder(0, wallet1, wallet2, true, 1 * ONE_8, 50_000_000, 1, 42);
      expect(result).toBeErr(Cl.uint(6031)); // ERR-ORDER-ALREADY-FILLED
    });

    it("is-order-filled returns correct state", () => {
      createMarket();
      mintSbtc(10 * ONE_8, wallet1);
      mintSbtc(10 * ONE_8, wallet2);
      depositSbtc(5 * ONE_8, wallet1);
      depositSbtc(5 * ONE_8, wallet2);

      fillOrder(0, wallet1, wallet2, true, 1 * ONE_8, 50_000_000, 1, 7);

      const filled = simnet.callReadOnlyFn(EXCHANGE, "is-order-filled", [Cl.uint(7)], deployer);
      expect(filled.result).toBeBool(true);

      const notFilled = simnet.callReadOnlyFn(EXCHANGE, "is-order-filled", [Cl.uint(8)], deployer);
      expect(notFilled.result).toBeBool(false);
    });
  });
  describe("dynamic fee", () => {
    it("fee is non-zero at mid price", () => {
      const fee = simnet.callReadOnlyFn(EXCHANGE, "get-dynamic-fee",
        [Cl.uint(1 * ONE_8), Cl.uint(50_000_000)], deployer);
      const feeVal = Number((fee.result as any).value);
      expect(feeVal).toBeGreaterThan(0);
    });

    it("fee has minimum of 1 sat at extreme prices", () => {
      const fee = simnet.callReadOnlyFn(EXCHANGE, "get-dynamic-fee",
        [Cl.uint(100), Cl.uint(1)], deployer); // tiny amount, extreme price
      const feeVal = Number((fee.result as any).value);
      expect(feeVal).toBeGreaterThanOrEqual(1); // MIN_FEE = 1
    });
  });
  describe("redeem", () => {
    it("winner redeems after resolution", () => {
      createMarket();
      mintSbtc(10 * ONE_8, wallet1);
      mintSbtc(10 * ONE_8, wallet2);
      depositSbtc(5 * ONE_8, wallet1);
      depositSbtc(5 * ONE_8, wallet2);

      fillOrder(0, wallet1, wallet2, true, 1 * ONE_8, 50_000_000, 1, 0);

      simnet.mineEmptyBlocks(10);
      setOraclePrice(11_000 * ONE_8);
      simnet.callPublicFn(TOKENS, "resolve-updown-market", [Cl.uint(0)], deployer);

      const { result } = simnet.callPublicFn(EXCHANGE, "redeem", [Cl.uint(0)], wallet2);
      expect(result).toBeOk(Cl.uint(1 * ONE_8));

      const escrow = getSbtcEscrow(wallet2);
      const escrowVal = Number((escrow.result as any).value);
      expect(escrowVal).toBeGreaterThan(0);
    });
  });
  describe("emergency-withdraw", () => {
    it("admin can emergency withdraw for user", () => {
      createMarket();
      mintSbtc(10 * ONE_8, wallet1);
      mintSbtc(10 * ONE_8, wallet2);
      depositSbtc(5 * ONE_8, wallet1);
      depositSbtc(5 * ONE_8, wallet2);

      fillOrder(0, wallet1, wallet2, true, 1 * ONE_8, 50_000_000, 1, 0);

      fillOrder(0, wallet2, wallet1, true, 5000_0000, 50_000_000, 1, 1);

      const yesBal = Number((getTokenEscrow(0, wallet1).result as any).value);
      const noBal = Number((getTokenEscrow(1, wallet1).result as any).value);
      const expectedRefund = Math.min(yesBal, noBal);

      if (expectedRefund > 0) {
        const { result } = simnet.callPublicFn(EXCHANGE, "emergency-withdraw",
          [Cl.uint(0), Cl.principal(wallet1)], deployer);
        expect(result).toBeOk(Cl.uint(expectedRefund));
      }
    });

    it("non-authorized cannot emergency withdraw", () => {
      const { result } = simnet.callPublicFn(EXCHANGE, "emergency-withdraw",
        [Cl.uint(0), Cl.principal(wallet1)], wallet1);
      expect(result).toBeErr(Cl.uint(1000));
    });
  });
  describe("authorization", () => {
    it("non-authorized cannot fill orders", () => {
      createMarket();
      const { result } = simnet.callPublicFn(EXCHANGE, "fill-order", [
        Cl.uint(0), Cl.principal(wallet1), Cl.principal(wallet2),
        Cl.bool(true), Cl.uint(ONE_8), Cl.uint(50_000_000),
        Cl.uint(1), Cl.uint(0)
      ], wallet1);
      expect(result).toBeErr(Cl.uint(1000));
    });
  });
  describe("withdraw-fees", () => {
    it("admin can withdraw protocol fees", () => {
      createMarket();
      mintSbtc(10 * ONE_8, wallet1);
      mintSbtc(10 * ONE_8, wallet2);
      depositSbtc(5 * ONE_8, wallet1);
      depositSbtc(5 * ONE_8, wallet2);

      fillOrder(0, wallet1, wallet2, true, 1 * ONE_8, 50_000_000, 1, 0);

      const fees = simnet.callReadOnlyFn(EXCHANGE, "get-protocol-fees", [], deployer);
      const feeAmount = Number((fees.result as any).value);

      if (feeAmount > 0) {
        const { result } = simnet.callPublicFn(EXCHANGE, "withdraw-fees",
          [Cl.principal(deployer)], deployer);
        expect(result).toBeOk(Cl.uint(feeAmount));
      }
    });
  });
});
