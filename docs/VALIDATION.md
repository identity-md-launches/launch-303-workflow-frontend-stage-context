# Frontend validation record

Worker self-report, 27 September 2026. These checks are evidence of the work performed, not independent certification. The assignment's verifier checks paths and bytes; publication checks do not execute the browser or prove swap behavior.

## Scope and decisions

One static React/TypeScript page and its complete export in `dist/`, built with Vite's relative base. The supplied deployment and network inputs are retained under `web/config/`; runtime configuration is the final `dist/imd-deployment.json`. Deployed contracts, root build files, existing ABI exports, libraries and GitHub configuration remain unchanged.

Two assignment conflicts are resolved explicitly:

1. The requested PoolSwapTest address is not in the network block, while the later acceptance criterion requires every trade/quote/approval to use that block. The implementation follows the later criterion: UniversalRouter, Quoter and Permit2 are read from the unchanged network table. **PoolSwapTest is not implemented.** The conflict was raised for clarification with this default stated.
2. The overriding path scope excludes root `DESIGN.md`. The complete implemented design is documented in **`docs/DESIGN.md`**. No root design file was created.

Primary scope is buy/sell trading with required approvals. Manager-only hook callbacks and generic ERC-20 transfers are not presented as launch actions. Liquidity management, contract changes, redeployment, publication and an independent adversarial contract audit are outside this frontend stage.

## Commands and results

Run from `web/` unless otherwise noted. Node `v24.21.0`, npm `11.19.0`, Chromium `153.0.8010.12` were used.

