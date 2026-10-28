import { expect, test, type Page, type Route } from "@playwright/test";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const accounts = [
  { id: A, displayName: "Account Alpha", status: "ACTIVE" },
  { id: B, displayName: "Account Beta", status: "ACTIVE" },
];
const device = (account: string, label?: string, status = "ACTIVE") => ({
  id:
    account === A
      ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  status,
  label: label ?? (account === A ? "Alpha device" : "Beta device"),
  clientMetadata: { state: "WITHHELD" },
  activatedAt: null,
  lastSeenAt: null,
});
type Handler = (route: Route) => Promise<void> | void;
function devicePageAlerts(page: Page) {
  // Next's route announcer is a separate live region, not a device-page error.
  return page
    .getByRole("alert")
    .and(page.locator(":not(#__next-route-announcer__)"));
}
function heldRoute() {
  let hold!: (route: Route) => void;
  const ready = new Promise<Route>((resolve) => {
    hold = resolve;
  });
  return { hold, ready };
}
async function install(
  page: Page,
  overrides: {
    accounts?: Handler;
    devices?: Handler;
    revoke?: Handler;
  } = {},
) {
  await page.route("**/api/control-plane/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/accounts")) {
      if (overrides.accounts) return overrides.accounts(route);
      return route.fulfill({ json: { accounts } });
    }
    if (url.pathname.endsWith("/devices") && request.method() === "GET") {
      if (overrides.devices) return overrides.devices(route);
      return route.fulfill({
        json: { devices: [device(url.searchParams.get("accountId")!)] },
      });
    }
    if (url.pathname.endsWith("/revoke") && request.method() === "POST") {
      expect(request.headers()["x-csrf-token"]).toBe("synthetic-device-csrf");
      if (overrides.revoke) return overrides.revoke(route);
    }
    throw new Error(
      `Unexpected synthetic request: ${request.method()} ${url.pathname}`,
    );
  });
}
// Wait for the released exact response and two paint opportunities; the original
// unfenced implementation is observed replacing the list at this boundary.
async function release(page: Page, route: Route, json: unknown, status = 200) {
  const finished = page.waitForEvent(
    "requestfinished",
    (request) => request === route.request(),
  );
  await route.fulfill({ status, json });
  await finished;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: "pcp_csrf", value: "synthetic-device-csrf", url: baseURL! },
  ]);
});

test("late first-account response cannot overwrite the selected account", async ({
  page,
}) => {
  const first = heldRoute();
  await install(page, {
    devices: (route) =>
      new URL(route.request().url()).searchParams.get("accountId") === A
        ? first.hold(route)
        : route.fulfill({ json: { devices: [device(B)] } }),
  });
  await page.goto("/devices");
  const old = await first.ready;
  await page.getByRole("combobox").selectOption(B);
  await expect(page.getByText(/Beta device — ACTIVE/)).toBeVisible();
  await release(page, old, { devices: [device(A)] });
  await expect(page.getByRole("combobox")).toHaveValue(B);
  await expect(page.getByText(/Beta device — ACTIVE/)).toBeVisible();
  await expect(page.getByText(/Alpha device/)).toHaveCount(0);
});

