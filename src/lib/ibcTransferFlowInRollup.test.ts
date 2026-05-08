import { describe, expect, it } from "vitest";
import { addIbcTransferFlowInForTx } from "./ibcTransferFlowInRollup";
import { SERIES } from "./semantics";

const ROLLUP_KEY_DELIM = "\0";

describe("addIbcTransferFlowInForTx", () => {
  it("accumulates flow_in into daily and hourly maps", () => {
    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    const hour = new Date("2026-05-01T12:00:00.000Z");
    addIbcTransferFlowInForTx(daily, hourly, "2026-05-01", hour, [], 2);
    const dk = ["2026-05-01", SERIES.IBC_TRANSFER_FLOW_IN, ""].join(ROLLUP_KEY_DELIM);
    const hk = [hour.toISOString(), SERIES.IBC_TRANSFER_FLOW_IN, ""].join(ROLLUP_KEY_DELIM);
    expect(daily.get(dk)).toBe(BigInt(2));
    expect(hourly.get(hk)).toBe(BigInt(2));
  });

  it("uses distinct recv_packet count when events present (not raw MsgRecvPacket count)", () => {
    const daily = new Map<string, bigint>();
    const hourly = new Map<string, bigint>();
    const hour = new Date("2026-05-01T00:00:00.000Z");
    addIbcTransferFlowInForTx(
      daily,
      hourly,
      "2026-05-01",
      hour,
      [
        {
          type: "recv_packet",
          attributes: [
            { key: "packet_dst_channel", value: "c1" },
            { key: "packet_sequence", value: "1" },
          ],
        },
        {
          type: "recv_packet",
          attributes: [
            { key: "packet_dst_channel", value: "c1" },
            { key: "packet_sequence", value: "2" },
          ],
        },
      ],
      99
    );
    const k = ["2026-05-01", SERIES.IBC_TRANSFER_FLOW_IN, ""].join(ROLLUP_KEY_DELIM);
    expect(daily.get(k)).toBe(BigInt(2));
  });
});
