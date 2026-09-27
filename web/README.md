# Oneway Launch frontend

A single Vite / React / TypeScript page for the deployed OWLN native-ETH pool on Sepolia. The ready-to-host export is `../dist/`; it is delivered with the source and npm lockfile. No server, remote font, analytics, API credential, or WalletConnect project ID is required.

**Public-safety disclosure:** blocking sells is the mechanism honeypots use. This launch is a disclosed, fixed 300-block test (about an hour on Sepolia), visible on-chain before anyone buys. OWLN-to-ETH swaps through this pool revert before the opening block. Liquidity can be removed during the window. An open window does not guarantee liquidity or execution. These are testnet assets.

## Install, build, preview

Use Node.js 24 and npm. Run from `web/`:

```sh
npm ci --cache ./.cache/npm
npm run build
npm run preview
```

Open the preview URL printed by Vite. `npm run dev` runs the source development server; first run `npm run build` so that the attested export exists. The development server serves the same `../dist/imd-deployment.json` through a Vite middleware. After changing configuration or ABI inputs, rebuild before continuing development. No temporary deployment map is needed.

The build typechecks, verifies the implementation-derived ABI files against the pinned Git commit and canonical Keccak hashes, builds with `base: './'`, then writes `dist/imd-deployment.json` from final bytes. It needs no `.imd/reads/` files. Source archives without Git still verify the ABI hashes. A Git checkout must retain the handoff's source commit.

Upload the **contents of `dist/`**, retaining all relative paths. Serve over HTTPS for browser wallets and Web Crypto (localhost is also supported). A gateway subpath such as `/ipfs/<CID>/` needs a trailing slash and no rewrite rules. Do not open `index.html` via `file://`, because browsers restrict JSON fetches there. The page requires network connectivity for live RPC reads.

## Configuration

`config/handoff.json` and `config/network.json` are preserved copies of the provided inputs. They are build inputs, not a second runtime address map. The app fetches only `./imd-deployment.json` and the ABI files it references. Pool keys, chain, public RPC endpoints, explorer links, swap/approval addresses and wallet-add parameters all come from that file. The full supplied `network` object and `walletAddChain` parameters are preserved unchanged.

Implementation ABIs remain in `../docs/abi/`. `scripts/prepare.mjs` verifies them and copies them into `public/abi/`; it also exports the minimal protocol ABI interfaces. Change a deployment only with a new validated handoff and matching ABI exports. Never edit the generated manifest manually. Always rebuild and run `npm run check:export` after an export change.

Wallet support is an injected EIP-1193 Ethereum provider (`window.ethereum`), including MetaMask-compatible extension/in-app wallets. If multiple wallets are installed, the injected provider selected by the browser/wallet is used. There is no multi-wallet discovery menu or WalletConnect connector. Missing-chain switching requests the supplied `wallet_addEthereumChain` parameters after error 4902, then switches again. Signing stays in the wallet. The disconnect button disconnects this page locally; it does not revoke wallet permissions or on-chain approvals.

## Validation

```sh
npm run typecheck
npm test
npm run check:export
PLAYWRIGHT_BROWSERS_PATH=./.cache/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=./.cache/playwright npm run test:browser
npm run check:live
```

Alternatively set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing Chromium executable. Browser tests own a temporary HTTP server and browser and close both. They use the **built export** at `/preview/`, deterministic wallet/RPC fixtures and no real funds. Evidence is written to `../docs/evidence/`.

`check:live` performs read-only RPC verification, a quoter call, and an `eth_call` simulation of a tiny buy using the public deployment transaction's sender as the simulated caller. It never signs or broadcasts. Read [validation](../docs/VALIDATION.md) for actual outcomes and limitations, [implementation notes](../docs/FRONTEND.md) for transaction details, and [the design system](../docs/DESIGN.md) for UI decisions.

## Conflicting assignment requirements

- The requested PoolSwapTest address is absent from the supplied network table. The later acceptance rule requires every swap, quote and approval to use that table. This frontend therefore uses **UniversalRouter**, Quoter and Permit2 from the unchanged table. PoolSwapTest is not used. This was surfaced for clarification; the documented default follows the later acceptance rule.
- A root `DESIGN.md` is outside the overriding write scope. The design documentation is delivered at **`docs/DESIGN.md`** instead. No root configuration, contract source, libraries, or workflow files were modified.
- `web/.gitignore` has an explicit one-file path budget. It excludes nested dependency, browser, npm and build-cache directories and dependency archives within `web/`. No other ignore file is changed.

The publisher handles source publication, IPFS pinning and site naming after delivery. This worker does not publish or redeploy.
