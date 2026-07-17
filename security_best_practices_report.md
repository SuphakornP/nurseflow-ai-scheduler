# NurseFlow AI Security Review

Date: 2026-07-17

## Executive summary

The current repository has no identified Critical or High severity finding. The original unauthenticated-route, public-solver, spreadsheet-injection, and vulnerable-pytest findings have been remediated. The checked-in implementation is suitable for the stated private, single-admin hackathon scope when the Next.js app is the only public service and FastAPI is kept on private ingress.

It is not yet suitable for a hospital pilot or a general internet-facing multi-user service. The remaining risks are centralized abuse protection, managed credential/session lifecycle, bounded decompression for spreadsheet imports, a complete production CSP, and container/network hardening.

This review covers the Next.js/React application, FastAPI solver, Supabase migration and local configuration, environment-file handling, dependency manifests, import/export paths, and deployment files. Real values in `.env.local` and `services/solver/.env.local` were parsed only for presence, format, minimum length, token equality, and token separation checks; they were never printed. Randomness and rotation history remain outside this review.

## Residual risks

### SEC-R01: Abuse controls are process-local and expensive actions have no shared quota

- Severity: Medium for an internet-facing deployment; accepted residual risk for the private hackathon deployment.
- Locations: `lib/auth/rate-limit.ts:14`, `lib/auth/rate-limit.ts:35`, `app/api/demo/route.ts:24`, `app/api/generate/route.ts:57`, `app/api/normalize/route.ts:30`, `app/api/explain/route.ts:27`.
- Evidence: login failures are stored in an in-memory process map and keyed by normalized account email. The five-attempt window therefore resets on restart, is not shared across instances, and can be used to temporarily lock the single known account. Demo and generation each launch three solver jobs, while normalization and explanation can consume OpenAI quota. These authenticated work routes do not have a shared rate limit, concurrency limit, or per-session quota.
- Impact: distributed attempts can bypass a per-process control, and a compromised admin session can consume solver capacity or OpenAI budget.
- Recommendation: enforce account-plus-trusted-client rate limits at the platform edge, store counters in a shared backend, add a bounded solver queue or semaphore, and set explicit per-session/per-day OpenAI quotas. Do not trust arbitrary forwarded-IP headers unless the deployment proxy overwrites them.

### SEC-R02: The event authentication model has no MFA or immediate session revocation

- Severity: Medium for production; explicitly accepted for this event build.
- Locations: `lib/auth/config.ts:5`, `lib/auth/session-token.ts:28`, `lib/auth/cookie.ts:1`, `app/api/auth/logout/route.ts:6`, `docs/privacy.md:26`.
- Evidence: one plaintext deployment-secret password is compared server-side, and successful authentication creates a stateless JWT with an absolute eight-hour lifetime. Logout deletes the browser cookie but does not deny-list a copied token. There is no MFA, password reset, per-session revocation, or managed identity lifecycle. Rotating `AUTH_SECRET` remains the emergency mechanism that invalidates all sessions.
- Impact: a stolen password or session has a larger blast radius than it would with managed authentication and server-side revocation.
- Recommendation: before a hospital pilot, move to a managed identity provider with slow password hashing where applicable, MFA, centralized revocation, access review, and auditable credential rotation. Shorten the session lifetime if the private hackathon deployment does not need eight hours.

### SEC-R03: Spreadsheet upload limits do not bound multipart parsing or ZIP expansion

- Severity: Low in the admin-only build; Medium if import is exposed to untrusted users.
- Locations: `app/api/import/route.ts:12`, `app/api/import/route.ts:67`, `app/api/import/route.ts:84`, `lib/importer.ts:133`.
- Evidence: the route authenticates before parsing, rejects an oversized declared request, caps uploaded and remote files at 10 MB, streams Google exports with a hard byte limit, and applies a 15-second timeout. However, `request.formData()` runs before `File.size` can be checked when `Content-Length` is absent or misleading. A 10 MB `.xlsx` is a ZIP archive, and `ExcelJS.Workbook.xlsx.load()` has no repository-enforced cap on decompressed bytes or archive-entry count.
- Impact: an authenticated malicious or accidentally pathological workbook could cause memory or CPU pressure.
- Recommendation: enforce an independent body limit at the reverse proxy/hosting edge, use a streaming multipart parser if untrusted uploads are introduced, and inspect ZIP metadata with limits on entry count, compression ratio, and total uncompressed bytes before workbook parsing.

