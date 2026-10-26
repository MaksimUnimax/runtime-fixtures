import { describe, expect, it } from "vitest";
import { compareSemVerV1, loadConfig } from "./index.js";

describe("loadConfig", () => {
  it("rejects an absent required database URL deterministically", () => {
    expect(() => loadConfig({ NODE_ENV: "test" })).toThrow();
  });
});

describe("compareSemVerV1", () => {
  it("implements the SemVer 2.0 precedence examples", () => {
    const ascending: Array<[string, string]> = [
      ["1.0.0", "2.0.0"],
      ["2.0.0", "2.1.0"],
      ["2.1.0", "2.1.1"],
      ["1.0.0-alpha", "1.0.0"],
      ["1.0.0-alpha", "1.0.0-alpha.1"],
      ["1.0.0-alpha.1", "1.0.0-alpha.beta"],
      ["1.0.0-alpha.beta", "1.0.0-beta"],
      ["1.0.0-beta", "1.0.0-beta.2"],
      ["1.0.0-beta.2", "1.0.0-beta.11"],
      ["1.0.0-beta.11", "1.0.0-rc.1"],
      ["1.0.0-rc.1", "1.0.0"],
    ];
    for (const [a, b] of ascending) expect(compareSemVerV1(a, b)).toBe(-1);
    expect(compareSemVerV1("1.0.0+build.1", "1.0.0+build.9")).toBe(0);
  });
});

describe("SemVer precision and complete prerelease identifiers", () => {
  it.each([
    ["1.0.0-alpha", "1.0.0-alpha-1"],
    ["1.0.0-alpha-1", "1.0.0-alpha-2"],
    ["1.0.0-1", "1.0.0-1-a"],
    ["9007199254740992.0.0", "9007199254740993.0.0"],
    ["1.9007199254740992.0", "1.9007199254740993.0"],
    ["1.0.9007199254740992", "1.0.9007199254740993"],
    ["1.0.0-9007199254740992", "1.0.0-9007199254740993"],
  ])("orders %s strictly before %s in both directions", (lower, higher) => {
    expect(compareSemVerV1(lower, higher)).toBe(-1);
    expect(compareSemVerV1(higher, lower)).toBe(1);
    expect(compareSemVerV1(lower, lower)).toBe(0);
  });

  it("compares numeric identifiers without floating-point rounding", () => {
    const values = [
      "0",
      "1",
      "9",
      "10",
      "9007199254740991",
      "9007199254740992",
      "9007199254740993",
      "10000000000000000000000000000000000000000",
    ];
    const versions = [
      (n: string) => `${n}.0.0`,
      (n: string) => `1.${n}.0`,
      (n: string) => `1.0.${n}`,
      (n: string) => `1.0.0-${n}`,
    ];
    for (const a of values)
      for (const b of values) {
        const expected =
          BigInt(a) === BigInt(b) ? 0 : BigInt(a) < BigInt(b) ? -1 : 1;
        for (const version of versions) {
          expect(compareSemVerV1(version(a), version(b))).toBe(expected);
        }
      }
    expect(
      compareSemVerV1(`${"9".repeat(59)}.0.0`, `${"1" + "0".repeat(59)}.0.0`),
    ).toBe(-1);
  });

  it("preserves ASCII, numeric-first and identifier-count precedence", () => {
    const ordered = [
      "1.0.0-0",
      "1.0.0-1",
      "1.0.0-9007199254740992",
      "1.0.0-9007199254740993",
      "1.0.0--",
      "1.0.0-1-a",
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-alpha-1",
      "1.0.0-alpha-2",
      "1.0.0-beta",
      "1.0.0",
      "2.0.0",
    ];
    for (const [i, a] of ordered.entries())
      for (const [j, b] of ordered.entries()) {
        expect(compareSemVerV1(a, b)).toBe(i === j ? 0 : i < j ? -1 : 1);
      }
  });

  it("ignores only build metadata, not hyphens in prerelease identifiers", () => {
    expect(
      compareSemVerV1("1.0.0-alpha-1+build-a", "1.0.0-alpha-1+build-b"),
    ).toBe(0);
    expect(compareSemVerV1("1.0.0-alpha-1+z", "1.0.0-alpha-2+a")).toBe(-1);
    expect(compareSemVerV1("1.0.0+build-alpha-1", "1.0.0+build-alpha-2")).toBe(
      0,
    );
  });

  it.each([
    "01.0.0",
    "1.01.0",
    "1.0.01",
    "1.0.0-01",
    "1.0.0-alpha..1",
    "1.0.0-",
    "1.0.0+",
    `${"9".repeat(61)}.0.0`,
  ])("keeps rejecting the unchanged invalid lexical input %s", (invalid) => {
    expect(() => compareSemVerV1(invalid, "1.0.0")).toThrow();
    expect(() => compareSemVerV1("1.0.0", invalid)).toThrow();
  });
});
