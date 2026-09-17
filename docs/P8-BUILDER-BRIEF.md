# P8 Builder Brief

**You are the Builder.** Implement the work below in this repository. A separate reviewer (Claude Fable) plus CodeRabbit will review every pull request. Your job is to produce correct, evidence-backed changes; their job is to try to break them.

This brief is self-contained. Every factual claim in it was verified on 2026-09-17 against mainnet `agoric-3`, the production database, or this codebase, and the verification method is stated so you can re-check anything you doubt. Do not take a claim on faith if your change depends on it — re-verify and say so if you find it wrong.

---

## 1. What this project is

`agoric-dash` is an activity dashboard for Agoric mainnet. It exists to go beyond a block explorer and to cover what is specific to Agoric. Two design commitments govern every change:

- **Intelligence over data.** A number earns its place by changing what a reader concludes.
- **No claim stronger than its evidence.** If the data cannot support a statement, the dashboard says so rather than implying more.

The page answers four questions, one section each: Q1 is the chain busier, Q2 is usage user-initiated or automated, Q3 net value flow including capital deployed to other chains, Q4 is the economic base broadening.

Architecture: a standalone indexer (`scripts/indexer.ts`) reads CometBFT blocks into Postgres (`daily_metrics` / `hourly_metrics`, keyed by bucket, series and dimension, values `numeric(78,0)` strings). Next.js App Router serves `/api/metrics`. Read-time logic lives in `src/lib/*`; the dashboard is `src/components/dashboard/*`.

---

## 2. Hard constraints — read before touching anything

**Never run `reindex:reset`, and never chain it behind anything.** It truncates every rollup table and clears the indexer cursor. Until recently it sat in the Railway indexer pre-deploy command behind `npm run db:push && …`, and the only thing preventing a full wipe on every deploy was that the push failed first. `npm run db:push` **prints its error and still exits 0**, so `&&` does not protect you. That chain has been removed. Do not reintroduce a pattern like it. Rebuilding the database costs days.

**Never put `drizzle-kit push` in a deploy path.** It issues `ALTER` and `DROP` unattended, and on PostgreSQL 17+ it misreads the new named `NOT NULL` constraints as extras and tries to drop every one of them. Production runs 18.6. The deploy-time step is `npm run db:ensure` (`scripts/ensureSchema.ts`): it creates missing additive tables, verifies every declared table, column, nullability and primary key, never alters or drops, and exits non-zero on drift. `db:push` remains valid only for a first-time local database create.

**All rollup writes are additive** (`value + excluded.value`). Replaying a height that was already written double-counts silently — no error. Every backfill therefore needs an explicit height range and a `backfill_checkpoint` row. Resume strictly above the checkpoint.

**New tables are additive only.** `drizzle/meta` is gitignored and production was created with `db:push`, so there is no migration baseline. Add tables as `CREATE TABLE IF NOT EXISTS` in `src/db/ensureAdditiveTables.ts`, add the name to `ADDITIVE_TABLE_NAMES`, and declare them in `src/db/schema.ts`. The contract test in `src/db/additiveTables.contract.test.ts` enforces that the two agree.

**Process rules.**
- Every pull request targets `main`. No stacked pull requests. Consolidate related work into one pull request rather than a chain of small ones.
- After any push, monitor CI to completion and act on **every** CodeRabbit finding, including ones in the review **body** under "Outside diff range comments" — those are not inline threads and are easy to miss. Resolve threads you have addressed.
- Right-size verification to the blast radius. Do not run a nine-hour job to validate a label change.
- Ask before any destructive or irreversible production action.

---

## 3. Environment facts

**Production database.** Railway project "Agoric Dash", services `indexer`, `Postgres`, `agoric-dash` (the web app, at `https://agoric-dash-production.up.railway.app`). Both code services auto-deploy from `main`, and both run `npm run db:ensure` as their pre-deploy command. Get a connection string from the `Postgres` service variable `DATABASE_PUBLIC_URL` (the internal host does not resolve off-platform). The local `psql` client is older than the server; run psql inside a `postgres:18` container.

**RPC.** Primary is the archive `https://main-a.rpc.agoric.net`; fallback `https://agoric-rpc.polkachu.com`. Two behaviours matter:
- The fallback is **pruned** for older heights and returns `block: null` rather than an error. Treat a null block as unavailable, never as empty.
- The archive returns a generic `Internal error` for genesis-era heights rather than a recognisable "pruned" message. Any height-availability probe must refuse to guess, not assume pruned.
- The archive rate-limits under load. One heavy backfill saturates it; do not run two at once.

**REST.** `https://main.api.agoric.net` serves chain parameters and vstorage reads. Useful routes: `/agoric/swingset/params`, `/agoric/vstorage/data/<path>`, `/cosmos/base/node/v1beta1/config`.

**Backfill cost.** Roughly 50 blocks per second at concurrency 16. A full replay of indexed history is about 1.7 million blocks, so about nine hours. Budget accordingly and run long jobs under `caffeinate -i`.

