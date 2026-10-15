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
    application = new URL(applicationUrl);
    transfer = new URL(transferUrl);
    const postgres = (url: URL) =>
      url.protocol === "postgres:" || url.protocol === "postgresql:";
    if (!postgres(application) || !postgres(transfer)) throw new Error();
    if (!application.username || !transfer.username) throw new Error();
    if (
      application.hostname !== transfer.hostname ||
      (application.port || "5432") !== (transfer.port || "5432") ||
      decodeURIComponent(application.pathname) !==
        decodeURIComponent(transfer.pathname)
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
  const database = createRuntime(applicationUrl);
  let transferDatabase: T;
  try {
    transferDatabase = createRuntime(transferUrl);
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
