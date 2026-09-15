import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

describe("business invariants under bounded local callback scenarios", async function () {
  const { viem } = await network.create();

  describe("one-time mint right", function () {
    for (const contractName of ["HypeBearsVulnerable", "HypeBearsFixed"] as const) {
      it(`${contractName}: detects whether one address exceeds one NFT`, async function () {
        const victim = await viem.deployContract(contractName);
        const receiver = await viem.deployContract("HypeBearsCallbackStudent", [victim.address]);

        await receiver.write.runLesson();
        const balance = await victim.read.balanceOf([receiver.address]);

        assert.equal(balance <= 1n, contractName === "HypeBearsFixed");
      });
    }
  });

  describe("collateral must cover outstanding debt", function () {
    const borrowAmounts = [11n, 15n, 19n];

    async function fixture(poolName: "OmniPoolVulnerable" | "OmniPoolFixed", amount: bigint) {
      const nft = await viem.deployContract("ToyERC721");
      const token = await viem.deployContract("ToyERC20");
      const pool = await viem.deployContract(poolName, [nft.address, token.address]);
      const borrower = await viem.deployContract("OmniBorrowerStudent", [pool.address, nft.address]);
      const receiver = await viem.deployContract("OmniLiquidatorCallbackStudent", [
        pool.address,
        token.address,
      ]);
      await nft.write.mint([borrower.address, 1n]);
      await nft.write.mint([borrower.address, 2n]);
      await token.write.mint([pool.address, 100n]);
      await token.write.mint([receiver.address, 1n]);
      await borrower.write.prepare([1n, 2n, amount]);
      await receiver.write.arm([borrower.address, 2n]);
      return { pool, borrower, receiver };
    }

    for (const amount of borrowAmounts) {
      it(`vulnerable pool violates coverage at debt ${amount}`, async function () {
        const { pool, borrower, receiver } = await fixture("OmniPoolVulnerable", amount);
        await borrower.write.startWithdraw([1n, receiver.address]);
        const collateral = await pool.read.collateralCount([borrower.address]);
        const debt = await pool.read.debt([borrower.address]);
        assert.equal(debt <= collateral * 10n, false);
      });

      it(`fixed pool preserves coverage at debt ${amount}`, async function () {
        const { pool, borrower, receiver } = await fixture("OmniPoolFixed", amount);
        await assert.rejects(borrower.write.startWithdraw([1n, receiver.address]));
        const collateral = await pool.read.collateralCount([borrower.address]);
        const debt = await pool.read.debt([borrower.address]);
        assert.equal(debt <= collateral * 10n, true);
      });
    }
  });

  describe("FNFT payout must not exceed the caller's funded value", function () {
    const cases = [
      { outerQuantity: 3n, depositPerUnit: 1n, additionalQuantity: 1n },
      { outerQuantity: 5n, depositPerUnit: 2n, additionalQuantity: 2n },
      { outerQuantity: 8n, depositPerUnit: 3n, additionalQuantity: 2n },
    ];

    async function runCase(
      protocolName: "RevestVulnerable" | "RevestFixed",
      parameters: (typeof cases)[number],
    ) {
      const asset = await viem.deployContract("ToyERC20");
      const fnft = await viem.deployContract("ToyERC1155");
      const protocol = await viem.deployContract(protocolName, [asset.address, fnft.address]);
      const receiver = await viem.deployContract("RevestCallbackStudent", [
        protocol.address,
        asset.address,
        fnft.address,
      ]);
      const fundedValue = parameters.depositPerUnit * parameters.additionalQuantity;
      await asset.write.mint([protocol.address, 100n]);
      await asset.write.mint([receiver.address, fundedValue]);
      await receiver.write.runLessonWithParameters([
        parameters.outerQuantity,
        parameters.depositPerUnit,
        parameters.additionalQuantity,
      ]);
      return { finalBalance: await asset.read.balanceOf([receiver.address]), fundedValue };
    }

    for (const parameters of cases) {
      const label = `${parameters.outerQuantity}/${parameters.depositPerUnit}/${parameters.additionalQuantity}`;
      it(`vulnerable version violates funded-value invariant at ${label}`, async function () {
        const result = await runCase("RevestVulnerable", parameters);
        assert.equal(result.finalBalance <= result.fundedValue, false);
      });

      it(`fixed version preserves funded-value invariant at ${label}`, async function () {
        const result = await runCase("RevestFixed", parameters);
        assert.equal(result.finalBalance <= result.fundedValue, true);
      });
    }
  });
});
