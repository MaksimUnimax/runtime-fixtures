export const SUPPORT_STATUSES = [
  "NEW",
  "TRIAGED",
  "NEEDS_INFO",
  "RESOLVED",
  "CLOSED",
] as const;

export function buildSupportFilter(values: Record<string, string>): string {
  const params = new URLSearchParams();
  params.set("limit", "50");
  for (const key of [
    "status",
    "category",
    "serverVersion",
    "extensionVersion",
    "browserFamily",
    "marketplace",
  ])
    if (values[key]) params.set(key, values[key]!);
  const query = params.toString();
  return query ? `?${query}` : "";
}
