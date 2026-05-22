# agoric-dash

Dashboard for monitoring on-chain activity on **Agoric L1** (`agoric-3`). Metrics are indexed from CometBFT **`block`** / **`block_results`**, rolled up in PostgreSQL (**`daily_metrics`** and **`hourly_metrics`**, plus participation tables — see below), and served by **Next.js** API routes. The UI is **Recharts** with filters for **date range** and **granularity** (UTC hour, day, or week); metrics reload when those inputs change.

The **`page.tsx`** header includes **right-aligned jump links** (`src/lib/dashboardNav.ts`) to main content sections (not the date-range toolbar); **`layout.tsx`** sets **`scroll-smooth`** on `<html>` for in-page anchors.

## What the dashboard shows

The page order follows **`Dashboard.tsx`**: **Range** (date/granularity controls at top — **`filters`** anchor only; not in header nav), **Value handled** (combined **value-by-denom** table — gross in-tx vs bank credits — then gross / bank-credits / IBC amount line charts), **Gas and fees**, **Transaction activity** KPIs, **full-width** tx vs IBC line charts, then **economic participation & concentration** (last main section, above the methodology footer). Header jump links align with the latter sections only.

| Area | Content |
|------|--------|
| **Range** | **Granularity**, **Date range** presets (uppercase label), **Custom Range** (`--color-bg-control` toolbar); controls are **centered** in the card. Anchor id **`filters`**. |
| **Value handled** | **Value by denom** HTML **table** (single card): **Gross in-tx** vs **Bank credits** side-by-side per denom — same series as the two line charts below; **do not add** the columns (overlapping settlement). **`colgroup`** + **`table-fixed`** (9% / 15% / 15% / 15% / 15% / 11%), **`min-w-0`** scroll wrapper; **Denom** column uses a **View Denom** badge with full string in a hover tooltip (fixed portal). **USD gross (EST)** header sorts (high→low / low→high / default; resets on **From / To / Granularity**). Footer shows **separate** USD totals per basis (not additive). **Zebra** rows. **Gross in-tx (per asset)** line chart with **checkboxes**; **Bank credits** line chart; **IBC amount flows**; **Date range** + **Custom Range**; **last indexed block height** (**bold**, left-aligned) when available. Intro caption includes **tx-attributed scope** (link to **Methodology**). Note under filters: **indexed-history** sentence **bold**, remainder normal; **centered**. |
| **Gas and fees** | KPIs: **gas used** (ABCI units), **paid fees uBLD → BLD**; subtitles repeat **tx-attributed scope** (see **Methodology**). |
| **Transaction activity** | KPIs: **successful txs**, **IBC out** (one per MsgTransfer), **IBC recv** (distinct `recv_packet` events when indexed, else MsgRecvPacket count); charts (**full width**): **successful txs vs IBC transfer volume**, then **IBC traffic** (out vs recv). Each includes a **dashed linear trend** (OLS vs bucket order; legend **`(trend)`**). |
| **Volume and IBC (time series)** | **Successful txs vs IBC** and **IBC traffic** line charts (full width); dashed **trend** overlays per series (`src/lib/linearTrend.ts`, `chartTheme.trendLineProps`). |
| **Economic participation & concentration** | Last main section: **daily distinct-account line chart** (UTC calendar days in range; **trend** overlay), KPI cards, **top 10** gross USD share, optional **distinct account addresses per calendar day** table — requires indexer tables `participant_day` and `address_volume_day`. |

All KPIs that support it show **prior window** and **percent change** vs an equal-length period ending immediately before the selected range (`pctChange` in `src/lib/metricsQuery.ts`).

The in-app **Methodology & caveats** panel is the full narrative (`METHODOLOGY_BLURB` in `src/lib/semantics.ts`). The bullets below are a shorter reference.

## Definitions (v1)

