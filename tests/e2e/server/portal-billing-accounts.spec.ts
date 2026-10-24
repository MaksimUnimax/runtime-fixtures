import { test, expect, type Page } from "@playwright/test";

const accountA = "00000000-0000-4000-8000-000000000001";
const accountB = "00000000-0000-4000-8000-000000000002";
type Failure =
  | "network"
  | "http"
  | "json"
  | "shape"
  | "nestedSubscription"
  | "nullPayment"
  | "arrayAccessBasis"
  | "arrayAccessStatus"
  | "wrongSubscriptionAccount"
  | "badAccessReason"
  | "badSubscriptionContract"
  | "badPriceContract"
  | "badPaymentContract"
  | "badPaymentPlan"
  | "badPaymentWrapper"
  | "badUuidContract"
  | "badCalendarDate"
  | "minuteDateTime";
type Pending = { id: number; accountId: string; path: string; done: boolean };
type Fixture = {
  pending: () => Pending[];
  requests: { path: string; method: string; credentials: string }[];
  settle: (
    ids: number[],
    mark: string,
    failure?: Failure | "unauthorized",
    deferPaymentBody?: boolean,
  ) => void;
  finishBodies: () => void;
};
declare global {
  interface Window {
    __octoportBilling: Fixture;
  }
}
const main = (page: Page) => page.getByRole("main");
const choose = (page: Page) =>
  main(page).getByRole("combobox", { name: "Account" });
const alert = (page: Page) => main(page).locator('p[role="alert"]');

