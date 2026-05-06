# agoric-dash

Dashboard for monitoring on-chain activity on **Agoric L1** (`agoric-3`). Metrics are indexed from CometBFT **`block`** / **`block_results`**, rolled up in PostgreSQL (**`daily_metrics`** and **`hourly_metrics`**, plus participation tables — see below), and served by **Next.js** API routes. The UI is **Recharts** with filters for **date range** and **granularity** (UTC hour, day, or week); metrics reload when those inputs change.

The **`page.tsx`** header includes **right-aligned jump links** (`src/lib/dashboardNav.ts`) to main content sections (not the date-range toolbar); **`layout.tsx`** sets **`scroll-smooth`** on `<html>` for in-page anchors.

## What the dashboard shows

The page order follows **`Dashboard.tsx`**: **Range** (date/granularity controls at top — **`filters`** anchor only; not in header nav), **Value handled** (KPIs, denom list, transfer + IBC amount charts), **Gas and fees**, **Transaction activity** KPIs, **full-width** tx vs IBC line charts, then **economic participation & concentration** (last main section, above the methodology footer). Header jump links align with the latter sections only.

| Area | Content |
|------|--------|
| **Range** | **Granularity**, **Quick range** presets, **Custom Range** (`--color-bg-control` toolbar). Anchor id **`filters`**. |
| **Value handled** | **Gross in-tx movement by denom** HTML **table**: **`colgroup`** + **`table-fixed`** (10% / 20% / 20% / 50%), **`min-w-0`** scroll wrapper so the table does not overflow the viewport. All four value columns are **one line** with **in-cell horizontal scroll** if needed. **USD (EST)** header sorts (high→low / low→high / default; resets on **From / To / Granularity**). **Zebra** rows. **Gross in-tx (per asset)** line chart with **checkboxes**; **IBC amount flows**; **Quick range** + **Custom Range**; **last indexed block height** when available. |
| **Gas and fees** | KPIs: **gas used** (ABCI units), **paid fees uBLD → BLD**. |
| **Transaction activity** | KPIs: **successful txs**, **IBC transfers out / recv** (message counts); charts (**full width**, stacked): **all txs vs IBC message volume**, then **IBC traffic** (out vs recv counts). |
| **Volume and IBC (time series)** | **All txs vs IBC** and **IBC traffic** line charts (full width). |
| **Economic participation & concentration** | Last main section: **daily distinct-account line chart** (UTC calendar days in range), KPI cards, **top 10** gross USD share, optional **distinct account addresses per calendar day** table — requires indexer tables `participant_day` and `address_volume_day`. |

All KPIs that support it show **prior window** and **percent change** vs an equal-length period ending immediately before the selected range (`pctChange` in `src/lib/metricsQuery.ts`).

The in-app **Methodology & caveats** panel is the full narrative (`METHODOLOGY_BLURB` in `src/lib/semantics.ts`). The bullets below are a shorter reference.

## Definitions (v1)

