"""Finite QA transport: fixed upstreams, private key, complete attempt accounting.

This is a test fixture, not part of the Alisa request handler. Its caller owns
the server lifetime, request allowance, private evidence directory and cleanup.
"""
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
import hashlib
import hmac
import json
import re
import time

ROUTES = {"/v1/messages": "https://api.deepseek.com/anthropic/v1/messages",
          "/v1/chat/completions": "https://api.deepseek.com/chat/completions"}
ALLOWED = {"model", "messages", "system", "max_tokens", "tools", "tool_choice",
           "stream", "thinking", "output_config", "reasoning_effort", "temperature",
           "top_p", "top_k", "stop_sequences", "stop", "metadata"}

class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def receipts(raw, path):
    """Preserve provider usage fields without guessing absent token counts."""
    if path.endswith("chat/completions"):
        obj = json.loads(raw)
        return {"id": obj.get("id"), "model": obj.get("model"), "usage": obj.get("usage")}
    usage, ident, model = None, None, None
    for line in raw.decode("utf-8").splitlines():
        if not line.startswith("data:"):
            continue
        event = json.loads(line[5:].strip())
        message = event.get("message", {})
        ident = message.get("id", ident)
        model = message.get("model", model)
        if event.get("type") == "message_delta" and event.get("usage") is not None:
            usage = event["usage"]
    return {"id": ident, "model": model, "usage": usage}

def synthetic_message(step):
    if step == 1:
        code = """const fs = await import('node:fs/promises');
const net = await import('node:net');
const data = JSON.parse(await fs.readFile('/workspace/input.json', 'utf8'));
let input_write_allowed = false;
try {await fs.appendFile('/workspace/input.json', String.fromCharCode(10)); input_write_allowed = true;} catch {}
const exists = async p => {try {await fs.access(p); return true;} catch {return false;}};
const connects = (host, port) => new Promise(resolve => {
 const s = net.createConnection({host, port}); s.setTimeout(1000);
 s.once('connect', () => {s.destroy(); resolve(true);});
 s.once('error', () => resolve(false)); s.once('timeout', () => {s.destroy(); resolve(false);});
});
return {total: data.rows.reduce((n, x) => n + x.value, 0),
        rows: data.rows.length,
        input_write_allowed,
        live_core_visible: await exists('/opt/alice-market'),
        credentials_visible: await exists('/run/credentials/alice-market.service'),
        foreign_job_visible: await exists('/var/lib/alisa-dsh-lab/foreign-canary.txt'),
        other_loopback_service_reachable: await connects('127.0.0.1', 33192)};"""
        block = {"type": "tool_use", "id": "synthetic_calculation", "name": "run_code", "input": {}}
        delta = {"type": "input_json_delta", "partial_json": json.dumps({"code": code, "description": "Offline calculation and isolation check"})}
        stop = "tool_use"
    else:
        block = {"type": "text", "text": ""}
        delta = {"type": "text_delta", "text": "Offline synthetic run completed."}
        stop = "end_turn"
    events = [
        {"type": "message_start", "message": {"id": "synthetic_" + str(step), "type": "message",
          "role": "assistant", "model": "deepseek-flash", "content": [], "stop_reason": None,
          "stop_sequence": None, "usage": {"input_tokens": 0, "output_tokens": 0}}},
        {"type": "content_block_start", "index": 0, "content_block": block},
        {"type": "content_block_delta", "index": 0, "delta": delta},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None}, "usage": {"output_tokens": 0}},
        {"type": "message_stop"},
    ]
    return "".join("event: " + e["type"] + "\ndata: " + json.dumps(e) + "\n\n" for e in events).encode()

