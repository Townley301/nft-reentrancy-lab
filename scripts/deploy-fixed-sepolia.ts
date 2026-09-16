/**
 * Deploy FIXED minter only to Sepolia.
 * Never deploy HypeBearsVulnerable (or any Vulnerable*) to a public network.
 *
 *   pnpm exec hardhat run scripts/deploy-fixed-sepolia.ts --network sepolia
 */
import { network } from "hardhat";

const { viem } = await network.connect();

const minter = await viem.deployContract("HypeBearsFixedMinter");

console.log("Network: Sepolia (Fixed minter only)");
console.log("HypeBearsFixedMinter:", minter.address);
console.log("");
console.log("Next: set CONTRACT_ADDRESS in frontend/sepolia-mint.html (or frontend/config.js)");
console.log("Note: MetaMask EOA mint will NOT show the callback reentrancy window.");
console.log("      That lesson stays on local HypeBearsCallbackStudent / pnpm visual.");
