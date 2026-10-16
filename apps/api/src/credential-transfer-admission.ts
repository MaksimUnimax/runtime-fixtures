import {
  assertCredentialTransferFenceRuntime,
  type CredentialTransferEpochFence,
  type DatabaseQuery,
} from "@product/db";

/** API startup is one-shot; stopping cannot revive a pending DB admission. */
export function createCredentialTransferApiAdmission(
  database: DatabaseQuery,
  fence: CredentialTransferEpochFence,
) {
  let attempted = false;
  let stopped = false;
  let started = false;
  return {
    async start(): Promise<void> {
      if (stopped || attempted)
        throw new Error("TRANSFER_API_ADMISSION_NOT_RESTARTABLE");
      attempted = true;
      try {
        await assertCredentialTransferFenceRuntime(database);
        if (stopped) throw new Error("TRANSFER_API_ADMISSION_STOPPED");
        await fence.claim();
        if (stopped || !fence.isActive())
          throw new Error("TRANSFER_API_ADMISSION_STOPPED");
        started = true;
      } catch (error) {
        stopped = true;
        fence.deactivate();
        throw error;
      }
    },
    stop(): void {
      stopped = true;
      started = false;
      fence.deactivate();
    },
    isReady(): boolean {
      return started && !stopped && fence.isActive();
    },
  };
}
