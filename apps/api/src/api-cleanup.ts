/** Coalesce startup and signal cleanup; never retry an unknown close outcome. */
export function createApiCleanup(
  stopAdmission: () => void,
  closeApplication: () => Promise<unknown>,
  closeDatabase: () => Promise<unknown>,
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    if (closing) return closing;
    stopAdmission();
    closing = (async () => {
      const errors: unknown[] = [];
      try {
        await closeApplication();
      } catch (error) {
        errors.push(error);
      }
      try {
        await closeDatabase();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, "API_RESOURCE_CLEANUP_FAILED");
    })();
    return closing;
  };
}
