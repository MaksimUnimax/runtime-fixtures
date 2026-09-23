import { createServer, type IncomingMessage, type Server } from "node:http";
import { getPackagedH3Prompt } from "@product/health-runner";
import { CHATGPT_STANDARD_H3_PROFILE } from "../../../../apps/health-runner/src/standard-h3-profile.js";

export type HealthStandardH3FixtureVariant =
  | "VALID"
  | "FRESH_ROOT_NO_ID"
  | "EXISTING_CONVERSATION"
  | "IDENTITY_NEVER_BINDS"
  | "EXISTING_IDENTITY_CHANGES"
  | "FRESH_BOUND_IDENTITY_CHANGES"
  | "ROUTE_CANONICAL_CONFLICT"
  | "WORK_SURFACE"
  | "MISSING_SURFACE"
  | "LOGIN_EXPIRED"
  | "CAPTCHA_CHECKPOINT"
  | "VERIFICATION_CHECKPOINT"
  | "ACCOUNT_BLOCKED"
  | "MISSING_COMPOSER"
  | "AMBIGUOUS_COMPOSER"
  | "DISABLED_INPUT"
  | "MISSING_SEND"
  | "SEND_STOP_CONFUSION"
  | "SEND_AMBIGUOUS"
  | "OLD_RESPONSE_ONLY"
  | "BUSY_TIMEOUT"
  | "RESPONSE_MISSING"
  | "COMPLETION_MISSING"
  | "RESPONSE_SELF_BUSY_STUCK"
  | "STOP_CLEARS_BUT_OTHER_BUSY_REMAINS"
  | "BUSY_CLEARS_BUT_STOP_REMAINS"
  | "EMPTY_RESPONSE_AFTER_GENERATION"
  | "CODE_BLOCK_MISSING"
  | "COPY_MISSING"
  | "COPY_MISMATCHED"
  | "CONVERSATION_CHANGED"
  | "IDENTITY_CHANGES_DURING_COMPLETION"
  | "DELIVERY_MISSING";

export type HealthStandardH3Fixture = Readonly<{
  origin: string;
  startUrl: (
    variant: HealthStandardH3FixtureVariant,
    bookkeeping?: boolean,
  ) => string;
  promptMatches: number;
  sendActivations: number;
  requestMethods: readonly string[];
  close: () => Promise<void>;
}>;

const HEALTH_PROMPT = getPackagedH3Prompt("BRIDGE_COMMAND_SMOKE_V1");
const STANDARD_SELECTORS = CHATGPT_STANDARD_H3_PROFILE.selectors;
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const CHANGED_CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";
const FRESH_BOUND_CONVERSATION_ID = "00000000-0000-4000-8000-000000000004";
const BLOCKERS: Readonly<
  Partial<Record<HealthStandardH3FixtureVariant, string>>
> = {
  LOGIN_EXPIRED: "login",
  CAPTCHA_CHECKPOINT: "captcha",
  VERIFICATION_CHECKPOINT: "verification",
  ACCOUNT_BLOCKED: "blocked",
};

function requestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function composerMarkup(
  variant: HealthStandardH3FixtureVariant,
  bookkeeping: boolean,
  suffix = "",
): string {
  if (variant === "MISSING_COMPOSER") return "";
  const disabled = variant === "DISABLED_INPUT" ? " disabled" : "";
  const promptId =
    variant === "WORK_SURFACE"
      ? "workspace-input"
      : STANDARD_SELECTORS.promptInput.id;
  const promptTestId =
    variant === "WORK_SURFACE"
      ? "workspace-input"
      : STANDARD_SELECTORS.promptInput.testId;
  const send =
    variant === "MISSING_SEND"
      ? ""
      : `<button id="composer-submit-button" data-testid="${STANDARD_SELECTORS.sendControl.testId}" aria-label="Send message" type="button"${bookkeeping ? ' data-fixture-control="send"' : ""}>Send</button>`;
  const extraSend =
    variant === "SEND_AMBIGUOUS"
      ? `<button data-testid="${STANDARD_SELECTORS.sendControl.testId}" aria-label="Send message" type="button">Send duplicate</button>`
      : "";
  const stop =
    variant === "SEND_STOP_CONFUSION"
      ? `<button data-testid="${STANDARD_SELECTORS.stopControl.testId}" aria-label="Stop generating" type="button">Stop</button>`
      : `<button data-testid="${STANDARD_SELECTORS.stopControl.testId}" aria-label="Stop generating" type="button" hidden>Stop</button>`;
  return `<form data-fixture-composer="${suffix}"${bookkeeping ? ' data-fixture-bookkeeping="composer"' : ""}>
    <textarea id="${promptId}" data-testid="${promptTestId}" aria-label="ChatGPT prompt"${disabled}></textarea>
    ${send}${extraSend}${stop}
  </form>`;
}

