import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;

describe("stacky-math", () => {
  it("mul-down: 1.5 * 2.0 = 3.0", () => {
    const { result } = simnet.callReadOnlyFn(
      "stacky-math", "mul-down",
      [Cl.uint(150000000), Cl.uint(200000000)],
      deployer
    );
    expect(result).toBeUint(300000000);
  });

  it("mul-down: 0 * anything = 0", () => {
    const { result } = simnet.callReadOnlyFn(
      "stacky-math", "mul-down",
      [Cl.uint(0), Cl.uint(200000000)],
      deployer
    );
    expect(result).toBeUint(0);
  });

  it("div-down: 3.0 / 2.0 = 1.5", () => {
    const { result } = simnet.callReadOnlyFn(
      "stacky-math", "div-down",
      [Cl.uint(300000000), Cl.uint(200000000)],
      deployer
    );
    expect(result).toBeUint(150000000);
  });

  it("div-down: 0 / anything = 0", () => {
    const { result } = simnet.callReadOnlyFn(
      "stacky-math", "div-down",
      [Cl.uint(0), Cl.uint(200000000)],
      deployer
    );
    expect(result).toBeUint(0);
  });

  it("div-down: anything / 0 = 0", () => {
    const { result } = simnet.callReadOnlyFn(
      "stacky-math", "div-down",
      [Cl.uint(300000000), Cl.uint(0)],
      deployer
    );
    expect(result).toBeUint(0);
  });

  it("min returns smaller value", () => {
    const { result } = simnet.callReadOnlyFn(
      "stacky-math", "min",
      [Cl.uint(500), Cl.uint(100)],
      deployer
    );
    expect(result).toBeUint(100);
  });

  it("max returns larger value", () => {
    const { result } = simnet.callReadOnlyFn(
      "stacky-math", "max",
      [Cl.uint(500), Cl.uint(100)],
      deployer
    );
    expect(result).toBeUint(500);
  });

  it("sbtc-to-usd: 1 sBTC at $100k", () => {
    const { result } = simnet.callReadOnlyFn(
      "stacky-math", "sbtc-to-usd",
      [Cl.uint(100000000), Cl.uint(10000000000000)],
      deployer
    );
    expect(result).toBeUint(10000000000000);
  });
});