class Gateway(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, token, evidence, key_loader=None, maximum=4, initial_attempts=()):
        self.token, self.evidence, self.key_loader = token, Path(evidence), key_loader
        self.maximum, self.attempts, self.lock = maximum, list(initial_attempts), Lock()
        self.opener = build_opener(ProxyHandler({}), NoRedirects())
        super().__init__(("127.0.0.1", 33191), Handler)

    def save(self):
        temp = self.evidence.with_suffix(".tmp")
        temp.write_text(json.dumps({"synthetic": self.key_loader is None,
            "max_dispatches": self.maximum, "attempts": self.attempts}, ensure_ascii=False, indent=2) + "\n")
        temp.replace(self.evidence)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body, mime="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        gateway = self.server
        supplied = self.headers.get("x-api-key", "") or self.headers.get("Authorization", "").removeprefix("Bearer ")
        if not hmac.compare_digest(supplied, gateway.token):
            return self.reply(401, b'{"error":"QA_AUTH"}')
        if self.path not in ROUTES:
            return self.reply(404, b'{"error":"QA_ROUTE"}')
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4 * 1024 * 1024:
                raise ValueError("QA_BODY_SIZE")
            body = self.rfile.read(length)
            payload = json.loads(body)
            if not isinstance(payload, dict) or payload.get("model") != "deepseek-flash":
                raise ValueError("QA_MODEL")
            maximum = payload.get("max_tokens")
            if isinstance(maximum, bool) or not isinstance(maximum, int) or not 1 <= maximum <= 16384:
                raise ValueError("QA_OUTPUT_LIMIT")
            if self.path == "/v1/messages":
                if payload.get("output_config", {}).get("effort") != "high":
                    raise ValueError("QA_EFFORT")
            elif payload.get("reasoning_effort") != "high":
                raise ValueError("QA_EFFORT")
            unknown = set(payload) - ALLOWED
            if unknown:
                raise ValueError("QA_FIELDS:" + ",".join(sorted(unknown)))
            if self.path == "/v1/messages" and not payload.get("stream"):
                raise ValueError("QA_MESSAGES_REQUIRE_STREAM")
            if "dsh_session_log" in payload:
                raise ValueError("QA_LOG_UPLOAD")
        except (ValueError, TypeError) as exc:
            return self.reply(400, json.dumps({"error": str(exc)}).encode())
        with gateway.lock:
            if len(gateway.attempts) >= gateway.maximum:
                return self.reply(429, b'{"error":{"type":"rate_limit_error","message":"Finite QA call limit reached"}}')
            entry = {"number": len(gateway.attempts) + 1, "path": self.path,
                "admitted_utc": datetime.now(timezone.utc).isoformat(),
                "request_sha256": hashlib.sha256(body).hexdigest(), "request_bytes": len(body),
                "request_fields": sorted(payload), "status": "ADMITTED"}
            gateway.attempts.append(entry)
            gateway.save()
        started = time.monotonic()
        status, raw, mime = 502, b'{"error":"QA_UPSTREAM"}', "application/json"
        try:
            if gateway.key_loader is None:
                if entry["number"] == 2:
                    # The result must come from the real executor, not a mock calculation.
                    last = payload["messages"][-1]
                    blocks = last.get("content", [])
                    results = [b for b in blocks if b.get("type") == "tool_result"]
                    if not results or any(b.get("is_error") for b in results):
                        raise ValueError("QA_TOOL_FAILED")
                    text = "".join(c.get("text", "") for b in results for c in b.get("content", []) if isinstance(c, dict))
                    compact = re.sub(r"\s+", "", text)
                    required = ['"total":21', '"rows":3', '"input_write_allowed":false', '"live_core_visible":false',
                        '"credentials_visible":false', '"foreign_job_visible":false',
                        '"other_loopback_service_reachable":false']
                    if not all(part in compact for part in required):
                        raise ValueError("QA_TOOL_RESULT_MISSING")
                    entry["synthetic_tool_continuation"] = last
                raw = synthetic_message(entry["number"])
                status, mime = 200, "text/event-stream"
                entry["status"] = "SYNTHETIC_RESPONSE"
            else:
                key = gateway.key_loader()
                headers = {"Content-Type": "application/json", "Accept": "text/event-stream, application/json"}
                if self.path == "/v1/messages":
                    headers.update({"x-api-key": key, "anthropic-version": "2023-06-01"})
                    beta = self.headers.get("anthropic-beta")
                    if beta:
                        if beta != "mid-conversation-tool-changes-2026-07-01":
                            raise ValueError("QA_BETA")
                        headers["anthropic-beta"] = beta
                else:
                    headers["Authorization"] = "Bearer " + key
                # Persist before the actual outbound send; an uncertain outcome stays uncertain.
                with gateway.lock:
                    entry.update(status="DISPATCHED", dispatched_utc=datetime.now(timezone.utc).isoformat())
                    gateway.save()
                request = Request(ROUTES[self.path], data=body, headers=headers, method="POST")
                try:
                    with gateway.opener.open(request, timeout=180) as response:
                        status, mime = response.status, response.headers.get("Content-Type", "application/json")
                        raw = response.read()
                except HTTPError as exc:
                    status, raw = exc.code, exc.read()
                entry["receipt"] = receipts(raw, self.path) if status == 200 else None
                entry["status"] = "COMPLETED" if entry["receipt"] and entry["receipt"]["usage"] else "USAGE_UNKNOWN"
        except Exception as exc:
            entry.update(error_type=type(exc).__name__, status="USAGE_UNKNOWN" if entry.get("dispatched_utc") else "NOT_DISPATCHED_ERROR")
        finally:
            with gateway.lock:
                entry.update(http_status=status, elapsed_seconds=round(time.monotonic() - started, 3))
                gateway.save()
        return self.reply(status, raw, mime)
