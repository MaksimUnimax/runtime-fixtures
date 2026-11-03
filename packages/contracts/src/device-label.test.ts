import { describe, expect, it } from "vitest";
import {
  ConnectionCodeExchangeBodyV1Schema,
  DeviceAuthorizationStartBodyV1Schema,
} from "./index.js";
const code = "octo1_" + "A".repeat(43);
describe("canonical device label input boundaries", () => {
  const controls = [
    0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
    0x2067, 0x2068, 0x2069, 0, 10, 13,
  ];
  for (const value of controls)
    it(`refuses U+${value.toString(16)} on both enrollment contracts`, () => {
      const deviceLabel = `Устройство${String.fromCodePoint(value)}ACTIVE`;
      expect(
        ConnectionCodeExchangeBodyV1Schema.safeParse({ code, deviceLabel })
          .success,
      ).toBe(false);
      expect(
        DeviceAuthorizationStartBodyV1Schema.safeParse({
          clientType: "browser_extension",
          deviceLabel,
        }).success,
      ).toBe(false);
    });
  it.each([
    "Рабочий ноутбук №2",
    "جهاز محمد",
    "מחשב",
    "端末🙂",
    "De\u0301vice",
    "Family 👩‍👩‍👧‍👦",
  ])("preserves normal Unicode %s", (deviceLabel) => {
    expect(
      ConnectionCodeExchangeBodyV1Schema.safeParse({ code, deviceLabel })
        .success,
    ).toBe(true);
    expect(
      DeviceAuthorizationStartBodyV1Schema.safeParse({
        clientType: "browser_extension",
        deviceLabel,
      }).success,
    ).toBe(true);
  });
  it("retains the existing separate 80 and 128 character limits", () => {
    expect(
      ConnectionCodeExchangeBodyV1Schema.safeParse({
        code,
        deviceLabel: "x".repeat(81),
      }).success,
    ).toBe(false);
    expect(
      DeviceAuthorizationStartBodyV1Schema.safeParse({
        clientType: "browser_extension",
        deviceLabel: "x".repeat(128),
      }).success,
    ).toBe(true);
    expect(
      DeviceAuthorizationStartBodyV1Schema.safeParse({
        clientType: "browser_extension",
        deviceLabel: "x".repeat(129),
      }).success,
    ).toBe(false);
  });
});
