/**
 * Extract Bech32 account addresses from decoded txs for participation metrics.
 * Prefix matches Agoric mainnet accounts (`agoric1…`).
 */
import { pubkeyToAddress } from "@cosmjs/amino";
import { decodePubkey } from "@cosmjs/proto-signing";
import type { AuthInfo } from "cosmjs-types/cosmos/tx/v1beta1/tx";

export const AGORIC_ACCOUNT_PREFIX = "agoric";

/** Primary signer addresses from auth info (order preserved). */
export function signerBech32AddressesFromAuthInfo(authInfo: AuthInfo): string[] {
  const out: string[] = [];
  for (const si of authInfo.signerInfos ?? []) {
    if (!si.publicKey) continue;
    const pk = decodePubkey(si.publicKey);
    if (!pk) continue;
    try {
      out.push(pubkeyToAddress(pk, AGORIC_ACCOUNT_PREFIX));
    } catch {
      /* unsupported multisig / pubkey layout */
    }
  }
  return out;
}

/**
 * Fee payer: `fee.granter` when set (fee grant), otherwise first signer (typical Cosmos SDK payer).
 */
export function feePayerBech32FromAuthInfo(authInfo: AuthInfo): string | null {
  const granter = authInfo.fee?.granter?.trim();
  if (granter) return granter;
  const signers = signerBech32AddressesFromAuthInfo(authInfo);
  return signers[0] ?? null;
}
