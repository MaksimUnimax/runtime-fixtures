import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { SemVerV1Schema } from "../../packages/shared/src/index.js";
import {
  STORE1_AI_SURFACE,
  STORE1_BROWSER,
  STORE1_BROWSER_MINIMUM,
  STORE1_POLICY_KEY,
  STORE1_PROFILE_KEY,
  STORE1_PROFILE_SHA256,
} from "./store1-opera-admin-activation.js";

const HASH = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const ADAPTER_KEY = "chatgpt" as const;

type CandidateManifest = {
  schemaVersion?: unknown;
  source?: { head?: unknown; tree?: unknown };
  productVersion?: unknown;
  contractVersion?: unknown;
  migrationLevel?: unknown;
  packages?: {
    chromium?: {
      filename?: unknown;
      sha256?: unknown;
      bytes?: unknown;
      version?: unknown;
      browser?: unknown;
    };
  };
};

export type StoreReleaseTransitionTarget = {
  source: { head: string; tree: string };
  productVersion: string;
  contractVersion: "control_plane_v2";
  migrationLevel: number;
  artifactSha256: string;
  packageFilename: string;
  packageBytes: number;
  browserFamily: typeof STORE1_BROWSER;
  minimumBrowserVersion: typeof STORE1_BROWSER_MINIMUM;
  policyKey: typeof STORE1_POLICY_KEY;
  adapterKey: typeof ADAPTER_KEY;
  surfaceKey: typeof STORE1_AI_SURFACE;
  profileKey: typeof STORE1_PROFILE_KEY;
  profileContentSha256: string;
};

export type TransitionRelease = {
  version: string;
  releaseChannel: string;
  artifactSha256: string | null;
  supportedContracts: string[];
  supportedBrowsers: string[];
  browserArtifacts?: Array<{
    browserFamily: string;
    artifactSha256: string | null;
  }>;
};

type EffectiveArtifact =
  | { ok: true; artifactSha256: string }
  | { ok: false; code: string };

export function classifyReleaseArtifact(
  release: TransitionRelease,
  browserFamily: string,
): EffectiveArtifact {
  const rows = release.browserArtifacts;
  if (!rows) return { ok: false, code: "RELEASE_ARTIFACT_MODE_UNAVAILABLE" };
  const families = rows.map((row) => row.browserFamily);
  if (
    new Set(families).size !== families.length ||
    new Set(release.supportedBrowsers).size !==
      release.supportedBrowsers.length ||
    families.length !== release.supportedBrowsers.length ||
    release.supportedBrowsers.some((family) => !families.includes(family))
  )
    return { ok: false, code: "RELEASE_ARTIFACT_BROWSER_SET_INVALID" };
  if (release.artifactSha256 !== null) {
    if (rows.some((row) => row.artifactSha256 !== null))
      return { ok: false, code: "RELEASE_ARTIFACT_MODE_MIXED" };
    if (!HASH.test(release.artifactSha256))
      return { ok: false, code: "RELEASE_ARTIFACT_DIGEST_INVALID" };
    return { ok: true, artifactSha256: release.artifactSha256 };
  }
  if (
    rows.some(
      (row) => row.artifactSha256 !== null && !HASH.test(row.artifactSha256),
    )
  )
    return { ok: false, code: "RELEASE_ARTIFACT_DIGEST_INVALID" };
  if (rows.every((row) => row.artifactSha256 === null))
    return { ok: false, code: "RELEASE_ARTIFACT_UNBOUND" };
  if (rows.some((row) => row.artifactSha256 === null))
    return { ok: false, code: "RELEASE_ARTIFACT_BROWSER_SET_PARTIAL" };
  const selected = rows.find((row) => row.browserFamily === browserFamily);
  if (!selected) return { ok: false, code: "RELEASE_BROWSER_UNSUPPORTED" };
  return { ok: true, artifactSha256: selected.artifactSha256! };
}

export type TransitionPolicy = {
  id: string;
  policyKey: string;
  revision: number;
  contractVersion: string;
  browserFamily: string | null;
  minimumExtensionVersion: string | null;
  recommendedExtensionVersion: string | null;
  minimumBrowserVersion: string | null;
  maintenanceMode: boolean;
  maintenanceCode: string | null;
  blockedVersions: string[];
  linkedConfigVersions: number[];
};

