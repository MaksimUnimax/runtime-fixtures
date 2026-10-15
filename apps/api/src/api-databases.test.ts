import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createApiDatabases } from "./api-databases.js";

const applicationUrl = "postgres://application:fixture@127.0.0.1:5432/test";
const transferUrl = "postgres://transfer:fixture@127.0.0.1:5432/test";

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
    const output = ts.transpileModule(body.slice(0, boundary), {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const application = { close: vi.fn(async () => {}) };
    const transfer = { close: vi.fn(async () => {}) };
    const factory = vi.fn((url: string) =>
      url === applicationUrl ? application : transfer,
    );
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
      createApiApp: () => app,
      loadConfig: () => ({ databaseUrl: applicationUrl }),
      process: { env: { CREDENTIAL_TRANSFER_DATABASE_URL: transferUrl } },
    });
    await runInNewContext(`(async () => { ${output} })()`, context, {
      timeout: 1_000,
    });
    expect(factory.mock.calls).toEqual([[applicationUrl], [transferUrl]]);
    expect(makeFence.mock.calls[0]?.[0]).toBe(transfer);
    expect(makeAdmission.mock.calls[0]).toEqual([transfer, fence]);
    expect(deviceRepository).toHaveBeenCalledWith(application);
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
