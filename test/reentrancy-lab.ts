import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

describe("NFT callback reentrancy teaching lab", async function () {
  const { viem } = await network.create();

  describe("HypeBears", function () {
    it("vulnerable version lets one callback mint twice", async function () {
      const victim = await viem.deployContract("HypeBearsVulnerable");
      const callback = await viem.deployContract("HypeBearsCallbackStudent", [victim.address]);

      await callback.write.runLesson();

      assert.equal(await victim.read.balanceOf([callback.address]), 2n);
      assert.equal(await callback.read.reentrySucceeded(), true);
      assert.equal(await callback.read.callbacks(), 2n);
    });

    it("fixed version consumes the one-time right before the callback", async function () {
      const victim = await viem.deployContract("HypeBearsFixed");
      const callback = await viem.deployContract("HypeBearsCallbackStudent", [victim.address]);

      await callback.write.runLesson();

      assert.equal(await victim.read.balanceOf([callback.address]), 1n);
      assert.equal(await callback.read.reentrySucceeded(), false);
      assert.equal(await callback.read.callbacks(), 1n);
    });
  });

  describe("OMNI Protocol simplified model", function () {
    async function fixture(poolName: "OmniPoolVulnerable" | "OmniPoolFixed") {
      const nft = await viem.deployContract("ToyERC721");
      const loanToken = await viem.deployContract("ToyERC20");
      const pool = await viem.deployContract(poolName, [nft.address, loanToken.address]);
      const borrower = await viem.deployContract("OmniBorrowerStudent", [pool.address, nft.address]);
      const liquidator = await viem.deployContract("OmniLiquidatorCallbackStudent", [
        pool.address,
        loanToken.address,
      ]);

      await nft.write.mint([borrower.address, 1n]);
      await nft.write.mint([borrower.address, 2n]);
      await loanToken.write.mint([pool.address, 100n]);
      await loanToken.write.mint([liquidator.address, 1n]);

      await borrower.write.prepare([1n, 2n, 15n]);
      await liquidator.write.arm([borrower.address, 2n]);

      return { nft, loanToken, pool, borrower, liquidator };
    }

    it("vulnerable version loses both toy NFTs while debt remains", async function () {
      const { nft, pool, borrower, liquidator } = await fixture("OmniPoolVulnerable");

      await borrower.write.startWithdraw([1n, liquidator.address]);

      assert.equal((await nft.read.ownerOf([1n])).toLowerCase(), liquidator.address.toLowerCase());
      assert.equal((await nft.read.ownerOf([2n])).toLowerCase(), liquidator.address.toLowerCase());
      assert.equal(await pool.read.collateralCount([borrower.address]), 0n);
      assert.equal(await pool.read.debt([borrower.address]), 14n);
      assert.equal(await liquidator.read.reentrySucceeded(), true);
    });

    it("fixed version rejects the unhealthy withdrawal before any callback", async function () {
      const { nft, pool, borrower, liquidator } = await fixture("OmniPoolFixed");

      await assert.rejects(borrower.write.startWithdraw([1n, liquidator.address]));

      assert.equal((await nft.read.ownerOf([1n])).toLowerCase(), pool.address.toLowerCase());
      assert.equal((await nft.read.ownerOf([2n])).toLowerCase(), pool.address.toLowerCase());
      assert.equal(await pool.read.collateralCount([borrower.address]), 2n);
      assert.equal(await pool.read.debt([borrower.address]), 15n);
      assert.equal(await liquidator.read.callbacks(), 0n);
    });
  });

  describe("Revest Finance simplified model", function () {
    async function fixture(protocolName: "RevestVulnerable" | "RevestFixed") {
      const asset = await viem.deployContract("ToyERC20");
      const fnft = await viem.deployContract("ToyERC1155");
      const protocol = await viem.deployContract(protocolName, [asset.address, fnft.address]);
      const callback = await viem.deployContract("RevestCallbackStudent", [
        protocol.address,
        asset.address,
        fnft.address,
      ]);

      // 100 units are classroom treasury funds; the callback student owns only 1.
      await asset.write.mint([protocol.address, 100n]);
      await asset.write.mint([callback.address, 1n]);

      return { asset, fnft, protocol, callback };
    }

    it("vulnerable version reuses an ID and turns one deposit into six claims", async function () {
      const { asset, protocol, callback } = await fixture("RevestVulnerable");

      await callback.write.runLesson();

      assert.equal(await callback.read.createdId(), 2n);
      assert.equal(await callback.read.additionalId(), 2n);
      assert.equal(await callback.read.reentrySucceeded(), true);
      assert.equal(await asset.read.balanceOf([callback.address]), 6n);
      assert.equal(await asset.read.balanceOf([protocol.address]), 95n);
    });

    it("fixed version reserves distinct IDs and creates no extra claim", async function () {
      const { asset, protocol, callback } = await fixture("RevestFixed");

      await callback.write.runLesson();

      assert.equal(await callback.read.createdId(), 2n);
      assert.equal(await callback.read.additionalId(), 3n);
      assert.equal(await callback.read.reentrySucceeded(), true);
      assert.equal(await asset.read.balanceOf([callback.address]), 1n);
      assert.equal(await asset.read.balanceOf([protocol.address]), 100n);
    });
  });
});