- **Successful txs**: ABCI result code `0` (KPI; “all txs” in charts includes **failed** inclusions as well).
- **Gas**: **ABCI / consensus gas units** — not a token and not the same as paid fees. Do not conflate with BLD or IBC.
- **Paid fees**: Parsed from **tx result events** (e.g. `tx` / `fee` attributes) — the amount actually **paid in execution**, not the signed “max fee” cap only. The primary fee KPI shows **uBLD → BLD**; the API also carries per-denom fee breakdowns for other uses.
- **Gross in-tx movement** (not supply): **Multi-asset** sum of on-chain transfer legs in the range. Native and **IBC** denoms (including long `ibc/HASH` strings) are different lines. **uBLD fee totals are not a summary of all economic value** — movement is per denom. Amounts are shown in on-chain units (human-formatted when listed in `denoms.json`). Do not treat range totals as comparable to circulating supply; they are gross flow.
- **USD (EST) in the in-tx table**: **Not** on-chain USD. Each cell is **range-aggregated native total × current CoinGecko spot** (see `src/lib/transferVolumeUsdEstimates.ts`). The **TOTAL** row sums only rows that have a price. Unmapped or rate-limited denoms show **—**. Optional **`COINGECKO_API_KEY`** (Demo) in `.env` helps free-tier rate limits (`x-cg-demo-api-key` header). **Sorting** on that column is **client-side** only (parsed from formatted currency strings); see `src/lib/grossTableUsdSort.ts` and tests in `src/lib/grossTableUsdSort.test.ts`.
- **Transfer / transfer volume (indexed)**: Native minimal units from decoded **`MsgSend`**, **`MsgMultiSend`**, and **`MsgTransfer`**, plus IBC recv indexing where the indexer records amounts — **smart-contract-internal flows** may be missing from this view.
- **IBC** direction is **Agoric-relative** (e.g. out = `MsgTransfer` from this chain; in = recv packet handling as indexed).
- **Period comparison**: A **previous window of equal length** immediately before the selected `from` (see **Methodology & caveats** in the app).
- **Indexed window**: Rollups and participation data are only meaningful from **`INDEXED_HISTORY_FROM_DAY`** (`2026-01-01` UTC, aligned with default **`INDEXER_START_DATE`**). The API clamps an earlier **`from`** to that day; the dashboard date picker uses the same minimum.
- **Economic participation & concentration**: Successful txs only; **signers** (decoded pubkeys) and **fee payers** (fee-grant granter if set, else first signer). **Distinct account addresses per calendar day**: unique addresses per UTC day counting signer ∪ fee payer once per day (shown as a **daily line chart** over the selected From–To span and in an optional table). **Top 10 gross USD share** uses CoinGecko spot on sender-side indexed legs (bank send / multi-send inputs / ICS-20 send), same scope as indexed `transfer_volume` — not IBC recv. Counts are not “users” (bots/vaults inflate).

## Denoms, symbols, and IBC hashes

- Display names and decimal scaling for human amounts are in **`src/config/denoms.json`**. The indexer and API work in **on-chain minimal denoms**; the file maps **full** strings (e.g. `ubld`, and full `ibc/...` **hash** denoms) to `displaySymbol` and `decimals`. Entries are kept **sorted by `match`**; contract tests enforce shape and sort order.
- **CoinGecko IDs for USD estimates**: **`src/config/coingeckoDisplaySymbolToId.json`** maps each `displaySymbol` → CoinGecko `ids` string for `/simple/price`. Optional per-denom overrides: **`src/config/coingeckoDenomOverrides.json`** (`match` → id). A reviewed export with status notes lives at **`public/denom-translations.csv`** (also served at `/denom-translations.csv` when the app is running).
- A long `ibc/FE98…` style value is a **canon IBC token id** (hash of path + base denom) — the dashboard shows the raw id until you add a matching `entries` row. To find hashes registered on chain but missing from the file, diff **`GET /cosmos/bank/v1beta1/denoms_metadata`** (`base` field) against `entries[].match` (see the **note** in `denoms.json`). **Multiple** `ibc/...` values can still represent the **same** logical asset via **different IBC paths**; each path needs its own `match` row with **correct `decimals` for that path’s base denom** (query **`/ibc/apps/transfer/v1/denom_traces/{hash}`** for `base_denom`—e.g. Axelar **`uaxl`** vs **`aarch`** use different minimal-unit scales). Example: **`AXL`** vs **`AXL (router)`** in `denoms.json`.

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

Polls `RPC_URL`, resolves the first block at or after `INDEXER_START_DATE` (binary search on heights), indexes **from that height to tip**, then tails new blocks. Writes **`daily_metrics`** and **`hourly_metrics`**, and **`participant_day`** / **`address_volume_day`** (and **`address_fee_day`**) for participation metrics (`scripts/indexer.ts`). **IBC-in amounts** aggregate `coin_received` / `transfer` event credits **once per successful tx** (`src/lib/ibcRecvEventAmounts.ts`) so multi–recv-packet txs do not inflate gross rows; upgrading requires **reindexing** (or truncating metrics tables and replaying) for historically correct gross totals. In catch-up, rollup deltas are merged in memory and flushed per chunk (`addRollupDelta` / `flushRollupMaps`); participant/volume maps flush via **`flushParticipantMaps`** in the same loop.

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