| Check | Outcome |
| --- | --- |
| `npm install --no-audit --no-fund --cache /tmp/oneway-npm-cache` | Passed; exact package versions and npm lockfile delivered |
| `npm run build` | Passed after final source/config changes; includes `tsc --noEmit`, pinned ABI checks, Vite production build and post-export manifest generation |
| `npm test` | 10/10 core tests passed |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/root/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm run test:browser` | 12/12 production-browser scenarios passed; fixture-only wallet/RPC |
| `npm run check:export` | Passed exact configuration, ABI hashes, complete SHA-256 inventory, relative paths and limits |
| `npm run check:live` | Passed RPC/code/manager checks, hook views/event, StateView price, live buy quote and UniversalRouter buy `eth_call` |
| Foreground Vite development-server smoke check | Passed: `/imd-deployment.json` serves the same authoritative export as JSON |
| Bounded foreground production preview plus Playwright and available browser tool | Desktop/mobile final export inspected; resources loaded; no console warnings/errors observed |

The final production export contains **11 inventoried assets plus the manifest, totaling 529,886 bytes**. The manifest excludes itself. Every file is below 8 MiB, asset count is below 128, and the export is well below half the 64 MiB publication response budget. A final rebuild after adding the development-only middleware produced identical production asset names and hashes to the tested export. Final live rendering evidence was refreshed against those bytes. The complete tracked/candidate tree before the portable Git bundle was about 3.38 MB uncompressed; dependencies, caches and submodules were absent from the submission candidates.

## Interaction evidence

`evidence/browser-results.json` records individual results. The browser suite serves the real export under `/preview/`; all wallet sends and RPC responses in that suite are intercepted. It verifies:

- Public reads and initialization event without a wallet; fixed countdown and approximate minutes in a locked fixture.
- Missing-wallet help, connection rejection and recovery; wrong-chain message; switch → exact supplied add-chain parameters → switch again.
- Amount validation and focus on invalid input; locked buy acknowledgement; native ETH value, configured router destination and simulation before a mocked send; no buy approval.
- Sell ERC-20 and Permit2 approvals as separate steps, exact amount and expiring router allowance, then the encoded sell with a nonzero minimum output and no native value.
- Sell disabled at `opensAt - 1` and enabled at **exactly** `opensAt`; a boundary with zero active liquidity can still be quoted.
- Invalidation for changed amount, slippage, account and chain; expired quotes cannot request a signature.
- Failed simulation and wallet rejection make no wallet send; missing contract code, uninitialized pool, RPC failure and ABI tampering fail closed; RPC recovery restores the controls.
- Event failure differs from an empty event query and provides retry; slow requests do not start overlapping polling cycles.
- Keyboard navigation through the buy flow, visible focus, reduced-motion CSS, rendered contrast and no page overflow across representative widths.

Core tests independently decode swap payloads, check direction, settlement and take currencies, output minima, deadlines, native value, pinned ABI hashes and pool ID. They cover strict decimal/uint128/slippage boundaries, exact opening-block arithmetic, wallet chain/account changes and nested sell-lock errors.

The first browser run exposed two fixture/assertion issues (an ambiguous empty alert selector and clock installation after timers were created). Those were corrected, then the full suite passed. They were not reported as product defects or hidden as successful initial runs.

## Live-chain evidence and limits

`evidence/live-read.json` records a read-only check at block **11,791,691**. The pool's opening block was **11,791,632**, and `sellsOpen` returned true. `WindowSet` was found at initialization block **11,791,332**, matching the pool ID and deployment transaction. Hook and StateView PoolManager values matched the supplied table, and all required contract addresses had nonempty code.

A quoter simulation for `0.000001 ETH` returned `49.630160823989818792 OWLN`. A UniversalRouter buy with that input and 0.5% slippage successfully simulated with **`eth_call` only**, using the public deployment transaction sender as the simulated caller. No wallet was connected for this check, and no private key, signing operation or broadcast occurred.

No real buy, sell or approval was sent. Live sell execution, actual wallet extension prompts, account-switch timing inside a real wallet, mempool behavior, replacement transactions, gas affordability at signing time and receipt timeouts remain untested against real funds. The two-step approval/sell flow is proven here only by mocks and payload assertions. Public RPC availability can change. The frontend's code-presence checks are not an independent audit or full runtime bytecode comparison.

The Solidity protected suites and existing source were read, not rerun or modified. Contract-stage deployment and audit claims are not made by this report. No site was published, no CID was pinned and no named entrypoint was checked; those are later publisher/control-plane responsibilities.

## Better Interface review

The pinned contents/workflow and all six core domain sections were read before implementation. The documentation section was read before writing the final design document. Review coverage applies to the requested light, English, single-page experience.

| Domain | Coverage and evidence |
| --- | --- |
| Accessibility — Checked | Native buttons/links/forms/details, input labels and errors, disabled sell with adjacent explanation, skip link, keyboard flow, screenshot of focus, 44px control targets, reduced motion. Screen-reader sessions, native browser zoom, physical touch hardware and forced-colors rendering were not performed. |
| Layout — Checked | Final export at 1440, 900, 768, 390 and 320 CSS px. `scrollWidth == innerWidth` at each size. Screenshots reviewed for grouping, wrapping and clipped content. 200% root text enlargement at 390px passed. RTL and translated layouts are not supported/tested. |
| Writing — Checked | Labels name the action; separate quote/approval/swap and waiting/confirmed/rejected states; explicit sell-lock disclosure; labeled approximate minutes and spot price; concrete retry paths. No user-comprehension study performed. |
| Typography — Checked | Declared hierarchy, line-height, tabular numerals, full exact minimum values and wrapped hashes reviewed against real renders. System-font availability outside the worker was not verified; no external font assets are required. |
| Colors — Checked | Actual computed foreground/background pairs measured in Chromium: muted/page 5.49:1; disclosure 8.02:1; panel heading 10.81:1; panel hint 7.30:1; form hint 6.05:1; primary action 12.45:1; quote review 13.65:1. See `evidence/contrast.json`. This is a representative check, not a claim of exhaustive contrast or accessibility compliance. |
| UI — Checked | Unknown, disconnected, wrong-chain, loading, locked/open, quote, approval, pending/success, rejected, failed simulation/RPC/event and invalid deployment states exercised. Final focus and mobile button wrapping inspected. Reduced-motion transition duration measured as 0s. Slow-motion replay and OS-level themes were not tested; no overlays, theme toggle, autoplay or media are present. |

## Findings corrected

Locations refer to the delivered source.

| Severity / location | Finding, correction and recheck |
| --- | --- |
| High — `web/src/App.tsx:37` | Source review found that fixed-interval reads could continually supersede slow fallback responses and retain a previous account's balances. Added one active read per service, completion-based polling, account-state reset and stale-result protection. Slow-RPC browser scenario and account-change scenarios pass. |
| Medium — `web/src/TradeForm.tsx:69` | A post-submission receipt error could consult a stale React hash value and leave a reusable quote. The local submitted hash now preserves the receipt link, clears the quote and explains that a transaction was submitted. Reviewed in source; real receipt-timeout behavior remains untested. |
| Medium — `web/src/App.tsx:130`, `web/src/chain.ts:53` | A fallback 12-second estimate was previously labeled as a recent-block sample. Added the sample indicator and explicit fallback wording. Source reviewed; live evidence records the sampled branch. |
| Low — `web/src/styles.css:239` | At 320px the trade-direction labels wrapped unnecessarily. Reduced small-screen internal gap/padding. Final mobile screenshot shows both labels on one line with 44px targets. |
| Low — `web/src/styles.css:118` | Slippage input was about 40.8px high inside its container. Added a 44px minimum input height; measured in final mobile layout evidence. |
| Low — `web/src/TradeForm.tsx:113` | A screenshot exposed a just-created quote briefly displaying 46 seconds because the last UI tick preceded quote creation. Clamped display to the actual 45-second validity; expiry still checks actual time before signing. Rebuilt and reran all browser scenarios; final focus screenshot shows the corrected value. |

No unresolved blocking issue was observed within the implemented scope. The two literal requirement conflicts are disclosed above, not treated as silently satisfied.

## Evidence files

- `evidence/browser-results.json`: 12 scenario outcomes, browser version and timestamp.
- `evidence/contrast.json`: computed colors and measured ratios.
- `evidence/live-read.json`: read-only chain checks and buy simulation.
- `evidence/live-render.json`, `live-resources.txt`, `live-console.txt`: final resource/render checks.
- `evidence/live-desktop.png`, `live-mobile.png`: real public-RPC renders.
- `evidence/mock-locked-1440.png`, `mock-locked-390.png`, `mock-locked-320.png`: explicitly mocked locked-window renders.
- `evidence/mock-keyboard-focus.png`: mocked wallet/quote with the focused confirmation control.
- `evidence/live-desktop-snapshot.txt`, `live-mobile-layout.json`: accessibility structure and measured narrow layout, not screen-reader evidence.

The normal `git add`/commit attempt was rejected by the filesystem: `.git/index.lock` could not be created because `.git` is read-only. The commit is therefore delivered through `docs/submission.bundle`, built with isolated Git metadata under disposable `test/scratch/`. See `docs/SUBMISSION.md`. The original workspace Git metadata was not modified.

**Completion:** complete for the bounded frontend scope under the overriding write limits and later network-address acceptance rule, with the commit delivered in a portable bundle because the workspace Git metadata is read-only. A literal root `DESIGN.md` and PoolSwapTest routing remain excluded because of those conflicts. Publication and live transaction execution are not claimed.
