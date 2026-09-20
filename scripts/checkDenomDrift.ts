/**
 * Reconcile `src/config/denoms.json` against `published.agoricNames.vbankAsset` and report drift.
 *
 * Exits 1 when the two disagree, so this can run on a schedule and be noticed. It is NOT part of
 * `npm run verify`: verify must pass offline and on a pull request that never touched denoms, and
 * a check that fails the build whenever mainnet registers a new asset would be turned off within a
 * week. Drift is a thing to be told about, not a thing to block a build on.
 *
 * Reads nothing but the chain and a committed file, and writes nothing.
 *
 * Env: RPC_URL[, RPC_URL_FALLBACK]
 * Run: npm run check:denom-drift
 */
import "dotenv/config";
import { defaultRpcUrls, fetchVbankAssets } from "../src/lib/vbankAssetFetch";
import { summarizeLocalRegistryDrift, totalDrift } from "../src/lib/localDenomRegistries";

const TAG = "[checkDenomDrift]";

async function main() {
  const snapshot = await fetchVbankAssets(defaultRpcUrls());
  if (!snapshot) {
    console.error(`${TAG} could not read vbankAsset — reporting nothing rather than a clean bill of health`);
    process.exit(2);
  }
  console.error(
    `${TAG} chain publishes ${snapshot.entries.length} registered denoms at height ${snapshot.publishedHeight ?? "unknown"}`
  );

  const summaries = summarizeLocalRegistryDrift(snapshot.entries);
  for (const s of summaries) {
    console.error(`${TAG} ${s.source}: ${s.localEntries} entries, ${s.agreed} agree on decimals`);
    for (const line of s.drift) console.error(`${TAG}   DRIFT ${line}`);
  }

  const total = totalDrift(summaries);
  if (total === 0) {
    console.error(`${TAG} no drift`);
    return;
  }
  console.error(
    `${TAG} ${total} drift(s). Decimals are the divisor on every amount for that denom, so this is not cosmetic.`
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(`${TAG} failed:`, e);
  process.exit(2);
});
