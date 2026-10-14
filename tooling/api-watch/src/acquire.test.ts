import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Duplex } from "node:stream";
import {
  createSecureContext,
  connect as tlsConnect,
  TLSSocket,
} from "node:tls";
import type { AgentOptions } from "node:https";
import type { ConnectionOptions } from "node:tls";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SourceRegistryEntry } from "./types.js";
type ConnectionEvidence = {
  closed: boolean;
  requestReceived: boolean;
  servername: string | null;
  authorized: boolean;
};
type VettedLookup = (
  host: string,
  options: { all: true },
  callback: (
    error: Error | null,
    values: { address: string; family: number }[],
  ) => void,
) => void;
const transport = vi.hoisted(() => ({
  addresses: [
    { address: "8.8.8.8", family: 4 },
    { address: "1.1.1.1", family: 4 },
  ],
  agentOptions: [] as AgentOptions[],
  connections: [] as ConnectionEvidence[],
  plan: [] as {
    status: number;
    headers?: Record<string, string>;
    body?: string;
    endless?: boolean;
  }[],
  connectFixture: undefined as
    | undefined
    | ((options: ConnectionOptions) => TLSSocket),
}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => transport.addresses),
}));
vi.mock("node:https", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:https")>();
  class FixtureAgent extends actual.Agent {
    constructor(options: AgentOptions) {
      super(options);
      transport.agentOptions.push(options);
    }
    createConnection(options: ConnectionOptions): TLSSocket {
      return transport.connectFixture!(options);
    }
  }
  return { ...actual, Agent: FixtureAgent };
});
import {
  acquireOfficialSource,
  selectVerifiedOfficialAddress,
} from "./acquire.js";
const entry: SourceRegistryEntry = {
  sourceFamily: "OZON_SELLER",
  officialUrl: "https://docs.ozon.ru/openapi.json",
  expectedArtifactTypes: ["JSON"],
  maximumBytes: 1024 * 1024,
  acquisitionPolicy: "OPERATOR_ASSISTED_WHEN_AUTOMATIC_ACCESS_IS_BLOCKED",
  operatorAcceptancePolicy: "REVIEW_REQUIRED",
  acceptedHosts: ["docs.ozon.ru"],
};
const document = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "TLS fixture", version: "1" },
  paths: {
    "/health": { get: { responses: { "200": { description: "ok" } } } },
  },
});
// Bounded in-memory TLS sockets; no listener/service, browser or worker pool
// beyond the single bounded unit-test worker. The adapter supplies a test CA
// and a wire only; native HTTPS, SNI/certificate checks and response are real.
// DNS/native-fallback configuration is asserted separately. This is not a TCP
// failed-address integration proof or installed/live product acceptance.
class Wire extends Duplex {
  peer!: Wire;
  _read() {}
  _write(
    chunk: Buffer,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ) {
    this.peer.push(Buffer.from(chunk));
    callback();
  }
  _final(callback: () => void) {
    this.peer.push(null);
    callback();
  }
  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    if (!this.peer.destroyed) this.peer.destroy();
    callback(error);
  }
}
let fixtureDirectory: string;
let certificate: Buffer;
let context: ReturnType<typeof createSecureContext>;
const sockets = new Set<TLSSocket>();
beforeAll(() => {
  const root =
    process.env.API_WATCH_FIXTURE_ROOT ??
    dirname(fileURLToPath(import.meta.url));
  fixtureDirectory = mkdtempSync(join(root, "tls-"));
  const key = join(fixtureDirectory, "key.pem"),
    cert = join(fixtureDirectory, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=docs.ozon.ru",
      "-addext",
      "subjectAltName=DNS:docs.ozon.ru",
    ],
    { stdio: "ignore", timeout: 10000 },
  );
  certificate = readFileSync(cert);
  context = createSecureContext({ key: readFileSync(key), cert: certificate });
  transport.connectFixture = (options) => {
    const clientWire = new Wire(),
      serverWire = new Wire();
    clientWire.peer = serverWire;
    serverWire.peer = clientWire;
    const server = new TLSSocket(serverWire, {
      isServer: true,
      secureContext: context,
    });
    const connection: ConnectionEvidence = {
      closed: false,
      requestReceived: false,
      servername: null,
      authorized: false,
    };
    transport.connections.push(connection);
    sockets.add(server);
    server.on("error", () => {});
    server.on("close", () => {
      connection.closed = true;
      sockets.delete(server);
    });
    server.on("secure", () => {
      connection.servername =
        (server as TLSSocket & { servername?: string }).servername ?? null;
    });
    let request = "";
    const plan = transport.plan.shift() ?? { status: 200, body: document };
    server.on("data", (chunk: Buffer) => {
      request += chunk.toString();
      if (connection.requestReceived || !request.includes("\r\n\r\n")) return;
      connection.requestReceived = true;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...plan.headers,
      };
      const body = plan.body ?? "";
      let head = "HTTP/1.1 " + plan.status + " Fixture\r\n";
      for (const [name, value] of Object.entries(headers))
        head += name + ": " + value + "\r\n";
      if (plan.endless)
        server.write(
          head +
            (headers["content-length"]
              ? "\r\nx"
              : "transfer-encoding: chunked\r\n\r\n1\r\nx\r\n"),
        );
      else
        server.end(
          head +
            "content-length: " +
            Buffer.byteLength(body) +
            "\r\nconnection: close\r\n\r\n" +
            body,
        );
    });
    const client = tlsConnect({
      ...options,
      socket: clientWire,
      ca: certificate,
      servername: options.servername || options.host,
    });
    sockets.add(client);
    client.on("error", () => {});
    client.on("close", () => sockets.delete(client));
    client.on("secureConnect", () => {
      connection.authorized = client.authorized;
    });
    return client;
  };
});
afterEach(() => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  transport.connections.length = 0;
  transport.agentOptions.length = 0;
  transport.plan.length = 0;
  transport.addresses = [
    { address: "8.8.8.8", family: 4 },
    { address: "1.1.1.1", family: 4 },
  ];
});
afterAll(() => {
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true });
});
describe("four-P2 API-watch transport regressions", () => {
  it("offers every vetted address to native family selection without changing TLS authority", async () => {
    const result = await acquireOfficialSource({ entry, timeoutMs: 400 });
    expect(result.kind).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
    const options = transport.agentOptions[0]!;
    expect(options.autoSelectFamily).toBe(true);
    expect(options.keepAlive).toBe(false);
    expect(options.maxCachedSessions).toBe(0);
    const addresses = await new Promise((resolve, reject) =>
      (options.lookup as unknown as VettedLookup)(
        "docs.ozon.ru",
        { all: true },
        (error: Error | null, values: unknown) =>
          error ? reject(error) : resolve(values),
      ),
    );
    expect(addresses).toEqual(transport.addresses);
    expect(transport.connections[0]!.authorized).toBe(true);
    expect(transport.connections[0]!.servername).toBe("docs.ozon.ru");
  });
  it("preserves the single-address helper and rejects mixed/private or invalid DNS", async () => {
    expect(
      await selectVerifiedOfficialAddress(
        "docs.ozon.ru",
        async () => transport.addresses,
      ),
    ).toEqual(transport.addresses[0]);
    for (const values of [
      [
        { address: "8.8.8.8", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
      [{ address: "::1", family: 6 }],
      [],
      [{ address: "8.8.8.8", family: 6 }],
      Array.from({ length: 33 }, () => ({ address: "8.8.8.8", family: 4 })),
    ])
      await expect(
        selectVerifiedOfficialAddress("docs.ozon.ru", async () => values),
      ).rejects.toThrow("OFFICIAL_SOURCE_DNS_ADDRESS_FORBIDDEN");
  });
  it.each([401, 403, 498, 429, 500, 404])(
    "closes an endless TLS response after early HTTP %i",
    async (status) => {
      transport.plan.push({
        status,
        endless: true,
        headers: { "retry-after": "3" },
      });
      const start = performance.now();
      const result = await acquireOfficialSource({ entry, timeoutMs: 250 });
      expect(result.kind).toBe(
        status === 401 || status === 403 || status === 498
          ? "OPERATOR_SOURCE_REQUIRED"
          : status === 429 || status >= 500
            ? "SOURCE_TEMPORARILY_UNAVAILABLE"
            : "INVALID_OFFICIAL_SOURCE_RESPONSE",
      );
      await vi.waitFor(
        () => expect(transport.connections[0]!.closed).toBe(true),
        { timeout: 150, interval: 5 },
      );
      expect(performance.now() - start).toBeLessThan(250);
    },
  );
  it.each([
    {},
    { location: "https://untrusted.invalid/openapi.json" },
    { location: "http://docs.ozon.ru/openapi.json" },
    { location: "https://docs.ozon.ru:444/openapi.json" },
  ] as Record<string, string>[])(
    "closes an endless TLS response after a forbidden redirect",
    async (headers) => {
      transport.plan.push({ status: 302, endless: true, headers });
      expect(
        (await acquireOfficialSource({ entry, timeoutMs: 250 })).kind,
      ).toBe("INVALID_OFFICIAL_SOURCE_RESPONSE");
      await vi.waitFor(
        () => expect(transport.connections[0]!.closed).toBe(true),
        { timeout: 150, interval: 5 },
      );
    },
  );
  it("closes an unread TLS body rejected by advertised length", async () => {
    transport.plan.push({
      status: 200,
      endless: true,
      headers: { "content-length": "2000000" },
    });
    expect((await acquireOfficialSource({ entry, timeoutMs: 250 })).kind).toBe(
      "INVALID_OFFICIAL_SOURCE_RESPONSE",
    );
    await vi.waitFor(
      () => expect(transport.connections[0]!.closed).toBe(true),
      { timeout: 150, interval: 5 },
    );
  });
  it("keeps one deadline for a streaming TLS body", async () => {
    transport.plan.push({ status: 200, endless: true });
    const start = performance.now();
    const result = await acquireOfficialSource({ entry, timeoutMs: 80 });
    expect(result.kind).toBe("SOURCE_TEMPORARILY_UNAVAILABLE");
    expect(
      result.kind === "SOURCE_TEMPORARILY_UNAVAILABLE" && result.blockerReason,
    ).toMatch(/timed out/);
    await vi.waitFor(
      () => expect(transport.connections[0]!.closed).toBe(true),
      { timeout: 150, interval: 5 },
    );
    expect(performance.now() - start).toBeLessThan(250);
  });
  it("still acquires a valid document after an accepted redirect", async () => {
    transport.plan.push(
      { status: 302, headers: { location: "/next.json" }, body: "" },
      { status: 200, body: document },
    );
    const result = await acquireOfficialSource({ entry, timeoutMs: 400 });
    expect(result.kind).toBe("ACQUIRED_OFFICIAL_SOURCE_CANDIDATE");
    expect(
      result.kind === "ACQUIRED_OFFICIAL_SOURCE_CANDIDATE" && result.finalUrl,
    ).toBe("https://docs.ozon.ru/next.json");
    expect(
      transport.connections.every((connection) => connection.authorized),
    ).toBe(true);
  });
});
