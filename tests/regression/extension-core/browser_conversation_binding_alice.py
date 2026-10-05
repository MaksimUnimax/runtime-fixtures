"""Native MV3 Alice parity for the shared conversation-binding lifecycle.

This is a LOCAL DEVELOPMENT installed-synthetic test. The extension runtime,
popup, worker, Alice adapter and conversation-binding implementation are real.
The Alice page and loopback Health endpoint are fixtures; external provider
traffic is forbidden.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "client-i1"))
import browser_c1_acceptance as c1
from synthetic_health_server import SyntheticHealthServer

ALICE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
ALICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
ALICE_A_URL = "https://alice.yandex.ru/unrelated/surface-a?fixture=1"
ALICE_A_RETURN_URL = "https://alice.yandex.ru/another/shape-a?fixture=2"
ALICE_B_URL = "https://alice.yandex.ru/not-a-route-contract/surface-b?fixture=1"


def alice_html(conversation_id: str = ALICE_A) -> str:
    return f"""<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>Alice synthetic conversation</title></head>
<body>
  <aside>
    <div class="ChatListItem" id="{conversation_id}">
      <button data-testid="chatlist-item-active" aria-current="page">Текущий чат</button>
    </div>
  </aside>
  <main id="turns" data-conversation-id="{conversation_id}">
    <article data-message-role="user" id="alice-user-1">Исходный вопрос</article>
    <article data-message-role="alice" id="alice-reply-1">Исходный ответ</article>
  </main>
  <div data-testid="standalone-input">
    <textarea data-testid="inputbase-textarea"></textarea>
    <button data-testid="oknyx" aria-label="Отправить">Отправить</button>
  </div>