async function install(
  page: Page,
  accountFailure?: Failure | "unauthorized" | "empty",
) {
  await page.addInitScript(
    ({ a, b, initialFailure }) => {
      const nativeFetch = window.fetch.bind(window);
      let serial = 0;
      const pending: (Pending & {
        resolve: (value: Response) => void;
        reject: (reason: Error) => void;
      })[] = [];
      const bodyReleases: (() => void)[] = [];
      const requests: Fixture["requests"] = [];
      const response = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), {
          status,
          headers: { "content-type": "application/json" },
        });
      const subscription = (mark: string, accountId = a) => ({
        accountId,
        accessBasis: "BETA",
        access: { status: "ELIGIBLE", reason: null },
        subscription: {
          id: "00000000-0000-4000-8000-000000000101",
          state: "ACTIVE",
          stateRevision: 1,
          plan: {
            planRevisionId: "00000000-0000-4000-8000-000000000102",
            planCode: "test-plan",
            planRevision: 1,
            displayName: mark,
          },
          price: {
            priceRevisionId: "00000000-0000-4000-8000-000000000103",
            amountMinor: 100,
            currency: "RUB",
            billingInterval: { unit: "MONTH", count: 1 },
          },
          currentPeriodStart: "2026-10-01T00:00:00Z",
          currentPeriodEnd: "2026-11-01T00:00:00Z",
          graceUntil: null,
          cancelAtPeriodEnd: false,
        },
        deviceAllowance: {
          maxActive: null,
          activeCount: 1,
          remaining: null,
          overLimit: false,
        },
        billing: {
          purchaseStatus: "UNAVAILABLE",
          reason: "PAYMENT_GO_LIVE_DEFERRED",
        },
      });
      const payments = () => ({
        payments: [
          {
            id: "00000000-0000-4000-8000-000000000201",
            state: "SUCCEEDED",
            amountMinor: 0,
            currency: "RUB",
            priceRevisionId: "00000000-0000-4000-8000-000000000202",
            plan: {
              planCode: "test-plan",
              planRevision: 1,
              displayName: "Test payment plan",
            },
            billingInterval: { unit: "MONTH", count: 1 },
            createdAt: "2026-10-01T00:00:00Z",
            confirmedAt: null,
            subscriptionLinked: false,
          },
        ],
        nextCursor: null,
      });
      window.__octoportBilling = {
        requests,
        pending: () =>
          pending.map(({ id, accountId, path, done }) => ({
            id,
            accountId,
            path,
            done,
          })),
        settle(ids, mark, failure, deferPaymentBody = false) {
          for (const id of ids) {
            const item = pending.find((entry) => entry.id === id);
            if (!item || item.done)
              throw new Error("Fixture request not pending");
            item.done = true;
            if (failure === "network") {
              item.reject(new TypeError("Synthetic billing network failure"));
              continue;
            }
            if (failure === "http" || failure === "unauthorized") {
              item.resolve(response({}, failure === "http" ? 503 : 401));
              continue;
            }
            if (failure === "json") {
              item.resolve(
                new Response("not-json", {
                  headers: { "content-type": "application/json" },
                }),
              );
              continue;
            }
            const isPayment = item.path === "/v1/billing/payments";
            const goodSubscription = subscription(mark, item.accountId);
            const goodPayments = payments();
            const value =
              failure === "shape"
                ? {}
                : failure === "nestedSubscription" && !isPayment
                  ? { ...goodSubscription, access: {}, deviceAllowance: {} }
                  : failure === "nullPayment" && isPayment
                    ? { ...goodPayments, payments: [null] }
                    : failure === "arrayAccessBasis" && !isPayment
                      ? { ...goodSubscription, accessBasis: ["BETA"] }
                      : failure === "arrayAccessStatus" && !isPayment
                        ? {
                            ...goodSubscription,
                            access: { status: ["ELIGIBLE"], reason: null },
                          }
                        : failure === "wrongSubscriptionAccount" && !isPayment
                          ? subscription(mark, item.accountId === a ? b : a)
                          : failure === "badAccessReason" && !isPayment
                            ? {
                                ...goodSubscription,
                                access: {
                                  status: "ELIGIBLE",
                                  reason: "NOT_A_REASON",
                                },
                              }
                            : failure === "badSubscriptionContract" &&
                                !isPayment
                              ? {
                                  ...goodSubscription,
                                  subscription: {
                                    ...goodSubscription.subscription,
                                    id: "not-a-uuid",
                                    state: "ANY",
                                    stateRevision: 0,
                                    currentPeriodStart: "not-a-date",
                                    cancelAtPeriodEnd: null,
                                  },
                                }
                              : failure === "badPriceContract" && !isPayment
                                ? {
                                    ...goodSubscription,
                                    subscription: {
                                      ...goodSubscription.subscription,
                                      price: {
                                        priceRevisionId: "not-a-uuid",
                                        amountMinor: -1,
                                        currency: "x",
                                        billingInterval: {
                                          unit: "WEEK",
                                          count: 0,
                                        },
                                      },
                                    },
                                  }
                                : failure === "badPaymentContract" && isPayment
                                  ? {
                                      payments: [
                                        {
                                          ...goodPayments.payments[0],
                                          id: "x",
                                          state: "NOT_A_STATE",
                                          amountMinor: -1,
                                          currency: "x",
                                          priceRevisionId: "x",
                                          createdAt: "not-a-date",
                                        },
                                      ],
                                      nextCursor: null,
                                    }
                                  : failure === "badPaymentPlan" && isPayment
                                    ? {
                                        payments: [
                                          {
                                            ...goodPayments.payments[0],
                                            plan: {
                                              planCode: "",
                                              planRevision: 0,
                                              displayName: "bad",
                                            },
                                            billingInterval: {
                                              unit: "WEEK",
                                              count: 0,
                                            },
                                          },
                                        ],
                                        nextCursor: null,
                                      }
                                    : failure === "badPaymentWrapper" &&
                                        isPayment
                                      ? {
                                          payments: goodPayments.payments,
                                          nextCursor: "not-a-uuid",
                                        }
                                      : failure === "badUuidContract" &&
                                          !isPayment
                                        ? {
                                            ...goodSubscription,
                                            subscription: {
                                              ...goodSubscription.subscription,
                                              id: "00000000-0000-0000-0000-000000000001",
                                            },
                                          }
                                        : failure === "badCalendarDate" &&
                                            !isPayment
                                          ? {
                                              ...goodSubscription,
                                              subscription: {
                                                ...goodSubscription.subscription,
                                                currentPeriodStart:
                                                  "2026-02-30T00:00:00Z",
                                              },
                                            }
                                          : failure === "minuteDateTime" &&
                                              !isPayment
                                            ? {
                                                ...goodSubscription,
                                                subscription: {
                                                  ...goodSubscription.subscription,
                                                  currentPeriodStart:
                                                    "2026-10-01T00:00Z",
                                                  currentPeriodEnd:
                                                    "2026-11-01T00:00+05:30",
                                                },
                                              }
                                            : failure === "minuteDateTime" &&
                                                isPayment
                                              ? {
                                                  ...goodPayments,
                                                  payments:
                                                    goodPayments.payments.map(
                                                      (payment) => ({
                                                        ...payment,
                                                        createdAt:
                                                          "2026-10-01T00:00Z",
                                                      }),
                                                    ),
                                                }
                                              : isPayment
                                                ? goodPayments
                                                : goodSubscription;
            const result = response(value);
            if (isPayment && deferPaymentBody) {
              const body = new Promise<unknown>((resolve) => {
                bodyReleases.push(() => resolve(value));
              });
              Object.defineProperty(result, "json", { value: () => body });
            }
            item.resolve(result);
          }
        },
        finishBodies() {
          for (const release of bodyReleases.splice(0)) release();
        },
      };
      window.fetch = (input, init) => {
        const address = input instanceof Request ? input.url : String(input);
        const url = new URL(address, location.href);
        if (!url.pathname.startsWith("/api/control-plane/")) {
          return nativeFetch(input, init);
        }
        const path = url.pathname.slice("/api/control-plane".length);
        requests.push({
          path,
          method: init?.method ?? "GET",
          credentials: init?.credentials ?? "same-origin",
        });
        if (path === "/v1/accounts") {
          // Initial StrictMode requests must not turn the selected failure green.
          if (initialFailure === "network") {
            return Promise.reject(new TypeError("Synthetic accounts failure"));
          }
          if (initialFailure === "http" || initialFailure === "unauthorized") {
            return Promise.resolve(
              response({}, initialFailure === "http" ? 503 : 401),
            );
          }
          if (initialFailure === "json") {
            return Promise.resolve(new Response("not-json"));
          }
          if (initialFailure === "shape")
            return Promise.resolve(response({ accounts: {} }));
          return Promise.resolve(
            response({
              accounts:
                initialFailure === "empty"
                  ? []
                  : [
                      { id: a, displayName: "Account A", status: "ACTIVE" },
                      { id: b, displayName: "Account B", status: "ACTIVE" },
                    ],
            }),
          );
        }
        if (path === "/v1/subscription" || path === "/v1/billing/payments") {
          // Intentionally ignore AbortSignal. Even an already-delivered response
          // or a transport that cannot cancel must not cross the account fence.
          return new Promise<Response>((resolve, reject) => {
            pending.push({
              id: ++serial,
              accountId: url.searchParams.get("accountId") ?? "",
              path,
              done: false,
              resolve,
              reject,
            });
          });
        }
        return Promise.resolve(
          response({ error: "Unexpected fixture endpoint" }, 500),
        );
      };
    },
    { a: accountA, b: accountB, initialFailure: accountFailure },
  );
}

