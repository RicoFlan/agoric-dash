# agoric-dash

Dashboard for monitoring on-chain activity on **Agoric L1** (`agoric-3`). Metrics are indexed from CometBFT **`block`** / **`block_results`**, rolled up in PostgreSQL (**`daily_metrics`** and **`hourly_metrics`**, per series/denom), and served by **Next.js** API routes. The UI is **Recharts** with a **~60s auto-refresh** and filters for **date range** and **granularity** (UTC hour, day, or week).

## What the dashboard shows

The page order follows **`Dashboard.tsx`**: **Value handled** (KPIs, denom list, transfer + IBC amount charts), **Gas and fees**, **Transaction activity** KPIs, **full-width** tx vs IBC line charts, then **Transaction nature**.

| Area | Content |
|------|--------|
| **Value handled** | KPIs: **largest in-tx transfer**, **in-tx transfer volume by denom** list; charts (**full width**, stacked): **in-tx transfer volume** (one line per denom with in-range volume), **IBC amount flows** (one line per denom for recv and for outbound amounts). |
| **Gas and fees** | KPIs: **gas used** (ABCI units), **paid fees uBLD → BLD**. |
| **Transaction activity** | KPIs: **successful txs**, **IBC transfers out / recv** (message counts); charts (**full width**, stacked): **all txs vs IBC message volume**, then **IBC traffic** (out vs recv counts). |
| **Transaction nature** | “First message only” bar chart (`MESSAGE_ATTRIBUTION` in `src/lib/semantics.ts`). |
| **Asset-level detail** | **Fee paid by denom** (primary units) and related breakdowns in the Gas and fees area. |

All KPIs that support it show **prior window** and **percent change** vs an equal-length period ending immediately before the selected range (`pctChange` in `src/lib/metricsQuery.ts`).

A **Methodology** panel in the app mirrors the definitions below. Source of truth for metric semantics is `src/lib/semantics.ts` and `METHODOLOGY_BLURB`.

## Definitions (v1)

- **Successful txs**: ABCI result code `0` (KPI; “all txs” in charts includes **failed** inclusions as well).
- **Gas**: **ABCI / consensus gas units** — not a token and not the same as paid fees. Do not conflate with BLD or IBC.
- **Paid fees**: Parsed from **tx result events** (e.g. `tx` / `fee` attributes) — the amount actually **paid in execution**, not the signed “max fee” cap only. The primary fee KPI and chart copy focus on **uBLD → BLD**; other fee denoms are listed in **Fee paid by denom**.
- **In-tx “value” / transfer volume**: **Multi-asset**. Native and **IBC** denoms (including long `ibc/HASH` strings) are different lines. **uBLD fee totals are not a summary of all economic value** — in-tx movement is per denom. Amounts are shown in on-chain units (human-formatted when listed in `denoms.json`).
- **Largest in-tx transfer**: The denom with the **largest** range-aggregated `transfer_volume` in that window (from indexed transfer surface). Not the same as “largest IBC in only” unless you change the product definition.
- **Nature / composition**: **First message** type URL in the transaction body, per the constant in `semantics.ts`.
- **Transfer / transfer volume (indexed)**: Native minimal units from decoded **`MsgSend`**, **`MsgMultiSend`**, and **`MsgTransfer`**, plus IBC recv indexing where the indexer records amounts — **smart-contract-internal flows** may be missing from this view.
- **IBC** direction is **Agoric-relative** (e.g. out = `MsgTransfer` from this chain; in = recv packet handling as indexed).
- **Period comparison**: A **previous window of equal length** immediately before the selected `from` (documented in the date/granularity UI).

## Denoms, symbols, and IBC hashes

- Display names and decimal scaling for human amounts are in **`src/config/denoms.json`**. The indexer and API work in **on-chain minimal denoms**; the file maps **full** strings (e.g. `ubld`, and full `ibc/...` **hash** denoms) to `displaySymbol` and `decimals`. Entries are kept **sorted by `match`**; contract tests enforce shape and sort order.
- A long `ibc/FE98…` style value is a **canon IBC token id** (hash of path + base denom) — the dashboard shows the raw id until you add a matching `entries` row. To find hashes registered on chain but missing from the file, diff **`GET /cosmos/bank/v1beta1/denoms_metadata`** (`base` field) against `entries[].match` (see the **note** in `denoms.json`). **Multiple** `ibc/...` values can still represent the **same** logical asset via **different IBC paths**; each path needs its own `match` row if you want a distinct label.

## Prerequisites

- Node 20+
- PostgreSQL 16+ (see `docker-compose.yml`; default host port **5433** → 5432 in the container)

## Setup

```bash
cp .env.example .env
# Use DATABASE_URL; default in .env.example matches docker-compose (localhost:5433 for host).

docker compose up -d

npm install
npm run db:push
```

**Run the app from the repository root** (so Next.js finds `src/app/`). Example: `cd agoric-dash && npm run dev`.

**Quality gate (lint + tests + production build):** `npm run verify`. Standards and troubleshooting: **`docs/DEVELOPMENT.md`**.

## Run indexer (separate terminal)

Polls `RPC_URL`, resolves the first block at or after `INDEXER_START_DATE` (binary search on heights), indexes **from that height to tip**, then tails new blocks. Writes **`daily_metrics`** and **`hourly_metrics`** (`scripts/indexer.ts`). In catch-up, deltas are merged in memory and flushed per chunk (`addRollupDelta` / `flushRollupMaps`).

### Index window and catch-up behavior

