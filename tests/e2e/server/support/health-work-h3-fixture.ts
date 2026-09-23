import { createServer, type IncomingMessage, type Server } from "node:http";
import { getPackagedH3Prompt } from "@product/health-runner";
import { CHATGPT_WORK_H3_PROFILE } from "../../../../apps/health-runner/src/work-h3-profile.js";

export type HealthWorkH3FixtureVariant =
  | "VALID"
  | "TEXT_PRESENT_GENERATING"
  | "MISSING_WORK_MARKER"
  | "WORK_MARKER_CONTENT_ONLY"
  | "VALID_WORK_MARKER_PLUS_MESSAGE_TEXT_WORK"
  | "SEMANTIC_MARKER_NO_HEADER"
  | "VALID_CODE_LOCAL_COPY"
  | "AMBIGUOUS_WORK_MARKER"
  | "STANDARD_SURFACE"
  | "WRONG_ORIGIN_SURFACE"
  | "MISSING_COMPOSER"
  | "AMBIGUOUS_COMPOSER"
  | "WRONG_COMPOSER_NAME"
  | "DISABLED_INPUT"
  | "MISSING_SEND"
  | "AMBIGUOUS_SEND"
  | "STOP_SEND_CONFUSION"
  | "LOGIN_EXPIRED"
  | "CAPTCHA_CHECKPOINT"
  | "VERIFICATION_CHECKPOINT"
  | "ACCOUNT_BLOCKED"
  | "NO_ROUTE_SHAPE"
  | "ROUTE_CANONICAL_CONFLICT"
  | "PROJECT_ROUTE_MUTATION"
  | "CONVERSATION_MUTATION"
  | "BUSY_TIMEOUT"
  | "RESPONSE_MISSING"
  | "OLD_RESPONSE_ONLY"
  | "COMPLETION_MISSING"
  | "RESPONSE_SELF_BUSY_STUCK"
  | "STOP_CLEARS_BUT_OTHER_BUSY_REMAINS"
  | "BUSY_CLEARS_BUT_STOP_REMAINS"
  | "EMPTY_RESPONSE_AFTER_GENERATION"
  | "GENERATION_TEXT_IN_COMPLETED_RESPONSE"
  | "CODE_BLOCK_MISSING"
  | "NATIVE_COPY_MISSING"
  | "NATIVE_COPY_MISMATCHED"
  | "RESPONSE_COPY_ONLY_WITH_CODE"
  | "TABLE_COPY_ONLY_WITH_CODE"
  | "DELIVERY_MISSING";

export type HealthWorkH3Fixture = Readonly<{
  origin: string;
  startUrl: (variant: HealthWorkH3FixtureVariant) => string;
  promptMatches: number;
  sendActivations: number;
  close: () => Promise<void>;
}>;

const HEALTH_PROMPT = getPackagedH3Prompt("BRIDGE_COMMAND_SMOKE_V1");
const PROFILE = CHATGPT_WORK_H3_PROFILE;
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const CHANGED_CONVERSATION_ID = "00000000-0000-4000-8000-000000000002";
const CHANGED_PROJECT = "different-project";