export type TransitionConfig = {
  configVersion: number;
  contractVersion: string;
  snapshotVersion: string;
  envelopeVersion: string;
  signingKeyId: string;
  signingKeyState: string;
  compatibilityPolicyRevisionIds: string[];
};

export type RegistryEntity = {
  id: string;
  machineKey: string;
  status: string;
  adapterId?: string;
  surfaceId?: string;
  variantId?: string | null;
};

export type ProfileRevision = {
  id: string;
  revision: number;
  state: string;
  contentSha256: string;
};

export type Assignment = {
  id: string;
  adapterId: string;
  surfaceId: string;
  variantId: string | null;
  browserFamily: string;
  subjectKind: string;
  latest: null | {
    revision: number;
    mode: string;
    baselineProfileRevisionId: string;
    candidateProfileRevisionId: string | null;
    percentageBps: number;
  };
};

export type StoreReleaseTransitionCatalog = {
  release?: TransitionRelease | null;
  policies?: TransitionPolicy[];
  config?: TransitionConfig | null;
  adapters?: RegistryEntity[];
  surfaces?: RegistryEntity[];
  profiles?: RegistryEntity[];
  profileRevisions?: ProfileRevision[];
  assignments?: Assignment[];
  errors: Array<{ scope: string; code: string }>;
};

export type TransitionCheck = {
  component:
    | "release"
    | "policy"
    | "config"
    | "adapter"
    | "surface"
    | "profile"
    | "profileRevision"
    | "assignment";
  status: "READY" | "MISMATCH" | "UNKNOWN";
  code: string;
  detail: string;
};

export type StoreReleaseTransitionReport = {
  schemaVersion: "store_release_transition_preflight_v1";
  status: "READY" | "MISMATCH" | "UNKNOWN";
  readOnly: true;
  catalogMutationExecuted: false;
  target: StoreReleaseTransitionTarget;
  checks: TransitionCheck[];
  mismatches: TransitionCheck[];
};

export type ReadOnlyJsonGet = (
  path: string,
) => Promise<{ status: number; body: unknown }>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(code);
  return value;
}

export function readStoreReleaseTransitionTarget(
  manifestPath: string,
  zipPath?: string,
): StoreReleaseTransitionTarget {
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as CandidateManifest;
  const pkg = manifest.packages?.chromium;
  const productVersion = requiredString(
    manifest.productVersion,
    "RELEASE_TRANSITION_MANIFEST_VERSION_REQUIRED",
  );
  if (!SemVerV1Schema.safeParse(productVersion).success)
    throw new Error("RELEASE_TRANSITION_MANIFEST_VERSION_INVALID");
  const contractVersion = requiredString(
    manifest.contractVersion,
    "RELEASE_TRANSITION_MANIFEST_CONTRACT_REQUIRED",
  );
  if (
    manifest.schemaVersion !== "b1_release_candidate_v2" ||
    contractVersion !== "control_plane_v2" ||
    typeof manifest.migrationLevel !== "number" ||
    !Number.isInteger(manifest.migrationLevel) ||
    !GIT_SHA.test(String(manifest.source?.head ?? "")) ||
    !GIT_SHA.test(String(manifest.source?.tree ?? "")) ||
    pkg?.browser !== "chromium" ||
    pkg.version !== productVersion ||
    typeof pkg.filename !== "string" ||
    !HASH.test(String(pkg.sha256 ?? "")) ||
    typeof pkg.bytes !== "number" ||
    !Number.isSafeInteger(pkg.bytes) ||
    pkg.bytes <= 0
  )
    throw new Error("RELEASE_TRANSITION_MANIFEST_INVALID");

  if (zipPath) {
    const bytes = readFileSync(zipPath);
    if (
      basename(zipPath) !== pkg.filename ||
      bytes.length !== pkg.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== pkg.sha256
    )
      throw new Error("RELEASE_TRANSITION_PACKAGE_MISMATCH");
  }

  return {
    source: {
      head: manifest.source!.head as string,
      tree: manifest.source!.tree as string,
    },
    productVersion,
    contractVersion: "control_plane_v2",
    migrationLevel: manifest.migrationLevel,
    artifactSha256: pkg.sha256 as string,
    packageFilename: pkg.filename,
    packageBytes: pkg.bytes,
    browserFamily: STORE1_BROWSER,
    minimumBrowserVersion: STORE1_BROWSER_MINIMUM,
    policyKey: STORE1_POLICY_KEY,
    adapterKey: ADAPTER_KEY,
    surfaceKey: STORE1_AI_SURFACE,
    profileKey: STORE1_PROFILE_KEY,
    profileContentSha256: STORE1_PROFILE_SHA256,
  };
}