</body>
</html>"""


def classify_request_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return "non_http"
    if parsed.hostname == "alice.yandex.ru":
        return "alice_fixture"
    if parsed.hostname in {"127.0.0.1", "localhost"}:
        return "loopback"
    return "external_http"


def seed_alice_authority(worker, private_key: Path):
    """Reuse the canonical signed fixture, then re-sign its AI identity as Alice."""
    c1.seed_authority(worker, private_key)
    encoded = base64.b64encode(private_key.read_bytes()).decode("ascii")
    return worker.evaluate(
        """async ({pkcs8, authKey}) => {
          const stored = (await chrome.storage.local.get(authKey))[authKey];
          if (!stored?.authority?.payload || !stored?.authority?.envelope) {
            throw new Error('fixture authority missing');
          }
          const v = SellerAgentsBootstrapVerifier;
          const payload = structuredClone(stored.authority.payload);
          payload.ai = {
            ...payload.ai,
            status: 'RESOLVED',
            detected: {family:'alice',surface:'web',variant:null},
          };
          const bytes = new TextEncoder().encode(v.canonicalJson(payload));
          const keyId = stored.authority.envelope.keyId;
          const prefix = new TextEncoder().encode(
            'product-control-plane/bootstrap-snapshot/v1\\0' + keyId + '\\0'
          );
          const signed = new Uint8Array(prefix.length + bytes.length);
          signed.set(prefix);
          signed.set(bytes, prefix.length);
          const key = await crypto.subtle.importKey(
            'pkcs8',
            Uint8Array.from(atob(pkcs8), c => c.charCodeAt(0)),
            {name:'Ed25519'},
            false,
            ['sign'],
          );
          const signature = new Uint8Array(
            await crypto.subtle.sign('Ed25519', key, signed)
          );
          const envelope = {
            envelopeVersion:'bootstrap_envelope_v2',
            algorithm:'Ed25519',
            keyId,
            payload:v.base64urlEncode(bytes),
            signature:v.base64urlEncode(signature),
          };
          const verified = await v.verifyV2(envelope, SellerAgentsControlConfig.trustBundle);
          if (!verified.ok) throw new Error('alice fixture signature rejected: ' + verified.error);
          stored.authority = {
            ...stored.authority,
            requestedAi:'alice',
            payload,
            envelope,
            cacheBinding:{
              ...stored.authority.cacheBinding,
              detectedAi:{family:'alice',surface:'web',variant:null},
            },
          };
          await chrome.storage.local.set({[authKey]:stored});
          return {
            verified:true,
            family:stored.authority.payload.ai.detected.family,
            requestedAi:stored.authority.requestedAi,
          };
        }""",
        {"pkcs8": encoded, "authKey": c1.AUTH},
    )


def install_send_hook(page):
    page.evaluate(
        """() => {
          globalThis.sent = [];
          const button = document.querySelector('[data-testid="oknyx"]');
          const composer = document.querySelector('[data-testid="inputbase-textarea"]');
          if (!button || !composer) throw new Error('alice fixture composer missing');
          button.addEventListener('click', () => {
            const value = String(composer.value || composer.textContent || '').trim();
            if (!value) return;
            globalThis.sent.push(value);
            const node = document.createElement('article');
            node.dataset.messageRole = 'user';
            node.id = 'alice-user-sent-' + globalThis.sent.length + '-' + Date.now();
            node.textContent = value;
            document.querySelector('#turns').append(node);
            composer.value = '';
            composer.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'deleteContentBackward'}));
            composer.dispatchEvent(new Event('change', {bubbles:true}));
            setTimeout(() => {
              const reply = document.createElement('article');
              reply.dataset.messageRole = 'alice';
              reply.id = 'alice-reply-sent-' + globalThis.sent.length + '-' + Date.now();
              reply.textContent = 'Инструкция или результат получены';
              document.querySelector('#turns').append(reply);
            }, 150);
          });
        }"""
    )


def append_help_block(page):
    page.evaluate(
        """() => {
          const message = document.createElement('article');
          message.dataset.messageRole = 'alice';
          message.id = 'alice-help-' + Date.now();
          const block = document.createElement('div');
          block.className = 'CodeBlock';
          const sticky = document.createElement('div');
          sticky.className = 'CodeBlock-StickyWrapper';
          const copy = document.createElement('button');
          copy.dataset.testid = 'codeblock-action-copy';
          copy.textContent = 'Copy';
          sticky.append(copy);
          const pre = document.createElement('pre');
          pre.className = 'CodeBlock-ContentPre';
          const code = document.createElement('code');
          code.textContent = 'OZON_HELP_V2 {"cluster":"catalog_products"}';
          pre.append(code);
          block.append(sticky, pre);
          message.append(block);
          document.querySelector('#turns').append(message);
        }"""
    )


def switch_conversation(page, conversation_id: str, path: str):
    page.evaluate(
        """({conversationId,path}) => {
          const main = document.querySelector('#turns');
          const item = document.querySelector('.ChatListItem');
          if (!main || !item) throw new Error('alice fixture surface missing');
          main.setAttribute('data-conversation-id', conversationId);
          item.id = conversationId;
          history.pushState({}, '', path);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }""",
        {"conversationId": conversation_id, "path": path},
    )


SAFE_DIAGNOSTIC_CODES = {
    "AUTH_DENIAL_PERSISTENCE_FAILED",
    "AUTH_REFRESH_INVALID",
    "AUTH_REQUIRED",
    "BOOTSTRAP_AUTH_CHALLENGE",
    "BOOTSTRAP_INVALID_SIGNATURE",
    "BOOTSTRAP_PROFILE_INCOMPATIBLE",
    "BOOTSTRAP_SERVER_TIME_REGRESSION",
    "BOOTSTRAP_SNAPSHOT_INVALID",
    "BOOTSTRAP_UNAVAILABLE",
    "BOOTSTRAP_UNKNOWN_SIGNING_KEY",
    "COMPOSER_NOT_FOUND",
    "CONTENT_ADAPTER_ERROR",
    "CONTROL_TRANSPORT_UNAVAILABLE",
    "CONVERSATION_MISMATCH",
    "CONVERSATION_NOT_BOUND",
    "CONVERSATION_NOT_CONFIRMED",
    "CONVERSATION_SURFACE_UNAVAILABLE",
    "IDENTITY_UNAVAILABLE",
    "NO_RECEIVER",
    "OTHER_TAB_MESSAGE_ERROR",
    "PAGE_RUNTIME_INSTALL_FAILED",
    "PAGE_RUNTIME_RECOVERY_UNAVAILABLE",
    "PAGE_TAB_UNAVAILABLE",
    "TAB_MESSAGE_ERROR",
    "WORK_START_ALREADY_PENDING",
    "WORK_START_SEND_TARGET_UNAVAILABLE",
}
SAFE_AI_FAMILIES = {"alice", "chatgpt"}
SAFE_IDENTITY_STATUSES = {"confirmed", "conflict", "unknown", "unavailable", "unsupported"}
SAFE_WORK_STATES = {"inactive", "active_hidden", "active_visible", "recovering"}
SAFE_PENDING_OUTCOMES = {
    "committed_before_click",
    "outcome_unknown_no_retry",
    "pending",
    "sent_acknowledged",
    "unknown_no_retry",
}
SAFE_START_STAGES = {
    "accepted",
    "active",
    "binding",
    "correlation",
    "dispatch",
    "not_accepted",
    "pending",
    "request",
    "requested",
    "send",
    "terminal",
}
SAFE_START_OUTCOMES = {
    "active",
    "blocked",
    "committed_before_click",
    "failed",
    "outcome_unknown_no_retry",
    "pending",
    "sent_acknowledged",
    "unknown",
    "unknown_no_retry",
}
SAFE_TRANSPORT_CLASSES = {
    "CONTEXT_INVALIDATED",
    "NO_RECEIVER",
    "OTHER_TAB_MESSAGE_ERROR",
    "PORT_CLOSED",
    "SYNC_SEND_EXCEPTION",
    "TAB_GONE",
}


def bounded_enum(value, allowed, fallback=None):
    return value if isinstance(value, str) and value in allowed else fallback


def bounded_diagnostic_code(value):
    if value is None:
        return None
    return bounded_enum(value, SAFE_DIAGNOSTIC_CODES, "OTHER")


def sanitize_support_snapshot(snapshot):
    """Keep only closed-enum, privacy-safe diagnostic fields."""
    if not isinstance(snapshot, dict):
        return None
    auth = snapshot.get("auth") if isinstance(snapshot.get("auth"), dict) else {}
    page = snapshot.get("page") if isinstance(snapshot.get("page"), dict) else {}
    work = snapshot.get("work") if isinstance(snapshot.get("work"), dict) else {}
    last_start = work.get("lastStart") if isinstance(work.get("lastStart"), dict) else None
    safe_last_start = None
    if last_start is not None:
        safe_last_start = {
            "stage": bounded_enum(last_start.get("stage"), SAFE_START_STAGES, "other"),
            "code": bounded_diagnostic_code(last_start.get("code")),
            "outcome": bounded_enum(last_start.get("outcome"), SAFE_START_OUTCOMES, "other"),
            "transportClass": bounded_enum(
                last_start.get("transportClass"), SAFE_TRANSPORT_CLASSES
            ),
        }
    state = bounded_enum(work.get("state"), SAFE_WORK_STATES)
    return {
        "auth": {
            "authenticated": auth.get("authenticated") is True,
            "workAllowed": auth.get("workAllowed") is True,
            "lastErrorCode": bounded_diagnostic_code(auth.get("lastErrorCode")),
        },
        "page": {
            "aiFamily": bounded_enum(page.get("aiFamily"), SAFE_AI_FAMILIES),
            "identityStatus": bounded_enum(
                page.get("identityStatus"), SAFE_IDENTITY_STATUSES
            ),
        },
        "work": {
            "state": state,
            "active": state in {"active_visible", "active_hidden", "recovering"},
            "pending": work.get("pending") is True,
            "pendingOutcome": bounded_enum(
                work.get("pendingOutcome"), SAFE_PENDING_OUTCOMES, "other"
            ),
            "lastStart": safe_last_start,
        },
    }


def collect_failure_diagnostics(fixture):
    """Collect independent bounded diagnostics so one read failure cannot hide the rest."""
    diagnostics = {
        "support": None,
        "synthetic_send_count": None,
        "worker_external_request_count": None,
        "unexpected_http_request_count": None,
        "synthetic_alice_page_request_count": None,
        "page_error_count": len(fixture.errors),
        "capture_errors": [],
    }
    try:
        response = fixture.rpc("SA_SUPPORT_SNAPSHOT")
        snapshot = response.get("snapshot") if isinstance(response, dict) else None
        diagnostics["support"] = sanitize_support_snapshot(snapshot)
        if diagnostics["support"] is None:
            diagnostics["capture_errors"].append("SUPPORT_SNAPSHOT_INVALID")
    except Exception:
        diagnostics["capture_errors"].append("SUPPORT_SNAPSHOT_UNAVAILABLE")
    try:
        diagnostics["synthetic_send_count"] = fixture.page.evaluate(
            "() => Array.isArray(globalThis.sent) ? globalThis.sent.length : null"
        )
    except Exception:
        diagnostics["capture_errors"].append("SYNTHETIC_SEND_COUNT_UNAVAILABLE")
    try:
        diagnostics["worker_external_request_count"] = fixture.worker.evaluate(
            "() => Number.isInteger(globalThis.aliceBindingExternalRequestCount) "
            "? globalThis.aliceBindingExternalRequestCount : null"
        )
    except Exception:
        diagnostics["capture_errors"].append("WORKER_NETWORK_COUNTER_UNAVAILABLE")
    try:
        diagnostics["unexpected_http_request_count"] = sum(
            1 for event in fixture.events if event.get("class") == "external_http"
        )
        diagnostics["synthetic_alice_page_request_count"] = sum(
            1 for event in fixture.events if event.get("class") == "alice_fixture"
        )
    except Exception:
        diagnostics["capture_errors"].append("CONTEXT_NETWORK_COUNTER_UNAVAILABLE")
    return diagnostics


class AliceFixture(c1.BrowserFixture):
    def _record_request(self, request):
        self.events.append(
            {"class": classify_request_url(request.url), "method": request.method}
        )

    def _route_request(self, route):
        request_class = classify_request_url(route.request.url)
        if request_class == "alice_fixture":
            route.fulfill(body=alice_html(ALICE_A), content_type="text/html")
            return
        if request_class == "external_http":
            route.abort("blockedbyclient")
            return
        route.continue_()

    def open(self, pw):
        self._pw = pw
        self._profile = tempfile.TemporaryDirectory(prefix="seller-agents-alice-binding-")
        options = {
            "headless": True,
            "args": [
                "--no-sandbox",
                "--disable-dev-shm-usage",
                f"--disable-extensions-except={self.runtime}",
                f"--load-extension={self.runtime}",
            ],
        }
        if os.environ.get("SA_TEST_CHROMIUM"):
            options["executable_path"] = os.environ["SA_TEST_CHROMIUM"]
        else:
            options["channel"] = "chromium"
        self._options = options

        self.context = pw.chromium.launch_persistent_context(self._profile.name, **options)
        self.context.on("request", self._record_request)
        self.context.route("**/*", self._route_request)
        self.worker = self.context.service_workers[0] if self.context.service_workers else self.context.wait_for_event("serviceworker")
        seeded = seed_alice_authority(self.worker, self.private_key)
        assert seeded["verified"] is True and seeded["family"] == "alice"
        expected_worker_url = self.worker.url
        extension_url = self.worker.url.rsplit("/", 1)[0]
        self.context.close()

        self.context = pw.chromium.launch_persistent_context(self._profile.name, **options)
        self.context.on("request", self._record_request)
        self.context.route("**/*", self._route_request)
        self.worker = self.context.service_workers[0] if self.context.service_workers else self.context.wait_for_event("serviceworker")
        assert self.worker.url == expected_worker_url
        status = self.worker.evaluate("async()=>SellerAgentsControlClient.status()")
        assert status["authenticated"] is True and status["workAllowed"] is True, status

        self.worker.evaluate(
            """() => {
              const original = globalThis.fetch;
              globalThis.aliceBindingExternalRequestCount = 0;
              globalThis.fetch = (input, ...args) => {
                const url = String(typeof input === 'string' ? input : input.url);
                if (
                  !url.startsWith('http://127.0.0.1:') &&
                  !url.startsWith('http://localhost:') &&
                  !url.startsWith('chrome-extension://')
                ) {
                  globalThis.aliceBindingExternalRequestCount += 1;
                  throw new Error('FIXTURE_EXTERNAL_NETWORK_FORBIDDEN');
                }
                return original(input, ...args);
              };
            }"""
        )

        self.page = self.context.new_page()
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.goto(ALICE_A_URL, wait_until="domcontentloaded")
        install_send_hook(self.page)
        self.tab_id = self._bind_current_page_tab("Alice synthetic tab")

        self.popup = self.context.new_page()
        self.popup.on("pageerror", lambda error: self.errors.append(str(error)))
        self.popup.add_init_script(
            f"const originalQuery=chrome.tabs.query.bind(chrome.tabs);"
            f"chrome.tabs.query=(query)=>query.active?Promise.resolve([{{id:{self.tab_id}}}]):originalQuery(query);"
        )
        self.popup.goto(extension_url + "/popup.html")
        c1.wait_for(
            lambda: "Аккаунт · 11111111" in self.popup.locator("#account").inner_text(),
            "popup account",
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)

    report = {
        "level": "INSTALLED_SYNTHETIC",
        "provider": "alice",
        "status": "RUNNING",
        "external_provider_calls": None,
        "cases": [],
    }
    fixture = None
    server = SyntheticHealthServer(args.private_key).start()

    def passed(name):
        report["cases"].append({"name": name, "status": "PASS"})
        print(name + ": PASS", flush=True)

    try:
        with sync_playwright() as pw:
            fixture = AliceFixture(args.runtime, args.private_key, server, args.output)
            fixture.open(pw)
            fixture.reset()
            store = fixture.add_ozon("Synthetic Alice binding store")
            assert store["marketplace"] == "ozon"

            initial = c1.wait_for(
                lambda: (
                    state
                    if (state := fixture.state())["identity"]["status"] == "confirmed"
                    and state["identity"]["ai_id"] == "alice"
                    else None
                ),
                "Alice confirmed identity",
                15,
            )
            assert initial["identity"]["conversation_id"] == ALICE_A, initial["identity"]
            assert initial["identity"]["identity_scope"] == "conversation", initial["identity"]
            passed("alice-explicit-active-id-confirms-without-route-grammar")

            fixture.click_start()
            active = c1.wait_for(
                lambda: (
                    state
                    if ((state := fixture.state()).get("work") or {}).get("state") == "active_visible"
                    else None
                ),
                "Alice active work",
                20,
            )
            key = active["conversation_key"]
            assert key == f"https://alice.yandex.ru|{ALICE_A}", key
            assert fixture.page.evaluate("sent.length") == 1
            passed("alice-start-sends-once-and-binds-exact-dialogue")

            append_help_block(fixture.page)
            button = fixture.page.locator(".ozon-bridge-block-action").last
            button.wait_for(timeout=10000)
            assert button.inner_text() == "Ozon"
            button.click()
            fixture.page.wait_for_function("sent.length === 2", timeout=30000)
            assert fixture.page.evaluate("sent[1].startsWith('OZON_')")
            assert (
                fixture.worker.evaluate("aliceBindingExternalRequestCount") == 0
            ), "WORKER_EXTERNAL_REQUEST_ATTEMPTED"
            passed("alice-manual-help-button-stays-in-bound-dialogue")

            fixture.page.reload(wait_until="domcontentloaded")
            install_send_hook(fixture.page)
            restored = c1.wait_for(
                lambda: (
                    state
                    if (state := fixture.state()).get("conversation_key") == key
                    and (state.get("work") or {}).get("state") == "active_visible"
                    else None
                ),
                "Alice reload continuity",
                15,
            )
            assert restored["identity"]["conversation_id"] == ALICE_A
            assert fixture.page.evaluate("sent.length") == 0
            passed("alice-reload-restores-binding-without-replay")

            switch_conversation(fixture.page, ALICE_B, "/not-a-route-contract/surface-b?fixture=1")
            fixture.reload_popup()
            other = c1.wait_for(
                lambda: (
                    state
                    if (state := fixture.state()).get("conversation_key")
                    == f"https://alice.yandex.ru|{ALICE_B}"
                    else None
                ),
                "Alice other conversation",
                15,
            )
            assert (other.get("work") or {}).get("state", "inactive") == "inactive", other
            assert fixture.page.locator(".ozon-bridge-block-action").count() == 0
            assert fixture.page.evaluate("sent.length") == 0
            passed("alice-navigation-does-not-inherit-work")

            switch_conversation(fixture.page, ALICE_A, "/another/shape-a?fixture=2")
            fixture.reload_popup()
            returned = c1.wait_for(
                lambda: (
                    state
                    if (state := fixture.state()).get("conversation_key") == key
                    and (state.get("work") or {}).get("state") == "active_visible"
                    else None
                ),
                "Alice return to original conversation",
                15,
            )
            assert returned["identity"]["conversation_id"] == ALICE_A
            assert fixture.page.evaluate("sent.length") == 0
            passed("alice-return-restores-original-work-without-replay")

            fixture.popup.click("#finish")
            c1.wait_for(
                lambda: (fixture.state().get("work") or {}).get("state") == "inactive",
                "Alice Finish",
                15,
            )
            fixture.page.reload(wait_until="domcontentloaded")
            install_send_hook(fixture.page)
            finished = c1.wait_for(
                lambda: (
                    state
                    if (state := fixture.state()).get("conversation_key") == key
                    and (state.get("work") or {}).get("state") == "inactive"
                    else None
                ),
                "Alice finished reload",
                15,
            )
            assert finished["identity"]["conversation_id"] == ALICE_A
            assert fixture.page.locator(".ozon-bridge-block-action").count() == 0
            assert fixture.page.evaluate("sent.length") == 0
            passed("alice-finish-survives-reload-without-resurrection")

            worker_external_count = fixture.worker.evaluate(
                "aliceBindingExternalRequestCount"
            )
            unexpected_http_count = sum(
                1 for event in fixture.events if event.get("class") == "external_http"
            )
            page_error_count = len(fixture.errors)
            assert worker_external_count == 0, "WORKER_EXTERNAL_REQUEST_ATTEMPTED"
            assert unexpected_http_count == 0, "CONTEXT_EXTERNAL_REQUEST_ATTEMPTED"
            assert page_error_count == 0, "PAGE_ERROR_OBSERVED"
            report["external_provider_calls"] = 0
            report["network_assertions"] = {
                "worker_external_request_count": worker_external_count,
                "unexpected_http_request_count": unexpected_http_count,
                "page_error_count": page_error_count,
            }
            report["synthetic_alice_page_requests"] = sum(
                1 for event in fixture.events if event.get("class") == "alice_fixture"
            )
            report["status"] = "PASS"
    except Exception as error:
        report.update(
            status="FAIL",
            error={
                "code": "ALICE_INSTALLED_SYNTHETIC_FAILURE",
                "type": type(error).__name__,
            },
        )
        if fixture:
            diagnostics = collect_failure_diagnostics(fixture)
            report["failure_diagnostics"] = diagnostics
            if (
                diagnostics["worker_external_request_count"] == 0
                and diagnostics["unexpected_http_request_count"] == 0
            ):
                report["external_provider_calls"] = 0
    finally:
        if fixture:
            try:
                fixture.close()
            except Exception:
                pass
        server.stop()
        (args.output / "result.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    print(
        json.dumps(
            {key: report.get(key) for key in ("level", "provider", "status", "external_provider_calls", "cases", "error")},
            ensure_ascii=False,
        )
    )
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
