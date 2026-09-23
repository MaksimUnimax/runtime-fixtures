import { createServer, type IncomingMessage, type Server } from "node:http";
import { getPackagedH3Prompt } from "@product/health-runner";

export type HealthAliceH3FixtureVariant =
  | "VALID"
  | "NO_ACTIVE_HISTORY"
  | "ACTIVE_HISTORY_DRIFT"
  | "DUPLICATE_COMPOSER"
  | "MISSING_COMPOSER"
  | "MISSING_INPUT"
  | "BLOCKED_SEND"
  | "STOP_CONTROL"
  | "READY_CONTROL"
  | "UNKNOWN_CONTROL"
  | "OLD_RESPONSE_ONLY"
  | "RESPONSE_NO_ID"
  | "NO_GENERATION"
  | "IDENTITY_DRIFT"
  | "EMPTY_RESPONSE"
  | "RESPONSE_REPLACED"
  | "CODE_MISSING"
  | "COPY_MISSING"
  | "EXTERNAL_COPY_ONLY"
  | "COMPOSER_REPLACED"
  | "NO_ACTIVE_INPUT_CONTROLS";

export type HealthAliceH3Fixture = Readonly<{
  origin: string;
  startUrl: (variant: HealthAliceH3FixtureVariant) => string;
  promptMatches: number;
  sendActivations: number;
  requestMethods: readonly string[];
  close: () => Promise<void>;
}>;

const HEALTH_PROMPT = getPackagedH3Prompt("BRIDGE_COMMAND_SMOKE_V1");
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_CONVERSATION_ID = "00000000-0000-4000-8000-000000000002";

function requestPath(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://127.0.0.1").pathname;
}

function composerMarkup(variant: HealthAliceH3FixtureVariant): string {
  if (variant === "MISSING_COMPOSER") return "";
  const input =
    variant === "MISSING_INPUT"
      ? ""
      : `<textarea data-testid="inputbase-textarea"></textarea>`;
  const control =
    variant === "STOP_CONTROL"
      ? `<button data-testid="oknyx" aria-label="Алиса, стоп" type="button">Stop</button>`
      : variant === "READY_CONTROL"
        ? `<button data-testid="oknyx" aria-label="Алиса, начни слушать" type="button">Ready</button>`
        : variant === "UNKNOWN_CONTROL"
          ? `<button data-testid="oknyx" aria-label="Неизвестно" type="button">Unknown</button>`
          : `<button data-testid="oknyx" aria-label="Отправить" type="button"${variant === "BLOCKED_SEND" ? ' class="StandaloneOknyx_error"' : ""}>Send</button>`;
  const shell = `<div class="Standalone-Input" data-testid="standalone-input">
    ${input}<div data-testid="input-controls-root"></div>${control}
  </div>`;
  return variant === "DUPLICATE_COMPOSER" ? `${shell}${shell}` : shell;
}

function assistantMarkup(variant: HealthAliceH3FixtureVariant): string {
  if (variant === "OLD_RESPONSE_ONLY") {
    return `<div data-message-role="alice" id="assistant-old">old response</div>`;
  }
  return variant === "EXTERNAL_COPY_ONLY"
    ? `<button data-testid="codeblock-action-copy">External copy</button>`
    : "";
}

function responseMarkup(variant: HealthAliceH3FixtureVariant): string {
  const code = ["CODE_MISSING", "EMPTY_RESPONSE"].includes(variant)
    ? ""
    : variant === "COPY_MISSING"
      ? `<div class="CodeBlock"><pre class="CodeBlock-ContentPre"><code>BRIDGE_HEALTHCHECK_V1</code></pre></div>`
      : `<div class="CodeBlock"><pre class="CodeBlock-ContentPre"><code>BRIDGE_HEALTHCHECK_V1</code></pre>${variant === "EXTERNAL_COPY_ONLY" ? "" : '<button data-testid="codeblock-action-copy">Copy</button>'}</div>`;
  const identity =
    variant === "RESPONSE_NO_ID" ? "" : ' id="assistant-response"';
  return `<div data-message-role="alice"${identity}><p>${variant === "EMPTY_RESPONSE" ? "" : "Completed response"}</p>${code}</div>`;
}

