import { expect, test, type Page, type Request } from "@playwright/test";
import {
  AdminMeResponseV1Schema,
  AdminPrincipalsResponseV1Schema,
  AdminSessionResponseV1Schema,
  AdminUsersResponseV1Schema,
  ApiErrorEnvelopeV1Schema,
  OtpRequestBodyV1Schema,
  OtpRequestResponseV1Schema,
  OtpVerifyBodyV1Schema,
  OtpVerifyResponseV1Schema,
} from "../../../packages/contracts/src/index";

// The real LoginPage and AdminProvider run against explicitly synthetic HTTP
// responses. These tests inspect pending UI and obsolete request continuations;
// they do not establish real OTP, cookies, RBAC, DB, package or installed status.
// An already sent request can have server/cookie effects even after navigation.
// The expected isolation is: no follow-up elevation, refresh, redirect or global
// notice from the obsolete LoginPage. No shared auth fixture or DB reset is used.
const adminOrigin = `http://127.0.0.1:${process.env.E2E_ADMIN_PORT ?? "3300"}`;
const firstEmail = "b14-login-first@example.test";
const secondEmail = "b14-login-second@example.test";
const code = "424242";
const requestPath = "/v1/auth/otp/request";
const verifyPath = "/v1/auth/otp/verify";
const sessionPath = "/v1/admin/session";
const mePath = "/v1/admin/me";
const portalCsrf = "synthetic-b14-login-portal-csrf";
const adminCsrf = "synthetic-b14-login-admin-csrf";
const firstActor = AdminMeResponseV1Schema.parse({
  status: "authenticated",
  principalId: "00000000-0000-4000-8000-000000000071",
  roles: ["ADMIN_OWNER"],
  permissions: ["admin.principal.read", "user.read"],
  expiresAt: "2099-01-01T00:00:00.000Z",
});
const secondActor = AdminMeResponseV1Schema.parse({
  status: "authenticated",
  principalId: "00000000-0000-4000-8000-000000000072",
  roles: ["ADMIN_SUPPORT"],
  permissions: ["user.read"],
  expiresAt: "2099-01-02T00:00:00.000Z",
});
type Actor = typeof firstActor;
type Failure = "SERVICE_UNAVAILABLE" | "AUTH_OTP_INVALID";
type Write = {
  path: string;
  method: string;
  body: unknown;
  csrf: string | undefined;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function responseGate() {
  return {
    seen: deferred(),
    release: deferred(),
    settled: deferred(),
    request: null as Request | null,
    delivery: "WAITING" as "WAITING" | "DELIVERED" | "CANCELED" | "FAILED",
  };
}

function failure(code: Failure | "ADMIN_UNAUTHORIZED") {
  return ApiErrorEnvelopeV1Schema.parse({
    error: {
      code,
      message: "Synthetic B14 login response",
      correlationId: "synthetic-b14-login",
    },
  });
}

async function paintDeliveredResponse(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function syntheticLoginApi(page: Page, initiallySignedIn = false) {
  const writes: Write[] = [];
  const reads: string[] = [];
  const unexpected: string[] = [];
  const held = new Map<
    string,
    { gate: ReturnType<typeof responseGate>; error?: Failure }[]
  >();
  const challenges = new Map<string, Actor>();
  let challengeSequence = 0;
  let unavailableMeReads = 0;
  let currentActor: Actor | null = initiallySignedIn ? firstActor : null;
  let verifiedActor = firstActor;
  await page.context().addCookies([
    { name: "pcp_csrf", value: portalCsrf, url: adminOrigin },
    { name: "pcp_admin_csrf", value: adminCsrf, url: adminOrigin },
  ]);
  await page.route("**/api/control-plane/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split(
      "/api/control-plane",
    )[1]!;
    const method = request.method();
    if (method === "GET") {
      reads.push(path);
      if (path === mePath) {
        if (unavailableMeReads > 0) {
          unavailableMeReads -= 1;
          await route.fulfill({
            status: 503,
            json: failure("SERVICE_UNAVAILABLE"),
          });
          return;
        }
        await route.fulfill(
          currentActor
            ? { json: AdminMeResponseV1Schema.parse(currentActor) }
            : { status: 401, json: failure("ADMIN_UNAUTHORIZED") },
        );
        return;
      }
      if (path === "/v1/admin/principals") {
        await route.fulfill({
          json: AdminPrincipalsResponseV1Schema.parse({
            items: [],
            nextCursor: null,
          }),
        });
        return;
      }
      if (path === "/v1/admin/users") {
        await route.fulfill({
          json: AdminUsersResponseV1Schema.parse({
            items: [],
            nextCursor: null,
          }),
        });
        return;
      }
    }
    if (method === "POST" || method === "DELETE") {
      const rawBody: unknown = request.postData()
        ? request.postDataJSON()
        : null;
      writes.push({
        path,
        method,
        body: rawBody,
        csrf: request.headers()["x-csrf-token"],
      });
      if (method === "DELETE" && path === sessionPath) {
        currentActor = null;
        await route.fulfill({ status: 204 });
        return;
      }
      const pending = held.get(path)?.shift();
      let status = 200;
      let response: unknown;
      if (method === "POST" && path === requestPath) {
        const body = OtpRequestBodyV1Schema.parse(rawBody);
        const actor = body.email === secondEmail ? secondActor : firstActor;
        challengeSequence += 1;
        const challengeId = `00000000-0000-4000-8000-${String(challengeSequence).padStart(12, "0")}`;
        challenges.set(challengeId, actor);
        status = 202;
        response = OtpRequestResponseV1Schema.parse({
          status: "accepted",
          challengeId,
          expiresAt: "2099-01-01T00:00:00.000Z",
        });
      } else if (method === "POST" && path === verifyPath) {
        const body = OtpVerifyBodyV1Schema.parse(rawBody);
        const actor = challenges.get(body.challengeId);
        if (!actor || body.code !== code) {
          unexpected.push(`unrecognized synthetic OTP ${body.challengeId}`);
          await route.fulfill({
            status: 401,
            json: failure("AUTH_OTP_INVALID"),
          });
          return;
        }
        // Record the synthetic server-side outcome at request arrival, not by
        // replacing its actor later when the delayed response is delivered.
        if (!pending?.error) verifiedActor = actor;
        response = OtpVerifyResponseV1Schema.parse({
          status: "authenticated",
          expiresAt: actor.expiresAt,
        });
      } else if (method === "POST" && path === sessionPath) {
        if (!pending?.error) currentActor = verifiedActor;
        response = AdminSessionResponseV1Schema.parse({
          status: "authenticated",
          expiresAt: verifiedActor.expiresAt,
        });
      } else {
        unexpected.push(`${method} ${path}`);
        await route.fulfill({
          status: 503,
          json: failure("SERVICE_UNAVAILABLE"),
        });
        return;
      }
      if (pending) {
        pending.gate.request = request;
        pending.gate.seen.resolve();
      }
      await pending?.gate.release.promise;
      try {
        await route.fulfill(
          pending?.error
            ? {
                status: pending.error === "SERVICE_UNAVAILABLE" ? 503 : 401,
                json: failure(pending.error),
              }
            : { status, json: response },
        );
        if (pending) pending.gate.delivery = "DELIVERED";
      } catch (error) {
        // Tolerate cancellation only for cleanup after a failed/closed test.
        // Every late-response case below separately requires delivery and a
        // completed browser Response; a canceled request cannot prove it.
        if (pending)
          pending.gate.delivery =
            page.isClosed() || request.failure() ? "CANCELED" : "FAILED";
        if (!page.isClosed() && !request.failure()) throw error;
      } finally {
        pending?.gate.settled.resolve();
      }
      return;
    }
    unexpected.push(`${method} ${path}`);
    await route.fulfill({
      status: 503,
      json: failure("SERVICE_UNAVAILABLE"),
    });
  });
  return {
    writes,
    reads,
    unexpected,
    failNextMeRead() {
      unavailableMeReads += 1;
    },
    holdNext(path: string, error?: Failure) {
      const gate = responseGate();
      const queue = held.get(path) ?? [];
      queue.push({ gate, error });
      held.set(path, queue);
      return gate;
    },
  };
}