function historicalResponse(): string {
  return `<section data-turn="assistant" data-turn-id="turn-history">
    <div data-writing-block-fullscreen-editor-region><button aria-label="Copy" type="button">Copy</button><pre><code>BRIDGE_HEALTHCHECK_V1</code></pre></div>
  </section>`;
}

function newResponseMarkup(variant: HealthStandardH3FixtureVariant): string {
  const responseSelfBusy = [
    "COMPLETION_MISSING",
    "RESPONSE_SELF_BUSY_STUCK",
    "FRESH_BOUND_IDENTITY_CHANGES",
    "IDENTITY_CHANGES_DURING_COMPLETION",
  ].includes(variant);
  const otherBusyRemains = variant === "STOP_CLEARS_BUT_OTHER_BUSY_REMAINS";
  const emptyResponse = variant === "EMPTY_RESPONSE_AFTER_GENERATION";
  const responseText =
    variant === "FRESH_BOUND_IDENTITY_CHANGES" || emptyResponse
      ? ""
      : "Completed response";
  const code =
    variant === "CODE_BLOCK_MISSING" ||
    variant === "FRESH_BOUND_IDENTITY_CHANGES" ||
    emptyResponse
      ? ""
      : `<div data-writing-block-fullscreen-editor-region><button aria-label="${variant === "COPY_MISSING" ? "Copy unavailable" : "Copy"}" type="button">Copy</button><pre><code>${variant === "COPY_MISMATCHED" ? "UNEXPECTED_HEALTH_TOKEN" : "BRIDGE_HEALTHCHECK_V1"}</code></pre></div>`;
  const busyMarker = otherBusyRemains
    ? '<div aria-busy="true" data-generation-marker="other"></div>'
    : "";
  return `${busyMarker}<section data-turn="assistant" data-turn-id="turn-response"${responseSelfBusy ? ' aria-busy="true"' : ""}><p>${responseText}</p>${code}</section>`;
}

function checkpointMarkup(kind: string): string {
  if (!kind || kind === "login") return "";
  const label =
    kind === "captcha"
      ? "CAPTCHA security checkpoint"
      : kind === "blocked"
        ? "Account blocked"
        : "Verification checkpoint";
  return `<div role="dialog" aria-label="${label}">${label}</div>`;
}

