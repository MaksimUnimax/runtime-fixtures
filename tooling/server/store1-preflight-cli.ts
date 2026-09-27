import { lstatSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type {
  Store1ActivationReadback,
  Store1ActivationPlan,
  Store1V2SignaturePreflightProof,
} from "./store1-opera-admin-activation.js";
import {
  planStore1Activation,
  STORE1_VERSION,
} from "./store1-opera-admin-activation.js";
import {
  planStore1ActivationWithVerifiedPreflight,
  planStore1ActivationWithVerifiedPreflightForTest,
  readStore1PackageSignatureEvidence,
  STORE1_BOOTSTRAP_PATH,
  STORE1_V2_CONFIG_READ_PATH,
  type Store1PackageSignatureEvidence,
  type Store1V2BootstrapPreflightRequest,
  type Store1V2SignaturePreflightTransport,
} from "./store1-v2-signature-preflight.js";

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_PROTECTED_FILE_BYTES = 32 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const SIGNING_KEY_STATES = new Set([
  "UNREGISTERED",
  "REGISTERED",
  "ACTIVE",
  "RETIRED",
  "REVOKED",
  "INVALID",
]);

export type Store1PreflightOperatorInput = {
  manifestPath: string;
  packagePath: string;
  reviewerEmail: string;
  deviceId: string;
  browserVersion: string;
  adminSessionFile: string;
  reviewerDeviceBearerFile: string;
};

type Credentials = { adminSession: string; reviewerBearer: string };
type JsonRecord = Record<string, unknown>;

function object(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string): never {
  throw new Error(code);
}

function secureTextFile(
  path: string,
  code: string,
  options: { singleLine: boolean },
): string {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return fail(code);
  }
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    (stat.mode & 0o077) !== 0 ||
    stat.size === 0 ||
    stat.size > MAX_PROTECTED_FILE_BYTES
  )
    return fail(code);
  try {
    const value = readFileSync(path, "utf8").trim();
    if (!value || (options.singleLine && /[\r\n]/.test(value)))
      return fail(code);
    return value;
  } catch {
    return fail(code);
  }
}

function readCredentials(input: Store1PreflightOperatorInput): Credentials {
  const adminSession = secureTextFile(
    input.adminSessionFile,
    "STORE1_ADMIN_INPUT_INVALID",
    { singleLine: true },
  );
  const reviewerBearer = secureTextFile(
    input.reviewerDeviceBearerFile,
    "STORE1_REVIEWER_INPUT_INVALID",
    { singleLine: true },
  );
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(adminSession) ||
    !/^[A-Za-z0-9._~-]{16,8192}$/.test(reviewerBearer)
  )
    return fail("STORE1_PROTECTED_INPUT_INVALID");
  return { adminSession, reviewerBearer };
}

function parseStore1Config(
  value: unknown,
): NonNullable<Store1ActivationReadback["config"]> | null {
  if (value === null) return null;
  if (
    !object(value) ||
    !Number.isSafeInteger(value.configVersion) ||
    Number(value.configVersion) <= 0 ||
    typeof value.contractVersion !== "string" ||
    typeof value.snapshotVersion !== "string" ||
    typeof value.envelopeVersion !== "string" ||
    typeof value.contentHashSha256 !== "string" ||
    !HASH.test(value.contentHashSha256) ||
    typeof value.sourceFingerprintSha256 !== "string" ||
    !HASH.test(value.sourceFingerprintSha256) ||
    typeof value.signingKeyId !== "string" ||
    value.signingKeyId.length === 0 ||
    typeof value.signingKeyState !== "string" ||
    !SIGNING_KEY_STATES.has(value.signingKeyState) ||
    !Array.isArray(value.compatibilityPolicyRevisionIds) ||
    !value.compatibilityPolicyRevisionIds.every(
      (id) => typeof id === "string" && UUID.test(id),
    )
  )
    return fail("STORE1_CONFIG_RESPONSE_INVALID");
  return {
    configVersion: Number(value.configVersion),
    contractVersion: value.contractVersion,
    snapshotVersion: value.snapshotVersion,
    envelopeVersion: value.envelopeVersion,
    contentHashSha256: value.contentHashSha256,
    sourceFingerprintSha256: value.sourceFingerprintSha256,
    signingKeyId: value.signingKeyId,
    signingKeyState: value.signingKeyState as NonNullable<
      Store1ActivationReadback["config"]
    >["signingKeyState"],
    compatibilityPolicyRevisionIds: [...value.compatibilityPolicyRevisionIds],
  };
}

function safeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail("STORE1_PACKAGE_ORIGIN_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    return fail("STORE1_PACKAGE_ORIGIN_INVALID");
  return url.origin;
}

function safeRelativeUrl(origin: string, path: string): URL {
  let url: URL;
  try {
    url = new URL(path, `${origin}/`);
  } catch {
    return fail("STORE1_REQUEST_PATH_INVALID");
  }
  if (url.origin !== origin || url.protocol !== "https:")
    return fail("STORE1_REQUEST_ORIGIN_MISMATCH");
  return url;
}

async function readBounded(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    return fail("STORE1_RESPONSE_TOO_LARGE");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return fail("STORE1_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

type NativeTransportInput = {
  controlApiOrigin: string;
  expectedAccountId: string;
  adminSession: string;
  reviewerBearer: string;
};

function createStore1FetchTransport(
  input: NativeTransportInput,
  fetchImpl: typeof fetch,
): Store1V2SignaturePreflightTransport {
  const origin = safeOrigin(input.controlApiOrigin);
  if (!UUID.test(input.expectedAccountId))
    return fail("STORE1_PREFLIGHT_ACCOUNT_ID_INVALID");

  const request = async (
    path: string,
    auth: "admin" | "reviewer",
    body?: unknown,
  ) => {
    const url = safeRelativeUrl(origin, path);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: body === undefined ? "GET" : "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(auth === "admin"
            ? { cookie: `pcp_admin_session=${input.adminSession}` }
            : { authorization: `Bearer ${input.reviewerBearer}` }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      return fail("STORE1_TRANSPORT_FAILED");
    }
    if (response.status >= 300 && response.status < 400)
      return fail("STORE1_REDIRECT_REJECTED");
    if (response.status === 401 || response.status === 403)
      return fail("STORE1_AUTHENTICATION_FAILED");
    if (response.status === 404) return null;
    if (!response.ok) return fail("STORE1_REMOTE_READ_FAILED");
    try {
      return JSON.parse(new TextDecoder().decode(await readBounded(response)));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("STORE1_"))
        throw error;
      return fail("STORE1_RESPONSE_INVALID");
    }
  };

  return {
    async readLatestConfig(path) {
      if (path !== STORE1_V2_CONFIG_READ_PATH)
        return fail("STORE1_CONFIG_PATH_INVALID");
      const value = await request(path, "admin");
      return parseStore1Config(value);
    },
    async issueBootstrap(
      path,
      bootstrapRequest: Store1V2BootstrapPreflightRequest,
    ) {
      if (path !== STORE1_BOOTSTRAP_PATH)
        return fail("STORE1_BOOTSTRAP_PATH_INVALID");
      const envelope = await request(path, "reviewer", bootstrapRequest);
      if (!object(envelope)) return fail("STORE1_BOOTSTRAP_RESPONSE_INVALID");
      return {
        envelope,
        authenticatedContext: {
          accountId: input.expectedAccountId,
          deviceId: bootstrapRequest.deviceId,
          browserFamily: bootstrapRequest.browser.family,
          browserVersion: bootstrapRequest.browser.version,
          controlApiOrigin: origin,
        },
      };
    },
  };
}
export function createStore1NativeFetchTransport(
  input: NativeTransportInput,
): Store1V2SignaturePreflightTransport {
  return createStore1FetchTransport(input, fetch);
}

export function createStore1NativeFetchTransportForTest(
  input: NativeTransportInput & { fetchImpl: typeof fetch },
): Store1V2SignaturePreflightTransport {
  if (process.env.VITEST !== "true")
    return fail("STORE1_TEST_ONLY_FETCH_TRANSPORT");
  return createStore1FetchTransport(input, input.fetchImpl);
}

