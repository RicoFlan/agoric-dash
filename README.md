# agoric-dash

Dashboard for monitoring on-chain activity on **Agoric L1** (`agoric-3`). Metrics are indexed from CometBFT **`block`** / **`block_results`**, rolled up in PostgreSQL (**`daily_metrics`** and **`hourly_metrics`**, plus participation tables — see below), and served by **Next.js** API routes. The UI is **Recharts** with filters for **date range** and **granularity** (UTC hour, day, or week); metrics reload when those inputs change.

The **`page.tsx`** header includes **right-aligned jump links** (`src/lib/dashboardNav.ts`) to main content sections (not the date-range toolbar); **`layout.tsx`** sets **`scroll-smooth`** on `<html>` for in-page anchors.

## What the dashboard shows

The page is organised around **four questions** (design doc: "Four Questions"), one section each, in this order. Every section has **one headline** with its **prior-window** comparison, **one chart**, a few **support figures** (each with an ⓘ definition), and a collapsed **Detail** drawer for what was demoted from the old page.

| Section | Headline | Chart | Support | Detail drawer |
|---|---|---|---|---|
| **Q1 Is the chain busier?** (`#busier`) | successful txs (ABCI 0) vs prior window, with any unusual days named | successful txs per bucket, OLS trend, anomaly ring markers at day grain | distinct accounts per day (avg), failure rate, paid fees (BLD) | gas used/wanted, efficiency, block-space utilization, raw fee totals, failed txs; IBC message counts + IBC traffic chart; staking & governance counts + chart; success-rate chart |
| **Q2 Is usage becoming more organic?** (`#organic`) | interactive ÷ all wallet actions (%), Δ in points, with action counts | automated vs interactive actions per bucket | distinct interactive wallets, distinct automated wallets, overall satisfaction rate; satisfaction-by-category table; actions-by-category table | settled outcome counts; by instance / maker / invocation target / source; offer value by asset (payouts primary, give/want secondary, day-priced USD) |
| **Q3 Is value flowing in or out?** (`#value-flow`) | net IBC flow in USD (in − out), day-priced, vs prior window; in/out USD and pricing basis | net flow per bucket for one asset (selector; top assets by absolute net USD), zero line emphasised | IBC in (USD), value received on-chain (bank credits USD); net-flow-by-asset table (native + USD) | value received by asset (bank credits, one USD column), raw denom ids, pricing basis |
| **Q4 Is the economic base broadening or concentrating?** (`#base`) | effective number of fee payers (1 ÷ HHI of day-priced fee USD) vs prior window; gross-basis effective-N and top-10 fee share | effective-N (fee and gross basis) per UTC day + top-10 fee share | retained share (Δ pts), new-address share, active 2+ days, top-10 fee share | distinct signers / fee payers, active 1 day only, top-10 gross share, raw HHIs; distinct accounts per day chart + table |

Removed in the redesign: the Value Flow Map (and its Momentum tiles), the normalized-ratio cards, the gross-vs-credits two-basis denom table, and the transactions-vs-IBC dual-axis chart. Their data still exists in `/api/metrics`; see **Questions payload** for the derived indicators.

All KPIs that support it show **prior window** and **percent change** vs an equal-length period ending immediately before the selected range (`pctChange` in `src/lib/metricsQuery.ts`).

The dashboard footer links to **`/methodology`** (`src/app/methodology/page.tsx`), which renders the one-line indicator definitions from **`DEFINITIONS`** (`src/lib/definitions.ts` — the same strings behind every ⓘ hint) and the full structured text from **`METHODOLOGY_SECTIONS`** in `src/lib/semantics.ts` (plain-text **`METHODOLOGY_BLURB`** is the same content joined for search and contracts). Above Q1, a **What changed this period** strip (`src/lib/narrative.ts`, deterministic templates — no model) names up to three movers ranked by largest unusual day, then change vs the prior window. The bullets below are a shorter reference.

## Definitions (v1)

