/**
 * Bundle installs and the storage fee they pay — a flow the fee line does not currently contain.
 *
 * **The brief says these fees are "folded into the fees line". They are not: they are absent.**
 * `fee_paid` comes from the `tx` event's `fee` attribute, which is the ante handler's gas fee.
 * Agoric's swingset module charges bundle storage SEPARATELY, during message execution, as its own
 * coin_spent/transfer after the `tx` events. Measured over 2026-01-10..2026-09-10: 42.7 BLD of gas
 * fees on install txs against 3,269.3 BLD of storage fees, none of the latter recorded. Recorded
 * BLD fees for that window are 4,112.4 BLD, so the fee line understates BLD revenue by about 44%.
 *
 * So this is not a reclassification of something already counted. It adds a missing flow.
 *
 * **How the storage fee is identified.** Not by the recipient address: the fees go to
 * `vbank/reserve`, not the usual `fee_collector`, and hardcoding a module address is the drift
 * problem denomRegistryDrift.ts exists to catch. Instead, within a tx that carries a
 * MsgInstallBundle, the storage fee is everything the fee payer spent BEYOND the declared `tx`
 * fee. MsgInstallBundle carries no coins of its own, so any further spend by the payer is a charge
 * the module levied. That rule needs no address, no event ordering and no chain params.
 *
 * The size of the charge comes from swingset params — `storageByte` beans per byte over `feeUnit`
 * beans, priced by `fee_unit_price` — currently about 133 ubld per byte. Those params are NOT read
 * here: the amount actually paid is in the events, and deriving it from params would substitute a
 * calculation for an observation and drift the moment governance changes a bean count.
 */
import type { EventKV } from "@/lib/cosmos";
import { parseCoinsAmounts } from "@/lib/cosmos";

/** The message that installs a contract bundle. */
export const MSG_INSTALL_BUNDLE = "/agoric.swingset.MsgInstallBundle";

export interface BundleInstallCharge {
  /** Who paid, from the `tx` event's `fee_payer`. Null when the event did not say. */
  readonly feePayer: string | null;
  /** Ordinary gas fee, per denom — the same figure `fee_paid` already records. */
  readonly gasFee: ReadonlyMap<string, bigint>;
  /** Storage fee, per denom: what the payer spent beyond the gas fee. */
  readonly storageFee: ReadonlyMap<string, bigint>;
}

function attr(ev: EventKV, key: string): string | null {
  for (const a of ev.attributes) if (a.key === key) return a.value;
  return null;
}

/** True when any message in the tx installs a bundle. */
export function hasBundleInstall(typeUrls: readonly string[]): boolean {
  return typeUrls.includes(MSG_INSTALL_BUNDLE);
}

/**
 * True when the storage fee cannot be attributed, because the tx carried other messages too.
 *
 * The rule below measures what the payer spent beyond the gas fee. In a tx that ALSO does
 * something costing coins — a MsgSend alongside the install — that spend lands in the same total
 * and `coin_spent` carries no message association to separate it with. Two installs in one tx are
 * NOT ambiguous: the whole remainder is still storage, just for both.
 *
 * Such a tx is recorded with a null storage fee rather than an inflated one. None of the 30
 * installs on chain to date is mixed, so this excludes nothing today; it keeps a wrong number from
 * appearing the first time one is.
 */
export function isAmbiguousInstallTx(typeUrls: readonly string[]): boolean {
  return typeUrls.some((t) => t !== MSG_INSTALL_BUNDLE);
}

/** Message typeUrls a successful tx emitted, from its `message` events' `action` attributes. */
export function typeUrlsFromEvents(events: readonly EventKV[]): string[] {
  const out: string[] = [];
  for (const ev of events) {
    if (ev.type !== "message") continue;
    for (const a of ev.attributes) if (a.key === "action") out.push(a.value);
  }
  return out;
}

function addInto(target: Map<string, bigint>, source: ReadonlyMap<string, bigint>): void {
  for (const [denom, amt] of source) target.set(denom, (target.get(denom) ?? BigInt(0)) + amt);
}

/**
 * Split what the fee payer spent into gas and storage.
 *
 * Only spends by the FEE PAYER count. A bundle install carries no coins, but reading every
 * coin_spent in the tx would pick up anything else a multi-message tx happened to do and book it
 * as a storage fee.
 *
 * A negative remainder is clamped to nothing rather than recorded. It would mean the payer spent
 * less than the declared fee, which cannot happen; treating it as a negative fee would corrupt a
 * running total, and it is not evidence of a refund.
 */
export function extractBundleInstallCharge(events: readonly EventKV[]): BundleInstallCharge {
  let feePayer: string | null = null;
  const gasFee = new Map<string, bigint>();
  for (const ev of events) {
    if (ev.type !== "tx") continue;
    const fee = attr(ev, "fee");
    if (fee) addInto(gasFee, parseCoinsAmounts(fee));
    const payer = attr(ev, "fee_payer");
    if (payer) feePayer = payer;
  }

  const spent = new Map<string, bigint>();
  if (feePayer !== null) {
    for (const ev of events) {
      if (ev.type !== "coin_spent") continue;
      if (attr(ev, "spender") !== feePayer) continue;
      const amount = attr(ev, "amount");
      if (amount) addInto(spent, parseCoinsAmounts(amount));
    }
  }

  const storageFee = new Map<string, bigint>();
  for (const [denom, total] of spent) {
    const remainder = total - (gasFee.get(denom) ?? BigInt(0));
    if (remainder > BigInt(0)) storageFee.set(denom, remainder);
  }
  return { feePayer, gasFee, storageFee };
}

/** Sum for one denom, for callers that only care about BLD. */
export function amountOf(fees: ReadonlyMap<string, bigint>, denom = "ubld"): bigint {
  return fees.get(denom) ?? BigInt(0);
}
