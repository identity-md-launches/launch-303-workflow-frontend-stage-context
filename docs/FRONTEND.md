# Frontend implementation

The implementation and static export bind to source commit `05ca781a8b9b5bc3b70c41c3ed239a79b00ec8c2`, launch `d2e637f2-10d7-48d9-90e7-9db146088506`. Contract source and the existing ABI exports are unchanged.

## Deployment binding

`web/scripts/prepare.mjs` compares each `docs/abi/<Contract>.json` byte-for-byte with `git show <sourceCommit>:docs/abi/<Contract>.json`. It computes Keccak-256 over UTF-8 JSON with recursively sorted object keys, unchanged array order and no whitespace. Both handoff hashes matched:

| Contract | Canonical ABI Keccak-256 |
| --- | --- |
| OWLN | `38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee` |
| BuyOnlyWindowHook | `da62f4d391653b0b46f20d5bb1f25c872d1f3c810e4c78fad4efe1561ef1f0d2` |

After Vite exports, `web/scripts/manifest.mjs` inventories every exported file except the manifest itself, including `index.html`, the favicon, bundled assets and all six JSON ABI files. Paths are relative and hashes are lowercase SHA-256. `check-export.mjs` checks exact inventory equality, identifiers, contract set, addresses, ABI hashes, network equality, wallet parameters, safe paths, relative resource URLs and size limits. The implementation ABIs are raw arrays, not synthetic ERC-20 substitutes. Protocol ABIs are deliberately minimal interfaces and are identified separately under `protocolAbis`.

`web/src/config.ts` loads this same manifest at runtime; no deployment addresses are compiled into a separate application map. It checks the configuration, SHA-256 of every loaded ABI, and canonical Keccak for the attested contracts. Before trading, `chain.ts` checks the RPC chain ID, nonempty code for both attested contracts and every protocol contract used for trading, and the hook and StateView PoolManager bindings. Presence of code and matching ABI/configuration are not bytecode verification or an independent audit. Publication's attestation checks remain separate.

## State and observability

The pool key is assembled from the handoff, with sorted currencies, fee 3000, tick spacing 60 and the hook address. Full ABI encoding yields pool ID `0x952f9be5d434ae962ee6744968896438fbb0b1cca96159fca56ec094ec0745ed`.

The page reads `opensAt`, `sellsOpen`, `WINDOW_BLOCKS`, token decimals/symbol/supply/balances, and StateView `getSlot0` / `getLiquidity`. A snapshot uses one block number for these reads. The two hook views must agree at that block. The `WindowSet` query filters by the exact pool ID and the inferred initialization block (`opensAt - WINDOW_BLOCKS`), avoiding unbounded log scans. Event failure has its own error and retry state.

Polling waits 15 seconds after each completed read. Concurrent manual/automatic reads for the same service are coalesced. Account/provider changes invalidate balances and verification; asynchronous results from the previous context are ignored. Read failures, readings older than 45 seconds, or a chain timestamp over 30 minutes old disable trading. Public RPCs are tried in configured order with 6.5-second timeouts, then a connected wallet provider on the correct chain is available as a fallback.

Countdown = `max(opensAt - currentBlock, 0)`. Minute estimates use the last 100 blocks' timestamps; a failed historical read falls back to an explicitly labeled 12-second estimate. Block height, not elapsed wall-clock time, decides eligibility. `sellsOpen == true` alone is insufficient: zero `opensAt` or zero pool price keeps the pool unavailable. Zero active liquidity does not itself disable quotes: the one-sided launch can sit at a tick boundary while an input swap crosses into liquidity. The quoter and transaction simulation determine executability.

Spot price is calculated from `sqrtPriceX96² / 2¹⁹²`, adjusted for token decimals; floating point is used only for display. Amounts, slippage, balances and transaction encoding use integer arithmetic. Values too small to display compactly are labeled `<0.000001`; exact quote and minimum output amounts remain visible.

## Transactions

The UI provides the requested primary workflows: buy, sell, quote, the required approval steps, wallet/network controls and receipt links. The hook exposes no user administrative action; its manager-only callbacks are not user controls. Generic ERC-20 transfer/transferFrom tools and liquidity management are outside this trading-page scope.

The explicit PoolSwapTest wording conflicts with the later network-address acceptance rule. The implementation follows that later rule and uses the table's **UniversalRouter**, not PoolSwapTest. The supplied `network` object is unmodified. This choice and the out-of-scope root design path are also recorded in `web/README.md`.

Quotes call Quoter `quoteExactInputSingle` via `simulateContract`, never a transaction. The form validates positive decimal input, token precision, balance, uint128 bounds and 0.01–5% slippage. Output minimum is rounded down in integer basis points and must stay positive. Quotes expire after 45 seconds and invalidate on amount, slippage, direction, account, chain, or eligibility changes. A buy during the lock requires an explicit acknowledgement.

UniversalRouter `execute(bytes,bytes[],uint256)` uses command `0x10`, actions `0x060c0f`, exact-input-single parameters, SETTLE_ALL and TAKE_ALL. Both swap and take enforce the output minimum. Native ETH buys attach the input as `value` and require no approvals. Sells offer distinct transactions: `OWLN.approve(Permit2, exactAmount)`, then `Permit2.approve(OWLN, UniversalRouter, exactAmount, expiration)`, then the sell. The Permit2 expiration is at most ten minutes from construction; the persistent ERC-20 allowance is only the exact selected amount. Existing adequate allowances are reused. Gas fees remain additional.

Before every signature, the page verifies deployment prerequisites, rereads live eligibility, asserts wallet chain/account, and simulates the exact requested call. It checks the account and quote again immediately before requesting a signature. Swap deadlines are five minutes from construction. Errors include nested `WrappedError`/`ExecutionFailed` decoding for `SellsLocked`; user rejection and receipt failure are distinguished. A submitted transaction retains its explorer link, and an uncertain receipt clears the quote instead of presenting a retry as if nothing was submitted.

## Interface references

The wire format follows the assignment's deployed-router tuple and the [Uniswap routing guide](https://developers.uniswap.org/docs/protocols/v4/guides/swapping/routing). Quoter parameter definitions were checked against [Uniswap's IV4Quoter](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol); StateView reads follow [Uniswap's StateView implementation](https://github.com/Uniswap/v4-periphery/blob/main/src/lens/StateView.sol). Current development branches can have newer tuple fields; the original tuple was retained and tested successfully against the supplied deployed router with `eth_call`.

The relevant protected Solidity floor suites and deployed source were read for context. They were not changed, rerun, or claimed as frontend validation. No independent contract audit, deployment, or publication is part of this delivery.
