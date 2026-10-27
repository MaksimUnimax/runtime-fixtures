"use client";
import { useEffect, useRef, useState } from "react";
import { controlPlane } from "../../lib/control-plane";
import { isDeferredBillingMarker } from "../../lib/billing-response";

type Account = { id: string; displayName: string | null; status: string };
type BillingInterval = { unit: "DAY" | "MONTH" | "YEAR"; count: number };
type SubscriptionData = {
  accountId: string;
  accessBasis?: "BETA" | "COMMERCIAL" | "NONE";
  access: {
    status: "ELIGIBLE" | "INELIGIBLE";
    reason:
      | "ACCOUNT_SUSPENDED"
      | "NO_CURRENT_SUBSCRIPTION"
      | "PERIOD_ENDED"
      | "GRACE_ENDED"
      | "PAST_DUE"
      | "CANCELED"
      | "SUBSCRIPTION_SUSPENDED"
      | "SUBSCRIPTION_EXPIRED"
      | "SUBSCRIPTION_CORRUPTED"
      | null;
  };
  subscription: {
    id: string;
    state:
      | "TRIAL"
      | "ACTIVE"
      | "GRACE"
      | "PAST_DUE"
      | "CANCELED"
      | "EXPIRED"
      | "SUSPENDED";
    stateRevision: number;
    plan: {
      planRevisionId: string;
      planCode: string;
      planRevision: number;
      displayName: string;
    };
    price: {
      priceRevisionId: string;
      amountMinor: number;
      currency: string;
      billingInterval: BillingInterval;
    } | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    graceUntil: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  deviceAllowance: {
    maxActive: number | null;
    activeCount: number;
    remaining: number | null;
    overLimit: boolean;
  };
};
type Payment = {
  id: string;
  state:
    | "PENDING"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELED"
    | "REFUNDED"
    | "CHARGEBACK";
  amountMinor: number;
  currency: string;
  priceRevisionId: string;
  plan: {
    planCode: string;
    planRevision: number;
    displayName: string;
  } | null;
  billingInterval: BillingInterval | null;
  createdAt: string;
  confirmedAt: string | null;
  subscriptionLinked: boolean;
};
type PaymentHistory = { payments: Payment[]; nextCursor: string | null };

type Details =
  | { accountId: string; status: "loading" | "error" }
  | {
      accountId: string;
      status: "ready";
      subscription: SubscriptionData;
      payments: Payment[];
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) => {
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
};
// Keep these wire-format checks byte-for-byte equivalent to zod 4.1.5's
// z.uuid() and z.string().datetime({ offset: true }) contract regexes.
const uuidPattern =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
const offsetDateTimePattern =
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && uuidPattern.test(value);
const isOffsetDateTime = (value: unknown): value is string =>
  typeof value === "string" && offsetDateTimePattern.test(value);
const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const isNonnegativeSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isNullableNonnegativeSafeInteger = (
  value: unknown,
): value is number | null => value === null || isNonnegativeSafeInteger(value);

function isBillingInterval(value: unknown): value is BillingInterval {
  return (
    isRecord(value) &&
    exactKeys(value, ["unit", "count"]) &&
    typeof value.unit === "string" &&
    ["DAY", "MONTH", "YEAR"].includes(value.unit) &&
    Number.isSafeInteger(value.count) &&
    Number(value.count) >= 1 &&
    Number(value.count) <= 1200
  );
}

function isSubscriptionData(
  value: unknown,
  expectedAccountId: string,
): value is SubscriptionData {
  if (
    !isRecord(value) ||
    !exactKeys(
      value,
      ["accountId", "access", "subscription", "deviceAllowance", "billing"],
      ["accessBasis"],
    ) ||
    value.accountId !== expectedAccountId ||
    !isUuid(value.accountId) ||
    (value.accessBasis !== undefined &&
      (typeof value.accessBasis !== "string" ||
        !["BETA", "COMMERCIAL", "NONE"].includes(value.accessBasis))) ||
    !isRecord(value.access) ||
    !exactKeys(value.access, ["status", "reason"]) ||
    typeof value.access.status !== "string" ||
    !["ELIGIBLE", "INELIGIBLE"].includes(value.access.status) ||
    (value.access.reason !== null &&
      (typeof value.access.reason !== "string" ||
        ![
          "ACCOUNT_SUSPENDED",
          "NO_CURRENT_SUBSCRIPTION",
          "PERIOD_ENDED",
          "GRACE_ENDED",
          "PAST_DUE",
          "CANCELED",
          "SUBSCRIPTION_SUSPENDED",
          "SUBSCRIPTION_EXPIRED",
          "SUBSCRIPTION_CORRUPTED",
        ].includes(value.access.reason))) ||
    !isRecord(value.deviceAllowance) ||
    !exactKeys(value.deviceAllowance, [
      "maxActive",
      "activeCount",
      "remaining",
      "overLimit",
    ]) ||
    !isNullableNonnegativeSafeInteger(value.deviceAllowance.maxActive) ||
    !isNonnegativeSafeInteger(value.deviceAllowance.activeCount) ||
    !isNullableNonnegativeSafeInteger(value.deviceAllowance.remaining) ||
    typeof value.deviceAllowance.overLimit !== "boolean" ||
    !isDeferredBillingMarker(value.billing)
  ) {
    return false;
  }
  if (value.subscription === null) return true;
  if (
    !isRecord(value.subscription) ||
    !exactKeys(value.subscription, [
      "id",
      "state",
      "stateRevision",
      "plan",
      "price",
      "currentPeriodStart",
      "currentPeriodEnd",
      "graceUntil",
      "cancelAtPeriodEnd",
    ]) ||
    !isUuid(value.subscription.id) ||
    typeof value.subscription.state !== "string" ||
    ![
      "TRIAL",
      "ACTIVE",
      "GRACE",
      "PAST_DUE",
      "CANCELED",
      "EXPIRED",
      "SUSPENDED",
    ].includes(value.subscription.state) ||
    !isPositiveSafeInteger(value.subscription.stateRevision) ||
    !isRecord(value.subscription.plan) ||
    !exactKeys(value.subscription.plan, [
      "planRevisionId",
      "planCode",
      "planRevision",
      "displayName",
    ]) ||
    !isUuid(value.subscription.plan.planRevisionId) ||
    typeof value.subscription.plan.planCode !== "string" ||
    value.subscription.plan.planCode.length < 1 ||
    !isPositiveSafeInteger(value.subscription.plan.planRevision) ||
    typeof value.subscription.plan.displayName !== "string" ||
    !isOffsetDateTime(value.subscription.currentPeriodStart) ||
    !isOffsetDateTime(value.subscription.currentPeriodEnd) ||
    (value.subscription.graceUntil !== null &&
      !isOffsetDateTime(value.subscription.graceUntil)) ||
    typeof value.subscription.cancelAtPeriodEnd !== "boolean"
  ) {
    return false;
  }
  const price = value.subscription.price;
  return (
    price === null ||
    (isRecord(price) &&
      exactKeys(price, [
        "priceRevisionId",
        "amountMinor",
        "currency",
        "billingInterval",
      ]) &&
      isUuid(price.priceRevisionId) &&
      isNonnegativeSafeInteger(price.amountMinor) &&
      typeof price.currency === "string" &&
      /^[A-Z]{3}$/u.test(price.currency) &&
      isBillingInterval(price.billingInterval))
  );
}

function isPayment(value: unknown): value is Payment {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "id",
      "state",
      "amountMinor",
      "currency",
      "priceRevisionId",
      "plan",
      "billingInterval",
      "createdAt",
      "confirmedAt",
      "subscriptionLinked",
    ]) ||
    !isUuid(value.id) ||
    typeof value.state !== "string" ||
    ![
      "PENDING",
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
      "REFUNDED",
      "CHARGEBACK",
    ].includes(value.state) ||
    !isNonnegativeSafeInteger(value.amountMinor) ||
    typeof value.currency !== "string" ||
    !/^[A-Z]{3}$/u.test(value.currency) ||
    !isUuid(value.priceRevisionId) ||
    !isOffsetDateTime(value.createdAt) ||
    (value.confirmedAt !== null && !isOffsetDateTime(value.confirmedAt)) ||
    typeof value.subscriptionLinked !== "boolean" ||
    (value.billingInterval !== null &&
      !isBillingInterval(value.billingInterval))
  ) {
    return false;
  }
  return (
    value.plan === null ||
    (isRecord(value.plan) &&
      exactKeys(value.plan, ["planCode", "planRevision", "displayName"]) &&
      typeof value.plan.planCode === "string" &&
      value.plan.planCode.length > 0 &&
      isPositiveSafeInteger(value.plan.planRevision) &&
      typeof value.plan.displayName === "string")
  );
}

