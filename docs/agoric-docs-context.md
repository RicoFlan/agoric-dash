# docs.agoric.com scan: content to add to the AAT context

Scanned 17 September 2026 from the `Agoric/documentation` repo at `d89bd22` (2026-04-28, still the upstream HEAD): 132 markdown pages under `main/`. The reference docs already in `docs/` drew on `what-is-agoric`, the Zoe, ERTP, Hardened JS and Orchestration overviews, `contract-basics`, `contract-details` and the docs walk-throughs. This note lists what else is there, ranked by usefulness to AAT, and what is stale enough to be an upstream fix.

---

## 1. Add now: pages that feed Stage 0 and Release 1 directly

| Page | Why it matters | Feeds |
|---|---|---|
| `guides/zoe/contract-upgrade.md` (270 lines) | The authoritative statement of kinds, incarnations, baggage, and the rule that every durable kind must be redefined on restart. This is the doc behind sharp-edges items 9 and 11, and the one a coding agent most needs and least often finds. | Idioms guide (durability), eval task 11, Preflight upgrade checks |
| `guides/coreeval/permissions.md` (65 lines) | `BootstrapManifestPermit`: the permit declares an upper bound on the powers a proposal may touch, with a catalogue of `BootstrapPowers` and explicit warnings on the dangerous ones (`agoricNamesAdmin`, `bankManager`, `chainStorage`, `namesByAddressAdmin`). | Format B `privateArgs`/required-capabilities section; Preflight capability report; the "permit as POLA" idiom |
| `guides/coreeval/proposal.md` (154 lines) and `local-testnet.md` (221) | How to write the core-eval script and run it on a local chain; the docs' version of `agoric-deploy-sequence.md`. | Project conventions; `agt` deploy; eval task 13 |
| `guides/orchestration/how-orch-works.md` (137) and `key-concepts.md` (129) | IBC, ICA and ICQ explained from Agoric's side, then the Orchestrator/Chain/Account API surface with brand utilities and address handling. The pair is the shortest correct primer for a model. | Idioms guide (orchestration); Probe terminology |
| `guides/orchestration/txvsportfolio.md` (167) | Transactional contracts (send-anywhere: one offer, no per-user state) vs portfolio contracts (auto-stake-it: long-lived positions, sub-accounts, continuing offers). A design vocabulary the plan does not yet use and Studio recipes should adopt. | Studio recipe design; idioms guide |
| `guides/zoe/pub-to-storage.md` (159) and `reference/vstorage-ref.md` (373) | Publishing structured data to chainStorage (marshalling, `boardAux`), and the full vstorage key layout: `published.*`, agoricNames hubs, well-known contracts and assets, provisionPool. The Vstorage Toolkit's schema source. | Vstorage Toolkit, Format B `published` section, Event Relay |
| `guides/getting-started/contract-rpc.md` (465) | Building client dapps: signing and broadcasting offers, querying vstorage, offer specs, marshalling amounts and instances, smart-wallet vstorage topics, vbank assets vs bank balances. The longest page on the site and the one that describes the client side `client-utils` implements. | Offer Lab, Vstorage Toolkit, Studio console |
| `guides/integration/name-services.md` (110) | `agoricNames`/`agoricNamesAdmin`, `namesByAddress` and deposit facets, the board. Explains why board ids change per deploy (sharp-edges 18). | Idioms guide; Vstorage Toolkit board resolution |
| `guides/zoe/contract-requirements.md` (179) | Making invitations, `bundleSource`, and a library-compatibility section: which npm packages run under Hardened JS. | Contract Preflight's compatibility rules, directly |

---

## 2. Add before Stage 2: reference and platform pages

| Page | Why |
|---|---|
| `reference/zoe-api/*` (12 pages: zoe, zoe-contract-facet, zcfseat, user-seat, zcfmint, zoe-helpers, zoe-data-types, ratio-math, price-authority, mutable-quote) and `reference/ertp-api/*` (8 pages) | The API reference the manifest generator and Offer Lab need for method signatures and data types. Cross-check against `packages/zoe/src/typeGuards.js`; the reference may lag the guards. |
| `guides/zoe/offer-enforcement.md` (230) and `offer-safety.md`, `proposal.md` | The mechanism behind offer safety, with a worked swap. Source for eval task 9 (explain why an offer is refunded). |
| `guides/zoe/contract-access-control.md`, `contract-state.md`, `contract-hello.md`, `contract-walkthru.md` | The `tut-01` to `tut-03` walk-throughs of dapp-offer-up; the snippet corpus's hello/state/access examples. |
| `guides/governance/index.md` (273) | Contract governance: parameter governance, electorate and election manager, putting and voting on questions, API governance. The on-chain governance primitives Studio recipe 1 and the Governance Autopilot branch would build on. Non-DeFi. |
| `guides/js-programming/notifiers.md` (332), `eventual-send.md`, `far.md` | Notifiers and subscriptions (the publish/subscribe layer under vstorage topics), plus the `E()` and `Far` primers. |
| `guides/agoric-cli/agd-query-tx.md` (260) | `agd` query and transaction cookbook: bank, gov, vstorage keys and data, keys, wallet actions. What `agt doctor` and `agt vstorage` shell out to. |
| `guides/platform/index.md` | SwingSet, Cosmos SDK, dynamic IBC, Tendermint in one page; useful for the plain-language docs. |
| `e2e-testing.md` (272) | Synpress/Cypress end-to-end tests driving Keplr. Relevant to the Studio hosted demo's own tests. |
| `guides/subquery-indexing.md` (38) | Short pointer to SubQuery; pairs with the `agoric-subql` repo for Sentinel. |
| `glossary/index.md` | Terminology the skill pack and plain-language docs should match exactly. |

