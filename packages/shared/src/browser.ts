export const BrowserFamilies = [
  "chrome",
  "opera",
  "yandex_chromium",
  "firefox",
  "safari",
] as const;

export type BrowserFamily = (typeof BrowserFamilies)[number];
