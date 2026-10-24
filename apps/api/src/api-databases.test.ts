import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createApiDatabases } from "./api-databases.js";

const applicationUrl = "postgres://application:fixture@127.0.0.1:5432/test";
const transferUrl = "postgres://transfer:fixture@127.0.0.1:5432/test";
const monitorUrl =
  "postgres://monitor_reader:fixture@127.0.0.1:5432/octoport_monitor_pilot";
const monitorRole = "monitor_reader";

describe("API database role separation", () => {
  it("routes actual main wiring to distinct pools", async () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const parsed = ts.createSourceFile(
      "main.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const importNames = parsed.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement)) return [];
      const bindings = statement.importClause?.namedBindings;
      return bindings && ts.isNamedImports(bindings)
        ? bindings.elements
            .filter((element) => !element.isTypeOnly)
            .map((element) => element.name.text)
        : [];
    });
    const body = parsed.statements
      .filter((statement) => !ts.isImportDeclaration(statement))
      .map((statement) => source.slice(statement.getFullStart(), statement.end))
      .join("\n");
    const boundary = body.indexOf("let closing = false;");
    if (boundary < 0) throw new Error("MAIN_LIFECYCLE_BOUNDARY_DRIFT");
    const startupBody =
      body.slice(0, boundary) +
      "\n} catch (error) { try { await closeDatabases(); } catch {} throw error; }";
    const output = ts.transpileModule(startupBody, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const application = { close: vi.fn(async () => {}) };
    const transfer = { close: vi.fn(async () => {}) };
    const monitor = { close: vi.fn(async () => {}) };
    const factory = vi.fn((url: string) =>
      url === applicationUrl
        ? application
        : url === transferUrl
          ? transfer
          : monitor,
    );
    const adminRead = vi.fn(() => ({}));
    const notificationRead = vi.fn(() => ({}));
    const diagnosticsRead = vi.fn(() => ({}));
    const repairRead = vi.fn(() => ({}));
    const productAdmin = vi.fn(() => ({}));
    const fence = {};
    const makeFence = vi.fn((_database: unknown, _instance: string) => fence);
    const makeAdmission = vi.fn((_database: unknown, _fence: unknown) => ({
      isReady: () => true,
      stop() {},
    }));
    const deviceRepository = vi.fn(() => ({}));
    const app = { addHook: vi.fn() };
    // Unrelated services are inert; the executed production main chooses every pool.
    const context: Record<string, unknown> = Object.fromEntries(
      importNames.map((name) => [
        name,
        function () {
          return {};
        },
      ]),
    );
    Object.assign(context, {
      createApiDatabases,
      createDatabaseRuntime: factory,
      createCredentialTransferEpochFence: makeFence,
      createCredentialTransferApiAdmission: makeAdmission,
      createDeviceManagementRepository: deviceRepository,
      createHealthAdminReadRepository: adminRead,
      createHealthNotificationAdminReadRepository: notificationRead,
      createHealthDiagnosticsReadRepository: diagnosticsRead,
      createMonitorProfileRepairReadRepository: repairRead,
      createAdminAuthRepository: productAdmin,
      createApiApp: () => app,
      loadConfig: () => ({ databaseUrl: applicationUrl }),
      process: {
        env: {
          CREDENTIAL_TRANSFER_DATABASE_URL: transferUrl,
          MONITOR_HEALTH_READ_DATABASE_URL: monitorUrl,
          MONITOR_HEALTH_READ_EXPECTED_ROLE: monitorRole,
        },
      },
    });
    await runInNewContext(`(async () => { ${output} })()`, context, {
      timeout: 1_000,
    });
    expect(factory.mock.calls).toEqual([
      [applicationUrl],
      [transferUrl],
      [monitorUrl],
    ]);
    expect(makeFence.mock.calls[0]?.[0]).toBe(transfer);
    expect(makeAdmission.mock.calls[0]).toEqual([transfer, fence]);
    expect(deviceRepository).toHaveBeenCalledWith(application);
    expect(productAdmin).toHaveBeenCalledWith(application);
    for (const reader of [
      adminRead,
      notificationRead,
      diagnosticsRead,
      repairRead,
    ])
      expect(reader).toHaveBeenCalledWith(monitor);
  });

  it("closes all opened pools when main initialization fails after allocation", async () => {
    const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    const parsed = ts.createSourceFile(
      "main.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const importNames = parsed.statements.flatMap((statement) => {
      if (!ts.isImportDeclaration(statement)) return [];
      const bindings = statement.importClause?.namedBindings;
      return bindings && ts.isNamedImports(bindings)
        ? bindings.elements
            .filter((element) => !element.isTypeOnly)
            .map((element) => element.name.text)
        : [];
    });
    const body = parsed.statements
      .filter((statement) => !ts.isImportDeclaration(statement))
      .map((statement) => source.slice(statement.getFullStart(), statement.end))
      .join("\n");
    const output = ts.transpileModule(body, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const application = { close: vi.fn(async () => {}) };
    const transfer = { close: vi.fn(async () => {}) };
    const monitor = { close: vi.fn(async () => {}) };
    const factory = vi.fn((url: string) =>
      url === applicationUrl
        ? application
        : url === transferUrl
          ? transfer
          : monitor,
    );
    const context: Record<string, unknown> = Object.fromEntries(
      importNames.map((name) => [
        name,
        function () {
          return {};
        },
      ]),
    );
    Object.assign(context, {
      createApiDatabases,
      createDatabaseRuntime: factory,
      createCredentialTransferEpochFence: () => {
        throw new Error("SYNTHETIC_POST_POOL_STARTUP_FAILURE");
      },
      loadConfig: () => ({ databaseUrl: applicationUrl }),
      process: {
        env: {
          CREDENTIAL_TRANSFER_DATABASE_URL: transferUrl,
          MONITOR_HEALTH_READ_DATABASE_URL: monitorUrl,
          MONITOR_HEALTH_READ_EXPECTED_ROLE: monitorRole,
        },
      },
    });
    await expect(
      runInNewContext(`(async () => { ${output} })()`, context, {
        timeout: 1_000,
      }),
    ).rejects.toThrow("SYNTHETIC_POST_POOL_STARTUP_FAILURE");
    expect(application.close).toHaveBeenCalledOnce();
    expect(transfer.close).toHaveBeenCalledOnce();
    expect(monitor.close).toHaveBeenCalledOnce();
  });

  it("does not open a monitor read pool or silently use the product database when unconfigured", async () => {
    const application = { close: vi.fn(async () => {}) };
    const transfer = { close: vi.fn(async () => {}) };
    const factory = vi.fn((url: string) =>
      url === applicationUrl ? application : transfer,
    );
    const pools = await createApiDatabases(
      applicationUrl,
      transferUrl,
      factory,
    );
    expect(pools.healthReadDatabase).toBeUndefined();
    expect(factory.mock.calls).toEqual([[applicationUrl], [transferUrl]]);
    await pools.closeDatabases();
    expect(application.close).toHaveBeenCalledTimes(1);
    expect(transfer.close).toHaveBeenCalledTimes(1);
  });

  it("opens a separate monitor-only reader and closes all three pools once", async () => {
    const runtimes = new Map(
      [applicationUrl, transferUrl, monitorUrl].map((url) => [
        url,
        { close: vi.fn(async () => {}) },
      ]),
    );
    const factory = vi.fn((url: string) => {
      const runtime = runtimes.get(url);
      if (!runtime) throw new Error("unexpected fixture url");
      return runtime;
    });
    const pools = await createApiDatabases(
      applicationUrl,
      transferUrl,
      factory,
      monitorUrl,
      monitorRole,
    );
    expect(pools.database).toBe(runtimes.get(applicationUrl));
    expect(pools.transferDatabase).toBe(runtimes.get(transferUrl));
    expect(pools.healthReadDatabase).toBe(runtimes.get(monitorUrl));
    const first = pools.closeDatabases();
    expect(pools.closeDatabases()).toBe(first);
    await first;
    for (const runtime of runtimes.values())
      expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    [monitorUrl, undefined],
    [undefined, monitorRole],
    [applicationUrl, "application"],
    [transferUrl, "transfer"],
    ["postgres://monitor_reader:fixture@127.0.0.1:5432/test", monitorRole],
    [
      "postgres://application:fixture@127.0.0.1:5432/octoport_monitor_pilot",
      "application",
    ],
    [
      "postgres://monitor_reader:fixture@127.0.0.1:5432/octoport_monitor_pilot?options=-c%20statement_timeout%3D0",
      monitorRole,
    ],
    [monitorUrl, "other_reader"],
    [monitorUrl + "#fragment", monitorRole],
    [
      "https://monitor_reader:fixture@127.0.0.1:5432/octoport_monitor_pilot",
      monitorRole,
    ],
  ])(
    "fails closed before allocation on incomplete or unsafe monitor reader configuration %s",
    async (url, role) => {
      const factory = vi.fn(() => ({ close: vi.fn(async () => {}) }));
      await expect(
        createApiDatabases(applicationUrl, transferUrl, factory, url, role),
      ).rejects.toThrow("API_DATABASE_ROLE_OR_ENDPOINT_SEPARATION_REQUIRED");
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it("closes both previously opened pools if monitor reader allocation fails", async () => {
    const application = { close: vi.fn(async () => {}) };
    const transfer = { close: vi.fn(async () => {}) };
    // The failed driver may embed the URI and password in its error.
    const failure = new Error("reader allocation: " + monitorUrl);
    await expect(
      createApiDatabases(
        applicationUrl,
        transferUrl,
        (url) => {
          if (url === applicationUrl) return application;
          if (url === transferUrl) return transfer;
          throw failure;
        },
        monitorUrl,
        monitorRole,
      ),
    ).rejects.toThrow("MONITOR_HEALTH_READ_DATABASE_SETUP_FAILED");
    expect(application.close).toHaveBeenCalledOnce();
    expect(transfer.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["application", applicationUrl],
    ["transfer", transferUrl],
  ] as const)(
    "preserves %s allocation failure identity when monitor is configured",
    async (_kind, failedUrl) => {
      const application = { close: vi.fn(async () => {}) };
      const failure = new Error("SYNTHETIC_PRODUCT_POOL_SETUP_FAILURE");
      await expect(
        createApiDatabases(
          applicationUrl,
          transferUrl,
          (url) => {
            if (url === failedUrl) throw failure;
            return application;
          },
          monitorUrl,
          monitorRole,
        ),
      ).rejects.toBe(failure);
    },
  );

  it.each(["application", "transfer"] as const)(
    "preserves %s close failure identity when monitor is configured",
    async (failedPool) => {
      const application = {
        close: vi.fn(async () => {
          if (failedPool === "application")
            throw new Error("SYNTHETIC_APPLICATION_CLOSE_FAILURE");
        }),
      };
      const transfer = {
        close: vi.fn(async () => {
          if (failedPool === "transfer")
            throw new Error("SYNTHETIC_TRANSFER_CLOSE_FAILURE");
        }),
      };
      const monitor = { close: vi.fn(async () => {}) };
      const pools = await createApiDatabases(
        applicationUrl,
        transferUrl,
        (url) =>
          url === applicationUrl
            ? application
            : url === transferUrl
              ? transfer
              : monitor,
        monitorUrl,
        monitorRole,
      );
      await expect(pools.closeDatabases()).rejects.toThrow(
        failedPool === "application"
          ? "SYNTHETIC_APPLICATION_CLOSE_FAILURE"
          : "SYNTHETIC_TRANSFER_CLOSE_FAILURE",
      );
    },
  );

  it("redacts configured monitor close errors without changing two-pool behavior", async () => {
    const application = { close: vi.fn(async () => {}) };
    const transfer = { close: vi.fn(async () => {}) };
    const monitor = {
      close: vi.fn(async () => {
        throw new Error("sensitive monitor URI: " + monitorUrl);
      }),
    };
    const pools = await createApiDatabases(
      applicationUrl,
      transferUrl,
      (url) =>
        url === applicationUrl
          ? application
          : url === transferUrl
            ? transfer
            : monitor,
      monitorUrl,
      monitorRole,
    );
    await expect(pools.closeDatabases()).rejects.toThrow(
      "MONITOR_HEALTH_READ_DATABASE_CLOSE_FAILED",
    );
    expect(application.close).toHaveBeenCalledOnce();
    expect(transfer.close).toHaveBeenCalledOnce();
    expect(monitor.close).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    applicationUrl,
    "postgres://%61pplication:other@127.0.0.1:5432/test",
    "postgres://transfer:fixture@127.0.0.1:5432/other",
    "postgres://transfer:fixture@192.0.2.1:5432/test",
    "https://transfer:fixture@127.0.0.1:5432/test",
  ])(
    "rejects missing, shared or unrelated transfer connections before opening pools",
    async (url) => {
      const factory = vi.fn(() => ({ close: async () => {} }));
      await expect(
        createApiDatabases(applicationUrl, url, factory),
      ).rejects.toThrow(
        url === undefined
          ? "CREDENTIAL_TRANSFER_DATABASE_URL_REQUIRED"
          : "API_DATABASE_ROLE_OR_ENDPOINT_SEPARATION_REQUIRED",
      );
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it.each([
    "user",
    "password",
    "host",
    "hostaddr",
    "port",
    "database",
    "options",
    "service",
    "connectionString",
    "ssl",
  ])(
    "rejects unsupported driver field %s in either URL before allocation",
    async (key) => {
      for (const side of ["application", "transfer"]) {
        const application = new URL(applicationUrl);
        const transfer = new URL(transferUrl);
        (side === "application" ? application : transfer).searchParams.set(
          key,
          "inert-fixture",
        );
        const factory = vi.fn(() => ({ close: async () => {} }));
        await expect(
          createApiDatabases(
            application.toString(),
            transfer.toString(),
            factory,
          ),
        ).rejects.toThrow("API_DATABASE_ROLE_OR_ENDPOINT_SEPARATION_REQUIRED");
        expect(factory).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    "postgres://transfer:fixture@/test",
    "postgres://transfer:fixture@127.0.0.1:5432/",
    "postgres://transfer:fixture@127.0.0.1:5432/test#fragment",
    "postgres://transfer:fixture@127.0.0.1:5432/test?sslmode=invalid%",
    "postgres://transfer:fixture@127.0.0.1:5432/test?sslmode=invalid%2",
    "postgres://transfer:fixture@127.0.0.1:5432/test?sslmode=invalid%GG",
    "postgres://transfer:fixture@127.0.0.1:5432/test?sslmode=invalid%E0%A4",
    "postgres://transfer:fixture@127.0.0.1:5432/test%2Fother",
  ])(
    "rejects incomplete or different effective endpoints without opening pools",
    async (url) => {
      const factory = vi.fn(() => ({ close: async () => {} }));
      await expect(
        createApiDatabases(applicationUrl, url, factory),
      ).rejects.toThrow("API_DATABASE_ROLE_OR_ENDPOINT_SEPARATION_REQUIRED");
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it("passes explicit validated identities and default ports to the actual pinned pg parser", async () => {
    // Load the DB package's existing pinned driver. Parsing opens no pool/socket.
    const databaseRequire = createRequire(
      new URL("../../../packages/server/db/package.json", import.meta.url),
    );
    const driverRequire = createRequire(databaseRequire.resolve("pg"));
    const ConnectionParameters = driverRequire(
      "./connection-parameters.js",
    ) as new (config: { connectionString: string }) => {
      user: string;
      host: string;
      port: number;
      database: string;
    };
    const parsed: Array<{
      user: string;
      host: string;
      port: number;
      database: string;
    }> = [];
    vi.stubEnv("PGPORT", "6543");
    vi.stubEnv("PGUSER", "environment-role");
    vi.stubEnv("PGDATABASE", "environment-database");
    try {
      const factory = vi.fn((url: string) => {
        const parameters = new ConnectionParameters({ connectionString: url });
        parsed.push({
          user: parameters.user,
          host: parameters.host,
          port: parameters.port,
          database: parameters.database,
        });
        return { close: async () => {} };
      });
      const pools = await createApiDatabases(
        "postgres://application:fixture@127.0.0.1/test?sslmode=verify-full",
        "postgres://transfer:fixture@127.0.0.1/test?sslmode=verify-full",
        factory,
      );
      expect(parsed).toEqual([
        {
          user: "application",
          host: "127.0.0.1",
          port: 5432,
          database: "test",
        },
        { user: "transfer", host: "127.0.0.1", port: 5432, database: "test" },
      ]);
      expect(
        factory.mock.calls.every(([url]) => new URL(url).port === "5432"),
      ).toBe(true);
      await pools.closeDatabases();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("retains supported TLS certificate parameters without inspecting files in validation", async () => {
    const application =
      applicationUrl + "?sslmode=verify-full&sslrootcert=%2Finert%2Fca.pem";
    const transfer =
      transferUrl +
      "?sslmode=verify-full&sslcert=%2Finert%2Fclient.pem&sslkey=%2Finert%2Fclient.key";
    const factory = vi.fn(() => ({ close: async () => {} }));
    const pools = await createApiDatabases(application, transfer, factory);
    expect(factory.mock.calls).toEqual([[application], [transfer]]);
    await pools.closeDatabases();
  });

  it("closes both pools once even when one close fails", async () => {
    const failure = new Error("application close");
    const application = {
      close: vi.fn(async () => {
        throw failure;
      }),
    };
    const transfer = { close: vi.fn(async () => {}) };
    const pools = await createApiDatabases(
      applicationUrl,
      transferUrl,
      (url) => (url === applicationUrl ? application : transfer),
    );
    const first = pools.closeDatabases();
    expect(pools.closeDatabases()).toBe(first);
    await expect(first).rejects.toBe(failure);
    expect(application.close).toHaveBeenCalledTimes(1);
    expect(transfer.close).toHaveBeenCalledTimes(1);
  });

  it("cleans the first pool if creating the second fails", async () => {
    const failure = new Error("pool allocation");
    const close = vi.fn(async () => {});
    await expect(
      createApiDatabases(applicationUrl, transferUrl, (url) => {
        if (url === transferUrl) throw failure;
        return { close };
      }),
    ).rejects.toBe(failure);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
