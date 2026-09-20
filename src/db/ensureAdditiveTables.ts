/**
 * Idempotent CREATE TABLE IF NOT EXISTS for tables added after the original `db:push` baseline.
 * `drizzle/meta` is gitignored and production was created with push, so there is no migration
 * journal; additive tables are created on process start instead (see docs/DEVELOPMENT.md). Keep each
 * statement in sync with `schema.ts`. Never referenced by `scripts/reindexReset.ts`.
 */
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";
import { ensureDenomPriceDayTable } from "@/lib/coingecko/priceStore";

type Db = NodePgDatabase<typeof schema>;

export const OFFER_CATEGORY_PARTICIPANT_DAY_CREATE_SQL = `CREATE TABLE IF NOT EXISTS offer_category_participant_day (
  day date NOT NULL,
  address varchar(128) NOT NULL,
  category varchar(24) NOT NULL,
  PRIMARY KEY (day, address, category)
)`;

export async function ensureOfferCategoryParticipantDayTable(db: Db): Promise<void> {
  await db.execute(sql.raw(OFFER_CATEGORY_PARTICIPANT_DAY_CREATE_SQL));
}

export const YMAX_TABLES_CREATE_SQL = [
  `CREATE TABLE IF NOT EXISTS ymax_portfolio (
  contract varchar(16) NOT NULL,
  portfolio varchar(32) NOT NULL,
  deposit_address varchar(128),
  agoric_account varchar(128),
  accounts_json varchar(4096) NOT NULL DEFAULT '{}',
  policy_version bigint,
  flow_count bigint,
  updated_height bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract, portfolio)
)`,
  `CREATE TABLE IF NOT EXISTS ymax_position (
  contract varchar(16) NOT NULL,
  portfolio varchar(32) NOT NULL,
  position_key varchar(64) NOT NULL,
  protocol varchar(64),
  chain varchar(64),
  account_id varchar(160),
  denom varchar(512),
  total_in numeric(78, 0) NOT NULL,
  total_out numeric(78, 0) NOT NULL,
  net_transfers numeric(78, 0) NOT NULL,
  updated_height bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract, portfolio, position_key)
)`,
  `CREATE TABLE IF NOT EXISTS ymax_flow (
  contract varchar(16) NOT NULL,
  portfolio varchar(32) NOT NULL,
  flow_id varchar(32) NOT NULL,
  flow_type varchar(32) NOT NULL,
  denom varchar(512),
  amount numeric(78, 0),
  day date NOT NULL,
  first_height bigint NOT NULL,
  last_state varchar(32),
  last_height bigint NOT NULL,
  PRIMARY KEY (contract, portfolio, flow_id)
)`,
];

export async function ensureYmaxTables(db: Db): Promise<void> {
  for (const stmt of YMAX_TABLES_CREATE_SQL) await db.execute(sql.raw(stmt));
}

/**
 * Checkpoints for additive backfills: the last height whose batch was committed, per job. A resume
 * (BACKFILL_SKIP_DELETE=1) must start strictly above it, which makes re-running a partially
 * completed range unable to double-count additive series.
 */
export const BACKFILL_CHECKPOINT_CREATE_SQL = `CREATE TABLE IF NOT EXISTS backfill_checkpoint (
  job varchar(64) PRIMARY KEY,
  last_height bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
)`;

export async function ensureBackfillCheckpointTable(db: Db): Promise<void> {
  await db.execute(sql.raw(BACKFILL_CHECKPOINT_CREATE_SQL));
}

/**
 * Every table that is created lazily rather than by the original `db:push` baseline.
 *
 * Single source of truth so the deploy-time check and the runtime call sites cannot drift apart.
 * `denom_price_day` belongs here even though its statement lives with the price store: it is
 * declared in `schema.ts`, so a schema check will look for it, but nothing creates it until the
 * price refresh loop first runs. Before this list existed, a fresh deployment failed its schema
 * check on that table before the indexer had a chance to create it.
 */
export const PROVISION_POOL_DAY_CREATE_SQL = `CREATE TABLE IF NOT EXISTS provision_pool_day (
  day date NOT NULL,
  wallets_provisioned bigint NOT NULL,
  total_minted_provided numeric(78,0) NOT NULL,
  total_minted_converted numeric(78,0),
  brand_board_id varchar(64),
  updated_height bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day)
)`;

export async function ensureProvisionPoolDayTable(db: Db): Promise<void> {
  await db.execute(sql.raw(PROVISION_POOL_DAY_CREATE_SQL));
}

export const BUNDLE_INSTALL_CREATE_SQL = `CREATE TABLE IF NOT EXISTS bundle_install (
  tx_hash varchar(64) NOT NULL,
  height bigint NOT NULL,
  day date NOT NULL,
  installer varchar(128),
  gas_fee_ubld numeric(78,0) NOT NULL,
  storage_fee_ubld numeric(78,0) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tx_hash)
)`;

/** Day lookups scan this constantly and the table has no natural day index from its PK. */
export const BUNDLE_INSTALL_DAY_INDEX_SQL =
  `CREATE INDEX IF NOT EXISTS bundle_install_day_idx ON bundle_install (day)`;

export async function ensureBundleInstallTable(db: Db): Promise<void> {
  await db.execute(sql.raw(BUNDLE_INSTALL_CREATE_SQL));
  await db.execute(sql.raw(BUNDLE_INSTALL_DAY_INDEX_SQL));
}

export const ADDITIVE_TABLE_NAMES = [
  "offer_category_participant_day",
  "ymax_portfolio",
  "ymax_position",
  "ymax_flow",
  "backfill_checkpoint",
  "denom_price_day",
  "provision_pool_day",
  "bundle_install",
] as const;

/** Create every additive table if missing. Idempotent: each statement is CREATE TABLE IF NOT EXISTS. */
export async function ensureAllAdditiveTables(db: Db): Promise<void> {
  await ensureOfferCategoryParticipantDayTable(db);
  await ensureYmaxTables(db);
  await ensureProvisionPoolDayTable(db);
  await ensureBackfillCheckpointTable(db);
  await ensureDenomPriceDayTable(db);
  await ensureBundleInstallTable(db);
}
