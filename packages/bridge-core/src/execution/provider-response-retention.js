(() => {
  "use strict";

  const fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };

  function responseDisposition() {
    const value = globalThis.SellerAgentsProviderResponseDisposition;
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.success !== "function" ||
      typeof value.processingFailure !== "function"
    )
      fail("PROVIDER_RESPONSE_DISPOSITION_REQUIRED");
    return value;
  }

  function verificationDetails(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.fully_verified !== "boolean" ||
      typeof value.parse !== "string" ||
      typeof value.schema !== "string" ||
      typeof value.semantic !== "string"
    )
      fail("PROVIDER_RESPONSE_DISPOSITION_INVALID");
    return value;
  }

  function responseMetadata(value) {
    if (
      typeof value.provider_http_ok !== "boolean" ||
      !Number.isInteger(value.provider_http_status) ||
      value.provider_http_status < 0 ||
      value.provider_http_status > 999
    )
      fail("PROVIDER_RESPONSE_DISPOSITION_INVALID");
    return value;
  }

  function descriptor(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail("PROVIDER_RESPONSE_ARTIFACT_DESCRIPTOR_INVALID");
    const ref = value.ref;
    const sha256 = value.sha256;
    const byteLength = value.byte_length;
    if (
      typeof ref !== "string" ||
      !ref ||
      ref !== ref.trim() ||
      ref.length > 512 ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256) ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0
    )
      fail("PROVIDER_RESPONSE_ARTIFACT_DESCRIPTOR_INVALID");
    return Object.freeze({
      ref,
      sha256,
      byte_length: byteLength,
    });
  }

  function byteLength(value) {
    if (!Number.isSafeInteger(value) || value < 0)
      fail("PROVIDER_RESPONSE_BYTE_LENGTH_INVALID");
    return value;
  }

  function failureDisposition(value) {
    responseDisposition();
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail("PROVIDER_RESPONSE_FAILURE_DISPOSITION_REQUIRED");
    try {
      verificationDetails(value.verification_details);
      responseMetadata(value);
    } catch (_) {
      fail("PROVIDER_RESPONSE_FAILURE_DISPOSITION_REQUIRED");
    }
    const error = value.error;
    const expectedDisposition =
      error?.code === "PROVIDER_JSON_INVALID"
        ? "MALFORMED_DECLARED_JSON"
        : "RESPONSE_PROCESSING_FAILED";
    if (
      !error ||
      typeof error !== "object" ||
      Array.isArray(error) ||
      !/^[A-Z0-9_]{1,100}$/.test(error.code || "") ||
      error.stage !== "response_processing" ||
      error.automatic_retry !== false ||
      value.disposition !== expectedDisposition ||
      value.body_omitted !== true ||
      value.raw_capture_policy?.chat_access_blocked !== true
    )
      fail("PROVIDER_RESPONSE_FAILURE_DISPOSITION_REQUIRED");
    return value;
  }

  function binaryDisposition(value) {
    responseDisposition();
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail("PROVIDER_RESPONSE_BINARY_DISPOSITION_REQUIRED");
    let details;
    try {
      details = verificationDetails(value.verification_details);
      responseMetadata(value);
    } catch (_) {
      fail("PROVIDER_RESPONSE_BINARY_DISPOSITION_REQUIRED");
    }
    const verificationPass =
      details.schema === "pass" && details.semantic === "pass";
    if (details.fully_verified !== verificationPass)
      fail("PROVIDER_RESPONSE_BINARY_DISPOSITION_REQUIRED");
    const expectedDisposition = verificationPass
      ? "VERIFIED_PROVIDER_SCHEMA_AND_SEMANTICS"
      : "BINARY_BYTES_CAPTURED";
    if (
      value.disposition !== expectedDisposition ||
      details.parse !== "binary" ||
      value.provider_http_ok !== true
    )
      fail("PROVIDER_RESPONSE_BINARY_DISPOSITION_REQUIRED");
    return value;
  }

  function quarantineDefault(disposition) {
    failureDisposition(disposition);
    return Object.freeze({
      stored_locally: false,
      raw_retention_failed: true,
      chat_access_blocked: true,
    });
  }

  function quarantineStored(disposition, storedDescriptor) {
    failureDisposition(disposition);
    const stored = descriptor(storedDescriptor);
    return Object.freeze({
      stored_locally: true,
      ref: stored.ref,
      sha256: stored.sha256,
      byte_length: stored.byte_length,
      chat_access_blocked: true,
    });
  }

  function binaryStored(disposition, storedDescriptor, payloadByteLength) {
    binaryDisposition(disposition);
    const stored = descriptor(storedDescriptor);
    const length = byteLength(payloadByteLength);
    if (stored.byte_length !== length)
      fail("PROVIDER_RESPONSE_BYTE_LENGTH_INVALID");
    return Object.freeze({
      artifact_refs: Object.freeze([stored]),
      delivery_error: null,
      result_policy: Object.freeze({
        artifact: stored,
        byte_length: length,
        delivery_status: "PREPARED_NOT_ATTACHED",
      }),
    });
  }

  function binaryStorageFailed(disposition, payloadByteLength) {
    const checked = binaryDisposition(disposition);
    const length = byteLength(payloadByteLength);
    const deliveryError = Object.freeze({
      code: "ARTIFACT_STORAGE_FAILED",
      provider_http_status: checked.provider_http_status,
      provider_ok: true,
      automatic_retry: false,
    });
    return Object.freeze({
      artifact_refs: Object.freeze([]),
      delivery_error: deliveryError,
      result_policy: Object.freeze({
        byte_length: length,
        delivery_error: deliveryError,
        bytes_preserved_in_result: true,
      }),
    });
  }

  globalThis.SellerAgentsProviderResponseRetention = Object.freeze({
    quarantineDefault,
    quarantineStored,
    binaryStored,
    binaryStorageFailed,
  });
})();
