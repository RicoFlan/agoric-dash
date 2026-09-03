# Development standards (agoric-dash)

## Quality gate

Before merging or when the app feels “broken for no reason”:

```bash
npm run verify
```

This runs **lint** → **unit tests** → **production build**. All three must pass.

The same command runs on **GitHub Actions** (`.github/workflows/ci.yml`) on push and pull requests to `main` / `master`.

Convenience:

- `npm run dev` — deletes `.next` then starts **Turbopack** (`scripts/dev.mjs`) so stale dev chunks cannot accumulate (fixes `Cannot find module './611.js'` class failures without manual steps).
- `npm run dev:incremental` — `next dev --turbopack` **without** deleting `.next` (faster restarts; use only if stable).
- `npm run clean` — remove `.next` only.
- `npm run dev:webpack` — Webpack dev (`next dev`); avoid unless debugging Turbopack.
- `npm run smoke` — `next build` then briefly runs `next start` and checks `GET /` (catches broken prod bundles).
- `npm run verify:smoke` — lint, tests, build, then the same smoke (runs in CI after `verify`).

## Why the dev server sometimes “randomly” breaks

1. **Stale `.next`** — Addressed by default: **`npm run dev`** wipes `.next` before Turbopack starts. Using **`npm run dev:incremental`** or **`npm run dev:webpack`** can still corrupt cache during long Webpack HMR sessions; run **`npm run clean`** then **`npm run dev`** if so.
2. **Postgres** — If `DATABASE_URL` is wrong or the DB is down, `/api/metrics` returns 500. The app uses a **15s connection timeout** on the pool so requests fail instead of hanging indefinitely.
3. **Client fetch / loading** — The dashboard uses a single in-flight controller, generation guards for `loading`, and a 2-minute fetch timeout. Metrics reload when **From / To** or **Granularity** changes (no periodic polling).

## Runtime boundaries

