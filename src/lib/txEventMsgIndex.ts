/**
 * Cosmos SDK / CometBFT tx_result events often tag attributes with `msg_index` so listeners can
 * associate emitted events with `TxBody.messages[i]`.
 */

/** Decimal non-negative index from the standard `msg_index` attribute, if present. */
export function parseMsgIndexFromAttributes(
  attributes: ReadonlyArray<{ readonly key: string; readonly value: string }>
): number | undefined {
  for (const a of attributes) {
    if (a.key !== "msg_index") continue;
    const n = Number.parseInt(a.value, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return undefined;
}

/** Message indices whose `typeUrl` matches (e.g. MsgRecvPacket positions). */
export function msgIndicesMatchingTypeUrl(
  messages: ReadonlyArray<{ typeUrl: string }>,
  typeUrl: string
): Set<number> {
  const s = new Set<number>();
  messages.forEach((m, i) => {
    if (m.typeUrl === typeUrl) s.add(i);
  });
  return s;
}
