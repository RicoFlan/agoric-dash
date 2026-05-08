import { describe, expect, it } from "vitest";
import { encodePubkey } from "@cosmjs/proto-signing";
import { SignMode } from "cosmjs-types/cosmos/tx/signing/v1beta1/signing";
import {
  AuthInfo,
  Fee,
  ModeInfo,
  SignerInfo,
} from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { feePayerBech32FromAuthInfo, signerBech32AddressesFromAuthInfo } from "./txParticipantAddresses";

/** Deterministic ed25519 test pubkey bytes → Any for SignerInfo.publicKey */
function testEd25519SignerInfo(): SignerInfo {
  const anyPk = encodePubkey({
    type: "tendermint/PubKeyEd25519",
    value: Buffer.alloc(32, 11).toString("base64"),
  });
  return SignerInfo.fromPartial({
    publicKey: anyPk,
    modeInfo: ModeInfo.fromPartial({
      single: { mode: SignMode.SIGN_MODE_DIRECT },
    }),
    sequence: BigInt(0),
  });
}

describe("feePayerBech32FromAuthInfo", () => {
  it("prefers granter when granter and payer both set", () => {
    const auth = AuthInfo.fromPartial({
      fee: Fee.fromPartial({
        granter: "agoric1granterxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        payer: "agoric1payerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        amount: [],
        gasLimit: BigInt(200000),
      }),
      signerInfos: [testEd25519SignerInfo()],
    });
    expect(feePayerBech32FromAuthInfo(auth)).toBe("agoric1granterxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("uses explicit fee.payer when granter is empty", () => {
    const auth = AuthInfo.fromPartial({
      fee: Fee.fromPartial({
        payer: "agoric1explicitfeepayerxxxxxxxxxxxxxxxxxxx",
        granter: "",
        amount: [],
        gasLimit: BigInt(200000),
      }),
      signerInfos: [testEd25519SignerInfo()],
    });
    expect(feePayerBech32FromAuthInfo(auth)).toBe("agoric1explicitfeepayerxxxxxxxxxxxxxxxxxxx");
  });

  it("falls back to first signer when fee.granter and fee.payer are unset", () => {
    const si = testEd25519SignerInfo();
    const auth = AuthInfo.fromPartial({
      fee: Fee.fromPartial({
        amount: [],
        gasLimit: BigInt(200000),
        payer: "",
        granter: "",
      }),
      signerInfos: [si],
    });
    const expectedFirst = signerBech32AddressesFromAuthInfo(auth)[0];
    expect(expectedFirst).toMatch(/^agoric1/);
    expect(feePayerBech32FromAuthInfo(auth)).toBe(expectedFirst);
  });
});
