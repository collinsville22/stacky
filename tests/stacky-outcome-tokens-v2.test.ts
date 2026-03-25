import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;
const wallet3 = accounts.get("wallet_3")!;

const CONTRACT = "stacky-outcome-tokens-v2";
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

function createUpdownMarket(label: string = "updown-5m", bettingBlocks: number = 5) {
  return simnet.callPublicFn(
    CONTRACT, "create-updown-market",
    [Cl.stringAscii(label), Cl.uint(bettingBlocks)],
    deployer
  );
}

function createMarket(question: string, targetPrice: number, resHeight: number, mType: string, startPrice: number) {
  return simnet.callPublicFn(
    CONTRACT, "create-market",
    [Cl.stringAscii(question), Cl.uint(targetPrice), Cl.uint(resHeight), Cl.stringAscii(mType), Cl.uint(startPrice)],
    deployer
  );
}

function splitCollateral(marketId: number, amount: number, sender: string) {
  return simnet.callPublicFn(CONTRACT, "split-collateral", [Cl.uint(marketId), Cl.uint(amount)], sender);
}

function mergeTokens(marketId: number, amount: number, sender: string) {
  return simnet.callPublicFn(CONTRACT, "merge-tokens", [Cl.uint(marketId), Cl.uint(amount)], sender);
}

function redeem(marketId: number, sender: string) {
  return simnet.callPublicFn(CONTRACT, "redeem", [Cl.uint(marketId)], sender);
}

function refundCancelled(marketId: number, sender: string) {
  return simnet.callPublicFn(CONTRACT, "refund-cancelled", [Cl.uint(marketId)], sender);
}

function getBalance(tokenId: number, owner: string) {
  return simnet.callReadOnlyFn(CONTRACT, "get-balance", [Cl.uint(tokenId), Cl.principal(owner)], deployer);
}

function getSupply(tokenId: number) {
  return simnet.callReadOnlyFn(CONTRACT, "get-total-supply", [Cl.uint(tokenId)], deployer);
}

