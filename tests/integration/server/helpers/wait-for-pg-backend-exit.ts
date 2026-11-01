export type PgBackendIdentity = Readonly<{ pid: number; startedAt: string }>;

/** Test observation only. Never terminates a backend or authorizes a retry. */
export async function waitForPgBackendExit(
  readPresence: (backend: PgBackendIdentity) => Promise<boolean>,
  identity: PgBackendIdentity,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const { timeoutMs = 2_000, pollMs = 20 } = options;
  if (
    !Number.isSafeInteger(identity.pid) ||
    identity.pid <= 0 ||
    typeof identity.startedAt !== "string" ||
    !identity.startedAt ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(pollMs) ||
    pollMs <= 0
  )
    throw new Error("INVALID_BACKEND_WAIT");
  const backend = Object.freeze({ ...identity });
  const deadline = performance.now() + timeoutMs;
  const timeout = () => new Error("PG_BACKEND_EXIT_UNCONFIRMED");
  for (;;) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw timeout();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // A stalled read also fails within the same overall observation budget.
      // Only one read is outstanding; no further reads are issued on timeout.
      const present = await Promise.race([
        readPresence(backend),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(timeout()), remaining);
        }),
      ]);
      if (performance.now() >= deadline) throw timeout();
      if (typeof present !== "boolean")
        throw new Error("INVALID_BACKEND_OBSERVATION");
      if (!present) return;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const next = deadline - performance.now();
    if (next <= 0) throw timeout();
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, next)));
  }
}