- **Successful txs**: ABCI result code `0` (KPI; “all txs” in charts includes **failed** inclusions as well).
- **Gas**: **ABCI / consensus gas units** — not a token and not the same as paid fees. Do not conflate with BLD or IBC.
- **Paid fees**: Parsed from **tx result events** (e.g. `tx` / `fee` attributes) — the amount actually **paid in execution**, not the signed “max fee” cap only. The primary fee KPI shows **uBLD → BLD**; the API also carries per-denom fee breakdowns for other uses.
- **Gross in-tx movement** (not supply): **Multi-asset** sum of on-chain transfer legs in the range. Native and **IBC** denoms (including long `ibc/HASH` strings) are different lines. **uBLD fee totals are not a summary of all economic value** — movement is per denom. Amounts are shown in on-chain units (human-formatted when listed in `denoms.json`). Do not treat range totals as comparable to circulating supply; they are gross flow.
- **USD (EST) in the Value handled table**: **Not** on-chain USD. **USD gross** and **USD credits** cells each multiply that column’s **range-aggregated native total** by **current CoinGecko spot** (see `src/lib/transferVolumeUsdEstimates.ts`). Footer **TOTAL** cells sum priced rows **per column** (`transferVolumeUsdTotal`, `bankCreditsVolumeUsdTotal`); **do not add** those two totals. Unmapped or rate-limited denoms show **—**. Optional **`COINGECKO_API_KEY`** (Demo) in `.env` helps free-tier rate limits (`x-cg-demo-api-key` header). **Sorting** on **USD gross (EST)** only is **client-side** (parsed from formatted currency strings); **USD credits** is not a sort key — see `src/lib/grossTableUsdSort.ts` and `src/lib/grossTableUsdSort.test.ts`.
- **Transfer / transfer volume (indexed)**: Native minimal units from decoded **`MsgSend`**, **`MsgMultiSend`**, and **`MsgTransfer`**, plus IBC recv indexing where the indexer records amounts — **smart-contract-internal flows** may be missing from this view.
- **IBC** direction is **Agoric-relative** (e.g. out = `MsgTransfer` from this chain; in = recv packet handling as indexed).
- **Period comparison**: A **previous window of equal length** immediately before the selected `from` (see **Methodology & caveats** in the app).
- **Indexed window**: Rollups and participation data are only meaningful from **`INDEXED_HISTORY_FROM_DAY`** (`2026-01-01` UTC, aligned with default **`INDEXER_START_DATE`**). The API clamps an earlier **`from`** to that day; the dashboard date picker uses the same minimum.
- **Indexer ingest scope (not TVL-like)**: Rollups use **`block_results.txs_results`** only (paired with block txs). Block-level inflation, distribution payouts, and slashing that appear only at finalize-block scope are **out of scope** unless mirrored inside a tx result (`src/lib/indexerIngestScope.ts`). The dashboard surfaces **`INDEXER_SCOPE_CAVEAT_INLINE`** / **`INDEXER_SCOPE_CAVEAT_SUBTITLE`** next to **Value handled**, **Gas and fees**, and **Economic participation** (`src/lib/semantics.ts`, `Dashboard.tsx`); the full narrative remains **Methodology & caveats** in the app (`METHODOLOGY_BLURB`).
- **Economic participation & concentration**: Successful txs only; **signers** (decoded pubkeys) and **fee payers** (fee-grant granter if set, else first signer). **Distinct account addresses per calendar day**: unique addresses per UTC day counting signer ∪ fee payer once per day (shown as a **daily line chart** over the selected From–To span and in an optional table). **Top 10 gross USD share** uses CoinGecko spot on sender-side indexed legs (bank send / multi-send inputs / ICS-20 send), same scope as indexed `transfer_volume` — not IBC recv. Counts are not “users” (bots/vaults inflate).

## Denoms, symbols, and IBC hashes