Open [http://localhost:3000](http://localhost:3000). Set **Granularity**, choose a **quick range**, or open **Custom Range** to set **From / To** (minimum **From** = **`INDEXED_HISTORY_FROM_DAY`** / API clamp); changes apply automatically when you adjust filters.

Chart buckets must exist in Postgres for your selected range: if the UI shows zeros, the indexer may still be catching up to wall-clock or your range may lie outside indexed hours/days.

### Production

```bash
npm run build
npm start
```

In **Docker** or behind a reverse proxy, set **`PORT`** if the platform expects something other than **3000**; **`npm start`** uses **`--port ${PORT:-3000}`** and **`--hostname 0.0.0.0`** for container-friendly binding.

## API

- `GET /api/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|hour|week`  
  Returns rollup payload from `buildMetricsPayload` plus:
  - **`display`** — from `enrichMetricsForDisplay` (symbol/decimals **metas** per denom).
  - **`transferVolumeUsdByDenom`** — per-denom formatted USD estimate strings or `null` when unpriced.
  - **`transferVolumeUsdTotal`** — formatted sum of priced USD rows (same basis as the table **TOTAL**), or `null` if none.
  - **`usdPricingMeta`** — `{ source: "coingecko", spotFetchedAt, partialOrStale }`.
  - **`participation`** / **`concentration`** — from **`enrichParticipationAndConcentration`** in `src/lib/enrichParticipationConcentration.ts` for the Economic participation & concentration section (requires indexer-filled **`participant_day`** / **`address_volume_day`**). Methodology copy lives only in **`METHODOLOGY_BLURB`** (`src/lib/semantics.ts`), not as a separate API field.
  - **`indexedHistoryFromDay`** — `"2026-01-01"` (constant **`INDEXED_HISTORY_FROM_DAY`**); **`from`** query dates before this are clamped for all metrics.

  Core shape is in `src/lib/metricsQuery.ts` and `src/lib/metricsDisplayTypes.ts`. **`series.transferVolumeSeries`** is per denom with non-zero transfer-like volume **or** IBC recv in range; each point is **transfer_volume + ibc_transfer_amount_in** for that denom (same basis as the gross in-tx movement table). **`series.ibcAmountInSeries`** / **`ibcAmountOutSeries`** remain separate IBC recv/out views—each item is `{ denom, data: [{ bucket, value }] }`.

## Project layout

| Path | Purpose |
|------|--------|
| `docs/DEVELOPMENT.md` | Dev workflow, quality gate (`npm run verify`) |
| `docs/style-guide.md` | Visual design system (colors, type, spacing, components) for the UI |
| `scripts/indexer.ts` | Block scanner; bounded start date, catch-up vs tail; **IBC-in** amounts via **`sumRecvCoinAmountsFromTxEvents`** (once per tx) |
| `scripts/scanIbcRecvDay.ts` | Debug: scan a UTC day for IBC recv denom totals (`npm run scan:ibc-recv-day`) |
| `src/lib/ibcRecvEventAmounts.ts` | **`sumRecvCoinAmountsFromTxEvents`** — parses `coin_received` / `transfer` amounts (shared with indexer + scan script) |
| `src/config/denoms.json` | `match` (full on-chain denom) → symbol, decimals |
| `src/db/schema.ts` | `daily_metrics`, `hourly_metrics`, `indexer_state`, `participant_day`, `address_volume_day`, … (Drizzle) |
| `src/lib/semantics.ts` | `CHAIN_ID`, `SERIES`, `FEE_DENOM_UBLB`, **`INDEXED_HISTORY_FROM_DAY`**, `METHODOLOGY_BLURB` |
| `src/lib/metricsApiValidation.ts` | `GET /api/metrics` query validation (range caps, ISO dates); **`clampMetricsRangeToIndexedHistory`** |
| `src/lib/metricsQuery.ts` | `buildMetricsPayload`, KPIs, series for charts, comparison window |
| `src/lib/metricsEnrichment.ts` | `resolveDenom`-based **metas** for `display` |
| `src/lib/transferVolumeUsdEstimates.ts` | CoinGecko spot × volume; **USD** strings + **total** for the in-tx table |
| `src/lib/grossTableUsdSort.ts` | Client-side **USD (EST)** column sort for the gross in-tx table |
| `src/lib/coingecko/` | `resolveCoinGeckoId`, batched **simple/price** fetch + TTL cache |
| `src/config/coingeckoDisplaySymbolToId.json` | `displaySymbol` → CoinGecko coin id (incl. **`AXL (router)`** → `axelar`) |
| `src/config/coingeckoDenomOverrides.json` | Optional per-`match` CoinGecko id overrides |
| `src/lib/resolveDenom.ts` | Resolves a denom string using `denoms.json` |
| `src/app/api/metrics/route.ts` | JSON: `{ ...payload, display, transferVolumeUsd…, participation, concentration, indexedHistoryFromDay }` (clamps **`from`** before `buildMetricsPayload`) |
| `src/app/page.tsx` | Shell header (logo, title, **`dashboardNavLinks`** jump nav) |
| `src/lib/dashboardNav.ts` | Section anchor ids — keep aligned with **`Dashboard.tsx`** `id`s |
| `src/lib/participationQueries.ts` | Postgres reads for participation range + address volume totals |
| `src/lib/enrichParticipationConcentration.ts` | **`enrichParticipationAndConcentration`** — participation + concentration for `/api/metrics` |
| `public/denom-translations.csv` | Optional export of denom ↔ symbol ↔ CoinGecko mapping |
| `src/components/Dashboard.tsx` | Date/granularity controls, charts, tables, section anchors |
| `src/components/dashboard/charts/DistinctAccountsLineChart.tsx` | Daily distinct account addresses (**UTC**), filled series |
| `src/lib/filledDistinctAccountsSeries.ts` | Dense calendar-day rows from sparse API **distinctUnionPerDay** |
| `src/components/MetricsErrorBoundary.tsx` | Catches render errors in the client dashboard |

## Tests

**Vitest** runs tests on pure modules (**15** files, **70** tests at last `npm run verify`; no Postgres or Next server by default):

| File | Covers |
|------|--------|
| `src/lib/amountFormat.test.ts` | Human-readable amounts |
| `src/lib/resolveDenom.test.ts` | `denoms.json` resolution |
| `src/lib/displayFormat.test.ts` | Chart/list display helpers |
| `src/lib/transferVolumeUsdEstimates.test.ts` | USD estimate **formatting** (`formatUsdEstimate`) |
| `src/lib/grossTableUsdSort.test.ts` | Gross in-tx table **USD column** sort keys and comparators |
| `src/lib/coingecko/resolveCoinGeckoId.test.ts` | Symbol / override → CoinGecko id resolution (**`AXL (router)`**, stkATOM, etc.) |
| `src/lib/metricsApiValidation.test.ts` | `GET /api/metrics` validation (range caps, ISO dates, **`clampMetricsRangeToIndexedHistory`**) |
| `src/lib/metricsQuery.transferTable.test.ts` | `transferVolumeTableByDenom` rollup semantics |
| `src/lib/envExample.contract.test.ts` | `.env.example` documents indexer env vars; **`INDEXER_START_DATE`** calendar day matches **`INDEXED_HISTORY_FROM_DAY`** |
| `src/lib/denomsJson.contract.test.ts` | `denoms.json` shape, unique `match`, sorted entries |
| `src/lib/concentrationMath.test.ts` | Herfindahl-style helpers, **top-N share** (used for gross USD concentration) |
| `src/lib/transferVolumeAttribution.test.ts` | Sender-side legs for **MsgSend** / **MultiSend** / **ICS-20** (indexer + enrichment) |
| `src/lib/dashboardNav.test.ts` | Header **`dashboardNavLinks`** (omits **`filters`** toolbar); every href targets **`dashboardSectionIds`** |
| `src/lib/filledDistinctAccountsSeries.test.ts` | Dense daily series for distinct-account **time-series** chart |
| `src/lib/ibcRecvEventAmounts.test.ts` | **`sumRecvCoinAmountsFromTxEvents`** (`coin_received` / `transfer` parsing) |

```bash
npm test
# npm run test:watch   # watch mode while developing
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server |
| `npm run indexer` | Indexer worker |
| `npm run scan:ibc-recv-day` | `tsx scripts/scanIbcRecvDay.ts` — inspect IBC recv totals for a UTC day |
| `npm run db:push` | Apply Drizzle schema to Postgres |
| `npm run db:generate` | Generate SQL migrations (optional) |
| `npm test` | Run Vitest once (`vitest run`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build` | Production build |
| `npm start` | Start production server |