function exactOne<T>(
  values: T[],
  predicate: (value: T) => boolean,
): { kind: "one"; value: T } | { kind: "missing" } | { kind: "conflict" } {
  const matches = values.filter(predicate);
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) return { kind: "conflict" };
  return { kind: "one", value: matches[0]! };
}

function check(
  checks: TransitionCheck[],
  component: TransitionCheck["component"],
  status: TransitionCheck["status"],
  code: string,
  detail: string,
): void {
  checks.push({ component, status, code, detail });
}

function unknown(
  catalog: StoreReleaseTransitionCatalog,
  scope: string,
  component: TransitionCheck["component"],
  checks: TransitionCheck[],
): boolean {
  const issue = catalog.errors.find((item) => item.scope === scope);
  if (!issue) return false;
  check(
    checks,
    component,
    "UNKNOWN",
    issue.code,
    scope + " readback is unavailable.",
  );
  return true;
}

export function analyzeStoreReleaseTransition(
  target: StoreReleaseTransitionTarget,
  catalog: StoreReleaseTransitionCatalog,
): StoreReleaseTransitionReport {
  const checks: TransitionCheck[] = [];

  if (!unknown(catalog, "release", "release", checks)) {
    const release = catalog.release;
    const effective = release
      ? classifyReleaseArtifact(release, target.browserFamily)
      : null;
    if (!release)
      check(
        checks,
        "release",
        "MISMATCH",
        "RELEASE_MISSING",
        "Target release is not published.",
      );
    else if (
      release.version !== target.productVersion ||
      release.releaseChannel !== "stable" ||
      !effective?.ok ||
      (effective.ok && effective.artifactSha256 !== target.artifactSha256) ||
      !release.supportedContracts.includes(target.contractVersion) ||
      !release.supportedBrowsers.includes(target.browserFamily)
    )
      check(
        checks,
        "release",
        "MISMATCH",
        effective && !effective.ok ? effective.code : "RELEASE_CONFLICT",
        "Published release does not bind the exact candidate package and STORE scope.",
      );
    else
      check(
        checks,
        "release",
        "READY",
        "RELEASE_READY",
        "Exact immutable release is present.",
      );
  }

  let targetPolicy: TransitionPolicy | null = null;
  if (!unknown(catalog, "policies", "policy", checks)) {
    const policies = [...(catalog.policies ?? [])]
      .filter(
        (value) =>
          value.policyKey === target.policyKey &&
          value.contractVersion === target.contractVersion &&
          value.browserFamily === target.browserFamily,
      )
      .sort((left, right) => right.revision - left.revision);
    const latest = policies[0] ?? null;
    if (!latest)
      check(
        checks,
        "policy",
        "MISMATCH",
        "POLICY_MISSING",
        "Target compatibility policy scope is missing.",
      );
    else if (
      latest.minimumExtensionVersion !== target.productVersion ||
      latest.recommendedExtensionVersion !== target.productVersion ||
      latest.minimumBrowserVersion !== target.minimumBrowserVersion ||
      latest.maintenanceMode ||
      latest.maintenanceCode !== null ||
      latest.blockedVersions.length !== 0
    )
      check(
        checks,
        "policy",
        "MISMATCH",
        "POLICY_TARGET_MISMATCH",
        "Latest STORE policy does not describe the exact candidate version and normal browser state.",
      );
    else {
      targetPolicy = latest;
      check(
        checks,
        "policy",
        "READY",
        "POLICY_READY",
        "Exact target policy revision is present.",
      );
    }
  }

  if (!unknown(catalog, "config", "config", checks)) {
    const config = catalog.config;
    if (!config)
      check(
        checks,
        "config",
        "MISMATCH",
        "CONFIG_MISSING",
        "No target-contract config release exists.",
      );
    else if (
      config.contractVersion !== target.contractVersion ||
      config.snapshotVersion !== "bootstrap_snapshot_v2" ||
      config.envelopeVersion !== "bootstrap_envelope_v2" ||
      config.signingKeyState !== "ACTIVE"
    )
      check(
        checks,
        "config",
        "MISMATCH",
        "CONFIG_CONFLICT",
        "Latest config has incompatible contract/envelope/signing authority.",
      );
    else if (!targetPolicy)
      check(
        checks,
        "config",
        "MISMATCH",
        "CONFIG_TARGET_POLICY_UNAVAILABLE",
        "Config cannot be proven target-ready until the exact target policy exists.",
      );
    else if (!config.compatibilityPolicyRevisionIds.includes(targetPolicy.id))
      check(
        checks,
        "config",
        "MISMATCH",
        "CONFIG_POLICY_LINK_MISSING",
        "Latest config does not link the exact target policy revision.",
      );
    else
      check(
        checks,
        "config",
        "READY",
        "CONFIG_READY",
        "Latest signed config links the target policy.",
      );
  }

  let adapter: RegistryEntity | null = null;
  if (!unknown(catalog, "adapters", "adapter", checks)) {
    const found = exactOne(
      catalog.adapters ?? [],
      (value) => value.machineKey === target.adapterKey,
    );
    if (found.kind === "missing")
      check(
        checks,
        "adapter",
        "MISMATCH",
        "ADAPTER_MISSING",
        "ChatGPT adapter is missing.",
      );
    else if (found.kind === "conflict")
      check(
        checks,
        "adapter",
        "MISMATCH",
        "ADAPTER_CONFLICT",
        "Multiple ChatGPT adapters exist.",
      );
    else if (found.value.status !== "ACTIVE")
      check(
        checks,
        "adapter",
        "MISMATCH",
        "ADAPTER_DISABLED",
        "ChatGPT adapter is not ACTIVE.",
      );
    else {
      adapter = found.value;
      check(
        checks,
        "adapter",
        "READY",
        "ADAPTER_READY",
        "ChatGPT adapter is ACTIVE.",
      );
    }
  }

  let surface: RegistryEntity | null = null;
  if (!adapter)
    check(
      checks,
      "surface",
      "MISMATCH",
      "SURFACE_DEPENDENCY_UNAVAILABLE",
      "Web surface cannot be proven until one active ChatGPT adapter exists.",
    );
  else if (!unknown(catalog, "surfaces", "surface", checks)) {
    const found = exactOne(
      catalog.surfaces ?? [],
      (value) =>
        value.machineKey === target.surfaceKey &&
        value.adapterId === adapter!.id,
    );
    if (found.kind === "missing")
      check(
        checks,
        "surface",
        "MISMATCH",
        "SURFACE_MISSING",
        "ChatGPT web surface is missing.",
      );
    else if (found.kind === "conflict")
      check(
        checks,
        "surface",
        "MISMATCH",
        "SURFACE_CONFLICT",
        "Multiple ChatGPT web surfaces exist.",
      );
    else if (found.value.status !== "ACTIVE")
      check(
        checks,
        "surface",
        "MISMATCH",
        "SURFACE_DISABLED",
        "ChatGPT web surface is not ACTIVE.",
      );
    else {
      surface = found.value;
      check(
        checks,
        "surface",
        "READY",
        "SURFACE_READY",
        "ChatGPT web surface is ACTIVE.",
      );
    }
  }

  let profile: RegistryEntity | null = null;
  if (!adapter || !surface)
    check(
      checks,
      "profile",
      "MISMATCH",
      "PROFILE_DEPENDENCY_UNAVAILABLE",
      "Target profile cannot be proven until adapter and surface are exact.",
    );
  else if (!unknown(catalog, "profiles", "profile", checks)) {
    const found = exactOne(
      catalog.profiles ?? [],
      (value) =>
        value.machineKey === target.profileKey &&
        value.adapterId === adapter!.id &&
        value.surfaceId === surface!.id &&
        (value.variantId ?? null) === null,
    );
    if (found.kind === "missing")
      check(
        checks,
        "profile",
        "MISMATCH",
        "PROFILE_MISSING",
        "Target STORE profile identity is missing.",
      );
    else if (found.kind === "conflict")
      check(
        checks,
        "profile",
        "MISMATCH",
        "PROFILE_CONFLICT",
        "Multiple target STORE profiles exist.",
      );
    else if (found.value.status !== "ACTIVE")
      check(
        checks,
        "profile",
        "MISMATCH",
        "PROFILE_DISABLED",
        "Target STORE profile is not ACTIVE.",
      );
    else {
      profile = found.value;
      check(
        checks,
        "profile",
        "READY",
        "PROFILE_READY",
        "Target STORE profile identity is ACTIVE.",
      );
    }
  }
  let revision: ProfileRevision | null = null;
  if (!profile)
    check(
      checks,
      "profileRevision",
      "MISMATCH",
      "PROFILE_REVISION_DEPENDENCY_UNAVAILABLE",
      "Target profile revision cannot be proven until profile identity is exact.",
    );
  else if (!unknown(catalog, "profileRevisions", "profileRevision", checks)) {
    const found = exactOne(
      catalog.profileRevisions ?? [],
      (value) => value.contentSha256 === target.profileContentSha256,
    );
    if (found.kind === "missing")
      check(
        checks,
        "profileRevision",
        "MISMATCH",
        "PROFILE_TARGET_REVISION_MISSING",
        "No revision binds the existing STORE profile content to the target extension version.",
      );
    else if (found.kind === "conflict")
      check(
        checks,
        "profileRevision",
        "MISMATCH",
        "PROFILE_TARGET_REVISION_CONFLICT",
        "Multiple revisions share the exact target profile fingerprint.",
      );
    else if (found.value.state !== "PUBLISHED")
      check(
        checks,
        "profileRevision",
        "MISMATCH",
        "PROFILE_TARGET_REVISION_NOT_PUBLISHED",
        "Exact target profile revision is not PUBLISHED.",
      );
    else {
      revision = found.value;
      check(
        checks,
        "profileRevision",
        "READY",
        "PROFILE_REVISION_READY",
        "Exact target profile revision is PUBLISHED.",
      );
    }
  }

  if (!adapter || !surface || !revision)
    check(
      checks,
      "assignment",
      "MISMATCH",
      "ASSIGNMENT_DEPENDENCY_UNAVAILABLE",
      "Assignment cannot be proven until adapter, surface and target profile revision are exact.",
    );
  else if (!unknown(catalog, "assignments", "assignment", checks)) {
    const found = exactOne(
      catalog.assignments ?? [],
      (value) =>
        value.adapterId === adapter!.id &&
        value.surfaceId === surface!.id &&
        value.variantId === null &&
        value.browserFamily === target.browserFamily &&
        value.subjectKind === "ACCOUNT",
    );
    if (found.kind === "missing")
      check(
        checks,
        "assignment",
        "MISMATCH",
        "ASSIGNMENT_MISSING",
        "Opera account assignment is missing.",
      );
    else if (found.kind === "conflict")
      check(
        checks,
        "assignment",
        "MISMATCH",
        "ASSIGNMENT_CONFLICT",
        "Multiple exact Opera account assignments exist.",
      );
    else if (
      found.value.latest?.mode !== "DIRECT" ||
      found.value.latest.baselineProfileRevisionId !== revision.id ||
      found.value.latest.candidateProfileRevisionId !== null ||
      found.value.latest.percentageBps !== 0
    )
      check(
        checks,
        "assignment",
        "MISMATCH",
        "ASSIGNMENT_TARGET_MISMATCH",
        "Latest assignment does not DIRECT-select the target profile revision.",
      );
    else
      check(
        checks,
        "assignment",
        "READY",
        "ASSIGNMENT_READY",
        "Exact DIRECT assignment selects the target profile revision.",
      );
  }

  const mismatches = checks.filter((item) => item.status !== "READY");
  const status = mismatches.some((item) => item.status === "UNKNOWN")
    ? "UNKNOWN"
    : mismatches.length
      ? "MISMATCH"
      : "READY";
  return {
    schemaVersion: "store_release_transition_preflight_v1",
    status,
    readOnly: true,
    catalogMutationExecuted: false,
    target,
    checks,
    mismatches,
  };
}

