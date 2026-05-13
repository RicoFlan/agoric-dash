/**
 * Blocklist of agoric-3 module-owned bech32 addresses, sourced from
 * `src/config/agoricModuleAccounts.json` (refresh with `npm run enumerate:module-accounts`).
 *
 * Used by future indexer / aggregation steps to exclude module accounts from
 *   - participation roles (active-address counting; see participantRollupPolicy.ts)
 *   - value-moved totals when the requested basis is "credits to user-owned addresses"
 *
 * Not yet imported by indexer or API paths — wiring happens in later steps.
 */
import data from "@/config/agoricModuleAccounts.json";

type ModuleAccountEntry = { readonly address: string; readonly name: string };

const entries = data.entries as ReadonlyArray<ModuleAccountEntry>;

export const AGORIC_MODULE_ACCOUNT_ADDRESSES: ReadonlySet<string> = new Set(
  entries.map((e) => e.address)
);

export const AGORIC_MODULE_ACCOUNTS: ReadonlyArray<ModuleAccountEntry> = entries;

export function isAgoricModuleAccount(addr: string): boolean {
  return AGORIC_MODULE_ACCOUNT_ADDRESSES.has(addr);
}
