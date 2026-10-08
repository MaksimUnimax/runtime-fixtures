import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";
import {
  validateSwaggerBytes,
  type SwaggerSourceFamily,
} from "@product/monitoring-control";
import {
  API_WATCH_MAX_ARTIFACT_BYTES,
  API_WATCH_MAX_REDIRECTS,
  API_WATCH_TIMEOUT_MS,
  type AcquisitionOutcome,
  type ExpectedArtifactType,
  type SourceDocument,
  type SourceRegistryEntry,
} from "./types.js";

type FetchLike = typeof fetch;

function failure(
  entry: SourceRegistryEntry,
  kind: Extract<
    AcquisitionOutcome["kind"],
    | "OPERATOR_SOURCE_REQUIRED"
    | "SOURCE_TEMPORARILY_UNAVAILABLE"
    | "SOURCE_URL_AUTHORITY_MISSING"
    | "INVALID_OFFICIAL_SOURCE_RESPONSE"
  >,
  blockerReason: string,
  httpStatus?: number,
  retryAfterSeconds?: number | null,
): AcquisitionOutcome {
  return {
    kind,
    sourceFamily: entry.sourceFamily,
    officialUrl: entry.officialUrl,
    blockerReason,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function acceptedHosts(entry: SourceRegistryEntry): Set<string> {
  if (!entry.officialUrl && !entry.documents?.length) return new Set();
  const explicit = entry.acceptedHosts?.map((host) => host.toLowerCase());
  return new Set(
    explicit?.length
      ? explicit
      : [
          new URL(
            entry.officialUrl ?? entry.documents![0]!.officialUrl,
          ).hostname.toLowerCase(),
        ],
  );
}

// DNS rebinding cannot be excluded by checking an HTTPS URL hostname alone.
// Vet all answers and pin the selected public address *as the socket lookup*
// while Node verifies the original hostname's TLS certificate. Never perform
// a separate preflight DNS lookup followed by an unpinned fetch.
const forbiddenIpv4 = new BlockList();
for (const [network, mask] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  forbiddenIpv4.addSubnet(network, mask, "ipv4");
}
const publicIpv6Range = new BlockList();
publicIpv6Range.addSubnet("2000::", 3, "ipv6");
const forbiddenIpv6 = new BlockList();
for (const [network, mask] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  // IANA reserves the full 3f00::/8 block, including 3fff::/20
  // (the additional IPv6 documentation prefix).
  ["3f00::", 8],
] as const) {
  forbiddenIpv6.addSubnet(network, mask, "ipv6");
}

export function isPublicOfficialSourceAddress(
  address: string,
  family: 4 | 6,
): boolean {
  if (family === 4)
    return isIP(address) === 4 && !forbiddenIpv4.check(address, "ipv4");
  return (
    family === 6 &&
    isIP(address) === 6 &&
    publicIpv6Range.check(address, "ipv6") &&
    !forbiddenIpv6.check(address, "ipv6")
  );
}

type ResolvedOfficialAddress = { address: string; family: 4 | 6 };

export async function selectVerifiedOfficialAddress(
  hostname: string,
  resolver: (
    host: string,
  ) => Promise<readonly { address: string; family: number }[]> = async (host) =>
    lookup(host, { all: true, order: "verbatim" }),
): Promise<ResolvedOfficialAddress> {
  const values = await resolver(hostname);
  if (
    !Array.isArray(values) ||
    values.length < 1 ||
    values.length > 32 ||
    values.some(
      (record) =>
        (record.family !== 4 && record.family !== 6) ||
        !isPublicOfficialSourceAddress(record.address, record.family as 4 | 6),
    )
  )
    throw new Error("OFFICIAL_SOURCE_DNS_ADDRESS_FORBIDDEN");
  const first = values[0]!;
  return { address: first.address, family: first.family as 4 | 6 };
}

// Per-redirect-hop socket binding is essential: an independent DNS precheck
// cannot prevent the address used by fetch from changing before connection.
// Existing local HTTP fixtures are explicitly scoped by the URL origin guard.
// Injected fetchers are trusted test adapters, never the production transport.
async function pinnedOfficialSourceFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const target = new URL(raw);
  if (target.protocol === "http:" && target.hostname === "127.0.0.1")
    return fetch(input, init);
  if (
    target.protocol !== "https:" ||
    isIP(target.hostname) !== 0 ||
    target.hostname.startsWith("[")
  )
    throw new Error("OFFICIAL_SOURCE_DNS_ADDRESS_FORBIDDEN");

  // A fresh agent/socket for each request also prevents a stale, previously
  // trusted connection from crossing into another redirect authority.
  const agent = new HttpsAgent({
    keepAlive: false,
    autoSelectFamily: false,
    maxCachedSessions: 0,
    lookup(hostname, options, callback) {
      selectVerifiedOfficialAddress(hostname).then(
        ({ address, family }) => {
          if (options.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
        (error: unknown) =>
          callback(
            error instanceof Error
              ? error
              : new Error("OFFICIAL_SOURCE_DNS_FAILED"),
            "",
            4,
          ),
      );
    },
  });
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      target,
      {
        method: "GET",
        signal: init?.signal ?? undefined,
        agent,
        rejectUnauthorized: true,
        headers: { "accept-encoding": "identity" },
      },
      (incoming) => {
        incoming.once("close", () => agent.destroy());
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, value);
            }
          }
          const status = incoming.statusCode ?? 502;
          const noBody = status === 204 || status === 205 || status === 304;
          const stream = noBody
            ? null
            : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>);
          if (noBody) incoming.resume();
          resolve(new Response(stream, { status, headers }));
        } catch (error) {
          incoming.destroy();
          agent.destroy();
          reject(error);
        }
      },
    );
    request.once("error", (error) => {
      agent.destroy();
      reject(error);
    });
    request.end();
  });
}

