# Private native Harness entry portal (lab only)

The original native Harness Host still requires its owner launch token. The lab entry page is an extra *operator* access-code form, not customer authentication or multi-tenant isolation. No access code, SHA hash, launch URL or cookie belongs in Git. Production auth requires a tenant-aware account gateway.

## Regression and safety

- A browser must receive `Referrer-Policy: same-origin` on the HTML **GET /lab-login** response (including Nginx's actual response headers). An earlier `no-referrer` header caused Chromium to send `Origin: null`, so the form denied even valid logins.
- The portal enforces exact `Origin` when provided, validates a 12-80 character secret normalized as uppercase without hyphens against the private SHA256 file, rate-limits failures, then issues a 303 to the separately protected native launch URL. The native Host independently authenticates and issues its own session cookie.
- Unauthenticated **GET /** should redirect to **/lab-login**. User's real signed URL should not be logged or placed in version control. Only the Nginx-owned HTTPS listener is public; the form service binds loopback at 18444.
- Run `python3 portal-positive-test.py`: isolated synthetic credentials; assert 403 wrong code, 303 valid code, 403 cross-origin, without changing any live secret or service.
- Separately verify with an actual external Chromium: initial form, POST with arbitrary *wrong* code should show «Неверный код доступа» rather than «Недопустимый источник запроса»; a positive real-code form submission and fully loaded native chat should be tested before any production-ready claim. Signed entry token is never disclosed in logs.
- Confirm native model and MCP using the existing trusted native RPC helper, then keep operator lab isolated from customer-facing product work.

Entry service unit and Nginx sample are provided alongside the portal code; review local certificates and service permissions before deployment.