function fixtureHtml(
  variant: HealthAliceH3FixtureVariant,
  origin: string,
): string {
  const activeId =
    variant === "ACTIVE_HISTORY_DRIFT"
      ? OTHER_CONVERSATION_ID
      : CONVERSATION_ID;
  const activeHistory =
    variant === "NO_ACTIVE_HISTORY"
      ? ""
      : `<div class="ChatListItem" id="${activeId}"><button data-testid="chatlist-item-active" aria-current="page">Active</button></div>`;
  const initialResponse = assistantMarkup(variant);
  const composer = composerMarkup(variant);
  const noControls =
    variant === "NO_ACTIVE_INPUT_CONTROLS"
      ? composer.replace('<div data-testid="input-controls-root"></div>', "")
      : composer;
  return `<!doctype html><html><head><title>Alice fixture</title></head><body>
    ${activeHistory}<main>${initialResponse}</main>${noControls}
    <script>
      const expectedPrompt = ${JSON.stringify(HEALTH_PROMPT)};
      const origin = ${JSON.stringify(origin)};
      let sendCount = 0;
      window.addEventListener('beforeunload', () => fetch('/fixture-action?kind=cleanup'));
      const input = document.querySelector('[data-testid="inputbase-textarea"]');
      input?.addEventListener('input', () => {
        if (input.value === expectedPrompt) {
          fetch('/fixture-action?kind=prompt-match');
          if (${JSON.stringify(variant === "COMPOSER_REPLACED")})
            setTimeout(() => document.querySelector('.Standalone-Input')?.replaceWith(document.querySelector('.Standalone-Input')?.cloneNode(true)), 0);
        }
      });
      const control = document.querySelector('[data-testid="oknyx"]');
      control?.addEventListener('click', () => {
        sendCount += 1;
        fetch('/fixture-action?kind=send-click&count=' + sendCount);
        if (sendCount !== 1) return;
        if (${JSON.stringify(variant === "COMPOSER_REPLACED")}) {
          document.querySelector('.Standalone-Input')?.replaceWith(document.querySelector('.Standalone-Input')?.cloneNode(true));
          return;
        }
        if (${JSON.stringify(["STOP_CONTROL", "READY_CONTROL", "UNKNOWN_CONTROL", "BLOCKED_SEND"].includes(variant))}) return;
        if (${JSON.stringify(variant === "NO_GENERATION")}) return;
        control.setAttribute('aria-label', 'Алиса, стоп');
        control.textContent = 'Stop';
        if (${JSON.stringify(variant === "OLD_RESPONSE_ONLY")}) return;
        if (${JSON.stringify(variant === "IDENTITY_DRIFT")}) {
          history.replaceState({}, '', '/chat/${OTHER_CONVERSATION_ID}');
        }
        setTimeout(() => {
          document.querySelector('main')?.insertAdjacentHTML('beforeend', ${JSON.stringify(responseMarkup(variant))});
          const response = document.querySelector('main > [data-message-role="alice"]:last-child');
          if (${JSON.stringify(variant === "RESPONSE_REPLACED")}) {
            setTimeout(() => response.replaceWith(response.cloneNode(true)), 150);
          }
          setTimeout(() => {
            if (control) { control.setAttribute('aria-label', 'Отправить'); control.textContent = 'Send'; }
          }, ${JSON.stringify(variant === "RESPONSE_REPLACED" ? 500 : 100)});
        }, 50);
      });
    </script></body></html>`;
}

export async function startHealthAliceH3Fixture(): Promise<HealthAliceH3Fixture> {
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
    const variant = new URL(
      request.url ?? "/",
      "http://127.0.0.1",
    ).searchParams.get("fixture") as HealthAliceH3FixtureVariant;
    const variants: readonly HealthAliceH3FixtureVariant[] = [
      "VALID",
      "NO_ACTIVE_HISTORY",
      "ACTIVE_HISTORY_DRIFT",
      "DUPLICATE_COMPOSER",
      "MISSING_COMPOSER",
      "MISSING_INPUT",
      "BLOCKED_SEND",
      "STOP_CONTROL",
      "READY_CONTROL",
      "UNKNOWN_CONTROL",
      "OLD_RESPONSE_ONLY",
      "RESPONSE_NO_ID",
      "NO_GENERATION",
      "IDENTITY_DRIFT",
      "EMPTY_RESPONSE",
      "RESPONSE_REPLACED",
      "CODE_MISSING",
      "COPY_MISSING",
      "EXTERNAL_COPY_ONLY",
      "COMPOSER_REPLACED",
      "NO_ACTIVE_INPUT_CONTROLS",
    ];
    if (request.method !== "GET" || !variants.includes(variant)) {
      response.writeHead(404).end();
      return;
    }
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(fixtureHtml(variant, origin));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || !address)
    throw new Error("H3_FIXTURE_ADDRESS_UNAVAILABLE");
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    startUrl: (variant) =>
      `${origin}/chat/${CONVERSATION_ID}?fixture=${encodeURIComponent(variant)}`,
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