// acceptedHosts authorizes only a hostname. It does not authorize HTTP
// downgrade, credentials in the authority, or an arbitrary HTTPS port.
// The one permitted plain-HTTP exception is the exact 127.0.0.1 origin
// explicitly entered in a local test/source entry, including its port.
function isTrustedOfficialAuthority(
  official: URL,
  candidate: URL,
  hosts: ReadonlySet<string>,
): boolean {
  if (
    candidate.username !== "" ||
    candidate.password !== "" ||
    official.username !== "" ||
    official.password !== ""
  )
    return false;
  // Test-only local overrides can retain production acceptedHosts via
  // createSourceRegistry. Their explicit 127.0.0.1 officialUrl is the
  // authority for one loopback origin, never for an arbitrary HTTP host
  // or another local port. This does not add hosts to acceptedHosts.
  if (official.protocol === "http:" && official.hostname === "127.0.0.1") {
    return (
      candidate.protocol === "http:" && candidate.origin === official.origin
    );
  }
  return (
    hosts.has(candidate.hostname.toLowerCase()) &&
    official.protocol === "https:" &&
    official.port === "" &&
    isIP(official.hostname) === 0 &&
    !official.hostname.startsWith("[") &&
    candidate.protocol === "https:" &&
    candidate.port === "" &&
    isIP(candidate.hostname) === 0 &&
    !candidate.hostname.startsWith("[")
  );
}

function isOzonAccessControlRedirect(
  entry: SourceRegistryEntry,
  currentUrl: string,
  nextUrl: URL,
): boolean {
  if (
    entry.sourceFamily !== "OZON_SELLER" &&
    entry.sourceFamily !== "OZON_PERFORMANCE"
  )
    return false;
  const current = new URL(currentUrl);
  if (
    current.origin !== nextUrl.origin ||
    current.pathname !== nextUrl.pathname ||
    current.hash ||
    nextUrl.hash
  )
    return false;
  const nextKeys = [...nextUrl.searchParams.keys()];
  if (nextKeys.length !== 1 || nextKeys[0] !== "__rr") return false;
  const nextRaw = nextUrl.searchParams.get("__rr");
  if (!nextRaw || !/^[1-9]\d*$/.test(nextRaw)) return false;
  const next = Number(nextRaw);
  const currentKeys = [...current.searchParams.keys()];
  if (currentKeys.length === 0) return next === 1;
  if (currentKeys.length !== 1 || currentKeys[0] !== "__rr") return false;
  const currentRaw = current.searchParams.get("__rr");
  return Boolean(
    currentRaw &&
      /^[1-9]\d*$/.test(currentRaw) &&
      next === Number(currentRaw) + 1,
  );
}