**Recorded boundaries — do not recompute, do not lose.**
- `failed_tx_fees` backfill: completed, `BACKFILL_TO_HEIGHT=27375039`. That is the last height written by the code that did not record fees for failed transactions.
- End-block orchestration backfill: currently running, `BACKFILL_SKIP_DELETE=1`, heights `25498665..27169144`. The upper bound is the last block before live indexing began writing orchestration data (block 27169144 is timestamped 15:59:55Z on 2026-09-03; 27169145 is 16:00:01Z). Append-only, deliberately, to avoid deleting two weeks of live data.
- Indexer start height 25498665 corresponds to `INDEXER_START_DATE=2026-05-19T01:52:00Z`.

**Nothing new starts until the end-block backfill finishes.** Check with `pgrep -f backfillEndBlock`.

---

## 4. Verified evidence

You do not need to re-derive these. Re-verify only what your change depends on.

**Offer categories, over all indexed history** (from `daily_metrics` where `series='offer_category'`):

| Category | Actions | Distinct wallets |
|---|---|---|
| fast_usdc | 2023 | 2 |
| orchestration | 1260 | 31 |
| other | 570 | 27 |
| ymax | 538 | 40 |
| psm | 42 | 10 |
| vaults, auction, governance, oracle | 0 | 0 |

**Offer source** (`series='offer_source'`): continuing 2573, contract 41, purse 40, agoricContract 9, unknown 1.

**Offer outcome** (`series='offer_outcome'`): wants_satisfied 2645, wants_unsatisfied 4, errored 8. Total settled 2657 against 2664 offers seen, so a small residue never settles.

**Chain parameters** (`/agoric/swingset/params`, confirmed live): `fee_unit_price` = 1000000 ubld; `beans_per_unit` includes `feeUnit` 150000000000, `blockComputeLimit` 6500000000, `smartWalletProvision` 1500000000000, `storageByte` 20000000, `xsnapComputron` 100; `power_flag_fees` for `SMART_WALLET` = 10000000 ubld. So a smart wallet costs exactly 10 BLD.

**Provision pool** (`/agoric/vstorage/data/published.provisionPool.metrics`, confirmed live): `walletsProvisioned` 1452, `totalMintedProvided` 3700000000 ubld.

**Chain context.** BLD is the fee token; IST is not, and Inter Protocol (vaults, PSM minting, auctions) was wound down to a 30 June 2025 shutdown — before indexed history begins on 2026-01-01. Mainnet runs `agoric-upgrade-23a` on ibc-go v10.5.0. Orchestration moves USDC to EVM chains over CCTP via a Noble account, not only over IBC.

**Already checked, do not "fix":**
- Fee accounting already uses BLD (`FEE_DENOM_UBLB = "ubld"`).
- IBC parsing survived the July chain upgrade. Monthly day-counts for the IBC series are steady at 28–31 across the boundary, with no discontinuity.
- Orchestrated outflow is dimensioned by denom, not destination, so the dashboard does not falsely claim Noble is a final destination.
- The action-weighted organic ratio and the wallet-weighted one both put unclassified activity in the denominator; they are consistent with each other.

---

## 5. The critical sequencing constraint

`offer_category` is written **at index time**, and it resolves board identifiers to contract names through the committed `src/config/agoricNames.json`. Changing that file, or changing any category rule, therefore requires re-running the full category rebuild to reclassify history. That costs about nine hours.

**Consequence: settle every index-time change before running the rebuild once.** Three separate rule changes run separately cost a day and a half for the same result. Tier 2 exists so that all such decisions are made before Tier 3 spends the time.

---

## 6. The work

### Tier 1 — Read-time corrections. One pull request. No replay.

**1.1 Relabel the Q2 interactive group.** The chart legend reads `Interactive (vaults/PSM/auction/gov)`, and the same wording repeats in the Q2 section copy and in `DEFINITIONS.q2_organic_ratio`. Per the table above, vaults, auction and governance contributed zero actions over all indexed history, while YMax is 93 percent of the interactive bucket. Rewrite the legend, the section copy and the definition to name what actually drives the number, and state that Inter Protocol was sunset before indexed history begins.
*Files:* `src/components/dashboard/charts/OffersActivityLineChart.tsx`, `src/components/dashboard/questions/Q2Organic.tsx`, `src/lib/definitions.ts`.
*Accept when:* no user-facing string presents a zero-activity category as a leading example, and the category table still lists zero rows rather than hiding them.

**1.2 Show the unclassified share on the Q2 card.** Unclassified actions sit in the denominator of both organic ratios and silently suppress them. Today that is 570 of 4433 actions, about 13 percent. Surface it as a coverage caveat next to the headline, in the same spirit as the existing unpriced-asset disclosure in Q3.
*Accept when:* a reader can see what fraction of activity the ratio could not classify, and the figure is null rather than zero when the category table is unavailable.

