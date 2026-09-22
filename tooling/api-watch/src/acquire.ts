import { createHash } from "node:crypto";
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
  if (!entry.officialUrl) return new Set();
  const explicit = entry.acceptedHosts?.map((host) => host.toLowerCase());
  return new Set(
    explicit?.length
      ? explicit
      : [new URL(entry.officialUrl).hostname.toLowerCase()],
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
  fetcher?: FetchLike;
  timeoutMs?: number;
  maxRedirects?: number;
}): Promise<AcquisitionOutcome> {
  const { entry } = input;
  if (!entry.officialUrl)
    return failure(
      entry,
      "SOURCE_URL_AUTHORITY_MISSING",
      "Accepted official URL authority is not present in the repository registry.",
    );
  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = input.timeoutMs ?? API_WATCH_TIMEOUT_MS;
  const maxRedirects = input.maxRedirects ?? API_WATCH_MAX_REDIRECTS;
  const hosts = acceptedHosts(entry);
  let currentUrl = entry.officialUrl;
  let redirects = 0;
  let response: Response;
  try {
    while (true) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetcher(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirects >= maxRedirects)
        return failure(
          entry,
          "INVALID_OFFICIAL_SOURCE_RESPONSE",
          "Redirect policy rejected the response.",
          response.status,
        );
      const nextUrl = new URL(location, currentUrl);
      if (!hosts.has(nextUrl.hostname.toLowerCase()))
        return failure(
          entry,
          "INVALID_OFFICIAL_SOURCE_RESPONSE",
          "Redirect left the accepted official host set.",
          response.status,
        );
      redirects += 1;
      currentUrl = nextUrl.toString();
    }
  } catch (error) {
    return failure(
      entry,
      "SOURCE_TEMPORARILY_UNAVAILABLE",
      error instanceof DOMException && error.name === "AbortError"
        ? "Official source acquisition timed out."
        : "Official source network acquisition failed.",
    );
  }

  if (response.status === 401 || response.status === 403) {
    return failure(
      entry,
      "OPERATOR_SOURCE_REQUIRED",
      "Official source requires legitimate operator access.",
      response.status,
    );
  }
  if (response.status === 429 || response.status >= 500) {
    const retryAfter = response.headers.get("retry-after");
    const parsedRetryAfter = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) : null;
    return failure(
      entry,
      "SOURCE_TEMPORARILY_UNAVAILABLE",
      "Official source returned a transient response.",
      response.status,
      parsedRetryAfter,
    );
  }
  if (!response.ok)
    return failure(
      entry,
      "INVALID_OFFICIAL_SOURCE_RESPONSE",
      "Official source returned an unexpected HTTP response.",
      response.status,
    );

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBody(
      response,
      Math.min(entry.maximumBytes, API_WATCH_MAX_ARTIFACT_BYTES),
    );
  } catch (error) {
    return failure(
      entry,
      "INVALID_OFFICIAL_SOURCE_RESPONSE",
      error instanceof Error && error.message === "SOURCE_TOO_LARGE"
        ? "Official source exceeded the bounded artifact size."
        : "Official source body could not be read safely.",
      response.status,
    );
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
    return {
      kind: "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE",
      sourceFamily: entry.sourceFamily,
      officialUrl: entry.officialUrl,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.byteLength,
      specVersion: validation.detectedSpecVersion,
      artifactType,
      finalUrl: currentUrl,
      parserResult: validation.parserResult,
      validationResult: validation.validationResult,
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
