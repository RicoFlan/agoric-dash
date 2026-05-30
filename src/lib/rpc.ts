const JSON_RPC = (method: string, params: unknown) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });

export async function rpcCall<T>(rpcUrl: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON_RPC(method, params),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const j = (await res.json()) as { error?: { message?: string }; result?: T };
  if (j.error?.message) throw new Error(j.error.message);
  if (j.result === undefined) throw new Error("RPC missing result");
  return j.result;
}

/**
 * Try each RPC endpoint in order; return the first success. Emits a single
 * `console.warn` line on each fallback hop so operators can see canonical-RPC
 * degradation without scraping per-request metrics.
 *
 * Stateless / per-call: every invocation re-attempts the primary first. This
 * keeps behavior simple to reason about and avoids hidden cool-down state;
 * callers wanting health-aware switching should layer it on top.
 *
 * URLs are deduplicated (first occurrence wins) and empty / non-string entries
 * are dropped so callers can pass `[process.env.RPC_URL ?? "", process.env.RPC_URL_FALLBACK ?? ""]`
 * without manual filtering. An entirely empty list is a configuration error
 * and throws; it is never silently a no-op.
 *
 * Failure modes from {@link rpcCall} that count as "try the next URL":
 * network rejection from `fetch`, non-2xx HTTP, JSON-RPC `error.message`, and
 * missing `result`. When every URL fails, the **last** thrown error propagates
 * — matching the existing per-height retry pattern in `scripts/indexer.ts`.
 */
export async function rpcCallWithFallback<T>(
  rpcUrls: readonly string[],
  method: string,
  params: unknown
): Promise<T> {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const u of rpcUrls) {
    if (typeof u !== "string" || u.length === 0) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    ordered.push(u);
  }
  if (ordered.length === 0) {
    throw new Error("rpcCallWithFallback requires at least one non-empty RPC URL");
  }

  let lastErr: unknown;
  for (let i = 0; i < ordered.length; i++) {
    const url = ordered[i]!;
    try {
      return await rpcCall<T>(url, method, params);
    } catch (e) {
      lastErr = e;
      const next = ordered[i + 1];
      if (next) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `RPC fallback: ${url} failed (${msg}) for ${method}; trying ${next}`
        );
      }
    }
  }
  throw lastErr;
}

export interface RpcBlockResponse {
  readonly block_id: unknown;
  readonly block: {
    readonly header: {
      readonly height: string;
      readonly time: string;
      readonly chain_id: string;
    };
    readonly data?: { readonly txs?: readonly string[] };
  };
}

export interface RpcTxResult {
  readonly code: number;
  readonly gas_used?: string;
  readonly gas_wanted?: string;
  readonly events?: ReadonlyArray<{
    readonly type: string;
    readonly attributes?: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  }>;
}

/** Consensus params echoed in block_results (CometBFT). `max_gas` is the per-block gas limit. */
export interface RpcConsensusParamUpdates {
  readonly block?: {
    readonly max_bytes?: string;
    /** Per-block gas limit; "-1" means unlimited on some chains (agoric-3 sets a positive value). */
    readonly max_gas?: string;
  };
}

/** A CometBFT ABCI event (finalize/begin/end block or tx). Attribute key/value are plain strings. */
export interface RpcAbciEvent {
  readonly type: string;
  readonly attributes?: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

export interface RpcBlockResultsResponse {
  readonly height: string;
  readonly txs_results?: readonly RpcTxResult[];
  /**
   * ABCI++ finalize-block events. The indexer reads vstorage `state_change` events here to
   * self-index smart-wallet offer outcomes (published.wallet.<addr> offerStatus). Older CometBFT
   * may instead populate `end_block_events`.
   */
  readonly finalize_block_events?: readonly RpcAbciEvent[];
  /** Pre-ABCI++ end-block events (fallback source for vstorage state_change). */
  readonly end_block_events?: readonly RpcAbciEvent[];
  /**
   * Consensus params at this height (agoric-3 CometBFT echoes them every block). Used to read the
   * per-block `max_gas` limit for block-space utilization — no extra RPC call needed.
   */
  readonly consensus_param_updates?: RpcConsensusParamUpdates | null;
}
