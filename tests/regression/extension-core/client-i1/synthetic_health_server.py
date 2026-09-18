"""Test-only signed Health transport for the native MV3 acceptance harness.

The server derives the expected Health context from the request's signed
Bootstrap envelope and signs the response with the ephemeral key used to
compose the test runtime.  It never changes the extension trust bundle and
does not ship in the extension package.
"""

from __future__ import annotations

import base64
import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def decode_b64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class SyntheticHealthServer:
    """Loopback control-plane endpoint with deterministic response modes."""

    def __init__(self, private_key_path: Path):
        self.private_key = serialization.load_der_private_key(private_key_path.read_bytes(), password=None)
        self.mode = "pass"
        self.sync_mode = "unavailable"
        self.sync_state_override: dict[str, Any] | None = None
        self.requests: list[dict[str, Any]] = []
        self.release = threading.Event()
        self.health_seen = threading.Event()
        self._server = ReusableThreadingHTTPServer(("127.0.0.1", 43100), self._handler())
        self.thread = threading.Thread(target=self._server.serve_forever, name="synthetic-health", daemon=True)

    def _handler(self):
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return

            def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler API
                length = int(self.headers.get("content-length", "0"))
                raw = self.rfile.read(length)
                try:
                    body = json.loads(raw or b"{}")
                except json.JSONDecodeError:
                    body = {}
                fixture.requests.append({"path": self.path, "method": "POST", "body": body})
                if self.path == "/v1/sync":
                    response = fixture._sync(body)
                    encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode()
                    self.send_response(200 if fixture.sync_mode not in {"unavailable", "network"} else 503)
                    self.send_header("content-type", "application/json")
                    self.send_header("content-length", str(len(encoded)))
                    self.end_headers()
                    if fixture.sync_mode != "network": self.wfile.write(encoded)
                    else: self.close_connection = True
                    return
                if self.path != "/v1/health-authority":
                    self.send_response(404)
                    self.end_headers()
                    return
                fixture.health_seen.set()
                if fixture.mode == "network":
                    self.close_connection = True
                    return
                if fixture.mode == "delayed":
                    fixture.release.wait(15)
                response = fixture._health(body)
                encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode()
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

        return Handler

    def _health(self, body: dict[str, Any]) -> dict[str, Any]:
        bootstrap_envelope = body.get("bootstrapEnvelope") or {}
        payload_bytes = decode_b64url(bootstrap_envelope["payload"])
        payload = json.loads(payload_bytes)
        now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        observed = (now.timestamp() - 1)
        expires = (now.timestamp() + 15 * 60)
        iso = lambda seconds: __import__("datetime").datetime.fromtimestamp(seconds, __import__("datetime").timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        context = {
            "accountId": payload["account"]["id"],
            "deviceId": "22222222-2222-4222-8222-222222222222",
            "sessionId": "33333333-3333-4333-8333-333333333333",
            "contractVersion": payload["contractVersion"],
            "configVersion": payload["configVersion"],
            "bootstrapSnapshotSha256": hashlib.sha256(payload_bytes).hexdigest(),
            "ai": {
                "family": payload["ai"]["detected"]["family"],
                "surface": payload["ai"]["detected"]["surface"],
                "variant": payload["ai"]["detected"]["variant"],
                "profileKey": payload["ai"]["profile"]["profileKey"],
                "revision": payload["ai"]["profile"]["revision"],
                "scopeVariant": payload["ai"]["profile"]["scopeVariant"],
                "contentSha256": payload["ai"]["profile"]["contentSha256"],
            },
        }
        status = "PASS"
        claim: dict[str, Any] = {
            "healthClaimVersion": "health_claim_v1",
            "status": status,
            "target": "WORK",
            "context": context,
            "observedAt": iso(observed),
            "expiresAt": iso(expires),
            "executionAuthority": False,
        }
        if self.mode == "deny":
            claim["status"] = "DENY"
            claim["reason"] = "SYNTHETIC_OWNER_DENIED"
        elif self.mode == "unavailable":
            claim["status"] = "UNAVAILABLE"
            claim["reason"] = "SYNTHETIC_PRODUCER_UNAVAILABLE"
        elif self.mode == "expired":
            claim["observedAt"] = iso(now.timestamp() - 16 * 60)
            claim["expiresAt"] = iso(now.timestamp() - 1)
        elif self.mode == "wrong-context":
            claim["context"] = {**context, "bootstrapSnapshotSha256": "f" * 64}
        payload_claim = canonical(claim).encode()
        key_id = bootstrap_envelope.get("keyId", "browser-fixture-key")
        signed = b"product-control-plane/health-authority/v1\0" + key_id.encode() + b"\0" + payload_claim
        signature = b64url(self.private_key.sign(signed))
        if self.mode == "tampered":
            signature = signature[:-1] + ("A" if signature[-1] != "A" else "B")
        return {"healthEnvelopeVersion": "health_envelope_v1", "algorithm": "Ed25519", "keyId": key_id, "payload": b64url(payload_claim), "signature": signature}

    def start(self):
        self.thread.start()
        return self

    def configure(self, mode: str):
        self.mode = mode
        self.release.clear()
        self.health_seen.clear()

    def configure_sync(self, mode: str, state: dict[str, Any] | None = None):
        self.sync_mode = mode
        self.sync_state_override = state

    def _sync(self, body: dict[str, Any]) -> dict[str, Any]:
        entries = body.get("entries") if isinstance(body.get("entries"), list) else []
        results = []
        for entry in entries:
            payload = entry.get("payload") if isinstance(entry.get("payload"), dict) else {}
            state = self.sync_state_override or payload
            state = dict(state)
            if self.sync_mode in {"stale_upsert", "late_ack"}:
                state.update({"kind": "STORE_UPSERT", "lifecycleState": "ACTIVE", "name": "stale-server-name", "metadataRevision": 0})
            results.append({
                "requestId": entry.get("requestId"),
                "mutationId": entry.get("mutationId"),
                "entityId": entry.get("entityId"),
                "serverRevision": 1,
                "outcome": "CONFLICT" if self.sync_mode == "stale_upsert" else "ACK",
                "code": "STORE_TOMBSTONE_DOMINATES" if self.sync_mode == "stale_upsert" else "IN_SYNC",
                "serverState": state,
            })
        return {"syncVersion": body.get("syncVersion", "seller_agents_sync_v1"), "results": results}

    def stop(self):
        self._server.shutdown()
        self._server.server_close()
        self.thread.join(timeout=2)
