import { type BrowserFamily } from "@product/shared";
import { z } from "zod";

const ControlledBrowserFamilySchema = z.enum(["chrome", "yandex_chromium"]);

const TARGET_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const ControlledTargetKeySchema = z
  .string()
  .regex(TARGET_KEY_PATTERN, "invalid controlled target key");
export type ControlledTargetKey = z.infer<typeof ControlledTargetKeySchema>;

const ControlledTargetDefinitionSchema = z
  .object({
    key: ControlledTargetKeySchema,
    startUrl: z.string().min(1).max(2_048),
    allowedTopLevelOrigins: z.array(z.string().min(1).max(256)).min(1).max(8),
    browserFamily: ControlledBrowserFamilySchema,
    navigationTimeoutMs: z.number().int().min(250).max(30_000),
  })
  .strict();

export type ControlledTarget = Readonly<{
  key: string;
  startUrl: string;
  allowedTopLevelOrigins: readonly string[];
  browserFamily: BrowserFamily;
  navigationTimeoutMs: number;
}>;

function parseHttpOrigin(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("INVALID_CONTROLLED_TARGET_ORIGIN");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin === "null" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("INVALID_CONTROLLED_TARGET_ORIGIN");
  }
  return parsed.origin;
}

function validateTarget(input: unknown): ControlledTarget {
  const value = ControlledTargetDefinitionSchema.parse(input);
  let start: URL;
  try {
    start = new URL(value.startUrl);
  } catch {
    throw new Error("INVALID_CONTROLLED_TARGET_URL");
  }
  if (
    (start.protocol !== "http:" && start.protocol !== "https:") ||
    start.origin === "null" ||
    start.username !== "" ||
    start.password !== ""
  ) {
    throw new Error("UNSAFE_CONTROLLED_TARGET_URL");
  }
  const allowedTopLevelOrigins =
    value.allowedTopLevelOrigins.map(parseHttpOrigin);
  if (
    new Set(allowedTopLevelOrigins).size !== allowedTopLevelOrigins.length ||
    !allowedTopLevelOrigins.includes(start.origin)
  ) {
    throw new Error("TARGET_ORIGIN_POLICY_MISMATCH");
  }
  return Object.freeze({
    key: value.key,
    startUrl: start.toString(),
    allowedTopLevelOrigins: Object.freeze(allowedTopLevelOrigins),
    browserFamily: value.browserFamily,
    navigationTimeoutMs: value.navigationTimeoutMs,
  });
}

export class ControlledTargetRegistry {
  private readonly targets: ReadonlyMap<string, ControlledTarget>;

  public constructor(definitions: readonly unknown[]) {
    const targets = definitions.map(validateTarget);
    if (new Set(targets.map((target) => target.key)).size !== targets.length) {
      throw new Error("DUPLICATE_CONTROLLED_TARGET_KEY");
    }
    this.targets = new Map(targets.map((target) => [target.key, target]));
  }

  public resolve(targetKey: string): ControlledTarget {
    ControlledTargetKeySchema.parse(targetKey);
    const target = this.targets.get(targetKey);
    if (!target) throw new Error("CONTROLLED_TARGET_NOT_REGISTERED");
    return target;
  }
}

export function createControlledTargetRegistry(
  definitions: readonly unknown[],
): ControlledTargetRegistry {
  return new ControlledTargetRegistry(definitions);
}

/** The only production ChatGPT target currently packaged for H3. */
export function createPackagedStandardH3TargetRegistry(): ControlledTargetRegistry {
  return new ControlledTargetRegistry([
    {
      key: "chatgpt_standard_health",
      startUrl: "https://chatgpt.com/",
      allowedTopLevelOrigins: ["https://chatgpt.com"],
      browserFamily: "chrome",
      navigationTimeoutMs: 15_000,
    },
  ]);
}
