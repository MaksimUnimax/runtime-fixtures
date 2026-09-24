import {
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
import { startWorker, type JobRunner } from "./lifecycle.js";
import { OtpEmailRunner } from "./otp-runner.js";
import { DeviceAuthorizationExpiryRunner } from "./device-authorization-expiry-runner.js";
import { CompositeJobRunner } from "./composite-runner.js";
import { SubscriptionLifecycleRunner } from "./subscription-lifecycle-runner.js";
import { FeedbackRetentionRunner } from "./feedback-retention-runner.js";

export class NoopJobRunner implements JobRunner {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);
const database = createDatabaseRuntime(config.databaseUrl);
const runtime = await startWorker(
  database,
  new CompositeJobRunner([
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
    ),
  ]),
  logger,
);

process.once("SIGINT", () => void runtime.shutdown("SIGINT"));
process.once("SIGTERM", () => void runtime.shutdown("SIGTERM"));