function isPaymentHistory(value: unknown): value is PaymentHistory {
  return (
    isRecord(value) &&
    exactKeys(value, ["payments", "nextCursor"]) &&
    Array.isArray(value.payments) &&
    value.payments.every(isPayment) &&
    (value.nextCursor === null || isUuid(value.nextCursor))
  );
}

export default function Billing() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [accountsStatus, setAccountsStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [accountsAttempt, setAccountsAttempt] = useState(0);
  const [detailsAttempt, setDetailsAttempt] = useState(0);
  const [details, setDetails] = useState<Details>();
  const selectionGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setAccountsStatus("loading");
    void (async () => {
      try {
        const response = await controlPlane("/v1/accounts", {
          signal: controller.signal,
        });
        if (!active) return;
        if (response.status === 401) {
          location.assign("/login?returnTo=%2Fbilling");
          return;
        }
        if (!response.ok) throw new Error("Accounts unavailable");
        const value = (await response.json()).accounts as Account[];
        if (!active) return;
        if (
          !Array.isArray(value) ||
          value.some(
            (account) =>
              !account ||
              typeof account.id !== "string" ||
              !account.id ||
              typeof account.status !== "string" ||
              (account.displayName !== null &&
                typeof account.displayName !== "string"),
          )
        ) {
          throw new Error("Invalid accounts response");
        }
        setAccounts(value);
        setAccountId(value[0]?.id ?? "");
        setAccountsStatus("ready");
      } catch {
        if (active) setAccountsStatus("error");
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountsAttempt]);

  useEffect(() => {
    if (!accountId) return;
    const generation = ++selectionGeneration.current;
    let active = true;
    const controller = new AbortController();
    const isCurrent = () =>
      active && generation === selectionGeneration.current;
    setDetails({ accountId, status: "loading" });
    void (async () => {
      try {
        const [subscriptionResponse, paymentsResponse] = await Promise.all([
          controlPlane(
            `/v1/subscription?accountId=${encodeURIComponent(accountId)}`,
            { signal: controller.signal },
          ),
          controlPlane(
            `/v1/billing/payments?accountId=${encodeURIComponent(accountId)}`,
            { signal: controller.signal },
          ),
        ]);
        if (!isCurrent()) return;
        if (
          subscriptionResponse.status === 401 ||
          paymentsResponse.status === 401
        ) {
          location.assign("/login?returnTo=%2Fbilling");
          return;
        }
        if (!subscriptionResponse.ok || !paymentsResponse.ok) {
          throw new Error("Account information unavailable");
        }
        const [subscriptionValue, paymentsValue] = await Promise.all([
          subscriptionResponse.json(),
          paymentsResponse.json(),
        ]);
        if (!isCurrent()) return;
        if (
          !isSubscriptionData(subscriptionValue, accountId) ||
          !isPaymentHistory(paymentsValue)
        ) {
          throw new Error("Invalid account information response");
        }
        // Publish the pair together, only for this exact selection attempt.
        setDetails({
          accountId,
          status: "ready",
          subscription: subscriptionValue,
          payments: paymentsValue.payments,
        });
      } catch {
        if (isCurrent()) setDetails({ accountId, status: "error" });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [accountId, detailsAttempt]);

  const selectedDetails =
    details?.accountId === accountId ? details : undefined;
  const subscription =
    selectedDetails?.status === "ready"
      ? selectedDetails.subscription
      : undefined;
  const payments =
    selectedDetails?.status === "ready" ? selectedDetails.payments : [];
  const current = subscription?.subscription;
  return (
    <main>
      <h1>Billing</h1>
      <label>
        Account{" "}
        <select
          value={accountId}
          disabled={accountsStatus !== "ready" || accounts.length === 0}
          onChange={(event) => {
            if (event.target.value === accountId) return;
            // Invalidate callbacks immediately, before the next effect commits.
            selectionGeneration.current += 1;
            setDetails(undefined);
            setAccountId(event.target.value);
          }}
        >
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName ?? `Account ${account.id.slice(0, 8)}`}{" "}
              {account.status}
            </option>
          ))}
        </select>
      </label>
      {accountsStatus === "loading" && <p role="status">Loading accounts…</p>}
      {accountsStatus === "error" && (
        <>
          <p role="alert">Accounts are unavailable. Please try again.</p>
          <button
            type="button"
            onClick={() => setAccountsAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </>
      )}
      {accountsStatus === "ready" && accounts.length === 0 && (
        <p role="status">No accounts are available.</p>
      )}
      {accountId &&
        (!selectedDetails || selectedDetails.status === "loading") && (
          <p role="status">Loading account information…</p>
        )}
      {selectedDetails?.status === "error" && (
        <>
          <p role="alert">Commercial information is unavailable.</p>
          <button
            type="button"
            onClick={() => {
              selectionGeneration.current += 1;
              setDetails(undefined);
              setDetailsAttempt((value) => value + 1);
            }}
          >
            Try again
          </button>
        </>
      )}
      {subscription && (
        <>
          {subscription.accessBasis === "BETA" && (
            <p role="status">
              Free beta access is active. No subscription or commercial device
              limit is required.
            </p>
          )}
          <h2>Current subscription</h2>
          <p>
            Access: {subscription.access.status}
            {subscription.access.reason
              ? ` (${subscription.access.reason})`
              : ""}
          </p>
          {current ? (
            <dl>
              <dt>Plan</dt>
              <dd>{current.plan.displayName}</dd>
              <dt>State</dt>
              <dd>{current.state}</dd>
              <dt>Current period ends</dt>
              <dd>{current.currentPeriodEnd}</dd>
              {current.graceUntil && (
                <>
                  <dt>Grace ends</dt>
                  <dd>{current.graceUntil}</dd>
                </>
              )}
              <dt>Price</dt>
              <dd>
                {current.price
                  ? `${current.price.amountMinor} ${current.price.currency} / ${current.price.billingInterval.count} ${current.price.billingInterval.unit}`
                  : "Price: not available"}
              </dd>
            </dl>
          ) : (
            <p>No current subscription.</p>
          )}
          <h2>Device allowance</h2>
          <p>
            Active devices: {subscription.deviceAllowance.activeCount} /{" "}
            {subscription.deviceAllowance.maxActive ?? "unavailable"}
            {subscription.deviceAllowance.overLimit ? " (over limit)" : ""}
          </p>
          <h2>Payment history</h2>
          {payments.length ? (
            <ul>
              {payments.map((payment) => (
                <li key={payment.id}>
                  {payment.state} — {payment.amountMinor} {payment.currency} —{" "}
                  {payment.createdAt}
                </li>
              ))}
            </ul>
          ) : (
            <p>No payments recorded.</p>
          )}
          <p>Online payment is not enabled yet.</p>
        </>
      )}
    </main>
  );
}
