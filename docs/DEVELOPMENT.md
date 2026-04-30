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
3. **Client fetch / loading** — The dashboard uses a single in-flight controller, generation guards for `loading`, and a 2-minute fetch timeout. Silent refresh is skipped while a visible load is in progress so the UI does not get stuck on “Loading metrics…”.

## Runtime boundaries

- **API routes** `src/app/api/metrics` and `src/app/api/status` export `dynamic = 'force-dynamic'` so Next never tries to static-cache dynamic DB-backed JSON.
- **`GET /api/metrics`** — Validates `from` / `to` (ISO day, order) and caps range size (`src/lib/metricsApiValidation.ts`): up to **366** days for `day` / `week`, **62** days for `hour` (limits DB work). In **production**, 500 JSON omits internal error details (see route handler); errors are still logged server-side.
- **MetricsErrorBoundary** wraps the dashboard in `src/app/page.tsx` so a Recharts or render error shows a recovery UI instead of a blank page.
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

Recharts line charts for value handled can show **many** series; performance is usually fine for typical on-chain denom counts, but very wide ranges may produce busy legends.
