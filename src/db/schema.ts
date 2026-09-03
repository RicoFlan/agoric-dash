import {
  date,
  pgTable,
  primaryKey,
  varchar,
  bigint,
  timestamp,
  numeric,
} from "drizzle-orm/pg-core";

/** Singleton indexer cursor */
export const indexerState = pgTable("indexer_state", {
  id: varchar("id", { length: 32 }).primaryKey().default("singleton"),
  lastIndexedHeight: bigint("last_indexed_height", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Daily rolled-up counters / sums. dimension empty string = series total without breakdown.
 * value stored as numeric string for bigint-safe coin amounts.
 */
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    day: date("day", { mode: "string" }).notNull(),
    series: varchar("series", { length: 64 }).notNull(),
    dimension: varchar("dimension", { length: 512 }).notNull().default(""),
    value: numeric("value", { precision: 78, scale: 0 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.series, t.dimension] })]
);

/**
 * UTC hour start (e.g. from block time), same series/dimensions as daily_metrics.
 * Used for hour-granularity charts; populated alongside daily by the indexer.
 */
export const hourlyMetrics = pgTable(
  "hourly_metrics",
  {
    hour: timestamp("hour", { withTimezone: true, mode: "date" }).notNull(),
    series: varchar("series", { length: 64 }).notNull(),
    dimension: varchar("dimension", { length: 512 }).notNull().default(""),
    value: numeric("value", { precision: 78, scale: 0 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.hour, t.series, t.dimension] })]
);

/** Successful txs: distinct signer / fee-payer appearances per UTC calendar day (not double-counted per role). */
export const participantDay = pgTable(
  "participant_day",
  {
    day: date("day", { mode: "string" }).notNull(),
    address: varchar("address", { length: 128 }).notNull(),
    role: varchar("role", { length: 16 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.address, t.role] })]
);

/** Transfer-like gross legs attributed to one address per MsgSend / MultiSend input / ICS-20 sender (successful txs). */
export const addressVolumeDay = pgTable(
  "address_volume_day",
  {
    day: date("day", { mode: "string" }).notNull(),
    address: varchar("address", { length: 128 }).notNull(),
    denom: varchar("denom", { length: 512 }).notNull(),
    volume: numeric("volume", { precision: 78, scale: 0 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.address, t.denom] })]
);

/**
 * Distinct smart-wallet owners that submitted a wallet action (offer / invocation) per UTC day,
 * split by action kind. Backs "distinct offer-submitting wallets" — the key anti-overcounting
 * signal for SwingSet/Zoe activity, where a few bot wallets dominate raw counts. Owner is the
 * bech32 of MsgWalletSpendAction/MsgWalletAction `owner` (successful txs only).
 */
export const offerParticipantDay = pgTable(
  "offer_participant_day",
  {
    day: date("day", { mode: "string" }).notNull(),
    address: varchar("address", { length: 128 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.address, t.kind] })]
);

/** Paid fees attributed to fee payer (granter or first signer) per denom per day. */
export const addressFeeDay = pgTable(
  "address_fee_day",
  {
    day: date("day", { mode: "string" }).notNull(),
    address: varchar("address", { length: 128 }).notNull(),
    denom: varchar("denom", { length: 512 }).notNull(),
    fee: numeric("fee", { precision: 78, scale: 0 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.address, t.denom] })]
);

/**
 * CoinGecko daily USD price per coin id: the first `/coins/{id}/market_chart` data point on each UTC
 * day (≈ 00:00 UTC). Backfilled by `scripts/backfillDenomPrices.ts` and refreshed by the indexer
 * (`refreshDailyPrices`); the read path prices each day's native amount at that day's row and falls
 * back to spot only for days with no row (`src/lib/denomPrices.ts`). Created idempotently with
 * `CREATE TABLE IF NOT EXISTS` (`ensureDenomPriceDayTable`) — additive, never part of reindex:reset.
 */
export const denomPriceDay = pgTable(
  "denom_price_day",
  {
    day: date("day", { mode: "string" }).notNull(),
    coingeckoId: varchar("coingecko_id", { length: 128 }).notNull(),
    usd: numeric("usd", { precision: 30, scale: 12 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.coingeckoId] })]
);

