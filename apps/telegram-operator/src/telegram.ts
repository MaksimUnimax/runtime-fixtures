import {
  WB_BUNDLE_DOCUMENT_KEY,
  WB_BUNDLE_OFFICIAL_URL,
  WB_BUNDLE_VERSION,
} from "@product/api-watch";
import {
  DEFAULT_NO_SESSION_CADENCE,
  HealthScheduleCadenceSchema,
} from "@product/health";
import {
  formatMonitoringDuration,
  parseMonitoringDuration,
  type IndependentMonitoringScheduler,
  type MonitoringLane,
  type MonitoringLaneState,
  type MonitoringNotification,
  type SwaggerHandoffService,
  type SwaggerSourceFamily,
} from "@product/monitoring-control";
import { explainMonitoringResult } from "./monitoring-result-explanation.js";

export type TelegramButton = { text: string; callback_data: string };
export type TelegramKeyboard = { inline_keyboard: TelegramButton[][] };

export type TelegramUpdate = {
  updateId: number;
  message?: {
    chatId: string;
    userId: string;
    text?: string;
    caption?: string;
    document?: {
      fileId: string;
      fileName?: string;
      fileSize?: number;
      mimeType?: string;
      bytes?: Uint8Array;
      sourceFamily?: SwaggerSourceFamily;
      documentKey?: string;
    };
  };
  callbackQuery?: { id: string; chatId: string; userId: string; data: string };
};

export interface TelegramTransport {
  getUpdates(
    offset: number | undefined,
  ): Promise<{ updates: TelegramUpdate[]; nextOffset?: number }>;
  sendMessage(
    chatId: string,
    text: string,
    keyboard?: TelegramKeyboard,
  ): Promise<void>;
  answerCallback(callbackQueryId: string, text: string): Promise<void>;
  downloadFile?(fileId: string): Promise<Uint8Array>;
}

export type TelegramOperatorOptions = {
  scheduler: IndependentMonitoringScheduler;
  swaggerHandoff?: SwaggerHandoffService;
  transport: TelegramTransport;
  operatorIds: ReadonlySet<string>;
  notificationChatIds?: readonly string[];
  sleep?: (ms: number) => Promise<void>;
  logger?: (event: string, details?: Record<string, unknown>) => void;
  incidentStore?: { listOpen(): Promise<readonly { severity: string }[]> };
};

function laneLabel(lane: MonitoringLane): string {
  return lane === "LLM" ? "LLM" : "Swagger/API";
}

function intervalRangeLabel(lane: MonitoringLane): string {
  return lane === "LLM" ? "1h..7d" : "5m..30d";
}

function parseLaneInterval(lane: MonitoringLane, raw: string): number {
  const seconds = parseMonitoringDuration(raw);
  if (lane === "LLM") {
    const accepted = HealthScheduleCadenceSchema.safeParse({
      ...DEFAULT_NO_SESSION_CADENCE,
      intervalSeconds: seconds,
    });
    if (!accepted.success)
      throw new Error("HEALTH_SCHEDULE_INTERVAL_OUT_OF_RANGE");
  }
  return seconds;
}

function keyboard(lane: MonitoringLane): TelegramKeyboard {
  return {
    inline_keyboard: [
      [
        {
          text: `${laneLabel(lane)} status`,
          callback_data: `monitor:${lane}:status`,
        },
        {
          text: `${laneLabel(lane)} run now`,
          callback_data: `monitor:${lane}:run`,
        },
      ],
      [
        {
          text: `${laneLabel(lane)} change interval`,
          callback_data: `monitor:${lane}:interval`,
        },
      ],
      ...(lane === "SWAGGER_API"
        ? [
            [
              {
                text: "Pending source requests",
                callback_data: "monitor:SWAGGER_API:pending",
              },
            ],
            [
              {
                text: "New WB source request",
                callback_data: "monitor:SWAGGER_API:new",
              },
            ],
          ]
        : []),
    ],
  };
}

