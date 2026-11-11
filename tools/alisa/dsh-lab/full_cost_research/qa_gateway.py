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
import codecs
import hmac
import json
import re
import time

ROUTES = {"/v1/messages": "https://api.deepseek.com/anthropic/v1/messages",
          "/v1/chat/completions": "https://api.deepseek.com/chat/completions"}
ALLOWED = {"model", "messages", "system", "max_tokens", "tools", "tool_choice",
           "stream", "thinking", "output_config", "reasoning_effort", "temperature",
           "top_p", "top_k", "stop_sequences", "stop", "metadata", "response_format", "user_id"}

class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def usage_complete(usage, path):
    if not isinstance(usage, dict):
        return False
    def integer(value):
        return type(value) is int and value >= 0
    if path.endswith('chat/completions'):
        keys = ('prompt_tokens', 'completion_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens')
        if not all(integer(usage.get(k)) for k in keys):
            return False
        if usage['prompt_tokens'] != usage['prompt_cache_hit_tokens'] + usage['prompt_cache_miss_tokens']:
            return False
        if 'total_tokens' in usage and (not integer(usage['total_tokens']) or usage['total_tokens'] != usage['prompt_tokens'] + usage['completion_tokens']):
            return False
        details = usage.get('prompt_tokens_details', {})
        output_details = usage.get('completion_tokens_details', {})
        if not isinstance(details, dict) or not isinstance(output_details, dict): return False
        alternate = details.get('cached_tokens')
        reason = output_details.get('reasoning_tokens')
        if reason is not None and (not integer(reason) or reason > usage['completion_tokens']): return False
        return alternate is None or (integer(alternate) and alternate == usage['prompt_cache_hit_tokens'])
    return all(integer(usage.get(k)) for k in ('input_tokens', 'cache_read_input_tokens',
                  'cache_creation_input_tokens', 'output_tokens')) and usage['cache_creation_input_tokens'] == 0

