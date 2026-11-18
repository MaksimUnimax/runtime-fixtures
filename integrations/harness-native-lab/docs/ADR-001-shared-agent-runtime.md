# ADR-001: Shared tenant-scoped agent runtime, not a Host per registered user
Date: 2026-11-18
Status: proposed for P1 product; P0 operator laboratory remains unchanged
Supersedes: v0.1 requirements ARC-01 and HOST-01..04 of TZ-Harness-v0.1-2026-11-18.docx

## Decision
The first production architecture **must not run a full DSH web Host per user or per chat**. A shared, bounded pool of Harness-compatible agent workers processes separately authorized, persistent chat Sessions. This avoids the previous linear ~300–325 MiB × 100 idle-Host extrapolation. The existing native DSH 0.2.2-rc.1 web Host remains only a single-owner laboratory; it is **not a tenant-safe public endpoint**.

The full product requires product authentication/tenant-aware API mediation before any shared runtime is opened to multiple users. In particular, do **not** share the owner's native launch URL, raw Session identifiers, host-wide Session listing, or native file picker with end users.

```
Browser/mobile client
  → Product API: auth cookie + user_id + chat authorization + budgets
  → bounded turn scheduler and shared native agent-worker pool
       → DeepSeek Messages gateway (usage/price by trusted user_id)
       → trusted MCP dispatch (server-selected connection scope and entitlement)
       → ephemeral isolated worker ONLY for arbitrary shell/code/files
  → one persistent tenant-bound event log / artifacts and streaming reply
```

Per-request authoritative scope is supplied by product backend, not by a model/tool argument or an untrusted header. The agent decides WHETHER a read-only MCP is needed via native tool calling. The MCP enforcement layer independently decides WHETHER the call is authorized, including after a plugin is disabled. Do not add a paid classifier for every turn without comparative tests. A query such as 'What is FBO?' should not call Ozon; 'show my stock' should. A follow-up after actual MCP evidence can analyze the same data without repeating the provider call when the evidence is still valid.

## Why this changes memory purchasing
The previous lab measurement (~322.8 MiB PSS for one full web Host; 906.32 MiB for three) characterized an uneconomical Host-per-tenant choice, NOT the production architecture. On the authorized 8 GiB server on 2026-11-18, `harness-native-lab.service` reported `MemoryCurrent=266088448` bytes and the model gateway `MemoryCurrent=17608704` bytes. These are one-host operational figures; they are **not** evidence of capacity for 100 simultaneous requests.

Plan from active work, not account count:
`RAM = OS+DB+backend + N_workers × worker_RSS + active_buffers + cache + headroom`.
Indicative, unqualified buying range: 8 GiB for pilot/modest activity, 16 GiB as optional headroom for a 100-user text service with bounded active requests; 4–8 GiB may work for 100 mostly dormant accounts on a separate lean server. 64–96 GiB is **not** the recommended starting purchase. Provider-hosted model weights consume no server RAM; CPU, external API rate limits, tool parallelism, output size and user activity are unknown until load testing. A 100 GiB SSD should use storage quotas and off-disk backups.

## Chat and guest-to-account promotion
A guest chat has its own unguessable ID, short-lived proof of ownership and guest-specific policy. Following account confirmation, stop in-flight guest writes, atomically bind the existing canonical journal/chat to the authenticated user, update effective policy/capability rights, revoke the guest claim and resume from the SAME messages. Avoid copying and maintaining two message histories when in-place claim is possible. Old guest denials remain visible as historical assistant replies but old guest *privileged policy* must not be part of the newly constructed system context. Compaction/fork behavior must be checked. The claim transaction is idempotent and makes no model/provider calls.

## Isolation design gates
1. All chat-list, read, append, stream/WebSocket subscribe, session/event, download, cache, MCP, billing and compaction operations check trusted tenant ownership server-side, including when callers supply another known session ID.
2. MCP connections select credentials from the backend-authorized account/connection; the model cannot select owner_id, store_id, key path, endpoint URL, or arbitrary operation.
3. The old single-owner lab MCP mount is NOT safe to expose to multiple product tenants as-is.
4. Shell, user-installed code, and arbitrary filesystem access are **not** introduced in the shared tenant runtime. Run such jobs in short-lived isolation with strict limits and authorization; this still does not imply one permanently resident sandbox per registered user.
5. User/guest prompts, tool outputs and old system-event history do not grant rights or become new privileged instructions.

## P1 verification required before public use
- Create 100 logically distinct sessions in a shared agent-core runtime and confirm no full Host per user is spawned.
- Probe 1/5/10/25/50/100 simultaneous turns with deterministic fixture provider, streaming and bounded tool payloads; do a small separately budgeted real-provider sample.
- Measure cgroup peaks, per-worker RSS/PSS, CPU, p50/p95/p99, backlog, throughput, open connections and cost.
- Verify cross-tenant deny for raw session ID and every UI/API/WS/MCP/cache/artifact route, including reconnect/restart/compaction.
- Verify guest claim exactly once, old guest instructions not active post-claim, and unrelated questions answered by full agent.
- Verify limits/revocation, provider timeouts and no replay of unknown external effects.

## What is NOT delivered by this ADR
No public multi-tenant authentication, no secure shared host, no production capacity certification, no payment wallet. The original operator lab and its signed launch-token entry remain private and unchanged. Approval for future code work does not authorize removing the lab's native web authentication.
