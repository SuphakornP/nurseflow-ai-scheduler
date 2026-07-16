# Architecture

## Product boundary

NurseFlow separates probabilistic language work from deterministic scheduling work:

```mermaid
flowchart LR
    A[Nickname-only Sheet or Excel] --> B[Deterministic parser]
    B --> C[AI ambiguity suggestions]
    C --> D[Human review]
    D --> E[CP-SAT optimizer]
    E --> F[Independent validator]
    F --> G[Candidate versions]
    G --> H{Scheduler decision}
    H -->|regenerate| E
    H -->|confirm| I[Supabase version record]
    I --> J[Excel export]
```

- The parser handles casing, whitespace, aliases, and known request syntax before AI is called.
- GPT-5.6 Terra sees only ambiguous tokens or structured reason facts, never full source rows.
- CP-SAT is the only component allowed to create a complete roster.
- The validator re-computes every hard rule from assignments and previous-month context.
- Confirmation requires all hard validations to pass and is executed atomically in Postgres.

## Runtime components

```mermaid
flowchart TB
    ADMIN[Single admin browser session]
    UI[Next.js operational workspace]
    API[Next.js route handlers]
    AI[OpenAI Responses API]
    SOLVER[FastAPI scheduling service]
    SAT[OR-Tools CP-SAT]
    VALIDATE[Independent validator]
    DB[(Supabase Postgres)]
    STORE[(Supabase Storage)]

    ADMIN -->|HttpOnly signed session| UI
    UI --> API
    API --> AI
    API -->|Bearer service token| SOLVER
    SOLVER --> SAT
    SOLVER --> VALIDATE
    API --> DB
    API --> STORE
```

The browser never calls the solver directly. FastAPI does not enable CORS; Next.js attaches the shared bearer token when calling `/demo`, `/generate`, and `/export`. The public `/health` route returns only minimal status.

## Authentication boundary

- `proxy.ts` redirects anonymous page requests to `/login`, returns `401` for anonymous API requests, and sends an authenticated administrator away from `/login` to the workspace.
- Route Handlers verify the signed session independently of the proxy. They check the JWT signature, issuer, audience, expiry, `ADMIN` role, and configured administrator email.
- State-changing requests must pass a same-origin check. Login attempts are limited to five per 15 minutes in each Next.js process.
- The absolute session lifetime is eight hours. Rotating `AUTH_SECRET` invalidates all existing sessions, and sign out deletes the host-only cookie.

## Failure behavior

- Missing OpenAI key: deterministic suggestions and reason-code explanations; human review remains required.
- Missing Supabase credentials: local showcase session only, clearly labeled as not persisted.
- Solver unavailable: API returns a client-safe `503` without exposing service configuration.
- Missing or invalid admin configuration: login fails closed with `503`; anonymous pages redirect to `/login` and anonymous APIs return `401`.
- Missing or invalid solver token: work endpoints fail closed; the solver health check remains minimal and public for service orchestration.
- Infeasible dataset: no synthetic success response; the service returns diagnostics and blocks confirmation.
- OpenAI failure with a configured key: API returns `502`; it does not silently present a generated explanation as an AI result.

## Deployment shape

- Deploy `app/` on a Node-compatible Next.js host.
- Deploy `services/solver/` as a long-running Python service with at least one CPU and a request timeout above the solver limit.
- Set `SOLVER_API_URL` to the private service endpoint.
- Set a matching random `SOLVER_API_TOKEN` on Next.js and the solver; do not expose the solver work endpoints directly to browsers.
- Browsers call only Next.js; the solver intentionally does not enable CORS. Its `/health` endpoint exposes only minimal service status, while `/demo`, `/generate`, and `/export` require the bearer service token.
- Set the single event administrator and `AUTH_SECRET` only in the Next.js secret store. Rotate the signing secret to revoke all sessions.
- Use a dedicated Supabase project or branch for the event.
- Keep OpenAI and Supabase secret keys in the server-side deployment secret store.