async function fetchAdminJson(
  origin: string,
  credentials: Credentials,
  path: string,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  const url = safeRelativeUrl(origin, path);
  let response: Response;
  try {
    response = await (fetchImpl ?? fetch)(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        cookie: `pcp_admin_session=${credentials.adminSession}`,
      },
    });
  } catch {
    return fail("STORE1_TRANSPORT_FAILED");
  }
  if (response.status >= 300 && response.status < 400)
    return fail("STORE1_REDIRECT_REJECTED");
  if (response.status === 401 || response.status === 403)
    return fail("STORE1_AUTHENTICATION_FAILED");
  if (response.status === 404) return null;
  if (!response.ok) return fail("STORE1_REMOTE_READ_FAILED");
  try {
    return JSON.parse(new TextDecoder().decode(await readBounded(response)));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("STORE1_"))
      throw error;
    return fail("STORE1_RESPONSE_INVALID");
  }
}

function validateInput(value: unknown): Store1PreflightOperatorInput {
  if (
    !object(value) ||
    Object.keys(value).sort().join(",") !==
      [
        "adminSessionFile",
        "browserVersion",
        "deviceId",
        "manifestPath",
        "packagePath",
        "reviewerDeviceBearerFile",
        "reviewerEmail",
      ]
        .sort()
        .join(",")
  )
    return fail("STORE1_OPERATOR_INPUT_INVALID");
  const input = value as unknown as Store1PreflightOperatorInput;
  if (
    typeof input.manifestPath !== "string" ||
    typeof input.packagePath !== "string" ||
    typeof input.adminSessionFile !== "string" ||
    typeof input.reviewerDeviceBearerFile !== "string" ||
    typeof input.reviewerEmail !== "string" ||
    input.reviewerEmail.length > 320 ||
    !input.reviewerEmail.includes("@") ||
    typeof input.deviceId !== "string" ||
    !UUID.test(input.deviceId) ||
    typeof input.browserVersion !== "string" ||
    !/^\d+(?:\.\d+){0,3}$/.test(input.browserVersion)
  )
    return fail("STORE1_OPERATOR_INPUT_INVALID");
  return input;
}

async function readReviewerState(
  input: Store1PreflightOperatorInput,
  origin: string,
  credentials: Credentials,
  fetchImpl?: typeof fetch,
): Promise<Store1ActivationReadback> {
  const beta = await fetchAdminJson(
    origin,
    credentials,
    "/v1/admin/beta/admission",
    fetchImpl,
  );
  if (
    !object(beta) ||
    !["CLOSED", "OPEN", "PAUSED"].includes(String(beta.mode))
  )
    return fail("STORE1_REVIEWER_READBACK_INVALID");
  const users = await fetchAdminJson(
    origin,
    credentials,
    `/v1/admin/users?email=${encodeURIComponent(input.reviewerEmail)}&limit=100`,
    fetchImpl,
  );
  if (
    !object(users) ||
    !Array.isArray(users.items) ||
    users.nextCursor !== null
  )
    return fail("STORE1_REVIEWER_READBACK_INVALID");
  let reviewerUser: Store1ActivationReadback["reviewerUser"] = null;
  if (users.items.length > 1) return fail("STORE1_REVIEWER_READBACK_AMBIGUOUS");
  if (users.items.length === 1) {
    const user = users.items[0];
    if (
      !object(user) ||
      typeof user.id !== "string" ||
      !["ACTIVE", "SUSPENDED"].includes(String(user.status)) ||
      !Array.isArray(user.emails)
    )
      return fail("STORE1_REVIEWER_READBACK_INVALID");
    reviewerUser = {
      id: user.id,
      status: user.status as "ACTIVE" | "SUSPENDED",
      queriedEmailVerified: user.emails.some(
        (email) =>
          object(email) &&
          String(email.email).toLowerCase() ===
            input.reviewerEmail.toLowerCase() &&
          typeof email.verifiedAt === "string",
      ),
    };
  }
  const reviewerAccounts: NonNullable<
    Store1ActivationReadback["reviewerAccounts"]
  > = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({
      ownerEmail: input.reviewerEmail,
      status: "ACTIVE",
      limit: "100",
    });
    if (cursor) query.set("cursor", cursor);
    const value = await fetchAdminJson(
      origin,
      credentials,
      `/v1/admin/accounts?${query}`,
      fetchImpl,
    );
    if (
      !object(value) ||
      !Array.isArray(value.items) ||
      !(value.nextCursor === null || typeof value.nextCursor === "string")
    )
      return fail("STORE1_REVIEWER_READBACK_INVALID");
    for (const item of value.items) {
      if (
        !object(item) ||
        typeof item.id !== "string" ||
        item.status !== "ACTIVE"
      )
        return fail("STORE1_REVIEWER_READBACK_INVALID");
      reviewerAccounts.push({ id: item.id, status: "ACTIVE" });
    }
    cursor = value.nextCursor;
    if (cursor === null) break;
    if (page === 9) return fail("STORE1_REVIEWER_READBACK_INCOMPLETE");
  }
  const readback: Store1ActivationReadback = {
    betaState: { mode: beta.mode as "CLOSED" | "OPEN" | "PAUSED" },
    reviewerUser,
    reviewerAccounts,
    reviewerAccountNextCursor: cursor,
  };
  if (reviewerAccounts.length === 1) {
    const admission = await fetchAdminJson(
      origin,
      credentials,
      `/v1/admin/beta/admission/accounts/${reviewerAccounts[0]!.id}`,
      fetchImpl,
    );
    if (
      !object(admission) ||
      admission.accountId !== reviewerAccounts[0]!.id ||
      typeof admission.admitted !== "boolean"
    )
      return fail("STORE1_REVIEWER_READBACK_INVALID");
    readback.reviewerAdmission = {
      accountId: admission.accountId,
      admitted: admission.admitted,
    };
  }
  return readback;
}

type RunOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};
type VerifiedPlannerInput = {
  expectedAccountId: string;
  deviceId: string;
  browserVersion: string;
  readback: Store1ActivationReadback;
  transport: Store1V2SignaturePreflightTransport;
  now?: () => Date;
};
type VerifiedPlannerResult = {
  signaturePreflight: Store1V2SignaturePreflightProof;
  plan: Store1ActivationPlan;
};
type VerifiedPlanner = (
  input: VerifiedPlannerInput,
) => Promise<VerifiedPlannerResult>;

function collectionPage(
  value: unknown,
  code: string,
): { items: unknown[]; nextCursor: string | null } {
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    !(value.nextCursor === null || typeof value.nextCursor === "string")
  )
    return fail(code);
  return { items: value.items, nextCursor: value.nextCursor };
}

function capturePlannerRead(
  path: string,
  value: unknown,
  readback: Store1ActivationReadback,
): void {
  if (path === `/v1/admin/compatibility/releases/${STORE1_VERSION}`) {
    readback.release =
      value === null
        ? null
        : (value as NonNullable<Store1ActivationReadback["release"]>);
    return;
  }
  if (path.startsWith("/v1/admin/compatibility/policies?")) {
    const p = collectionPage(value, "STORE1_POLICY_RESPONSE_INVALID");
    readback.policies = p.items as NonNullable<
      Store1ActivationReadback["policies"]
    >;
    return;
  }
  if (path.startsWith("/v1/admin/compatibility/config-releases/latest?")) {
    readback.config = parseStore1Config(value);
    return;
  }
  if (path.startsWith("/v1/admin/ai/registry/adapters?")) {
    const p = collectionPage(value, "STORE1_ADAPTER_RESPONSE_INVALID");
    readback.adapters = [
      ...(readback.adapters ?? []),
      ...(p.items as NonNullable<Store1ActivationReadback["adapters"]>),
    ];
    readback.adapterNextCursor = p.nextCursor;
    return;
  }
  if (path.includes("/surfaces?")) {
    const p = collectionPage(value, "STORE1_SURFACE_RESPONSE_INVALID");
    readback.surfaces = [
      ...(readback.surfaces ?? []),
      ...(p.items as NonNullable<Store1ActivationReadback["surfaces"]>),
    ];
    readback.surfaceNextCursor = p.nextCursor;
    return;
  }
  if (path.includes("/variants?")) {
    const p = collectionPage(value, "STORE1_VARIANT_RESPONSE_INVALID");
    readback.variants = [
      ...(readback.variants ?? []),
      ...(p.items as NonNullable<Store1ActivationReadback["variants"]>),
    ];
    readback.variantNextCursor = p.nextCursor;
    return;
  }
  if (path.startsWith("/v1/admin/ai/profiles?")) {
    const p = collectionPage(value, "STORE1_PROFILE_RESPONSE_INVALID");
    readback.profiles = [
      ...(readback.profiles ?? []),
      ...(p.items as NonNullable<Store1ActivationReadback["profiles"]>),
    ];
    readback.profileNextCursor = p.nextCursor;
    return;
  }
  if (path.includes("/profiles/") && path.includes("/revisions?")) {
    const p = collectionPage(value, "STORE1_PROFILE_REVISION_RESPONSE_INVALID");
    readback.profileRevisions = [
      ...(readback.profileRevisions ?? []),
      ...(p.items as NonNullable<Store1ActivationReadback["profileRevisions"]>),
    ];
    readback.profileRevisionNextCursor = p.nextCursor;
    return;
  }
  if (path.startsWith("/v1/admin/ai/assignments?")) {
    const p = collectionPage(value, "STORE1_ASSIGNMENT_RESPONSE_INVALID");
    readback.assignments = [
      ...(readback.assignments ?? []),
      ...(p.items as NonNullable<Store1ActivationReadback["assignments"]>),
    ];
    readback.assignmentNextCursor = p.nextCursor;
    return;
  }
  return fail("STORE1_UNHANDLED_READ_PATH");
}