def receipts(raw, path):
    """Preserve provider usage fields without guessing absent token counts."""
    if path.endswith("chat/completions"):
        obj = json.loads(raw)
        if not isinstance(obj, dict): raise ValueError('Invalid provider envelope')
        choices = obj.get("choices", [])
        if not isinstance(choices, list) or (choices and not isinstance(choices[0], dict)):
            raise ValueError('Invalid provider choices')
        finish = choices[0].get("finish_reason") if choices else None
        return {"id": obj.get("id"), "model": obj.get("model"), "usage": obj.get("usage"),
                "usage_complete": usage_complete(obj.get('usage'), path),
                "response_complete": finish is not None, "finish_reason": finish}
    usage, ident, model, finish, stopped = None, None, None, None, False
    # An SSE event can contain multiple data lines. Ignore a trailing partial
    # frame: it has not yet been dispatched by the SSE framing protocol.
    normalized = codecs.getincrementaldecoder('utf-8')().decode(raw, final=False).replace('\r\n', '\n').replace('\r', '\n')
    for frame in normalized.split('\n\n')[:-1]:
        data = '\n'.join(line[5:].removeprefix(' ') for line in frame.split('\n') if line.startswith('data:'))
        if not data:
            continue
        event = json.loads(data)
        if not isinstance(event, dict): raise ValueError('Invalid SSE envelope')
        message = event.get("message", {})
        if not isinstance(message, dict): raise ValueError('Invalid SSE message')
        ident = message.get("id", ident)
        model = message.get("model", model)
        if event.get("type") == "message_delta" and event.get("usage") is not None:
            usage = event["usage"]
            delta = event.get('delta', {})
            if not isinstance(delta, dict): raise ValueError('Invalid SSE delta')
            finish = delta.get("stop_reason")
        if event.get("type") == "message_stop":
            stopped = True
    return {"id": ident, "model": model, "usage": usage,
            "usage_complete": usage_complete(usage, path),
            "response_complete": stopped, "finish_reason": finish}

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
    def __init__(self, token, evidence, key_loader=None, maximum=None, initial_attempts=(), raw_evidence_dir=None):
        self.token, self.evidence, self.key_loader = token, Path(evidence), key_loader
        self.raw_evidence_dir = Path(raw_evidence_dir) if raw_evidence_dir else None
        if self.raw_evidence_dir:
            self.raw_evidence_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.maximum, self.attempts, self.lock = maximum, list(initial_attempts), Lock()
        self.stage = 'answer'
        self.cache_user = None
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
            client_body = body
            # Explicit research treatment: use provider-default output length,
            # exactly as the production final-answer request does. The native
            # SDK may materialize its own default; preserve its original bytes
            # separately and record the actual outbound bytes, never silently.
            removed_output_limit = payload.pop('max_tokens', None) if gateway.stage != 'selector' else None
            if gateway.cache_user:
                if self.path == '/v1/messages':
                    payload['metadata'] = {**payload.get('metadata', {}), 'user_id': gateway.cache_user}
                else:
                    payload['user_id'] = gateway.cache_user
            body = json.dumps(payload, ensure_ascii=False).encode()
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
            if gateway.maximum is not None and len(gateway.attempts) >= gateway.maximum:
                return self.reply(429, b'{"error":{"type":"rate_limit_error","message":"Finite QA call limit reached"}}')
            entry = {"number": len(gateway.attempts) + 1, "path": self.path,
                "admitted_utc": datetime.now(timezone.utc).isoformat(),
                "request_sha256": hashlib.sha256(body).hexdigest(), "request_bytes": len(body),
                "request_fields": sorted(payload), "status": "ADMITTED"}
            entry.update(stage=gateway.stage, client_request_sha256=hashlib.sha256(client_body).hexdigest(),
                         removed_client_max_tokens=removed_output_limit,
                         cache_namespace_sha256=hashlib.sha256((gateway.cache_user or '').encode()).hexdigest())
            gateway.attempts.append(entry)
            if gateway.raw_evidence_dir:
                request_file = gateway.raw_evidence_dir / (str(entry['number']) + '.request.private.json')
                request_file.write_bytes(body)
                (gateway.raw_evidence_dir / (str(entry['number']) + '.client.request.private.json')).write_bytes(client_body)
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
                parts = []
                def read_body(response):
                    nonlocal raw
                    try:
                        while True:
                            chunk = response.read1(65536)
                            if not chunk: break
                            parts.append(chunk)
                    finally:
                        raw = b''.join(parts)
                try:
                    with gateway.opener.open(request, timeout=180) as response:
                        status, mime = response.status, response.headers.get("Content-Type", "application/json")
                        read_body(response)
                except HTTPError as exc:
                    status = exc.code
                    read_body(exc)
                entry['received_utc'] = datetime.now(timezone.utc).isoformat()
        except Exception as exc:
            entry.update(error_type=type(exc).__name__, status="USAGE_UNKNOWN" if entry.get("dispatched_utc") else "NOT_DISPATCHED_ERROR")
        finally:
            if gateway.key_loader is not None and entry.get('dispatched_utc'):
                try:
                    entry['receipt'] = receipts(raw, self.path) if status == 200 else None
                except (ValueError, UnicodeError, TypeError, KeyError):
                    entry['receipt'] = None
                if entry.get('receipt') and entry['receipt']['usage_complete']:
                    entry['status'] = ('COMPLETED' if entry['receipt']['response_complete'] and not entry.get('error_type')
                                       else 'INCOMPLETE_WITH_USAGE')
                else:
                    entry['status'] = 'USAGE_UNKNOWN'
                # An optional archive failure must not erase an already
                # obtained billing receipt or trigger another model call.
                with gateway.lock:
                    entry.update(http_status=status, elapsed_seconds=round(time.monotonic() - started, 3))
                    gateway.save()
                if gateway.raw_evidence_dir:
                    try:
                        (gateway.raw_evidence_dir / (str(entry['number']) + '.response.private.bin')).write_bytes(raw)
                        entry['response_sha256'] = hashlib.sha256(raw).hexdigest()
                    except OSError as exc:
                        entry['raw_capture_error'] = type(exc).__name__
            with gateway.lock:
                entry.update(http_status=status, elapsed_seconds=round(time.monotonic() - started, 3))
                gateway.save()
        return self.reply(status, raw, mime)
