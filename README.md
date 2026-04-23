# agoric-dash

Dashboard for monitoring on-chain activity on **Agoric L1** (`agoric-3`). Metrics are indexed from CometBFT **`block`** / **`block_results`**, aggregated into PostgreSQL daily rollups, and served by **Next.js** API routes. Charts use **Recharts**.

## Definitions (v1)

- **Successful txs**: ABCI result code `0`.
- **Paid fees**: Parsed from tx result events (`tx` → `fee`), not the signed fee cap alone.
- **Nature / composition**: **First message** type URL per transaction.
- **Transfer volume**: Native units from `MsgSend`, `MsgMultiSend`, `MsgTransfer` decoding.
- **Values**: Native minimal units per denom — no fiat.

See `src/lib/semantics.ts` and the in-app methodology panel.

## Prerequisites

- Node 20+
- PostgreSQL 16+ (Docker Compose file included)

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL if needed

docker compose up -d

npm install
npm run db:push
```

## Run indexer (separate terminal)

Polls `RPC_URL` (default `https://main.rpc.agoric.net`), backfills `--INDEXER_INITIAL_WINDOW` blocks from chain head on first run, then tails new blocks.

```bash
npm run indexer
```

Environment variables: see `.env.example`.

## Run web app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production

```bash
npm run build
npm start
```

## Project layout

| Path | Purpose |
|------|---------|
| `scripts/indexer.ts` | Block scanner + rollup upserts |
| `src/db/schema.ts` | Drizzle schema (`daily_metrics`, `indexer_state`) |
| `src/lib/metricsQuery.ts` | Read API rollup logic + period comparisons |
| `src/app/api/metrics/route.ts` | JSON metrics API |
| `src/components/Dashboard.tsx` | Filters, KPI cards, Recharts |

## Scripts

| Script | Description |
|--------|----------------|
| `npm run dev` | Next.js dev server |
| `npm run indexer` | Indexer worker (`tsx scripts/indexer.ts`) |
| `npm run db:push` | Push Drizzle schema to Postgres |
| `npm run db:generate` | Generate SQL migrations (optional) |