describe("stacky-outcome-tokens-v2", () => {
  beforeEach(() => {
    authorize(deployer);
    setOraclePrice(10_000 * ONE_8);
  });
  describe("market creation", () => {
    it("creates updown market", () => {
      const { result } = createUpdownMarket();
      expect(result).toBeOk(Cl.uint(0));
    });

    it("increments market nonce", () => {
      createUpdownMarket("updown-5m", 5);
      createUpdownMarket("updown-15m", 10);
      const count = simnet.callReadOnlyFn(CONTRACT, "get-market-count", [], deployer);
      expect(count.result).toBeUint(2);
    });

    it("creates generic market", () => {
      const { result } = createMarket("Will BTC hit 100k?", 100_000 * ONE_8, 1000, "custom", 85_000 * ONE_8);
      expect(result).toBeOk(Cl.uint(0));
    });

    it("non-authorized cannot create", () => {
      const { result } = simnet.callPublicFn(
        CONTRACT, "create-updown-market",
        [Cl.stringAscii("updown-5m"), Cl.uint(5)],
        wallet1
      );
      expect(result).toBeErr(Cl.uint(1000));
    });
  });
  describe("resolution height enforcement", () => {
    it("cannot resolve before betting period ends", () => {
      createUpdownMarket("updown-5m", 10); // 10 blocks betting period

      setOraclePrice(11_000 * ONE_8);
      const { result } = simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);
      expect(result).toBeErr(Cl.uint(6005)); // ERR-MARKET-NOT-EXPIRED
    });

    it("can resolve after betting period ends", () => {
      createUpdownMarket("updown-5m", 5);

      simnet.mineEmptyBlocks(10);
      setOraclePrice(11_000 * ONE_8);
      const { result } = simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);
      expect(result).toBeOk(Cl.bool(true)); // price went up
    });

    it("YES wins when price >= target", () => {
      setOraclePrice(10_000 * ONE_8);
      createUpdownMarket("updown-5m", 5);

      simnet.mineEmptyBlocks(10);
      setOraclePrice(10_000 * ONE_8); // equal = YES wins (>=)
      const { result } = simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("NO wins when price < target", () => {
      setOraclePrice(10_000 * ONE_8);
      createUpdownMarket("updown-5m", 5);

      simnet.mineEmptyBlocks(10);
      setOraclePrice(9_999 * ONE_8);
      const { result } = simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);
      expect(result).toBeOk(Cl.bool(false));
    });

    it("cannot resolve twice", () => {
      createUpdownMarket("updown-5m", 5);
      simnet.mineEmptyBlocks(10);
      setOraclePrice(11_000 * ONE_8);
      simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);

      const { result } = simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);
      expect(result).toBeErr(Cl.uint(6004)); // ERR-MARKET-ALREADY-RESOLVED
    });
  });
  describe("split collateral", () => {
    it("deposits sBTC and receives YES + NO tokens", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);

      const { result } = splitCollateral(0, 1 * ONE_8, wallet1);
      expect(result).toBeOk(Cl.bool(true));

      expect(getBalance(0, wallet1).result).toBeUint(1 * ONE_8); // YES
      expect(getBalance(1, wallet1).result).toBeUint(1 * ONE_8); // NO
    });

    it("tracks total supply", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 2 * ONE_8, wallet1);

      expect(getSupply(0).result).toBeUint(2 * ONE_8);
      expect(getSupply(1).result).toBeUint(2 * ONE_8);
    });

    it("rejects split on resolved market", () => {
      createUpdownMarket("updown-5m", 5);
      mintSbtc(10 * ONE_8, wallet1);
      simnet.mineEmptyBlocks(10);
      setOraclePrice(11_000 * ONE_8);
      simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);

      const { result } = splitCollateral(0, 1 * ONE_8, wallet1);
      expect(result).toBeErr(Cl.uint(6002));
    });

    it("rejects split on cancelled market", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      simnet.callPublicFn(CONTRACT, "cancel-market", [Cl.uint(0)], deployer);

      const { result } = splitCollateral(0, 1 * ONE_8, wallet1);
      expect(result).toBeErr(Cl.uint(6009));
    });
  });
  describe("merge tokens", () => {
    it("burns YES + NO and returns sBTC", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 2 * ONE_8, wallet1);

      const { result } = mergeTokens(0, 1 * ONE_8, wallet1);
      expect(result).toBeOk(Cl.bool(true));

      expect(getBalance(0, wallet1).result).toBeUint(1 * ONE_8);
      expect(getBalance(1, wallet1).result).toBeUint(1 * ONE_8);
    });

    it("rejects if insufficient balance", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      simnet.callPublicFn(CONTRACT, "transfer",
        [Cl.uint(0), Cl.uint(1 * ONE_8), Cl.principal(wallet1), Cl.principal(wallet2)],
        wallet1
      );

      const { result } = mergeTokens(0, 1 * ONE_8, wallet1);
      expect(result).toBeErr(Cl.uint(6011));
    });
  });
  describe("redeem", () => {
    it("YES holder redeems after YES wins", () => {
      setOraclePrice(10_000 * ONE_8);
      createUpdownMarket("updown-5m", 5);
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      simnet.callPublicFn(CONTRACT, "transfer",
        [Cl.uint(1), Cl.uint(1 * ONE_8), Cl.principal(wallet1), Cl.principal(wallet2)],
        wallet1
      );

      simnet.mineEmptyBlocks(10);
      setOraclePrice(11_000 * ONE_8);
      simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);

      const { result } = redeem(0, wallet1);
      expect(result).toBeOk(Cl.uint(1 * ONE_8));
    });

    it("NO holder redeems after NO wins", () => {
      setOraclePrice(10_000 * ONE_8);
      createUpdownMarket("updown-5m", 5);
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      simnet.callPublicFn(CONTRACT, "transfer",
        [Cl.uint(0), Cl.uint(1 * ONE_8), Cl.principal(wallet1), Cl.principal(wallet2)],
        wallet1
      );

      simnet.mineEmptyBlocks(10);
      setOraclePrice(9_000 * ONE_8);
      simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);

      const { result } = redeem(0, wallet1);
      expect(result).toBeOk(Cl.uint(1 * ONE_8));
    });

    it("loser cannot redeem", () => {
      setOraclePrice(10_000 * ONE_8);
      createUpdownMarket("updown-5m", 5);
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      simnet.callPublicFn(CONTRACT, "transfer",
        [Cl.uint(0), Cl.uint(1 * ONE_8), Cl.principal(wallet1), Cl.principal(wallet2)],
        wallet1
      );

      simnet.mineEmptyBlocks(10);
      setOraclePrice(11_000 * ONE_8); // YES wins
      simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);

      const { result } = redeem(0, wallet1);
      expect(result).toBeErr(Cl.uint(6021));
    });

    it("cannot redeem before resolution", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      const { result } = redeem(0, wallet1);
      expect(result).toBeErr(Cl.uint(6003));
    });

    it("cannot redeem twice", () => {
      setOraclePrice(10_000 * ONE_8);
      createUpdownMarket("updown-5m", 5);
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      simnet.mineEmptyBlocks(10);
      setOraclePrice(11_000 * ONE_8);
      simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);

      redeem(0, wallet1);
      const { result } = redeem(0, wallet1);
      expect(result).toBeErr(Cl.uint(6022));
    });
  });
  describe("refund-cancelled", () => {
    it("refunds collateral from cancelled market", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 2 * ONE_8, wallet1);

      simnet.callPublicFn(CONTRACT, "cancel-market", [Cl.uint(0)], deployer);

      const { result } = refundCancelled(0, wallet1);
      expect(result).toBeOk(Cl.uint(2 * ONE_8));

      expect(getBalance(0, wallet1).result).toBeUint(0);
      expect(getBalance(1, wallet1).result).toBeUint(0);
    });

    it("refunds min(yes, no) when balances differ", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 2 * ONE_8, wallet1);

      simnet.callPublicFn(CONTRACT, "transfer",
        [Cl.uint(0), Cl.uint(1 * ONE_8), Cl.principal(wallet1), Cl.principal(wallet2)],
        wallet1
      );

      simnet.callPublicFn(CONTRACT, "cancel-market", [Cl.uint(0)], deployer);

      const { result } = refundCancelled(0, wallet1);
      expect(result).toBeOk(Cl.uint(1 * ONE_8));
    });

    it("rejects refund on non-cancelled market", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      const { result } = refundCancelled(0, wallet1);
      expect(result).toBeErr(Cl.uint(6006)); // ERR-MARKET-NOT-CANCELLED
    });

    it("rejects double refund", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);
      simnet.callPublicFn(CONTRACT, "cancel-market", [Cl.uint(0)], deployer);

      refundCancelled(0, wallet1);
      const { result } = refundCancelled(0, wallet1);
      expect(result).toBeErr(Cl.uint(6022)); // ERR-ALREADY-REDEEMED
    });

    it("rejects when user has no tokens", () => {
      createUpdownMarket();
      simnet.callPublicFn(CONTRACT, "cancel-market", [Cl.uint(0)], deployer);

      const { result } = refundCancelled(0, wallet1);
      expect(result).toBeErr(Cl.uint(6011)); // ERR-INSUFFICIENT-BALANCE
    });
  });
  describe("transfers", () => {
    it("user can transfer tokens", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      const { result } = simnet.callPublicFn(CONTRACT, "transfer",
        [Cl.uint(0), Cl.uint(5000_0000), Cl.principal(wallet1), Cl.principal(wallet2)],
        wallet1
      );
      expect(result).toBeOk(Cl.bool(true));
      expect(getBalance(0, wallet1).result).toBeUint(5000_0000);
      expect(getBalance(0, wallet2).result).toBeUint(5000_0000);
    });

    it("approved operator can transfer", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      simnet.callPublicFn(CONTRACT, "set-approved-operator",
        [Cl.principal(deployer), Cl.bool(true)], wallet1
      );

      const { result } = simnet.callPublicFn(CONTRACT, "transfer",
        [Cl.uint(0), Cl.uint(1 * ONE_8), Cl.principal(wallet1), Cl.principal(wallet2)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("unauthorized cannot transfer", () => {
      createUpdownMarket();
      mintSbtc(10 * ONE_8, wallet1);
      splitCollateral(0, 1 * ONE_8, wallet1);

      const { result } = simnet.callPublicFn(CONTRACT, "transfer",
        [Cl.uint(0), Cl.uint(1 * ONE_8), Cl.principal(wallet1), Cl.principal(wallet2)],
        wallet2
      );
      expect(result).toBeErr(Cl.uint(6020));
    });
  });
  describe("token IDs", () => {
    it("yes = market-id * 2", () => {
      const r = simnet.callReadOnlyFn(CONTRACT, "get-yes-token-id", [Cl.uint(5)], deployer);
      expect(r.result).toBeUint(10);
    });

    it("no = market-id * 2 + 1", () => {
      const r = simnet.callReadOnlyFn(CONTRACT, "get-no-token-id", [Cl.uint(5)], deployer);
      expect(r.result).toBeUint(11);
    });
  });
  describe("cancel market", () => {
    it("authorized can cancel", () => {
      createUpdownMarket();
      const { result } = simnet.callPublicFn(CONTRACT, "cancel-market", [Cl.uint(0)], deployer);
      expect(result).toBeOk(Cl.bool(true));
    });

    it("cannot cancel resolved market", () => {
      createUpdownMarket("updown-5m", 5);
      simnet.mineEmptyBlocks(10);
      setOraclePrice(11_000 * ONE_8);
      simnet.callPublicFn(CONTRACT, "resolve-updown-market", [Cl.uint(0)], deployer);

      const { result } = simnet.callPublicFn(CONTRACT, "cancel-market", [Cl.uint(0)], deployer);
      expect(result).toBeErr(Cl.uint(6004));
    });
  });
});