async function openLogin(page: Page) {
  await page.goto(`${adminOrigin}/login`);
  await expect(
    page.getByRole("heading", { name: "Admin sign-in", exact: true }),
  ).toBeVisible();
}

async function requestCode(page: Page, email = firstEmail) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByRole("button", { name: "Start OTP sign-in", exact: true })
    .click();
  await expect(page.getByLabel("One-time code", { exact: true })).toBeVisible();
}

async function verifyCode(page: Page) {
  await page.getByLabel("One-time code", { exact: true }).fill(code);
  await page
    .getByRole("button", { name: "Verify and elevate", exact: true })
    .click();
}

async function expectActor(page: Page, actor: Actor) {
  await expect(
    page.getByRole("heading", { name: "Session overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(actor.principalId, { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".topbar").getByText(actor.roles.join(", "), { exact: true }),
  ).toBeVisible();
}

async function loginFromSignedInHistory(page: Page) {
  await page.goto(`${adminOrigin}/principals`);
  await expect(
    page.getByRole("heading", { name: "Admin principals", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "End admin session", exact: true })
    .click();
  await expect(page).toHaveURL(`${adminOrigin}/login`);
  await expect(
    page.getByRole("heading", { name: "Admin sign-in", exact: true }),
  ).toBeVisible();
}

async function replaceLoginThroughNormalHistory(page: Page) {
  // Back returns to the previously visited real principals route. It mounts
  // that route's LoginPage because the admin session has already ended.
  // No history injection, React handle or synthetic route is used.
  const documentTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  const oldHeading = await page
    .getByRole("heading", { name: "Admin sign-in", exact: true })
    .elementHandle();
  const oldForm = await page.locator("form").elementHandle();
  if (!oldHeading || !oldForm)
    throw new Error("Original LoginPage DOM must exist before navigation");
  await page.goBack();
  await expect(page).toHaveURL(`${adminOrigin}/principals`);
  // Establish the same document first. A full navigation would terminate the
  // old JavaScript context and could falsely look like a fenced continuation.
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(
    documentTimeOrigin,
  );
  await expect
    .poll(() => oldHeading.evaluate((node) => node.isConnected))
    .toBe(false);
  await expect
    .poll(() => oldForm.evaluate((node) => node.isConnected))
    .toBe(false);
  await oldHeading.dispose();
  await oldForm.dispose();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeEnabled();
  await requestCode(page, secondEmail);
  await verifyCode(page);
  await expectActor(page, secondActor);
  await page.getByRole("link", { name: "Users", exact: true }).click();
  await expect(page).toHaveURL(`${adminOrigin}/users`);
  await expect(
    page.getByRole("heading", { name: "User lookup", exact: true }),
  ).toBeVisible();
}

test("B14-05 synthetic OTP request locks the submitted email and alternative entry", async ({
  page,
}) => {
  const api = await syntheticLoginApi(page);
  const pending = api.holdNext(requestPath);
  await openLogin(page);
  await page.getByLabel("Email", { exact: true }).fill(firstEmail);
  try {
    await page
      .getByRole("button", { name: "Start OTP sign-in", exact: true })
      .click();
    await pending.seen.promise;
    await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Sending…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: "Continue with current sign-in",
        exact: true,
      }),
    ).toBeDisabled();
    expect(api.writes).toEqual([
      {
        path: requestPath,
        method: "POST",
        body: { email: firstEmail },
        csrf: undefined,
      },
    ]);
    pending.release.resolve();
    await pending.settled.promise;
    await expect(
      page.getByLabel("One-time code", { exact: true }),
    ).toBeEnabled();
    await verifyCode(page);
    await expectActor(page, firstActor);
    expect(api.writes.map(({ path }) => path)).toEqual([
      requestPath,
      verifyPath,
      sessionPath,
    ]);
    expect(api.unexpected).toEqual([]);
  } finally {
    pending.release.resolve();
  }
});

