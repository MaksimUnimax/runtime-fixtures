async function executeOzonCore(
  commandText,
  {
    executionCommand = null,
    planning = null,
    quotaPermit = null,
    executionContext = null,
    onProviderResponse = null,
    onProviderResult = null,
  } = {},
) {
  const settings = await (executionContext
    ? executionContext.settings()
    : getSettings());
  const command = OzonContract.parseCommand(commandText);
  const physicalCommand = executionCommand
    ? OzonContract.normalizeCommand(executionCommand)
    : command;
  if (physicalCommand.operation !== command.operation)
    throw Object.assign(
      new Error("Planned physical operation не совпадает с logical operation."),
      { code: "PLANNED_OPERATION_MISMATCH" },
    );
  await saCheckOzonFileRef(command, executionContext);
  const fingerprint = OzonContract.commandFingerprint(command);
  const physicalFingerprint = OzonContract.commandFingerprint(physicalCommand);
  await diagnostic("OZON_REQUEST_STARTED", {
    operation: command.operation,
    command_fingerprint: fingerprint,
    physical_command_fingerprint: physicalFingerprint,
    command_transformed: fingerprint !== physicalFingerprint,
  });
  try {
    const response =
      typeof OzonProvider.executeCommandObject === "function"
        ? await OzonProvider.executeCommandObject(
            physicalCommand,
            settings.sellerCredentials,
            settings.performanceCredentials,
            {
              reportCommand: command,
              executionGuard: executionContext,
              planning,
              quota: safeQuotaMetadata(quotaPermit),
              onProviderResponse: async (providerResponse) => {
                if (typeof onProviderResponse === "function")
                  await onProviderResponse(providerResponse);
                if (quotaPermit)
                  return extendAnalyticsQuotaFromRetryAfter(
                    quotaPermit,
                    providerResponse?.response?.responseMeta?.retry_after,
                  );
                return null;
              },
              onProviderResult,
            },
          )
        : await OzonProvider.executeCommand(
            commandText,
            settings.sellerCredentials,
            settings.performanceCredentials,
          );
    if (executionContext) await executionContext.assertCurrent();
    await saRememberOzonFileRefs(response, executionContext);
    await diagnostic(
      "OZON_REQUEST_FINISHED",
      {
        request_id: response.request_id || null,
        operation: command.operation,
        provider:
          response.provider ||
          OzonContract.preflightExecution(command).meta.provider ||
          "seller_api",
        command_fingerprint: fingerprint,
        physical_command_fingerprint:
          response.executed_command_fingerprint || physicalFingerprint,
        http_status: response.http_status,
        ok: response.ok,
        quota_family: response.rate_limit?.quota_family || null,
        next_allowed_at: Number(response.rate_limit?.next_allowed_at || 0),
      },
      { level: response.ok ? "info" : "warning" },
    );
    await setStatus(
      response.ok
        ? {
            ok: true,
            code: "CONNECTED",
            message: "Последний Ozon API запрос выполнен успешно.",
            http_status: response.http_status,
          }
        : {
            ok: false,
            code: "OZON_API_ERROR",
            message: `Ozon API вернул HTTP ${response.http_status}.`,
            http_status: response.http_status,
          },
    );
    return { ...response, auto_send: settings.autoSend };
  } catch (error) {
    const safe = OzonContract.safeBridgeErrorPayload(
      error,
      Number(error?.http_status || 0),
    );
    await diagnostic(
      "OZON_REQUEST_FAILED",
      {
        operation: command.operation,
        command_fingerprint: fingerprint,
        physical_command_fingerprint: physicalFingerprint,
        code: safe.code,
        error: safe.message,
        http_status: safe.http_status,
        external_request_executed: safe.external_request_executed === true,
      },
      { level: "error" },
    );
    await setStatus({
      ok: false,
      code: safe.code,
      message: safe.message,
      http_status: safe.http_status,
    });
    throw error;
  }
}
