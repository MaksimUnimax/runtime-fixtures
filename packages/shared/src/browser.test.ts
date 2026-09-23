import { describe, expect, it } from "vitest";
import { BrowserFamilies } from "./browser";

describe("BrowserFamilies", () => {
  it("models every product browser family independently", () => {
    expect(BrowserFamilies).toEqual([
      "chrome",
      "opera",
      "yandex_chromium",
      "firefox",
      "safari",
    ]);
  });
});
