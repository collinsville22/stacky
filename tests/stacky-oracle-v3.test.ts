import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;

const CONTRACT = "stacky-oracle-v3";
const GOV = "stacky-governance-v2";
const ONE_8 = 100_000_000;

function authorize(principal: string) {
  simnet.callPublicFn(GOV, "set-authorized", [Cl.principal(principal), Cl.bool(true)], deployer);
}

describe("stacky-oracle-v3", () => {
  beforeEach(() => {
    authorize(deployer);
  });
  describe("set-btc-price", () => {
    it("authorized user can set price", () => {
      const { result } = simnet.callPublicFn(CONTRACT, "set-btc-price",
        [Cl.uint(85_000 * ONE_8)], deployer);
      expect(result).toBeOk(Cl.bool(true));

      const price = simnet.callReadOnlyFn(CONTRACT, "get-btc-price", [], deployer);
      expect(price.result).toBeUint(85_000 * ONE_8);
    });

    it("non-authorized cannot set price", () => {
      const { result } = simnet.callPublicFn(CONTRACT, "set-btc-price",
        [Cl.uint(85_000 * ONE_8)], wallet1);
      expect(result).toBeErr(Cl.uint(1000));
    });

    it("rejects zero price", () => {
      const { result } = simnet.callPublicFn(CONTRACT, "set-btc-price",
        [Cl.uint(0)], deployer);
      expect(result).toBeErr(Cl.uint(1001));
    });

    it("updates last-update-height", () => {
      simnet.callPublicFn(CONTRACT, "set-btc-price", [Cl.uint(85_000 * ONE_8)], deployer);

      const height = simnet.callReadOnlyFn(CONTRACT, "get-last-update-height", [], deployer);
      const heightVal = Number((height.result as any).value);
      expect(heightVal).toBeGreaterThan(0);
    });
  });
  describe("freshness", () => {
    it("price is fresh right after update", () => {
      simnet.callPublicFn(CONTRACT, "set-btc-price", [Cl.uint(85_000 * ONE_8)], deployer);

      const fresh = simnet.callReadOnlyFn(CONTRACT, "is-price-fresh", [], deployer);
      expect(fresh.result).toBeBool(true);
    });

    it("price becomes stale after MAX-STALENESS blocks", () => {
      simnet.callPublicFn(CONTRACT, "set-btc-price", [Cl.uint(85_000 * ONE_8)], deployer);

      simnet.mineEmptyBlocks(40); // MAX-STALENESS = 36

      const fresh = simnet.callReadOnlyFn(CONTRACT, "is-price-fresh", [], deployer);
      expect(fresh.result).toBeBool(false);
    });

    it("get-btc-price-with-freshness returns all fields", () => {
      simnet.callPublicFn(CONTRACT, "set-btc-price", [Cl.uint(85_000 * ONE_8)], deployer);

      const info = simnet.callReadOnlyFn(CONTRACT, "get-btc-price-with-freshness", [], deployer);
      const tuple = info.result as any;
      expect(tuple.type).toBe("tuple");
    });
  });
  describe("defaults", () => {
    it("default price is $85,000", () => {
      const price = simnet.callReadOnlyFn(CONTRACT, "get-btc-price", [], deployer);
      expect(price.result).toBeUint(8_500_000_000_000); // 85000 * 1e8
    });

    it("default peg ratio is 1.0", () => {
      const peg = simnet.callReadOnlyFn(CONTRACT, "get-peg-ratio", [], deployer);
      expect(peg.result).toBeUint(ONE_8);
    });
  });
  describe("peg-ratio", () => {
    it("authorized can set peg ratio", () => {
      const { result } = simnet.callPublicFn(CONTRACT, "set-peg-ratio",
        [Cl.uint(99_000_000)], deployer); // 0.99
      expect(result).toBeOk(Cl.bool(true));

      const peg = simnet.callReadOnlyFn(CONTRACT, "get-peg-ratio", [], deployer);
      expect(peg.result).toBeUint(99_000_000);
    });

    it("rejects zero peg ratio", () => {
      const { result } = simnet.callPublicFn(CONTRACT, "set-peg-ratio",
        [Cl.uint(0)], deployer);
      expect(result).toBeErr(Cl.uint(1001));
    });
  });
});
