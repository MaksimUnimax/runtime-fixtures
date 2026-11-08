# Station delivery probe

Isolated owner-only transport probe. It uses a separate QR-approved Yandex session,
creates only its own scenario on the explicitly selected speaker, and sends only
two fixed non-financial commands. It does not change skill linking or marketplace
runtime. Yandex's internal Quasar interface is experimental.

The access link carries a random capability in its fragment; the browser removes
the fragment and keeps it only in sessionStorage. Requests require this capability
and the exact HTTPS Origin. Session cookies and QR state are memory-only and expire
with the three-hour probe. No tokens or customer responses enter logs.

Run `python3 -B -m unittest discover -v` for offline checks. See REPORT.md for the
installed version, current evidence, and the owner test.
