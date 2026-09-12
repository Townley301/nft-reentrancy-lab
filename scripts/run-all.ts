import { network } from "hardhat";

const { viem } = await network.create();

function title(text: string) {
  console.log(`\n=== ${text} ===`);
}

async function hypeBearsDemo() {
  title("1. HypeBears: same-function reentrancy");

  const vulnerable = await viem.deployContract("HypeBearsVulnerable");
  const vulnerableCallback = await viem.deployContract("HypeBearsCallbackStudent", [
    vulnerable.address,
  ]);
  const vulnerableTx = await vulnerableCallback.write.runLesson();

  console.log("vulnerable tx:", vulnerableTx);
  console.log("NFTs received from one lesson call:", String(await vulnerable.read.balanceOf([vulnerableCallback.address])));
  console.log("callback reentry succeeded:", await vulnerableCallback.read.reentrySucceeded());

  const fixed = await viem.deployContract("HypeBearsFixed");
  const fixedCallback = await viem.deployContract("HypeBearsCallbackStudent", [fixed.address]);
  const fixedTx = await fixedCallback.write.runLesson();

  console.log("fixed tx:", fixedTx);
  console.log("NFTs received after fix:", String(await fixed.read.balanceOf([fixedCallback.address])));
  console.log("callback reentry succeeded after fix:", await fixedCallback.read.reentrySucceeded());
}

async function deployOmni(poolName: "OmniPoolVulnerable" | "OmniPoolFixed") {
  const nft = await viem.deployContract("ToyERC721");
  const token = await viem.deployContract("ToyERC20");
  const pool = await viem.deployContract(poolName, [nft.address, token.address]);
  const borrower = await viem.deployContract("OmniBorrowerStudent", [pool.address, nft.address]);
  const liquidator = await viem.deployContract("OmniLiquidatorCallbackStudent", [
    pool.address,
    token.address,
  ]);

  await nft.write.mint([borrower.address, 1n]);
  await nft.write.mint([borrower.address, 2n]);
  await token.write.mint([pool.address, 100n]);
  await token.write.mint([liquidator.address, 1n]);
  await borrower.write.prepare([1n, 2n, 15n]);
  await liquidator.write.arm([borrower.address, 2n]);

  return { nft, pool, borrower, liquidator };
}

async function omniDemo() {
  title("2. OMNI: ERC-721 callback enters a different function");

  const vulnerable = await deployOmni("OmniPoolVulnerable");
  const vulnerableTx = await vulnerable.borrower.write.startWithdraw([
    1n,
    vulnerable.liquidator.address,
  ]);

  console.log("vulnerable tx:", vulnerableTx);
  console.log("remaining collateral:", String(await vulnerable.pool.read.collateralCount([vulnerable.borrower.address])));
  console.log("remaining unpaid toy debt:", String(await vulnerable.pool.read.debt([vulnerable.borrower.address])));
  console.log("cross-function reentry succeeded:", await vulnerable.liquidator.read.reentrySucceeded());

  const fixed = await deployOmni("OmniPoolFixed");
  let rejected = false;
  try {
    await fixed.borrower.write.startWithdraw([1n, fixed.liquidator.address]);
  } catch {
    rejected = true;
  }

  console.log("fixed unhealthy withdrawal rejected:", rejected);
  console.log("collateral still in fixed pool:", String(await fixed.pool.read.collateralCount([fixed.borrower.address])));
  console.log("receiver callbacks after rejection:", String(await fixed.liquidator.read.callbacks()));
}

async function deployRevest(protocolName: "RevestVulnerable" | "RevestFixed") {
  const asset = await viem.deployContract("ToyERC20");
  const fnft = await viem.deployContract("ToyERC1155");
  const protocol = await viem.deployContract(protocolName, [asset.address, fnft.address]);
  const callback = await viem.deployContract("RevestCallbackStudent", [
    protocol.address,
    asset.address,
    fnft.address,
  ]);

  await asset.write.mint([protocol.address, 100n]);
  await asset.write.mint([callback.address, 1n]);
  return { asset, protocol, callback };
}

async function revestDemo() {
  title("3. Revest: ERC-1155 callback and stale series ID");

  const vulnerable = await deployRevest("RevestVulnerable");
  const vulnerableTx = await vulnerable.callback.write.runLesson();
  console.log("vulnerable tx:", vulnerableTx);
  console.log("outer series ID:", String(await vulnerable.callback.read.createdId()));
  console.log("callback series ID:", String(await vulnerable.callback.read.additionalId()));
  console.log("student toy balance (started with 1):", String(await vulnerable.asset.read.balanceOf([vulnerable.callback.address])));
  console.log("classroom treasury balance (started with 100):", String(await vulnerable.asset.read.balanceOf([vulnerable.protocol.address])));

  const fixed = await deployRevest("RevestFixed");
  const fixedTx = await fixed.callback.write.runLesson();
  console.log("fixed tx:", fixedTx);
  console.log("fixed outer series ID:", String(await fixed.callback.read.createdId()));
  console.log("fixed callback series ID:", String(await fixed.callback.read.additionalId()));
  console.log("student toy balance after fix:", String(await fixed.asset.read.balanceOf([fixed.callback.address])));
  console.log("classroom treasury after fix:", String(await fixed.asset.read.balanceOf([fixed.protocol.address])));
}

await hypeBearsDemo();
await omniDemo();
await revestDemo();

console.log("\nAll values above exist only in Hardhat's temporary local chain.");
