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
  const profile = owner.batch.capability_resolution?.profile || {
    status: "not_needed",
    subscription_type: "UNKNOWN",
    is_premium: null,
    probe_performed: false,
    probe_http_status: 0,
    probe_error_code: null,
  };
  // Keep recovered uncertainty visible in the result without modifying
  // the immutable imported contract's legacy Boolean normalization.
  const recoveredUnknown =
    owner.batch.capability_resolution?.probe_observation === "RECOVERED_UNKNOWN" &&
    owner.batch.capability_resolution?.probe_performed === null &&
    profile.status === "unknown";
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
      const planning =
        recoveredUnknown && plan.planning?.capability
          ? {
              ...plan.planning,
              capability: {
                ...plan.planning.capability,
                probe_performed: null,
                probe_observation: "RECOVERED_UNKNOWN",
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
