import { afterAll, beforeAll, expect, it } from "vitest";
import { createMemoryTransferRepository } from "@product/credential-transfer";
import type { ExtensionAuthRepository } from "@product/extension-auth";
import {
  prepareRecipientRelayRuntime,
  proveRecipientRelayRecovery,
} from "../../../tests/integration/server/helpers/credential-transfer-recipient-relay.js";

// Source composition only: explicit memory repository and synthetic browser.
let fixture:
  | Awaited<ReturnType<typeof prepareRecipientRelayRuntime>>
  | undefined;
beforeAll(async () => {
  fixture = await prepareRecipientRelayRuntime();
}, 20_000);
afterAll(() => fixture?.dispose());
it("preserves imported P1 across relay loss and P2, then retires only an authenticated terminal request", async () => {
  const uuid = (n: number) =>
    `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const recipient = {
    accountId: uuid(1),
    deviceId: uuid(2),
    sessionId: uuid(3),
  };
  const source = { accountId: uuid(1), deviceId: uuid(4), sessionId: uuid(5) };
  const foreign = { accountId: uuid(6), deviceId: uuid(7), sessionId: uuid(8) };
  const identities = new Map(
    [recipient, source, foreign].map((value) => [value.sessionId, value]),
  );
  const unused = async () => {
    throw new Error("unused fixture method");
  };
  const authRepository: ExtensionAuthRepository = {
    authorize: async (id) => identities.get(id),
    consumeRefreshRate: unused,
    authorizeFromRefreshHash: unused,
    createRefresh: unused,
    rotateRefresh: unused,
  };
  const repository = createMemoryTransferRepository();
  const result = await proveRecipientRelayRecovery(fixture!, {
    recipient,
    source,
    foreign,
    authRepository,
    nextRepository: async () => ({ repository }),
  });
  expect(result.verdict).toBe("IMPORTED_P1_PRESERVED_TERMINAL_EXPIRED");
}, 20_000);