- **API routes** `src/app/api/metrics` and `src/app/api/status` export `dynamic = 'force-dynamic'` so Next never tries to static-cache dynamic DB-backed JSON.
- **`GET /api/metrics`** — Validates `from` / `to` (ISO day, order) and caps range size (`src/lib/metricsApiValidation.ts`): up to **366** days for `day` / `week`, **62** days for `hour` (limits DB work). Then **`clampMetricsRangeToIndexedHistory`** lifts **`from`** to **`INDEXED_HISTORY_FROM_DAY`** (`2026-01-01`, `src/lib/semantics.ts`) when needed so all series match the indexer’s configured start (same intent as default **`INDEXER_START_DATE`** in `.env.example`). Response JSON includes **`indexedHistoryFromDay`** and a **`range`** object reflecting the **effective** (post-clamp) window. After DB metrics are built, the route enriches **USD spot estimates** for both **gross in-tx** and **bank credits** column bases (`enrichTransferAndBankCreditsUsdEstimates` in `src/lib/transferVolumeUsdEstimates.ts` — **`transferVolumeUsdByDenom`**, **`transferVolumeUsdTotal`**, **`bankCreditsVolumeUsdByDenom`**, **`bankCreditsVolumeUsdTotal`**), **`enrichParticipationAndConcentration`** (when `participant_day` / `address_volume_day` exist; `src/lib/participationQueries.ts`), then merges **`display`**. CoinGecko: one batched **`/simple/price`** over the **union** of denoms in both volume maps, TTL cache (`src/lib/coingecko/simplePrice.ts`); optional **`COINGECKO_API_KEY`** (Demo plan) sets `x-cg-demo-api-key`. In **production**, 500 JSON omits internal error details; errors are still logged server-side.
- **Indexer** (`npm run indexer`, `scripts/indexer.ts`) — Runs outside Next.js; fills Postgres rollup tables. **`ibc_transfer_amount_in`** uses **`sumRecvCoinAmountsDedupedFromTxEvents`** (`src/lib/ibcRecvEventAmounts.ts`): a deduped single-count basis = per denom **`max(coin_received sum, transfer sum)`** over **`amount`** attributes scoped to **`MsgRecvPacket`** **`msg_index`** when present (legacy tx-wide sum when msg_index filtering yields no amounts). Typical SDK paths emit **both** event types for the same settlement, so taking the max counts each base unit once instead of ~2× — see **`docs/ibcTransferAmountInEventInvestigation.md`** and **`npm run inspect:ibc-recv-tx-events`**. **`IBC_TRANSFER_IN_COUNT`** still increments once per recv **message**. **`ibc_transfer_flow_in`** logic lives in **`src/lib/ibcTransferFlowInRollup.ts`** (shared with the backfill script). Debug aids: **`npm run scan:ibc-recv-day`** (`scripts/scanIbcRecvDay.ts`) — retries transient RPC failures; optional **`SCAN_HEIGHT_START`** + **`SCAN_HEIGHT_END_EXCLUSIVE`** (decimal heights) skip automatic time→height binary search when validating against known bounds; **`SCAN_CONCURRENCY`** caps parallel block fetches. For multi-day reconciliation scripts, see **`scripts/validateUistIbcApril2026.sh`** / **`npm run validate:uist-apr2026`** (long-running).
- **Dashboard scope copy** — **`INDEXER_SCOPE_CAVEAT_INLINE`** / **`INDEXER_SCOPE_CAVEAT_SUBTITLE`** in **`src/lib/semantics.ts`** are rendered next to **Value handled**, **Gas and fees**, and **Economic participation** (`src/components/Dashboard.tsx`) so viewers do not treat fees or gross movement as full-chain economic totals; full wording is **`METHODOLOGY_SECTIONS`** rendered by the **`/methodology`** page (footer **Methodology & caveats**; **`METHODOLOGY_BLURB`** is the joined plain-text export).
- **Section intros** — Under each main H2, intro paragraphs use **`SECTION_INTRO_CLASS`** (`w-full`) so copy matches full-width chart cards (`Dashboard.tsx`).
- **Local `.env` vs `.env.example`** — Copy **`.env.example`** to **`.env`** for local runs. Set **`RPC_URL`** and **`RPC_URL_FALLBACK`** (see example) so the indexer, backfills, and **`npm run inspect:ibc-recv-tx-events`** use **`rpcCallWithFallback`** (`src/lib/rpc.ts`). If **`RPC_URL_FALLBACK`** is unset or empty, those scripts log `fallback=<none>` and have no secondary endpoint.
- **Backfill `ibc_transfer_flow_in`** — After deploying recv-flow semantics, run **`npm run backfill:ibc-flow-in`** (`scripts/backfillIbcTransferFlowIn.ts`) once: it **deletes** all **`ibc_transfer_flow_in`** rows from **`daily_metrics`** and **`hourly_metrics`**, then replays blocks from **`INDEXER_START_DATE`** (or **`BACKFILL_FROM_HEIGHT`**) through **`indexer_state.last_indexed_height`** (or **`BACKFILL_TO_HEIGHT`**), persisting **only** that series. Does **not** advance or reset **`indexer_state`**; stop the live indexer or accept concurrent writes only if you know heights do not overlap.
- **Full reindex (Railway)** — Required after indexer changes that **add** indexer-only series (e.g. `gas_wanted`, `block_gas_limit`, the staking/governance counts, the SwingSet/Zoe offer series `wallet_actions` / `offer_source` / `offer_instance` / `offer_maker` / `invoke_target` / `offer_category` / `offer_outcome` / `offer_give_volume` / `offer_want_volume` / `offer_payout_volume`) or **redefine** an existing series' value (e.g. `ibc_transfer_amount_in` moving from the 2× combined sum to the deduped per-denom max). Because rollup upserts are **additive** (`value + excluded.value`), the correct fix is a clean replay, not an additive backfill. Procedure: **(1)** deploy the new code, then run **`npm run db:push`** so any new indexer tables exist (the offer work added **`offer_participant_day`**); optionally re-run **`npx tsx scripts/refreshAgoricNames.ts`** and commit the regenerated **`src/config/agoricNames.json`** so offer Instance/Brand labels and the brand→vbank-denom map are current before the replay. **(2)** stop/pause the indexer service so it is not writing. **(3)** run the destructive reset once as a one-off in the same environment — **`DATABASE_URL=… REINDEX_CONFIRM=YES npm run reindex:reset`** (`scripts/reindexReset.ts`) — which **`TRUNCATE`**s `daily_metrics`, `hourly_metrics`, `participant_day`, `address_volume_day`, `address_fee_day`, `offer_participant_day` and deletes the `indexer_state` cursor. **(4)** start the indexer again (**`npm run indexer`**) — with the cursor cleared it resolves the first block ≥ `INDEXER_START_DATE` and catches up to tip in catch-up mode. The reset refuses to run without **`REINDEX_CONFIRM=YES`** and prints before/after row counts. Verify afterward with **`npm run parity:rollup -- --day=<UTC day>`** (hourly vs daily parity; add **`--replay-ibc-flow-in`** to re-derive that series from RPC) and spot-check the dashboard.
- **MetricsErrorBoundary** wraps the dashboard in `src/app/page.tsx` so a Recharts or render error shows a recovery UI instead of a blank page.
- **Header jump navigation** — `src/app/page.tsx` renders **`dashboardNavLinks`** from `src/lib/dashboardNav.ts` (right-aligned text anchors; excludes the date-range toolbar section). Section **`id`s** are set on the matching `<section>` / `<footer>` elements in `src/components/Dashboard.tsx`; changing anchors requires updating **both** files (see `src/lib/dashboardNav.test.ts`).
- **`scroll-smooth`** on `<html>` in `src/app/layout.tsx` applies to in-page navigation.
- **`src/app/error.tsx`** — App Router error boundary for failures outside the dashboard subtree.

## Next.js config

