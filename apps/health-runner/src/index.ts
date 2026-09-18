import type { BrowserFamily } from "@product/shared";
import type { BrowserDriver } from "./browser-driver.js";

export type { BrowserFamily } from "@product/shared";
export type {
  BrowserDriver,
  BrowserDriverErrorCode,
  BrowserDriverSecurityDiagnostics,
  ControlledNavigationResult,
} from "./browser-driver.js";
export { BrowserDriverError, ChromeBrowserDriver } from "./browser-driver.js";
export {
  createDedicatedHealthChromeBrowserDriver,
  createDedicatedWorkHealthChromeBrowserDriver,
} from "./browser-driver.js";
export {
  DedicatedHealthSessionConfigError,
  loadDedicatedHealthSessionRegistry,
} from "./dedicated-health-session.js";
export type {
  DedicatedHealthSessionConfigErrorCode,
  DedicatedHealthSessionRegistry,
  DedicatedHealthSessionTargetKey,
} from "./dedicated-health-session.js";
export {
  ControlledTargetRegistry,
  ControlledTargetKeySchema,
  createControlledTargetRegistry,
  createPackagedH3TargetRegistry,
  createPackagedStandardH3TargetRegistry,
  createPackagedWorkH3TargetRegistry,
  createPackagedAliceH3TargetRegistry,
} from "./target-registry.js";
export type { ControlledTarget } from "./target-registry.js";
export type { ControlledTargetKey } from "./target-registry.js";
export {
  BrowserRuntimeMetadataSchema,
  H2ExecutionErrorSchema,
  H2StructuralProbePlanSchema,
  H2StructuralObservationSchema,
  H2StructuralSmokeReportSchema,
  createH2ProbePlan,
  parseH2ProbePlan,
  runH2StructuralSmoke,
} from "./h2.js";
export type {
  BrowserRuntimeMetadata,
  H2ExecutionError,
  H2ProbeContour,
  H2StructuralObservation,
  H2StructuralProbePlan,
  H2StructuralSmokeReport,
} from "./h2.js";
export {
  H3SurfaceSchema,
  H3PromptIdSchema,
  H3BehaviorStepSchema,
  H3RunPlanSchema,
  H3_BEHAVIOR_STEP_ORDER,
  createH3RunPlan,
  getPackagedH3Prompt,
  parseH3RunPlan,
} from "./h3-contracts.js";
export type {
  H3Surface,
  H3PromptId,
  H3BehaviorStep,
  H3RunPlan,
} from "./h3-contracts.js";
export {
  H3PackagedActionSchema,
  H3SurfaceProfileSchema,
  H3_PACKAGED_ACTION_KIND_ORDER,
  compileH3PackagedActions,
  getPackagedH3Profile,
  parseH3SurfaceProfile,
  parseH3PackagedAction,
} from "./h3-actions.js";
export type {
  H3BridgeSurfaceCheck,
  H3PackagedAction,
  H3PackagedActionSequence,
  H3SurfaceProfile,
} from "./h3-actions.js";
export {
  H3StrategyError,
  H3StrategyErrorCodeSchema,
  H3StrategyStepOutcomeSchema,
  H3ContourObservationSchema,
  H3StrategyStepResultSchema,
  createH3ContourObservation,
  parseH3StrategyStepResult,
  validateH3SurfaceStrategy,
} from "./h3-strategy.js";
export type {
  H3StrategyErrorCode,
  H3StrategyStepOutcome,
  H3ContourObservation,
  H3StrategyStepResult,
  H3SurfaceStrategy,
} from "./h3-strategy.js";
export {
  H3_PACKAGED_TARGET_BY_SURFACE,
  H3CleanupOutcomeSchema,
  H3EngineInputError,
  H3ExecutionFailureCodeSchema,
  H3ExecutionOutcomeSchema,
  H3ExecutionResultSchema,
  H3SurfaceStrategyRegistry,
  getPackagedH3Target,
  runH3BehavioralSmoke,
  runH3BehavioralSmokeFromRegistry,
} from "./h3-engine.js";
export type {
  H3CleanupOutcome,
  H3Clock,
  H3ExecutionFailureCode,
  H3ExecutionOptions,
  H3ExecutionOutcome,
  H3ExecutionResult,
} from "./h3-engine.js";
export {
  H3EvidenceOutcomeSchema,
  H3SafeEvidenceEventSchema,
  H3SafeEvidenceBundleSchema,
  sanitizeH3EvidenceEvent,
  sanitizeH3EvidenceBundle,
} from "./evidence-sanitizer.js";
export type {
  H3EvidenceOutcome,
  H3SafeEvidenceEvent,
  H3SafeEvidenceBundle,
} from "./evidence-sanitizer.js";
export {
  H3HealthPersistenceContextSchema,
  H3HealthPersistenceCommandSchema,
  createH3HealthPersistenceCommand,
} from "./h3-health-persistence.js";
export type {
  H3HealthPersistenceContext,
  H3HealthPersistenceCommand,
} from "./h3-health-persistence.js";
export type {
  SafeStructuralMetadata,
  SafeStructuralObservation,
} from "./strategies.js";
export {
  CHATGPT_STANDARD_H3_PROFILE,
  chatGPTConversationIdentity,
  resolveChatGPTConversationIdentity,
} from "./standard-h3-profile.js";
export type { ChatGPTStandardH3Profile } from "./standard-h3-profile.js";
export { createChatGPTStandardH3Strategy } from "./standard-h3-strategy.js";
export {
  ALICE_H3_PROFILE,
  aliceAssistantMessages,
  aliceCodeBlocks,
  aliceCodeContents,
  aliceComposerRoots,
  aliceCopyControls,
  aliceInputCandidates,
  aliceMessageId,
  aliceOknyxControls,
  aliceStopControls,
  resolveAliceConversationIdentity,
} from "./alice-h3-profile.js";
export type {
  AliceConversationIdentityResolution,
  AliceH3Profile,
} from "./alice-h3-profile.js";
export { createAliceH3Strategy } from "./alice-h3-strategy.js";
export class NoopBrowserDriver implements BrowserDriver {
  public readonly sessionKind = "EPHEMERAL_CONTROLLED" as const;
  public constructor(public readonly family: BrowserFamily) {}
  public async prepareSession(): Promise<void> {}
  public async launch(): Promise<void> {}
  public async start(): Promise<void> {}
  public async open(): Promise<never> {
    throw new Error("NOOP_BROWSER_DRIVER_CANNOT_OPEN");
  }
  public getRuntimeMetadata() {
    return {
      family: this.family,
      browserName: "noop",
      browserVersion: "noop",
      headless: true,
      sessionKind: "EPHEMERAL_CONTROLLED" as const,
    };
  }
  public getSecurityDiagnostics() {
    return {
      secondaryPageCount: 0,
      unsafeTopLevelNavigation: false,
    } as const;
  }
  public async observeStrategy(): Promise<never> {
    throw new Error("NOOP_BROWSER_DRIVER_CANNOT_OBSERVE");
  }
  public async closeOrPersist(): Promise<void> {}
  public async stop(): Promise<void> {}
}
