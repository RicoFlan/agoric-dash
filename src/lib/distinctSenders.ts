/**
 * Wash/overcounting guardrail: distinct sending addresses per denom over the range.
 *
 * Gross transfer volume is inflatable by a single entity round-tripping funds. Pairing each denom's
 * gross flow with the count of *distinct senders* that produced it exposes that risk: high volume from
 * very few senders is concentrated / possible wash, whereas broad sender participation is harder to fake.
 *
 * Counts the sender-attributed legs already aggregated per address×denom (MsgSend / MultiSend inputs /
 * ICS-20 sender) — the same scope as `address_volume_day` and the top-N gross concentration. It is
 * sender-side only: IBC-in recv settlement and bank credits have no sender attribution here.
 *
 * Pure: takes the per-address→denom→volume map (module accounts already excluded by the query) so it is
 * unit-testable without DB access.
 */
export function distinctSendersByDenom(
  volumeByAddressDenom: Map<string, Map<string, bigint>>
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const [, byDenom] of volumeByAddressDenom) {
    for (const [denom, volume] of byDenom) {
      if (volume > BigInt(0)) counts.set(denom, (counts.get(denom) ?? 0) + 1);
    }
  }
  return Object.fromEntries(counts);
}
