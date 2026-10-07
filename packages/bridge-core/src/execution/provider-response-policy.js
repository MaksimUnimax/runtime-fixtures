(() => {
  "use strict";

  const fail = (code, message = code) => {
    throw Object.assign(new Error(message), { code });
  };
  const plain = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const forbidden = new Set(["__proto__", "constructor", "prototype"]);

  function safeMetadataTree(value, depth = 0) {
    if (depth > 64) fail("METADATA_DEPTH");
    if (Array.isArray(value)) {
      for (const child of value) safeMetadataTree(child, depth + 1);
      return;
    }
    if (!plain(value)) return;
    for (const key of Object.keys(value)) {
      if (forbidden.has(key)) fail("UNSAFE_METADATA_KEY");
      safeMetadataTree(value[key], depth + 1);
    }
  }

  function safeResponseTree(value, depth = 0, budget = { keys: 0 }) {
    if (depth > 64) fail("RESPONSE_DEPTH_EXCEEDED");
    if (typeof value === "number" && !Number.isFinite(value))
      fail("RESPONSE_NUMBER_NOT_FINITE");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (++budget.keys > 300000) fail("RESPONSE_KEY_LIMIT");
      if (forbidden.has(key)) fail("UNSAFE_RESPONSE_KEY");
      safeResponseTree(child, depth + 1, budget);
    }
  }

  function canonical(value) {
    if (value === undefined) fail("UNDEFINED_CANONICAL_VALUE");
    if (Array.isArray(value))
      return "[" + value.map(canonical).join(",") + "]";
    if (plain(value))
      return (
        "{" +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
          .join(",") +
        "}"
      );
    return JSON.stringify(value);
  }

  function dateValue(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      fail("INVALID_DATE");
    const milliseconds = Date.parse(value + "T00:00:00Z");
    if (
      !Number.isFinite(milliseconds) ||
      new Date(milliseconds).toISOString().slice(0, 10) !== value
    )
      fail("INVALID_DATE");
    return milliseconds;
  }

  function dateTime(value) {
    const match =
      typeof value === "string" &&
      value.match(
        /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/,
      );
    if (!match) fail("INVALID_DATE_TIME");
    dateValue(match[1]);
    if (
      +match[2] > 23 ||
      +match[3] > 59 ||
      +match[4] > 59 ||
      (match[6] && (+match[7] > 23 || +match[8] > 59))
    )
      fail("INVALID_DATE_TIME");
    const milliseconds = Date.parse(value);
    if (!Number.isFinite(milliseconds)) fail("INVALID_DATE_TIME");
    return milliseconds;
  }

  const schemaKeys = new Set([
    "type",
    "required",
    "properties",
    "additionalProperties",
    "items",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "format",
    "description",
    "title",
    "nullable",
  ]);

  function compileSchema(schema, depth = 0) {
    if (depth > 32 || !plain(schema)) fail("INVALID_SCHEMA");
    safeMetadataTree(schema);
    for (const key of Object.keys(schema))
      if (!schemaKeys.has(key)) fail("UNSUPPORTED_SCHEMA_KEYWORD");
    if (
      schema.type &&
      !["object", "array", "string", "number", "integer", "boolean", "null"].includes(
        schema.type,
      )
    )
      fail("INVALID_SCHEMA_TYPE");
    if (schema.properties !== undefined && !plain(schema.properties))
      fail("INVALID_SCHEMA");
    if (
      schema.additionalProperties !== undefined &&
      typeof schema.additionalProperties !== "boolean"
    )
      fail("UNSUPPORTED_SCHEMA_KEYWORD");
    if (schema.nullable !== undefined && typeof schema.nullable !== "boolean")
      fail("INVALID_SCHEMA");
    if (
      schema.enum !== undefined &&
      (!Array.isArray(schema.enum) || !schema.enum.length)
    )
      fail("INVALID_SCHEMA");
    for (const key of ["minLength", "maxLength", "minItems", "maxItems"])
      if (
        schema[key] !== undefined &&
        (!Number.isSafeInteger(schema[key]) || schema[key] < 0)
      )
        fail("INVALID_SCHEMA");
    for (const key of ["minimum", "maximum"])
      if (
        schema[key] !== undefined &&
        (typeof schema[key] !== "number" || !Number.isFinite(schema[key]))
      )
        fail("INVALID_SCHEMA");
    for (const [minimum, maximum] of [
      ["minimum", "maximum"],
      ["minLength", "maxLength"],
      ["minItems", "maxItems"],
    ])
      if (
        schema[minimum] !== undefined &&
        schema[maximum] !== undefined &&
        schema[minimum] > schema[maximum]
      )
        fail("INVALID_SCHEMA");

    if (schema.properties)
      for (const child of Object.values(schema.properties))
        compileSchema(child, depth + 1);
    if (schema.items) compileSchema(schema.items, depth + 1);
    if (
      schema.required &&
      (!Array.isArray(schema.required) ||
        schema.required.some((key) => typeof key !== "string"))
    )
      fail("INVALID_SCHEMA");
    if (schema.format && !["date", "date-time"].includes(schema.format))
      fail("UNSUPPORTED_SCHEMA_FORMAT");
    return Object.freeze(clone(schema));
  }

  function validateSchema(value, schema, path = "$", depth = 0) {
    if (depth > 64) fail("RESPONSE_DEPTH");
    if (value === null && schema.nullable) return true;
    const type = schema.type;
    if (
      (type === "object" && !plain(value)) ||
      (type === "array" && !Array.isArray(value)) ||
      (type === "string" && typeof value !== "string") ||
      (type === "number" &&
        (typeof value !== "number" || !Number.isFinite(value))) ||
      (type === "integer" && !Number.isSafeInteger(value)) ||
      (type === "boolean" && typeof value !== "boolean") ||
      (type === "null" && value !== null)
    )
      fail("SCHEMA_TYPE_MISMATCH", path);
    if (
      schema.enum &&
      !schema.enum.some((candidate) => canonical(candidate) === canonical(value))
    )
      fail("SCHEMA_ENUM", path);
    if (plain(value)) {
      for (const key of schema.required || [])
        if (!Object.hasOwn(value, key)) fail("SCHEMA_REQUIRED", path + "." + key);
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key)) fail("UNSAFE_RESPONSE_KEY");
        if (schema.properties?.[key])
          validateSchema(child, schema.properties[key], path + "." + key, depth + 1);
        else if (schema.additionalProperties === false)
          fail("SCHEMA_ADDITIONAL_PROPERTY", path + "." + key);
      }
    }
    if (Array.isArray(value)) {
      if (
        (schema.minItems !== undefined && value.length < schema.minItems) ||
        (schema.maxItems !== undefined && value.length > schema.maxItems)
      )
        fail("SCHEMA_ARRAY_LENGTH", path);
      if (schema.items)
        value.forEach((child, index) =>
          validateSchema(child, schema.items, path + "[" + index + "]", depth + 1),
        );
    }
    if (
      typeof value === "number" &&
      ((schema.minimum !== undefined && value < schema.minimum) ||
        (schema.maximum !== undefined && value > schema.maximum))
    )
      fail("SCHEMA_NUMBER_RANGE", path);
    if (typeof value === "string") {
      if (
        (schema.minLength !== undefined &&
          [...value].length < schema.minLength) ||
        (schema.maxLength !== undefined &&
          [...value].length > schema.maxLength)
      )
        fail("SCHEMA_STRING_LENGTH", path);
      if (schema.format === "date") dateValue(value);
      if (schema.format === "date-time") dateTime(value);
    }
    return true;
  }

  globalThis.SellerAgentsProviderResponsePolicy = Object.freeze({
    safeMetadataTree,
    safeResponseTree,
    canonical,
    dateValue,
    dateTime,
    compileSchema,
    validateSchema,
  });
})();
