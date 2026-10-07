(() => {
  "use strict";

  const fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };

  function responseVerifier() {
    const value = globalThis.SellerAgentsProviderResponseVerifier;
    if (!value || typeof value.verify !== "function")
      fail("PROVIDER_RESPONSE_VERIFIER_REQUIRED");
    return value;
  }

  function verificationDetails(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.fully_verified !== "boolean" ||
      typeof value.parse !== "string"
    )
      fail("PROVIDER_RESPONSE_VERIFICATION_REQUIRED");
    return value;
  }

  function responseMeta(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.provider_http_ok !== "boolean" ||
      !Number.isInteger(value.provider_http_status) ||
      value.provider_http_status < 0 ||
      value.provider_http_status > 999
    )
      fail("PROVIDER_RESPONSE_METADATA_INVALID");
    return {
      provider_http_ok: value.provider_http_ok,
      provider_http_status: value.provider_http_status,
    };
  }

  function safeErrorCode(error) {
    return /^[A-Z0-9_]{1,100}$/.test(error?.code || "")
      ? error.code
      : "RESPONSE_PROCESSING_FAILED";
  }

  function success(details, metadata, { binary = false } = {}) {
    responseVerifier();
    const checked = verificationDetails(details);
    const http = responseMeta(metadata);
    if (typeof binary !== "boolean")
      fail("PROVIDER_RESPONSE_MODE_INVALID");
    const disposition = checked.fully_verified
      ? "VERIFIED_PROVIDER_SCHEMA_AND_SEMANTICS"
      : binary
        ? "BINARY_BYTES_CAPTURED"
        : checked.parse !== "json"
          ? "NON_JSON_BODY"
          : "STRUCTURAL_ONLY_PROVIDER_SCHEMA_PENDING";
    return Object.freeze({
      disposition,
      verification_details: checked,
      ...http,
    });
  }

  function processingFailure(error, details, metadata) {
    responseVerifier();
    const checked = verificationDetails(details);
    const http = responseMeta(metadata);
    const code = safeErrorCode(error);
    return Object.freeze({
      disposition:
        code === "PROVIDER_JSON_INVALID"
          ? "MALFORMED_DECLARED_JSON"
          : "RESPONSE_PROCESSING_FAILED",
      verification_details: checked,
      error: Object.freeze({
        code,
        stage: "response_processing",
        automatic_retry: false,
      }),
      ...http,
      body_omitted: true,
      raw_capture_policy: Object.freeze({ chat_access_blocked: true }),
    });
  }

  globalThis.SellerAgentsProviderResponseDisposition = Object.freeze({
    success,
    processingFailure,
  });
})();