function safePreviewPath(path: string): string {
  return path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    "<ID>",
  );
}

function safePreview(plan: Store1ActivationPlan) {
  if (plan.status === "READ" || plan.status === "POST")
    return {
      method: plan.next.method,
      path: safePreviewPath(plan.next.path),
      purpose: plan.next.purpose,
      executed: false as const,
    };
  if (plan.status === "READY")
    return {
      method: "NONE" as const,
      purpose:
        "Activation plan is already READY; this entry executed no catalog mutation.",
      executed: false as const,
    };
  return {
    method: "NONE" as const,
    purpose: plan.detail,
    executed: false as const,
  };
}

function safeOutput(
  plan: Store1ActivationPlan,
  signaturePreflight?: Store1ActivationReadback["signaturePreflight"],
) {
  return {
    status: plan.status,
    code: "code" in plan ? plan.code : null,
    ...(signaturePreflight
      ? {
          signature: {
            verified: true as const,
            configVersion: signaturePreflight.configVersion,
            expiresAt: signaturePreflight.expiresAt,
          },
        }
      : {}),
    nextActionPreview: safePreview(plan),
    bootstrapMayUpdateDeviceOrAuthState: signaturePreflight !== undefined,
    catalogMutationExecuted: false as const,
  };
}

async function runReadOnlyPlanner(
  input: Store1PreflightOperatorInput,
  evidence: Store1PackageSignatureEvidence,
  credentials: Credentials,
  options: RunOptions,
  verifiedPlanner: VerifiedPlanner,
) {
  const origin = safeOrigin(evidence.controlApiOrigin);
  const readback = await readReviewerState(
    input,
    origin,
    credentials,
    options.fetchImpl,
  );
  if (
    readback.reviewerAccounts?.length !== 1 ||
    readback.reviewerAccountNextCursor !== null ||
    !readback.reviewerAdmission?.admitted ||
    readback.reviewerAdmission.accountId !== readback.reviewerAccounts[0]!.id
  )
    return safeOutput(planStore1Activation(evidence.authority, readback));

  const expectedAccountId = readback.reviewerAdmission.accountId;
  const transport = createStore1FetchTransport(
    {
      controlApiOrigin: origin,
      expectedAccountId,
      ...credentials,
    },
    options.fetchImpl ?? fetch,
  );
  readback.config = await transport.readLatestConfig(
    STORE1_V2_CONFIG_READ_PATH,
  );
  const beforeProof = planStore1Activation(evidence.authority, readback);
  if (
    beforeProof.status !== "BLOCKED" ||
    beforeProof.code !== "STORE1_V2_SIGNATURE_PREFLIGHT_REQUIRED"
  )
    return safeOutput(beforeProof);

  const verified = await verifiedPlanner({
    expectedAccountId,
    deviceId: input.deviceId,
    browserVersion: input.browserVersion,
    readback,
    transport,
    now: options.now,
  });
  readback.signaturePreflight = verified.signaturePreflight;

  for (let step = 0; step < 64; step += 1) {
    const plan = planStore1Activation(evidence.authority, readback);
    if (plan.status === "READ") {
      if (plan.next.method !== "GET") return fail("STORE1_READ_ONLY_INVARIANT");
      const value = await fetchAdminJson(
        origin,
        credentials,
        plan.next.path,
        options.fetchImpl,
      );
      capturePlannerRead(plan.next.path, value, readback);
      continue;
    }
    if (
      plan.status === "BLOCKED" &&
      plan.code === "STORE1_V2_SIGNATURE_PREFLIGHT_STALE"
    )
      return safeOutput(plan, verified.signaturePreflight);
    if (plan.status === "POST" || plan.status === "READY") {
      readback.config = await transport.readLatestConfig(
        STORE1_V2_CONFIG_READ_PATH,
      );
      const checked = planStore1Activation(evidence.authority, readback);
      return safeOutput(checked, verified.signaturePreflight);
    }
    return safeOutput(plan, verified.signaturePreflight);
  }
  return fail("STORE1_READ_ONLY_PLAN_DID_NOT_CONVERGE");
}

