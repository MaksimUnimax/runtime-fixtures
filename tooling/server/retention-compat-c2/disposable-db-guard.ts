const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export const B_RETENTION_COMPAT_DISPOSABLE_DATABASE = Object.freeze({
  port: "15542",
  role: "octoport_test",
  database: "octoport_b_test",
});

export function assertBRetentionCompatDisposableDatabaseUrl(
  value: string | undefined,
): string {
  const connectionString = value?.trim();
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL_INVALID");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL_SCHEME_INVALID");
  }

  const expected = B_RETENTION_COMPAT_DISPOSABLE_DATABASE;
  if (
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.port !== expected.port ||
    decodeURIComponent(url.username) !== expected.role ||
    url.pathname !== `/${expected.database}` ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("DATABASE_URL_NOT_B_DISPOSABLE");
  }

  return connectionString;
}
