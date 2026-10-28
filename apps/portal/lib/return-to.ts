export function safeReturnTo(value: string | null): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    // Intentional: control characters are invalid in a portal return target.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return "/";
  try {
    // Decode once solely to reject malformed escapes and encoded path escapes.
    decodeURIComponent(value);
    const parsed = new URL(value, "http://portal.local");
    if (parsed.origin !== "http://portal.local") return "/";
    if (parsed.pathname === "/" && !parsed.search) return "/";
    if (parsed.pathname === "/connect" && !parsed.search) return "/connect";
    if (parsed.pathname === "/devices" && !parsed.search) return "/devices";
    if (parsed.pathname === "/billing" && !parsed.search) return "/billing";
    if (
      parsed.pathname === "/activate" &&
      /^\?authorizationId=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.search,
      )
    )
      return `${parsed.pathname}${parsed.search}`;
    return "/";
  } catch {
    return "/";
  }
}
