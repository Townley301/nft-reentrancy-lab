import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";

/**
 * HypeBears learning points (New Bot / classroom):
 * (a) callback window before addressMinted on Vulnerable
 * (b) msg.sender identities (NFT contract in hook; student as mint caller / operator)
 * (c) Fixed writes addressMinted before _safeMint → reentry require fails → balance 1
 *
 * Defensive teaching only — uses the existing HypeBearsCallbackStudent demonstrator.
 */
describe("HypeBears callback-flow learning points", async function () {
  const { viem } = await network.create();

  describe("(a) when _safeMint yields control", function () {
    it("Vulnerable: addressMinted still false inside the first receiver callback", async function () {
      const victim = await viem.deployContract("HypeBearsVulnerable");
      const student = await viem.deployContract("HypeBearsCallbackStudent", [victim.address]);

      await student.write.runLesson();

      assert.equal(await student.read.recordedFirstCallbackFlag(), true);
      assert.equal(await student.read.addressMintedDuringFirstCallback(), false);
      // After the outer mint returns, the late write has run:
      assert.equal(await victim.read.addressMinted([student.address]), true);
      assert.equal(await victim.read.balanceOf([student.address]), 2n);
      assert.equal(await student.read.reentrySucceeded(), true);
      assert.equal(await student.read.callbacks(), 2n);
    });

    it("Fixed: addressMinted already true inside the first receiver callback", async function () {
      const victim = await viem.deployContract("HypeBearsFixed");
      const student = await viem.deployContract("HypeBearsCallbackStudent", [victim.address]);

      await student.write.runLesson();

      assert.equal(await student.read.recordedFirstCallbackFlag(), true);
      assert.equal(await student.read.addressMintedDuringFirstCallback(), true);
      assert.equal(await victim.read.addressMinted([student.address]), true);
    });
  });

  describe("(b) msg.sender / operator identities (testable parts)", function () {
    it("hook msg.sender is the NFT contract; operator is the student mint caller", async function () {
      const victim = await viem.deployContract("HypeBearsVulnerable");
      const student = await viem.deployContract("HypeBearsCallbackStudent", [victim.address]);

      await student.write.runLesson();

      // Inside onERC721Received, msg.sender is always the token contract (EIP-721).
      assert.equal(
        (await student.read.msgSenderDuringCallback()).toLowerCase(),
        victim.address.toLowerCase(),
      );
      // Lab _safeMint forwards mintNFT's msg.sender as operator → the student.
      assert.equal(
        (await student.read.operatorDuringCallback()).toLowerCase(),
        student.address.toLowerCase(),
      );
    });

    it("same identities hold on Fixed (ordering change does not change hook identity rules)", async function () {
      const victim = await viem.deployContract("HypeBearsFixed");
      const student = await viem.deployContract("HypeBearsCallbackStudent", [victim.address]);

      await student.write.runLesson();

      assert.equal(
        (await student.read.msgSenderDuringCallback()).toLowerCase(),
        victim.address.toLowerCase(),
      );
      assert.equal(
        (await student.read.operatorDuringCallback()).toLowerCase(),
        student.address.toLowerCase(),
      );
    });
  });

  describe("(c) Fixed CEI → second require fails → balance 1", function () {
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
      assert.equal(await victim.read.addressMinted([callback.address]), true);
    });
  });
});
