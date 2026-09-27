# Oneway Launch design

## Overview

A compact trading page for people inspecting a Sepolia launch before connecting a wallet. A warm neutral page, dark green countdown panel and white trade surface establish the reading order: understand the window, inspect the price, then review a trade. The page is a single document; hash links navigate its sections.

The tokens and reusable patterns live in `web/src/styles.css`, with page composition in `web/src/App.tsx` and the form in `web/src/TradeForm.tsx`. This file is under `docs/` because the assignment's overriding path budget prohibits creating a root `DESIGN.md`.

## Colors

These are the implemented semantic CSS properties, in their canonical hex notation:

| Token | Value | Role |
| --- | --- | --- |
| `--page` | `#f5f4ef` | Page canvas |
| `--surface` | `#ffffff` | Trade card, selected direction |
| `--surface-soft` | `#efefe9` | Input and evidence backgrounds |
| `--text` | `#20241e` | Main text and ETH marker |
| `--muted` | `#60645b` | Hints, labels, secondary information |
| `--border` | `#d9dbd1` | Structural dividers |
| `--control-border` | `#858c7a` | Interactive boundaries |
| `--accent` / `--accent-hover` | `#d8ef83` / `#c5e06c` | Primary action and launch progress |
| `--forest` | `#273b2b` | Countdown panel |
| `--forest-text` / `--forest-muted` | `#f2f4e8` / `#c2cdbb` | Panel text |
| `--forest-track` | `#53634d` | Unelapsed progress and panel dividers |
| `--warning-bg` / `--warning-text` | `#f2e9dd` / `#59401f` | Permanent lock disclosure |
| `--error-bg` / `--error-text` | `#f9e9e4` / `#8d3023` | Recoverable errors |
| `--focus` | `#32651a` | Keyboard focus and live-reading dot |

The accent is used for the primary transaction path, brand arrow and explicitly labeled progress; progress is not interactive. State always has text alongside color. There is one light theme. Measured rendered text pairs range from 5.49:1 for muted text on the page to 13.65:1 for main text on the quote background; full measurements and scope are in `evidence/contrast.json`. This is not a claim that every possible state or forced-color combination was measured.

## Typography

The family stack is `Inter, "Helvetica Neue", Arial, sans-serif`; no font is downloaded or bundled. Availability depends on the device, and Inter is not promised to be installed. Code uses `"SFMono-Regular", Consolas, monospace`. Body line-height is 1.55. The site requests weights 400, 500 and 600; font synthesis is disabled. Exact face selection across operating systems was not verified.

- Main heading: `clamp(2.1rem, 4.2vw, 3.25rem)`, weight 500, line-height 1.1, tracking −0.055em.
- Section headings: 1.5rem (1.375rem on small screens), weight 500, tracking −0.035em. The trade card's compact heading is 1.125rem/600.
- Body role: 1rem. UI labels: 0.875rem. Secondary body: 0.8125rem. Small hints: 0.75rem. Eyebrows/captions: 0.6875rem, with 0.625rem reserved for small-screen metadata.
- Countdown: 4–6.25rem by viewport, weight 400, tracking −0.065em. Amount input: 2rem. Values use tabular numerals.
- Inputs stay at least 16px. Headings use balanced wrapping, descriptions use pretty wrapping, and addresses wrap anywhere rather than being clipped. Full account/transaction addresses remain available via native title, deployment details or explorer links.

## Layout

`.shell` caps content at 1200px with 40px side gutters on large displays, 24px below 68rem, and 16px below 37rem. The main grid uses a 1.55:1 ratio with a 340px minimum trade column and a 24px gap. Sections use 24–56px spacing; internal related controls generally use 8–16px.

At 68rem, header navigation is hidden and cards use 24px padding. At 53rem, the trading columns stack in document order. At 37rem, cards use 20px inline padding, the how-it-works and evidence grids become single-column, window facts reduce to two columns, and the footer wraps. The countdown comes before the form on mobile, preserving the disclosure before any transaction.

The final export was rendered at 1440, 900, 768, 390 and 320 CSS pixels with no horizontal page overflow. 200% root text enlargement was checked at 390px; native browser zoom is a separate unperformed check. Long hashes remain selectable and wrap within their containers. No fixed-height text card or sticky overlay blocks scrolling.

## Elevation & Depth

The trade card has two restrained shadows: `0 2px 4px #20241e04` and `0 8px 26px #20241e08`. Selected direction buttons use `0 2px 4px #20241e08`. Other sections use tonal backgrounds and structural borders rather than additional elevation. The swap-direction separator has `z-index: 1`; the skip link uses 10. There are no modal overlays.

## Shapes

`--radius` is 1.5rem for the large cards; mobile cards use 20px. `--radius-control` is 0.75rem for controls and quote review. Amount boxes use 14px, badges use 6px, and the brand/coin/step markers are circles. Progress uses 30 equal segments with 2px corners. Structural borders are 1px. Controls target at least 44px height and the primary action at least 50px.

## Components

| Pattern | Source / reuse | States and behavior |
| --- | --- | --- |
| `Arrow`, brand and coin markers | `App.tsx`; inline SVG and CSS | Decorative elements are hidden from assistive technology; no external image dependency |
| Countdown panel | `.window-panel`, `.window-progress` | Unknown state uses dashes; verified state shows block countdown; textual open/locked status accompanies progress |
| `TradeForm` | `TradeForm.tsx` | Native direction buttons, exact amounts, quote review, approvals and confirmation; disabled when prerequisites fail |
| Buttons | `.primary`, `.secondary`, `.wallet-button`, `.text-button` | Filled primary action; secondary refresh after quote; hover, disabled, focus and pending labels |
| Fields | `.amount-box`, `.percent-input`, `.ack` | Persistent labels, decimal keyboard, `aria-invalid`, inline errors and focus on invalid input |
| Feedback | `.error-box`, `.transaction-status`, `.notice` | Error alerts and stable polite status region; submitted hash stays linked |
| Evidence links | `ContractLink`, `.contract-row`, `.protocol-links` | Real explorer links; addresses remain readable and selectable |
| Deployment disclosure | Native `details` / `summary` | Keyboard-operable disclosure of long pool/attestation identifiers |

Custom focus is a 3px solid `--focus` outline with a 4px offset. A keyboard-focused confirmation screenshot was inspected. Under forced colors, the outline uses system `Highlight`; forced-color rendering itself remains unverified. Buttons animate only background and press scale (0.96) over 120ms when the visitor has no reduced-motion preference. No page-load animation, modal or autoplay is used.

## Do's and Don'ts

Start another section with `.shell`, semantic headings and the existing spacing. Use `.primary` for the next consequential action and `.secondary` for peers. Keep input values, minimum output and status labels visible. Use existing warning/error roles, and write recoverable errors with the next action.

Do not replace unknown chain state with sample numbers, equate an open window with guaranteed liquidity, hide the lock disclosure, or add a second deployment address map. Keep static resources local and navigation compatible with gateway subpaths. Preserve native controls and the mobile document order.

## Guidance attribution

The six-domain review applies the pinned Better Interface guidance by Jakub Krehel, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` ([source](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface)). Documentation structure is adapted from Paul Bakaus's Impeccable, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` ([source](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md)). These guides informed this implementation; they were not republished as frontend source or treated as authority to change the assignment.