function addCursor(path: string, cursor: string): string {
  const url = new URL(path, "https://octoport.invalid");
  url.searchParams.set("cursor", cursor);
  return url.pathname + url.search;
}

async function readPage<T>(
  scope: string,
  initialPath: string,
  get: ReadOnlyJsonGet,
  errors: StoreReleaseTransitionCatalog["errors"],
): Promise<T[] | undefined> {
  const items: T[] = [];
  let path = initialPath;
  for (let page = 0; page < 100; page += 1) {
    const response = await get(path);
    if (response.status !== 200) {
      errors.push({
        scope,
        code: scope.toUpperCase() + "_HTTP_" + response.status,
      });
      return undefined;
    }
    const body = record(response.body);
    if (!body || !Array.isArray(body.items)) {
      errors.push({ scope, code: scope.toUpperCase() + "_RESPONSE_INVALID" });
      return undefined;
    }
    items.push(...(body.items as T[]));
    const next = body.nextCursor;
    if (next === null || next === undefined) return items;
    if (typeof next !== "string" || next.length === 0) {
      errors.push({ scope, code: scope.toUpperCase() + "_CURSOR_INVALID" });
      return undefined;
    }
    path = addCursor(initialPath, next);
  }
  errors.push({ scope, code: scope.toUpperCase() + "_PAGINATION_LIMIT" });
  return undefined;
}