const VARIANTS: readonly HealthWorkH3FixtureVariant[] = [
  "VALID",
  "TEXT_PRESENT_GENERATING",
  "MISSING_WORK_MARKER",
  "WORK_MARKER_CONTENT_ONLY",
  "VALID_WORK_MARKER_PLUS_MESSAGE_TEXT_WORK",
  "SEMANTIC_MARKER_NO_HEADER",
  "VALID_CODE_LOCAL_COPY",
  "AMBIGUOUS_WORK_MARKER",
  "STANDARD_SURFACE",
  "WRONG_ORIGIN_SURFACE",
  "MISSING_COMPOSER",
  "AMBIGUOUS_COMPOSER",
  "WRONG_COMPOSER_NAME",
  "DISABLED_INPUT",
  "MISSING_SEND",
  "AMBIGUOUS_SEND",
  "STOP_SEND_CONFUSION",
  "LOGIN_EXPIRED",
  "CAPTCHA_CHECKPOINT",
  "VERIFICATION_CHECKPOINT",
  "ACCOUNT_BLOCKED",
  "NO_ROUTE_SHAPE",
  "ROUTE_CANONICAL_CONFLICT",
  "PROJECT_ROUTE_MUTATION",
  "CONVERSATION_MUTATION",
  "BUSY_TIMEOUT",
  "RESPONSE_MISSING",
  "OLD_RESPONSE_ONLY",
  "COMPLETION_MISSING",
  "RESPONSE_SELF_BUSY_STUCK",
  "STOP_CLEARS_BUT_OTHER_BUSY_REMAINS",
  "BUSY_CLEARS_BUT_STOP_REMAINS",
  "EMPTY_RESPONSE_AFTER_GENERATION",
  "GENERATION_TEXT_IN_COMPLETED_RESPONSE",
  "CODE_BLOCK_MISSING",
  "NATIVE_COPY_MISSING",
  "NATIVE_COPY_MISMATCHED",
  "RESPONSE_COPY_ONLY_WITH_CODE",
  "TABLE_COPY_ONLY_WITH_CODE",
  "DELIVERY_MISSING",
];

function requestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function checkpointMarkup(variant: HealthWorkH3FixtureVariant): string {
  const label =
    variant === "CAPTCHA_CHECKPOINT"
      ? "CAPTCHA security checkpoint"
      : variant === "ACCOUNT_BLOCKED"
        ? "Account blocked"
        : "Verification checkpoint";
  return `<div role="dialog" aria-label="${label}">${label}</div>`;
}

function responseMarkup(variant: HealthWorkH3FixtureVariant): string {
  const empty = variant === "EMPTY_RESPONSE_AFTER_GENERATION";
  const missingCode = [
    "CODE_BLOCK_MISSING",
    "EMPTY_RESPONSE_AFTER_GENERATION",
  ].includes(variant);
  const copyLabel = [
    "NATIVE_COPY_MISSING",
    "RESPONSE_COPY_ONLY_WITH_CODE",
    "TABLE_COPY_ONLY_WITH_CODE",
  ].includes(variant)
    ? ""
    : variant === "NATIVE_COPY_MISMATCHED"
      ? "Не копировать"
      : "Копировать";
  const responseCopy =
    variant === "RESPONSE_COPY_ONLY_WITH_CODE"
      ? '<button aria-label="Копировать ответ" type="button">Копировать ответ</button>'
      : variant === "TABLE_COPY_ONLY_WITH_CODE"
        ? '<button aria-label="Копировать таблицу" type="button">Копировать таблицу</button>'
        : "";
  const code = missingCode
    ? ""
    : `<div data-writing-block-fullscreen-editor-region>${
        copyLabel
          ? `<button aria-label="${copyLabel}" type="button">${copyLabel}</button>`
          : ""
      }<pre><code>BRIDGE_HEALTHCHECK_V1</code></pre></div>`;
  const otherBusy =
    variant === "STOP_CLEARS_BUT_OTHER_BUSY_REMAINS"
      ? '<div aria-busy="true" data-generation-state="other"></div>'
      : "";
  return `${otherBusy}<section data-turn="assistant" data-turn-id="turn-response"${
    ["COMPLETION_MISSING", "RESPONSE_SELF_BUSY_STUCK"].includes(variant)
      ? ' aria-busy="true"'
      : ""
  }><p>${empty ? "" : variant === "GENERATION_TEXT_IN_COMPLETED_RESPONSE" ? PROFILE.generatingText : "Completed response"}</p>${responseCopy}${code}</section>`;
}

