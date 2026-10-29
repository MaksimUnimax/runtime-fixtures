async function ensureBatchCapabilityAndPlanning({
  ownerKind,
  ownerId,
  getOwner,
  mutateOwner,
  ownerMatches,
  isCollecting,
  failOwner,
  executionContext = null,
}) {
  let owner = await getOwner();
  if (!owner || !ownerMatches(owner))
    return { ok: false, code: "BATCH_OWNER_NOT_ACTIVE" };
  if (!isCollecting(owner) || !owner.batch)
    return { ok: true, code: "BATCH_NOT_COLLECTING", owner };
  if (owner.batch.planning_state === "complete")
    return { ok: true, code: "BATCH_PLANNING_READY", owner };

  const entries = Array.isArray(owner.batch.entries) ? owner.batch.entries : [];
  const nextIndex = Math.max(0, Number(owner.batch.next_index || 0));
  if (
    nextIndex > 0 ||
    entries.some(
      (entry) => entry?.status === "requesting" || entry?.status === "complete",
    )
  ) {
    await failOwner(
      "BATCH_PLANNING_MIGRATION_UNSAFE",
      "Batch уже начал исполнение без Step 1 capability plan; новые provider requests запрещены.",
    );
    return { ok: false, code: "BATCH_PLANNING_MIGRATION_UNSAFE" };
  }

  const commandEntries = entries.filter(
    (entry) => entry?.kind === "command" && entry?.command,
  );
  const planningAtMs = Date.now();
  const settingsForPlanning = await (executionContext
    ? executionContext.settings()
    : getSettings());
  const entitlementSnapshot = settingsForPlanning.sellerApiMetadata;
  const capabilityRequired = commandEntries.some((entry) => {
    try {
      return (
        OzonContract.sellerCapabilityRequirement(
          entry.command,
          planningAtMs,
          entitlementSnapshot,
        ).required === true
      );
    } catch (_) {
      return false;
    }
  });

  let resolution =
    owner.batch.capability_resolution &&
    typeof owner.batch.capability_resolution === "object"
      ? owner.batch.capability_resolution
      : null;
  if (!capabilityRequired) {
    const profile = {
      status: "not_needed",
      subscription_type: "UNKNOWN",
      is_premium: null,
      probe_performed: false,
      probe_observation: "NOT_NEEDED",
      probe_http_status: 0,
      probe_error_code: null,
    };
    owner = await mutateOwner((current) => {
      if (
        !current ||
        !ownerMatches(current) ||
        !isCollecting(current) ||
        !current.batch ||
        current.batch.planning_state === "complete"
      )
        return current;
      if (
        Math.max(0, Number(current.batch.next_index || 0)) !== 0 ||
        current.batch.request_state !== "idle"
      )
        return current;
      return {
        ...current,
        batch: {
          ...current.batch,
          capability_resolution: {
            state: "not_needed",
            probe_performed: false,
            probe_observation: "NOT_NEEDED",
            profile,
            resolved_at: new Date().toISOString(),
          },
        },
      };
    });
    resolution = owner?.batch?.capability_resolution || {
      state: "not_needed",
      profile,
    };
  } else {
    if (
      resolution?.state === "requesting" &&
      String(resolution.request_worker_session_id || "") !== WORKER_SESSION_ID
    ) {
      // The prior worker may have sent a request; absence of a receipt does
      // not prove either a physical send or a pre-dispatch refusal.
      const profile = Object.freeze({
        ...capabilityUnknownProfile(),
        probe_performed: null,
        probe_observation: "RECOVERED_UNKNOWN",
      });
      owner = await mutateOwner((current) => {
        if (
          !current ||
          !ownerMatches(current) ||
          !isCollecting(current) ||
          !current.batch
        )
          return current;
        const live = current.batch.capability_resolution;
        if (
          live?.state !== "requesting" ||
          String(live.request_worker_session_id || "") === WORKER_SESSION_ID
        )
          return current;
        return {
          ...current,
          batch: {
            ...current.batch,
            capability_resolution: {
              state: "complete",
              probe_performed: null,
              probe_observation: "RECOVERED_UNKNOWN",
              profile,
              resolved_at: new Date().toISOString(),
              request_worker_session_id: null,
            },
          },
        };
      });
      resolution = owner?.batch?.capability_resolution || {
        state: "complete",
        profile,
      };
      if (
        resolution?.probe_observation === "RECOVERED_UNKNOWN" &&
        resolution.probe_performed === null &&
        resolution.profile?.status === "unknown"
      ) {
        await diagnostic(
          "CAPABILITY_PROBE_RECOVERY_NO_RETRY",
          {
            owner_kind: ownerKind,
            owner_id: ownerId,
            code: profile.probe_error_code,
            probe_performed: null,
            probe_observation: "RECOVERED_UNKNOWN",
          },
          { level: "warning" },
        );
      }
    }

    if (
      !resolution ||
      !["complete", "not_needed"].includes(String(resolution.state || ""))
    ) {
      let probeGranted = false;
      owner = await mutateOwner((current) => {
        if (
          !current ||
          !ownerMatches(current) ||
          !isCollecting(current) ||
          !current.batch
        )
          return current;
        if (current.batch.planning_state === "complete") return current;
        const live = current.batch.capability_resolution;
        if (live?.state === "complete" || live?.state === "not_needed")
          return current;
        if (live?.state === "requesting") return current;
        if (
          Math.max(0, Number(current.batch.next_index || 0)) !== 0 ||
          current.batch.request_state !== "idle"
        )
          return current;
        probeGranted = true;
        return {
          ...current,
          batch: {
            ...current.batch,
            capability_resolution: {
              state: "requesting",
              probe_performed: false,
              probe_observation: "RESERVED_NOT_SENT",
              request_worker_session_id: WORKER_SESSION_ID,
              started_at: new Date().toISOString(),
              profile: null,
            },
          },
        };
      });
      if (probeGranted) {
        await diagnostic("CAPABILITY_PROBE_STARTED", {
          owner_kind: ownerKind,
          owner_id: ownerId,
          path_alias: "seller_info_internal",
        });
        const profile = await OzonProvider.resolveSellerCapability(
          settingsForPlanning.sellerCredentials,
          executionContext,
        );
        let stored = false;
        owner = await mutateOwner((current) => {
          if (
            !current ||
            !ownerMatches(current) ||
            !isCollecting(current) ||
            !current.batch
          )
            return current;
          const live = current.batch.capability_resolution;
          if (
            live?.state !== "requesting" ||
            live?.request_worker_session_id !== WORKER_SESSION_ID
          )
            return current;
          stored = true;
          return {
            ...current,
            batch: {
              ...current.batch,
              capability_resolution: {
                state: "complete",
                probe_performed:
                  typeof profile.probe_performed === "boolean"
                    ? profile.probe_performed
                    : null,
                probe_observation: [
                  "NOT_ATTEMPTED", "FETCH_INVOKED_OUTCOME_UNKNOWN",
                  "RESPONSE_OBSERVED",
                ].includes(profile.probe_observation)
                  ? profile.probe_observation
                  : "LEGACY_UNKNOWN",
                profile,
                resolved_at: new Date().toISOString(),
                request_worker_session_id: null,
              },
            },
          };
        });
        if (!stored) {
          // A stale worker must never fail or overwrite a newer worker's
          // recovered or witnessed durable capability result.
          owner = await getOwner();
          if (!owner || !ownerMatches(owner) || !isCollecting(owner) || !owner.batch)
            return { ok: false, code: "BATCH_OWNER_NOT_ACTIVE", owner };
          const durable = owner.batch.capability_resolution;
          if (
            durable?.state !== "requesting" ||
            durable?.request_worker_session_id !== WORKER_SESSION_ID
          )
            return { ok: false, code: "CAPABILITY_PROBE_RESULT_SUPERSEDED", owner };
          await failOwner(
            "CAPABILITY_PROBE_STORE_RACE",
            "Capability probe завершился, но durable batch state изменился; business requests запрещены.",
          );
          return { ok: false, code: "CAPABILITY_PROBE_STORE_RACE" };
        }
        await diagnostic(
          "CAPABILITY_PROBE_FINISHED",
          {
            owner_kind: ownerKind,
            owner_id: ownerId,
            status: profile.status,
            subscription_type: profile.subscription_type,
            http_status: profile.probe_http_status,
            error_code: profile.probe_error_code,
          },
          { level: profile.status === "known" ? "info" : "warning" },
        );
        resolution = owner.batch.capability_resolution;
      } else {
        owner = await getOwner();
        resolution = owner?.batch?.capability_resolution || null;
        if (
          resolution?.state === "requesting" &&
          resolution.request_worker_session_id === WORKER_SESSION_ID
        )
          return { ok: true, code: "CAPABILITY_PROBE_IN_PROGRESS", owner };
        if (
          !resolution ||
          !["complete", "not_needed"].includes(String(resolution.state || ""))
        )
          return { ok: false, code: "CAPABILITY_PROBE_NOT_READY" };
      }
    }
  }

  owner = await getOwner();
  if (!owner || !ownerMatches(owner) || !isCollecting(owner) || !owner.batch)
    return { ok: false, code: "BATCH_OWNER_NOT_ACTIVE" };
  if (owner.batch.planning_state === "complete")
    return { ok: true, code: "BATCH_PLANNING_READY", owner };
  // Fail closed on legacy "known" profiles without a witnessed Seller
  // subscription response. Keep the persisted original: never replay or
  // overwrite a prior worker's durable receipt merely to reauthorize a plan.
  const persistedProfile = owner.batch.capability_resolution?.profile || {
    status: "not_needed",
    subscription_type: "UNKNOWN",
    is_premium: null,
    probe_performed: false,
    probe_observation: "NOT_NEEDED",
    probe_http_status: 0,
    probe_error_code: null,
  };
  const rawHttp = Number(persistedProfile?.probe_http_status);
  const received =
    persistedProfile?.probe_observation === "RESPONSE_OBSERVED" &&
    persistedProfile?.probe_performed === true &&
    Number.isInteger(rawHttp) && rawHttp >= 100 && rawHttp <= 599;
  const knownWithReceipt =
    received && rawHttp >= 200 && rawHttp < 300 &&
    persistedProfile?.status === "known";
  const observations = [
    "NOT_ATTEMPTED", "FETCH_INVOKED_OUTCOME_UNKNOWN",
    "RESPONSE_OBSERVED", "RECOVERED_UNKNOWN", "NOT_NEEDED",
  ];
  const observation = observations.includes(persistedProfile?.probe_observation)
    ? persistedProfile.probe_observation : "LEGACY_UNKNOWN";
  const performed =
    observation === "RESPONSE_OBSERVED" ||
    observation === "FETCH_INVOKED_OUTCOME_UNKNOWN"
      ? persistedProfile?.probe_performed === true ? true : null
      : observation === "NOT_ATTEMPTED" || observation === "NOT_NEEDED"
        ? false : null;
  let safeErrorCode = null;
  try {
    const rawCode = persistedProfile?.probe_error_code;
    if (rawCode != null) {
      const publicCodes = new Set([
        "MISSING_CLIENT_ID", "MISSING_API_KEY",
        "INVALID_CLIENT_ID", "INVALID_API_KEY",
        "INCOMPLETE_SELLER_CREDENTIALS", "FETCH_IMPL_MISSING",
        "INVALID_REQUEST", "UNTRUSTED_REQUEST_HOST",
        "UNTRUSTED_REQUEST_METHOD", "PROVIDER_FETCH_FAILED",
        "SELLER_CAPABILITY_PROBE_FAILED",
        "SELLER_CAPABILITY_PROBE_HTTP_ERROR",
        "SELLER_CAPABILITY_SUBSCRIPTION_UNKNOWN",
        "CAPABILITY_PROBE_OUTCOME_UNKNOWN_NO_RETRY",
        "EXECUTION_CONTEXT_CHANGED",
      ]);
      safeErrorCode = typeof rawCode === "string" && publicCodes.has(rawCode)
        ? rawCode : "SELLER_CAPABILITY_PROBE_FAILED";
    }
  } catch (_) {
    safeErrorCode = "SELLER_CAPABILITY_PROBE_FAILED";
  }
  const profile = {
    ...persistedProfile,
    status: !capabilityRequired && persistedProfile?.status === "not_needed"
      ? "not_needed" : knownWithReceipt ? "known" : "unknown",
    subscription_type: knownWithReceipt
      ? persistedProfile.subscription_type : "UNKNOWN",
    is_premium: knownWithReceipt
      ? persistedProfile.is_premium === true : null,
    probe_performed: performed,
    probe_observation: observation,
    probe_http_status: received ? rawHttp : 0,
    probe_error_code: safeErrorCode,
  };
  let plannedEntries;
  try {
    plannedEntries = (owner.batch.entries || []).map((entry) => {
      if (!entry || entry.kind !== "command" || !entry.command) return entry;
      const plan = OzonContract.planCommandForSellerCapability(
        entry.command,
        profile,
        planningAtMs,
        entitlementSnapshot,
      );
      // Frozen imported contract predates tri-state evidence; never convert
      // unknown worker/legacy outcomes to an invented Boolean in the report.
      const planning = plan.planning?.capability
        ? {
            ...plan.planning,
            capability: {
              ...plan.planning.capability,
              probe_performed: profile.probe_performed,
              probe_observation: profile.probe_observation,
            },
          }
        : plan.planning || null;
      if (plan.action === "reject") {
        return {
          ...entry,
          kind: "planning_error",
          status: "pending",
          error: {
            code: String(plan.error?.code || "CAPABILITY_PLANNING_REJECTED"),
            message: String(
              plan.error?.message || "Capability planning rejected command.",
            ),
          },
          execution_command: null,
          planning,
        };
      }
      return {
        ...entry,
        execution_command: plan.command,
        planning,
      };
    });
  } catch (error) {
    await failOwner(
      error.code || "BATCH_CAPABILITY_PLANNING_FAILED",
      error.message || String(error),
    );
    return {
      ok: false,
      code: error.code || "BATCH_CAPABILITY_PLANNING_FAILED",
    };
  }

  let planningStored = false;
  owner = await mutateOwner((current) => {
    if (
      !current ||
      !ownerMatches(current) ||
      !isCollecting(current) ||
      !current.batch
    )
      return current;
    if (current.batch.planning_state === "complete") return current;
    if (
      Math.max(0, Number(current.batch.next_index || 0)) !== 0 ||
      current.batch.request_state !== "idle"
    )
      return current;
    planningStored = true;
    return {
      ...current,
      batch: {
        ...current.batch,
        entries: plannedEntries,
        planning_state: "complete",
        planning_at_ms: planningAtMs,
        planning_completed_at: new Date().toISOString(),
      },
    };
  });
  if (!planningStored) {
    await failOwner(
      "BATCH_PLANNING_STORE_RACE",
      "Capability plan не удалось сохранить до provider execution; business requests запрещены.",
    );
    return { ok: false, code: "BATCH_PLANNING_STORE_RACE" };
  }
  await diagnostic("BATCH_CAPABILITY_PLANNING_COMPLETED", {
    owner_kind: ownerKind,
    owner_id: ownerId,
    capability_probe_performed:
      owner.batch.capability_resolution?.probe_performed ?? null,
    capability_probe_observation:
      owner.batch.capability_resolution?.probe_observation || "LEGACY_UNKNOWN",
    capability_status:
      owner.batch.capability_resolution?.profile?.status || "not_needed",
    planned_command_count: plannedEntries.filter(
      (entry) => entry?.kind === "command",
    ).length,
    planning_error_count: plannedEntries.filter(
      (entry) => entry?.kind === "planning_error",
    ).length,
  });
  return { ok: true, code: "BATCH_PLANNING_READY", owner };
}
