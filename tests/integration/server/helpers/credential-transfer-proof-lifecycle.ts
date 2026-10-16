/** Finite lifecycle helpers for owned disposable proof fixtures; no I/O. */
export async function waitForProofEntry(
  entered: Promise<void>,
  pending: Promise<unknown>,
): Promise<void> {
  await Promise.race([
    entered,
    pending.then(() => {
      throw new Error("PROOF_OPERATION_SETTLED_BEFORE_ENTRY");
    }),
  ]);
}

export async function attemptProofCleanup(
  steps: ReadonlyArray<() => unknown>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

export function combineProofFailures(
  primary: unknown,
  cleanup: readonly unknown[],
  message: string,
): unknown {
  if (cleanup.length === 0) return primary;
  const errors = [
    ...new Set([...(primary === undefined ? [] : [primary]), ...cleanup]),
  ];
  return new AggregateError(errors, message, { cause: primary });
}

export async function reconcileReservedProofResource(input: {
  previouslyAbsent: boolean;
  creationAttempted: boolean;
  inspect(): Promise<"absent" | "owned" | "foreign">;
  removeOwned(): Promise<void>;
}): Promise<boolean> {
  if (!input.creationAttempted) return true;
  if (!input.previouslyAbsent)
    throw new Error("PROOF_RESOURCE_NOT_RESERVED_ABSENT");
  const state = await input.inspect();
  if (state === "absent") return true;
  if (state !== "owned") throw new Error("PROOF_RESOURCE_OWNERSHIP_MISMATCH");
  let absent = false;
  const errors = await attemptProofCleanup([
    () => input.removeOwned(),
    async () => {
      absent = (await input.inspect()) === "absent";
    },
  ]);
  if (errors.length)
    throw combineProofFailures(
      undefined,
      errors,
      "PROOF_RESOURCE_CLEANUP_FAILED",
    );
  return absent;
}
