# agoric-dash

Dashboard for monitoring on-chain activity on **Agoric L1** (`agoric-3`). Metrics are indexed from CometBFT **`block`** / **`block_results`**, rolled up in PostgreSQL (**`daily_metrics`** and **`hourly_metrics`**, per series/denom), and served by **Next.js** API routes. The UI is **Recharts** with a **~60s auto-refresh** and filters for **date range** and **granularity** (UTC hour, day, or week).

## What the dashboard shows

| Area | Content |
|------|--------|
| **KPIs** | Successful txs, **largest in-tx transfer** (by denom/amount in range; see definitions), **gas (ABCI units)**, **paid fees in uBLD → BLD** (KPI; other denoms in table), IBC out / recv **message** counts, period-over-period on prior window. |
| **In-tx transfer volume (per asset)** | Line chart for the **two** denoms with the largest in-range `transfer_volume` (bank + outbound IBC amounts). May use a **left + right** axis if two different assets. |
| **IBC amount flows** | IBC in vs out **amounts** (recv/event vs `MsgTransfer`) on a **shared** Y-axis. |
| **All transactions vs IBC message volume** | Inclusions: **all txs** (success+failed) vs IBC out+ recv **message counts** per bucket; **one** Y-axis. |
| **IBC traffic** | IBC out vs received **message counts** per bucket; one axis. |
| **Composition** | “First message only” bar chart (`MESSAGE_ATTRIBUTION` in `src/lib/semantics.ts`). |
| **Fee paid by denom** | Range-total uBLD, etc. — **primary units only, no USD** in this list. |
| **Transfer / transfer volume by denom** | **Optional** USD (CoinGecko) when `coingeckoId` is set for that token in the denom table. |

A **Methodology** panel in the app mirrors the definitions below. Source of truth for metric semantics is `src/lib/semantics.ts` and `METHODOLOGY_BLURB`.

## Definitions (v1)

- **Successful txs**: ABCI result code `0` (KPI; “all txs” in charts includes **failed** inclusions as well).
- **Gas**: **ABCI / consensus gas units** — not a token and not the same as paid fees. Do not conflate with BLD or IBC.
- **Paid fees**: Parsed from **tx result events** (e.g. `tx` / `fee` attributes) — the amount actually **paid in execution**, not the signed “max fee” cap only. The primary fee KPI and chart copy focus on **uBLD → BLD**; other fee denoms are listed in **Fee paid by denom**.
- **In-tx “value” / transfer volume**: **Multi-asset**. Native and **IBC** denoms (including long `ibc/HASH` strings) are different lines. **uBLD fee totals are not a summary of all economic value** — in-tx movement is per denom. Optional **spot USD** in some tooltips/lists comes from **CoinGecko** for rough comparison only, **not** for the fee list and not as a “mark to market” guarantee.
- **Largest in-tx transfer**: The denom with the **largest** range-aggregated `transfer_volume` in that window (from indexed transfer surface). Not the same as “largest IBC in only” unless you change the product definition.
- **Nature / composition**: **First message** type URL in the transaction body, per the constant in `semantics.ts`.
- **Transfer / transfer volume (indexed)**: Native minimal units from decoded **`MsgSend`**, **`MsgMultiSend`**, and **`MsgTransfer`**, plus IBC recv indexing where the indexer records amounts — **smart-contract-internal flows** may be missing from this view.
- **IBC** direction is **Agoric-relative** (e.g. out = `MsgTransfer` from this chain; in = recv packet handling as indexed).
- **Period comparison**: A **previous window of equal length** immediately before the selected `from` (documented in the date/granularity UI).

## Denoms, symbols, and IBC hashes

- Display names, decimal scaling for human amounts, and optional **CoinGecko** ids for **non-fee** USD hints are in **`src/config/denoms.json`**. The indexer and API work in **on-chain minimal denoms**; the file maps **full** strings (e.g. `ubld`, and full `ibc/...` **hash** denoms) to `displaySymbol`, `decimals`, and optional `coingeckoId`.
- A long `ibc/FE98…` style value is a **canon IBC token id** (hash of path + base denom) — the dashboard shows the raw id until you add a matching `entries` row. See the **note** at the top of `denoms.json` for how rows were chosen (mainnet traces). **Multiple** `ibc/...` values can still represent the **same** logical asset via **different IBC paths**; each path needs its own `match` row if you want a label.
- If `coingeckoId` is **omitted**, the app still shows symbol/decimals; optional USD is skipped for that denom.

**Optional: CoinGecko**

- `COINGECKO_API_KEY` (Pro) in `.env` improves rate limits; public `simple/price` works without a key. Pricing is only used for **enrichment of transfer/IBC-related** denoms, **not** to convert **fee** rows in the “Fee paid by denom” block.

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

## Run indexer (separate terminal)

Polls `RPC_URL` (default `https://main.rpc.agoric.net`), backfills `--INDEXER_INITIAL_WINDOW` blocks from chain head on first run, then tails new blocks. Fills both **daily** and **UTC hourly** rollups for chart granularity.

```bash
npm run indexer
```

All indexer-related env vars are in **`.env.example`**.

## Run web app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use **From / To**, **Granularity**, and **Refresh** as needed; the dashboard re-fetches metrics on an interval (about **60 seconds**).

### Production

```bash
npm run build
npm start
```

## API

- `GET /api/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|hour|week`  
  Returns rollup payload from `buildMetricsPayload` plus a **`display`** object from `enrichMetricsForDisplay` (metas, optional USD map). Used by the dashboard client; shape is defined in `src/lib/metricsQuery.ts` and `src/lib/metricsDisplayTypes.ts`.

## Project layout

| Path | Purpose |
|------|--------|
| `scripts/indexer.ts` | Block scanner; upserts `daily_metrics` + `hourly_metrics`, `indexer_state` |
| `src/config/denoms.json` | `match` (full on-chain denom) → symbol, decimals, optional CoinGecko id |
| `src/db/schema.ts` | `daily_metrics`, `hourly_metrics`, `indexer_state` (Drizzle) |
| `src/lib/semantics.ts` | `CHAIN_ID`, series names, `FEE_DENOM_UBLB`, `METHODOLOGY_BLURB` |
| `src/lib/metricsQuery.ts` | `buildMetricsPayload`, KPIs, series for charts, comparison window |
| `src/lib/metricsEnrichment.ts` | CoinGecko + `resolveDenom` for `display` |
| `src/lib/resolveDenom.ts` | Resolves a denom string using `denoms.json` |
| `src/lib/coinGecko.ts` | Fetches simple USD by CoinGecko id (optional Pro key) |
| `src/app/api/metrics/route.ts` | JSON: `{ ...payload, display }` |
| `src/components/Dashboard.tsx` | Date/granularity controls, charts, tables |

## Tests

**Vitest** runs functional tests on pure modules (no Postgres or Next server): amount formatting, denom resolution from `denoms.json`, and display/list helpers. Test files: `src/**/*.test.ts`.

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
