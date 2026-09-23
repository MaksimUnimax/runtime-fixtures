// Quarantined by the canonical-base audit. Replacement and acceptance: C01.
// This is a release blocker, not a working release validator.
console.error(JSON.stringify({
  status: "BLOCKED_UNVERIFIED_RELEASE",
  code: "LEGACY_RELEASE_TOOL_QUARANTINED",
  reason: "Legacy validation trusted self-declared metadata and accepted a non-extension ZIP.",
  next: "docs/development/coordination/PLAN.md#c--интеграция-выпуск-и-мониторинг",
  productionMutation: "NOT_PERFORMED"
}, null, 2));
process.exitCode = 78;