- **Successful txs**: ABCI result code `0` (KPI; “all txs” in charts includes **failed** inclusions as well).
- **Gas**: **ABCI / consensus gas units** — not a token and not the same as paid fees. Do not conflate with BLD or IBC.
- **Paid fees**: Parsed from **tx result events** (e.g. `tx` / `fee` attributes) — the amount actually **paid in execution**, not the signed “max fee” cap only. The primary fee KPI shows **uBLD → BLD**; the API also carries per-denom fee breakdowns for other uses.
- **Gross in-tx movement** (not supply): **Multi-asset** sum of on-chain transfer legs in the range (`transfer_volume` + indexed IBC recv per denom in the table and Value Flow Map). Native and **IBC** denoms (including long `ibc/HASH` strings) are different lines. **uBLD fee totals are not a summary of all economic value** — movement is per denom. Amounts are shown in on-chain units (human-formatted when listed in `denoms.json`). Do not treat range totals as comparable to circulating supply; they are gross flow.
- **USD (EST) in the Value handled table**: **Not** on-chain USD. **USD gross** and **USD credits** cells price each day’s native amount at **that day’s CoinGecko price** (`denom_price_day`, the 00:00 UTC `/market_chart` point) and sum over the range; days with no stored price fall back to current spot and the response reports the basis (`usdPricingMeta.basis`). See `src/lib/denomPrices.ts`, `src/lib/transferVolumeUsdEstimates.ts`, and **Daily prices** below. Footer **TOTAL** cells sum priced rows **per column** (`transferVolumeUsdTotal`, `bankCreditsVolumeUsdTotal`); **do not add** those two totals. Unmapped or rate-limited denoms show **—**. Optional **`COINGECKO_API_KEY`** (Demo) in `.env` helps free-tier rate limits (`x-cg-demo-api-key` header). **Sorting** on **USD gross (EST)** only is **client-side** (parsed from formatted currency strings); **USD credits** is not a sort key — see `src/lib/grossTableUsdSort.ts` and `src/lib/grossTableUsdSort.test.ts`.
- **Transfer / transfer volume (indexed)**: Native minimal units from decoded **`MsgSend`**, **`MsgMultiSend`**, and **`MsgTransfer`**, plus IBC recv indexing where the indexer records amounts — **smart-contract-internal flows** may be missing from this view.
- **IBC** direction is **Agoric-relative** (e.g. out = `MsgTransfer` from this chain; in = recv packet handling as indexed).
- **Period comparison**: A **previous window of equal length** immediately before the selected `from` (see **Methodology & caveats** in the app).
- **Indexed window**: Rollups and participation data are only meaningful from **`INDEXED_HISTORY_FROM_DAY`** (`2026-01-01` UTC, aligned with default **`INDEXER_START_DATE`**). The API clamps an earlier **`from`** to that day; the dashboard date picker uses the same minimum.
- **Indexer ingest scope (not TVL-like)**: Rollups use **`block_results.txs_results`** only (paired with block txs). Block-level inflation, distribution payouts, and slashing that appear only at finalize-block scope are **out of scope** unless mirrored inside a tx result (`src/lib/indexerIngestScope.ts`). The dashboard surfaces **`INDEXER_SCOPE_CAVEAT_INLINE`** / **`INDEXER_SCOPE_CAVEAT_SUBTITLE`** next to **Value handled**, **Gas and fees**, and **Economic participation** (`src/lib/semantics.ts`, `Dashboard.tsx`); the full narrative remains **Methodology & caveats** in the app (`METHODOLOGY_BLURB`).
- **Economic participation & concentration**: Successful txs only; **signers** (decoded pubkeys) and **fee payers** (fee-grant granter if set, else first signer). **Distinct account addresses per calendar day**: unique addresses per UTC day counting signer ∪ fee payer once per day (shown as a **daily line chart** over the selected From–To span and in an optional table). **Top 10 gross USD share** uses day-priced USD (see **Daily prices**) on sender-side indexed legs (bank send / multi-send inputs / ICS-20 send), same scope as indexed `transfer_volume` — not IBC recv. Counts are not “users” (bots/vaults inflate).
- **SwingSet & Zoe offers**: Most Agoric activity is smart-wallet **intent**, not bare Cosmos messages. The indexer decodes **`MsgWalletSpendAction`** / **`MsgWalletAction`** CapData (`@endo/marshal`) into **`wallet_actions`** by kind (`zoe_offer` = executeOffer/tryExitOffer; `wallet_invocation` = invokeEntry), the offer source, target **instance** (Board id → agoricNames label via `src/config/agoricNames.json`), invitation **maker**, invocation **target**, and one functional **`offer_category`** per action. **Distinct submitting wallets** (`offer_participant_day`) are the key anti-overcounting signal — a few automation wallets submit most raw actions. **Offer outcomes** are self-indexed from the same wallets' vstorage `offerStatus` updates in `block_results.finalize_block_events` (EndBlock vstorage — a narrow exception to the tx-results scope), counted **once per settled offer** at its terminal payout as satisfied / refunded (unsatisfied) / errored. **Offer value** is summed per **vbank** asset (`offer_give_volume` / `offer_want_volume` intent + `offer_payout_volume` settled), each leg's brand Board id mapped to its denom via `published.agoricNames.vbankAsset`; **USD** prices each day's native amount at that day's CoinGecko daily price (gross flow, not net/TVL — give/want/payouts overlap and are **not additive**). Non-vbank brands are omitted. See **Methodology & caveats** → "SwingSet & Zoe offers".