### SEC-R04: Content Security Policy is useful but incomplete

- Severity: Low defense-in-depth gap.
- Location: `next.config.ts:3`.
- Evidence: global headers set `base-uri`, `form-action`, `frame-ancestors`, and `object-src`, plus `nosniff`, no-referrer, frame denial, and a restrictive Permissions Policy. The CSP does not yet define `default-src`, `script-src`, `style-src`, `img-src`, `connect-src`, or nonce/hash handling.
- Impact: the policy limits framing and several legacy injection paths but would not substantially contain a future script-injection bug.
- Recommendation: deploy a tested nonce- or hash-based Next.js CSP in report-only mode first, enumerate the required OpenAI/Supabase/image/connect origins, then enforce it after confirming hydration and development tooling are unaffected.

### SEC-R05: Solver deployment and container hardening depend on external controls

- Severity: Low for private ingress; Medium if the container port is published directly.
- Locations: `services/solver/app/main.py:22`, `services/solver/app/auth.py:16`, `services/solver/Dockerfile:1`, `services/solver/Dockerfile:15`, `services/solver/requirements.txt:1`.
- Evidence: work endpoints require a constant-time bearer-token check, OpenAPI/docs are disabled, and `/health` returns only `{ "status": "ok" }`. The image still runs as root, binds Uvicorn to `0.0.0.0`, does not apply trusted-host middleware, and installs broad dependency ranges from `requirements.txt` instead of the resolved lockfile.
- Impact: a network-policy mistake exposes a larger attack surface, and a future dependency/application compromise would run with unnecessary container privilege. Rebuilding at different times can select different dependency versions.
- Recommendation: allow traffic only from the Next.js service, terminate TLS at trusted ingress, restrict accepted hosts, run as an unprivileged UID, use a read-only filesystem where practical, and build from fully resolved hashes or the checked-in lockfile.

## Resolved and verified controls

### Admin authentication and authorization

- `proxy.ts:20` redirects anonymous page requests and returns `401` for anonymous API requests while allowing only login, auth endpoints, and static metadata paths.
- Every non-auth application Route Handler independently calls `requireAdminRequest`; state-changing routes request the same-origin check in `lib/auth/request.ts:35`. This avoids treating the proxy as the sole authorization layer.
- Login rejects invalid configuration with `503`, returns a generic credential error, bounds request fields, and uses constant-time digests for email and password comparison (`app/api/auth/login/route.ts:33`, `lib/auth/credentials.ts:10`).
- JWT verification allowlists HS256 and validates issuer, audience, expiry, strict payload shape, `ADMIN` role, current configured email/display name, exact lifetime, and future-issued timestamps (`lib/auth/session-token.ts:49`).
- The host-only session cookie is `HttpOnly`, `SameSite=Strict`, path-scoped to `/`, and `Secure` in production with an absolute eight-hour maximum (`lib/auth/cookie.ts:1`).
- Admin email is not written to scheduling records. The configured display name is the confirmation audit actor, as documented in `docs/privacy.md:26`.

### Solver and request boundaries

- Next.js attaches a server-only `SOLVER_API_TOKEN` to all solver work requests (`lib/solver-client.ts:13`); FastAPI rejects missing, short, or incorrect tokens using `secrets.compare_digest` (`services/solver/app/auth.py:16`).
- `/demo`, `/generate`, and `/export` are protected. `/health` is intentionally public and minimal; FastAPI docs, ReDoc, and OpenAPI are disabled (`services/solver/app/main.py:22`). CORS is not enabled because browsers should not call the solver directly.
- Generation JSON is streamed with a 5 MB cap and validated through a strict Zod dataset schema (`app/api/generate/route.ts:16`, `lib/schedule-schema.ts:71`).
- Pydantic forbids unknown fields and bounds the scheduling problem to 100 nurses, 62 days, 6,200 requests/previous assignments, staffing values, rule windows, string lengths, solver time, and export assignments (`services/solver/app/models.py:10`, `services/solver/app/models.py:144`).
- Google Sheet import allowlists the expected HTTPS Docs URL shape, applies a 15-second timeout, and streams the response through a 10 MB cap (`app/api/import/route.ts:41`, `lib/importer.ts:247`).