function fixtureHtml(
  variant: HealthStandardH3FixtureVariant,
  bookkeeping: boolean,
  origin: string,
): string {
  const blocker = BLOCKERS[variant];
  const surface = ["MISSING_SURFACE", "WORK_SURFACE"].includes(variant)
    ? ""
    : `<main${bookkeeping ? ' data-fixture-page="standard"' : ""}>ChatGPT
      <section data-fixture-conversation="active">
        ${variant === "OLD_RESPONSE_ONLY" ? historicalResponse() : ""}
        ${Array.from({ length: variant === "AMBIGUOUS_COMPOSER" ? 2 : 1 }, (_unused, index) => composerMarkup(variant, bookkeeping, String(index))).join("")}
      </section>
    </main>`;
  const responseEnabled = ![
    "OLD_RESPONSE_ONLY",
    "BUSY_TIMEOUT",
    "RESPONSE_MISSING",
  ].includes(variant);
  const startsFresh = [
    "VALID",
    "FRESH_ROOT_NO_ID",
    "IDENTITY_NEVER_BINDS",
    "FRESH_BOUND_IDENTITY_CHANGES",
  ].includes(variant);
  const canonicalId =
    variant === "ROUTE_CANONICAL_CONFLICT"
      ? CHANGED_CONVERSATION_ID
      : startsFresh
        ? null
        : CONVERSATION_ID;
  const canonicalMarkup = canonicalId
    ? `<link rel="canonical" href="${origin}/c/${canonicalId}">`
    : "";
  const freshGenerationSignal =
    variant === "FRESH_BOUND_IDENTITY_CHANGES"
      ? '<div aria-busy="true" data-fixture-generation="fresh-bound"></div>'
      : "";
  return `<!doctype html><html><head><title>ChatGPT</title>${canonicalMarkup}</head>
<body>${surface}${freshGenerationSignal}${checkpointMarkup(blocker ?? "")}
<script>
  const prompt = document.querySelector('#prompt-textarea');
  const main = document.querySelector('main');
  const expectedPrompt = ${JSON.stringify(HEALTH_PROMPT)};
  let sendCount = 0;
  prompt?.addEventListener('input', () => { if (prompt.value === expectedPrompt) fetch('/fixture-action?kind=prompt-match'); });
  document.querySelectorAll('button[data-testid="send-button"]').forEach((send) => {
    send.addEventListener('click', () => {
      sendCount += 1;
      fetch('/fixture-action?kind=send-click&count=' + sendCount);
      if (sendCount !== 1) return;
      const bindConversation = (id) => {
        history.replaceState({}, '', '/c/' + id);
        let canonical = document.querySelector('link[rel="canonical"]');
        if (!canonical) {
          canonical = document.createElement('link');
          canonical.rel = 'canonical';
          document.head.appendChild(canonical);
        }
        canonical.href = ${JSON.stringify(origin)} + '/c/' + id;
      };
      const stop = document.querySelector('button[data-testid="stop-button"]');
      if (${JSON.stringify(variant === "VALID" || variant === "FRESH_ROOT_NO_ID")})
        setTimeout(() => bindConversation(${JSON.stringify(CONVERSATION_ID)}), 5);
      if (${JSON.stringify(variant === "FRESH_BOUND_IDENTITY_CHANGES")}) {
        // Bind the first identity as part of the post-Send lifecycle. Using
        // a timer here could let a slow physical click outlive both fresh
        // identity transitions before OBSERVE_BUSY starts.
        bindConversation(${JSON.stringify(FRESH_BOUND_CONVERSATION_ID)});
      }
      if (${JSON.stringify(variant === "EXISTING_IDENTITY_CHANGES")})
        // Publish the drift in the same task as the physical Send. This
        // negative fixture must not race OBSERVE_BUSY under host load.
        (() => {
          bindConversation(${JSON.stringify(CHANGED_CONVERSATION_ID)});
          if (stop) stop.hidden = false;
        })();
      if (${JSON.stringify(variant === "CONVERSATION_CHANGED")})
        bindConversation(${JSON.stringify(CHANGED_CONVERSATION_ID)});
      if (${JSON.stringify(variant === "IDENTITY_CHANGES_DURING_COMPLETION")})
        setTimeout(() => bindConversation(${JSON.stringify(CHANGED_CONVERSATION_ID)}), 500);
      if (stop && ${JSON.stringify(!["BUSY_TIMEOUT", "EXISTING_IDENTITY_CHANGES"].includes(variant))}) stop.hidden = false;
      if (${JSON.stringify(variant === "DELIVERY_MISSING")}) document.querySelector('#composer-submit-button')?.remove();
      if (!${JSON.stringify(responseEnabled)}) return;
      setTimeout(() => {
        if (${JSON.stringify(variant === "CONVERSATION_CHANGED")}) history.replaceState({}, '', '/c/${CHANGED_CONVERSATION_ID}');
        main?.querySelector('section[data-fixture-conversation="active"]')?.insertAdjacentHTML('beforeend', ${JSON.stringify(newResponseMarkup(variant))});
        const response = document.querySelector('section[data-turn="assistant"][data-turn-id="turn-response"]');
        if (!response) return;
        if (${JSON.stringify(!["COMPLETION_MISSING", "RESPONSE_SELF_BUSY_STUCK", "FRESH_BOUND_IDENTITY_CHANGES", "IDENTITY_CHANGES_DURING_COMPLETION"].includes(variant))}) response.removeAttribute('aria-busy');
        if (${JSON.stringify(!["COMPLETION_MISSING", "BUSY_CLEARS_BUT_STOP_REMAINS", "FRESH_BOUND_IDENTITY_CHANGES"].includes(variant))}) { if (stop) stop.hidden = true; }
        if (${JSON.stringify(variant === "FRESH_BOUND_IDENTITY_CHANGES")}) {
          setTimeout(() => {
            bindConversation(${JSON.stringify(CHANGED_CONVERSATION_ID)});
            // Keep the authoritative generation signal active until the
            // identity transition is published inside OBSERVE_COMPLETION.
            if (stop) stop.hidden = true;
            document
              .querySelector('[data-fixture-generation="fresh-bound"]')
              ?.remove();
            response.removeAttribute("aria-busy");
          }, 100);
        }
      }, 40);
    });
  });
  window.addEventListener('beforeunload', () => fetch('/fixture-action?kind=cleanup'));
</script></body></html>`;
}