async function pair(page: Page, accountId: string, exclude: number[] = []) {
  const read = () =>
    page.evaluate(
      ({ id, excluded }) =>
        window.__octoportBilling
          .pending()
          .filter(
            (entry) =>
              !entry.done &&
              entry.accountId === id &&
              !excluded.includes(entry.id),
          ),
      { id: accountId, excluded: exclude },
    );
  await expect
    .poll(async () => new Set((await read()).map((entry) => entry.path)).size)
    .toBe(2);
  return (await read()).map((entry) => entry.id);
}
async function flush(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function settle(
  page: Page,
  ids: number[],
  mark: string,
  failure?: Failure | "unauthorized",
  deferPaymentBody = false,
) {
  await page.evaluate(
    (value) =>
      window.__octoportBilling.settle(
        value.ids,
        value.mark,
        value.failure,
        value.defer,
      ),
    { ids, mark, failure, defer: deferPaymentBody },
  );
  await flush(page);
}
async function ready(page: Page) {
  await install(page);
  await page.goto("/billing");
  await expect(choose(page)).toHaveValue(accountA);
  return pair(page, accountA);
}

test.describe("portal billing selected-account responses", () => {
  test("renders the free-beta pair using only existing GET requests", async ({
    page,
  }) => {
    const a = await ready(page);
    await settle(page, a, "A-CURRENT");
    await expect(main(page)).toContainText("A-CURRENT");
    await expect(main(page)).toContainText("Free beta access is active");
    await expect(main(page)).toContainText("Online payment is not enabled yet");
    const requests = await page.evaluate(
      () => window.__octoportBilling.requests,
    );
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(
      requests.every((request) => request.credentials === "same-origin"),
    ).toBe(true);
    expect(new Set(requests.map((request) => request.path))).toEqual(
      new Set(["/v1/accounts", "/v1/subscription", "/v1/billing/payments"]),
    );
  });

  test("clears loaded A data while B is pending and after B fails", async ({
    page,
  }) => {
    const a = await ready(page);
    await settle(page, a, "A-OLD");
    await choose(page).selectOption(accountB);
    const b = await pair(page, accountB);
    await expect(main(page)).not.toContainText("A-OLD");
    await settle(page, b, "B", "http");
    await expect(alert(page)).toHaveText(
      "Commercial information is unavailable.",
    );
    await expect(main(page)).not.toContainText("A-OLD");
  });

  test("late A responses cannot replace completed B even if abort is ignored", async ({
    page,
  }) => {
    const a = await ready(page);
    await choose(page).selectOption(accountB);
    await settle(page, await pair(page, accountB), "B-CURRENT");
    await settle(page, a, "A-LATE");
    await expect(choose(page)).toHaveValue(accountB);
    await expect(main(page)).toContainText("B-CURRENT");
    await expect(main(page)).not.toContainText("A-LATE");
  });

  test("A-to-B-to-A distinguishes the two A attempts", async ({ page }) => {
    const oldA = await ready(page);
    await choose(page).selectOption(accountB);
    const b = await pair(page, accountB);
    await choose(page).selectOption(accountA);
    const newA = await pair(page, accountA, oldA);
    await settle(page, newA, "A-NEW");
    await settle(page, b, "B-OLD");
    await settle(page, oldA, "A-OLD");
    await expect(main(page)).toContainText("A-NEW");
    await expect(main(page)).not.toContainText("A-OLD");
    await expect(main(page)).not.toContainText("B-OLD");
  });

  for (const failure of ["http", "json", "network", "unauthorized"] as const) {
    test(`ignores stale ${failure} without redirecting or hiding B`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const a = await ready(page);
      await choose(page).selectOption(accountB);
      await settle(page, await pair(page, accountB), "B-CURRENT");
      await settle(page, a, "A", failure);
      await expect(page).toHaveURL(/\/billing$/);
      await expect(main(page)).toContainText("B-CURRENT");
      await expect(alert(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("commits neither half until both JSON bodies are available", async ({
    page,
  }) => {
    const a = await ready(page);
    await settle(page, a, "PAIR", undefined, true);
    await expect(main(page)).not.toContainText("PAIR");
    await page.evaluate(() => window.__octoportBilling.finishBodies());
    await expect(main(page)).toContainText("PAIR");
  });

  for (const failure of [
    "network",
    "http",
    "json",
    "shape",
    "nestedSubscription",
    "nullPayment",
    "arrayAccessBasis",
    "arrayAccessStatus",
    "wrongSubscriptionAccount",
    "badAccessReason",
    "badSubscriptionContract",
    "badPriceContract",
    "badPaymentContract",
    "badPaymentPlan",
    "badPaymentWrapper",
    "badUuidContract",
    "badCalendarDate",
  ] as const) {
    test(`current ${failure} is visible and explicit retry recovers`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const a = await ready(page);
      await settle(page, a, "INVALID", failure);
      await expect(alert(page)).toHaveText(
        "Commercial information is unavailable.",
      );
      await expect(main(page)).not.toContainText("INVALID");
      await main(page)
        .getByRole("button", { name: "Try again", exact: true })
        .click();
      await settle(page, await pair(page, accountA), "RECOVERED");
      await expect(main(page)).toContainText("RECOVERED");
      await expect(alert(page)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test("zod-valid minute-precision datetimes remain accepted", async ({
    page,
  }) => {
    const a = await ready(page);
    await settle(page, a, "MINUTE-DATETIME", "minuteDateTime");
    await expect(main(page)).toContainText("MINUTE-DATETIME");
    await expect(alert(page)).toHaveCount(0);
  });

  for (const failure of ["network", "http", "json", "shape"] as const) {
    test(`account-list ${failure} is not mistaken for expired login`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await install(page, failure);
      await page.goto("/billing");
      await expect(alert(page)).toHaveText(
        "Accounts are unavailable. Please try again.",
      );
      await expect(page).toHaveURL(/\/billing$/);
      await expect(choose(page)).toBeDisabled();
      expect(errors).toEqual([]);
    });
  }

  test("empty account list is explicit", async ({ page }) => {
    await install(page, "empty");
    await page.goto("/billing");
    await expect(main(page)).toContainText("No accounts are available.");
    await expect(choose(page)).toBeDisabled();
    await expect(alert(page)).toHaveCount(0);
  });

  test("a repeated same-account change event preserves completed data", async ({
    page,
  }) => {
    const a = await ready(page);
    await settle(page, a, "A-STABLE");
    const before = await page.evaluate(
      () => window.__octoportBilling.requests.length,
    );
    await choose(page).evaluate((element) => {
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush(page);
    await expect(main(page)).toContainText("A-STABLE");
    expect(
      await page.evaluate(() => window.__octoportBilling.requests.length),
    ).toBe(before);
  });

  test("genuine account-list 401 retains the login return path", async ({
    page,
  }) => {
    await install(page, "unauthorized");
    await page.goto("/billing");
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fbilling$/);
  });
});