## Daily prices (`denom_price_day`)

USD figures are **day-accurate**: each UTC day's native amount × that day's CoinGecko price, summed over the range (offer value and concentration use the same basis). Prices live in **`denom_price_day`** `(day, coingecko_id, usd)`, keyed by CoinGecko id so every `ibc/…` path of the same asset shares one row per day.

- **Backfill once** (additive, idempotent, never deletes; free tier caps history at 365 days): `npm run backfill:prices` — creates the table if absent and upserts every id in `coingeckoDisplaySymbolToId.json` ∪ overrides. Optional `PRICE_BACKFILL_DAYS`, `PRICE_BACKFILL_IDS`, `PRICE_REQUEST_DELAY_MS`; a `COINGECKO_API_KEY` (Demo) is recommended.
- **Kept current by the indexer**: `scripts/indexer.ts` runs `refreshDailyPrices` (last `PRICE_REFRESH_DAYS`, default 3) every `PRICE_REFRESH_MS` (default 6h) alongside block indexing; `PRICE_REFRESH_DISABLED=1` turns it off. The price point is the **first `/market_chart` point on each UTC day** (≈ 00:00 UTC), the same rule for backfill and refresh.
- **Read path**: `/api/metrics` loads the range's rows once (`src/lib/loadDailyPriceTable.ts`), fetches spot only for ids missing a day (normally today), and each USD section reports `usdPricingMeta` — `basis` of `daily-close` / `spot-fallback` / `mixed` / `none` plus `pricedDays` / `spotFallbackDays` / `unpricedDays` counts. Before the first backfill the table is absent and everything is spot; the dashboard says so.
- Not touched by `reindex:reset`; the rollup tables are never read or written by price code.

## Questions payload (`questions` in `/api/metrics`)

Read-time derived indicators for the four headline questions (design doc: "Four Questions", P1). Each block has a headline with a **prior-window** comparison, a **day-grain** series over a context window (`contextFromDay` = the earlier of the prior window start and a 30-day anomaly lookback), and **anomaly flags** (trailing-30-day z-score, |z| ≥ 2.5, `src/lib/anomalies.ts`).