export async function runStore1ReadOnlyPreflight(inputValue: unknown) {
  const input = validateInput(inputValue);
  const credentials = readCredentials(input);
  const evidence = await readStore1PackageSignatureEvidence(
    input.manifestPath,
    input.packagePath,
  );
  return runReadOnlyPlanner(
    input,
    evidence,
    credentials,
    {},
    async (verifiedInput) =>
      planStore1ActivationWithVerifiedPreflight({
        manifestPath: input.manifestPath,
        zipPath: input.packagePath,
        ...verifiedInput,
      }),
  );
}

export async function runStore1ReadOnlyPreflightWithEvidenceForTest(
  inputValue: unknown,
  packageEvidence: Store1PackageSignatureEvidence,
  options: RunOptions = {},
) {
  if (process.env.VITEST !== "true")
    return fail("STORE1_TEST_ONLY_PACKAGE_EVIDENCE");
  const input = validateInput(inputValue);
  const credentials = readCredentials(input);
  return runReadOnlyPlanner(
    input,
    packageEvidence,
    credentials,
    options,
    async (verifiedInput) =>
      planStore1ActivationWithVerifiedPreflightForTest({
        packageEvidence,
        ...verifiedInput,
      }),
  );
}

function parseCliArgs(argv: string[]): string {
  if (argv.length !== 2 || argv[0] !== "--input-file")
    fail("STORE1_OPERATOR_USAGE");
  return argv[1]!;
}

async function main() {
  try {
    const argv = process.argv.slice(2);
    if (argv.length === 1 && argv[0] === "--help") {
      process.stdout.write(
        "Usage: pnpm exec tsx tooling/server/store1-preflight-cli.ts --input-file <protected-json>\n" +
          "The JSON file and both credential files must be mode 0600. Credential files contain one token each.\n" +
          "Required JSON keys: manifestPath, packagePath, reviewerEmail, deviceId, browserVersion, adminSessionFile, reviewerDeviceBearerFile.\n" +
          "The no-AI bootstrap POST may update device/auth state; catalog mutations are never executed.\n",
      );
      return;
    }
    const inputPath = parseCliArgs(argv);
    const raw = secureTextFile(
      inputPath,
      "STORE1_OPERATOR_INPUT_FILE_INVALID",
      { singleLine: false },
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail("STORE1_OPERATOR_INPUT_FILE_INVALID");
    }
    const output = await runStore1ReadOnlyPreflight(parsed);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    const code =
      error instanceof Error && /^STORE1_[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : "STORE1_PREFLIGHT_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main();