function fixtureHtml(
  variant: HealthWorkH3FixtureVariant,
  origin: string,
): string {
  const missingMarker = [
    "MISSING_WORK_MARKER",
    "WORK_MARKER_CONTENT_ONLY",
    "STANDARD_SURFACE",
    "WRONG_ORIGIN_SURFACE",
  ].includes(variant);
  const contentMarker = [
    "WORK_MARKER_CONTENT_ONLY",
    "VALID_WORK_MARKER_PLUS_MESSAGE_TEXT_WORK",
  ].includes(variant);
  const ambiguousMarker = variant === "AMBIGUOUS_WORK_MARKER";
  const noRoute = variant === "NO_ROUTE_SHAPE";
  const canonical =
    variant === "ROUTE_CANONICAL_CONFLICT"
      ? `${origin}/g/g-p-other/c/${CONVERSATION_ID}`
      : noRoute
        ? ""
        : `${origin}/g/g-p-test-project/c/${CONVERSATION_ID}`;
  const composerCount =
    variant === "MISSING_COMPOSER"
      ? 0
      : variant === "AMBIGUOUS_COMPOSER"
        ? 2
        : 1;
  const composerName =
    variant === "WRONG_COMPOSER_NAME"
      ? "Другой редактор"
      : PROFILE.composerName;
  const input = (_index: number) =>
    `<textarea id="prompt-textarea" aria-label="${composerName}" placeholder="${PROFILE.emptyPlaceholder}"${
      variant === "DISABLED_INPUT" ? " disabled" : ""
    }></textarea>`;
  const send =
    variant === "MISSING_SEND"
      ? ""
      : `<button id="composer-submit-button" data-testid="send-button" aria-label="${PROFILE.sendName}" type="button">${PROFILE.sendName}</button>`;
  const duplicate =
    variant === "AMBIGUOUS_SEND"
      ? `<button data-testid="send-button" aria-label="${PROFILE.sendName}" type="button">${PROFILE.sendName}</button>`
      : "";
  const stop = `<button data-testid="stop-button" aria-label="${PROFILE.stopName}" type="button"${
    variant === "STOP_SEND_CONFUSION" ? "" : " hidden"
  }>${PROFILE.stopName}</button>`;
  const forms = Array.from(
    { length: composerCount },
    (_unused, index) =>
      `<form>${input(index)}${send}${duplicate}${stop}</form>`,
  ).join("");
  const oldResponse =
    variant === "OLD_RESPONSE_ONLY"
      ? '<section data-turn="assistant" data-turn-id="turn-history"><p>Old response</p></section>'
      : "";
  const marker = missingMarker
    ? ""
    : `<div><span>Test project</span><span>/</span><span>Test conversation</span><span>${PROFILE.workMarker}</span>${
        ambiguousMarker ? `<span>${PROFILE.workMarker}</span>` : ""
      }</div>`;
  const contentMarkerMarkup = contentMarker
    ? `<section data-turn="user" data-turn-id="turn-user"><p>${PROFILE.workMarker}</p></section>`
    : "";
  const hasMain = variant !== "WRONG_ORIGIN_SURFACE";
  const initialResponse = variant === "OLD_RESPONSE_ONLY" ? oldResponse : "";
  const checkpoint = [
    "CAPTCHA_CHECKPOINT",
    "VERIFICATION_CHECKPOINT",
    "ACCOUNT_BLOCKED",
  ].includes(variant)
    ? checkpointMarkup(variant)
    : "";
  return `<!doctype html><html><head><title>ChatGPT</title>${
    canonical ? `<link rel="canonical" href="${canonical}">` : ""
  }</head><body>${marker}${contentMarkerMarkup}${
    hasMain
      ? `<main><section data-active-conversation="true">${initialResponse}${forms}</section></main>`
      : ""
  }${checkpoint}<div id="generation-text" hidden>${PROFILE.generatingText}</div>
<script>
const expectedPrompt = ${JSON.stringify(HEALTH_PROMPT)};
let sendCount = 0;
const markGenerating = (clearInput) => {
  document.querySelectorAll('textarea[aria-label="${PROFILE.composerName}"]').forEach((input) => {
    input.placeholder = ${JSON.stringify(PROFILE.generatingPlaceholder)};
    if (clearInput) input.value = '';
  });
  document.querySelectorAll('button[data-testid="stop-button"]').forEach((button) => { button.hidden = false; });
  const text = document.querySelector('#generation-text'); if (text) text.hidden = false;
};
document.querySelectorAll('textarea').forEach((input) => input.addEventListener('input', () => {
  if (input.value === expectedPrompt) fetch('/fixture-action?kind=prompt-match');
  if (${JSON.stringify(variant === "TEXT_PRESENT_GENERATING")}) markGenerating(false);
}));
document.querySelectorAll('button[data-testid="send-button"]').forEach((button) => button.addEventListener('click', () => {
  sendCount += 1; fetch('/fixture-action?kind=send-click&count=' + sendCount);
  if (sendCount !== 1) return;
  if (${JSON.stringify(variant !== "BUSY_TIMEOUT")}) markGenerating(true);
  if (${JSON.stringify(variant === "PROJECT_ROUTE_MUTATION")}) history.replaceState({}, '', '/g/g-p-${CHANGED_PROJECT}/c/${CONVERSATION_ID}');
  if (${JSON.stringify(variant === "CONVERSATION_MUTATION")}) history.replaceState({}, '', '/g/g-p-test-project/c/${CHANGED_CONVERSATION_ID}');
  if (${JSON.stringify(variant === "DELIVERY_MISSING")}) document.querySelector('form button[data-testid="send-button"]')?.remove();
  if (${JSON.stringify(["BUSY_TIMEOUT", "RESPONSE_MISSING", "OLD_RESPONSE_ONLY"].includes(variant))}) return;
  setTimeout(() => {
    const active = document.querySelector('[data-active-conversation="true"]');
    active?.insertAdjacentHTML('beforeend', ${JSON.stringify(responseMarkup(variant))});
    const response = document.querySelector('section[data-turn="assistant"][data-turn-id="turn-response"]');
    if (!response) return;
    if (${JSON.stringify(!["COMPLETION_MISSING", "RESPONSE_SELF_BUSY_STUCK"].includes(variant))}) response.removeAttribute('aria-busy');
    if (${JSON.stringify(!["COMPLETION_MISSING", "BUSY_CLEARS_BUT_STOP_REMAINS"].includes(variant))}) {
      setTimeout(() => {
        document.querySelectorAll('button[data-testid="stop-button"]').forEach((button) => { button.hidden = true; });
        const text = document.querySelector('#generation-text'); if (text) text.hidden = true;
        document.querySelectorAll('textarea[aria-label="${PROFILE.composerName}"]').forEach((input) => {
          input.placeholder = ${JSON.stringify(PROFILE.emptyPlaceholder)};
        });
      }, 120);
    }
  }, 40);
}));
</script></body></html>`;
}

