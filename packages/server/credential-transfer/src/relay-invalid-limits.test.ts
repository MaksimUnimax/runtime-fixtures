import { describe, expect, it } from "vitest";
import { EphemeralTransferRelay } from "./index.js";

describe("B03 configured relay quotas remain numerical and bounded", () => {
  it.each([
    ["maxPackets", NaN],
    ["maxPacketsPerAccount", Number.POSITIVE_INFINITY],
    ["maxEnvelopeBytes", Number.NEGATIVE_INFINITY],
    ["maxEnvelopeBytesPerAccount", -1],
    ["maxPackets", 1.5],
    ["maxPacketsPerAccount", Number.MAX_SAFE_INTEGER + 1],
    ["maxEnvelopeBytes", "12"],
    ["maxPacketsPerAccount", undefined],
  ] as const)("rejects unsafe %s value %s at construction", (name, value) => {
    const limits = { [name]: value } as unknown as ConstructorParameters<
      typeof EphemeralTransferRelay
    >[0];
    expect(() => new EphemeralTransferRelay(limits)).toThrow(
      expect.objectContaining({ code: "TRANSFER_INVALID" }),
    );
  });

  it("ignores unrelated config metadata while still enforcing the packet cap", () => {
    const options = {
      maxPackets: 1,
      description: "future metadata is not a numeric quota",
    };
    const relay = new EphemeralTransferRelay(options);
    const now = new Date("2026-10-20T07:00:00Z");
    const expiresAt = new Date("2026-10-20T07:01:00Z");
    relay.reserve(
      { requestId: "first", packetId: "packet-first", envelope: "opaque" },
      "fixture-account",
      "fixture-device",
      expiresAt,
      now,
    );
    expect(() =>
      relay.reserve(
        { requestId: "second", packetId: "packet-second", envelope: "opaque" },
        "fixture-account",
        "fixture-device",
        expiresAt,
        now,
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSFER_CONFLICT" }));
    relay.clear();
  });

  it("retains default limits and permits a safe zero quota to disable packets", () => {
    const relay = new EphemeralTransferRelay();
    const denyAll = new EphemeralTransferRelay({ maxPackets: 0 });
    expect(relay.statsForTests()).toEqual({
      packets: 0,
      envelopeBytes: 0,
      reserved: 0,
    });
    expect(denyAll.statsForTests()).toEqual({
      packets: 0,
      envelopeBytes: 0,
      reserved: 0,
    });
    expect(() =>
      denyAll.reserve(
        { requestId: "disabled", packetId: "disabled-packet", envelope: "x" },
        "fixture-account",
        "fixture-device",
        new Date("2026-10-20T07:01:00Z"),
        new Date("2026-10-20T07:00:00Z"),
      ),
    ).toThrow(expect.objectContaining({ code: "TRANSFER_CONFLICT" }));
    relay.clear();
    denyAll.clear();
  });
});
