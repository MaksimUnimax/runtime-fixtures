import { isIP } from "node:net";
import type { FastifyRequest } from "fastify";

export type RateLimitIpSource = "socket" | "loopback-x-real-ip";
const sources = new WeakMap<object, RateLimitIpSource>();
const loopbackPeers = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function loadRateLimitIpSource(
  value: string | undefined,
): RateLimitIpSource {
  if (value === undefined || value === "socket") return "socket";
  if (value === "loopback-x-real-ip") return value;
  throw new Error("API_RATE_LIMIT_IP_SOURCE_INVALID");
}

export function configureRateLimitClientIp(
  app: object,
  source: RateLimitIpSource = "socket",
): void {
  sources.set(app, loadRateLimitIpSource(source));
}

/**
 * Opt-in deployment contract: the API listens on loopback and the immediate
 * local reverse proxy overwrites X-Real-IP with its observed remote address.
 * This selects only the rate-limit bucket. Fastify proxy trust, Host, protocol,
 * cookies and authentication authority remain unchanged.
 */
export function rateLimitClientIp(request: FastifyRequest): string {
  const peer = request.raw.socket.remoteAddress ?? request.ip;
  if (
    sources.get(request.server) !== "loopback-x-real-ip" ||
    !loopbackPeers.has(peer)
  )
    return peer;
  const value = request.headers["x-real-ip"];
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.includes("%")
  )
    return peer;
  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6) {
    // One canonical IPv6 representation selects one bucket. Zone identifiers
    // and multiple/combined header values have already been rejected.
    return new URL(`http://[${value}]/`).hostname.slice(1, -1);
  }
  return peer;
}
