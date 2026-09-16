# NFT Callback Reentrancy Local Lab

Local teaching lab for NFT callback reentrancy (HypeBears / OMNI / Revest toy models).

## HypeBears callback-flow guide

- [`docs/CALLBACK-FLOW.md`](docs/CALLBACK-FLOW.md)
- [`docs/全流程-回调重入.md`](docs/全流程-回调重入.md)
- Learning-point tests: `test/hypebears-callback-flow.ts`

## Sepolia Fixed-only mint (optional)

Deploy **Fixed** minter only + static wallet page. **Do not** deploy Vulnerable publicly.

- Guide: [`docs/SEPOLIA-MINT.md`](docs/SEPOLIA-MINT.md)
- Page: `frontend/sepolia-mint.html`
- Deploy: `pnpm deploy:sepolia:fixed` (needs `.env`: `SEPOLIA_RPC_URL` + `DEPLOYER_PRIVATE_KEY`)

**Classroom note:** MetaMask EOA mint will **not** show the callback reentrancy window; that stays on local `HypeBearsCallbackStudent` / `pnpm visual`.

## Quick start

```bash
pnpm install
pnpm test
pnpm demo
pnpm visual
```

Copy `.env.example` to `.env` only if deploying Fixed to Sepolia. Never commit `.env`.

See full README history in repo for OMNI/Revest details, analyzer, and visual report.
