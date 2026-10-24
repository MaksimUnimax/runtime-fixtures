type ClosableDatabase = { close(): Promise<void> };

/** Distinct authenticated pools for ordinary API writes and fenced transfers. */
export async function createApiDatabases<T extends ClosableDatabase>(
  applicationUrl: string,
  transferUrl: string | undefined,
  createRuntime: (url: string) => T,
  monitorHealthReadUrl?: string,
  monitorHealthExpectedRole?: string,
): Promise<{
  database: T;
  transferDatabase: T;
  healthReadDatabase?: T;
  closeDatabases(): Promise<void>;
}> {
  if (!transferUrl)
    throw new Error("CREDENTIAL_TRANSFER_DATABASE_URL_REQUIRED");
  let application: URL;
  let transfer: URL;
  let monitorHealth: URL | undefined;
  try {
    const normalize = (value: string) => {
      const url = new URL(value);
      if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
        throw new Error();
      if (!url.username || !url.hostname || !url.pathname.slice(1) || url.hash)
        throw new Error();
      // pg copies query parameters into its connection configuration. Accept
      // only TLS fields, which cannot replace LOGIN, host, port or database.
      const tlsFields = new Set([
        "sslmode",
        "sslcert",
        "sslkey",
        "sslrootcert",
      ]);
      for (const key of url.searchParams.keys())
        if (!tlsFields.has(key)) throw new Error();
      // Prevent the driver's legacy malformed-URI repair from re-encoding any
      // already validated identity when a TLS query contains invalid escapes.
      decodeURI(url.toString());
      decodeURIComponent(url.username);
      decodeURIComponent(url.password);
      decodeURIComponent(url.hostname);
      decodeURI(url.pathname.slice(1));
      // An omitted port otherwise falls back to PGPORT in pg. Materialize the
      // validated default in the exact URL passed to the runtime factory.
      if (!url.port) url.port = "5432";
      return url;
    };
    application = normalize(applicationUrl);
    transfer = normalize(transferUrl);
    // The monitor database has its own isolated reader principal and schema.
    // No silent fallback to the product database is permitted.
    if (
      (monitorHealthReadUrl === undefined) !==
      (monitorHealthExpectedRole === undefined)
    )
      throw new Error();
    if (monitorHealthReadUrl !== undefined) {
      monitorHealth = normalize(monitorHealthReadUrl);
      const role = decodeURIComponent(monitorHealth.username);
      const name = decodeURI(monitorHealth.pathname.slice(1));
      if (
        !monitorHealthExpectedRole ||
        role !== monitorHealthExpectedRole ||
        role === decodeURIComponent(application.username) ||
        role === decodeURIComponent(transfer.username) ||
        name !== "octoport_monitor_pilot" ||
        name === decodeURI(application.pathname.slice(1)) ||
        name === decodeURI(transfer.pathname.slice(1))
      )
        throw new Error();
    }
    if (
      decodeURIComponent(application.hostname) !==
        decodeURIComponent(transfer.hostname) ||
      application.port !== transfer.port ||
      decodeURI(application.pathname.slice(1)) !==
        decodeURI(transfer.pathname.slice(1))
    )
      throw new Error();
    if (
      decodeURIComponent(application.username) ===
      decodeURIComponent(transfer.username)
    )
      throw new Error();
  } catch {
    // Never expose either connection string or credentials in a diagnostic.
    throw new Error("API_DATABASE_ROLE_OR_ENDPOINT_SEPARATION_REQUIRED");
  }
  const allocated: Array<{
    kind: "application" | "transfer" | "monitor";
    runtime: T;
  }> = [];
  const cleanupAllocated = async () => {
    const results = await Promise.allSettled(
      allocated.map(({ runtime }) =>
        Promise.resolve().then(() => runtime.close()),
      ),
    );
    return results.flatMap((result, index) =>
      result.status === "rejected"
        ? [{ kind: allocated[index]!.kind, reason: result.reason }]
        : [],
    );
  };
  let database: T;
  let transferDatabase: T;
  let healthReadDatabase: T | undefined;
  try {
    database = createRuntime(application.toString());
    allocated.push({ kind: "application", runtime: database });
    transferDatabase = createRuntime(transfer.toString());
    allocated.push({ kind: "transfer", runtime: transferDatabase });
  } catch (error) {
    const cleanupFailures = await cleanupAllocated();
    if (cleanupFailures.length)
      throw new AggregateError(
        [error, ...cleanupFailures.map(({ reason }) => reason)],
        "API_DATABASE_SETUP_FAILED",
      );
    throw error;
  }
  if (monitorHealth) {
    try {
      healthReadDatabase = createRuntime(monitorHealth.toString());
      allocated.push({ kind: "monitor", runtime: healthReadDatabase });
    } catch {
      const cleanupFailures = await cleanupAllocated();
      const monitorFailure = new Error(
        "MONITOR_HEALTH_READ_DATABASE_SETUP_FAILED",
      );
      if (cleanupFailures.length)
        throw new AggregateError(
          [monitorFailure, ...cleanupFailures.map(({ reason }) => reason)],
          "API_DATABASE_SETUP_FAILED",
        );
      throw monitorFailure;
    }
  }
  let closing: Promise<void> | undefined;
  return {
    database,
    transferDatabase,
    healthReadDatabase,
    closeDatabases() {
      if (!closing) {
        closing = (async () => {
          const failures = await cleanupAllocated();
          const nonMonitor = failures
            .filter(({ kind }) => kind !== "monitor")
            .map(({ reason }) => reason);
          const monitorFailed = failures.some(({ kind }) => kind === "monitor");
          const errors = monitorFailed
            ? [
                ...nonMonitor,
                new Error("MONITOR_HEALTH_READ_DATABASE_CLOSE_FAILED"),
              ]
            : nonMonitor;
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1)
            throw new AggregateError(errors, "API_DATABASE_CLEANUP_FAILED");
        })();
      }
      return closing;
    },
  };
}
