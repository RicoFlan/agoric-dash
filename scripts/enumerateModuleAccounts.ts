/**
 * One-shot enumeration of agoric-3 module accounts via the Agoric REST (LCD) API.
 * Writes the result to `src/config/agoricModuleAccounts.json` for use as a blocklist
 * filter in participation and value-moved aggregations.
 *
 * Run manually after chain upgrades that may add new modules; the file should then
 * be committed and reviewed via `git diff`. The contract test
 * (`src/lib/agoricModuleAccounts.contract.test.ts`) validates the file's shape.
 *
 * Usage:
 *   npx tsx scripts/enumerateModuleAccounts.ts
 *   npx tsx scripts/enumerateModuleAccounts.ts --rest=https://main.api.agoric.net:443
 *   npx tsx scripts/enumerateModuleAccounts.ts --out=/tmp/preview.json
 *
 * No environment variables; the REST endpoint is hard-coded with a CLI override
 * because this is a curation script, not an operational service.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_REST = "https://main.api.agoric.net:443";
const DEFAULT_OUT = "src/config/agoricModuleAccounts.json";
const CHAIN_ID = "agoric-3";

type ModuleAccountsListResponse = {
  readonly accounts?: ReadonlyArray<{
    readonly "@type"?: string;
    readonly base_account?: { readonly address?: string };
    readonly name?: string;
  }>;
};

type EnumeratedEntry = { address: string; name: string };

function parseArgs(argv: string[]): { rest: string; out: string } {
  let rest = DEFAULT_REST;
  let out = DEFAULT_OUT;
  for (const a of argv) {
    if (a.startsWith("--rest=")) rest = a.slice("--rest=".length);
    else if (a.startsWith("--out=")) out = a.slice("--out=".length);
  }
  return { rest, out };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Cosmos SDK ≥ 0.46 exposes a dedicated module-accounts endpoint that returns
 * only ModuleAccount entries — preferred when available because the generic
 * `/accounts` endpoint paginates over the entire chain account set.
 */
async function fetchViaModuleAccountsEndpoint(rest: string): Promise<EnumeratedEntry[] | null> {
  const url = new URL("/cosmos/auth/v1beta1/module_accounts", rest).toString();
  let data: ModuleAccountsListResponse;
  try {
    data = await fetchJson<ModuleAccountsListResponse>(url);
  } catch (e) {
    console.warn(
      `[enumerateModuleAccounts] /cosmos/auth/v1beta1/module_accounts not available (${e instanceof Error ? e.message : String(e)}); falling back to paginated accounts.`
    );
    return null;
  }
  const accounts = data.accounts ?? [];
  const out: EnumeratedEntry[] = [];
  for (const a of accounts) {
    if (a["@type"] !== "/cosmos.auth.v1beta1.ModuleAccount") continue;
    const address = a.base_account?.address;
    const name = a.name;
    if (typeof address !== "string" || address.length === 0) continue;
    if (typeof name !== "string" || name.length === 0) continue;
    out.push({ address, name });
  }
  return out;
}

/**
 * Fallback path: page through `/cosmos/auth/v1beta1/accounts` and filter to
 * ModuleAccount entries. Used only when the dedicated endpoint isn't available.
 */
async function fetchViaPaginatedAccounts(rest: string): Promise<EnumeratedEntry[]> {
  const out: EnumeratedEntry[] = [];
  let nextKey: string | undefined;
  let page = 0;
  for (;;) {
    const url = new URL("/cosmos/auth/v1beta1/accounts", rest);
    url.searchParams.set("pagination.limit", "1000");
    if (nextKey) url.searchParams.set("pagination.key", nextKey);
    const data = await fetchJson<{
      accounts?: ReadonlyArray<{
        "@type"?: string;
        base_account?: { address?: string };
        name?: string;
      }>;
      pagination?: { next_key?: string | null };
    }>(url.toString());
    page += 1;
    for (const a of data.accounts ?? []) {
      if (a["@type"] !== "/cosmos.auth.v1beta1.ModuleAccount") continue;
      const address = a.base_account?.address;
      const name = a.name;
      if (typeof address !== "string" || address.length === 0) continue;
      if (typeof name !== "string" || name.length === 0) continue;
      out.push({ address, name });
    }
    const nk = data.pagination?.next_key;
    if (!nk) break;
    nextKey = nk;
    if (page % 5 === 0) {
      console.warn(`[enumerateModuleAccounts] paginated accounts: scanned ${page} pages…`);
    }
  }
  return out;
}

function dedupeAndSort(entries: EnumeratedEntry[]): EnumeratedEntry[] {
  const seen = new Map<string, EnumeratedEntry>();
  for (const e of entries) {
    const prev = seen.get(e.address);
    if (prev && prev.name !== e.name) {
      console.warn(
        `[enumerateModuleAccounts] duplicate address ${e.address} with different names (${prev.name} vs ${e.name}); keeping first`
      );
      continue;
    }
    if (!prev) seen.set(e.address, e);
  }
  return [...seen.values()].sort((a, b) => a.address.localeCompare(b.address));
}

async function main(): Promise<void> {
  const { rest, out } = parseArgs(process.argv.slice(2));
  const restNormalized = rest.replace(/\/+$/, "");
  console.error(`[enumerateModuleAccounts] REST=${restNormalized} chainId=${CHAIN_ID}`);

  let entries = await fetchViaModuleAccountsEndpoint(restNormalized);
  if (entries === null) {
    entries = await fetchViaPaginatedAccounts(restNormalized);
  }
  entries = dedupeAndSort(entries);

  if (entries.length === 0) {
    throw new Error("No module accounts returned — refusing to overwrite the existing file.");
  }

  const file = {
    $comment:
      "Module accounts on agoric-3. Cosmos SDK derives these deterministically from module names, so they only change when a chain upgrade adds a module. Refresh with `npm run enumerate:module-accounts`. Validated by src/lib/agoricModuleAccounts.contract.test.ts.",
    chainId: CHAIN_ID,
    fetchedAt: new Date().toISOString(),
    entries,
  };

  const outPath = out.startsWith("/") ? out : join(process.cwd(), out);
  // 2-space indent to match denoms.json formatting; trailing newline for POSIX.
  writeFileSync(outPath, JSON.stringify(file, null, 2) + "\n", "utf8");
  console.error(`[enumerateModuleAccounts] wrote ${entries.length} entries to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