async function readOne<T>(
  scope: string,
  path: string,
  get: ReadOnlyJsonGet,
  errors: StoreReleaseTransitionCatalog["errors"],
): Promise<T | null | undefined> {
  const response = await get(path);
  if (response.status === 404) return null;
  if (response.status !== 200) {
    errors.push({
      scope,
      code: scope.toUpperCase() + "_HTTP_" + response.status,
    });
    return undefined;
  }
  if (!record(response.body)) {
    errors.push({ scope, code: scope.toUpperCase() + "_RESPONSE_INVALID" });
    return undefined;
  }
  return response.body as T;
}

export async function collectStoreReleaseTransitionCatalog(
  target: StoreReleaseTransitionTarget,
  get: ReadOnlyJsonGet,
): Promise<StoreReleaseTransitionCatalog> {
  const errors: StoreReleaseTransitionCatalog["errors"] = [];
  const catalog: StoreReleaseTransitionCatalog = { errors };

  catalog.release = await readOne<TransitionRelease>(
    "release",
    "/v1/admin/compatibility/releases/" +
      encodeURIComponent(target.productVersion),
    get,
    errors,
  );
  catalog.policies = await readPage<TransitionPolicy>(
    "policies",
    "/v1/admin/compatibility/policies?contractVersion=" +
      encodeURIComponent(target.contractVersion) +
      "&policyKey=" +
      encodeURIComponent(target.policyKey) +
      "&scope=" +
      encodeURIComponent(target.browserFamily) +
      "&limit=100",
    get,
    errors,
  );
  catalog.config = await readOne<TransitionConfig>(
    "config",
    "/v1/admin/compatibility/config-releases/latest?contractVersion=" +
      encodeURIComponent(target.contractVersion),
    get,
    errors,
  );
  catalog.adapters = await readPage<RegistryEntity>(
    "adapters",
    "/v1/admin/ai/registry/adapters?limit=100",
    get,
    errors,
  );

  const adapter = exactOne(
    catalog.adapters ?? [],
    (value) => value.machineKey === target.adapterKey,
  );
  if (adapter.kind !== "one") return catalog;

  catalog.surfaces = await readPage<RegistryEntity>(
    "surfaces",
    "/v1/admin/ai/registry/adapters/" +
      encodeURIComponent(adapter.value.id) +
      "/surfaces?limit=100",
    get,
    errors,
  );
  const surface = exactOne(
    catalog.surfaces ?? [],
    (value) =>
      value.machineKey === target.surfaceKey &&
      value.adapterId === adapter.value.id,
  );
  if (surface.kind !== "one") return catalog;

  catalog.profiles = await readPage<RegistryEntity>(
    "profiles",
    "/v1/admin/ai/profiles?adapterId=" +
      encodeURIComponent(adapter.value.id) +
      "&surfaceId=" +
      encodeURIComponent(surface.value.id) +
      "&limit=100",
    get,
    errors,
  );
  const profile = exactOne(
    catalog.profiles ?? [],
    (value) =>
      value.machineKey === target.profileKey &&
      value.adapterId === adapter.value.id &&
      value.surfaceId === surface.value.id &&
      (value.variantId ?? null) === null,
  );
  if (profile.kind === "one")
    catalog.profileRevisions = await readPage<ProfileRevision>(
      "profileRevisions",
      "/v1/admin/ai/profiles/" +
        encodeURIComponent(profile.value.id) +
        "/revisions?limit=100",
      get,
      errors,
    );

  catalog.assignments = await readPage<Assignment>(
    "assignments",
    "/v1/admin/ai/assignments?adapterId=" +
      encodeURIComponent(adapter.value.id) +
      "&surfaceId=" +
      encodeURIComponent(surface.value.id) +
      "&browserFamily=" +
      encodeURIComponent(target.browserFamily) +
      "&subjectKind=ACCOUNT&limit=100",
    get,
    errors,
  );
  return catalog;
}

