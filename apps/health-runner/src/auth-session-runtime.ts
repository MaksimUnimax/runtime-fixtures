import {
  AuthSessionStateSchema,
  AuthSurfaceIdSchema,
  createNoAuthSessionSource,
  createRuntimeAuthSessionReference,
  type AuthSessionSource,
  type AuthSessionState,
  type AuthSurfaceId,
} from "./auth-session-authority.js";

const RUNTIME_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Runtime-only boundary.  The value is an opaque handle understood by the
 * executor; it is not a cookie jar, storageState JSON, token, password, OTP,
 * or browser profile path.  The caller may provide an environment mapping in
 * tests, but no value is ever returned in evidence or terminal diagnostics.
 */
export function loadAuthSessionSourceFromEnvironment(
  surfaceId: AuthSurfaceId,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AuthSessionSource {
  const parsedSurface = AuthSurfaceIdSchema.parse(surfaceId);
  const suffix = parsedSurface;
  const reference = environment[`HEALTH_AUTH_SESSION_REF_${suffix}`];
  if (reference === undefined || reference === "") {
    return createNoAuthSessionSource();
  }
  if (!RUNTIME_REFERENCE_PATTERN.test(reference)) {
    throw new Error("AUTH_SESSION_REFERENCE_MUST_BE_OPAQUE");
  }
  const stateValue =
    environment[`HEALTH_AUTH_SESSION_STATE_${suffix}`] ??
    "PREPROVISIONED_DEDICATED";
  const state = AuthSessionStateSchema.parse(stateValue);
  if (state === "NO_SESSION_CONFIGURED") {
    throw new Error("AUTH_SESSION_REFERENCE_CANNOT_BE_NO_SESSION");
  }
  return createRuntimeAuthSessionReference(reference, state);
}
export function authSessionSourceDiagnostic(
  source: AuthSessionSource,
): Readonly<{
  sourceType: AuthSessionSource["sourceType"];
  state: AuthSessionState;
  hasOpaqueReference: boolean;
}> {
  if (source.sourceType === "NONE") {
    return Object.freeze({
      sourceType: source.sourceType,
      state: source.state,
      hasOpaqueReference: false,
    });
  }
  return Object.freeze({
    sourceType: source.sourceType,
    state: source.state,
    hasOpaqueReference: true,
  });
}