- `outputFileTracingRoot` — monorepo-style path safety for `next build` file tracing.
- **`headers()`** — baseline headers on all routes: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`.

## Linting

ESLint extends `next/core-web-vitals` and `next/typescript`. Run `npm run lint` and fix issues; do not disable rules without a short comment and issue link.

## Database client

`src/db/client.ts` uses `pg` with explicit timeouts. Adjust only with care: too low breaks slow queries; too high traps the UI on bad networks.

## Daily prices and schema additions

`denom_price_day` is created with `CREATE TABLE IF NOT EXISTS` (`ensureDenomPriceDayTable` in `src/lib/coingecko/priceStore.ts`) by both the backfill script and the indexer's refresh loop, so a deploy needs no migration step and `drizzle-kit push` stays optional. The table is also declared in `src/db/schema.ts`; keep the two in sync. Rationale: `drizzle/meta` is gitignored and the production tables were created with `db:push`, so there is no migration baseline — additive tables are safest as idempotent SQL that runs on process start. Never add price tables to `scripts/reindexReset.ts`.

Pricing math is DB-free (`src/lib/denomPrices.ts`) and unit-tested with in-memory tables; only `src/lib/loadDailyPriceTable.ts` touches Postgres.

## `denoms.json` maintenance

Human labels and decimals for chart/table display come from **`src/config/denoms.json`**. When users see raw `ibc/…` strings in the UI:

1. Query mainnet **`GET …/cosmos/bank/v1beta1/denoms_metadata`** (paginate if needed) to list registered denoms.
2. For each metadata **`base`** not already in `entries[].match`, resolve the asset:
   - **`GET …/ibc/apps/transfer/v1/denom_traces/{hash}`** on an Agoric LCD (REST URLs in [cosmos/chain-registry `agoric/chain.json`](https://github.com/cosmos/chain-registry/blob/master/agoric/chain.json)) — returns **`path`** and **`base_denom`** (required for multi-hop IBC and correct decimals).
   - Cross-check symbol, **`coingecko_id`**, and **`denom_units`** in [cosmos/chain-registry](https://github.com/cosmos/chain-registry) (e.g. counterparty **`assetlist.json`**, or **`provenance/assetlist.json`** for native **`nhash`** → **HASH**, 9 decimals).
3. Add `{ match, displaySymbol, decimals }` to **`src/config/denoms.json`** (decimals from the **base** asset on the trace terminus, not assumed 6).
4. Mirror the row in **`public/denom-translations.csv`** (`match,displaySymbol,decimals,coingeckoId,status,correction_notes`).
5. Keep **`entries` sorted alphabetically by `match`** — `src/lib/denomsJson.contract.test.ts` enforces this.

For **USD (EST)** cells in the value-handled denom table, add or adjust mappings in **`src/config/coingeckoDisplaySymbolToId.json`** (and **`coingeckoDenomOverrides.json`** when a specific `match` must differ). IDs must match CoinGecko’s **`/simple/price`** `ids` parameter (often copied from chain-registry **`coingecko_id`**). Add a case in **`src/lib/coingecko/resolveCoinGeckoId.test.ts`** when introducing a new priced IBC hash.

**Example (Provenance HASH):** `ibc/00A6285B…` → trace `transfer/channel-1/transfer/channel-222` + `nhash` → **HASH**, **9** decimals, CoinGecko **`hash-2`**.

### Question sections (`src/components/dashboard/questions/*`)

The page is four `QuestionBlock`s (`primitives.tsx`: `QuestionBlock`, `Headline`, `SupportFigure`, `DetailDrawer`, `KpiCard`, formatting helpers). Each section owns its derived rows (`useMemo` over the payload) and takes the shared chart-grain `timeAxis` from the shell; daily-grain charts (Q4) build their own day axis. `Dashboard.tsx` is the shell only: range state, the fetch, the toolbar, the What-changed strip, and the footer link. Payload types live in `dashboard/types.ts` (add fields there, not in components).

- **Definitions**: every headline/support ⓘ reads a one-liner from `src/lib/definitions.ts` (`DEFINITIONS`, keyed `q<N>_<indicator>`); `definitions.contract.test.ts` enforces non-empty, unique entries per question. Long-form text stays in `METHODOLOGY_SECTIONS` and renders on `/methodology`.
- **What changed**: `src/lib/narrative.ts` — deterministic templates over `questions`, ranked by max |z| then |Δ%|; fixtures in `narrative.test.ts`. Add a template when adding a question; never a model call here.
- **Anomaly markers**: `TxActivityLineChart` draws `ReferenceDot`s only at day granularity, because flags are day-grain (`anomalies.ts`).
- **Detail drawers** are native `<details>`; keep demoted content there rather than adding sections.
- **Removed** in the redesign (do not resurrect without a design reason): Value Flow Map, normalized ratios, the two-basis gross/credits table with client-side USD sort, the txs-vs-IBC chart.

### Methodology & caveats panel

Footer copy is **`METHODOLOGY_SECTIONS`** (`src/lib/semantics.ts`) — titled blocks rendered by the **`/methodology`** page (section titles **`text-sm font-bold`**, body **`text-sm`** + **`--color-text-secondary`**). Update sections there when changing dashboard UX; **`METHODOLOGY_BLURB`** is auto-generated from the same array for contract tests and grep-friendly exports.