for (const heldPath of [verifyPath, sessionPath] as const) {
  test(`B14-05 synthetic pending ${heldPath} cannot change OTP identity or pretend cancellation`, async ({
    page,
  }) => {
    const api = await syntheticLoginApi(page);
    const pending = api.holdNext(heldPath);
    await openLogin(page);
    await requestCode(page);
    try {
      await verifyCode(page);
      await pending.seen.promise;
      await expect(
        page.getByLabel("One-time code", { exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Use another email", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("button", { name: "Verifying…", exact: true }),
      ).toBeDisabled();
      expect(api.writes.filter(({ path }) => path === verifyPath)).toHaveLength(
        1,
      );
      expect(
        api.writes.filter(({ path }) => path === sessionPath),
      ).toHaveLength(heldPath === sessionPath ? 1 : 0);
      pending.release.resolve();
      await pending.settled.promise;
      await expectActor(page, firstActor);
      expect(api.writes.map(({ path }) => path)).toEqual([
        requestPath,
        verifyPath,
        sessionPath,
      ]);
      expect(api.writes.at(-1)?.csrf).toBe(portalCsrf);
      expect(api.unexpected).toEqual([]);
    } finally {
      pending.release.resolve();
    }
  });
}

test("B14-05 synthetic current-sign-in elevation locks email and OTP entry", async ({
  page,
}) => {
  const api = await syntheticLoginApi(page);
  const pending = api.holdNext(sessionPath);
  await openLogin(page);
  try {
    await page
      .getByRole("button", {
        name: "Continue with current sign-in",
        exact: true,
      })
      .click();
    await pending.seen.promise;
    await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Sending…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: "Continue with current sign-in",
        exact: true,
      }),
    ).toBeDisabled();
    pending.release.resolve();
    await pending.settled.promise;
    await expectActor(page, firstActor);
    expect(api.writes).toEqual([
      {
        path: sessionPath,
        method: "POST",
        body: null,
        csrf: portalCsrf,
      },
    ]);
    expect(api.unexpected).toEqual([]);
  } finally {
    pending.release.resolve();
  }
});

