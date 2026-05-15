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
- **Indexer** (`npm run indexer`, `scripts/indexer.ts`) — Runs outside Next.js; fills Postgres rollup tables. **`ibc_transfer_amount_in`** uses **`sumRecvCoinAmountsFromTxEvents`** (`src/lib/ibcRecvEventAmounts.ts`): sums **`coin_received`** and **`transfer`** **`amount`** attributes scoped to **`MsgRecvPacket`** **`msg_index`** when present (legacy tx-wide sum when msg_index filtering yields no amounts). Typical SDK paths emit **both** event types for the same settlement, so the combined rollup is a **gross index** — see **`docs/ibcTransferAmountInEventInvestigation.md`** and **`npm run inspect:ibc-recv-tx-events`**. **`IBC_TRANSFER_IN_COUNT`** still increments once per recv **message**. **`ibc_transfer_flow_in`** logic lives in **`src/lib/ibcTransferFlowInRollup.ts`** (shared with the backfill script). Debug aids: **`npm run scan:ibc-recv-day`** (`scripts/scanIbcRecvDay.ts`) — retries transient RPC failures; optional **`SCAN_HEIGHT_START`** + **`SCAN_HEIGHT_END_EXCLUSIVE`** (decimal heights) skip automatic time→height binary search when validating against known bounds; **`SCAN_CONCURRENCY`** caps parallel block fetches. For multi-day reconciliation scripts, see **`scripts/validateUistIbcApril2026.sh`** / **`npm run validate:uist-apr2026`** (long-running).
- **Dashboard scope copy** — **`INDEXER_SCOPE_CAVEAT_INLINE`** / **`INDEXER_SCOPE_CAVEAT_SUBTITLE`** in **`src/lib/semantics.ts`** are rendered next to **Value handled**, **Gas and fees**, and **Economic participation** (`src/components/Dashboard.tsx`) so viewers do not treat fees or gross movement as full-chain economic totals; full wording remains **`METHODOLOGY_BLURB`** in the same file (footer **Methodology & caveats**).
- **Value handled denom tooltip** — `Dashboard.tsx` uses **`createPortal`** (`react-dom`) to render the full on-chain denom in a **fixed** tooltip under the **View Denom** control so it is not clipped by the table’s horizontal scroll wrapper; pointer enter/leave plus a short hide delay allow moving onto the panel; **`from` / `to` / `granularity`** changes clear tooltip state alongside resetting **USD gross** sort to default.
- **Local `.env` vs `.env.example`** — Copy **`.env.example`** to **`.env`** for local runs. Set **`RPC_URL`** and **`RPC_URL_FALLBACK`** (see example) so the indexer, backfills, and **`npm run inspect:ibc-recv-tx-events`** use **`rpcCallWithFallback`** (`src/lib/rpc.ts`). If **`RPC_URL_FALLBACK`** is unset or empty, those scripts log `fallback=<none>` and have no secondary endpoint.
- **Backfill `ibc_transfer_flow_in`** — After deploying recv-flow semantics, run **`npm run backfill:ibc-flow-in`** (`scripts/backfillIbcTransferFlowIn.ts`) once: it **deletes** all **`ibc_transfer_flow_in`** rows from **`daily_metrics`** and **`hourly_metrics`**, then replays blocks from **`INDEXER_START_DATE`** (or **`BACKFILL_FROM_HEIGHT`**) through **`indexer_state.last_indexed_height`** (or **`BACKFILL_TO_HEIGHT`**), persisting **only** that series. Does **not** advance or reset **`indexer_state`**; stop the live indexer or accept concurrent writes only if you know heights do not overlap.
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

## `denoms.json` maintenance

Human labels and decimals for chart/table display come from **`src/config/denoms.json`**. When users see raw `ibc/…` strings in the UI:

1. Query mainnet **`GET …/cosmos/bank/v1beta1/denoms_metadata`** (paginate if needed).
2. For each metadata **`base`** not already in `entries[].match`, add `{ match, displaySymbol, decimals }` (decimals from denom units or asset conventions; verify if amounts look wrong).
3. Keep **`entries` sorted alphabetically by `match`** — `src/lib/denomsJson.contract.test.ts` enforces this.

For **USD (EST)** cells in the value-handled denom table, add or adjust mappings in **`src/config/coingeckoDisplaySymbolToId.json`** (and **`coingeckoDenomOverrides.json`** when a specific `match` must differ). IDs must match CoinGecko’s **`/simple/price`** `ids` parameter.

### Value-handled denom table (`Dashboard.tsx`)

Implemented as a semantic **`<table>`** with **`colgroup`** column widths **9% / 15% / 15% / 15% / 15% / 11%** (Ticker / Gross in-tx / Bank credits / USD gross (EST) / USD credits (EST) / Denom), **`table-fixed`**, and **`min-w-0` / `overflow-x-auto`** on wrappers so the grid stays within the viewport. **Gross in-tx** and **Bank credits** native columns sit side-by-side; they are **not summed** (overlapping bases). **Ticker**, amount columns, and **USD** columns use **`whitespace-nowrap`** with **in-cell horizontal scroll** when content exceeds the column. The **Denom** column shows a **View Denom** control; the full on-chain denom appears in a **fixed-position tooltip** (**React** **`createPortal`** to **`document.body`**) on **pointer hover or keyboard focus** so it is not clipped by the table scroll wrapper. **Zebra** striping uses **`--color-bg-primary`** vs **`--color-border`** on alternating body rows (see `docs/style-guide.md`).

The **USD gross (EST)** header is a **sort control**: cycles **default row order** (ticker A→Z, then denom) → **descending** gross USD estimate → **ascending** → default. Sorting is **client-side** over the already-fetched payload; it parses formatted currency strings via **`parseUsdEstimateSortKey`** in **`src/lib/grossTableUsdSort.ts`** using the **gross** USD column only. Rows without a gross USD estimate sort **after** priced rows when sorting by USD. Changing **From**, **To**, or **Granularity** resets sort to default (same fetch lifecycle as metrics reload).

Recharts line charts for value handled can show **many** series; the **Gross in-tx movement (per asset)** chart adds **checkboxes** so users can hide lines. Performance is usually fine for typical on-chain denom counts, but very wide ranges may produce busy legends.

**Transaction activity & participation charts** (**Successful txs vs IBC**, **IBC traffic**, **distinct accounts**) overlay **dashed linear trends** (`linearTrendLine` in **`src/lib/linearTrend.ts`**, styling **`chartTheme.trendLineProps`**) — OLS vs bucket index for each numeric series; legend suffix **`(trend)`**. Headline tx series uses **`tx_success` only**. IBC recv display prefers **`ibc_transfer_flow_in`** (distinct **recv_packet** events per indexed tx when present); see **`src/lib/ibcRollupDisplay.ts`** and **`countUniqueRecvFlowsFromTxEvents`** in **`src/lib/ibcRecvEventAmounts.ts`**.