function safeStatus(state: MonitoringLaneState): string {
  const active = state.activeRun
    ? `active=${state.activeRun.runId}`
    : "active=none";
  const result = state.lastResult
    ? `${state.lastResult.status}${state.lastResult.code ? `/${state.lastResult.code}` : ""}`
    : "none";
  return `${laneLabel(state.lane)} status: enabled=${state.enabled ? "yes" : "no"}, interval=${formatMonitoringDuration(state.intervalSeconds)}, next=${state.nextRunAt.toISOString()}, ${active}, last=${result}`;
}

function command(
  text: string,
): { name: string; argument: string | undefined } | null {
  const match = /^\/(\w+)(?:@[^\s]+)?(?:\s+(.+))?$/.exec(text.trim());
  return match
    ? { name: match[1]!.toLowerCase(), argument: match[2]?.trim() }
    : null;
}

export class TelegramOperatorService {
  private offset: number | undefined;
  private polling = false;
  private pollingTask: Promise<void> | undefined;

  public constructor(private readonly options: TelegramOperatorOptions) {}

  async start(): Promise<void> {
    await this.options.scheduler.start();
    this.polling = true;
    this.pollingTask = this.poll();
  }

  async stop(): Promise<void> {
    this.polling = false;
    await this.options.scheduler.stop();
    await this.pollingTask;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const actorId = update.message?.userId ?? update.callbackQuery?.userId;
    const chatId = update.message?.chatId ?? update.callbackQuery?.chatId;
    if (!actorId || !chatId) return;
    if (!this.options.operatorIds.has(actorId)) {
      if (update.callbackQuery)
        await this.options.transport.answerCallback(
          update.callbackQuery.id,
          "DENIED",
        );
      else await this.options.transport.sendMessage(chatId, "DENIED");
      return;
    }
    if (update.callbackQuery) {
      await this.handleCallback(
        update.callbackQuery.id,
        chatId,
        update.callbackQuery.data,
      );
    } else if (update.message) {
      await this.handleMessage(
        chatId,
        update.message.userId,
        update.message.text ?? update.message.caption ?? "",
        update.message.document,
      );
    }
  }

