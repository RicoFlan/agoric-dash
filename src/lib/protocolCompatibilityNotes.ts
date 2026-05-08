/**
 * Compatibility expectations when Agoric / Cosmos SDK / ibc-go upgrade on-chain.
 *
 * Decoding uses CosmJS (@cosmjs/* in package.json) `Registry` + default proto types. Major upgrades
 * that register new `Msg` types, rename protobuf paths, or change event schemas may require:
 * - Bumping @cosmjs packages and regenerating/broadening `txRegistry` in `src/lib/cosmos.ts`
 * - Adjusting string matchers for tx_result events (`ibcRecvEventAmounts`, `extractPaidFeesFromEvents`)
 * - Re-indexing or targeted backfills so historical buckets stay comparable
 *
 * Event keys we rely on (non-exhaustive): `tx` + `fee`; `coin_received` / `transfer` + `amount`;
 * `recv_packet` + `packet_sequence` / `packet_dst_channel` / `packet_dst_port`; `msg_index` on
 * attributes when present. Typed-event migrations on the chain can change attribute layouts —
 * compare ibc-go / SDK release notes when debugging sudden rollup drift.
 */

/** CosmJS major line used for Tx/msg decode — bump with chain upgrades per notes above. */
export const DECODE_STACK_COSMJS_MAJOR = "0.33.x" as const;
