> **NOT_DEPLOYED / UX_REJECTED (2026-11-08).** Owner clarified that QR approval was for the transport test, not approval of a second production onboarding/login. Deployment of this candidate is paused. Its admin QR flow and separate spoken pairing must not become the production customer path. The timer/configuration/reader code below is a candidate only. Resolve the complete normal skill-linking → question → automatic answer path before resuming deployment. No claim that a public skill can wake the Station without separate authority.

# Station autoanswer R1

Owner-requested production integration of the physically tried Quasar probe. This is the single-owner Station channel; it does not declare the new-customer S06/S19 path complete.

Admin URL: https://alisa-admin.octoport.ru/admin/station/ (existing OWNER staff cookie + current platform staff.me checks, no new login or weakened MFA).

- Default autoanswer enabled; a connected, voice-paired Station is required before speech.
- Server timer: 10 seconds by default, configurable 10–300. It is not a native Alice timer/alarm and does not rely on TimerFinished.
- One to six administrator-edited pending phrases, up to 200 characters each, rotate during QUEUED/RUNNING. Interval is measured after the previous accepted command; network and speech introduce latency.
- READY checked every second through private IPC, no marketplace/LLM polling, enqueue, or control receipt creation. READY does not wait for the pending-message interval.
- A technical scenario is created automatically. Progress/pairing uses TTS; the final answer invokes the existing skill with a short-lived exact-job nonce. Financial text is never stored in the technical scenario.
- The callback verifies current voice token, tenant + application binding, enabled flag, generation, nonce lifetime, job state, reader selection and current source permission. It attaches the exact report to the new conversation for `дальше`.
- Autoanswer OFF stops future sends and leaves the same saved report for the configurable manual phrase (default `результат`). Turning it back on does not unexpectedly replay previously disabled tasks.
- QR session is encrypted with Fernet, root-provisioned systemd credential; no credentials in Git/logs/JS. Revoke clears local session, pending tasks and binding. Remote session revocation can also be performed in the Yandex account.
- A six-digit code is spoken only on the selected Station; saying it inside the skill binds the originating application to the device. It expires after 3 minutes / 5 failed attempts. No account guessed from email/name.
- Network mutation outcome unknown → no blind retry, reconnect required. Accepted by Quasar / callback answered is not proof of physical sound.
- One selected Station, one active delivery subscription. A new job supersedes previous automatic delivery on this Station; stored reports remain under existing runtime retention.
- Pending delivery expires after 15 minutes. Stored jobs follow existing runtime expiry. A failed/cancelled/revoked/expired job stops automatic speech; the configured manual command remains available for its status.

Greeting: empty launch now says only «Привет». Site-name personalization remains dependent on the real site↔skill identity connection; no staff/Yandex/demo name is substituted. Existing H00 stays on an explicit help request.

## Source and rollout

`build_adapters.py` reproducibly patches three pinned installed source files into `alice_lab.py`, `alice_bridge.py`, `local_gateway.py`. No engine, matrix, provider, auth, store code or platform release pointer changes. Runtime service gets a hardlinked copy of the existing immutable release plus the two IPC files; originals stay intact. Lab OAuth is unchanged. `install.py` holds the existing release locks, checks exact original hashes and idle runtime, installs a dedicated persistent service and nginx path, and rolls back its own cutover on failure. See the installation receipt in the release report for the actual status.

A later code-agent runtime/lab deployment must carry the station_status/station_deliver gateway branch and station_client call. Do not replace this active integration with the historical original transport. No change needed in formulas/templates. The admin subsection has a direct URL; the general admin bundle is not rebuilt over another agent's active work.

## Checks

```
python build_adapters.py
python -B -m unittest test_delivery
ALISA_TEST_RUNTIME=/path/to/qualified/runtime python -B test_runtime_delivery.py
node --check app.js
```

Offline transport fixtures make no Yandex/provider calls. Installed synthetic checks and physical owner acceptance are separate.