  private async handleMessage(
    chatId: string,
    operatorId: string,
    text: string,
    document?: NonNullable<TelegramUpdate["message"]>["document"],
  ): Promise<void> {
    const parsed = command(text);
    if (document) {
      if (!this.options.swaggerHandoff) {
        await this.options.transport.sendMessage(
          chatId,
          "Swagger handoff unavailable.",
        );
        return;
      }
      const captionless = text.trim().length === 0;
      const explicitUpload =
        parsed?.name === "swagger_upload" && Boolean(parsed.argument);
      if (!captionless && !explicitUpload) {
        await this.options.transport.sendMessage(
          chatId,
          "Attach the official WB bundle without a caption in the configured operator chat when exactly one WB request is pending; otherwise use /swagger_upload <request_id> as the caption.",
        );
        return;
      }
      // A captionless upload has no operator-supplied request authority.
      // Limit it to an approved destination and exactly one pending official
      // WB family bundle. Other source families and explicit uploads retain
      // their existing independent request-ID routing.
      if (captionless && !this.options.notificationChatIds?.includes(chatId)) {
        await this.options.transport.sendMessage(chatId, "DENIED");
        return;
      }
      const pendingWb = captionless
        ? (await this.options.swaggerHandoff.listPending()).filter(
            (request) => request.sourceFamily === "WILDBERRIES",
          )
        : [];
      const pending = pendingWb.length === 1 ? pendingWb[0] : undefined;
      if (
        captionless &&
        (!pending ||
          pending.status !== "PENDING_OPERATOR_UPLOAD" ||
          pending.officialUrl !== WB_BUNDLE_OFFICIAL_URL ||
          pending.documentKey !== WB_BUNDLE_DOCUMENT_KEY ||
          pending.bundleVersion !== WB_BUNDLE_VERSION ||
          pending.expectedArtifactType !== "JSON" ||
          (pending.expiresAt !== null &&
            pending.expiresAt.getTime() <= Date.now()))
      ) {
        await this.options.transport.sendMessage(
          chatId,
          "WB_BUNDLE_PENDING_NOT_UNIQUE_OR_INVALID. Use /swagger_pending and the explicit /swagger_upload command if more than one WB request is pending.",
        );
        return;
      }
      if (
        document.fileSize !== undefined &&
        document.fileSize > this.options.swaggerHandoff.maxUploadBytes
      ) {
        await this.options.transport.sendMessage(chatId, "UPLOAD_TOO_LARGE");
        return;
      }
      const bytes =
        document.bytes ??
        (document.fileId && this.options.transport.downloadFile
          ? await this.options.transport.downloadFile(document.fileId)
          : undefined);
      if (!bytes) {
        await this.options.transport.sendMessage(chatId, "UPLOAD_UNAVAILABLE");
        return;
      }
      if (bytes.byteLength > this.options.swaggerHandoff.maxUploadBytes) {
        await this.options.transport.sendMessage(chatId, "UPLOAD_TOO_LARGE");
        return;
      }
      const [explicitRequestId, explicitDocumentKey] = explicitUpload
        ? parsed!.argument!.split(/\s+/, 2)
        : [];
      const result = await this.options.swaggerHandoff.upload({
        requestId: captionless ? pending!.requestId : explicitRequestId!,
        operatorId,
        originalFilename: document.fileName ?? "upload",
        bytes,
        declaredSourceFamily: document.sourceFamily,
        documentKey: captionless
          ? WB_BUNDLE_DOCUMENT_KEY
          : (document.documentKey ?? explicitDocumentKey),
      });
      await this.options.transport.sendMessage(
        chatId,
        result.kind === "CANDIDATE_READY"
          ? `Swagger candidate ready: ${result.artifact.requestId}`
          : result.kind === "DUPLICATE"
            ? `Swagger upload duplicate: ${result.artifact.requestId}`
            : result.code,
      );
      if (
        (result.kind === "CANDIDATE_READY" ||
          (result.kind === "DUPLICATE" &&
            result.artifact.status === "CANDIDATE_READY")) &&
        result.artifact.sourceFamily === "WILDBERRIES"
      ) {
        // Candidate registration is durable; the normal report consumer also
        // resumes after process loss or a concurrent active run.
        const wake = await this.options.scheduler.runNow("SWAGGER_API");
        if (wake.kind === "ALREADY_RUNNING")
          await this.options.scheduler.scheduleEarlier(
            "SWAGGER_API",
            new Date(),
          );
      }
      return;
    }
    if (!parsed) return;
    switch (parsed.name) {
      case "help":
        await this.options.transport.sendMessage(
          chatId,
          "/llm_status, /llm_run, /llm_interval <1h..7d>\n/swagger_status, /swagger_run, /swagger_interval <5m..30d>",
          keyboard("LLM"),
        );
        await this.options.transport.sendMessage(
          chatId,
          "Swagger/API controls:",
          keyboard("SWAGGER_API"),
        );
        return;
      case "llm_status":
        return this.sendStatus(chatId, "LLM");
      case "swagger_status":
        return this.sendStatus(chatId, "SWAGGER_API");
      case "llm_run":
        return this.sendRunAcknowledgement(chatId, "LLM");
      case "swagger_run":
        return this.sendRunAcknowledgement(chatId, "SWAGGER_API");
      case "llm_interval":
        return this.changeInterval(chatId, "LLM", parsed.argument);
      case "swagger_interval":
        return this.changeInterval(chatId, "SWAGGER_API", parsed.argument);
      case "swagger_pending":
        return this.sendPending(chatId);
      case "swagger_new":
        if (parsed.argument) {
          await this.options.transport.sendMessage(
            chatId,
            "Use /swagger_new to request one official WB bundle.",
          );
          return;
        }
        return this.createWbRequest(chatId);
      case "swagger_upload":
        await this.options.transport.sendMessage(
          chatId,
          "For one pending official WB bundle, attach a JSON file here without a caption. For other cases, use /swagger_upload <request_id> as its caption.",
        );
        return;
      default:
        await this.options.transport.sendMessage(
          chatId,
          "Unknown command. Use /help.",
        );
    }
  }

