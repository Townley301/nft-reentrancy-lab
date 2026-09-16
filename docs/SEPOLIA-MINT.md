# Sepolia Fixed Mint Guide / Sepolia 固定铸造说明

> **Fixed only.** Deploy `HypeBearsFixedMinter` — never deploy `HypeBearsVulnerable` (or any Vulnerable*) to Sepolia or mainnet.

## Important classroom note

**MetaMask EOA mint does NOT show the callback reentrancy window.**  
EOAs have no `onERC721Received`. The CEI / callback lesson remains:

- local `HypeBearsCallbackStudent` (`pnpm test`, `test/hypebears-callback-flow.ts`)
- `pnpm visual` / `visual-report.html`
- `docs/CALLBACK-FLOW.md`

This Sepolia page only shows: connect wallet → `mintNFT` → `addressMinted` + `balanceOf` on the **Fixed** contract.

---

## 1. Get Sepolia ETH

1. Create / use a throwaway MetaMask account (no mainnet funds needed for class).
2. Switch network to **Sepolia**.
3. Use a public faucet (examples; availability changes):
   - https://sepoliafaucet.com/
   - https://www.alchemy.com/faucets/ethereum-sepolia
   - https://cloud.google.com/application/web3/faucet/ethereum/sepolia
4. Wait until the faucet tx confirms and the balance updates.

Also fund the **deployer** key (may be the same account) with enough Sepolia ETH for deploy gas.

---

## 2. Fill `.env` (never commit)

```bash
cp .env.example .env
```

Edit `.env`:

```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
```

- `.env` is already in `.gitignore`.
- Use a key that holds **only testnet** funds.
- Prefer Alchemy / Infura / your own Sepolia RPC.

`hardhat.config.ts` loads `.env` automatically when present, then reads `SEPOLIA_RPC_URL` and `DEPLOYER_PRIVATE_KEY` via Hardhat `configVariable`.

---

## 3. Deploy Fixed minter

```bash
pnpm install
pnpm exec hardhat compile
pnpm exec hardhat run scripts/deploy-fixed-sepolia.ts --network sepolia
# or: pnpm deploy:sepolia:fixed
```

Copy the printed `HypeBearsFixedMinter: 0x…` address.

---

## 4. Point the webpage at the contract

Edit `frontend/config.js`:

```js
window.SEPOLIA_FIXED_MINTER = "0xYOUR_DEPLOYED_ADDRESS";
```

Or paste the address into the input box on the page.

---

## 5. Open the page

Static file — no backend:

```bash
# from repo root, any static server, e.g.:
npx --yes serve frontend
# or open frontend/sepolia-mint.html directly (file:// may block some wallet providers; prefer a local static server)
```

Then:

1. Click **Connect Wallet** (MetaMask) — page loads **`addressMinted`** (and balance) right away.
2. Approve Sepolia if prompted.
3. Click **mintNFT()** once — on confirmation the page **auto-refreshes** `addressMinted` + `balanceOf` (Fixed CEI: flag true with balance 1).
4. Optional **Refresh status** anytime.
5. A second mint should fail (`already minted`).

Footer on the page: *EOA mint won’t show the callback window — see lab demo for that.*

---

## Files

| Path | Role |
| --- | --- |
| `contracts/hypebears/HypeBearsFixedMinter.sol` | Fixed CEI minter for Sepolia |
| `scripts/deploy-fixed-sepolia.ts` | Deploy Fixed only |
| `hardhat.config.ts` | `sepolia` network + env vars |
| `.env.example` | Template (no secrets) |
| `frontend/sepolia-mint.html` | Connect + mint + read status |
| `frontend/config.js` | `CONTRACT_ADDRESS` / minter address |
| `docs/CALLBACK-FLOW.md` | Local callback reentrancy teaching |

## Safety

- No Vulnerable deploy to Sepolia  
- No mainnet config  
- No `setApprovalForAll` / phishing UX  
- No attack PoC  