function artifactTypeFor(url: string): ExpectedArtifactType {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".yaml")) return "YAML";
  if (pathname.endsWith(".yml")) return "YML";
  return "JSON";
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const advertised = response.headers.get("content-length");
  if (advertised && Number(advertised) > maximumBytes)
    throw new Error("SOURCE_TOO_LARGE");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error("SOURCE_TOO_LARGE");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("SOURCE_TOO_LARGE");
        throw new Error("SOURCE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
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

function isAccessControlPage(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes).toLowerCase();
  return /login|sign[ -]?in|access denied|captcha|cloudflare|bot detection|unauthorized/.test(
    text,
  );
}

function isHtml(response: Response, bytes: Uint8Array): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) return true;
  const prefix = new TextDecoder()
    .decode(bytes.slice(0, 512))
    .trimStart()
    .toLowerCase();
  return prefix.startsWith("<!doctype html") || prefix.startsWith("<html");
}

export async function acquireOfficialSource(input: {
  entry: SourceRegistryEntry;
  document?: SourceDocument;
  fetcher?: FetchLike;
  timeoutMs?: number;
  maxRedirects?: number;
}): Promise<AcquisitionOutcome> {
  const { entry } = input;
  const document = input.document;
  const officialUrl = document?.officialUrl ?? entry.officialUrl;
  if (!officialUrl)
    return failure(
      entry,
      "SOURCE_URL_AUTHORITY_MISSING",
      "Accepted official URL authority is not present in the repository registry.",
    );
  let official: URL;
  let hosts: Set<string>;
  try {
    official = new URL(officialUrl);
    hosts = acceptedHosts(entry);
  } catch {
    return failure(
      entry,
      "INVALID_OFFICIAL_SOURCE_RESPONSE",
      "Official source URL is not a valid accepted HTTPS authority.",
    );
  }
  if (!isTrustedOfficialAuthority(official, official, hosts))
    return failure(
      entry,
      "INVALID_OFFICIAL_SOURCE_RESPONSE",
      "Official source URL scheme or authority is not trusted.",
    );
  const fetcher = input.fetcher ?? pinnedOfficialSourceFetch;
  const timeoutMs = input.timeoutMs ?? API_WATCH_TIMEOUT_MS;
  const maxRedirects = input.maxRedirects ?? API_WATCH_MAX_REDIRECTS;
  let currentUrl = officialUrl;
  let redirects = 0;
  let consecutiveOzonAccessControlRedirects = 0;
  let response: Response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    while (true) {
      response = await fetcher(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) {
        clearTimeout(timer);
        return failure(
          entry,
          "INVALID_OFFICIAL_SOURCE_RESPONSE",
          "Redirect policy rejected the response.",
          response.status,
        );
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(location, currentUrl);
      } catch {
        clearTimeout(timer);
        return failure(
          entry,
          "INVALID_OFFICIAL_SOURCE_RESPONSE",
          "Redirect location is not a valid official URL.",
          response.status,
        );
      }
      if (!isTrustedOfficialAuthority(official, nextUrl, hosts)) {
        clearTimeout(timer);
        return failure(
          entry,
          "INVALID_OFFICIAL_SOURCE_RESPONSE",
          "Redirect left the accepted official HTTPS authority policy.",
          response.status,
        );
      }
      const ozonAccessControlRedirect = isOzonAccessControlRedirect(
        entry,
        currentUrl,
        nextUrl,
      );
      consecutiveOzonAccessControlRedirects = ozonAccessControlRedirect
        ? consecutiveOzonAccessControlRedirects + 1
        : 0;
      if (redirects >= maxRedirects) {
        clearTimeout(timer);
        return consecutiveOzonAccessControlRedirects >= maxRedirects + 1
          ? failure(
              entry,
              "OPERATOR_SOURCE_REQUIRED",
              "Official Ozon documentation is behind an access-control redirect loop; an official operator-supplied source is required.",
              response.status,
            )
          : failure(
              entry,
              "INVALID_OFFICIAL_SOURCE_RESPONSE",
              "Redirect policy rejected the response.",
              response.status,
            );
      }
      redirects += 1;
      await response.body?.cancel().catch(() => undefined);
      currentUrl = nextUrl.toString();
    }
  } catch (error) {
    clearTimeout(timer);
    return failure(
      entry,
      "SOURCE_TEMPORARILY_UNAVAILABLE",
      error instanceof DOMException && error.name === "AbortError"
        ? "Official source acquisition timed out."
        : "Official source network acquisition failed.",
    );
  }

  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 498
  ) {
    clearTimeout(timer);
    return failure(
      entry,
      "OPERATOR_SOURCE_REQUIRED",
      "Official source requires legitimate operator access.",
      response.status,
    );
  }
  if (response.status === 429 || response.status >= 500) {
    clearTimeout(timer);
    const retryAfter = response.headers.get("retry-after");
    const parsedRetryAfter =
      retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())
        ? Number(retryAfter)
        : null;
    return failure(
      entry,
      "SOURCE_TEMPORARILY_UNAVAILABLE",
      "Official source returned a transient response.",
      response.status,
      parsedRetryAfter,
    );
  }
  if (!response.ok) {
    clearTimeout(timer);
    return failure(
      entry,
      "INVALID_OFFICIAL_SOURCE_RESPONSE",
      "Official source returned an unexpected HTTP response.",
      response.status,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(
      response,
      Math.min(entry.maximumBytes, API_WATCH_MAX_ARTIFACT_BYTES),
    );
  } catch (error) {
    if (controller.signal.aborted)
      return failure(
        entry,
        "SOURCE_TEMPORARILY_UNAVAILABLE",
        "Official source acquisition timed out.",
        response.status,
      );
    return failure(
      entry,
      "INVALID_OFFICIAL_SOURCE_RESPONSE",
      error instanceof Error && error.message === "SOURCE_TOO_LARGE"
        ? "Official source exceeded the bounded artifact size."
        : "Official source body could not be read safely.",
      response.status,
    );
  } finally {
    clearTimeout(timer);
  }
  if (isHtml(response, bytes)) {
    return isAccessControlPage(bytes)
      ? failure(
          entry,
          "OPERATOR_SOURCE_REQUIRED",
          "Official source returned an access-control page.",
          response.status,
        )
      : failure(
          entry,
          "INVALID_OFFICIAL_SOURCE_RESPONSE",
          "Official source returned HTML instead of an API document.",
          response.status,
        );
  }

  const artifactType = artifactTypeFor(currentUrl);
  const extension =
    artifactType === "JSON"
      ? ".json"
      : artifactType === "YAML"
        ? ".yaml"
        : ".yml";
  try {
    const validation = validateSwaggerBytes(
      bytes,
      `official${extension}`,
      Math.min(entry.maximumBytes, API_WATCH_MAX_ARTIFACT_BYTES),
    );
    if (entry.requiredServerIdentity) {
      const servers = Array.isArray(validation.document.root.servers)
        ? validation.document.root.servers
            .filter(
              (server): server is Record<string, unknown> =>
                Boolean(server) && typeof server === "object",
            )
            .map((server) => server.url)
            .filter((url): url is string => typeof url === "string")
        : [];
      if (!servers.some((server) => server === entry.requiredServerIdentity))
        throw new Error("SOURCE_SERVER_IDENTITY_MISMATCH");
    }
    if (entry.titlePattern) {
      const info = validation.document.root.info;
      const title =
        info &&
        typeof info === "object" &&
        !Array.isArray(info) &&
        typeof (info as Record<string, unknown>).title === "string"
          ? (info as Record<string, unknown>).title
          : "";
      if (!entry.titlePattern.test(typeof title === "string" ? title : ""))
        throw new Error("SOURCE_TITLE_IDENTITY_MISMATCH");
    }
    return {
      kind: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
      sourceFamily: entry.sourceFamily,
      officialUrl,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      specVersion: validation.detectedSpecVersion,
      artifactType,
      finalUrl: currentUrl,
      parserResult: validation.parserResult,
      validationResult: validation.validationResult,
      documentKey: document?.documentKey ?? null,
    };
  } catch (error) {
    return failure(
      entry,
      "INVALID_OFFICIAL_SOURCE_RESPONSE",
      error instanceof Error
        ? error.message
        : "Official source document validation failed.",
      response.status,
    );
  }
}

export function sourceFamilyOf(
  outcome: AcquisitionOutcome,
): SwaggerSourceFamily {
  return outcome.sourceFamily;
}