- Display names and decimal scaling for human amounts are in **`src/config/denoms.json`**. The indexer and API work in **on-chain minimal denoms**; the file maps **full** strings (e.g. `ubld`, and full `ibc/...` **hash** denoms) to `displaySymbol` and `decimals`. Entries are kept **sorted by `match`**; contract tests enforce shape and sort order.
- **CoinGecko IDs for USD estimates**: **`src/config/coingeckoDisplaySymbolToId.json`** maps each `displaySymbol` → CoinGecko `ids` string for `/simple/price`. Optional per-denom overrides: **`src/config/coingeckoDenomOverrides.json`** (`match` → id). A reviewed export with status notes lives at **`public/denom-translations.csv`** (also served at `/denom-translations.csv` when the app is running).
- A long `ibc/FE98…` style value is a **canon IBC token id** (hash of path + base denom) — the **Value handled** table keeps the raw id in a **View Denom** tooltip; charts and other views may still show the raw id until you add a matching `entries` row. To find hashes registered on chain but missing from the file, diff **`GET /cosmos/bank/v1beta1/denoms_metadata`** (`base` field) against `entries[].match` (see the **note** in `denoms.json`). Identify new IBC assets with **`GET /ibc/apps/transfer/v1/denom_traces/{hash}`** plus [cosmos/chain-registry](https://github.com/cosmos/chain-registry) metadata (see **`docs/DEVELOPMENT.md`**). **Multiple** `ibc/...` values can still represent the **same** logical asset via **different IBC paths**; each path needs its own `match` row with **correct `decimals` for that path’s base denom** (query **`/ibc/apps/transfer/v1/denom_traces/{hash}`** for `base_denom`—e.g. Axelar **`uaxl`** vs **`aarch`** use different minimal-unit scales; Provenance **`nhash`** uses **9**, not 6). Examples: **`AXL`** vs **`AXL (router)`**; **`HASH`** (Provenance via IBC).

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

Polls `RPC_URL` (with optional `RPC_URL_FALLBACK` consulted per-call on primary failure — see `rpcCallWithFallback` in `src/lib/rpc.ts`), resolves the first block at or after `INDEXER_START_DATE` (binary search on heights), indexes **from that height to tip**, then tails new blocks. Writes **`daily_metrics`** and **`hourly_metrics`**, and **`participant_day`** / **`address_volume_day`** (and **`address_fee_day`**) for participation metrics (`scripts/indexer.ts`). **IBC-in amounts** (`ibc_transfer_amount_in`) use **`sumRecvCoinAmountsFromTxEvents`**: both **`coin_received`** and **`transfer`** event amounts that match **`MsgRecvPacket`** **`msg_index`** when emitted (legacy tx-wide sum when filtering yields nothing). Typical SDK paths emit **both** event types for the same credit, so the combined rollup is a **gross chain-facing index**, not “each base unit counted once across event families” — see **`docs/ibcTransferAmountInEventInvestigation.md`** and **`npm run inspect:ibc-recv-tx-events`**. Parser or event-shape changes still require **reindexing** (or truncating metrics tables and replaying) for historically correct totals. In catch-up, rollup deltas are merged in memory and flushed per chunk (`addRollupDelta` / `flushRollupMaps`); participant/volume maps flush via **`flushParticipantMaps`** in the same loop.

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
| `RPC_URL` | Primary CometBFT JSON-RPC HTTP endpoint (canonical Agoric archive `https://main-a.rpc.agoric.net` recommended) |
| `RPC_URL_FALLBACK` | Optional backup endpoint; consulted per-call on primary failure (`rpcCallWithFallback` in `src/lib/rpc.ts`) |
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

Open [http://localhost:3000](http://localhost:3000). Set **Granularity**, choose a **date range** preset, or open **Custom Range** to set **From / To** (minimum **From** = **`INDEXED_HISTORY_FROM_DAY`** / API clamp); changes apply automatically when you adjust filters.

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
  - **`transferVolumeByDenom`** / **`bankCreditsVolumeByDenom`** — range totals (native minimal units) backing the Value handled table **Gross in-tx** and **Bank credits** columns.
  - **`transferVolumeUsdByDenom`** — per-denom formatted USD estimate strings for **gross in-tx** column totals, or `null` when unpriced.
  - **`transferVolumeUsdTotal`** — formatted sum of priced **gross** USD rows (same basis as the table **USD gross** footer), or `null` if none.
  - **`bankCreditsVolumeUsdByDenom`** / **`bankCreditsVolumeUsdTotal`** — same spot logic for **bank credits** column totals (table **USD credits** footer); not additive with gross USD totals.
  - **`usdPricingMeta`** — `{ source: "coingecko", spotFetchedAt, partialOrStale }`.
  - **`participation`** / **`concentration`** — from **`enrichParticipationAndConcentration`** in `src/lib/enrichParticipationConcentration.ts` for the Economic participation & concentration section (requires indexer-filled **`participant_day`** / **`address_volume_day`**). Methodology copy lives only in **`METHODOLOGY_BLURB`** (`src/lib/semantics.ts`), not as a separate API field.
  - **`indexedHistoryFromDay`** — `"2026-01-01"` (constant **`INDEXED_HISTORY_FROM_DAY`**); **`from`** query dates before this are clamped for all metrics.

  Core shape is in `src/lib/metricsQuery.ts` and `src/lib/metricsDisplayTypes.ts`. **`series.transferVolumeSeries`** is per denom with non-zero transfer-like volume **or** IBC recv in range; each point is **transfer_volume + ibc_transfer_amount_in** for that denom (same basis as the **Gross in-tx** column of the value-handled denom table). **`series.ibcAmountInSeries`** / **`ibcAmountOutSeries`** remain separate IBC recv/out views—each item is `{ denom, data: [{ bucket, value }] }`.

## Project layout

| Path | Purpose |
|------|--------|
| `docs/DEVELOPMENT.md` | Dev workflow, quality gate (`npm run verify`) |
| `docs/style-guide.md` | Visual design system (colors, type, spacing, components) for the UI |
| `scripts/indexer.ts` | Block scanner; bounded start date, catch-up vs tail; **IBC-in** amounts via **`sumRecvCoinAmountsFromTxEvents`** (per successful tx; **`coin_received`** + **`transfer`** — see **`docs/ibcTransferAmountInEventInvestigation.md`**) |
| `scripts/scanIbcRecvDay.ts` | Debug: scan a UTC day for IBC recv denom totals (`npm run scan:ibc-recv-day`). Optional **`SCAN_HEIGHT_START`** + **`SCAN_HEIGHT_END_EXCLUSIVE`** skip time→height lookup; **`SCAN_CONCURRENCY`** limits parallelism; RPC calls **retry** on transient failures. |
| `scripts/inspectIbcRecvTxEventAmounts.ts` | Debug: one **`MsgRecvPacket`** tx — split **`coin_received`** vs **`transfer`** vs combined (`npm run inspect:ibc-recv-tx-events`); see **`docs/ibcTransferAmountInEventInvestigation.md`**. |
| `docs/ibcTransferAmountInEventInvestigation.md` | Notes on **`ibc_transfer_amount_in`** event sums and double-count semantics vs **`bank_credits_volume`**. |
| `scripts/validateUistIbcApril2026.sh` | Optional: sequential **`scanIbcRecvDay`** for fixed UTC days (example IST/`uist` validation vs **`ibc_transfer_amount_in`**); long-running. |
| `scripts/backfillIbcTransferFlowIn.ts` | Backfill **`ibc_transfer_flow_in`** for full indexed span without touching other metrics (see **`npm run backfill:ibc-flow-in`**); optional **`BACKFILL_SKIP_DELETE=1`** to resume without wiping prior rows |
| `scripts/backfillBankCreditsVolume.ts` | Backfill **`bank_credits_volume`** for full indexed span (event-derived value moved, module-account filtered) without touching other metrics (see **`npm run backfill:bank-credits`**); optional **`BACKFILL_SKIP_DELETE=1`** to resume without wiping prior rows |
| `src/lib/ibcRecvEventAmounts.ts` | **`sumRecvCoinAmountsFromTxEvents`** — parses `coin_received` / `transfer` amounts (shared with indexer + scan script) |
| `src/config/denoms.json` | `match` (full on-chain denom) → symbol, decimals |
| `src/db/schema.ts` | `daily_metrics`, `hourly_metrics`, `indexer_state`, `participant_day`, `address_volume_day`, … (Drizzle) |
| `src/lib/semantics.ts` | `CHAIN_ID`, `SERIES`, `FEE_DENOM_UBLB`, **`INDEXED_HISTORY_FROM_DAY`**, **`INDEXER_SCOPE_CAVEAT_*`**, `METHODOLOGY_BLURB` |
| `src/lib/metricsApiValidation.ts` | `GET /api/metrics` query validation (range caps, ISO dates); **`clampMetricsRangeToIndexedHistory`** |
| `src/lib/metricsQuery.ts` | `buildMetricsPayload`, KPIs, series for charts, comparison window |
| `src/lib/metricsEnrichment.ts` | `resolveDenom`-based **metas** for `display` |
| `src/lib/transferVolumeUsdEstimates.ts` | CoinGecko spot × volume; **USD gross** + **USD credits** strings and **separate totals** for the Value handled denom table (`enrichTransferAndBankCreditsUsdEstimates`) |
| `src/lib/grossTableUsdSort.ts` | Row shape + client-side **USD gross (EST)** sort for the combined value-handled table (`GrossMovementRow` includes bank-credits display fields; sort uses **gross** USD only) |
| `src/lib/rechartsTooltip.ts` | **`filterNonZeroTooltipPayload`** for multi-series chart tooltips |
| `src/lib/ibcRollupDisplay.ts` | API/chart display: IBC recv flow vs legacy raw msg count |
| `src/lib/coingecko/` | `resolveCoinGeckoId`, batched **simple/price** fetch + TTL cache |
| `src/lib/chartTheme.ts` | Grid/tooltip/series stroke tokens + **`trendLineProps`** (dashed trend overlays) |
| `src/lib/linearTrend.ts` | **`linearTrendLine`** — OLS trend ordinates for chart overlays |
| `src/config/coingeckoDisplaySymbolToId.json` | `displaySymbol` → CoinGecko coin id (e.g. **`AXL (router)`** → `axelar`, **`SEI`** → `sei-network`, **`PICA`** → `pica`) |
| `src/config/coingeckoDenomOverrides.json` | Optional per-`match` CoinGecko id overrides |
| `src/lib/resolveDenom.ts` | Resolves a denom string using `denoms.json` |
| `src/app/api/metrics/route.ts` | JSON: `{ ...payload, display, transferVolumeUsd…, participation, concentration, indexedHistoryFromDay }` (clamps **`from`** before `buildMetricsPayload`) |
| `src/app/page.tsx` | Shell header (logo, title, **`dashboardNavLinks`** jump nav) |
| `src/lib/dashboardNav.ts` | Section anchor ids — keep aligned with **`Dashboard.tsx`** `id`s |
| `src/lib/participationQueries.ts` | Postgres reads for participation range + address volume totals |
| `src/lib/enrichParticipationConcentration.ts` | **`enrichParticipationAndConcentration`** — participation + concentration for `/api/metrics` |
| `public/denom-translations.csv` | Optional export of denom ↔ symbol ↔ CoinGecko mapping |
| `src/components/Dashboard.tsx` | Date/granularity controls, combined value-by-denom table (**View Denom** portal tooltip), charts, section anchors |
| `src/components/dashboard/charts/DistinctAccountsLineChart.tsx` | Daily distinct account addresses (**UTC**), filled series |
| `src/lib/filledDistinctAccountsSeries.ts` | Dense calendar-day rows from sparse API **distinctUnionPerDay** |
| `src/components/MetricsErrorBoundary.tsx` | Catches render errors in the client dashboard |

## Tests

**Vitest** runs tests on pure modules (**37** test files, **169** tests at last `npm run verify`; no Postgres or Next server by default):

| File | Covers |
|------|--------|
| `src/lib/amountFormat.test.ts` | Human-readable amounts |
| `src/lib/resolveDenom.test.ts` | `denoms.json` resolution |
| `src/lib/displayFormat.test.ts` | Chart/list display helpers |
| `src/lib/transferVolumeUsdEstimates.test.ts` | USD estimate **formatting** (`formatUsdEstimate`) |
| `src/lib/grossTableUsdSort.test.ts` | Value-handled table: **USD** sort keys, comparators, **gross-only** sort vs `creditsUsd` |
| `src/lib/rechartsTooltip.test.ts` | **`filterNonZeroTooltipPayload`** — tooltip rows omit zeros |
| `src/lib/ibcRollupDisplay.test.ts` | IBC recv headline: **`ibc_transfer_flow_in`** vs legacy **`ibc_transfer_in_count`** |
| `src/lib/ibcTransferFlowInRollup.test.ts` | **`addIbcTransferFlowInForTx`** map keys and recv_packet dedupe |
| `src/lib/coingecko/resolveCoinGeckoId.test.ts` | Symbol / override → CoinGecko id resolution (**`AXL (router)`**, **SEI** / **sei-network**, stkATOM, etc.) |
| `src/lib/linearTrend.test.ts` | Ordinary least-squares trend arrays for chart overlays |
| `src/lib/chartTheme.contract.test.ts` | `chartTheme` tokens (`trendLineProps`, series stroke palette) |
| `src/lib/metricsApiValidation.test.ts` | `GET /api/metrics` validation (range caps, ISO dates, **`clampMetricsRangeToIndexedHistory`**) |
| `src/lib/metricsQuery.transferTable.test.ts` | `transferVolumeTableByDenom` rollup semantics |
| `src/lib/envExample.contract.test.ts` | `.env.example` documents indexer env vars (including **`INDEXER_RPC_RETRIES`**, **`RPC_URL_FALLBACK`**, **`BACKFILL_SKIP_DELETE`**), **`scanIbcRecvDay`** overrides; **`INDEXER_START_DATE`** calendar day matches **`INDEXED_HISTORY_FROM_DAY`** |
| `src/lib/metricDictionary.contract.test.ts` | One dictionary entry per **`SERIES`**; **`ibc_transfer_amount_in`** links **`docs/ibcTransferAmountInEventInvestigation.md`** |
| `src/lib/rollupSourceHierarchy.contract.test.ts` | **`SERIES_ROLLUP_SOURCE`** covers every series; **`ibc_transfer_amount_in`** secondary notes gross / investigation doc |
| `src/lib/denomsJson.contract.test.ts` | `denoms.json` shape, unique `match`, sorted entries |
| `src/lib/concentrationMath.test.ts` | Herfindahl-style helpers, **top-N share** (used for gross USD concentration) |
| `src/lib/transferVolumeAttribution.test.ts` | Sender-side legs for **MsgSend** / **MultiSend** / **ICS-20** (indexer + enrichment) |
| `src/lib/dashboardNav.test.ts` | Header **`dashboardNavLinks`** (omits **`filters`** toolbar); every href targets **`dashboardSectionIds`** |
| `src/lib/filledDistinctAccountsSeries.test.ts` | Dense daily series for distinct-account **time-series** chart |
| `src/lib/ibcRecvEventAmounts.test.ts` | **`sumRecvCoinAmountsFromTxEvents`**, **`diagnoseRecvCoinAmountsByEventType`** (`coin_received` / `transfer` parsing + diagnostics) |
| `src/lib/semantics.contract.test.ts` | **`TX_RESULT_ROLLUP_POLICY`** vs metric dictionary; **`INDEXER_SCOPE_CAVEAT_*`** shape; **`METHODOLOGY_BLURB`** documents combined Value handled UI |

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
| `npm run inspect:ibc-recv-tx-events` | `tsx scripts/inspectIbcRecvTxEventAmounts.ts` — **`coin_received`** / **`transfer`** diagnostic for one recv tx (`docs/ibcTransferAmountInEventInvestigation.md`) |
| `npm run validate:uist-apr2026` | `scripts/validateUistIbcApril2026.sh` — multi-day IBC-in replay vs DB (long-running; optional) |
| `npm run backfill:ibc-flow-in` | `scripts/backfillIbcTransferFlowIn.ts` — delete **`ibc_transfer_flow_in`** rows (unless `BACKFILL_SKIP_DELETE=1`), replay blocks to tip cursor, rewrite **only** that series (daily + hourly) |
| `npm run backfill:bank-credits` | `scripts/backfillBankCreditsVolume.ts` — delete **`bank_credits_volume`** rows (unless `BACKFILL_SKIP_DELETE=1`), replay blocks to tip cursor, rewrite **only** that series (daily + hourly); event-derived, module-account filtered |
| `npm run db:push` | Apply Drizzle schema to Postgres |
| `npm run db:generate` | Generate SQL migrations (optional) |
| `npm test` | Run Vitest once (`vitest run`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build` | Production build |
| `npm start` | Start production server |
