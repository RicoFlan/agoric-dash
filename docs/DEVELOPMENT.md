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
- **`GET /api/metrics`** — Validates `from` / `to` (ISO day, order) and caps range size (`src/lib/metricsApiValidation.ts`): up to **366** days for `day` / `week`, **62** days for `hour` (limits DB work). Then **`clampMetricsRangeToIndexedHistory`** lifts **`from`** to **`INDEXED_HISTORY_FROM_DAY`** (`2026-01-01`, `src/lib/semantics.ts`) when needed so all series match the indexer’s configured start (same intent as default **`INDEXER_START_DATE`** in `.env.example`). Response JSON includes **`indexedHistoryFromDay`** and a **`range`** object reflecting the **effective** (post-clamp) window. After DB metrics are built, the route enriches **USD spot estimates** (`src/lib/transferVolumeUsdEstimates.ts`), **`enrichParticipationAndConcentration`** (when `participant_day` / `address_volume_day` exist; `src/lib/participationQueries.ts`), then merges **`display`**. CoinGecko: batched **`/simple/price`**, TTL cache (`src/lib/coingecko/simplePrice.ts`); optional **`COINGECKO_API_KEY`** (Demo plan) sets `x-cg-demo-api-key`. In **production**, 500 JSON omits internal error details; errors are still logged server-side.
- **Indexer** (`npm run indexer`, `scripts/indexer.ts`) — Runs outside Next.js; fills Postgres rollup tables. **`ibc_transfer_amount_in`** uses **`sumRecvCoinAmountsFromTxEvents`** (`src/lib/ibcRecvEventAmounts.ts`) so **`coin_received`** / **`transfer`** amounts are summed **once per successful tx** when any **`MsgRecvPacket`** is present—avoiding inflated gross totals when multiple recv messages share one tx’s events. **`IBC_TRANSFER_IN_COUNT`** still increments once per recv message. Debug aid: **`npm run scan:ibc-recv-day`** (`scripts/scanIbcRecvDay.ts`).
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

For **USD (EST)** cells in the gross in-tx movement table, add or adjust mappings in **`src/config/coingeckoDisplaySymbolToId.json`** (and **`coingeckoDenomOverrides.json`** when a specific `match` must differ). IDs must match CoinGecko’s **`/simple/price`** `ids` parameter.

### Gross in-tx movement table (`Dashboard.tsx`)

Implemented as a semantic **`<table>`** with **`colgroup`** column widths **10% / 20% / 20% / 50%** (Ticker / Gross / USD (EST) / Denom), **`table-fixed`**, and **`min-w-0` / `overflow-x-auto`** on wrappers so the grid stays within the viewport. **Ticker**, **Gross**, **USD**, and **Denom** use **`whitespace-nowrap`** with **in-cell horizontal scroll** when content exceeds the column—no multi-line ticker wrapping. **Zebra** striping uses **`--color-bg-primary`** vs **`--color-border`** on alternating body rows (see `docs/style-guide.md`).

The **USD (EST)** header is a **sort control**: cycles **default row order** (ticker A→Z, then denom) → **descending** USD estimate → **ascending** → default. Sorting is **client-side** over the already-fetched payload; it parses formatted currency strings via **`parseUsdEstimateSortKey`** in **`src/lib/grossTableUsdSort.ts`**. Rows without a USD estimate sort **after** priced rows. Changing **From**, **To**, or **Granularity** resets sort to default (same fetch lifecycle as metrics reload).

Recharts line charts for value handled can show **many** series; the **Gross in-tx movement (per asset)** chart adds **checkboxes** so users can hide lines. Performance is usually fine for typical on-chain denom counts, but very wide ranges may produce busy legends.
