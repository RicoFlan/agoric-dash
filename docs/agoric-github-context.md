# Agoric GitHub scan: additional context for AAT

Scanned 17 September 2026: the 92 public repos in `github.com/Agoric` (via the GitHub API, sorted by last push) plus the package and docs tree of agoric-sdk at `9712d748a`. Purpose: find context the AAT work should carry that `agoric-upstream-index.md` does not yet list. Findings are ordered by how much they change the plan.

---

## 1. Findings that change Release 1 (skill pack)

### `Agoric/agoric-dev-mcp` — an MCP server of Agoric development patterns (pushed 2025-12-12)

An MCP server, hosted at `https://agoric-dev-mcp.agoric-core.workers.dev/sse` (install: `claude mcp add --transport sse agoric-dev <url>`), exposing tools in ten categories: project setup, core patterns, contract structure, Zoe and ERTP, orchestration, durability, testing, debugging and tracing, security, discovery and help. Source under `src/tools/agoric/` is nine TypeScript files totalling about 125 KB of pattern text and snippets (core-patterns 14 KB, orchestration 16 KB, project-setup 17 KB, zoe-ertp 17 KB, testing 15 KB, durability 13 KB, debugging 12 KB, discovery 11 KB, security 10 KB).

**What this means.** The upstream-index finding that "nothing upstream teaches contract authoring from outside the SDK" was wrong. Agoric has already written a contract-authoring corpus for AI assistants; it is delivered as MCP tools rather than as skills, and it has not been touched since December 2025. Release 1 must be positioned relative to it, and the choice is Rico's:

- **Complement.** Skills and evals on top of the MCP: the skill pack teaches *when* to call which MCP tool, adds the devnet sharp edges and silent failures the MCP does not cover (to be verified by reading the nine files), and the eval harness measures the MCP with and without skills. The "we made AI good at Agoric" story becomes "we measured and closed the gaps in Agoric's own AI tooling", which is a stronger collaborative story and a weaker solo one.
- **Contribute.** Fold the sharp-edges catalogue and eval results into agoric-dev-mcp as pull requests, and keep only the skills, evals and CLI in AAT. Highest goodwill, least ownership.
- **Supersede.** Ignore it and ship the skill pack as planned. Not recommended: Chris will ask why, and the eval harness would be measuring against a baseline that omits Agoric's own tooling.

Before deciding: read the nine tool files against `agoric-devnet-sharp-edges.md` and note which of the 22 items the MCP already covers, then check whether the hosted endpoint is live and whether the pattern text has drifted from the SDK since December 2025 (it predates upgrade-23 and Node 22/24).

### `Agoric/agoric-hello-world` — an AI-generated scaffold with its own `CLAUDE.md` (pushed 2025-12-12)

A contract scaffold extracted from `packages/fast-usdc-contract` **by Claude Code (Opus 4.5)**; the repo includes `org-prompt.txt`, the original prompt, and a `CLAUDE.md` with build commands, the orchestration contract structure, an `ExoClassKit` pattern with `holder` / `invitationMakers` / `admin` facets, "critical patterns" (durable arrays must be replaced, not mutated; `zone.makeOnce` for singletons; inert invitations as receipts), and a testing section (`test/supports.js` with `setupHelloWorldTest`, `provideDurableZone`, `setUpZoeForTest`). Layout: `src/contract.js`, `src/flows.js`, `src/exos/greeter-kit.js`, `src/utils/`, `src/typeGuards.js`, `test/`.

**What this means.** Two things. It is the best current scaffold for the snippet corpus and for a Stage 0 manifest subject: it is small, current (December 2025, orchestration pattern, kits, guards), and already lint-able and ava-testable, so it beats dapp-offer-up and orchestration-basics on every axis except age of the docs that reference it. And its `CLAUDE.md` is a nine-month-old, Agoric-authored, one-page idioms guide; the Release 1 idioms guide should start from it and from agoric-sdk's `AGENTS.md` rather than from scratch. Note it still says Node 20.9+; the SDK has since dropped Node 20.

### `packages/create-dapp` in agoric-sdk

