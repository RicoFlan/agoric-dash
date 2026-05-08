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

export interface RpcBlockResultsResponse {
  readonly height: string;
  readonly txs_results?: readonly RpcTxResult[];
  /** ABCI++ may attach finalize-block events; indexer ignores these unless explicitly wired. */
  readonly finalize_block_events?: unknown;
}
