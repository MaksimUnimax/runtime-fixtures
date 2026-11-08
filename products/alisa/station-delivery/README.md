# Station autoanswer R2

Production delivery service with a personal Station connection in the authenticated customer cabinet. The first physical owner acceptance and the full S06/S19 new-customer marketplace path remain open.

Personal connection URL: https://alisa.octoport.ru/app/station/ (ordinary customer session; QR, device selection, pairing and disconnect are isolated by customer ID).

Admin settings URL: https://alisa-admin.octoport.ru/admin/station/ (existing OWNER staff session; only global autoanswer switch, interval, pending phrases and manual command). The admin API rejects QR/device/session actions; the customer API rejects settings writes.

- Default autoanswer enabled; a connected, voice-paired Station is required before speech.
- Server timer: 10 seconds by default, configurable 10–300. It is not a native Alice timer/alarm and does not rely on TimerFinished.
- One to six administrator-edited pending phrases, up to 200 characters each, rotate during QUEUED/RUNNING. Every repetition includes an approximate remaining time; `{remaining}` places it within the phrase, otherwise it is appended. Interval is measured after the previous accepted command; network and speech introduce latency.
- The initial ETA is approximately one minute until three completed jobs have been observed. Thereafter it uses a rolling upper quartile of up to 20 observed completion times, rounded to ten seconds and bounded to 30–900 seconds. On overrun the estimate extends; it is a heuristic, not a guaranteed deadline. The speech repeats at the configured interval until READY, cancellation, revocation or the delivery lifetime ends.
- READY checked every second through private IPC, no marketplace/LLM polling, enqueue, or control receipt creation. READY does not wait for the pending-message interval. After accepting an asynchronous job, the skill reply sets `end_session=true` so the smart-home scenario can reopen it in a new session. The final callback remains open for `дальше`; the full-command guard remains defensive while Quasar delivery is verified physically.
- A technical scenario is created automatically. Progress/pairing uses TTS; the final answer invokes the existing skill with a short-lived exact-job nonce. Financial text is never stored in the technical scenario.
- The callback verifies current voice token, tenant + application binding, enabled flag, generation, nonce lifetime, job state, reader selection and current source permission. It attaches the exact report to the new conversation for `дальше`.
- Autoanswer OFF stops future sends and leaves the same saved report for the configurable manual phrase (default `результат`). Turning it back on does not unexpectedly replay previously disabled tasks.
- QR session is encrypted with Fernet, root-provisioned systemd credential; no credentials in Git/logs/JS. Revoke clears local session, pending tasks and binding. Remote session revocation can also be performed in the Yandex account.
- After the one-time QR approval, the service selects the only Station (or asks the owner to choose among several) and invokes the linked skill with a short-lived challenge. The authorized callback binds its application to the chosen device automatically. The user does not read or pronounce a code. Challenge lifetime: 3 minutes / 5 failed attempts per voice identity, 24 random digits. No account guessed from email/name.
- Network mutation outcome unknown → no blind retry, reconnect required. Accepted by Quasar / callback answered is not proof of physical sound.
- One selected Station, one active delivery subscription. A new job supersedes previous automatic delivery on this Station; stored reports remain under existing runtime retention.
- A waiting Station subscription stops after 24 hours; the underlying runtime's ready report has its own expiry. A terminal FAILED/UNKNOWN job produces one spoken failure explanation; cancelled/revoked/expired jobs stop. The configured manual command remains available for status.

Greeting: empty launch now says only «Привет». Site-name personalization remains dependent on the real site↔skill identity connection; no staff/Yandex/demo name is substituted. Existing H00 stays on an explicit help request.

## Source and rollout

`build_adapters.py` reproducibly patches three pinned installed source files into `alice_lab.py`, `alice_bridge.py`, `local_gateway.py`. No engine, matrix, provider, auth, store code or platform release pointer changes. Runtime service gets a hardlinked copy of the existing immutable release plus the two IPC files; originals stay intact. Lab OAuth is unchanged. `install.py` preserves the current promotions-r1 runtime and holds the existing release locks, checks exact original hashes and idle runtime, installs a dedicated persistent service and nginx path, and rolls back its own cutover on failure. See the installation receipt in the release report for the actual status.

A later code-agent runtime/lab deployment must carry the station_status/station_deliver gateway branch and station_client call. Do not replace this active integration with the historical original transport. No change needed in formulas/templates. `activate_site_r2.py` upgrades only the Station sidecar and adds the site reverse proxy route. The admin subsection has a direct URL for settings; the general admin bundle is not rebuilt over another agent's active work.

The Quasar callback must recognize the full invocation «спроси Октопорт маркет доставка …» and return the bound report once. Internal delivery commands must never fall through to the analytics planner. See [the 2026-11-08 incident](INCIDENT_20261108_VOICE_LOOP.md) and its physical acceptance step.

## Checks

```
python build_adapters.py
PYTHONPATH=/path/to/qualified/runtime:. python -B -m unittest test_delivery test_boundaries test_runtime_delivery
ALISA_TEST_RUNTIME=/path/to/qualified/runtime python -B test_runtime_delivery.py
node --check app.js
node --check app-admin.js
python -B test_eta.py
```

Offline transport fixtures make no Yandex/provider calls. Installed synthetic checks and physical owner acceptance are separate.

Owner clarification accepted: QR is allowed once in the customer cabinet, with durable encrypted session reuse. Closing the page, ordinary skill requests and restarting the service do not require a new QR. Yandex-side expiry/revocation may require reconnect. Previous OWNER_UX_CORRECTION.md records the earlier misunderstanding and is superseded on this point.
