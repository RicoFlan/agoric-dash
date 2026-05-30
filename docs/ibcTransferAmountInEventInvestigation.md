# `ibc_transfer_amount_in`: `coin_received` vs `transfer` events

## Question

The dashboard series **`ibc_transfer_amount_in`** (and the indexer helper **`sumRecvCoinAmountsFromTxEvents`**) sums amounts parsed from tx-result events of types **`coin_received`** and **`transfer`** that match **`MsgRecvPacket`** message indices when **`msg_index`** attributes are present.

For a single ICS-20 settlement, does the Cosmos SDK / bank module emit **both** event types with the same minimal-unit amount? If so, the **combined** map used in rollups can reflect **two accounting views of one movement** (a gross index), not “each base unit counted once across the two event families.”

## Implementation (reference)

- **`src/lib/ibcRecvEventAmounts.ts`** — `sumRecvCoinAmountsFromTxEvents`, **`diagnoseRecvCoinAmountsByEventType`**, msg_index scoping vs legacy tx-wide fallback.
- **`scripts/inspectIbcRecvTxEventAmounts.ts`** — `npm run inspect:ibc-recv-tx-events` reproduces the same parsing on live RPC data and prints **`fromCoinReceivedOnly`**, **`fromTransferOnly`**, and **`combined`**.

## Procedure

1. Pick a successful tx that includes **`MsgRecvPacket`** (e.g. from **`npm run scan:ibc-recv-day`** JSON **`hits[]`**, or Mintscan for agoric-3).
2. Run:

   ```bash
   npx tsx scripts/inspectIbcRecvTxEventAmounts.ts \
     --height=25160256 --tx-index=0 \
     --rpc=https://main-a.rpc.agoric.net
   ```

   (`--rpc=` pins one node; omit to use **`RPC_URL`** / fallback from **`.env`**.)

3. Compare **`ibcTransferAmountInModel.fromCoinReceivedOnly`**, **`fromTransferOnly`**, and **`combined`** for each denom.

## Live example (agoric-3, reproducible)

**Block height:** `25160256`  
**Tx index:** `0`  
**Tx hash:** `73DEBC3956AEF72DC76F9D23CB4EB3646005345B08BBEF582627C84AA36208D5`  
**RPC used for capture:** `https://main-a.rpc.agoric.net`

Abbreviated stderr (event subset):

- **`coin_received`**: `amount="4700000000uist"` with **`msg_index="1"`** (recv leg).
- **`transfer`**: `amount="4700000000uist"` with **`msg_index="1"`** (same recv leg).

JSON excerpt from stdout (same run as above):

```json
"ibcTransferAmountInModel": {
  "combined": { "uist": "9400000000" },
  "fromCoinReceivedOnly": { "uist": "4700000000" },
  "fromTransferOnly": { "uist": "4700000000" },
  "usedMsgIndexFilter": true,
  "usedLegacyFallback": false
}
```

Here **`4700000000 + 4700000000 = 9400000000`**: the **combined** rollup matches the sum of the two per-type legs for **`uist`**, consistent with **both** event types carrying the same settlement amount for that message index.

The same tx also shows **`ubld`** on **`coin_received`** / **`transfer`** **without** **`msg_index`** on those rows; those rows are **not** attributed to **`MsgRecvPacket`** index `1` when **`usedMsgIndexFilter`** is true, so they do not appear in the **`uist`** recv split above.

## Resolution: deduped single-count basis

Because the two event families mirror the **same** settlement (the live example above sums to exactly **2×**), summing them overcounts IBC-in value. The indexer now writes a **deduped single-count basis** for **`ibc_transfer_amount_in`**:

> per denom, **`max(coin_received sum, transfer sum)`** over MsgRecvPacket-scoped events — see **`sumRecvCoinAmountsDedupedFromTxEvents`** in **`src/lib/ibcRecvEventAmounts.ts`**.

Taking the max collapses the mirrored legs to a single count (for the example above, `max(4700000000, 4700000000) = 4700000000`) and degrades gracefully when only one event family carries a denom. The earlier additive **`combined`** model (`sumRecvCoinAmountsFromTxEvents`) is retained only as a diagnostic for the inspection script. This change requires a reindex/backfill to take effect on stored rows.

## How to read dashboard metrics

- **`ibc_transfer_amount_in`** — Deduped single-count IBC-in value on agoric-3 (`max` of the two per-type legs). It is **no longer** a ~2× gross index.
- **`bank_credits_volume`** — Uses **`coin_received`** only (and module-account filtering). It is still a **different basis** from **`ibc_transfer_amount_in`** (different event scoping/filters) and should not be assumed to reconcile exactly.

## Related (scope and UX)

- **`src/lib/indexerIngestScope.ts`** — Indexer ingests **`block_results.txs_results`** only; finalize-block-only emissions are out of scope unless mirrored in a tx result.
- **`src/lib/semantics.ts`** — **`METHODOLOGY_SECTIONS`** / **`METHODOLOGY_BLURB`** (footer **Methodology & caveats** via **`MethodologyPanel.tsx`**) and **`INDEXER_SCOPE_CAVEAT_*`** strings in **`Dashboard.tsx`** so **Value handled**, **Gas and fees**, and **Economic participation** carry a short **tx-attributed only** reminder. The **Value handled** table and **Value Flow Map** juxtapose **gross in-tx** (includes **`ibc_transfer_amount_in`**) with **`bank_credits_volume`** as **non-additive** views; see methodology sections **Value handled table** and **IBC direction and amounts**.

## Tests

**`src/lib/ibcRecvEventAmounts.test.ts`** includes synthetic cases for both bases: the legacy **`combined`** sum (`sumRecvCoinAmountsFromTxEvents` / `diagnoseRecvCoinAmountsByEventType`) and the current deduped **`max`** basis (`sumRecvCoinAmountsDedupedFromTxEvents`), where two equal legs collapse to one count.
