import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;

describe("stacky-governance", () => {
  it("deployer is owner", () => {
    const { result } = simnet.callReadOnlyFn("stacky-governance", "get-owner", [], deployer);
    expect(result).toBePrincipal(deployer);
  });

  it("starts unpaused", () => {
    const { result } = simnet.callReadOnlyFn("stacky-governance", "get-paused", [], deployer);
    expect(result).toBeBool(false);
  });

  it("owner can pause", () => {
    const { result } = simnet.callPublicFn("stacky-governance", "pause", [], deployer);
    expect(result).toBeOk(Cl.bool(true));
  });

  it("non-owner cannot pause", () => {
    const { result } = simnet.callPublicFn("stacky-governance", "pause", [], wallet1);
    expect(result).toBeErr(Cl.uint(1000));
  });

  it("owner can set authorized", () => {
    const { result } = simnet.callPublicFn(
      "stacky-governance", "set-authorized",
      [Cl.principal(wallet1), Cl.bool(true)],
      deployer
    );
    expect(result).toBeOk(Cl.bool(true));

    const { result: isAuth } = simnet.callReadOnlyFn(
      "stacky-governance", "is-authorized",
      [Cl.principal(wallet1)],
      deployer
    );
    expect(isAuth).toBeBool(true);
  });

  it("current epoch starts at 0", () => {
    const { result } = simnet.callReadOnlyFn("stacky-governance", "get-current-epoch", [], deployer);
    expect(result).toBeUint(0);
  });
});
