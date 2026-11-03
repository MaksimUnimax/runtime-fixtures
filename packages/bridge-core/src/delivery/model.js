(() => {
  "use strict";

  function create(provider) {
    for (const name of [
      "directInlineFileRefFromReportText",
      "reportFileRefsFromBatch",
      "attachmentDeliveryPlan",
    ]) {
      if (typeof provider?.[name] !== "function")
        throw new TypeError(`Delivery provider port missing: ${name}`);
    }
    const RUN_STATUSES = Object.freeze({
      STARTING: "starting",
      WAITING_COMMAND: "waiting_command",
      REQUESTING: "requesting",
      COLLECTING: "collecting",
      DELIVERING: "delivering",
      PAUSED: "paused",
      STOPPED: "stopped",
      ERROR: "error",
    });

    const START_PHASES = Object.freeze({
      NONE: "none",
      COMMITTED: "committed",
      CONFIRMED: "confirmed",
    });
    const DELIVERY_PHASES = Object.freeze({
      CLAIMED: "claimed",
      COMMITTED: "committed",
      INSERT_COMMITTED: "insert_committed",
      INSERTED: "inserted",
      CONFIRMED: "confirmed",
    });
    const ATTACHMENT_PHASES = Object.freeze({
      CLAIMED: "attachment_claimed",
      ATTACH_COMMITTED: "attachment_committed",
      READY: "attachment_ready",
      SEND_COMMITTED: "attachment_send_committed",
      CONFIRMED: "attachment_confirmed",
    });

    function clampInteger(value, min, max, fallback = min) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.max(min, Math.min(max, Math.trunc(number)));
    }
    function normalizeIdList(value, max = 5000) {
      const result = [];
      const seen = new Set();
      for (const item of Array.isArray(value) ? value : []) {
        const id = String(item || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        result.push(id.slice(0, 240));
        if (result.length >= max) break;
      }
      return result;
    }
    function normalizePrefixRecord(record) {
      if (!record) return null;
      const text = String(record.text || "").replace(/\r\n?/g, "\n");
      const enabled = record.enabled === true;
      if (enabled && !text.trim()) {
        const error = new Error(
          "Включённый префикс результата не может быть пустым.",
        );
        error.code = "EMPTY_REPORT_PREFIX";
        throw error;
      }
      return {
        enabled,
        text,
        interval: clampInteger(record.interval, 1, 999, 1),
        delivered_count: clampInteger(
          record.delivered_count,
          0,
          Number.MAX_SAFE_INTEGER,
          0,
        ),
        last_applied_at_count: clampInteger(
          record.last_applied_at_count,
          0,
          Number.MAX_SAFE_INTEGER,
          0,
        ),
        last_confirmed_delivery_id:
          String(record.last_confirmed_delivery_id || "").slice(0, 240) || null,
        updated_at: record.updated_at || new Date().toISOString(),
      };
    }
    function reportPrefixIsDue(record) {
      if (record?.enabled !== true || !String(record.text || "").trim())
        return false;
      const delivered = Math.max(0, Number(record.delivered_count || 0));
      const last = Math.max(0, Number(record.last_applied_at_count || 0));
      const interval = Math.max(1, Number(record.interval || 1));
      return delivered - last >= interval - 1;
    }
    function applyReportPrefix(outgoingText, record) {
      const clean = String(outgoingText || "");
      if (!reportPrefixIsDue(record)) return { text: clean, applied: false };
      return {
        text: `${String(record.text || "")}\n\n${clean}`,
        applied: true,
      };
    }
    function noteConfirmedPrefix(record, applied, deliveryId = "") {
      const normalized = normalizePrefixRecord(record);
      if (!normalized) return null;
      const id = String(deliveryId || "").slice(0, 240);
      if (id && normalized.last_confirmed_delivery_id === id) return normalized;
      const deliveredCount =
        Math.max(0, Number(normalized.delivered_count || 0)) + 1;
      return {
        ...normalized,
        delivered_count: deliveredCount,
        last_applied_at_count:
          applied === true
            ? deliveredCount
            : Math.max(0, Number(normalized.last_applied_at_count || 0)),
        last_confirmed_delivery_id:
          id || normalized.last_confirmed_delivery_id || null,
        updated_at: new Date().toISOString(),
      };
    }
    function isTerminalStatus(status) {
      return status === RUN_STATUSES.STOPPED || status === RUN_STATUSES.ERROR;
    }
    function isBusyStatus(status) {
      return (
        status === RUN_STATUSES.STARTING ||
        status === RUN_STATUSES.WAITING_COMMAND ||
        status === RUN_STATUSES.REQUESTING ||
        status === RUN_STATUSES.COLLECTING ||
        status === RUN_STATUSES.DELIVERING
      );
    }
    function canEnableManualMode(status) {
      return (
        !status || status === RUN_STATUSES.PAUSED || isTerminalStatus(status)
      );
    }
    function pauseDecision(status) {
      if (status === RUN_STATUSES.WAITING_COMMAND) return "immediate";
      if (
        status === RUN_STATUSES.STARTING ||
        status === RUN_STATUSES.REQUESTING ||
        status === RUN_STATUSES.COLLECTING ||
        status === RUN_STATUSES.DELIVERING
      )
        return "deferred";
      if (status === RUN_STATUSES.PAUSED) return "already_paused";
      return "not_active";
    }

    function afterConfirmedStart(run, assistantBaselineIds = []) {
      const next = { ...run };
      next.start_delivery = {
        ...(run.start_delivery || {}),
        phase: START_PHASES.CONFIRMED,
        confirmed_at: new Date().toISOString(),
      };
      next.assistant_baseline_ids = normalizeIdList(assistantBaselineIds);
      next.watch_id = `watch-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
      if (next.finish_requested === true) {
        next.status = RUN_STATUSES.STOPPED;
        next.finish_requested = false;
        next.pause_requested = false;
        return next;
      }
      if (next.pause_requested === true) {
        next.status = RUN_STATUSES.PAUSED;
        next.pause_requested = false;
        return next;
      }
      next.status = RUN_STATUSES.WAITING_COMMAND;
      return next;
    }
    function commitStart(run, { baselineUserTurnIds = [], actorId = "" } = {}) {
      if (!run || run.status !== RUN_STATUSES.STARTING) return run;
      const existing = run.start_delivery || {};
      if (
        [START_PHASES.COMMITTED, START_PHASES.CONFIRMED].includes(
          existing.phase,
        )
      )
        return run;
      return {
        ...run,
        start_delivery: {
          ...existing,
          phase: START_PHASES.COMMITTED,
          baseline_user_turn_ids: normalizeIdList(baselineUserTurnIds),
          commit_actor_id: String(actorId || "").slice(0, 240) || null,
          committed_at: new Date().toISOString(),
        },
      };
    }

    const directInlineFileRefFromReportText = (entry) =>
      provider.directInlineFileRefFromReportText(entry);
    const reportFileRefsFromBatch = (run) =>
      provider.reportFileRefsFromBatch(run);
    const attachmentDeliveryPlan = (run, payload) =>
      provider.attachmentDeliveryPlan(run, payload);

    function claimDelivery(run, payload = {}) {
      if (!run) return run;
      if(run.attachment_finalization && run.attachment_finalization.delivery_id!==String(payload.deliveryId || "")){
        if(run.attachment_finalization.state!=="DONE")throw new Error("ATTACHMENT_FINALIZATION_PENDING");
        run={...run};delete run.attachment_finalization;
      }
      const attachmentPlan = attachmentDeliveryPlan(run, payload);
      if (attachmentPlan)
        return {
          ...run,
          status: RUN_STATUSES.DELIVERING,
          delivery: {
            delivery_id: String(payload.deliveryId || ""),
            phase: ATTACHMENT_PHASES.CLAIMED,
            mode: "attachment_watch_v1",
            representation: "attachment_bundle_v1",
            adapter_id: attachmentPlan.adapter_id,
            request_id: String(payload.requestId || ""),
            outgoing_text: attachmentPlan.outgoing_text,
            outgoing_hash: "",
            artifact_text: attachmentPlan.generated_text_document
              ? attachmentPlan.original_outgoing_text
              : null,
            generated_text_document: attachmentPlan.generated_text_document,
            provider_file_refs: attachmentPlan.provider_file_refs,
            ...(attachmentPlan.derived_file_refs?.length ? {
              derived_file_refs: attachmentPlan.derived_file_refs.map(ref=>({...ref})),
              derived_owner: {operation_id:run.operation_id,conversation_key:run.conversation_key},
            } : {}),
            text_decision: attachmentPlan.text_decision,
            report_prefix_applied: payload.reportPrefixApplied === true,
            baseline_user_turn_ids: [],
            baseline_assistant_turn_ids: [],
            commit_actor_id: null,
            attachment_send_actor_id: null,
            attachment_send_committed_at: null,
            claimed_at: new Date().toISOString(),
          },
        };
      return {
        ...run,
        status: RUN_STATUSES.DELIVERING,
        delivery: {
          delivery_id: String(payload.deliveryId || ""),
          phase: DELIVERY_PHASES.CLAIMED,
          mode: String(payload.mode || "legacy"),
          request_id: String(payload.requestId || ""),
          outgoing_text: String(payload.outgoingText || ""),
          outgoing_hash: String(payload.outgoingHash || ""),
          report_prefix_applied: payload.reportPrefixApplied === true,
          baseline_user_turn_ids: [],
          commit_actor_id: null,
          claimed_at: new Date().toISOString(),
        },
      };
    }
    function commitDelivery(
      run,
      { deliveryId = "", baselineUserTurnIds = [], actorId = "" } = {},
    ) {
      if (
        !run ||
        run.status !== RUN_STATUSES.DELIVERING ||
        run.delivery?.delivery_id !== deliveryId
      )
        return run;
      if (
        [DELIVERY_PHASES.COMMITTED, DELIVERY_PHASES.CONFIRMED].includes(
          run.delivery.phase,
        )
      )
        return run;
      if (run.delivery.phase !== DELIVERY_PHASES.CLAIMED) return run;
      return {
        ...run,
        delivery: {
          ...run.delivery,
          phase: DELIVERY_PHASES.COMMITTED,
          baseline_user_turn_ids: normalizeIdList(baselineUserTurnIds),
          commit_actor_id: String(actorId || "").slice(0, 240) || null,
          committed_at: new Date().toISOString(),
        },
      };
    }
    function commitDeliveryInsert(
      run,
      { deliveryId = "", actorId = "", assistantBaselineIds = [] } = {},
    ) {
      if (
        !run ||
        run.status !== RUN_STATUSES.DELIVERING ||
        run.delivery?.delivery_id !== deliveryId
      )
        return run;
      if (run.delivery?.phase !== DELIVERY_PHASES.CLAIMED) return run;
      return {
        ...run,
        delivery: {
          ...run.delivery,
          phase: DELIVERY_PHASES.INSERT_COMMITTED,
          commit_actor_id: String(actorId || "").slice(0, 240) || null,
          baseline_assistant_turn_ids: normalizeIdList(assistantBaselineIds),
          insert_committed_at: new Date().toISOString(),
        },
      };
    }
    function markDeliveryInserted(run, { deliveryId = "", actorId = "" } = {}) {
      if (
        !run ||
        run.status !== RUN_STATUSES.DELIVERING ||
        run.delivery?.delivery_id !== deliveryId
      )
        return run;
      if (
        run.delivery?.phase === DELIVERY_PHASES.INSERTED ||
        run.delivery?.phase === DELIVERY_PHASES.CONFIRMED
      )
        return run;
      if (run.delivery?.phase !== DELIVERY_PHASES.INSERT_COMMITTED) return run;
      if (
        run.delivery?.commit_actor_id &&
        actorId &&
        run.delivery.commit_actor_id !== actorId
      )
        return run;
      return {
        ...run,
        delivery: {
          ...run.delivery,
          phase: DELIVERY_PHASES.INSERTED,
          inserted_at: new Date().toISOString(),
        },
      };
    }
    function recoveryDecision(run, workerSessionId = "") {
      if (!run || isTerminalStatus(run.status)) return { type: "none" };
      if (run.status === RUN_STATUSES.WAITING_COMMAND) return { type: "watch" };
      if (run.status === RUN_STATUSES.PAUSED) return { type: "paused" };
      if (run.status === RUN_STATUSES.STARTING) {
        const phase = run.start_delivery?.phase || START_PHASES.NONE;
        if (phase === START_PHASES.NONE) return { type: "dispatch_start" };
        if (phase === START_PHASES.COMMITTED)
          return { type: "reconcile_start" };
        if (phase === START_PHASES.CONFIRMED) return { type: "watch" };
        return { type: "blocked", code: "UNKNOWN_START_PHASE" };
      }
      if (run.status === RUN_STATUSES.REQUESTING) {
        if (
          run.request_worker_session_id &&
          workerSessionId &&
          run.request_worker_session_id !== workerSessionId
        )
          return {
            type: "unsafe_request_outcome",
            code: "REQUEST_OUTCOME_UNKNOWN_NO_RETRY",
          };
        return { type: "request_in_progress" };
      }
      if (run.status === RUN_STATUSES.COLLECTING) {
        const requestWorker = String(
          run.batch?.request_worker_session_id || "",
        );
        if (
          run.batch?.request_state === "requesting" &&
          requestWorker &&
          workerSessionId &&
          requestWorker !== workerSessionId
        )
          return {
            type: "unsafe_request_outcome",
            code: "REQUEST_OUTCOME_UNKNOWN_NO_RETRY",
          };
        return { type: "resume_collection" };
      }
      if (run.status === RUN_STATUSES.DELIVERING) {
        if (run.delivery?.mode === "attachment_watch_v1")
          return {
            type: "attachment_external_handler",
            phase: String(run.delivery?.phase || ""),
          };
        if (run.delivery?.mode === "batch_watch_v1") {
          if (run.delivery?.phase === DELIVERY_PHASES.CLAIMED)
            return { type: "deliver_claimed" };
          if (run.delivery?.phase === DELIVERY_PHASES.INSERT_COMMITTED)
            return {
              type: "unsafe_insert_outcome",
              code: "DELIVERY_INSERT_OUTCOME_UNKNOWN_NO_RETRY",
            };
          if (run.delivery?.phase === DELIVERY_PHASES.INSERTED)
            return { type: "watch_delivery" };
          if (run.delivery?.phase === DELIVERY_PHASES.CONFIRMED)
            return { type: "watch" };
          return { type: "blocked", code: "UNKNOWN_BATCH_DELIVERY_PHASE" };
        }
        if (run.delivery?.phase === DELIVERY_PHASES.CLAIMED)
          return { type: "deliver_claimed" };
        if (run.delivery?.phase === DELIVERY_PHASES.COMMITTED)
          return { type: "reconcile_delivery" };
        if (run.delivery?.phase === DELIVERY_PHASES.CONFIRMED)
          return { type: "watch" };
        return { type: "blocked", code: "UNKNOWN_DELIVERY_PHASE" };
      }
      return { type: "blocked", code: "UNKNOWN_RUN_STATUS" };
    }
    function afterConfirmedDelivery(run) {
      const next = { ...run };
      next.sequence = Math.max(0, Number(next.sequence || 0)) + 1;
      if (next.finish_requested === true) {
        next.status = RUN_STATUSES.STOPPED;
        next.finish_requested = false;
        next.pause_requested = false;
        next.batch = null;
        return next;
      }
      if (next.pause_requested === true) {
        next.status = RUN_STATUSES.PAUSED;
        next.pause_requested = false;
        next.batch = null;
        return next;
      }
      next.status = RUN_STATUSES.WAITING_COMMAND;
      next.batch = null;
      return next;
    }

    return Object.freeze({
      RUN_STATUSES,
      START_PHASES,
      DELIVERY_PHASES,
      ATTACHMENT_PHASES,
      normalizeIdList,
      normalizePrefixRecord,
      reportPrefixIsDue,
      applyReportPrefix,
      noteConfirmedPrefix,
      isTerminalStatus,
      isBusyStatus,
      canEnableManualMode,
      pauseDecision,
      commitStart,
      afterConfirmedStart,
      claimDelivery,
      commitDelivery,
      commitDeliveryInsert,
      markDeliveryInserted,
      recoveryDecision,
      afterConfirmedDelivery,
      reportFileRefsFromBatch,
      directInlineFileRefFromReportText,
      successfulProviderFileRef: (entry, marketplace) => provider.successfulProviderFileRef(entry, marketplace),
    });
  }
  globalThis.SellerAgentsDeliveryModel = Object.freeze({ create });
})();