  private async handleCallback(
    callbackId: string,
    chatId: string,
    data: string,
  ): Promise<void> {
    const match =
      /^monitor:(LLM|SWAGGER_API):(status|run|interval|pending|new)$/.exec(
        data,
      );
    if (!match) {
      await this.options.transport.answerCallback(callbackId, "DENIED");
      return;
    }
    const lane = match[1] as MonitoringLane;
    const action = match[2];
    await this.options.transport.answerCallback(callbackId, "OK");
    if (action === "status") return this.sendStatus(chatId, lane);
    if (action === "run") return this.sendRunAcknowledgement(chatId, lane);
    if (action === "new") {
      if (lane !== "SWAGGER_API") {
        await this.options.transport.sendMessage(chatId, "DENIED");
        return;
      }
      return this.createWbRequest(chatId);
    }
    if (action === "pending") {
      if (lane !== "SWAGGER_API") {
        await this.options.transport.sendMessage(chatId, "DENIED");
        return;
      }
      return this.sendPending(chatId);
    }
    await this.options.transport.sendMessage(
      chatId,
      `Use /${lane === "LLM" ? "llm" : "swagger"}_interval <${intervalRangeLabel(lane)}>.`,
      keyboard(lane),
    );
  }

  private async createWbRequest(chatId: string): Promise<void> {
    if (!this.options.swaggerHandoff) {
      await this.options.transport.sendMessage(
        chatId,
        "Swagger handoff unavailable.",
      );
      return;
    }
    // The public action has one fixed family/URL/version; command arguments
    // cannot replace authority or reopen a historical request.
    await this.options.swaggerHandoff.renewRequest({
      sourceFamily: "WILDBERRIES",
      officialUrl: WB_BUNDLE_OFFICIAL_URL,
      documentKey: WB_BUNDLE_DOCUMENT_KEY,
      bundleVersion: WB_BUNDLE_VERSION,
      expectedArtifactType: "JSON",
      blockerReason:
        "Explicit operator request for one complete official WB bundle.",
    });
    return this.sendPending(chatId);
  }

  private async sendPending(chatId: string): Promise<void> {
    if (!this.options.swaggerHandoff) {
      await this.options.transport.sendMessage(
        chatId,
        "Swagger handoff unavailable.",
      );
      return;
    }
    const requests = await this.options.swaggerHandoff.listPending();
    const wb = requests.filter(
      (request) => request.sourceFamily === "WILDBERRIES",
    );
    const singleOfficialWb =
      wb.length === 1 &&
      wb[0]?.status === "PENDING_OPERATOR_UPLOAD" &&
      wb[0]?.officialUrl === WB_BUNDLE_OFFICIAL_URL &&
      wb[0]?.documentKey === WB_BUNDLE_DOCUMENT_KEY &&
      wb[0]?.bundleVersion === WB_BUNDLE_VERSION &&
      wb[0]?.expectedArtifactType === "JSON" &&
      this.options.notificationChatIds?.includes(chatId);
    const text = requests.length
      ? requests
          .map(
            (request) =>
              `${request.requestId} | ${request.sourceFamily} | ${request.documentKey ?? "family"} | ${request.status}\n${request.officialUrl}\nexpected=${request.expectedArtifactType}`,
          )
          .join("\n") +
        (singleOfficialWb
          ? "\nAttach the one official WB JSON bundle here without a caption or request ID."
          : "")
      : "No pending Swagger source requests.";
    await this.options.transport.sendMessage(
      chatId,
      text,
      keyboard("SWAGGER_API"),
    );
  }