export async function runStoreReleaseTransitionPreflight(
  target: StoreReleaseTransitionTarget,
  get: ReadOnlyJsonGet,
): Promise<StoreReleaseTransitionReport> {
  return analyzeStoreReleaseTransition(
    target,
    await collectStoreReleaseTransitionCatalog(target, get),
  );
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    )
  )
    throw new Error("RELEASE_TRANSITION_ORIGIN_REJECTED");
  return url.origin;
}

function httpGet(origin: string, adminSessionFile: string): ReadOnlyJsonGet {
  const session = readFileSync(adminSessionFile, "utf8").trim();
  if (session.length < 20)
    throw new Error("RELEASE_TRANSITION_ADMIN_SESSION_INVALID");

  return async (path) => {
    const response = await fetch(new URL(path, origin + "/"), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: {
        accept: "application/json",
        cookie: "pcp_admin_session=" + session,
      },
    });
    if (response.status >= 300 && response.status < 400)
      return {
        status: response.status,
        body: { code: "REDIRECT_REJECTED" },
      };

    const text = await response.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { code: "NON_JSON_RESPONSE" };
      }
    }
    return { status: response.status, body };
  };
}

async function main(): Promise<void> {
  if (process.argv[2] !== "inspect")
    throw new Error(
      "Usage: tsx tooling/server/store-release-transition-preflight.ts inspect --manifest <B1_RC_MANIFEST.json> --zip <store zip> --origin <api origin> --admin-session-file <path>",
    );

  const manifest = arg("--manifest");
  const zip = arg("--zip");
  const origin = arg("--origin");
  const adminSessionFile = arg("--admin-session-file");
  if (!manifest || !zip || !origin || !adminSessionFile)
    throw new Error("RELEASE_TRANSITION_INPUT_REQUIRED");

  const target = readStoreReleaseTransitionTarget(manifest, zip);
  const report = await runStoreReleaseTransitionPreflight(
    target,
    httpGet(safeOrigin(origin), adminSessionFile),
  );
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (report.status !== "READY") process.exitCode = 2;
}

if (process.argv[1]?.endsWith("store-release-transition-preflight.ts")) {
  main().catch((error) => {
    process.stderr.write(
      (error instanceof Error
        ? error.message
        : "RELEASE_TRANSITION_PREFLIGHT_FAILED") + "\n",
    );
    process.exitCode = 1;
  });
}
