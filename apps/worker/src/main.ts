import {
  createAuditRetentionRepository,
  createDatabaseRuntime,
  createDeviceAuthorizationRepository,
  createFeedbackSupportRepository,
  createP5SubscriptionLifecycleRepository,
  loadFeedbackRetentionConfig,
} from "@product/db";
import { createLogger } from "@product/observability";
import { loadConfig } from "@product/shared";
import { deriveAuthKeys, loadAuthRootSecret } from "@product/auth";
import { loadSmtpConfig, SmtpEmailProvider } from "@product/email";
import { createWorker, type JobRunner } from "./lifecycle.js";
import { OtpEmailRunner } from "./otp-runner.js";
import { DeviceAuthorizationExpiryRunner } from "./device-authorization-expiry-runner.js";
import { CompositeJobRunner } from "./composite-runner.js";
import { SubscriptionLifecycleRunner } from "./subscription-lifecycle-runner.js";
import { FeedbackRetentionRunner } from "./feedback-retention-runner.js";
import { createHealthNotificationJobRunner } from "./health-notification-runtime.js";
import {
  AuditRetentionRunner,
  adminAuditRetentionEnabled,
} from "./audit-retention-runner.js";

export { NoopJobRunner } from "./noop-runner.js";

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const database = createDatabaseRuntime(config.databaseUrl);
const healthNotificationRunner = createHealthNotificationJobRunner(
  database,
  process.env,
);
const runners: JobRunner[] = [
  new OtpEmailRunner(
    database,
    deriveAuthKeys(loadAuthRootSecret(process.env)),
    new SmtpEmailProvider(loadSmtpConfig(process.env)),
  ),
  new DeviceAuthorizationExpiryRunner(
    createDeviceAuthorizationRepository(database),
  ),
  new SubscriptionLifecycleRunner(
    createP5SubscriptionLifecycleRepository(database),
  ),
  new FeedbackRetentionRunner(
    createFeedbackSupportRepository(database),
    loadFeedbackRetentionConfig(process.env),
    undefined,
    undefined,
    () =>
      logger.error(
        { runner: "feedback-retention", code: "PURGE_FAILED" },
        "Feedback retention purge failed",
      ),
  ),
  ...(adminAuditRetentionEnabled(process.env)
    ? [
        new AuditRetentionRunner(
          createAuditRetentionRepository(database),
          undefined,
          undefined,
          () =>
            logger.error(
              { runner: "audit-retention", code: "PURGE_FAILED" },
              "Administrative audit retention failed",
            ),
        ),
      ]
    : []),
];
if (healthNotificationRunner) runners.push(healthNotificationRunner);

const runtime = createWorker(database, new CompositeJobRunner(runners), logger);

process.once("SIGINT", () => void runtime.shutdown("SIGINT"));
process.once("SIGTERM", () => void runtime.shutdown("SIGTERM"));
void runtime.completion.then((outcome) => {
  if (outcome.state === "FAILED" || outcome.state === "CLEANUP_INCOMPLETE") {
    process.exitCode = 1;
    try {
      logger.error(
        { state: outcome.state, runner: outcome.runner, code: outcome.code },
        "Worker stopped after failure",
      );
    } catch {
      // Reporting cannot replace the already established failure outcome.
    }
  }
});
void runtime.start().catch(() => {
  // Startup details can contain secrets; completion reports fixed safe status.
  process.exitCode = 1;
});