---

## 3. Lower priority or historical

- `guides/zoe/contracts/*` (20 example contracts: atomic-swap, covered-call, escrow-to-vote, second-price-auction, barter-exchange, sell-items, mint-and-sell-nfts, oracle, otc-desk, loan, vault, AMM, call spreads, use-obj-example, automatic-refund, simple-exchange, mint-payments). Several are non-DeFi (escrow-to-vote, use-obj-example, mint-and-sell-nfts, sell-items) and are gallery candidates, but many predate durability; check each against current Zoe before use.
- `guides/zoe/actual-contracts/PSM.md` — Inter Protocol; sunset.
- `guides/zoe/price-authority.md`, `reference/zoe-api/price-authority*.md` — oracle pricing; DeFi-adjacent, skip.
- `guides/chainlink-integration.md` — oracle integration; skip.
- `guides/wallet/*`, `reference/wallet-api/*` (wallet bridge, wallet commands) — the legacy wallet UI; the smart wallet path in `contract-rpc.md` supersedes it.
- `reference/repl/*` (board, networking, priceAuthority, scratch, timerServices) — REPL-era reference; `timerServices.md` is still the linked Timer Service API and worth keeping for that reason.
- `guides/getting-started/ui-tutorial/*` (7 pages) and `UIComponentLibrary/` — React UI tutorial and component library; relevant when Studio's console is built.
- `guides/dapps/starting-multiuser-dapps.md` — multi-client local testing; useful for Studio recipe demos with two parties.

---

## 4. Stale content: candidate upstream fixes

These are cheap, visible contributions to the `documentation` repo and belong with the `llms.txt` offer already in the plan.

1. **`what-is-agoric.md`** still names IST as the fee token. IST was sunset in 2025; BLD is the fee token.
2. **`guides/coreeval/local-testnet.md`** tells developers to acquire IST to pay the `install-bundle` fee ("0.02 IST per kilobyte" as of proposal 61, November 2023) and shows `--gas auto` for the install. Both contradict current devnet behaviour recorded in `agoric-devnet-sharp-edges.md` items 14 and 15 (explicit `--gas 100000000`; `--gas auto` reports success and installs nothing). The fee-token change needs confirming against the current chain params before filing.
3. **`guides/dapps/dapp-templates.md`** lists Fungible Faucet, Card Store, OTC Desk and Oracle, all archived repos from 2022–2024. Should point at dapp-agoric-basics, dapp-offer-up and agoric-hello-world.
4. **`guides/coreeval/permissions.md`** example permit consumes the `IST` issuer and brand; still valid as syntax, but a post-sunset example should use BLD or USDC.
5. **No `llms.txt` or `llms-full.txt`** anywhere in the repo. The site is VitePress, so generating one from the sidebar config is mechanical.
6. **Node version.** `agoric-hello-world`'s CLAUDE.md and several docs pages still say Node 20.9+; the SDK requires `^22.11 || ^24.14`. Worth a sweep.

---

## 5. How to carry the docs in the repo

Do not copy the 132 pages into `docs/`. The `documentation` repo is Apache-2.0 and the pin (`d89bd22`) is recorded in `agoric-upstream-index.md`; the Mac Studio clone has it. For the skill pack, generate a compact `docs-index.md` (page path, title, one-line summary, which AAT component uses it) from the sidebar config, and have skills cite pages by path so a model can fetch the exact page rather than relying on training memory. That index is also the seed of the upstream `llms.txt`.

Recommended additions to `agoric-upstream-index.md`, "Docs contribution" section: the six stale-content items above and the pages in §1 as named inputs to Format B (`permissions.md`, `vstorage-ref.md`, `pub-to-storage.md`) and to Preflight (`contract-requirements.md`).