### Output, error, and browser protections

- Confirmation and export reuse the same fail-closed eligibility rule: a
  candidate must be `VALID`, include non-empty hard-validation evidence, and
  pass every hard validation (`lib/confirmation-eligibility.ts:123`,
  `app/api/export/route.ts:48`).
- CSV and Excel exports neutralize formula-leading cells. The FastAPI exporter also catches formula markers after whitespace/control characters, and export filenames use an ASCII allowlist before entering response headers (`lib/spreadsheet.ts:1`, `services/solver/app/export.py:29`, `services/solver/app/main.py:37`).
- Authenticated API routes return stable client-safe errors rather than forwarding solver, Supabase, OpenAI, or deployment details. Health output exposes readiness rather than credentials or service URLs.
- Global responses set a partial CSP, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a restrictive Permissions Policy, and omit `X-Powered-By` (`next.config.ts:3`).
- No dangerous React HTML rendering or dynamic-code sink was found during static review.

### Secrets, privacy, Supabase, and dependencies

- `.gitignore:27` excludes `.env`, every `.env.*` file except examples, private keys, generated spreadsheets, virtual environments, coverage, caches, and build output. `git check-ignore -v` confirmed both real `.env.local` files are ignored.
- `.env.example:1` and `services/solver/.env.example:1` contain placeholders only and keep secret values server-side. A secret-pattern scan excluding ignored local environment files found no committed OpenAI key, Supabase secret key, private key, JWT, or credential-bearing database URL.
- OpenAI calls are server-only, use Structured Outputs, set `store: false`, use hashed safety identifiers, bound request/response fields, and send only nickname-level scheduling context (`lib/openai-normalization.ts:86`, `lib/openai-explanation.ts:44`).
- Supabase RLS is enabled and forced on all 18 application tables; grants are explicit with no anonymous table access, authenticated writes are policy-scoped, and service-only functions revoke default execution before granting narrowly (`supabase/migrations/20260716065746_nurseflow_initial_schema.sql:2113`, `supabase/migrations/20260716065746_nurseflow_initial_schema.sql:2297`, `supabase/migrations/20260716065746_nurseflow_initial_schema.sql:2376`).
- Local Supabase signup and email signup are disabled (`supabase/config.toml:176`, `supabase/config.toml:221`). The application does not use Supabase Auth for the event admin.
- The Python development constraint requires patched `pytest>=9.0.3,<10` (`services/solver/pyproject.toml:17`).

## Verification performed

- Secret-pattern scan over non-generated repository files, excluding ignored local environment files.
- `git check-ignore -v .env.local services/solver/.env.local`: both files matched `.gitignore`.
- `npm audit --audit-level=low`: 0 known vulnerabilities across 598 dependencies.
- `pip-audit` against the solver virtual environment: no known vulnerabilities; installed pytest is 9.1.1.
- `npm run test:web`: 128 tests passed.
- `npm run test:solver`: 73 tests passed. The only output was an existing Starlette/httpx deprecation warning.
- Static review of authentication, every Next.js Route Handler, React injection sinks, request-size controls, FastAPI authentication/models/export, OpenAI data flow, Supabase RLS/policies/grants/functions, and deployment files.

## Release decision

Security review status: **PASS WITH ACCEPTED RESIDUAL RISKS** for a private, admin-only hackathon deployment.

Before publishing, verify that the solver is not directly internet-reachable, production uses HTTPS so the session cookie is `Secure`, `AUTH_SECRET` and `SOLVER_API_TOKEN` are independent random values of at least 32 characters, and only placeholder environment files are staged. Before any hospital pilot or external-user access, resolve SEC-R01 through SEC-R05 and complete privacy, retention, access-review, incident-response, and legal assessments.
