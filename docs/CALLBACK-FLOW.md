# Full Callback Flow / NFT Callback Reentrancy (HypeBears-style)

> **Defensive teaching only**
> Two ledgers, CEI ordering, teaching receiver.
> **No attack PoC**, no phishing, no mainnet targets, no step-by-step attack playbook.
> Lab demonstrator: `HypeBearsCallbackStudent` (do not add a dedicated exploit contract).

Chinese+English friendly. See also `docs/全流程-回调重入.md` (same content).

---

## 0. How to run

```bash
pnpm install
pnpm test
pnpm demo
pnpm visual
# focused:
pnpm exec hardhat test nodejs test/hypebears-callback-flow.ts
```

Windows course path: `C:\\Users\\Yifeng\\OneDrive\\Documentos\\HKU\\COMP7610A\\CourseProject\\nft-reentrancy-lab`

---

## 1. Two ledgers

| Layer | Tracks | When receiver hook runs |
| --- | --- | --- |
| **Token ledger** | `ownerOf` / `balanceOf` | Already updated inside `_safeMint` **before** `onERC721Received` |
| **App ledger** | `addressMinted[addr]` | Still **old** if written **after** `_safeMint` |

CEI for NFT apps: finish application Effects before the first `safe*` / `_safeMint`.

---

## 2. Vulnerable flow

```text
Check require(!addressMinted) -> _safeMint (token ledger NEW + callback) -> late addressMinted=true
```

Same-tx callback window: teaching receiver may call `mintNFT` again while flag is still false.

Learning point **(a)**: `addressMintedDuringFirstCallback == false` on Vulnerable (asserted in `test/hypebears-callback-flow.ts`).

---

## 3. msg.sender identities (b)

| Context | msg.sender |
| --- | --- |
| Outer / reentry `mintNFT` | Student contract |
| Inside `onERC721Received` | NFT / toy contract |
| `operator` in this lab | Student (mint caller) |

Tests: `msgSenderDuringCallback == victim`, `operatorDuringCallback == student`.

---

## 4. Fixed CEI (c)

```text
Check -> addressMinted=true -> _safeMint -> reentry require fails -> balance 1
```

| | Vulnerable | Fixed |
| --- | --- | --- |
| Flag vs `_safeMint` | after | before |
| Flag in 1st callback | false | true |
| balanceOf after lesson | 2 | 1 |
| reentrySucceeded | true | false |

---

## 5. Auditor checklist

- [ ] List every safe mint/transfer Interaction
- [ ] App Effects before first external receiver call
- [ ] Token ledger can look correct while app ledger is stale
- [ ] Hook msg.sender is the token contract
- [ ] Snapshot app state inside callback in tests

---

## 6. Safety

Defensive teaching only. No exploit script / phishing / mainnet.

Optional Sepolia **Fixed-only** mint (EOA - no callback window): [`docs/SEPOLIA-MINT.md`](SEPOLIA-MINT.md).
