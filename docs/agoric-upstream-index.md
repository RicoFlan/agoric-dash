# Upstream Agoric repos: pinned index and findings

Updated 17 September 2026.

Two sets of clones exist. Shallow clones (depth 1, cloned 2026-09-15) live at `~/Desktop/Agoric-L1/upstream/` on Bob's Mac Studio; `UPSTREAM.md` in that folder records the pins. A full clone of agoric-sdk also lives at `~/AAT/upstream/agoric-sdk` (moved out of `docs/` on 2026-09-17) and was fast-forwarded on 2026-09-17 from a January 2024 checkout. Re-clone or `git fetch && git reset --hard origin/master` to update; the Cowork mount needs delete permission granted for git to clean up pack files.

| Repo | Commit | Commit date | Where |
|---|---|---|---|
| Agoric/agoric-sdk | 9712d748a | 2026-09-17 | `~/AAT/upstream/agoric-sdk` |
| Agoric/agoric-sdk | a2a3de9 | 2026-09-11 | Mac Studio |
| Agoric/dapp-offer-up | 4ea27c5 | 2025-04-05 | Mac Studio |
| Agoric/dapp-orchestration-basics | ebed14f | 2025-03-01 | Mac Studio |
| Agoric/documentation | d89bd22 | 2026-04-28 | Mac Studio |

Latest mainnet release: `agoric-upgrade-23a` (2026-07-27; cosmos-sdk v0.53.6-alpha.agoric.1, cometbft v0.38.21-alpha.agoric.1, ibc-go v10.5.0, `@agoric/cosmos v0.36.0-u23.1`, image `ghcr.io/agoric/agoric-sdk:76`). SDK `master` requires Node `^22.11 || ^24.14`.

Note on the local clone: `~/AAT/upstream/agoric-sdk/node_modules` is still from the January 2024 install. Run `corepack enable && yarn install` under Node 22/24 before running SDK tests. `upstream/` must be listed in `.gitignore` before the first commit.

## Paths, verified against the clones

Stage 0 format B (manifest) inputs:
- `dapp-offer-up/contract/src/offer-up.contract.js` (plus `offer-up-proposal.js`)
- `dapp-orchestration-basics/contract/src/orca.contract.js`, `orca.flows.js`, `orca.proposal.js`, `types.js`
- `agoric-sdk/packages/orchestration/src/examples/send-anywhere.contract.js` and `.flows.js`
- `agoric-sdk/packages/zoe/src/typeGuards.js` (`InvitationShape`, `ProposalShape`, `FullProposalShape`, `AmountKeywordRecordShape`, `OfferHandlerI`)
- `agoric-sdk/packages/orchestration/src/exos/exo-interfaces.ts` (interface guards for orchestration exos, the closest upstream thing to a manifest source)
- `agoric-sdk/packages/orchestration/src/orchestration-api.ts` and `cosmos-api.ts` (the account and chain method surfaces; CAIP-2 `ChainInfo`, `AccountId`)

Release 1 idioms and snippet corpus:
- `agoric-sdk/packages/orchestration/USAGE.md` (table dated 2024-09-06; lags) and `src/examples/README.md` (current on which examples are WIP)
- `agoric-sdk/packages/orchestration/src/examples/`: ready — basic-flows, send-anywhere, auto-stake-it, unbond; unit-tested only — staking-combinations; present but undocumented — axelar-gmp, swap-anything; WIP — stake-bld, stake-ica, swap. `shared.flows.js` has `makeLocalAccount`.
- `agoric-sdk/packages/zone/README.md`, `packages/vow/README.md`, `packages/async-flow/README.md`
- `agoric-sdk/packages/async-flow/docs/async-flow-states.md` (activation lifecycle: Running, Sleeping, Replaying, Failed, Done)
- `agoric-sdk/packages/zoe/tools/setup-zoe.js` (`setUpZoeForTest`, `makeZoeKitForTest`), `tools/prepare-test-env-ava.js`, `tools/manualTimer.js`
- `agoric-sdk/packages/orchestration/src/exos/` (chain-hub, chain-hub-admin, orchestrator, local and cosmos orchestration accounts, ica-account-kit, icq-connection-kit, ibc-packet, local-chain-facade, remote-chain-facade) for trace event kinds in format A
- `agoric-sdk/packages/portfolio-contract/src/portfolio.exo.ts` — the POLA facet split upstream `AGENTS.md` points at
- `agoric-sdk/packages/fast-usdc-contract/` — production CCTP/Orchestration contract