**1.3 Surface the engagement axis already indexed.** `offer_source` separates continuing offers from fresh ones, 2573 against 90. A continuing offer acts on an existing seat, so this distinguishes opening a position from managing one — Agoric's own distinction between transactional and portfolio contracts. Add it to Q2 as a supporting figure with a definition that does **not** equate continuing with automated; a user managing their own portfolio also produces continuing offers.
*Accept when:* the definition states plainly what the axis does and does not mean.

**1.4 Report unsettled offers as a third outcome state.** Settled outcomes are currently presented as exhaustive. Offers can hang indefinitely with the offer live and no error anywhere, and a transaction can return success while its offer is silently rejected. Derive the residue (offers seen minus settled) and show it.
*Accept when:* the outcome breakdown sums to offers seen, and the residue is labelled as unresolved rather than failed.

### Tier 2 — Investigations. Produce findings, not guesses. No schema changes.

Each of these may change an index-time rule. Finish all three before Tier 3.

**2.1 Where does Agoric governance actually appear?** Cosmos governance counts are nearly empty (2 proposal day-keys, 8 vote day-keys) and the `governance` offer category is zero, yet Agoric parameter governance runs through committee and charter invitations that should already be inside the offer stream. Determine whether those actions are present and mis-bucketed. Deliver either a concrete category-rule change or a recommendation to stop presenting governance.

**2.2 Is SwingSet compute observable?** The per-block compute limit is 6.5 billion beans, and that — not Cosmos block gas — is Agoric's real capacity ceiling. Q1 currently charts gas utilization, which answers a Cosmos question. Determine whether beans or computrons consumed per block are available from `block_results`, or only through the telemetry slog. If only slog, say so and recommend dropping the idea rather than shipping a proxy. **Do not ship a "compute utilization" number derived from anything other than actual consumption.**

**2.3 YMax ingestion completeness and contract identity.** Diff the `Agoric/ymax-subql` schema against our `published.ymax0|ymax1.*` ingestion for fields we do not capture. Separately, determine whether `ymax0` and `ymax1` are two products or one product across a redeploy boundary. Board identifiers and portfolio counters reset on redeploy, so if it is a boundary, Q3 series must be annotated rather than implying continuity.

### Tier 3 — One combined index-time rebuild. One pull request, then one run.

**3.1 Refresh the contract-name map** with `npx tsx scripts/refreshAgoricNames.ts` and commit the regenerated `src/config/agoricNames.json`. The current file was generated 2026-05-30. Board identifiers change on every redeploy, so contracts deployed since then do not resolve and fall into `other`.

**3.2 Apply every rule change from Tier 2** in the same pull request.

**3.3 Make resolution failure visible.** The name map decays continuously and nothing warns us. Add a signal — a test, or an indexer warning counter — so an unresolved instance is noticed rather than quietly reclassified.

**3.4 Then run the category rebuild once,** in full mode, and report the before-and-after unclassified share.
*Accept when:* the unclassified share falls, the change is quantified, and no other series moved.

### Tier 4 — New indexing. Additive. After Tier 3's rebuild.

**4.1 Index smart-wallet provisioning.** Add `published.provisionPool.metrics` to the vstorage paths the indexer reads. It publishes a cumulative `walletsProvisioned` and `totalMintedProvided`; difference it per day to get new wallets and provisioning spend. Each wallet costs exactly 10 BLD, so the two are cross-checkable — use that as a validation, and disclose any disagreement rather than smoothing it. This is the best direct measure of new participants for Q4, because unlike distinct addresses it cannot be inflated by one actor.
*Needs:* an additive table or series, a backfill over history, and a checkpoint. Follow the pattern in `scripts/backfillEndBlock.ts`.
*Accept when:* the daily count reconciles against the live cumulative figure at the range end.

**4.2 Drive the denom registry from the chain.** `published.agoricNames.vbankAsset` is the canonical denom-to-brand table; `src/config/denoms.json` is committed and can drift, and the correct denom differs per network. Either source from the chain or reconcile against it and alert on drift.

### Tier 5 — Lower value, only if the above lands cleanly.

**5.1 Contract-landing activity** from bundle installs and governance evaluations, as a Q4 signal that the base is broadening in deployed contracts and not only in addresses.
**5.2 Break out bundle-install storage fees** from transaction gas fees; they are a separate economic flow, currently folded into the fees line.

---

## 7. Definition of done, per pull request

- `npm run verify` passes (lint, full test suite, production build). Capture exit codes explicitly; do not pipe into `grep` and read grep's status.
- New pure logic has unit tests. New user-facing claims have a definition that states their limits.
- Anything touching production data was verified against production read-only first, and the verification is in the pull request description.
- CI watched to completion; every CodeRabbit finding addressed or explicitly declined with a reason, including body-only findings.
- The pull request description says what was verified and how, not only what changed.

## 8. When to stop and ask

- Any operation that deletes or truncates production rows.
- Any change to Railway service settings.
- Any finding that contradicts this brief. Say so rather than working around it — a wrong premise here is worth more to fix than the task in front of you.
