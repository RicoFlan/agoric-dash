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