  private async sendStatus(
    chatId: string,
    lane: MonitoringLane,
  ): Promise<void> {
    const state = await this.options.scheduler.status(lane);
    const incidents =
      lane === "SWAGGER_API" && this.options.incidentStore
        ? await this.options.incidentStore.listOpen()
        : [];
    const incidentSuffix =
      lane === "SWAGGER_API"
        ? `, incidents=${incidents.length}/${incidents.map((item) => item.severity).sort()[0] ?? "NONE"}`
        : "";
    await this.options.transport.sendMessage(
      chatId,
      `${safeStatus(state)}${incidentSuffix}`,
      keyboard(lane),
    );
  }

  private async sendRunAcknowledgement(
    chatId: string,
    lane: MonitoringLane,
  ): Promise<void> {
    const result = await this.options.scheduler.runNow(lane);
    if (result.kind === "ALREADY_RUNNING") {
      await this.options.transport.sendMessage(
        chatId,
        `${laneLabel(lane)} run already running: ${result.runId}`,
      );
      return;
    }
    if (result.kind !== "STARTED") return;
    await this.options.transport.sendMessage(
      chatId,
      `${laneLabel(lane)} run started: ${result.runId}`,
    );
  }

  private async changeInterval(
    chatId: string,
    lane: MonitoringLane,
    raw: string | undefined,
  ): Promise<void> {
    if (!raw) {
      await this.options.transport.sendMessage(
        chatId,
        `Usage: /${lane === "LLM" ? "llm" : "swagger"}_interval <${intervalRangeLabel(lane)}>`,
      );
      return;
    }
    try {
      const seconds = parseLaneInterval(lane, raw);
      const state = await this.options.scheduler.setInterval(lane, seconds);
      await this.options.transport.sendMessage(
        chatId,
        `${laneLabel(lane)} interval set to ${formatMonitoringDuration(state.intervalSeconds)}; no run was started.`,
        keyboard(lane),
      );
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "INVALID_MONITORING_DURATION";
      await this.options.transport.sendMessage(
        chatId,
        `${code}: use ${intervalRangeLabel(lane)}.`,
      );
    }
  }

  async notify(notification: MonitoringNotification): Promise<void> {
    const text = explainMonitoringResult(notification);
    for (const chatId of this.options.notificationChatIds ?? [])
      await this.options.transport.sendMessage(
        chatId,
        text,
        keyboard(notification.lane),
      );
  }

  async notifyIncident(event: {
    kind: "OPENED" | "RESOLVED";
    incident: {
      sourceFamily: string | null;
      incidentType: string;
      severity: string;
      safeSummaryCode: string;
      latestReportId: string;
    };
  }): Promise<void> {
    const incident = event.incident;
    const text = `API-watch incident ${event.kind.toLowerCase()}: ${incident.sourceFamily ?? "GLOBAL"} ${incident.incidentType} ${incident.severity} ${incident.safeSummaryCode} report=${incident.latestReportId}`;
    for (const chatId of this.options.notificationChatIds ?? [])
      await this.options.transport.sendMessage(
        chatId,
        text,
        keyboard("SWAGGER_API"),
      );
  }

  private async poll(): Promise<void> {
    while (this.polling) {
      try {
        const response = await this.options.transport.getUpdates(this.offset);
        for (const update of response.updates) {
          this.offset = Math.max(this.offset ?? -1, update.updateId + 1);
          await this.handleUpdate(update);
        }
        // Apply raw-page progress only after the mapped batch is handled.
        // On failure, the per-update fence above preserves at-most-once handling
        // while leaving the unprocessed tail available for the next poll.
        if (
          response.nextOffset !== undefined &&
          Number.isSafeInteger(response.nextOffset) &&
          response.nextOffset >= 0
        )
          this.offset = Math.max(this.offset ?? -1, response.nextOffset);
      } catch (error) {
        this.options.logger?.("telegram_poll_failed", {
          error:
            error instanceof Error ? error.message : "TELEGRAM_UNAVAILABLE",
        });
        await (
          this.options.sleep ??
          ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
        )(1_000);
      }
    }
  }
}
