import { MSG_IBC_TRANSFER } from "@/lib/semantics";

/** Sender-side gross movement legs for concentration (aligned with indexed transfer_volume sources). */
export function attributedTransferLegsFromDecodedMsg(
  typeUrl: string,
  decodedMsg: unknown
): Array<{ address: string; denom: string; amount: bigint }> {
  const out: Array<{ address: string; denom: string; amount: bigint }> = [];
  if (typeUrl.includes("MsgSend")) {
    const m = decodedMsg as {
      fromAddress?: string;
      from_address?: string;
      amount?: Array<{ denom: string; amount: string }>;
    };
    const from = m.fromAddress ?? m.from_address;
    if (!from) return out;
    for (const c of m.amount ?? []) {
      out.push({ address: from, denom: c.denom, amount: BigInt(c.amount) });
    }
    return out;
  }
  if (typeUrl.includes("MsgMultiSend")) {
    const m = decodedMsg as {
      inputs?: Array<{
        address?: string;
        coins?: Array<{ denom: string; amount: string }>;
      }>;
    };
    for (const inp of m.inputs ?? []) {
      const addr = inp.address;
      if (!addr) continue;
      for (const c of inp.coins ?? []) {
        out.push({ address: addr, denom: c.denom, amount: BigInt(c.amount) });
      }
    }
    return out;
  }
  if (typeUrl === MSG_IBC_TRANSFER) {
    const m = decodedMsg as {
      sender?: string;
      token?: { denom: string; amount: string };
    };
    if (m.sender && m.token) {
      out.push({
        address: m.sender,
        denom: m.token.denom,
        amount: BigInt(m.token.amount),
      });
    }
  }
  return out;
}
