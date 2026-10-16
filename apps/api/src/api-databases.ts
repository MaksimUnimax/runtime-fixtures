type ClosableDatabase = { close(): Promise<void> };

/** Distinct authenticated pools for ordinary API writes and fenced transfers. */
export async function createApiDatabases<T extends ClosableDatabase>(
  applicationUrl: string,
  transferUrl: string | undefined,
  createRuntime: (url: string) => T,
): Promise<{
  database: T;
  transferDatabase: T;
  closeDatabases(): Promise<void>;
}> {
  if (!transferUrl)
    throw new Error("CREDENTIAL_TRANSFER_DATABASE_URL_REQUIRED");
  let application: URL;
  let transfer: URL;
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
  const database = createRuntime(application.toString());
  let transferDatabase: T;
  try {
    transferDatabase = createRuntime(transfer.toString());
  } catch (error) {
    try {
      await database.close();
    } catch (closeError) {
      throw new AggregateError(
        [error, closeError],
        "API_DATABASE_SETUP_FAILED",
      );
    }
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    database,
    transferDatabase,
    closeDatabases() {
      if (!closing) {
        closing = (async () => {
          const results = await Promise.allSettled([
            Promise.resolve().then(() => database.close()),
            Promise.resolve().then(() => transferDatabase.close()),
          ]);
          const errors = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1)
            throw new AggregateError(errors, "API_DATABASE_CLEANUP_FAILED");
        })();
      }
      return closing;
    },
  };
}
