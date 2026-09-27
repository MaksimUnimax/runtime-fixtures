(() => {
  "use strict";
  const TARGET = "fbs_order_statuses";
  const MAX_ORDERS = 1000;
  const base = globalThis.WBContract;
  if (!base || base.OPERATIONS?.[TARGET]?.body_required !== true)
    throw new Error(
      "Patched WBContract must load before the FBS statuses contract overlay.",
    );

  function fail(code, message) {
    const error = new Error(message || code);
    error.code = code;
    error.external_request_executed = false;
    throw error;
  }
  function validateNormalized(command) {
    if (command?.operation !== TARGET) return command;
    const body = command.body;
    if (!body || typeof body !== "object" || Array.isArray(body))
      fail(
        "FBS_ORDER_STATUSES_BODY_REQUIRED",
        "fbs_order_statuses requires an object body.",
      );
    if (!Object.hasOwn(body, "orders"))
      fail(
        "FBS_ORDER_STATUSES_ORDERS_REQUIRED",
        "fbs_order_statuses body must contain orders.",
      );
    const keys = Object.keys(body);
    if (keys.length !== 1)
      fail(
        "FBS_ORDER_STATUSES_BODY_INVALID",
        "fbs_order_statuses body must contain only orders.",
      );
    const orders = body.orders;
    if (!Array.isArray(orders) || orders.length === 0)
      fail(
        "FBS_ORDER_STATUSES_ORDERS_REQUIRED",
        "fbs_order_statuses orders must contain at least one ID.",
      );
    if (orders.length > MAX_ORDERS)
      fail(
        "FBS_ORDER_STATUSES_TOO_MANY_ORDERS",
        "fbs_order_statuses accepts at most 1000 IDs.",
      );
    if (orders.some((id) => !Number.isSafeInteger(id)))
      fail(
        "FBS_ORDER_STATUSES_ORDER_ID_INVALID",
        "fbs_order_statuses order IDs must be safe integers.",
      );
    return command;
  }
  function validateInput(command) {
    if (command?.operation !== TARGET) return command;
    if (Object.hasOwn(command, "params"))
      return validateNormalized(base.normalizeCommand(command));
    return validateNormalized(command);
  }
  function normalizeCommand(raw) {
    return validateNormalized(base.normalizeCommand(raw));
  }
  function parseCommand(text) {
    return validateNormalized(base.parseCommand(text));
  }
  function preflightExecution(command) {
    validateInput(command);
    return base.preflightExecution(command);
  }
  function buildRequest(command, headers = {}) {
    validateInput(command);
    return base.buildRequest(command, headers);
  }

  globalThis.WBContract = Object.freeze({
    ...base,
    normalizeCommand,
    parseCommand,
    preflightExecution,
    buildRequest,
  });
})();