/**
 * Distinct smart-wallet owners per UTC day per functional `offer_category` (offerCategory.ts). Backs
 * "distinct interactive wallets" for Q2 (organic activity): `offer_participant_day` keys on action
 * kind, not category, so it cannot tell a vault user from an oracle bot. Written by the indexer
 * alongside `offer_participant_day`; created idempotently (`ensureOfferCategoryParticipantDayTable`);
 * backfilled by `scripts/backfillOfferCategories.ts`. Successful txs only.
 */
export const offerCategoryParticipantDay = pgTable(
  "offer_category_participant_day",
  {
    day: date("day", { mode: "string" }).notNull(),
    address: varchar("address", { length: 128 }).notNull(),
    category: varchar("category", { length: 24 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.address, t.category] })]
);

/**
 * YMax (published.ymax0/ymax1) — latest-state tables fed from vstorage state_change events
 * (src/lib/ymaxVstorage.ts) and seeded by scripts/seedYmaxSnapshot.ts. Positions carry cumulative
 * totals, so the newest record per (contract, portfolio, key) is the truth and
 * Σ(total_in − total_out) is principal currently deployed (not marked to yield). Created idempotently
 * (ensureAdditiveTables.ts); never part of reindex:reset.
 */
export const ymaxPortfolio = pgTable(
  "ymax_portfolio",
  {
    contract: varchar("contract", { length: 16 }).notNull(),
    portfolio: varchar("portfolio", { length: 32 }).notNull(),
    depositAddress: varchar("deposit_address", { length: 128 }),
    agoricAccount: varchar("agoric_account", { length: 128 }),
    /** JSON: chain label → CAIP account id. */
    accountsJson: varchar("accounts_json", { length: 4096 }).notNull().default("{}"),
    policyVersion: bigint("policy_version", { mode: "number" }),
    flowCount: bigint("flow_count", { mode: "number" }),
    updatedHeight: bigint("updated_height", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.contract, t.portfolio] })]
);

export const ymaxPosition = pgTable(
  "ymax_position",
  {
    contract: varchar("contract", { length: 16 }).notNull(),
    portfolio: varchar("portfolio", { length: 32 }).notNull(),
    positionKey: varchar("position_key", { length: 64 }).notNull(),
    protocol: varchar("protocol", { length: 64 }),
    chain: varchar("chain", { length: 64 }),
    accountId: varchar("account_id", { length: 160 }),
    /** vbank denom resolved from the brand Board id at write time (null when unmapped). */
    denom: varchar("denom", { length: 512 }),
    totalIn: numeric("total_in", { precision: 78, scale: 0 }).notNull(),
    totalOut: numeric("total_out", { precision: 78, scale: 0 }).notNull(),
    netTransfers: numeric("net_transfers", { precision: 78, scale: 0 }).notNull(),
    updatedHeight: bigint("updated_height", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.contract, t.portfolio, t.positionKey] })]
);

/** One row per flow (deposit / withdraw / rebalance …), first seen on the portfolio status's flowsRunning; deduped by id. */
export const ymaxFlow = pgTable(
  "ymax_flow",
  {
    contract: varchar("contract", { length: 16 }).notNull(),
    portfolio: varchar("portfolio", { length: 32 }).notNull(),
    flowId: varchar("flow_id", { length: 32 }).notNull(),
    flowType: varchar("flow_type", { length: 32 }).notNull(),
    denom: varchar("denom", { length: 512 }),
    amount: numeric("amount", { precision: 78, scale: 0 }),
    /** UTC day of the block where the flow was first seen. */
    day: date("day", { mode: "string" }).notNull(),
    firstHeight: bigint("first_height", { mode: "bigint" }).notNull(),
    lastState: varchar("last_state", { length: 32 }),
    lastHeight: bigint("last_height", { mode: "bigint" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.contract, t.portfolio, t.flowId] })]
);

/** Last committed height per additive backfill job (see ensureAdditiveTables.ts); resume must start above it. */
export const backfillCheckpoint = pgTable("backfill_checkpoint", {
  job: varchar("job", { length: 64 }).primaryKey(),
  lastHeight: bigint("last_height", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
