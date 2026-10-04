import { describe, expect, it, vi } from "vitest";
import {
  MaintenanceAccessService,
  MAINTENANCE_LEASE_MS,
  maintenanceTokenHash,
} from "./maintenance-access.js";
import type {
  MaintenanceGrant,
  MaintenanceRepository,
} from "./maintenance-access.js";
import { permissionsForRoles, type AdminSubject } from "./index.js";

const start = new Date("2030-01-01T00:00:00Z");
const owner = (): AdminSubject => ({
  adminPrincipalId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  adminSessionId: "00000000-0000-4000-8000-000000000003",
  roles: ["ADMIN_OWNER"],
  permissions: permissionsForRoles(["ADMIN_OWNER"]),
  expiresAt: new Date(start.getTime() + 30 * 60_000),
});
function fixture() {
  let now = start;
  let grant: MaintenanceGrant | null = null;
  let hash = "";
  let active = true;
  let previous: { hash: string; nonce: string; until: Date } | undefined;
  const repository: MaintenanceRepository = {
    issue: vi.fn(async (input) => {
      if (!active) return null;
      hash = input.tokenHash;
      grant = {
        id: input.id,
        label: input.label,
        adminPrincipalId: input.issuer.adminPrincipalId,
        userId: input.issuer.userId,
        sourceAdminSessionId: input.issuer.adminSessionId,
        permissions: input.permissions,
        createdAt: input.now,
        expiresAt: input.expiresAt,
        revokedAt: null,
      };
      return grant;
    }),
    authenticate: vi.fn(async (id, tokenHash, when) =>
      active &&
      grant !== null &&
      grant.id === id &&
      tokenHash === hash &&
      !grant.revokedAt &&
      grant.expiresAt > when
        ? grant
        : null,
    ),
    rotate: vi.fn(async (input) => {
      if (!active || !grant || grant.revokedAt || grant.expiresAt <= input.now)
        return null;
      if (
        previous !== undefined &&
        input.tokenHash === previous.hash &&
        input.nonceHash === previous.nonce &&
        previous.until > input.now &&
        input.replacementHash === hash
      )
        return { expiresAt: grant.expiresAt };
      if (input.tokenHash !== hash) return null;
      previous = { hash, nonce: input.nonceHash, until: input.replayUntil };
      hash = input.replacementHash;
      grant.expiresAt = input.expiresAt;
      return { expiresAt: grant.expiresAt };
    }),
    list: vi.fn(async () => (grant ? [grant] : [])),
    revoke: vi.fn(async (_issuer, id, when) => {
      if (!grant || grant.id !== id) return false;
      grant.revokedAt = when;
      return true;
    }),
  };
  return {
    service: new MaintenanceAccessService(repository, () => now),
    repository,
    advance: (ms: number) => {
      now = new Date(start.getTime() + ms);
    },
    suspend: () => {
      active = false;
    },
  };
}
async function issued(f: ReturnType<typeof fixture>) {
  const result = await f.service.issue(
    owner(),
    "Controller",
    ["compatibility.read", "compatibility.manage"],
    "test-issue",
  );
  if (!result.ok) throw new Error("fixture issue failed");
  return result.value;
}
describe("delegated maintenance access", () => {
  it("requires a current human owner and rejects expired elevation or delegated credentials", async () => {
    for (const subject of [
      { ...owner(), roles: [] },
      { ...owner(), permissions: [] },
      { ...owner(), expiresAt: start },
      { ...owner(), maintenanceGrantId: "delegated" },
    ] as AdminSubject[]) {
      const f = fixture();
      expect(
        (await f.service.issue(subject, "Controller", ["health.read"], "issue"))
          .ok,
      ).toBe(false);
      expect(f.repository.issue).not.toHaveBeenCalled();
    }
  });
  it("does not allow account, billing, principal administration or unknown permissions", async () => {
    for (const permissions of [
      ["admin.principal.manage"],
      ["account.read"],
      ["billing.read"],
      ["*"],
      [],
      ["health.read", "health.read"],
      ["health.read", "compatibility.manage", "device.revoke"],
    ]) {
      const f = fixture();
      expect(
        (await f.service.issue(owner(), "Controller", permissions, "issue")).ok,
      ).toBe(false);
      expect(f.repository.issue).not.toHaveBeenCalled();
    }
  });
  it("stores only a hash and grants the requested subset without inheriting OWNER", async () => {
    const f = fixture();
    const value = await issued(f);
    const input = vi.mocked(f.repository.issue).mock.calls[0]![0];
    expect(input.tokenHash).toBe(maintenanceTokenHash(value.token));
    expect(JSON.stringify(input)).not.toContain(value.token);
    const result = await f.service.authenticate(value.token);
    expect(result.ok && result.value.roles).toEqual([]);
    expect(result.ok && result.value.permissions).toEqual([
      "compatibility.read",
      "compatibility.manage",
    ]);
    expect(result.ok && result.value.maintenanceGrantId).toBe(value.grant.id);
  });
  it("continues beyond the human 30-minute session and rotates without OTP", async () => {
    const f = fixture();
    const value = await issued(f);
    f.advance(24 * 60 * 60_000);
    expect((await f.service.authenticate(value.token)).ok).toBe(true);
    const rotated = await f.service.rotate(
      value.token,
      "n".repeat(43),
      "rotation",
    );
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(rotated.value.token).not.toBe(value.token);
    expect((await f.service.authenticate(value.token)).ok).toBe(false);
    expect((await f.service.authenticate(rotated.value.token)).ok).toBe(true);
    expect(rotated.value.expiresAt.getTime()).toBe(
      start.getTime() + 24 * 60 * 60_000 + MAINTENANCE_LEASE_MS,
    );
  });
  it("recovers an unknown rotation outcome only with the same nonce within the replay window", async () => {
    const f = fixture();
    const value = await issued(f);
    const first = await f.service.rotate(value.token, "n".repeat(43), "first");
    expect(
      await f.service.rotate(value.token, "n".repeat(43), "retry"),
    ).toEqual(first);
    expect(
      (await f.service.rotate(value.token, "x".repeat(43), "other")).ok,
    ).toBe(false);
    f.advance(2 * 60_000);
    expect(
      (await f.service.rotate(value.token, "n".repeat(43), "late")).ok,
    ).toBe(false);
  });
  it("does not resurrect expired, revoked or issuer-disabled access", async () => {
    const expired = fixture();
    const first = await issued(expired);
    expired.advance(MAINTENANCE_LEASE_MS);
    expect(
      (await expired.service.rotate(first.token, "n".repeat(43), "expired")).ok,
    ).toBe(false);
    const revoked = fixture();
    const second = await issued(revoked);
    expect(
      (await revoked.service.revoke(owner(), second.grant.id, "revoke")).ok,
    ).toBe(true);
    expect((await revoked.service.authenticate(second.token)).ok).toBe(false);
    expect(
      (await revoked.service.rotate(second.token, "n".repeat(43), "revoked"))
        .ok,
    ).toBe(false);
    const disabled = fixture();
    const third = await issued(disabled);
    disabled.suspend();
    expect((await disabled.service.authenticate(third.token)).ok).toBe(false);
    expect(
      (await disabled.service.rotate(third.token, "n".repeat(43), "disabled"))
        .ok,
    ).toBe(false);
  });
  it("fails closed on malformed tokens and storage failures", async () => {
    const f = fixture();
    expect((await f.service.authenticate("not-a-credential")).ok).toBe(false);
    expect(f.repository.authenticate).not.toHaveBeenCalled();
    const value = await issued(f);
    vi.mocked(f.repository.authenticate).mockRejectedValueOnce(
      new Error("database error"),
    );
    expect(await f.service.authenticate(value.token)).toEqual({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