Eval harness:
- `agoric-sdk/multichain-testing/` with Makefile, README and per-suite ava configs (default, fusdc, queries, rest, staking, xcs, ymd) and matching `config.*.yaml` Starship topologies
- `agoric-sdk/a3p-integration/proposals/` for the CoreEval proposal build pattern (`build-submission.sh`, `agoricProposal.sdk-generate`)

Docs contribution:
- `documentation/main/` (guides, reference, glossary, e2e-testing.md, what-is-agoric.md). No `llms.txt` as of d89bd22. The "what is Agoric" page still describes IST as the fee token; IST was sunset in 2025 and BLD is the fee token, so that page is a second candidate docs fix.

## Findings that affect the plan

**Upstream already has agent instructions, aimed at SDK maintainers.** `agoric-sdk/AGENTS.md` (83 lines, last touched 2026-09-11) and `.github/copilot-instructions.md` (27 lines). Content is repo mechanics: yarn workspaces, dprint, `lint:types` via tsgo, prepack workflow, A3P container notes, commit conventions. Three sections transfer directly to the Release 1 idioms guide and should be lifted with attribution rather than rewritten: the Capability Security and POLA section (facet placement, per-principal dispatch, narrowed capabilities, read-only first), the Async-Flow Model Notes (replay determinism, `Done` semantics, interleaving hazards), and the copilot rule "always return vows rather than promises in orchestration code." Nothing upstream teaches contract authoring from outside the SDK. The gap Release 1 fills is real.

**Codex has a skill format now.** `agoric-sdk/.agents/skills/` holds six skills, each a `SKILL.md` with an `agents/openai.yaml` sidecar (display_name, short_description, icons, brand_color). The plan's §2.2 assumption that Codex reads only `AGENTS.md` and has no skill format is out of date. Consequence: one SKILL.md source can target both Claude Code and Codex, with the YAML sidecar generated. The `AGENTS.md` size budget still matters but it no longer has to carry everything. The six upstream skills (depot-ci, depot-container-builds, depot-general, depot-github-runners, maintaining-dependency-patches, syncing-endo-dependencies) are all infrastructure; none is for contract authors, so no overlap with Release 1.

**The two dapp repos are stale relative to the SDK.** dapp-offer-up pins `@agoric/zoe ^0.26.3-u16.1`; dapp-orchestration-basics pins zoe `^0.26.3-u17.1` and a patched dev build of `@agoric/orchestration` (0.2.0-upgrade-17-dev). Neither has moved in over a year; the chain is on upgrade-23. The SDK at 9712d748a has zoe at 0.26.2 and orchestration at 0.1.0 in-tree (workspace versions, not the published `-uNN` tags). Before either dapp is used as a snippet source or a manifest subject, its contract has to be checked against current APIs. The send-anywhere example inside the SDK is the safer orchestration reference because it moves with the SDK; since March 2026 it gained CCTP via a Noble ICA, `chainHub`-in-flows lookups and CAIP-2 chain identity (see `agoric-ref-orchestration.md`).

**The offer-up contract copy in the March reference doc did not match upstream.** Upstream imports `atomicRearrange` from `@agoric/zoe/src/contractSupport/atomicTransfer.js` and exports `meta.customTermsShape`; the copy called `zcf.atomicRearrange` and omitted `meta`. Corrected in `agoric-ref-zoe-patterns.md`. Snippet extraction for Release 1 must be scripted from the pinned clone, not hand-copied.

**Fast USDC and the portfolio product are in-tree.** `packages/fast-usdc`, `fast-usdc-contract`, `fast-usdc-deploy`, and `packages/portfolio-api`, `portfolio-contract`, `portfolio-deploy` (the `ymax-v0.3.YYMM-betaN` release line). These are the most actively developed Orchestration code and the best current reference for production patterns, at the cost of being product code.

**`packages/portfolio-contract/src/portfolio.exo.ts`** is what upstream AGENTS.md points at as the textbook POLA facet split (reader, reporter, manager, planner, evmHandler). Worth a read when writing the ocap idiom.
