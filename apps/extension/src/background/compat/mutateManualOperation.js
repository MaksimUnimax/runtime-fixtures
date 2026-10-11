async function mutateManualOperation(conversationKey, mutator) {
  return manualOperationRecords.mutate(
    normalizeConversationKey(conversationKey),
    async current => {
      let next = saPrunePayload(await mutator(saPrunePayload(current)));
      // A confirmed delivery may be copied only while its original buffer is still alive.
      // Completion does not renew TTL; expiry and owner replacement keep their existing cleanup.
      if (current?.r3_execution_id && current.outgoing_text && current.payload_expires_at_ms > Date.now() &&
          next?.operation_id === current.operation_id && current.status === MANUAL_OPERATION_STATUSES.DELIVERING &&
          next.status === MANUAL_OPERATION_STATUSES.COMPLETED && next.delivery_confirmed === true &&
          next.last_confirmed_delivery_id === current.delivery?.delivery_id) {
        next = { ...next, outgoing_text: current.outgoing_text, delivery: current.delivery,
          batch: current.batch, payload_expires_at_ms: current.payload_expires_at_ms };
      }
      // Legacy owner replacement and payload cleanup must not erase hash-only
      // UNKNOWN/approval/delivery receipts. Only the ledger may mutate these.
      if (!current?.r3_commands) return next;
      return { ...(next || {}), r3_commands: current.r3_commands };
    },
  );
}
