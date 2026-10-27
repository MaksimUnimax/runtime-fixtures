import { z } from "zod";

/** Shared P3 wire/persistence lexical rules.  These do not compare versions. */
export const SemVerV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  );
export const StableMachineIdentifierV1Schema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

/** SemVer 2.0 precedence. Inputs are deliberately parsed through the frozen P3.1 grammar. */
export function compareSemVerV1(a: string, b: string): -1 | 0 | 1 {
  const left = SemVerV1Schema.parse(a);
  const right = SemVerV1Schema.parse(b);
  // The schema admits integers beyond Number precision, without leading zeroes.
  const compareNumeric = (l: string, r: string): -1 | 0 | 1 => {
    if (l.length !== r.length) return l.length < r.length ? -1 : 1;
    return l === r ? 0 : l < r ? -1 : 1;
  };
  const parse = (value: string) => {
    const withoutBuild = value.split("+", 1)[0]!;
    const separator = withoutBuild.indexOf("-");
    const core =
      separator < 0 ? withoutBuild : withoutBuild.slice(0, separator);
    const prerelease =
      separator < 0 ? [] : withoutBuild.slice(separator + 1).split(".");
    const [major, minor, patch] = core.split(".") as [string, string, string];
    return { major, minor, patch, prerelease };
  };
  const x = parse(left),
    y = parse(right);
  for (const key of ["major", "minor", "patch"] as const) {
    const order = compareNumeric(x[key], y[key]);
    if (order !== 0) return order;
  }
  if (!x.prerelease.length || !y.prerelease.length)
    return x.prerelease.length === y.prerelease.length
      ? 0
      : x.prerelease.length
        ? -1
        : 1;
  for (let i = 0; i < Math.min(x.prerelease.length, y.prerelease.length); i++) {
    const l = x.prerelease[i]!,
      r = y.prerelease[i]!;
    if (l === r) continue;
    const ln = /^\d+$/.test(l),
      rn = /^\d+$/.test(r);
    if (ln && rn) return compareNumeric(l, r);
    if (ln !== rn) return ln ? -1 : 1;
    return l < r ? -1 : 1; // ASCII code-unit ordering; never locale-sensitive.
  }
  return x.prerelease.length === y.prerelease.length
    ? 0
    : x.prerelease.length < y.prerelease.length
      ? -1
      : 1;
}

const EnvironmentSchema = z.enum(["development", "test", "production"]);
export const AppConfigSchema = z.object({
  environment: EnvironmentSchema,
  databaseUrl: z.string().url(),
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  apiPort: z.coerce.number().int().min(1).max(65535).default(3000),
  workerReadyDelayMs: z.coerce.number().int().min(0).max(60_000).default(0),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  return AppConfigSchema.parse({
    environment: environment.NODE_ENV ?? "development",
    databaseUrl: environment.DATABASE_URL,
    logLevel: environment.LOG_LEVEL,
    apiPort: environment.API_PORT,
    workerReadyDelayMs: environment.WORKER_READY_DELAY_MS,
  });
}
export * from "./browser";