test("B14-05 synthetic a new successful sign-in does not retain the previous failed sign-in notice", async ({
  page,
}) => {
  const api = await syntheticLoginApi(page);
  const pending = api.holdNext(requestPath, "SERVICE_UNAVAILABLE");
  await openLogin(page);
  try {
    await page.getByLabel("Email", { exact: true }).fill(firstEmail);
    await page
      .getByRole("button", { name: "Start OTP sign-in", exact: true })
      .click();
    await pending.seen.promise;
    pending.release.resolve();
    await pending.settled.promise;
    await expect(page.getByRole("status")).toHaveText(
      "The control plane is temporarily unavailable.",
    );
    await requestCode(page);
    await verifyCode(page);
    await expectActor(page, firstActor);
    await expect(page.locator(".content .notice.error")).toHaveCount(0);
    expect(api.writes.map(({ path }) => path)).toEqual([
      requestPath,
      requestPath,
      verifyPath,
      sessionPath,
    ]);
    expect(api.unexpected).toEqual([]);
  } finally {
    pending.release.resolve();
  }
});

for (const entry of ["otp", "current-session"] as const) {
  test(`B14-05 synthetic ${entry} elevation followed by unavailable session read offers a read-only recovery`, async ({
    page,
  }) => {
    const api = await syntheticLoginApi(page);
    await openLogin(page);
    if (entry === "otp") await requestCode(page);
    api.failNextMeRead();
    if (entry === "otp") await verifyCode(page);
    else
      await page
        .getByRole("button", {
          name: "Continue with current sign-in",
          exact: true,
        })
        .click();
    await expect(page.getByRole("status")).toHaveText(
      "The elevation request succeeded, but the admin session could not be confirmed. Check the session again before continuing.",
    );
    await expect(
      page.getByRole("button", { name: "Verify and elevate", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Start OTP sign-in", exact: true }),
    ).toHaveCount(0);
    expect(api.writes.map(({ path }) => path)).toEqual(
      entry === "otp" ? [requestPath, verifyPath, sessionPath] : [sessionPath],
    );
    const writesBefore = [...api.writes];
    const meReadsBefore = api.reads.filter((path) => path === mePath).length;
    await page
      .getByRole("button", { name: "Check admin session", exact: true })
      .click();
    await expectActor(page, firstActor);
    expect(api.writes).toEqual(writesBefore);
    expect(api.reads.filter((path) => path === mePath).length).toBeGreaterThan(
      meReadsBefore,
    );
    expect(api.unexpected).toEqual([]);
  });
}

const obsoleteCases = [
  {
    title: "old OTP request failure cannot contaminate a newer actor",
    path: requestPath,
    error: "SERVICE_UNAVAILABLE",
  },
  {
    title: "old OTP verify success cannot initiate elevation after unmount",
    path: verifyPath,
    error: undefined,
  },
  {
    title: "old OTP verify failure cannot contaminate a newer actor",
    path: verifyPath,
    error: "AUTH_OTP_INVALID",
  },
  {
    title: "old elevation success cannot refresh or redirect a newer actor",
    path: sessionPath,
    error: undefined,
  },
] as const;

for (const entry of obsoleteCases) {
  test(`B14-05 synthetic ${entry.title}`, async ({ page }) => {
    const api = await syntheticLoginApi(page, true);
    await loginFromSignedInHistory(page);
    const pending = api.holdNext(entry.path, entry.error);
    try {
      if (entry.path === requestPath) {
        await page.getByLabel("Email", { exact: true }).fill(firstEmail);
        await page
          .getByRole("button", { name: "Start OTP sign-in", exact: true })
          .click();
      } else if (entry.path === verifyPath) {
        await requestCode(page);
        await verifyCode(page);
      } else {
        await page
          .getByRole("button", {
            name: "Continue with current sign-in",
            exact: true,
          })
          .click();
      }
      await pending.seen.promise;
      await replaceLoginThroughNormalHistory(page);
      const writesBefore = [...api.writes];
      const meReadsBefore = api.reads.filter((path) => path === mePath).length;
      const requests = api.writes.filter(({ path }) => path === requestPath);
      expect(requests.at(-1)?.body).toEqual({ email: secondEmail });
      await expect(page.locator(".content .notice.error")).toHaveCount(0);
      const oldRequest = pending.request;
      if (!oldRequest) throw new Error("Held request was not captured");
      expect(oldRequest.method()).toBe("POST");
      expect(new URL(oldRequest.url()).pathname).toBe(
        `/api/control-plane${entry.path}`,
      );
      // Register before release and bind to this Request object, not another
      // POST to the same URL from the successful replacement login.
      const delivered = page
        .waitForResponse((response) => response.request() === oldRequest)
        // Consume a close/timeout rejection if an earlier assertion fails;
        // null is never accepted as evidence of a delivered response below.
        .catch(() => null);
      pending.release.resolve();
      await pending.settled.promise;
      expect(pending.delivery).toBe("DELIVERED");
      const response = await delivered;
      if (!response) throw new Error("Held response was not delivered");
      expect(response.status()).toBe(
        entry.error === "SERVICE_UNAVAILABLE"
          ? 503
          : entry.error === "AUTH_OTP_INVALID"
            ? 401
            : 200,
      );
      expect(await response.finished()).toBeNull();
      expect(oldRequest.failure()).toBeNull();
      await paintDeliveredResponse(page);
      await expect(page).toHaveURL(`${adminOrigin}/users`);
      await expect(
        page.getByRole("heading", { name: "User lookup", exact: true }),
      ).toBeVisible();
      await expect(
        page.locator(".topbar").getByText("ADMIN_SUPPORT", { exact: true }),
      ).toBeVisible();
      await expect(page.locator(".content .notice.error")).toHaveCount(0);
      expect(api.writes).toEqual(writesBefore);
      expect(api.reads.filter((path) => path === mePath)).toHaveLength(
        meReadsBefore,
      );
      expect(api.unexpected).toEqual([]);
    } finally {
      pending.release.resolve();
    }
  });
}
