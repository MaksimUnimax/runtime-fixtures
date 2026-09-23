/* Packaged browser-family identity. Product compatibility must not alias one supported browser to another. */
(() => {
  "use strict";

  const families = Object.freeze([
    "chrome",
    "opera",
    "yandex_chromium",
    "firefox",
    "safari",
  ]);

  function version(ua, expression) {
    const match = String(ua || "").match(expression);
    return match ? match[1] : null;
  }

  function detect(userAgent) {
    const ua = String(userAgent ?? (typeof navigator === "object" ? navigator.userAgent || "" : ""));

    const yandex = version(ua, /YaBrowser\/(\d+(?:\.\d+){0,3})/i);
    if (yandex) return Object.freeze({ family: "yandex_chromium", version: yandex });

    const opera = version(ua, /(?:OPR|Opera)\/(\d+(?:\.\d+){0,3})/i);
    if (opera) return Object.freeze({ family: "opera", version: opera });

    const firefox = version(ua, /Firefox\/(\d+(?:\.\d+){0,3})/i);
    if (firefox) return Object.freeze({ family: "firefox", version: firefox });

    if (/Edg(?:A|iOS)?\//i.test(ua)) {
      return Object.freeze({ family: null, version: null });
    }

    const safari = /Safari\//i.test(ua) && !/(?:Chrome|Chromium|CriOS|HeadlessChrome|OPR|Opera|YaBrowser|FxiOS)\//i.test(ua)
      ? version(ua, /Version\/(\d+(?:\.\d+){0,3})/i)
      : null;
    if (safari) return Object.freeze({ family: "safari", version: safari });

    const chrome = version(ua, /(?:Chrome|Chromium|HeadlessChrome)\/(\d+(?:\.\d+){0,3})/i);
    if (chrome) return Object.freeze({ family: "chrome", version: chrome });

    return Object.freeze({ family: null, version: null });
  }

  function current() {
    return detect(typeof navigator === "object" ? navigator.userAgent || "" : "");
  }

  globalThis.SellerAgentsBrowserIdentity = Object.freeze({
    families,
    detect,
    current,
    family: () => current().family,
    version: () => current().version,
  });
})();
