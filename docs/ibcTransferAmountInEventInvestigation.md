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

## How to read dashboard metrics

- **`ibc_transfer_amount_in`** — Intentionally follows this **combined** event model for headline IBC-in value on agoric-3. Treat it as a **gross, chain-reported** index when comparing to bank-only or message-decode series.
- **`bank_credits_volume`** — Uses **`coin_received`** only (and module-account filtering). It is **not** the same basis as **`ibc_transfer_amount_in`** and should not be assumed to reconcile to half of IBC-in or to deduplicate **`transfer`** vs **`coin_received`**.

## Related (scope and UX)

- **`src/lib/indexerIngestScope.ts`** — Indexer ingests **`block_results.txs_results`** only; finalize-block-only emissions are out of scope unless mirrored in a tx result.
- **`src/lib/semantics.ts`** — **`METHODOLOGY_BLURB`** (footer **Methodology & caveats**) and **`INDEXER_SCOPE_CAVEAT_*`** strings used in **`Dashboard.tsx`** so **Value handled**, **Gas and fees**, and **Economic participation** panels carry a short **tx-attributed only** reminder (inflation, distribution, slashing not counted at block scope).

## Tests

**`src/lib/ibcRecvEventAmounts.test.ts`** includes a synthetic case where both event types attach to the same **`msg_index`**, documenting that **`combined`** equals the **sum** of the two legs under the current model.