| Block | Headline | Support / detail | Source |
|-------|----------|------------------|--------|
| `q1` busier | successful txs | distinct accounts/day avg, failure rate, paid fees (BLD) | `daily_metrics`, `participant_day` |
| `q2` organic | interactive ÷ all wallet actions (%) | counts by automation class, per-day ratio | `offer_category` via `categoryAutomation()` (`src/lib/organicActivity.ts`) |
| `q3` value-flow | net IBC flow in USD (in − out), day-priced | per-asset in/out/net (native + USD), chart-grain per-bucket series for top assets | `ibc_transfer_amount_in/out` + `denom_price_day` (`src/lib/netIbcFlow.ts`) |
| `q4` base | effective number of fee payers = 1 ÷ HHI(fee USD) | gross-basis effective-N, retention (share of this window's addresses active in the prior window; share new to indexed history), top-10 fee share, active 2+ days | `address_fee_day`, `participant_day` (`src/lib/retention.ts`, `queryRetentionCounts`) |

Everything here is computed from existing rollups — no indexer change and no reindex. Day-grain by design, so at hour granularity the daily series and prior window still refer to UTC calendar days.

Two Q2 support figures need the P2 indexer outputs (forward-only from the deploy height, then backfilled once with **`npm run backfill:offer-categories`** — additive, `SKIP_DELETE`-style, never `reindex:reset`):

- **`offer_category_participant_day`** (day × owner × functional category) → `q2.support.distinctInteractiveWallets` / `distinctAutomatedWallets` (`available: false` until the table exists).
- **`offer_outcome_category`** series (`<category>|<outcome>`, same terminal `offerStatus` events as `offer_outcome`; category from the `invitationSpec` the smart wallet echoes in the status, verified on mainnet) → `q2.support.satisfactionByCategory` and `offers.outcomes.byCategory`.

Parity for both: `npx tsx scripts/verifyRollupParity.ts --day=YYYY-MM-DD --replay-offer-categories`.

## Denoms, symbols, and IBC hashes

- Display names and decimal scaling for human amounts are in **`src/config/denoms.json`**. The indexer and API work in **on-chain minimal denoms**; the file maps **full** strings (e.g. `ubld`, and full `ibc/...` **hash** denoms) to `displaySymbol` and `decimals`. Entries are kept **sorted by `match`**; contract tests enforce shape and sort order.
- **Chain-disambiguated labels**: many distinct `ibc/...` denoms are the same logical asset bridged over different chains, so `displaySymbol`s are tagged **`SYMBOL (Origin)`** — e.g. **`USDC (Noble)`** vs **`USDC (Axelar)`** vs **`USDC (Gravity Bridge)`**, **`USDT (Wormhole)`** — to keep the **Value handled** table and **Value Flow Map** rows distinguishable. Regenerate with **`WRITE=1 npx tsx scripts/refreshDenomChains.ts`** (dry-run without `WRITE`): origin comes from each denom's `base_denom` (native micro-denoms map directly — `uatom`→Cosmos Hub, `ubld`/`uist`→Agoric; bridge shapes — `gravity0x…`→Gravity Bridge, `peggy0x…`→Injective, bare `0x…`→Wormhole, `*-wei`/`uaxl`→Axelar) plus a stable Agoric first-hop to split Noble vs Axelar `uusdc`/`uusdt`. Tags are **cosmetic** — `resolveCoinGeckoId` strips the trailing ` (…)` group before lookup, so USD pricing is unaffected. The script also rewrites `displaySymbol` in `public/denom-translations.csv`; same-asset-same-origin denoms intentionally share a label. See **`docs/DEVELOPMENT.md`** → "Denom chain labels".
- **CoinGecko IDs for USD estimates**: **`src/config/coingeckoDisplaySymbolToId.json`** maps each `displaySymbol` → CoinGecko `ids` string for `/simple/price`. Optional per-denom overrides: **`src/config/coingeckoDenomOverrides.json`** (`match` → id). A reviewed export with status notes lives at **`public/denom-translations.csv`** (also served at `/denom-translations.csv` when the app is running).
- A long `ibc/FE98…` style value is a **canon IBC token id** (hash of path + base denom) — the Q3 tables and asset selector keep the raw id (full string on hover) until you add a matching `entries` row. To find hashes registered on chain but missing from the file, diff **`GET /cosmos/bank/v1beta1/denoms_metadata`** (`base` field) against `entries[].match` (see the **note** in `denoms.json`). Identify new IBC assets with **`GET /ibc/apps/transfer/v1/denom_traces/{hash}`** plus [cosmos/chain-registry](https://github.com/cosmos/chain-registry) metadata (see **`docs/DEVELOPMENT.md`**). **Multiple** `ibc/...` values can still represent the **same** logical asset via **different IBC paths**; each path needs its own `match` row with **correct `decimals` for that path’s base denom** (query **`/ibc/apps/transfer/v1/denom_traces/{hash}`** for `base_denom`—e.g. Axelar **`uaxl`** vs **`aarch`** use different minimal-unit scales; Provenance **`nhash`** uses **9**, not 6). Examples: **`AXL (Axelar)`** vs **`AXL (Archway)`**; **`HASH`** (Provenance via IBC).

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

Polls `RPC_URL` (with optional `RPC_URL_FALLBACK` consulted per-call on primary failure — see `rpcCallWithFallback` in `src/lib/rpc.ts`), resolves the first block at or after `INDEXER_START_DATE` (binary search on heights), indexes **from that height to tip**, then tails new blocks. Writes **`daily_metrics`** and **`hourly_metrics`**, and **`participant_day`** / **`address_volume_day`** (and **`address_fee_day`**) for participation metrics (`scripts/indexer.ts`). **IBC-in amounts** (`ibc_transfer_amount_in`) use **`sumRecvCoinAmountsDedupedFromTxEvents`**: a **deduped single-count basis** = per denom **`max(coin_received sum, transfer sum)`** over events matching **`MsgRecvPacket`** **`msg_index`** when emitted (legacy tx-wide sum when filtering yields nothing). Typical SDK paths emit **both** event types for the same credit, so taking the max counts each base unit once instead of ~2× — see **`docs/ibcTransferAmountInEventInvestigation.md`** and **`npm run inspect:ibc-recv-tx-events`**. Parser or event-shape changes still require **reindexing** (or truncating metrics tables and replaying) for historically correct totals. In catch-up, rollup deltas are merged in memory and flushed per chunk (`addRollupDelta` / `flushRollupMaps`); participant/volume maps flush via **`flushParticipantMaps`** in the same loop.

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
  - **`participation`** / **`concentration`** — from **`enrichParticipationAndConcentration`** in `src/lib/enrichParticipationConcentration.ts` for the Economic participation & concentration section (requires indexer-filled **`participant_day`** / **`address_volume_day`**). Methodology copy lives only in **`METHODOLOGY_SECTIONS`** / **`METHODOLOGY_BLURB`** (`src/lib/semantics.ts`), not as a separate API field.
  - **`offers`** — from **`buildOffersSection`** (`src/lib/offersMetrics.ts`) + **`queryOfferParticipantsRange`** (`src/lib/offersQuery.ts`): SwingSet/Zoe KPIs, by-category/instance/maker/target breakdowns, offers-over-time, distinct submitting wallets, **`outcomes`** (settled / satisfied / unsatisfied / errored + over-time), and **`value`** (`giveByDenom` / `wantByDenom` / `payoutByDenom` atomic totals).
  - **`offerValueUsd`** — from **`enrichOfferValueUsd`** (`src/lib/offerValueUsd.ts`): per-denom + total USD for offer give / want / payouts, day-priced (`{ give, want, payouts, usdPricingMeta }`); gross flow, not additive across the three.
  - **`indexedHistoryFromDay`** — `"2026-01-01"` (constant **`INDEXED_HISTORY_FROM_DAY`**); **`from`** query dates before this are clamped for all metrics.

  Core shape is in `src/lib/metricsQuery.ts` and `src/lib/metricsDisplayTypes.ts`. **`series.transferVolumeSeries`** is per denom with non-zero transfer-like volume **or** IBC recv in range; each point is **transfer_volume + ibc_transfer_amount_in** for that denom (same basis as the **Gross in-tx** column and Value Flow Map gross series). **`series.bankCreditsVolumeSeries`**, **`series.ibcAmountInSeries`**, and **`series.ibcAmountOutSeries`** feed the Value Flow Map and API rollups — each item is `{ denom, data: [{ bucket, value }] }`.

## Project layout

| Path | Purpose |
|------|--------|
| `docs/DEVELOPMENT.md` | Dev workflow, quality gate (`npm run verify`) |
| `docs/style-guide.md` | Visual design system (colors, type, spacing, components) for the UI |
| `scripts/indexer.ts` | Block scanner; bounded start date, catch-up vs tail; **IBC-in** amounts via **`sumRecvCoinAmountsDedupedFromTxEvents`** (per successful tx; deduped **`max`** of **`coin_received`** / **`transfer`** legs — see **`docs/ibcTransferAmountInEventInvestigation.md`**) |
| `scripts/scanIbcRecvDay.ts` | Debug: scan a UTC day for IBC recv denom totals (`npm run scan:ibc-recv-day`). Optional **`SCAN_HEIGHT_START`** + **`SCAN_HEIGHT_END_EXCLUSIVE`** skip time→height lookup; **`SCAN_CONCURRENCY`** limits parallelism; RPC calls **retry** on transient failures. |
| `scripts/inspectIbcRecvTxEventAmounts.ts` | Debug: one **`MsgRecvPacket`** tx — split **`coin_received`** vs **`transfer`** vs combined (`npm run inspect:ibc-recv-tx-events`); see **`docs/ibcTransferAmountInEventInvestigation.md`**. |
| `docs/ibcTransferAmountInEventInvestigation.md` | Notes on **`ibc_transfer_amount_in`** event sums and double-count semantics vs **`bank_credits_volume`**. |
| `scripts/validateUistIbcApril2026.sh` | Optional: sequential **`scanIbcRecvDay`** for fixed UTC days (example IST/`uist` validation vs **`ibc_transfer_amount_in`**); long-running. |
| `scripts/backfillIbcTransferFlowIn.ts` | Backfill **`ibc_transfer_flow_in`** for full indexed span without touching other metrics (see **`npm run backfill:ibc-flow-in`**); optional **`BACKFILL_SKIP_DELETE=1`** to resume without wiping prior rows |
| `scripts/backfillBankCreditsVolume.ts` | Backfill **`bank_credits_volume`** for full indexed span (event-derived value moved, module-account filtered) without touching other metrics (see **`npm run backfill:bank-credits`**); optional **`BACKFILL_SKIP_DELETE=1`** to resume without wiping prior rows |
| `scripts/reindexReset.ts` | **Destructive** full-reindex reset (**`npm run reindex:reset`**, gated by **`REINDEX_CONFIRM=YES`**): truncates all rollup tables (`daily_metrics`, `hourly_metrics`, `participant_day`, `address_volume_day`, `address_fee_day`, `offer_participant_day`) and clears the `indexer_state` cursor so the next indexer run replays from `INDEXER_START_DATE`. Use when an indexer change adds or redefines a series; stop the indexer first. See **`docs/DEVELOPMENT.md`** "Full reindex (Railway)". |
| `scripts/refreshAgoricNames.ts` | Regenerates **`src/config/agoricNames.json`**: Board id → agoricNames **instance** / **brand** labels for Zoe offers, plus **`vbankAssets`** (brand Board id → denom + decimals) for offer USD valuation. Re-run on a reindex; the read/UI path imports the JSON only (no `@endo` at runtime). |
| `scripts/refreshDenomChains.ts` | Disambiguates `denoms.json` labels by IBC **origin chain** (`SYMBOL (Origin)`); **`WRITE=1`** applies to `denoms.json` + `public/denom-translations.csv` (dry-run otherwise). See **`docs/DEVELOPMENT.md`** "Denom chain labels". |
| `src/lib/ibcRecvEventAmounts.ts` | **`sumRecvCoinAmountsDedupedFromTxEvents`** (indexer IBC-in, deduped `max` basis) + **`sumRecvCoinAmountsFromTxEvents`** (legacy combined-sum diagnostic) — parse `coin_received` / `transfer` amounts |
| `src/config/denoms.json` | `match` (full on-chain denom) → **chain-disambiguated** symbol (`SYMBOL (Origin)`), decimals (regenerate labels via `scripts/refreshDenomChains.ts`) |
| `src/config/agoricNames.json` | Generated Board id → agoricNames **instance** / **brand** labels + **`vbankAssets`** (brand → denom/decimals) for offers; produced by `scripts/refreshAgoricNames.ts` |
| `src/db/schema.ts` | `daily_metrics`, `hourly_metrics`, `indexer_state`, `participant_day`, `address_volume_day`, `address_fee_day`, **`offer_participant_day`** (day × owner × kind), … (Drizzle) |
| `src/lib/semantics.ts` | `CHAIN_ID`, `SERIES`, `FEE_DENOM_UBLB`, **`INDEXED_HISTORY_FROM_DAY`**, **`INDEXER_SCOPE_CAVEAT_*`**, **`METHODOLOGY_SECTIONS`**, `METHODOLOGY_BLURB` |
| `src/app/methodology/page.tsx` | **/methodology** page: indicator definitions (`DEFINITIONS`) + the full **`METHODOLOGY_SECTIONS`** text with anchors |
| `src/lib/metricsApiValidation.ts` | `GET /api/metrics` query validation (range caps, ISO dates); **`clampMetricsRangeToIndexedHistory`** |
| `src/lib/metricsQuery.ts` | `buildMetricsPayload`, KPIs, series for charts, comparison window |
| `src/lib/metricsEnrichment.ts` | `resolveDenom`-based **metas** for `display` |
| `src/lib/transferVolumeUsdEstimates.ts` | Day-priced USD (`denom_price_day`, spot fallback) × daily volume; **USD gross** + **USD credits** strings and **separate totals** for the Value handled denom table (`enrichTransferAndBankCreditsUsdEstimates`) |
| `src/lib/grossTableUsdSort.ts` | Row shape + client-side **USD gross (EST)** sort for the combined value-handled table (`GrossMovementRow` includes bank-credits display fields; sort uses **gross** USD only) |
| `src/lib/rechartsTooltip.ts` | **`filterNonZeroTooltipPayload`** for multi-series chart tooltips |
| `src/lib/ibcRollupDisplay.ts` | API/chart display: IBC recv flow vs legacy raw msg count |
| `src/lib/coingecko/` | `resolveCoinGeckoId`, batched **simple/price** fetch + TTL cache |
| `src/lib/chartTheme.ts` | Grid/tooltip/series stroke tokens + **`trendLineProps`** (dashed trend overlays) |
| `src/lib/linearTrend.ts` | **`linearTrendLine`** — OLS trend ordinates for chart overlays |
| `src/config/coingeckoDisplaySymbolToId.json` | `displaySymbol` → CoinGecko coin id (e.g. **`AXL (router)`** → `axelar`, **`SEI`** → `sei-network`, **`PICA`** → `pica`) |
| `src/config/coingeckoDenomOverrides.json` | Optional per-`match` CoinGecko id overrides |
| `src/lib/resolveDenom.ts` | Resolves a denom string using `denoms.json` |
| `src/app/api/metrics/route.ts` | JSON: `{ ...payload, display, transferVolumeUsd…, participation, concentration, offers, offerValueUsd, indexedHistoryFromDay }` (clamps **`from`** before `buildMetricsPayload`) |
| `src/app/page.tsx` | Shell header (logo, title, **`dashboardNavLinks`** jump nav) |
| `src/lib/dashboardNav.ts` | Section anchor ids — keep aligned with **`Dashboard.tsx`** `id`s |
| `src/lib/participationQueries.ts` | Postgres reads for participation range + address volume totals |
| `src/lib/enrichParticipationConcentration.ts` | **`enrichParticipationAndConcentration`** — participation + concentration for `/api/metrics` |
| `public/denom-translations.csv` | Reviewed export of denom ↔ (chain-disambiguated) symbol ↔ CoinGecko mapping with status notes; `displaySymbol` column also rewritten by `scripts/refreshDenomChains.ts` |
| `src/lib/agoricInstanceNames.ts` | Read-time Board id → instance / brand label + **`brandDenom`** / **`brandAssetMeta`** (vbank) lookups from `agoricNames.json` (no `@endo`) |
| `src/lib/walletOfferMarshal.ts` / `walletOfferSummary.ts` / `walletOfferTypes.ts` / `walletOfferRollup.ts` | Decode `MsgWalletSpendAction` / `MsgWalletAction` CapData (`@endo/marshal`) → structural offer summary → `(series, dimension)` rollup deltas |
| `src/lib/offerCategory.ts` | Functional `offer_category` classifier + automated/interactive grouping |
| `src/lib/walletOutcomeSummary.ts` | Decode vstorage `offerStatus` from `finalize_block_events` → terminal offer outcome + payout legs |
| `src/lib/offersMetrics.ts` / `offersQuery.ts` / `offersActivitySeries.ts` | Build the API **`offers`** payload (KPIs, breakdowns, outcomes, value), distinct-wallet query, and automated/interactive chart rows |
| `src/lib/offerValueUsd.ts` | Day-priced USD × offer give/want/payout daily amounts → per-denom + total USD (`enrichOfferValueUsd`) |
| `src/components/dashboard/charts/OffersActivityLineChart.tsx` | Smart-wallet offer activity by automation class |
| `src/components/Dashboard.tsx` | Page shell: date/granularity controls, metrics fetch, What-changed strip, the four question sections (`components/dashboard/questions/*`), methodology footer link |
| `src/components/dashboard/charts/DistinctAccountsLineChart.tsx` | Daily distinct account addresses (**UTC**), filled series |
| `src/lib/filledDistinctAccountsSeries.ts` | Dense calendar-day rows from sparse API **distinctUnionPerDay** |
| `src/components/MetricsErrorBoundary.tsx` | Catches render errors in the client dashboard |

## Tests

**Vitest** runs tests on pure modules (**58** test files, **278** tests at last `npm run verify`; no Postgres or Next server by default):

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
| `src/lib/denomsJson.contract.test.ts` | `denoms.json` shape, unique `match`, sorted entries, **chain-disambiguation** invariant (multi-source ibc symbols carry a `(Origin)` tag) |
| `src/lib/concentrationMath.test.ts` | Herfindahl-style helpers, **top-N share** (used for gross USD concentration) |
| `src/lib/transferVolumeAttribution.test.ts` | Sender-side legs for **MsgSend** / **MultiSend** / **ICS-20** (indexer + enrichment) |
| `src/lib/dashboardNav.test.ts` | Header **`dashboardNavLinks`** (omits **`filters`** toolbar); every href targets **`dashboardSectionIds`** |
| `src/lib/filledDistinctAccountsSeries.test.ts` | Dense daily series for distinct-account **time-series** chart |
| `src/lib/ibcRecvEventAmounts.test.ts` | **`sumRecvCoinAmountsDedupedFromTxEvents`** (deduped `max` basis), **`sumRecvCoinAmountsFromTxEvents`**, **`diagnoseRecvCoinAmountsByEventType`** (`coin_received` / `transfer` parsing + diagnostics) |
| `src/lib/valueFlowMapSeries.test.ts` | **`buildValueFlowMiniRows`** bucket alignment and transfer-like derivation |
| `src/lib/semantics.contract.test.ts` | **`TX_RESULT_ROLLUP_POLICY`** vs metric dictionary; **`INDEXER_SCOPE_CAVEAT_*`** shape; **`METHODOLOGY_SECTIONS`** / **`METHODOLOGY_BLURB`** document Value handled + Value Flow Map UI |
| `src/lib/walletOfferSummary.test.ts` / `walletOfferRollup.test.ts` | Decode CapData → offer summary; summary → `(series, dimension)` rollup deltas |
| `src/lib/offerCategory.test.ts` | Functional `offer_category` classification + automated/interactive grouping |
| `src/lib/walletOutcomeSummary.test.ts` | vstorage `offerStatus` decode, terminal-outcome counting, payout-leg extraction |
| `src/lib/agoricInstanceNames.test.ts` | Board id → instance/brand label + **`brandDenom`** / **`brandAssetMeta`** (vbank) lookups |
| `src/lib/offersMetrics.test.ts` / `offersActivitySeries.test.ts` | **`offers`** payload (KPIs, outcomes, value) + automated/interactive chart rows |
| `src/lib/offerValueUsd.test.ts` | **`enrichOfferValueUsd`** — per-denom + total offer USD, null/partial-spot handling (mocked spot) |

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
| `npm run reindex:reset` | `scripts/reindexReset.ts` — **destructive** full-reindex reset (gated by `REINDEX_CONFIRM=YES`); truncates rollup tables incl. `offer_participant_day` and clears the cursor |
| `npx tsx scripts/refreshAgoricNames.ts` | Regenerate `src/config/agoricNames.json` (offer instance/brand labels + vbank brand→denom map) |
| `npx tsx scripts/refreshDenomChains.ts` | Chain-disambiguate `denoms.json` labels (`WRITE=1` to apply; dry-run otherwise) |
| `npm run db:push` | Apply Drizzle schema to Postgres |
| `npm run db:generate` | Generate SQL migrations (optional) |
| `npm test` | Run Vitest once (`vitest run`) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build` | Production build |
| `npm start` | Start production server |
