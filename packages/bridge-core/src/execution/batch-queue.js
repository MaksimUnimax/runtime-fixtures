(() => {
  "use strict";
  function create(ports) {
    const {
      normalizeKey,
      singleFlight,
      flights,
      preparePolicy,
      prepareCapability,
      prepareQueries,
      workerId,
      diagnostic,
      guidanceResult,
      policyErrorResult,
      planningErrorResult,
      findGroup,
      readCache,
      projectGroup,
      prepareQuota,
      groupError,
      persistQuotaWait,
      quotaMetadata,
      execute,
      groupPlanning,
      storeCache,
      cachedResult,
      acquisitionPlanning,
      executionError,
      projectSingle,
      reviewedAcquisitionProfile,
      providerId,
      coalescedOperation,
      bridgeErrorCode,
      beforeProviderDispatch,
    } = ports;
    const outcome = globalThis.SellerAgentsProviderOutcome;
    const resultRecovery = globalThis.SellerAgentsResultRecovery;
    const attemptId = () => `provider-attempt-${crypto.randomUUID()}`;
    const logicalId = (owner, index) => `${String(owner?.operation_id || owner?.run_id || ownerId)}:${index}`;
    function attemptInput(owner, entry, index, id, number = 1) {
      const context = owner?.execution_context || {};
      return {
        logical_execution_id: logicalId(owner, index),
        provider_attempt_id: id,
        execution_id: owner?.operation_id || owner?.run_id || ownerId,
        command_index: index,
        account: context.accountId,
        conversation: context.conversationKey,
        work_generation: context.workSessionId,
        binding: context.bindingId,
        binding_revision: context.bindingRevision,
        marketplace: context.marketplace || providerId,
        store: context.storeId,
        credential_revision: context.credentialRevision,
        operation: entry?.operation || entry?.command?.operation || coalescedOperation,
        attempt_number: number,
      };
    }
    function setAttempt(entry, attempt) {
      if (!attempt) return entry;
      const history = Array.isArray(entry?.provider_attempt_history)
        ? entry.provider_attempt_history
        : [];
      return {
        ...entry,
        provider_attempt: attempt,
        provider_attempt_history: outcome.compactHistory(
          history.map((row) => row.provider_attempt_id === attempt.provider_attempt_id ? attempt : row),
        ),
      };
    }
    async function commitAttemptIntent({ owner, indexes, entryForIndex, mutateOwner, ownerMatches, isCollecting, providerAttemptId }) {
      const now = Date.now();
      const attempts = new Map(indexes.map((index) => [index, outcome.createIntent(attemptInput(owner, entryForIndex(index), index, providerAttemptId), now)]));
      let stored = false;
      const next = await mutateOwner((current) => {
        if (!current || !ownerMatches(current) || !isCollecting(current) || !current.batch) return current;
        const currentEntries = [...(current.batch.entries || [])];
        for (const index of indexes) {
          const entry = currentEntries[index];
          if (!entry || entry.status !== "requesting") return current;
          const previous = Array.isArray(entry.provider_attempt_history) ? entry.provider_attempt_history : [];
          if (entry.provider_attempt?.state === outcome.STATES.DISPATCH_INTENT_COMMITTED) return current;
          currentEntries[index] = {
            ...entry,
            provider_attempt_id: providerAttemptId,
            provider_attempt: attempts.get(index),
            provider_attempt_history: outcome.compactHistory([...previous, attempts.get(index)], now),
          };
        }
        stored = true;
        return { ...current, batch: { ...current.batch, entries: currentEntries } };
      });
      return { stored, owner: next, attempts };
    }
    async function recordResponse({ indexes, mutateOwner, ownerMatches, isCollecting, providerAttemptId, response }) {
      let stored = false;
      const next = await mutateOwner((current) => {
        if (!current || !ownerMatches(current) || !isCollecting(current) || !current.batch) return current;
        const currentEntries = [...(current.batch.entries || [])];
        for (const index of indexes) {
          const entry = currentEntries[index];
          if (!entry || entry.provider_attempt_id !== providerAttemptId || !entry.provider_attempt) return current;
          currentEntries[index] = setAttempt(entry, outcome.markResponseReceived(entry.provider_attempt, response));
        }
        stored = true;
        return { ...current, batch: { ...current.batch, entries: currentEntries } };
      });
      if (!stored) throw Object.assign(new Error("Provider response receipt could not be committed"), { code: "PROVIDER_RESPONSE_RECEIPT_STORE_FAILED" });
      return next;
    }
    async function recordResultBuffer({ indexes, mutateOwner, ownerMatches, isCollecting, providerAttemptId, providerResult, projectionKind = "single" }) {
      if (!resultRecovery?.createBuffer || !providerResult) return;
      let stored = false;
      await mutateOwner((current) => {
        if (!current || !ownerMatches(current) || !isCollecting(current) || !current.batch) return current;
        const entries = [...(current.batch.entries || [])];
        for (const index of indexes) {
          const entry = entries[index];
          if (!entry || entry.provider_attempt_id !== providerAttemptId || !entry.provider_attempt) return current;
          let attempt = entry.provider_attempt;
          if (attempt.state === outcome.STATES.DISPATCH_INTENT_COMMITTED) {
            attempt = outcome.markResponseReceived(attempt, {
              ok: providerResult.ok === true,
              httpStatus: Number(providerResult.http_status || 0),
              external_request_executed: providerResult.external_request_executed !== false,
              response_meta: providerResult.response_meta,
            });
          }
          if (![outcome.STATES.RESPONSE_RECEIVED, outcome.STATES.COMPLETED_KNOWN, outcome.STATES.FAILED_KNOWN, outcome.STATES.RETRY_WAIT_KNOWN].includes(attempt.state)) return current;
          const buffer = resultRecovery.createBuffer({
            ...providerResult,
            logical_execution_id: attempt.logical_execution_id,
            provider_attempt_id: attempt.provider_attempt_id,
            execution_id: attempt.execution_id,
            command_index: attempt.command_index,
            context: {
              accountId: attempt.account,
              conversationKey: attempt.conversation,
              marketplace: attempt.marketplace,
              storeId: attempt.store,
              bindingId: attempt.binding,
              bindingRevision: attempt.binding_revision,
              workGeneration: attempt.work_generation,
            },
            expires_at_ms: current.payload_expires_at_ms,
            projection_kind: projectionKind,
          });
          entries[index] = { ...setAttempt(entry, attempt), result_buffer: buffer, result_phase: buffer.phase };
        }
        stored = true;
        return { ...current, batch: { ...current.batch, entries } };
      });
      if (!stored) throw Object.assign(new Error("Known provider result buffer could not be committed"), { code: "RESULT_BUFFER_STORE_FAILED" });
      const barrier = globalThis.__SELLER_AGENTS_TEST_HOOKS?.afterResultBufferCommit;
      if (typeof barrier === "function") await barrier({ provider_attempt_id: providerAttemptId, indexes: [...indexes] });
    }
    function bufferedProviderResult(entry) {
      const payload = entry?.result_buffer?.payload;
      if (!payload || typeof payload !== "object") return null;
      return { ...payload, result: payload.result, report_text: payload.report_text };
    }
    async function recoverBufferedSingle({ index, owner, entry, mutateOwner, ownerMatches, isCollecting }) {
      const buffer = entry?.result_buffer;
      const decision = resultRecovery?.recoveryDecision
        ? resultRecovery.recoveryDecision({ providerAttempt: entry.provider_attempt, resultBuffer: buffer, currentContext: owner.execution_context, now: Date.now() })
        : { type: "resume_local_result" };
      if (decision.type !== "resume_local_result") return decision;
      const result = bufferedProviderResult(entry);
      if (!result) return { type: "blocked", code: "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" };
      let stored = false;
      await mutateOwner((current) => {
        if (!current || !ownerMatches(current) || !isCollecting(current) || !current.batch || Number(current.batch.next_index || 0) !== index) return current;
        const entries = [...(current.batch.entries || [])];
        const live = entries[index];
        if (!live || live.status !== "requesting" || live.provider_attempt_id !== entry.provider_attempt_id) return current;
        entries[index] = {
          ...live,
          ...setAttempt(live, outcome.markKnown(live.provider_attempt, result.ok === true)),
          status: "complete",
          request_id: result.request_id || live.request_id || null,
          http_status: Number(result.http_status || 0),
          external_request_executed: result.external_request_executed !== false,
          executed_command_fingerprint: result.executed_command_fingerprint || null,
          report_text: String(result.report_text || ""),
          request_completed_at: new Date().toISOString(),
          result_phase: resultRecovery?.RESULT_PHASES?.MATERIALIZED || "MATERIALIZED",
        };
        stored = true;
        return { ...current, batch: { ...current.batch, entries, next_index: index + 1, request_state: "idle", request_worker_session_id: null, quota_wait: null, request_quota: null } };
      });
      return stored ? { type: "recovered", code: "KNOWN_RESULT_RECOVERED", provider_calls: 0 } : { type: "blocked", code: "RESULT_RECOVERY_STORE_RACE" };
    }
    async function recoverBufferedGroup({ nextIndex, owner, group, mutateOwner, ownerMatches, isCollecting }) {
      const expectedIndexes = Array.isArray(group?.member_indexes)
        ? group.member_indexes.map((value) => Number(value))
        : [];
      if (!expectedIndexes.length || expectedIndexes[0] !== nextIndex)
        return { type: "blocked", code: "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" };
      const members = expectedIndexes.map((index) => owner.batch.entries?.[index]);
      if (members.some((entry) => !entry || entry.status !== "requesting" || entry.result_buffer?.projection_kind !== "physical"))
        return { type: "blocked", code: "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" };
      const decisions = members.map((entry) => resultRecovery?.recoveryDecision
        ? resultRecovery.recoveryDecision({
            providerAttempt: entry.provider_attempt,
            resultBuffer: entry.result_buffer,
            currentContext: owner.execution_context,
            now: Date.now(),
          })
        : { type: "resume_local_result" });
      const blocked = decisions.find((decision) => decision.type !== "resume_local_result");
      if (blocked) return blocked;
      const physicalResult = bufferedProviderResult(members[0]);
      if (!physicalResult) return { type: "blocked", code: "RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY" };
      let logicalResults;
      try {
        logicalResults = members.map((member) => projectGroup(member, group, physicalResult));
      } catch (error) {
        logicalResults = members.map((member) => projectGroup(member, group, physicalResult, error));
      }
      let stored = false;
      await mutateOwner((current) => {
        if (!current || !ownerMatches(current) || !isCollecting(current) || !current.batch) return current;
        if (Number(current.batch.next_index || 0) !== nextIndex || current.batch.request_state !== "requesting") return current;
        const entries = [...(current.batch.entries || [])];
        for (let offset = 0; offset < expectedIndexes.length; offset += 1) {
          const index = expectedIndexes[offset];
          const entry = entries[index];
          if (!entry || entry.status !== "requesting" || String(entry.query_group_id || "") !== String(group.group_id) || !logicalResults[offset]) return current;
        }
        const completedAt = new Date().toISOString();
        for (let offset = 0; offset < expectedIndexes.length; offset += 1) {
          const index = expectedIndexes[offset];
          const entry = entries[index];
          const logicalResult = logicalResults[offset];
          entries[index] = {
            ...setAttempt(entry, finalAttempt(entry, physicalResult)),
            status: "complete",
            request_id: logicalResult.request_id || null,
            physical_request_id: logicalResult.physical_request_id || physicalResult.request_id || null,
            http_status: Number(logicalResult.http_status || 0),
            external_request_executed: logicalResult.external_request_executed === true,
            executed_command_fingerprint: logicalResult.executed_command_fingerprint || group.physical_command_fingerprint || null,
            report_text: String(logicalResult.report_text || ""),
            request_completed_at: completedAt,
            result_phase: resultRecovery?.RESULT_PHASES?.MATERIALIZED || "MATERIALIZED",
          };
        }
        stored = true;
        return {
          ...current,
          batch: {
            ...current.batch,
            entries,
            next_index: expectedIndexes[expectedIndexes.length - 1] + 1,
            request_state: "idle",
            request_worker_session_id: null,
            quota_wait: null,
            request_quota: null,
          },
        };
      });
      return stored ? { type: "recovered", code: "KNOWN_RESULT_RECOVERED", provider_calls: 0 } : { type: "blocked", code: "RESULT_RECOVERY_STORE_RACE" };
    }
    async function markRequestingUnknown({ indexes, mutateOwner, ownerMatches, isCollecting }) {
      await mutateOwner((current) => {
        if (!current || !ownerMatches(current) || !isCollecting(current) || !current.batch) return current;
        const currentEntries = [...(current.batch.entries || [])];
        let changed = false;
        for (const index of indexes) {
          const entry = currentEntries[index];
          if (!entry?.provider_attempt || entry.provider_attempt.state !== outcome.STATES.DISPATCH_INTENT_COMMITTED) continue;
          currentEntries[index] = setAttempt(entry, outcome.markUnknown(entry.provider_attempt));
          changed = true;
        }
        return changed ? { ...current, batch: { ...current.batch, entries: currentEntries } } : current;
      });
    }
    function finalAttempt(entry, result) {
      const record = entry?.provider_attempt;
      if (!record) return null;
      if (record.state === outcome.STATES.RESPONSE_RECEIVED)
        return outcome.markKnown(record, result?.ok === true);
      if (record.state === outcome.STATES.DISPATCH_INTENT_COMMITTED && result?.external_request_executed === false)
        return outcome.markKnown(
          outcome.markResponseReceived(record, {
            ok: false,
            httpStatus: Number(result?.http_status || 0),
            external_request_executed: false,
            response_meta: result?.response_meta,
          }),
          false,
        );
      if (record.state === outcome.STATES.DISPATCH_INTENT_COMMITTED)
        return outcome.markUnknown(record, Date.now(), "provider_call_or_response_not_durably_receipted");
      return record;
    }
    async function storePreDispatchDenial({ index, owner, entry, error, mutateOwner, ownerMatches, isCollecting }) {
      const result = executionError(entry.command, entry.command_fingerprint, error, 0, null);
      let stored = false;
      await mutateOwner((current) => {
        if (!current || !ownerMatches(current) || !isCollecting(current) || !current.batch) return current;
        if (Number(current.batch.next_index || 0) !== index || current.batch.request_state !== "requesting") return current;
        const entries = [...(current.batch.entries || [])];
        const currentEntry = entries[index];
        if (!currentEntry || currentEntry.status !== "requesting") return current;
        entries[index] = {
          ...currentEntry,
          status: "complete",
          request_id: result.request_id || null,
          http_status: Number(result.http_status || 0),
          external_request_executed: false,
          report_text: String(result.report_text || ""),
          request_completed_at: new Date().toISOString(),
        };
        stored = true;
        return { ...current, batch: { ...current.batch, entries, next_index: index + 1, request_state: "idle", request_worker_session_id: null, request_quota: null, quota_wait: null } };
      });
      return stored;
    }
    function process({
      conversationKey,
      ownerKind,
      ownerId,
      getOwner,
      mutateOwner,
      ownerMatches,
      isCollecting,
      failOwner,
      finalizeOwner,
    }) {
      const key = normalizeKey(conversationKey);
      const flightKey = `${String(ownerKind || "batch")}:${String(ownerId || "")}`;
      return singleFlight(flights, flightKey, async () => {
        const initialOwner = await getOwner();
        const initialEntries = Array.isArray(initialOwner?.batch?.entries)
          ? initialOwner.batch.entries
          : [];
        // Guidance and policy blocks are local results. Personal-data policy is
        // applied before any subscription probe, quota/cache scheduling or provider call.
        if (initialEntries.some((entry) => entry?.kind === "command")) {
          const policyPrepared = await preparePolicy({
            ownerKind,
            ownerId,
            getOwner,
            mutateOwner,
            ownerMatches,
            isCollecting,
            failOwner,
          });
          if (!policyPrepared?.ok)
            return policyPrepared || { ok: false, code: "BATCH_POLICY_FAILED" };
          const afterPolicy = await getOwner();
          const remainingCommands = Array.isArray(afterPolicy?.batch?.entries)
            ? afterPolicy.batch.entries.some(
                (entry) => entry?.kind === "command",
              )
            : false;
          if (remainingCommands) {
            const prepared = await prepareCapability({
              ownerKind,
              ownerId,
              getOwner,
              mutateOwner,
              ownerMatches,
              isCollecting,
              failOwner,
            });
            if (!prepared?.ok)
              return prepared || { ok: false, code: "BATCH_PLANNING_FAILED" };
            if (prepared.code === "CAPABILITY_PROBE_IN_PROGRESS")
              return { ok: true, code: "CAPABILITY_PROBE_IN_PROGRESS" };
            const queryPrepared = await prepareQueries({
              ownerKind,
              ownerId,
              getOwner,
              mutateOwner,
              ownerMatches,
              isCollecting,
              failOwner,
            });
            if (!queryPrepared?.ok)
              return (
                queryPrepared || {
                  ok: false,
                  code: "BATCH_QUERY_PLANNING_FAILED",
                }
              );
          }
        }
        while (true) {
          let owner = await getOwner();
          if (!owner || !ownerMatches(owner))
            return { ok: false, code: "BATCH_OWNER_NOT_ACTIVE" };
          if (!isCollecting(owner) || !owner.batch)
            return {
              ok: true,
              code: "BATCH_NOT_COLLECTING",
              status: owner.status || null,
            };

          const entries = Array.isArray(owner.batch.entries)
            ? owner.batch.entries
            : [];
          const nextIndex = Math.max(0, Number(owner.batch.next_index || 0));
          if (nextIndex >= entries.length)
            return await finalizeOwner(owner, entries);

          const entry = entries[nextIndex];
          if (!entry) {
            await failOwner(
              "BATCH_ENTRY_MISSING",
              `Batch entry ${nextIndex} отсутствует.`,
            );
            return { ok: false, code: "BATCH_ENTRY_MISSING" };
          }
          if (entry.status === "complete") {
            await mutateOwner((current) => {
              if (
                !current ||
                !ownerMatches(current) ||
                !isCollecting(current) ||
                !current.batch
              )
                return current;
              if (Number(current.batch.next_index || 0) !== nextIndex)
                return current;
              return {
                ...current,
                batch: { ...current.batch, next_index: nextIndex + 1 },
              };
            });
            continue;
          }
          if (entry.status === "requesting" && entry.result_buffer && !entry.query_group_id) {
            const recovered = await recoverBufferedSingle({ index: nextIndex, owner, entry, mutateOwner, ownerMatches, isCollecting });
            if (recovered.type === "recovered") {
              await diagnostic("KNOWN_RESULT_RECOVERED_NO_PROVIDER_REPLAY", { owner_kind: ownerKind, owner_id: ownerId, queue_index: nextIndex, provider_attempt_id: entry.provider_attempt_id, provider_calls: 0 });
              continue;
            }
            if (recovered.type === "blocked") {
              await failOwner(recovered.code, "Известный provider result нельзя безопасно восстановить; повторный provider request запрещён.");
              return { ok: false, code: recovered.code };
            }
          }
          if (entry.status === "requesting") {
            const worker = String(owner.batch.request_worker_session_id || "");
            if (worker && worker !== workerId) {
              await markRequestingUnknown({
                indexes: [nextIndex],
                mutateOwner,
                ownerMatches,
                isCollecting,
              });
              await failOwner(
                "REQUEST_OUTCOME_UNKNOWN_NO_RETRY",
                "Service worker перезапустился во время provider request. Исход запроса неизвестен; автоматический повтор запрещён.",
              );
              await diagnostic(
                "REQUEST_RECOVERY_BLOCKED_NO_RETRY",
                {
                  owner_kind: ownerKind,
                  owner_id: ownerId,
                  queue_index: nextIndex,
                  previous_worker_session_id: worker,
                  worker_session_id: workerId,
                },
                { level: "error" },
              );
              return { ok: false, code: "REQUEST_OUTCOME_UNKNOWN_NO_RETRY" };
            }
            return { ok: true, code: "REQUEST_IN_PROGRESS" };
          }

          if (
            entry.kind === "pre_execution_error" ||
            entry.kind === "guidance"
          ) {
            const guidance = guidanceResult(entry);
            if (entry.kind === "pre_execution_error")
              await diagnostic("GUIDANCE_ATTEMPT_CLASSIFIED", {
                owner_kind: ownerKind,
                owner_id: ownerId,
                code: entry.error?.code || "INVALID_COMMAND",
                status: guidance.status,
                cluster: guidance.cluster,
                external_request_executed: false,
              });
            else
              await diagnostic("GUIDANCE_CLUSTER_SELECTED", {
                owner_kind: ownerKind,
                owner_id: ownerId,
                status: guidance.status,
                cluster: guidance.cluster,
                external_request_executed: false,
              });
            const result = guidance;
            let stored = false;
            await mutateOwner((current) => {
              if (
                !current ||
                !ownerMatches(current) ||
                !isCollecting(current) ||
                !current.batch
              )
                return current;
              if (Number(current.batch.next_index || 0) !== nextIndex)
                return current;
              const currentEntries = [...(current.batch.entries || [])];
              const currentEntry = currentEntries[nextIndex];
              if (!currentEntry || currentEntry.status !== "pending")
                return current;
              currentEntries[nextIndex] = {
                ...currentEntry,
                status: "complete",
                request_id: result.request_id,
                http_status: 0,
                external_request_executed: false,
                report_text: result.report_text,
                request_completed_at: new Date().toISOString(),
              };
              stored = true;
              return {
                ...current,
                batch: {
                  ...current.batch,
                  entries: currentEntries,
                  next_index: nextIndex + 1,
                  request_state: "idle",
                  request_worker_session_id: null,
                },
              };
            });
            if (!stored) return { ok: false, code: "BATCH_ENTRY_STORE_RACE" };
            await diagnostic(
              "BATCH_PREEXEC_RESULT_STORED",
              {
                owner_kind: ownerKind,
                owner_id: ownerId,
                queue_index: nextIndex,
                code: entry.error?.code || entry.guidance?.status || "GUIDANCE",
                external_request_executed: false,
              },
              { level: "warning" },
            );
            continue;
          }

          if (entry.kind === "policy_error") {
            const result = policyErrorResult(
              entry.command,
              entry.command_fingerprint,
            );
            let stored = false;
            await mutateOwner((current) => {
              if (
                !current ||
                !ownerMatches(current) ||
                !isCollecting(current) ||
                !current.batch
              )
                return current;
              if (Number(current.batch.next_index || 0) !== nextIndex)
                return current;
              const currentEntries = [...(current.batch.entries || [])];
              const currentEntry = currentEntries[nextIndex];
              if (
                !currentEntry ||
                currentEntry.status !== "pending" ||
                currentEntry.kind !== "policy_error"
              )
                return current;
              currentEntries[nextIndex] = {
                ...currentEntry,
                status: "complete",
                request_id: result.request_id,
                http_status: 0,
                external_request_executed: false,
                report_text: result.report_text,
                request_completed_at: new Date().toISOString(),
              };
              stored = true;
              return {
                ...current,
                batch: {
                  ...current.batch,
                  entries: currentEntries,
                  next_index: nextIndex + 1,
                  request_state: "idle",
                  request_worker_session_id: null,
                },
              };
            });
            if (!stored)
              return { ok: false, code: "BATCH_POLICY_RESULT_STORE_RACE" };
            await diagnostic(
              "BATCH_PERSONAL_DATA_POLICY_RESULT_STORED",
              {
                owner_kind: ownerKind,
                owner_id: ownerId,
                queue_index: nextIndex,
                operation: entry.operation,
                code: "OPERATION_DISABLED_BY_USER",
                external_request_executed: false,
              },
              { level: "warning" },
            );
            continue;
          }

          if (entry.kind === "planning_error") {
            const plan = {
              error: entry.error || {},
              planning: entry.planning || null,
            };
            const result = planningErrorResult(
              entry.command,
              entry.command_fingerprint,
              plan,
            );
            let stored = false;
            await mutateOwner((current) => {
              if (
                !current ||
                !ownerMatches(current) ||
                !isCollecting(current) ||
                !current.batch
              )
                return current;
              if (Number(current.batch.next_index || 0) !== nextIndex)
                return current;
              const currentEntries = [...(current.batch.entries || [])];
              const currentEntry = currentEntries[nextIndex];
              if (
                !currentEntry ||
                currentEntry.status !== "pending" ||
                currentEntry.kind !== "planning_error"
              )
                return current;
              currentEntries[nextIndex] = {
                ...currentEntry,
                status: "complete",
                request_id: result.request_id,
                http_status: 0,
                external_request_executed: false,
                report_text: result.report_text,
                request_completed_at: new Date().toISOString(),
              };
              stored = true;
              return {
                ...current,
                batch: {
                  ...current.batch,
                  entries: currentEntries,
                  next_index: nextIndex + 1,
                  request_state: "idle",
                  request_worker_session_id: null,
                },
              };
            });
            if (!stored)
              return { ok: false, code: "BATCH_PLANNING_RESULT_STORE_RACE" };
            await diagnostic(
              "BATCH_CAPABILITY_RESULT_STORED",
              {
                owner_kind: ownerKind,
                owner_id: ownerId,
                queue_index: nextIndex,
                operation: entry.operation,
                code: entry.error?.code || "CAPABILITY_PLANNING_REJECTED",
                external_request_executed: false,
              },
              { level: "warning" },
            );
            continue;
          }

          if (entry.kind === "command" && entry.query_group_id) {
            const group = findGroup(owner.batch, entry.query_group_id);
            if (
              !group ||
              Number(group.leader_index) !== nextIndex ||
              !Array.isArray(group.member_indexes) ||
              group.member_indexes.length < 2
            ) {
              await failOwner(
                "BATCH_QUERY_PLAN_CORRUPT",
                "Durable query plan не совпадает с текущим queue index; provider request запрещён.",
              );
              return { ok: false, code: "BATCH_QUERY_PLAN_CORRUPT" };
            }
            const expectedIndexes = group.member_indexes.map((value) =>
              Number(value),
            );
            if (
              expectedIndexes.some(
                (value, offset) => value !== nextIndex + offset,
              )
            ) {
              await failOwner(
                "BATCH_QUERY_PLAN_NONCONTIGUOUS",
                "Step 2 coalescing допускает только contiguous logical commands; provider request запрещён.",
              );
              return { ok: false, code: "BATCH_QUERY_PLAN_NONCONTIGUOUS" };
            }

            if (entry.status === "requesting" && entry.result_buffer) {
              const recovered = await recoverBufferedGroup({
                nextIndex,
                owner,
                group,
                mutateOwner,
                ownerMatches,
                isCollecting,
              });
              if (recovered.type === "recovered") {
                await diagnostic("KNOWN_RESULT_RECOVERED_NO_PROVIDER_REPLAY", {
                  owner_kind: ownerKind,
                  owner_id: ownerId,
                  queue_index: nextIndex,
                  coalescing_group_id: group.group_id,
                  provider_calls: 0,
                });
                continue;
              }
              if (recovered.type === "blocked") {
                await failOwner(recovered.code, "Известный provider result нельзя безопасно восстановить; повторный provider request запрещён.");
                return { ok: false, code: recovered.code };
              }
            }

            const groupCacheHit = await readCache(group.physical_command);
            if (groupCacheHit.hit === true) {
              const members = expectedIndexes.map(
                (memberIndex) => owner.batch.entries[memberIndex],
              );
              const virtualPhysicalResult = {
                ok: true,
                request_id: null,
                physical_attempt_id: null,
                provider: providerId,
                executed_command_fingerprint:
                  group.physical_command_fingerprint,
                http_status: Number(groupCacheHit.http_status || 200),
                result: groupCacheHit.result,
                elapsed_ms: 0,
                rate_limit: null,
                external_request_executed: false,
                cache: groupCacheHit.cache,
              };
              const logicalResults = members.map((member) =>
                projectGroup(member, group, virtualPhysicalResult),
              );
              let cacheStored = false;
              owner = await mutateOwner((current) => {
                if (
                  !current ||
                  !ownerMatches(current) ||
                  !isCollecting(current) ||
                  !current.batch
                )
                  return current;
                if (Number(current.batch.next_index || 0) !== nextIndex)
                  return current;
                if (current.batch.request_state === "requesting")
                  return current;
                const currentEntries = [...(current.batch.entries || [])];
                for (
                  let offset = 0;
                  offset < expectedIndexes.length;
                  offset += 1
                ) {
                  const memberIndex = expectedIndexes[offset];
                  const currentEntry = currentEntries[memberIndex];
                  const logicalResult = logicalResults[offset];
                  if (
                    !currentEntry ||
                    currentEntry.status !== "pending" ||
                    !logicalResult
                  )
                    return current;
                  currentEntries[memberIndex] = {
                    ...currentEntry,
                    status: "complete",
                    request_id: logicalResult.request_id || null,
                    physical_request_id: null,
                    http_status: Number(logicalResult.http_status || 0),
                    external_request_executed: false,
                    executed_command_fingerprint:
                      group.physical_command_fingerprint || null,
                    cache_hit: true,
                    report_text: String(logicalResult.report_text || ""),
                    request_completed_at: new Date().toISOString(),
                  };
                }
                cacheStored = true;
                return {
                  ...current,
                  batch: {
                    ...current.batch,
                    entries: currentEntries,
                    next_index: expectedIndexes[expectedIndexes.length - 1] + 1,
                    request_state: "idle",
                    request_worker_session_id: null,
                    quota_wait: null,
                    request_quota: null,
                  },
                };
              });
              if (!cacheStored)
                return { ok: false, code: "PROVIDER_CACHE_RESULT_STORE_RACE" };
              await diagnostic("PROVIDER_CACHE_HIT", {
                owner_kind: ownerKind,
                owner_id: ownerId,
                queue_index: nextIndex,
                logical_count: logicalResults.length,
                coalescing_group_id: group.group_id,
                external_request_executed: false,
              });
              continue;
            }

            const quotaDecision = await prepareQuota(group.physical_command);
            if (quotaDecision.error) {
              const members = expectedIndexes.map(
                (memberIndex) => owner.batch.entries[memberIndex],
              );
              const logicalResults = members.map((member) =>
                groupError(member, group, quotaDecision.error, 0, null),
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
                if (Number(current.batch.next_index || 0) !== nextIndex)
                  return current;
                const currentEntries = [...(current.batch.entries || [])];
                for (
                  let offset = 0;
                  offset < expectedIndexes.length;
                  offset += 1
                ) {
                  const memberIndex = expectedIndexes[offset];
                  const currentEntry = currentEntries[memberIndex];
                  const logicalResult = logicalResults[offset];
                  if (
                    !currentEntry ||
                    currentEntry.status !== "pending" ||
                    !logicalResult
                  )
                    return current;
                  currentEntries[memberIndex] = {
                    ...currentEntry,
                    status: "complete",
                    request_id: logicalResult.request_id || null,
                    physical_request_id: null,
                    http_status: 0,
                    external_request_executed: false,
                    executed_command_fingerprint:
                      group.physical_command_fingerprint || null,
                    report_text: String(logicalResult.report_text || ""),
                    request_completed_at: new Date().toISOString(),
                  };
                }
                stored = true;
                return {
                  ...current,
                  batch: {
                    ...current.batch,
                    entries: currentEntries,
                    next_index: expectedIndexes[expectedIndexes.length - 1] + 1,
                    request_state: "idle",
                    request_worker_session_id: null,
                    quota_wait: null,
                    request_quota: null,
                  },
                };
              });
              if (!stored)
                return { ok: false, code: "PROVIDER_QUOTA_ERROR_STORE_RACE" };
              await diagnostic(
                "PROVIDER_QUOTA_STATE_UNAVAILABLE",
                {
                  owner_kind: ownerKind,
                  owner_id: ownerId,
                  queue_index: nextIndex,
                  logical_count: logicalResults.length,
                  external_request_executed: false,
                },
                { level: "error" },
              );
              continue;
            }
            if (quotaDecision.required && !quotaDecision.allowed) {
              await persistQuotaWait({
                ownerKind,
                ownerId,
                nextIndex,
                quota: quotaDecision.quota,
                mutateOwner,
                ownerMatches,
                isCollecting,
                groupId: group.group_id,
              });
              return {
                ok: true,
                code: "PROVIDER_QUOTA_WAITING",
                next_allowed_at: Number(
                  quotaDecision.quota?.next_allowed_at || 0,
                ),
              };
            }

            let groupGranted = false;
            owner = await mutateOwner((current) => {
              if (
                !current ||
                !ownerMatches(current) ||
                !isCollecting(current) ||
                !current.batch
              )
                return current;
              if (Number(current.batch.next_index || 0) !== nextIndex)
                return current;
              if (
                current.batch.query_planning_state !== "complete" ||
                !["idle", "quota_waiting"].includes(
                  String(current.batch.request_state || "idle"),
                )
              )
                return current;
              const liveGroup = findGroup(current.batch, entry.query_group_id);
              if (!liveGroup || Number(liveGroup.leader_index) !== nextIndex)
                return current;
              const currentEntries = [...(current.batch.entries || [])];
              for (const memberIndex of expectedIndexes) {
                const member = currentEntries[memberIndex];
                if (
                  !member ||
                  member.kind !== "command" ||
                  member.status !== "pending" ||
                  String(member.query_group_id || "") !== String(group.group_id)
                )
                  return current;
              }
              const startedAt = new Date().toISOString();
              for (const memberIndex of expectedIndexes)
                currentEntries[memberIndex] = {
                  ...currentEntries[memberIndex],
                  status: "requesting",
                  request_started_at: startedAt,
                };
              groupGranted = true;
              return {
                ...current,
                last_operation: coalescedOperation,
                batch: {
                  ...current.batch,
                  entries: currentEntries,
                  request_state: "requesting",
                  request_worker_session_id: workerId,
                  quota_wait: null,
                  request_quota: quotaMetadata(quotaDecision.quota),
                },
              };
            });
            if (!groupGranted) continue;

            if (typeof beforeProviderDispatch === "function") await beforeProviderDispatch();
            const groupProviderAttemptId = attemptId();
            const groupIntent = await commitAttemptIntent({
              owner,
              indexes: expectedIndexes,
              entryForIndex: (index) => owner.batch.entries[index],
              mutateOwner,
              ownerMatches,
              isCollecting,
              providerAttemptId: groupProviderAttemptId,
            });
            if (!groupIntent.stored) {
              await failOwner("PROVIDER_ATTEMPT_INTENT_STORE_RACE", "Provider dispatch intent was not durably committed; provider request suppressed.");
              return { ok: false, code: "PROVIDER_ATTEMPT_INTENT_STORE_RACE" };
            }
            owner = groupIntent.owner;

            const liveEntries = owner.batch.entries;
            const liveMembers = expectedIndexes.map(
              (memberIndex) => liveEntries[memberIndex],
            );
            const liveLeader = liveMembers[0];
            await diagnostic("BATCH_COALESCED_REQUEST_STARTED", {
              owner_kind: ownerKind,
              owner_id: ownerId,
              queue_index: nextIndex,
              queue_total: liveEntries.length,
              coalescing_group_id: group.group_id,
              logical_count: liveMembers.length,
              physical_command_fingerprint: group.physical_command_fingerprint,
              physical_metrics: group.physical_metrics,
            });

            const requestStartedAt = Date.now();
            const physicalAttemptId = `physical-attempt-${crypto.randomUUID()}`;
            let physicalResult = null;
            let logicalResults;
            let providerResponse = null;
            try {
              physicalResult = {
                ...(await execute(liveLeader.command_text, {
                  executionCommand: group.physical_command,
                  planning: groupPlanning(
                    liveLeader,
                    group,
                    physicalAttemptId,
                    group.physical_command_fingerprint,
                  ),
                  quotaPermit: quotaDecision.quota,
                  providerAttemptId: groupProviderAttemptId,
                  logicalExecutionId: logicalId(owner, nextIndex),
                  onProviderResponse: (response) => {
                    providerResponse = response?.response || response;
                  },
                  onProviderResult: async (value) => {
                    await recordResultBuffer({
                      indexes: expectedIndexes,
                      mutateOwner,
                      ownerMatches,
                      isCollecting,
                      providerAttemptId: groupProviderAttemptId,
                      providerResult: value?.provider_result || value,
                      projectionKind: "physical",
                    });
                  },
                })),
                physical_attempt_id: physicalAttemptId,
              };
              if (providerResponse)
                owner = await recordResponse({
                  indexes: expectedIndexes,
                  mutateOwner,
                  ownerMatches,
                  isCollecting,
                  providerAttemptId: groupProviderAttemptId,
                  response: providerResponse,
                });
              if (physicalResult.ok === true) {
                await storeCache(group.physical_command, physicalResult, null);
                try {
                  logicalResults = liveMembers.map((member) =>
                    projectGroup(member, group, physicalResult),
                  );
                } catch (projectionError) {
                  logicalResults = liveMembers.map((member) =>
                    projectGroup(
                      member,
                      group,
                      physicalResult,
                      projectionError,
                    ),
                  );
                  await diagnostic(
                    "BATCH_COALESCED_PROJECTION_FAILED",
                    {
                      owner_kind: ownerKind,
                      owner_id: ownerId,
                      coalescing_group_id: group.group_id,
                      physical_request_id: physicalResult.request_id || null,
                      code: String(
                        projectionError?.code ||
                          "ANALYTICS_COALESCED_RESPONSE_UNPROJECTABLE",
                      ),
                    },
                    { level: "error" },
                  );
                }
              } else {
                logicalResults = liveMembers.map((member) =>
                  projectGroup(member, group, physicalResult),
                );
              }
            } catch (error) {
              logicalResults = liveMembers.map((member) =>
                groupError(
                  member,
                  group,
                  error,
                  Date.now() - requestStartedAt,
                  physicalAttemptId,
                ),
              );
            }

            let stored = false;
            owner = await mutateOwner((current) => {
              if (
                !current ||
                !ownerMatches(current) ||
                !isCollecting(current) ||
                !current.batch
              )
                return current;
              if (Number(current.batch.next_index || 0) !== nextIndex)
                return current;
              if (
                current.batch.request_state !== "requesting" ||
                current.batch.request_worker_session_id !== workerId
              )
                return current;
              const currentEntries = [...(current.batch.entries || [])];
              for (
                let offset = 0;
                offset < expectedIndexes.length;
                offset += 1
              ) {
                const memberIndex = expectedIndexes[offset];
                const currentEntry = currentEntries[memberIndex];
                const logicalResult = logicalResults[offset];
                if (
                  !currentEntry ||
                  currentEntry.status !== "requesting" ||
                  String(currentEntry.query_group_id || "") !==
                    String(group.group_id) ||
                  !logicalResult
                )
                  return current;
              }
              const completedAt = new Date().toISOString();
              for (
                let offset = 0;
                offset < expectedIndexes.length;
                offset += 1
              ) {
                const memberIndex = expectedIndexes[offset];
                const currentEntry = currentEntries[memberIndex];
                const logicalResult = logicalResults[offset];
                currentEntries[memberIndex] = {
                  ...setAttempt(currentEntry, finalAttempt(currentEntry, physicalResult)),
                  status: "complete",
                  request_id: logicalResult.request_id || null,
                  physical_request_id:
                    logicalResult.physical_request_id ||
                    physicalResult?.request_id ||
                    null,
                  http_status: Number(logicalResult.http_status || 0),
                  external_request_executed:
                    logicalResult.external_request_executed === true,
                  executed_command_fingerprint:
                    logicalResult.executed_command_fingerprint ||
                    group.physical_command_fingerprint ||
                    null,
                  report_text: String(logicalResult.report_text || ""),
                  request_completed_at: completedAt,
                };
              }
              const firstBridgeError = logicalResults.find(
                (result) => result?.bridge_error === true,
              );
              stored = true;
              return {
                ...current,
                batch: {
                  ...current.batch,
                  entries: currentEntries,
                  next_index: expectedIndexes[expectedIndexes.length - 1] + 1,
                  request_state: "idle",
                  request_worker_session_id: null,
                  quota_wait: null,
                  request_quota: null,
                },
                last_error: firstBridgeError
                  ? {
                      code: firstBridgeError.error?.code || bridgeErrorCode,
                      message:
                        firstBridgeError.error?.message ||
                        "Coalesced bridge execution error converted to logical results.",
                      at: new Date().toISOString(),
                      recoverable: true,
                    }
                  : null,
              };
            });
            if (!stored) {
              await failOwner(
                "BATCH_COALESCED_RESULT_STORE_RACE",
                "Coalesced provider result получен, но durable batch state изменился до atomic logical projection store. Автоматический повтор запрещён.",
              );
              return { ok: false, code: "BATCH_COALESCED_RESULT_STORE_RACE" };
            }
            await diagnostic(
              "BATCH_COALESCED_RESULTS_STORED",
              {
                owner_kind: ownerKind,
                owner_id: ownerId,
                queue_index: nextIndex,
                logical_count: logicalResults.length,
                physical_request_id: physicalResult?.request_id || null,
                physical_command_fingerprint:
                  physicalResult?.executed_command_fingerprint ||
                  group.physical_command_fingerprint ||
                  null,
                http_status: Number(
                  physicalResult?.http_status ||
                    logicalResults[0]?.http_status ||
                    0,
                ),
                external_request_executed: logicalResults.some(
                  (result) => result?.external_request_executed === true,
                ),
              },
              {
                level: logicalResults.some((result) => result?.ok === false)
                  ? "warning"
                  : "info",
              },
            );
            continue;
          }

          const requestedPhysicalCommand =
            entry.execution_command || entry.command;
          const singleCacheHit = await readCache(requestedPhysicalCommand);
          if (singleCacheHit.hit === true) {
            const result = cachedResult(entry, singleCacheHit);
            let cacheStored = false;
            owner = await mutateOwner((current) => {
              if (
                !current ||
                !ownerMatches(current) ||
                !isCollecting(current) ||
                !current.batch
              )
                return current;
              if (Number(current.batch.next_index || 0) !== nextIndex)
                return current;
              if (current.batch.request_state === "requesting") return current;
              const currentEntries = [...(current.batch.entries || [])];
              const currentEntry = currentEntries[nextIndex];
              if (
                !currentEntry ||
                currentEntry.status !== "pending" ||
                currentEntry.kind !== "command"
              )
                return current;
              currentEntries[nextIndex] = {
                ...currentEntry,
                status: "complete",
                request_id: result.request_id || null,
                http_status: Number(result.http_status || 0),
                external_request_executed: false,
                executed_command_fingerprint:
                  result.executed_command_fingerprint || null,
                cache_hit: true,
                report_text: String(result.report_text || ""),
                request_completed_at: new Date().toISOString(),
              };
              cacheStored = true;
              return {
                ...current,
                batch: {
                  ...current.batch,
                  entries: currentEntries,
                  next_index: nextIndex + 1,
                  request_state: "idle",
                  request_worker_session_id: null,
                  quota_wait: null,
                  request_quota: null,
                },
              };
            });
            if (!cacheStored)
              return { ok: false, code: "PROVIDER_CACHE_RESULT_STORE_RACE" };
            await diagnostic("PROVIDER_CACHE_HIT", {
              owner_kind: ownerKind,
              owner_id: ownerId,
              queue_index: nextIndex,
              logical_count: 1,
              operation: entry.operation,
              external_request_executed: false,
            });
            continue;
          }
          const acquisitionProfile = reviewedAcquisitionProfile(
            requestedPhysicalCommand,
          );
          const physicalCommandForQuota = acquisitionProfile?.applicable
            ? acquisitionProfile.command
            : requestedPhysicalCommand;
          const executionPlanning = acquisitionPlanning(
            entry.planning || null,
            acquisitionProfile,
          );
          const quotaDecision = await prepareQuota(physicalCommandForQuota);
          if (quotaDecision.error) {
            const result = executionError(
              entry.command,
              entry.command_fingerprint,
              quotaDecision.error,
              0,
              executionPlanning,
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
              if (Number(current.batch.next_index || 0) !== nextIndex)
                return current;
              const currentEntries = [...(current.batch.entries || [])];
              const currentEntry = currentEntries[nextIndex];
              if (!currentEntry || currentEntry.status !== "pending")
                return current;
              currentEntries[nextIndex] = {
                ...currentEntry,
                status: "complete",
                request_id: result.request_id || null,
                http_status: 0,
                external_request_executed: false,
                executed_command_fingerprint: null,
                report_text: String(result.report_text || ""),
                request_completed_at: new Date().toISOString(),
              };
              stored = true;
              return {
                ...current,
                batch: {
                  ...current.batch,
                  entries: currentEntries,
                  next_index: nextIndex + 1,
                  request_state: "idle",
                  request_worker_session_id: null,
                  quota_wait: null,
                  request_quota: null,
                },
              };
            });
            if (!stored)
              return { ok: false, code: "PROVIDER_QUOTA_ERROR_STORE_RACE" };
            await diagnostic(
              "PROVIDER_QUOTA_STATE_UNAVAILABLE",
              {
                owner_kind: ownerKind,
                owner_id: ownerId,
                queue_index: nextIndex,
                logical_count: 1,
                external_request_executed: false,
              },
              { level: "error" },
            );
            continue;
          }
          if (quotaDecision.required && !quotaDecision.allowed) {
            await persistQuotaWait({
              ownerKind,
              ownerId,
              nextIndex,
              quota: quotaDecision.quota,
              mutateOwner,
              ownerMatches,
              isCollecting,
            });
            return {
              ok: true,
              code: "PROVIDER_QUOTA_WAITING",
              next_allowed_at: Number(
                quotaDecision.quota?.next_allowed_at || 0,
              ),
            };
          }

          let requestGranted = false;
          owner = await mutateOwner((current) => {
            if (
              !current ||
              !ownerMatches(current) ||
              !isCollecting(current) ||
              !current.batch
            )
              return current;
            if (Number(current.batch.next_index || 0) !== nextIndex)
              return current;
            const currentEntries = [...(current.batch.entries || [])];
            const currentEntry = currentEntries[nextIndex];
            if (
              !currentEntry ||
              currentEntry.status !== "pending" ||
              currentEntry.kind !== "command"
            )
              return current;
            requestGranted = true;
            currentEntries[nextIndex] = {
              ...currentEntry,
              status: "requesting",
              request_started_at: new Date().toISOString(),
            };
            return {
              ...current,
              last_operation: currentEntry.operation || null,
              batch: {
                ...current.batch,
                entries: currentEntries,
                request_state: "requesting",
                request_worker_session_id: workerId,
                quota_wait: null,
                request_quota: quotaMetadata(quotaDecision.quota),
              },
            };
          });
          if (!requestGranted) continue;

          const pendingEntry = owner.batch.entries[nextIndex];
          if (typeof beforeProviderDispatch === "function") {
            try {
              await beforeProviderDispatch();
            } catch (error) {
              if (error?.external_request_executed === false) {
                if (await storePreDispatchDenial({ index: nextIndex, owner, entry: pendingEntry, error, mutateOwner, ownerMatches, isCollecting })) continue;
              }
              throw error;
            }
          }
          const providerAttemptId = attemptId();
          const intent = await commitAttemptIntent({
            owner,
            indexes: [nextIndex],
            entryForIndex: () => owner.batch.entries[nextIndex],
            mutateOwner,
            ownerMatches,
            isCollecting,
            providerAttemptId,
          });
          if (!intent.stored) {
            await failOwner("PROVIDER_ATTEMPT_INTENT_STORE_RACE", "Provider dispatch intent was not durably committed; provider request suppressed.");
            return { ok: false, code: "PROVIDER_ATTEMPT_INTENT_STORE_RACE" };
          }
          owner = intent.owner;

          const liveEntry = owner.batch.entries[nextIndex];
          await diagnostic("BATCH_REQUEST_STARTED", {
            owner_kind: ownerKind,
            owner_id: ownerId,
            queue_index: nextIndex,
            queue_total: owner.batch.entries.length,
            operation: liveEntry.operation,
            command_fingerprint: liveEntry.command_fingerprint,
          });
          let result;
          const requestStartedAt = Date.now();
          let providerResponse = null;
          try {
            result = await execute(liveEntry.command_text, {
              executionCommand: physicalCommandForQuota,
              planning: executionPlanning,
              quotaPermit: quotaDecision.quota,
              providerAttemptId,
              logicalExecutionId: logicalId(owner, nextIndex),
              onProviderResponse: (response) => {
                providerResponse = response?.response || response;
              },
              onProviderResult: async (value) => {
                await recordResultBuffer({
                  indexes: [nextIndex],
                  mutateOwner,
                  ownerMatches,
                  isCollecting,
                  providerAttemptId,
                  providerResult: value?.provider_result || value,
                  projectionKind: "single",
                });
              },
            });
            if (providerResponse)
              owner = await recordResponse({
                indexes: [nextIndex],
                mutateOwner,
                ownerMatches,
                isCollecting,
                providerAttemptId,
                response: providerResponse,
              });
            if (
              result?.ok === true &&
              physicalCommandForQuota.operation === coalescedOperation
            ) {
              await storeCache(
                physicalCommandForQuota,
                result,
                acquisitionProfile,
              );
              result = projectSingle(liveEntry, result, acquisitionProfile);
            }
          } catch (error) {
            try {
              result = executionError(
                liveEntry.command,
                liveEntry.command_fingerprint,
                error,
                Date.now() - requestStartedAt,
                executionPlanning,
              );
            } catch (reportError) {
              await failOwner(
                reportError.code || "BATCH_ERROR_REPORT_FAILED",
                reportError.message || String(reportError),
              );
              throw reportError;
            }
          }

          let stored = false;
          owner = await mutateOwner((current) => {
            if (
              !current ||
              !ownerMatches(current) ||
              !isCollecting(current) ||
              !current.batch
            )
              return current;
            if (Number(current.batch.next_index || 0) !== nextIndex)
              return current;
            if (
              current.batch.request_state !== "requesting" ||
              current.batch.request_worker_session_id !== workerId
            )
              return current;
            const currentEntries = [...(current.batch.entries || [])];
            const currentEntry = currentEntries[nextIndex];
            if (!currentEntry || currentEntry.status !== "requesting")
              return current;
            currentEntries[nextIndex] = {
              ...setAttempt(currentEntry, finalAttempt(currentEntry, result)),
              status: "complete",
              request_id: result.request_id || null,
              http_status: Number(result.http_status || 0),
              external_request_executed:
                result.external_request_executed !== false &&
                (result.external_request_executed === true ||
                  result.bridge_error !== true),
              executed_command_fingerprint:
                result.executed_command_fingerprint || null,
              report_text: String(result.report_text || ""),
              request_completed_at: new Date().toISOString(),
            };
            stored = true;
            return {
              ...current,
              batch: {
                ...current.batch,
                entries: currentEntries,
                next_index: nextIndex + 1,
                request_state: "idle",
                request_worker_session_id: null,
                quota_wait: null,
                request_quota: null,
              },
              last_error: result.bridge_error
                ? {
                    code: result.error?.code || bridgeErrorCode,
                    message:
                      result.error?.message ||
                      "Bridge execution error converted to batch result.",
                    at: new Date().toISOString(),
                    recoverable: true,
                  }
                : null,
            };
          });
          if (!stored) {
            await failOwner(
              "BATCH_RESULT_STORE_RACE",
              "provider result получен, но durable batch state изменился до сохранения. Автоматический повтор запрещён.",
            );
            return { ok: false, code: "BATCH_RESULT_STORE_RACE" };
          }
          await diagnostic("BATCH_RESULT_STORED", {
            owner_kind: ownerKind,
            owner_id: ownerId,
            queue_index: nextIndex,
            queue_total: owner.batch.entries.length,
            operation: liveEntry.operation,
            request_id: result.request_id || null,
            executed_command_fingerprint:
              result.executed_command_fingerprint || null,
            http_status: Number(result.http_status || 0),
            external_request_executed:
              result.external_request_executed !== false &&
              (result.external_request_executed === true ||
                result.bridge_error !== true),
          });
          if (result.stop_after_result) {
            await failOwner(result.stop_after_result, "Результат сохранён; продолжение пакета остановлено.");
            return { ok: false, code: result.stop_after_result };
          }
        }
      });
    }
    return Object.freeze({ process });
  }
  globalThis.SellerAgentsBatchQueue = Object.freeze({ create });
})();