export async function startHealthWorkH3Fixture(): Promise<HealthWorkH3Fixture> {
  let promptMatches = 0;
  let sendActivations = 0;
  const server: Server = createServer((request, response) => {
    const path = requestPath(request);
    if (path === "/fixture-action") {
      const kind = new URL(
        request.url ?? "/",
        "http://127.0.0.1",
      ).searchParams.get("kind");
      if (kind === "prompt-match") promptMatches += 1;
      if (kind === "send-click") sendActivations += 1;
      response.writeHead(204).end();
      return;
    }
    if (path === "/fixture-state") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ promptMatches, sendActivations }));
      return;
    }
    const query = new URL(request.url ?? "/", "http://127.0.0.1").searchParams;
    const variant = (query.get("fixture") ??
      "VALID") as HealthWorkH3FixtureVariant;
    if (path === "/auth/login") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(fixtureHtml("LOGIN_EXPIRED", originFor(server)));
      return;
    }
    if (path !== "/" && !path.startsWith("/g/")) {
      response.writeHead(404).end();
      return;
    }
    if (!VARIANTS.includes(variant) || request.method !== "GET") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml(variant, originFor(server)));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = originFor(server);
  return {
    origin,
    startUrl: (variant) => {
      const path =
        variant === "LOGIN_EXPIRED"
          ? "/auth/login"
          : variant === "NO_ROUTE_SHAPE"
            ? "/"
            : `/g/g-p-test-project/c/${CONVERSATION_ID}`;
      return `${origin}${path}?fixture=${variant}`;
    },
    get promptMatches() {
      return promptMatches;
    },
    get sendActivations() {
      return sendActivations;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function originFor(server: Server): string {
  const address = server.address();
  if (typeof address !== "object" || !address)
    throw new Error("H3_FIXTURE_ADDRESS_UNAVAILABLE");
  return `http://127.0.0.1:${address.port}`;
}
