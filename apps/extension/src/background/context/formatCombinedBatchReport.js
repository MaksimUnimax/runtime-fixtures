function formatCombinedBatchReport(entries, batch = null) {
  const reports = [];
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      if (entry?.report_text == null) continue;
      reports.push(String(entry.report_text));
    }
  }
  const capabilitySummary = safeBatchCapabilitySummary(batch);
  const queryPlannerSummary = safeBatchQueryPlannerSummary(batch, entries);
  const header = {
    bridge: "ozon-llm-api-bridge",
    version: VERSION,
    delivery_mode: "sequential_batch_single_delivery",
    result_count: reports.length,
    capability_probe: capabilitySummary,
    query_planner: queryPlannerSummary
  };
  const parts = ["OZON_BATCH_RESULT_V1", JSON.stringify(header, null, 2)];
  reports.forEach((report, index) => {
    parts.push(`===== OZON RESULT ${index + 1}/${reports.length} =====`, report);
  });
  return parts.join("\n\n");
}