- **`INDEXER_START_DATE`**: hard lower **time** bound (UTC ISO). Blocks strictly before this instant are skipped.
- **Pruned RPC nodes**: some providers omit very old heights; the indexer discovers the **earliest queryable height** before resolving the start height so startup does not assume height `1` exists.
- **Parallel RPC per height**: `block` and `block_results` are requested together (`Promise.all`).
- **Tail mode** (near tip): uses `INDEXER_BATCH` and `INDEXER_POLL_MS`.
- **Catch-up mode** (lag > `INDEXER_CATCHUP_THRESHOLD_BLOCKS`): uses `INDEXER_CATCHUP_BATCH`, `INDEXER_CATCHUP_POLL_MS`, `INDEXER_CATCHUP_CONCURRENCY`; processes multiple heights per chunk; **aggregates deltas in memory** and **flushes once per chunk** in a DB transaction (see `addRollupDelta` / `flushRollupMaps` in `scripts/indexer.ts`).
- **`INDEXER_INITIAL_WINDOW`**: legacy; used only when **`INDEXER_START_DATE` is unset** (first-run window in blocks).

### Indexer environment variables

| Variable | Role |
|----------|------|
| `RPC_URL` | CometBFT JSON-RPC HTTP endpoint |
| `INDEXER_START_DATE` | UTC ISO datetime; do not index blocks before this time |
| `INDEXER_LAG` | Stay this many blocks behind tip when advancing |
| `INDEXER_BATCH` | Max blocks per loop in tail mode |
| `INDEXER_POLL_MS` | Sleep between loops in tail mode |
| `INDEXER_CATCHUP_THRESHOLD_BLOCKS` | Switch to catch-up when backlog exceeds this |
| `INDEXER_CATCHUP_BATCH` | Max blocks committed per catch-up loop iteration |
| `INDEXER_CATCHUP_POLL_MS` | Sleep between loops in catch-up mode |
| `INDEXER_CATCHUP_CONCURRENCY` | Parallel heights per chunk in catch-up |
| `INDEXER_INITIAL_WINDOW` | First-run backfill span in blocks if `INDEXER_START_DATE` unset |

```bash
npm run indexer
```

Copy **`.env.example`** to `.env` and adjust. Example defaults target **bounded history + fast catch-up** (see repo `.env.example`).

## Run web app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use **From / To**, **Granularity**, and **Refresh** as needed; the dashboard re-fetches metrics on an interval (about **60 seconds**).

Chart buckets must exist in Postgres for your selected range: if the UI shows zeros, the indexer may still be catching up to wall-clock or your range may lie outside indexed hours/days.

### Production

```bash
npm run build
npm start
```

## API

- `GET /api/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|hour|week`  
  Returns rollup payload from `buildMetricsPayload` plus a **`display`** object from `enrichMetricsForDisplay` (symbol/decimals **metas** per denom). Used by the dashboard client; shape is defined in `src/lib/metricsQuery.ts` and `src/lib/metricsDisplayTypes.ts`. Time series for value charts include **`series.transferVolumeSeries`** (all denoms with transfer volume in range), **`series.ibcAmountInSeries`**, and **`series.ibcAmountOutSeries`** (per-denom IBC recv / out amounts)—each item is `{ denom, data: [{ bucket, value }] }`.

## Project layout

| Path | Purpose |
|------|--------|
| `docs/DEVELOPMENT.md` | Dev workflow, quality gate (`npm run verify`) |
| `docs/style-guide.md` | Visual design system (colors, type, spacing, components) for the UI |
| `scripts/indexer.ts` | Block scanner; bounded start date, catch-up vs tail, batched rollups |
| `src/config/denoms.json` | `match` (full on-chain denom) → symbol, decimals |
| `src/db/schema.ts` | `daily_metrics`, `hourly_metrics`, `indexer_state` (Drizzle) |
| `src/lib/semantics.ts` | `CHAIN_ID`, series names, `FEE_DENOM_UBLB`, `METHODOLOGY_BLURB` |
| `src/lib/metricsQuery.ts` | `buildMetricsPayload`, KPIs, series for charts, comparison window |
| `src/lib/metricsEnrichment.ts` | `resolveDenom`-based **metas** for `display` |
| `src/lib/resolveDenom.ts` | Resolves a denom string using `denoms.json` |
| `src/app/api/metrics/route.ts` | JSON: `{ ...payload, display }` |
| `src/components/Dashboard.tsx` | Date/granularity controls, charts, tables |
| `src/components/MetricsErrorBoundary.tsx` | Catches render errors in the client dashboard |

## Tests

**Vitest** runs tests on pure modules (no Postgres or Next server by default):

| File | Covers |
|------|--------|
| `src/lib/amountFormat.test.ts` | Human-readable amounts |
| `src/lib/resolveDenom.test.ts` | `denoms.json` resolution |
| `src/lib/displayFormat.test.ts` | Chart/list display helpers |
| `src/lib/envExample.contract.test.ts` | `.env.example` documents indexer env vars (contract with README) |
| `src/lib/denomsJson.contract.test.ts` | `denoms.json` shape, unique `match`, sorted entries |

```bash
npm test
# npm run test:watch   # watch mode while developing
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run indexer` | Indexer worker |
| `npm run db:push` | Apply Drizzle schema to Postgres |
| `npm run db:generate` | Generate SQL migrations (optional) |
| `npm test` | Run Vitest once (`vitest run`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build` | Production build |
| `npm start` | Start production server |