`yarn create @agoric/dapp foo` scaffolds a dapp from a template. Check which template it pulls (likely dapp-offer-up) and whether `agt` should wrap it, replace it, or offer `agoric-hello-world` as an alternative template.

---

## 2. Findings that change Stage 2 (VowScope, Vstorage Toolkit) and the trace format

### `Agoric/causeway` — a chain-log visualiser (pushed 2025-07-01)

Web app that turns `.slog` and `.json` chain logs into SVG causal diagrams; descends from a 2021 `agoric-sdk` PR (#3624) by dckc and, further back, the Causeway distributed-tracing tool from the E language (Stanley, Close, Miller). Fetches logs from GCP by date range for Agoric's own use.

**What this means.** This is prior art for VowScope, from the same intellectual lineage as Endo, and it operates on the SwingSet slog rather than on application-level trace events. VowScope's design (application-level structured events, Format A) is still right, but Format A should be able to *join* with slog data (block height, vat id, delivery/crank numbers) so a VowScope timeline can be lined up against a Causeway diagram of the same run. Add `agoric.crank` and `agoric.vat.id` as optional attributes to Format A.

### `packages/telemetry` in agoric-sdk

The SDK already exports SwingSet slog data to OpenTelemetry (`packages/telemetry`, no README but the package is the OTel bridge). The Stage 0 decision to base Format A on OTel spans is therefore not just convenient; it aligns with how the kernel already emits traces, and a VowScope viewer could in principle render both.

### `packages/client-utils` in agoric-sdk

`vstorage-kit.js`, `vstorage.js`, `smart-wallet-kit.js`, `signing-smart-wallet-kit.ts`, `smart-wallet-with-sequence.ts`, `sync-tools.js`, `network-config.js`, `rpc.js`, `marshalTables.js`, `bundle-utils.ts`, `codegen/`. This is the client layer the Vstorage Toolkit (Release 5) wraps. It already covers reading and watching vstorage, unmarshalling CapData with board references, and submitting wallet offers with sequence handling; the toolkit's own value is snapshot/diff, schema validation against the manifest, and the subscription library, not the RPC plumbing.

### `Agoric/agoric-subql` and `Agoric/ymax-subql` — SubQuery indexers (2025)

Indexers over state-change events, used by the Inter dashboard and the ymax product; docs.agoric.com has a SubQuery indexing guide. Relevant to Event Relay and to Sentinel: for historical queries an indexer beats polling vstorage, and the schemas show which state changes Agoric considers worth indexing.

---

## 3. Findings that change the eval harness and local environment

### `Agoric/agoric-3-proposals` — synthetic mainnet image (pushed 2026-08-31)

A Docker image (`ghcr.io/agoric/agoric-3-proposals:latest`) built by replaying every mainnet (agoric-3) proposal in sequence, with tests after each; `packages/synthetic-chain` is the CLI that builds it. Exposes REST 1317, gRPC 9090, RPC 26657.

**What this means.** For the eval harness and any "local chain" step, this image is a better base than the plain `agoric-sdk` image because its state matches mainnet (all upgrades applied, all core contracts present, real vbank assets). `agoric-deploy-sequence.md`'s `setup-local-chain.sh` uses `ghcr.io/agoric/agoric-sdk:latest`; consider switching. `a3p-integration/` in the SDK is the same machinery from the inside.

### `packages/boot` in agoric-sdk

`tools/supports.ts` (`makeSwingsetTestKit`), `tools/drivers.ts`, `walletFactoryContext.js`, `tools/ibc/`, `tools/axelar-supports.ts`. This runs a whole SwingSet in-process with a fake chain, so a CoreEval proposal and its contract can be tested in ava without Docker or Starship. For eval tasks that deploy or upgrade a contract (tasks 2, 11, 13), this is the harness to use; Starship is only needed for real IBC.

### `Agoric/instagoric` — Kubernetes specs for Agoric networks (pushed 2026-06-03)

How devnet and emerynet are stood up. Relevant to the Orchestration Readiness Probe (which chains and relayers each network actually runs) and to understanding why devnet timers and ICA behave as they do.

### `Agoric/testnet-load-generator` (2025-08) and `Agoric/tools-app` (2024-11)

Load generation for testnets, and a grab-bag tools app. Low priority; note for Sentinel and for the deferred resource-cost profiler.

---

## 4. Findings that give Studio and the gallery non-DeFi material

### `Agoric/dapp-agoric-basics` (pushed 2026-06-29)

Three contracts with proposals: `sell-concert-tickets`, `swaparoo`, `postal-service`, plus `platform-goals/` and helper modules (`objectTools.js`, `fixHub.js`, `collectFees.js`). Pushed more recently than either dapp in the upstream index and has a docs.agoric.com tutorial. Postal service and concert tickets are non-DeFi and map onto the "Zoe beyond DeFi" gallery idea; add to the index and check its pins.

### `Agoric/dapp-agoric-simple-dao` (pushed 2025-08-21)

A voting DAO contract: mints DAO tokens and membership NFTs, proposals, for/against votes, with a sequence diagram. Directly relevant to Studio recipe 1 (governance) and to the Quest/credential branch (membership NFTs as credentials). Check pins before use.

### `Agoric/zoe-sketchbook` (2023) and archived dapps

`zoe-sketchbook` was a lightweight way to draft Zoe contracts; archived dapps (`dapp-card-store`, `dapp-nft-drop`, `dapp-otc`, `dapp-oracle`, `dapp-simple-exchange`) are pre-durability and pre-orchestration. Historical only; do not use as snippet sources, but the archived list is useful as a "do not learn from these" set for the skill pack, since models will have trained on them.

---

## 5. SDK-internal documentation worth carrying

- `docs/architecture/` (ADR template, one ADR, state-sync), `docs/threat_models/` (README, generator, pegasus and vaultFactory models), `docs/typescript.md`, `docs/node-version.md`, `docs/env.md`, `docs/commit-hygiene.md`.
- `packages/SwingSet/docs/`: `vat-upgrade.md`, `timer.md`, `async.md`, `virtual-objects.md`, `garbage-collection.md`, `metering.md`, `how-to-replay.md`, `debugging.md`, `bundles.md`. The upgrade and timer docs are the authoritative source for sharp-edges items 9, 11 and 22; the idioms guide should cite them.
- `packages/orchestration/docs/types.md` (guards vs typedefs, the manifest generator's exact problem) and `docs/axelar-gmp/`.
- `packages/pola-io`: a least-authority I/O library for Node entrypoints; the ocap idiom in the skill pack and the Preflight "ambient authority" check should reference it.
- `packages/agoric-cli/src/commands/` (`gov.js`, `wallet.js`, `perf.js`, `test-upgrade.js`) — what `agoric` already does, so `agt` does not duplicate it.

---

## 6. Endo-adjacent history in the org

`powerbox` (2023, "wallet locator and petnames"), `make-flowcomm` (2024, "build a Vow/Flow manager"), and the 2019–2020 archived repos that moved into Endo (`SES`, `harden`, `captp`, `marshal`, `eventual-send`, `bundle-source`) and the TC39 proposal repos (`proposal-realms`, `proposal-frozen-realms`, `proposal-deterministic-js`, `proposal-petrify`). Not inputs to AAT, but they document the lineage the DCF story rests on, and `powerbox` is a prior attempt at the petname UI that the Endo daemon now owns.

---

## Recommended additions to `agoric-upstream-index.md`

| Repo | Why | Priority |
|---|---|---|
| agoric-dev-mcp | Existing AI-assistance corpus; Release 1 positioning depends on it | Now |
| agoric-hello-world | Current scaffold; snippet and manifest source; its CLAUDE.md seeds the idioms guide | Now |
| agoric-3-proposals | Mainnet-equivalent local chain image for the harness | Before v0.2 |
| dapp-agoric-basics | Newest dapp repo; non-DeFi contracts | Before Stage 2 |
| causeway | VowScope prior art; slog join for Format A | Before Release 7 |
| dapp-agoric-simple-dao | Governance recipe material | Before Stage 4 |
| instagoric, agoric-subql | Probe and Sentinel context | Before Stage 2 / Stage 5 |

## Decision needed

Release 1's positioning relative to `agoric-dev-mcp` (complement, contribute, or supersede). Everything else here is additive to the plan as written.