export async function startHealthStandardH3Fixture(): Promise<HealthStandardH3Fixture> {
  const requestMethods: string[] = [];
  let promptMatches = 0;
  let sendActivations = 0;
  const server: Server = createServer((request, response) => {
    const path = requestPath(request);
    requestMethods.push(request.method ?? "UNKNOWN");
    if (path === "/fixture-action") {
      const kind = new URL(
        request.url ?? "/",
        "http://127.0.0.1",
      ).searchParams.get("kind");
      if (kind === "send-click") sendActivations += 1;
      if (kind === "prompt-match") promptMatches += 1;
      response.writeHead(204).end();
      return;
    }
    if (path === "/fixture-state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ promptMatches, sendActivations }));
      return;
    }
    const requestedVariant = new URL(
      request.url ?? "/",
      "http://127.0.0.1",
    ).searchParams.get("fixture");
    const variant = (
      path === "/auth/login"
        ? "LOGIN_EXPIRED"
        : (requestedVariant ?? path.slice(1).toUpperCase())
    ) as HealthStandardH3FixtureVariant;
    const variants: readonly HealthStandardH3FixtureVariant[] = [
      "VALID",
      "FRESH_ROOT_NO_ID",
      "EXISTING_CONVERSATION",
      "IDENTITY_NEVER_BINDS",
      "EXISTING_IDENTITY_CHANGES",
      "FRESH_BOUND_IDENTITY_CHANGES",
      "ROUTE_CANONICAL_CONFLICT",
      "WORK_SURFACE",
      "MISSING_SURFACE",
      "LOGIN_EXPIRED",
      "CAPTCHA_CHECKPOINT",
      "VERIFICATION_CHECKPOINT",
      "ACCOUNT_BLOCKED",
      "MISSING_COMPOSER",
      "AMBIGUOUS_COMPOSER",
      "DISABLED_INPUT",
      "MISSING_SEND",
      "SEND_STOP_CONFUSION",
      "SEND_AMBIGUOUS",
      "OLD_RESPONSE_ONLY",
      "BUSY_TIMEOUT",
      "RESPONSE_MISSING",
      "COMPLETION_MISSING",
      "RESPONSE_SELF_BUSY_STUCK",
      "STOP_CLEARS_BUT_OTHER_BUSY_REMAINS",
      "BUSY_CLEARS_BUT_STOP_REMAINS",
      "EMPTY_RESPONSE_AFTER_GENERATION",
      "CODE_BLOCK_MISSING",
      "COPY_MISSING",
      "COPY_MISMATCHED",
      "CONVERSATION_CHANGED",
      "IDENTITY_CHANGES_DURING_COMPLETION",
      "DELIVERY_MISSING",
    ];
    if (!variants.includes(variant) || request.method !== "GET") {
      response.writeHead(404).end();
      return;
    }
    const bookkeeping = !new URL(
      request.url ?? "/",
      "http://127.0.0.1",
    ).searchParams.has("bookkeeping-off");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      fixtureHtml(
        variant,
        bookkeeping,
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      ),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || !address) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("H3_FIXTURE_ADDRESS_UNAVAILABLE");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    startUrl: (variant, bookkeeping = true) => {
      const boundRoute = [
        "EXISTING_CONVERSATION",
        "EXISTING_IDENTITY_CHANGES",
        "ROUTE_CANONICAL_CONFLICT",
        "IDENTITY_CHANGES_DURING_COMPLETION",
      ].includes(variant);
      const path =
        variant === "LOGIN_EXPIRED"
          ? "/auth/login"
          : boundRoute
            ? `/c/${CONVERSATION_ID}`
            : `/${variant.toLowerCase()}`;
      const params = new URLSearchParams();
      if (boundRoute) params.set("fixture", variant);
      if (!bookkeeping) params.set("bookkeeping-off", "");
      const query = params.toString();
      return `${origin}${path}${query ? `?${query}` : ""}`;
    },
    get promptMatches() {
      return promptMatches;
    },
    get sendActivations() {
      return sendActivations;
    },
    requestMethods,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
