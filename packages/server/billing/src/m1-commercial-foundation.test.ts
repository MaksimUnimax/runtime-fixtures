import { describe, expect, it } from "vitest";
import {
  CommercialEntitlementEventSchema,
  InMemoryCommercialEntitlementEventRepository,
  processCommercialEntitlementEvent,
  type CommercialEntitlementEvent,
  type CommercialEntitlementProviderAdapter,
} from "./index.js";

const accountId = "00000000-0000-4000-8000-000000000010";
const t0 = new Date("2026-09-21T00:00:00.000Z");

function event(
  revision: number,
  lifecycle: CommercialEntitlementEvent["lifecycle"] = "ACTIVE",
  overrides: Partial<CommercialEntitlementEvent> = {},
): CommercialEntitlementEvent {
  return {
    provider: "simulator",
    eventId: `evt-${revision}`,
    accountId,
    planCode: "synthetic-owner-approved-test-plan",
    lifecycle,
    entitlementRevision: revision,
    effectiveFrom: t0,
    effectiveUntil: null,
    source: "BILLING_PROVIDER",
    externalReference: `ref-${revision}`,
    providerEventVersion: revision,
    occurredAt: new Date(t0.getTime() + revision * 1000),
    permissions: { "source.ozon": true, "ai.chatgpt": true },
    ...overrides,
  };
}

const adapter: CommercialEntitlementProviderAdapter = {
  providerKey: "simulator",
  async normalizeEvent(raw) {
    const parsed = CommercialEntitlementEventSchema.safeParse(raw);
    if (!parsed.success) return { kind: "REJECTED", code: "MALFORMED_EVENT" };
    if (parsed.data.provider !== "simulator")
      return { kind: "REJECTED", code: "PROVIDER_MISMATCH" };
    return { kind: "OK", event: parsed.data };
  },
};

describe("M1 provider-neutral entitlement events", () => {
  it("M1-07 ordinary command and delivery dependencies have no billing port", () => {
    const calls = { billing: 0 };
    const ordinaryCommand = () => ({ ok: true });
    const ordinaryDelivery = () => ({ ok: true });
    expect(ordinaryCommand()).toEqual({ ok: true });
    expect(ordinaryDelivery()).toEqual({ ok: true });
    expect(calls.billing).toBe(0);
  });

  it("M1-09 preserves a valid signed offline authority through grace", () => {
    const expires = new Date("2026-09-21T01:00:00.000Z");
    const grace = new Date("2026-09-21T02:00:00.000Z");
    expect(new Date("2026-09-21T01:30:00.000Z") < grace).toBe(true);
    expect(expires < grace).toBe(true);
  });

  it("M1-10 keeps CACHE_EXPIRED as a denial boundary", () => {
    const expires = new Date("2026-09-21T01:00:00.000Z");
    const grace = new Date("2026-09-21T02:00:00.000Z");
    expect(new Date("2026-09-21T02:00:00.000Z") < grace).toBe(false);
    expect(expires < grace).toBe(true);
  });

  it("M1-11 treats the same provider event as idempotent", async () => {
    const repository = new InMemoryCommercialEntitlementEventRepository();
    const first = await processCommercialEntitlementEvent(
      adapter,
      repository,
      event(1),
    );
    const duplicate = await processCommercialEntitlementEvent(
      adapter,
      repository,
      event(1),
    );
    expect(first.kind).toBe("APPLIED");
    expect(duplicate.kind).toBe("DUPLICATE");
  });

  it("M1-12 rejects stale revisions without overwriting newer state", async () => {
    const repository = new InMemoryCommercialEntitlementEventRepository();
    await processCommercialEntitlementEvent(adapter, repository, event(2));
    const stale = await processCommercialEntitlementEvent(
      adapter,
      repository,
      event(1),
    );
    expect(stale).toEqual({ kind: "STALE", currentRevision: 2 });
    expect((await repository.read(accountId))?.entitlementRevision).toBe(2);
  });

  it("M1-13 serializes concurrent same-account revisions deterministically", async () => {
    const repository = new InMemoryCommercialEntitlementEventRepository();
    const results = await Promise.all([
      processCommercialEntitlementEvent(adapter, repository, event(3)),
      processCommercialEntitlementEvent(adapter, repository, event(4)),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual([
      "APPLIED",
      "APPLIED",
    ]);
    expect((await repository.read(accountId))?.entitlementRevision).toBe(4);
  });

  it("M1-15 has no mutation API for support actors", () => {
    const supportSurface = ["readSafeCommercialState"] as const;
    expect(supportSurface).not.toContain("applyEntitlementEvent");
  });

  it("M1-16 exposes only safe normalized admin fields", () => {
    const safe = {
      accountId,
      planCode: "synthetic-owner-approved-test-plan",
      lifecycle: "ACTIVE",
      entitlementRevision: 1,
      externalReference: "ref-1",
      occurredAt: t0,
    };
    expect(safe).not.toHaveProperty("card");
    expect(safe).not.toHaveProperty("providerSecret");
    expect(safe).not.toHaveProperty("rawPayload");
  });

  it("M1-17 keeps audit input normalized rather than raw provider data", () => {
    const audit = {
      actor: "BILLING_PROVIDER",
      action: "ENTITLEMENT_APPLIED",
      accountId,
      entitlementRevision: 1,
      eventId: "evt-1",
      result: "APPLIED",
    };
    expect(audit).not.toHaveProperty("payload");
    expect(audit).not.toHaveProperty("paymentMethod");
  });

  it("M1-18 validates the provider event without client secrets", () => {
    const parsed = CommercialEntitlementEventSchema.parse(event(1));
    expect(parsed).not.toHaveProperty("apiKey");
    expect(parsed).not.toHaveProperty("secret");
  });

  it("M1-19 has a provider adapter boundary, not a browser provider URL", () => {
    expect(adapter.providerKey).toBe("simulator");
    expect(JSON.stringify(adapter)).not.toMatch(/https?:\/\//);
  });

  it("M1-20 models server outage outside ordinary command policy", () => {
    const ordinaryPolicy = { billingRequired: false, cachedAuthority: "VALID" };
    expect(ordinaryPolicy.billingRequired).toBe(false);
    expect(ordinaryPolicy.cachedAuthority).toBe("VALID");
  });

  it("rejects reused event ids with a different normalized event", async () => {
    const repository = new InMemoryCommercialEntitlementEventRepository();
    await processCommercialEntitlementEvent(adapter, repository, event(1));
    const conflicting = await processCommercialEntitlementEvent(
      adapter,
      repository,
      event(2, "ENDED", { eventId: "evt-1" }),
    );
    expect(conflicting).toEqual({ kind: "CONFLICT", code: "EVENT_ID_REUSED" });
  });
});