test("account switch hides previous devices while the new list is pending", async ({
  page,
}) => {
  const second = heldRoute();
  await install(page, {
    devices: (route) =>
      new URL(route.request().url()).searchParams.get("accountId") === B
        ? second.hold(route)
        : route.fulfill({ json: { devices: [device(A)] } }),
  });
  await page.goto("/devices");
  await expect(page.getByText(/Alpha device — ACTIVE/)).toBeVisible();
  await page.getByRole("combobox").selectOption(B);
  const pending = await second.ready;
  await expect(page.getByText(/Alpha device/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revoke", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Loading");
  await release(page, pending, { devices: [device(B)] });
  await expect(page.getByText(/Beta device — ACTIVE/)).toBeVisible();
});

test("returning to an account does not revive its obsolete first response", async ({
  page,
}) => {
  const first = heldRoute();
  let countA = 0;
  await install(page, {
    devices: (route) => {
      const id = new URL(route.request().url()).searchParams.get("accountId")!;
      if (id === A && ++countA === 1) return first.hold(route);
      return route.fulfill({
        json: { devices: [device(id, id === A ? "Fresh Alpha" : undefined)] },
      });
    },
  });
  await page.goto("/devices");
  const old = await first.ready;
  await page.getByRole("combobox").selectOption(B);
  await expect(page.getByText(/Beta device/)).toBeVisible();
  await page.getByRole("combobox").selectOption(A);
  await expect(page.getByText(/Fresh Alpha/)).toBeVisible();
  await release(page, old, { devices: [device(A, "Obsolete Alpha")] });
  await expect(page.getByText(/Fresh Alpha/)).toBeVisible();
  await expect(page.getByText(/Obsolete Alpha/)).toHaveCount(0);
});

test("completed revocation cannot reload a previously selected account", async ({
  page,
}) => {
  const mutation = heldRoute();
  const gets: string[] = [];
  await install(page, {
    devices: (route) => {
      const id = new URL(route.request().url()).searchParams.get("accountId")!;
      gets.push(id);
      return route.fulfill({ json: { devices: [device(id)] } });
    },
    revoke: mutation.hold,
  });
  await page.goto("/devices");
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  const old = await mutation.ready;
  await page.getByRole("combobox").selectOption(B);
  await expect(page.getByText(/Beta device/)).toBeVisible();
  await release(page, old, { status: "REVOKED" });
  await expect(
    page.getByRole("button", { name: "Revoke", exact: true }),
  ).toBeEnabled();
  expect(gets).toEqual([A, B]);
  await expect(page.getByText(/Beta device/)).toBeVisible();
  await expect(page.getByText(/Alpha device/)).toHaveCount(0);
});

test("same-task double revoke creates only one mutation", async ({ page }) => {
  const mutation = heldRoute();
  let mutations = 0;
  let revoked = false;
  await install(page, {
    devices: (route) =>
      route.fulfill({
        json: {
          devices: [device(A, undefined, revoked ? "REVOKED" : "ACTIVE")],
        },
      }),
    revoke: (route) => {
      mutations++;
      mutation.hold(route);
    },
  });
  await page.goto("/devices");
  const button = page.getByRole("button", { name: "Revoke", exact: true });
  await expect(button).toBeEnabled();
  await button.evaluate((element: HTMLButtonElement) => {
    element.click();
    element.click();
  });
  const pending = await mutation.ready;
  await expect(button).toBeDisabled();
  expect(mutations).toBe(1);
  revoked = true;
  await release(page, pending, { status: "REVOKED" });
  await expect(page.getByText(/Alpha device — REVOKED/)).toBeVisible();
  await expect(button).toHaveCount(0);
});

for (const failure of ["HTTP", "NETWORK", "JSON"] as const) {
  test(`device list ${failure} failure is visible and recovers only by explicit Retry`, async ({
    page,
  }) => {
    let gets = 0;
    await install(page, {
      devices: (route) => {
        gets++;
        if (gets > 1) return route.fulfill({ json: { devices: [device(A)] } });
        if (failure === "NETWORK") return route.abort("failed");
        if (failure === "JSON")
          return route.fulfill({ contentType: "application/json", body: "{" });
        return route.fulfill({ status: 503, json: { error: "synthetic" } });
      },
    });
    await page.goto("/devices");
    await expect(devicePageAlerts(page)).toContainText(
      "Could not load devices",
    );
    expect(gets).toBe(1);
    await expect(
      page.getByRole("button", { name: "Revoke", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText(/Alpha device — ACTIVE/)).toBeVisible();
    expect(gets).toBe(2);
    await expect(devicePageAlerts(page)).toHaveCount(0);
  });
}

for (const failure of ["HTTP", "NETWORK"] as const) {
  test(`revocation ${failure} failure preserves the selected list and permits explicit retry`, async ({
    page,
  }) => {
    let gets = 0;
    let mutations = 0;
    let revoked = false;
    await install(page, {
      devices: (route) => {
        gets++;
        return route.fulfill({
          json: {
            devices: [device(A, undefined, revoked ? "REVOKED" : "ACTIVE")],
          },
        });
      },
      revoke: (route) => {
        if (++mutations === 1)
          return failure === "NETWORK"
            ? route.abort("failed")
            : route.fulfill({ status: 403, json: { error: "synthetic" } });
        revoked = true;
        return route.fulfill({ json: { status: "REVOKED" } });
      },
    });
    await page.goto("/devices");
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(devicePageAlerts(page)).toContainText(
      "Device revocation was not confirmed",
    );
    await expect(page.getByText(/Alpha device — ACTIVE/)).toBeVisible();
    expect(gets).toBe(1);
    expect(mutations).toBe(1);
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByText(/Alpha device — REVOKED/)).toBeVisible();
    expect(gets).toBe(2);
    expect(mutations).toBe(2);
  });
}

for (const failure of ["HTTP", "NETWORK"] as const) {
  test(`account list ${failure} failure is not misreported as signed out`, async ({
    page,
  }) => {
    await install(page, {
      accounts: (route) =>
        failure === "NETWORK"
          ? route.abort("failed")
          : route.fulfill({ status: 503, json: { error: "synthetic" } }),
    });
    await page.goto("/devices");
    await expect(devicePageAlerts(page)).toContainText(
      "Could not load accounts",
    );
    await expect(page).toHaveURL(/\/devices$/);
    await expect(
      page.getByRole("button", { name: "Reload page", exact: true }),
    ).toBeVisible();
  });
}

test("unauthenticated account request retains the normal login redirect", async ({
  page,
}) => {
  await install(page, {
    accounts: (route) =>
      route.fulfill({ status: 401, json: { error: "synthetic" } }),
  });
  await page.goto("/devices");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fdevices$/);
});

test("normal list and revoke keep the existing metadata and CSRF contract", async ({
  page,
}) => {
  let revoked = false;
  let mutations = 0;
  await install(page, {
    devices: (route) =>
      route.fulfill({
        json: {
          devices: [device(A, undefined, revoked ? "REVOKED" : "ACTIVE")],
        },
      }),
    revoke: (route) => {
      mutations++;
      revoked = true;
      return route.fulfill({ json: { status: "REVOKED" } });
    },
  });
  await page.goto("/devices");
  await expect(
    page.getByText(/Alpha device — ACTIVE, Not shared, extension Not shared/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(page.getByText(/Alpha device — REVOKED/)).toBeVisible();
  expect(mutations).toBe(1);
});

test("late old-account errors do not replace the current list", async ({
  page,
}) => {
  const first = heldRoute();
  await install(page, {
    devices: (route) =>
      new URL(route.request().url()).searchParams.get("accountId") === A
        ? first.hold(route)
        : route.fulfill({ json: { devices: [device(B)] } }),
  });
  await page.goto("/devices");
  const old = await first.ready;
  await page.getByRole("combobox").selectOption(B);
  await expect(page.getByText(/Beta device/)).toBeVisible();
  await release(page, old, { error: "synthetic" }, 503);
  await expect(page.getByText(/Beta device/)).toBeVisible();
  await expect(devicePageAlerts(page)).toHaveCount(0);
});

test("same-task account switch prevents a stale visible revoke action", async ({
  page,
}) => {
  const second = heldRoute();
  let mutations = 0;
  await install(page, {
    devices: (route) =>
      new URL(route.request().url()).searchParams.get("accountId") === B
        ? second.hold(route)
        : route.fulfill({ json: { devices: [device(A)] } }),
    revoke: (route) => {
      mutations++;
      return route.fulfill({ json: { status: "REVOKED" } });
    },
  });
  await page.goto("/devices");
  await expect(
    page.getByRole("button", { name: "Revoke", exact: true }),
  ).toBeEnabled();
  await page.evaluate((next) => {
    const select = document.querySelector("select")!;
    const stale = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Revoke",
    )!;
    select.value = next;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    stale.click();
  }, B);
  await release(page, await second.ready, { devices: [device(B)] });
  expect(mutations).toBe(0);
  await expect(page.getByText(/Beta device/)).toBeVisible();
});
